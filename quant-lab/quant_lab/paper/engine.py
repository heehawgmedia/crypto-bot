"""Paper trading engine.

Runs the strategy against live market data with simulated fills. Fills are
priced off the close of the newly completed bar (the next bar's open is, at
poll time, this instant's price) with the same slippage + taker fee model as
the backtester. Every order and fill is written to the audit database; broker
state (cash/units/last processed bar) is durable, so the loop can be stopped
and restarted without losing the track record.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from quant_lab.alerts import Alerter, NullAlerter
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import StrategyInstanceConfig
from quant_lab.strategies import build_strategy


@dataclass(frozen=True)
class PaperStep:
    acted: bool
    bar_time: pd.Timestamp | None
    side: str | None  # buy | sell | None
    equity_usd: float
    detail: str


class PaperEngine:
    def __init__(
        self,
        scfg: StrategyInstanceConfig,
        cost: CostModel,
        audit: AuditLog,
        initial_capital_usd: float,
        alerter: Alerter | None = None,
    ) -> None:
        self._scfg = scfg
        self._strategy = build_strategy(scfg.strategy, scfg.params)
        self._cost = cost
        self._audit = audit
        self._initial = initial_capital_usd
        self._alerter = alerter or NullAlerter()

    def _state(self) -> tuple[float, float, str | None]:
        row = self._audit.get_paper_state(self._scfg.name)
        if row is None:
            return self._initial, 0.0, None
        return float(row["cash_usd"]), float(row["units"]), row["last_bar_utc"]

    def equity(self, last_price: float) -> float:
        cash, units, _ = self._state()
        return cash + units * last_price

    def step(self, df: pd.DataFrame) -> PaperStep:
        """Process the latest completed bar in df; trade at most once.

        df must be the integrity-checked OHLCV history for this strategy's
        market, ending at the most recent completed bar.
        """
        if len(df) < 2:
            return PaperStep(False, None, None, self._initial, "not enough bars")

        cash, units, last_bar = self._state()
        bar_time = df.index[-1]
        last_close = float(df["close"].iloc[-1])

        if last_bar is not None and pd.Timestamp(last_bar) >= bar_time:
            return PaperStep(
                False, bar_time, None, cash + units * last_close, "bar already processed"
            )

        signal = int(self._strategy.signals(df).iloc[-1])
        holding = units > 0.0
        side: str | None = None
        detail = "no position change"

        if signal == 1 and not holding:
            side = "buy"
            fill_price = last_close * (1.0 + self._cost.slippage)
            fee_usd = cash * self._cost.fee
            units = cash * (1.0 - self._cost.fee) / fill_price
            qty = units
            cash = 0.0
            detail = f"bought {qty:.8f} @ {fill_price:.2f} (fee ${fee_usd:.2f})"
        elif signal == 0 and holding:
            side = "sell"
            fill_price = last_close * (1.0 - self._cost.slippage)
            proceeds = units * fill_price
            fee_usd = proceeds * self._cost.fee
            qty = units
            cash = proceeds * (1.0 - self._cost.fee)
            units = 0.0
            detail = f"sold {qty:.8f} @ {fill_price:.2f} (fee ${fee_usd:.2f})"

        if side is not None:
            order_id = self._audit.record_order(
                mode="paper",
                strategy=self._scfg.name,
                exchange=self._scfg.exchange,
                symbol=self._scfg.symbol,
                side=side,
                qty=qty,
                price=last_close,
                status="filled",
            )
            self._audit.record_fill(
                order_id=order_id,
                mode="paper",
                strategy=self._scfg.name,
                symbol=self._scfg.symbol,
                side=side,
                qty=qty,
                price=fill_price,
                fee_usd=fee_usd,
            )
            self._alerter.fill(
                f"[paper] {self._scfg.name}: {side} {qty:.8f} {self._scfg.symbol} "
                f"@ {fill_price:.2f}, fee ${fee_usd:.2f}"
            )

        self._audit.set_paper_state(self._scfg.name, cash, units, bar_time.isoformat())
        return PaperStep(side is not None, bar_time, side, cash + units * last_close, detail)
