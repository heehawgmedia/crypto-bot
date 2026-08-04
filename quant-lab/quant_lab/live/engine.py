"""Live execution engine — deliberately the smallest surface in the codebase.

Preconditions enforced at construction (not at order time, so a misconfigured
engine cannot even be built):
  - config mode must be `live`
  - the strategy's audited stage must be `live` (walk-forward + paper gates
    already passed)
  - `max_capital_usd` must be set (config validation guarantees this in live
    mode)

Per step: kill switches are consulted before anything else; the capital cap
is checked before any buy reaches the exchange; every order, fill, rejection,
and error is audited. Spot market orders only — no leverage, margin, or
shorting exists anywhere in this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import pandas as pd

from quant_lab.alerts import Alerter, NullAlerter
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import AppConfig, Mode, StrategyInstanceConfig
from quant_lab.risk.killswitch import KillSwitchMonitor, RiskSnapshot
from quant_lab.risk.sizing import CapitalCapExceeded, check_capital_cap, size_entry
from quant_lab.strategies import build_strategy


class ExecutionClient(Protocol):
    """The only exchange operations live trading is allowed to use."""

    def create_market_buy_order(self, symbol: str, amount: float) -> dict[str, Any]: ...

    def create_market_sell_order(self, symbol: str, amount: float) -> dict[str, Any]: ...


@dataclass(frozen=True)
class LiveStep:
    acted: bool
    side: str | None
    detail: str


class LiveEngine:
    def __init__(
        self,
        scfg: StrategyInstanceConfig,
        cfg: AppConfig,
        client: ExecutionClient,
        audit: AuditLog,
        killswitch: KillSwitchMonitor,
        alerter: Alerter | None = None,
    ) -> None:
        if cfg.mode is not Mode.LIVE:
            raise RuntimeError(f"live engine requires mode=live in config (got {cfg.mode.value})")
        stage = audit.get_stage(scfg.name)
        if stage != "live":
            raise RuntimeError(
                f"strategy {scfg.name!r} is at stage {stage!r}, not 'live'; "
                "promotion gates are the only path here"
            )
        if cfg.risk.max_capital_usd is None:  # config validator makes this unreachable
            raise RuntimeError("max_capital_usd is not set")

        self._scfg = scfg
        self._cfg = cfg
        self._strategy = build_strategy(scfg.strategy, scfg.params)
        self._client = client
        self._audit = audit
        self._killswitch = killswitch
        self._alerter = alerter or NullAlerter()
        self._cost = CostModel(
            taker_fee_bps=cfg.exchanges[scfg.exchange].taker_fee_bps,
            slippage_bps=cfg.backtest.slippage_bps,
        )
        self._consecutive_api_errors = 0
        self._day_anchor: tuple[str, float] | None = None  # (UTC date, equity)
        self._peak_equity = 0.0

    # -- position bookkeeping (from the audited fill history) --------------

    def position_units(self) -> float:
        units = 0.0
        for f in self._audit.fills(strategy=self._scfg.name, mode="live"):
            units += f["qty"] if f["side"] == "buy" else -f["qty"]
        return max(units, 0.0)

    def exposure_usd(self, last_price: float) -> float:
        return self.position_units() * last_price

    def net_pnl_usd(self, last_price: float) -> float:
        """Realized cash flow from all live fills plus current position value."""
        cash = 0.0
        for f in self._audit.fills(strategy=self._scfg.name, mode="live"):
            if f["side"] == "buy":
                cash -= f["qty"] * f["price"] + f["fee_usd"]
            else:
                cash += f["qty"] * f["price"] - f["fee_usd"]
        return cash + self.exposure_usd(last_price)

    def equity_usd(self, last_price: float) -> float:
        """Allocated capital plus cumulative PnL — the base for % kill switches."""
        assert self._cfg.risk.max_capital_usd is not None
        return self._cfg.risk.max_capital_usd + self.net_pnl_usd(last_price)

    # -- risk snapshot ------------------------------------------------------

    def _risk_snapshot(self, equity: float, now: datetime) -> RiskSnapshot:
        today = now.astimezone(UTC).date().isoformat()
        if self._day_anchor is None or self._day_anchor[0] != today:
            self._day_anchor = (today, equity)
        self._peak_equity = max(self._peak_equity, equity)
        return RiskSnapshot(
            equity_usd=equity,
            day_start_equity_usd=self._day_anchor[1],
            peak_equity_usd=self._peak_equity,
            consecutive_api_errors=self._consecutive_api_errors,
        )

    # -- main loop body ------------------------------------------------------

    def step(self, df: pd.DataFrame, now: datetime | None = None) -> LiveStep:
        now = now or datetime.now(UTC)
        last_price = float(df["close"].iloc[-1])
        units = self.position_units()
        equity = self.equity_usd(last_price)

        tripped_reason = self._killswitch.observe(self._risk_snapshot(equity, now))
        signal = int(self._strategy.signals(df).iloc[-1])

        if tripped_reason is not None:
            # A trip halts NEW ENTRIES. Risk-reducing sells still execute:
            # either an immediate flatten (if configured) or a signal exit.
            if units > 0.0 and self._killswitch.flatten_on_trip:
                return self._sell(units, last_price, f"kill switch flatten: {tripped_reason}")
            if units > 0.0 and signal == 0:
                return self._sell(units, last_price, "signal exit (kill switch active)")
            return LiveStep(False, None, f"halted by kill switch: {tripped_reason}")

        if signal == 1 and units == 0.0:
            return self._buy(last_price)
        if signal == 0 and units > 0.0:
            return self._sell(units, last_price, "signal exit")
        return LiveStep(False, None, "no position change")

    # -- order paths ---------------------------------------------------------

    def _buy(self, last_price: float) -> LiveStep:
        assert self._cfg.risk.max_capital_usd is not None
        max_capital = self._cfg.risk.max_capital_usd
        exposure = self.exposure_usd(last_price)
        decision = size_entry(
            max_capital_usd=max_capital,
            per_strategy_capital_frac=self._cfg.risk.per_strategy_capital_frac,
            current_exposure_usd=exposure,
        )
        if decision.notional_usd <= 0.0:
            self._audit.record_order(
                mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
                symbol=self._scfg.symbol, side="buy", qty=0.0, price=last_price,
                status="rejected", reason=decision.reason,
            )
            return LiveStep(False, None, f"entry rejected: {decision.reason}")

        try:
            check_capital_cap(exposure, decision.notional_usd, max_capital)
        except CapitalCapExceeded as exc:
            self._audit.record_order(
                mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
                symbol=self._scfg.symbol, side="buy",
                qty=decision.notional_usd / last_price, price=last_price,
                status="rejected", reason=str(exc),
            )
            return LiveStep(False, None, f"entry rejected: {exc}")

        qty = decision.notional_usd / last_price
        return self._execute("buy", qty, last_price)

    def _sell(self, units: float, last_price: float, why: str) -> LiveStep:
        step = self._execute("sell", units, last_price)
        if step.acted:
            return LiveStep(True, "sell", f"{step.detail} ({why})")
        return step

    def _execute(self, side: str, qty: float, last_price: float) -> LiveStep:
        try:
            if side == "buy":
                response = self._client.create_market_buy_order(self._scfg.symbol, qty)
            else:
                response = self._client.create_market_sell_order(self._scfg.symbol, qty)
        except Exception as exc:  # noqa: BLE001 - every client failure must be audited
            self._consecutive_api_errors += 1
            self._audit.record("api_error", {"error": str(exc), "side": side},
                               strategy=self._scfg.name)
            self._audit.record_order(
                mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
                symbol=self._scfg.symbol, side=side, qty=qty, price=last_price,
                status="error", reason=str(exc),
            )
            return LiveStep(False, None, f"order error ({self._consecutive_api_errors} in a row): {exc}")

        self._consecutive_api_errors = 0
        order_id = self._audit.record_order(
            mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
            symbol=self._scfg.symbol, side=side, qty=qty, price=last_price,
            status="filled",
        )
        fill_price = float(response.get("average") or response.get("price") or last_price)
        fill_qty = float(response.get("filled") or qty)
        fee_usd = float((response.get("fee") or {}).get("cost") or 0.0)
        self._audit.record_fill(
            order_id=order_id, mode="live", strategy=self._scfg.name,
            symbol=self._scfg.symbol, side=side, qty=fill_qty, price=fill_price,
            fee_usd=fee_usd,
        )
        self._alerter.fill(
            f"[LIVE] {self._scfg.name}: {side} {fill_qty:.8f} {self._scfg.symbol} "
            f"@ {fill_price:.2f}, fee ${fee_usd:.2f}"
        )
        return LiveStep(True, side, f"{side} {fill_qty:.8f} @ {fill_price:.2f}")
