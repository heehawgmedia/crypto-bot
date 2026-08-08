"""Paper trading engine.

Runs the strategy against live market data with simulated fills. Fills are
priced off the close of the newly completed bar (the next bar's open is, at
poll time, this instant's price) with the same slippage + taker fee model as
the backtester. Trade rules (stop-loss / take-profit / cooldown / re-entry
arming) follow the exact semantics of the rules backtest engine: triggers are
evaluated on the completed bar, exits fill at the current poll. Every order
and fill is written to the audit database; broker state is durable, so the
loop can be stopped and restarted without losing the track record.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from quant_lab.alerts import Alerter, NullAlerter
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import StrategyInstanceConfig, VaultConfig
from quant_lab.data.timeframes import timeframe_to_ms
from quant_lab.risk.stops import TradeRules
from quant_lab.strategies import build_strategy


@dataclass(frozen=True)
class PaperStep:
    acted: bool
    bar_time: pd.Timestamp | None
    side: str | None  # buy | sell | None
    equity_usd: float
    detail: str


@dataclass
class _State:
    cash: float
    units: float
    last_bar: str | None
    entry_price: float | None
    armed: bool
    cooldown_until: str | None
    entry_cost: float | None


class PaperEngine:
    def __init__(
        self,
        scfg: StrategyInstanceConfig,
        cost: CostModel,
        audit: AuditLog,
        initial_capital_usd: float,
        alerter: Alerter | None = None,
        vault: VaultConfig | None = None,
    ) -> None:
        self._scfg = scfg
        self._strategy = build_strategy(scfg.strategy, scfg.params)
        self._cost = cost
        self._audit = audit
        self._initial = initial_capital_usd
        self._alerter = alerter or NullAlerter()
        self._rules = TradeRules.from_strategy(scfg)
        self._bar_ms = timeframe_to_ms(scfg.timeframe)
        self._vault = vault or VaultConfig()

    def _state(self) -> _State:
        row = self._audit.get_paper_state(self._scfg.name)
        if row is None:
            return _State(self._initial, 0.0, None, None, True, None, None)
        return _State(
            cash=float(row["cash_usd"]),
            units=float(row["units"]),
            last_bar=row["last_bar_utc"],
            entry_price=float(row["entry_price"]) if row["entry_price"] is not None else None,
            armed=bool(row["reentry_armed"]),
            cooldown_until=row["cooldown_until_utc"],
            entry_cost=(
                float(row["entry_cost_usd"]) if row["entry_cost_usd"] is not None else None
            ),
        )

    def equity(self, last_price: float) -> float:
        s = self._state()
        return s.cash + s.units * last_price

    def step(self, df: pd.DataFrame) -> PaperStep:
        """Process the latest completed bar in df; trade at most once.

        df must be the integrity-checked OHLCV history for this strategy's
        market, ending at the most recent completed bar.
        """
        if len(df) < 2:
            return PaperStep(False, None, None, self._initial, "not enough bars")

        s = self._state()
        bar_time = df.index[-1]
        last_close = float(df["close"].iloc[-1])
        bar_low = float(df["low"].iloc[-1])
        bar_high = float(df["high"].iloc[-1])

        if s.last_bar is not None and pd.Timestamp(s.last_bar) >= bar_time:
            return PaperStep(
                False, bar_time, None, s.cash + s.units * last_close, "bar already processed"
            )

        signal = int(self._strategy.signals(df).iloc[-1])
        holding = s.units > 0.0
        side: str | None = None
        detail = "no position change"

        if signal == 0:
            s.armed = True

        if holding:
            trigger = None
            if s.entry_price is not None:
                trigger = self._rules.exit_trigger(s.entry_price, bar_low, bar_high)
            if trigger is not None:
                side, detail = self._sell(s, last_close, trigger)
                s.armed = False
                cooldown_end = bar_time + pd.Timedelta(
                    milliseconds=self._rules.cooldown_bars * self._bar_ms
                )
                s.cooldown_until = cooldown_end.isoformat()
            elif signal == 0:
                side, detail = self._sell(s, last_close, "signal")
        elif signal == 1 and s.armed and self._cooldown_over(s, bar_time):
            # A manual pause halts NEW ENTRIES only (same rule as a kill-switch
            # trip). The bar is still marked processed, so resuming never
            # back-fills an entry the owner was not there for.
            if self._audit.trading_enabled():
                side, detail = self._buy(s, last_close)
            else:
                detail = "paused: entry skipped"

        self._audit.set_paper_state(
            self._scfg.name,
            s.cash,
            s.units,
            bar_time.isoformat(),
            entry_price=s.entry_price,
            reentry_armed=s.armed,
            cooldown_until_utc=s.cooldown_until,
            entry_cost_usd=s.entry_cost,
        )
        return PaperStep(side is not None, bar_time, side, s.cash + s.units * last_close, detail)

    def _cooldown_over(self, s: _State, bar_time: pd.Timestamp) -> bool:
        return s.cooldown_until is None or bar_time >= pd.Timestamp(s.cooldown_until)

    def _buy(self, s: _State, last_close: float) -> tuple[str, str]:
        fill_price = last_close * (1.0 + self._cost.slippage)
        fee_usd = s.cash * self._cost.fee
        s.units = s.cash * (1.0 - self._cost.fee) / fill_price
        qty = s.units
        s.entry_cost = s.cash  # full cash deployed, fees included
        s.cash = 0.0
        s.entry_price = fill_price
        self._record("buy", qty, last_close, fill_price, fee_usd, reason=None)
        return "buy", f"bought {qty:.8f} @ {fill_price:.2f} (fee ${fee_usd:.2f})"

    def _sell(self, s: _State, last_close: float, reason: str) -> tuple[str, str]:
        fill_price = last_close * (1.0 - self._cost.slippage)
        proceeds = s.units * fill_price
        fee_usd = proceeds * self._cost.fee
        qty = s.units
        s.cash = proceeds * (1.0 - self._cost.fee)
        s.units = 0.0
        s.entry_price = None

        skim_note = ""
        realized = s.cash - s.entry_cost if s.entry_cost is not None else 0.0
        s.entry_cost = None
        order_id = self._record("sell", qty, last_close, fill_price, fee_usd, reason=reason)
        if self._vault.enabled and realized > 0.0:
            skim = realized * self._vault.skim_pct / 100.0
            s.cash -= skim
            self._audit.vault_credit(
                skim,
                strategy=self._scfg.name,
                mode="paper",
                ref_order_id=order_id,
                note=f"{self._vault.skim_pct}% of ${realized:,.2f} win",
            )
            skim_note = f", ${skim:,.2f} skimmed to vault"
        return (
            "sell",
            f"sold {qty:.8f} @ {fill_price:.2f} (fee ${fee_usd:.2f}) [{reason}]{skim_note}",
        )

    def _record(
        self,
        side: str,
        qty: float,
        ref_price: float,
        fill_price: float,
        fee_usd: float,
        reason: str | None,
    ) -> int:
        order_id = self._audit.record_order(
            mode="paper",
            strategy=self._scfg.name,
            exchange=self._scfg.exchange,
            symbol=self._scfg.symbol,
            side=side,
            qty=qty,
            price=ref_price,
            status="filled",
            reason=reason,
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
        why = f" ({reason})" if reason and reason != "signal" else ""
        self._alerter.fill(
            f"[paper] {self._scfg.name}: {side} {qty:.8f} {self._scfg.symbol} "
            f"@ {fill_price:.2f}, fee ${fee_usd:.2f}{why}"
        )
        return order_id
