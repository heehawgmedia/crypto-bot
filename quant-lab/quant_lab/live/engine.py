"""Live execution engine — deliberately the smallest surface in the codebase.

Preconditions enforced at construction (not at order time, so a misconfigured
engine cannot even be built):
  - config mode must be `live`
  - the strategy's audited stage must be `live` (walk-forward + paper gates
    already passed)
  - `max_capital_usd` must be set (config validation guarantees this in live
    mode)

Safety properties per step:
  - each completed bar is processed at most once (durable last-bar marker)
  - kill switches are consulted before anything else; risk anchors (daily
    baseline, equity peak) persist in SQLite so a restart cannot reset them
  - the capital cap and exchange market rules (min size, min notional, amount
    precision) are checked before any buy reaches the exchange
  - every order carries a deterministic client order id derived from
    (strategy, bar, side), so an accidental resubmission of the same logical
    order is rejected by the exchange instead of doubling the position
  - every order, fill, rejection, and error is audited

Spot market orders only — no leverage, margin, or shorting exists anywhere in
this module.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import pandas as pd

from quant_lab.alerts import Alerter, NullAlerter
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import AppConfig, Mode, StrategyInstanceConfig
from quant_lab.data.timeframes import timeframe_to_ms
from quant_lab.live.market_rules import UNRESTRICTED, MarketRules
from quant_lab.risk.killswitch import KillSwitchMonitor, RiskSnapshot
from quant_lab.risk.sizing import CapitalCapExceeded, check_capital_cap, size_entry
from quant_lab.risk.stops import TradeRules
from quant_lab.strategies import build_strategy


class ExecutionClient(Protocol):
    """The only exchange operations live trading is allowed to use."""

    def create_market_buy_order(
        self, symbol: str, amount: float, params: dict[str, Any]
    ) -> dict[str, Any]: ...

    def create_market_sell_order(
        self, symbol: str, amount: float, params: dict[str, Any]
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class LiveStep:
    acted: bool
    side: str | None
    detail: str


def client_order_id(strategy: str, bar_time: pd.Timestamp, side: str) -> str:
    """Deterministic, exchange-unique id for the logical order (strategy, bar,
    side). 17 chars, alphanumeric — fits Kraken's cl_ord_id constraints."""
    strat_hash = hashlib.sha256(strategy.encode()).hexdigest()[:8]
    bar_hex = format(int(bar_time.value // 1_000_000_000), "08x")
    return f"{strat_hash}{bar_hex}{side[0]}"


class LiveEngine:
    def __init__(
        self,
        scfg: StrategyInstanceConfig,
        cfg: AppConfig,
        client: ExecutionClient,
        audit: AuditLog,
        killswitch: KillSwitchMonitor,
        alerter: Alerter | None = None,
        rules: MarketRules = UNRESTRICTED,
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
        self._rules = rules
        self._cost = CostModel(
            taker_fee_bps=cfg.exchanges[scfg.exchange].taker_fee_bps,
            slippage_bps=cfg.backtest.slippage_bps,
        )
        self._consecutive_api_errors = 0

        self._trade_rules = TradeRules.from_strategy(scfg)
        self._bar_ms = timeframe_to_ms(scfg.timeframe)

        # Durable state: risk anchors and trade-rule state survive restarts so
        # they can't be reset by bouncing the process.
        self._day_anchor: tuple[str, float] | None = None
        self._peak_equity = 0.0
        self._entry_price: float | None = None
        self._entry_cost: float | None = None
        self._armed = True
        self._cooldown_until: str | None = None
        state = audit.get_live_state(scfg.name)
        if state is not None:
            if state["day_date"] is not None and state["day_start_equity"] is not None:
                self._day_anchor = (state["day_date"], float(state["day_start_equity"]))
            self._peak_equity = float(state["peak_equity"] or 0.0)
            if state["entry_price"] is not None:
                self._entry_price = float(state["entry_price"])
            if state["entry_cost_usd"] is not None:
                self._entry_cost = float(state["entry_cost_usd"])
            self._armed = bool(state["reentry_armed"])
            self._cooldown_until = state["cooldown_until_utc"]

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

    def _persist_state(self, bar_time: pd.Timestamp) -> None:
        self._audit.set_live_state(
            self._scfg.name,
            last_bar_utc=bar_time.isoformat(),
            day_date=self._day_anchor[0] if self._day_anchor else None,
            day_start_equity=self._day_anchor[1] if self._day_anchor else None,
            peak_equity=self._peak_equity,
            entry_price=self._entry_price,
            reentry_armed=self._armed,
            cooldown_until_utc=self._cooldown_until,
            entry_cost_usd=self._entry_cost,
        )

    # -- main loop body ------------------------------------------------------

    def step(self, df: pd.DataFrame, now: datetime | None = None) -> LiveStep:
        now = now or datetime.now(UTC)
        bar_time = df.index[-1]

        state = self._audit.get_live_state(self._scfg.name)
        if (
            state is not None
            and state["last_bar_utc"] is not None
            and pd.Timestamp(state["last_bar_utc"]) >= bar_time
        ):
            return LiveStep(False, None, "bar already processed")

        result = self._evaluate(df, bar_time, now)
        self._persist_state(bar_time)
        return result

    def _evaluate(self, df: pd.DataFrame, bar_time: pd.Timestamp, now: datetime) -> LiveStep:
        last_price = float(df["close"].iloc[-1])
        bar_low = float(df["low"].iloc[-1])
        bar_high = float(df["high"].iloc[-1])
        units = self.position_units()
        equity = self.equity_usd(last_price)

        tripped_reason = self._killswitch.observe(self._risk_snapshot(equity, now))
        signal = int(self._strategy.signals(df).iloc[-1])
        if signal == 0:
            self._armed = True

        # Stop/target triggers are evaluated on the completed bar and exit at
        # market now — a risk-reducing sell, so it runs even when tripped.
        trigger: str | None = None
        if units > 0.0 and self._entry_price is not None:
            trigger = self._trade_rules.exit_trigger(self._entry_price, bar_low, bar_high)

        if tripped_reason is not None:
            # A trip halts NEW ENTRIES. Risk-reducing sells still execute.
            if units > 0.0 and self._killswitch.flatten_on_trip:
                return self._sell(
                    units, last_price, bar_time, f"kill switch flatten: {tripped_reason}"
                )
            if units > 0.0 and trigger is not None:
                self._arm_cooldown(bar_time)
                return self._sell(units, last_price, bar_time, trigger)
            if units > 0.0 and signal == 0:
                return self._sell(units, last_price, bar_time, "signal exit (kill switch active)")
            return LiveStep(False, None, f"halted by kill switch: {tripped_reason}")

        if not self._audit.trading_enabled():
            # Manual pause from the dashboard or CLI. Like a kill-switch trip
            # it stops new entries and nothing else: an open position keeps
            # its stop, its target, and its signal exit.
            if units > 0.0 and trigger is not None:
                self._arm_cooldown(bar_time)
                return self._sell(units, last_price, bar_time, trigger)
            if units > 0.0 and signal == 0:
                return self._sell(units, last_price, bar_time, "signal exit (paused)")
            return LiveStep(False, None, "paused by owner: new entries halted")

        if units > 0.0 and trigger is not None:
            self._arm_cooldown(bar_time)
            return self._sell(units, last_price, bar_time, trigger)
        if signal == 1 and units == 0.0:
            if not self._armed:
                return LiveStep(
                    False, None, "entry blocked: awaiting fresh signal after stop/target exit"
                )
            if not self._cooldown_over(bar_time):
                return LiveStep(
                    False, None, f"entry blocked: cooldown until {self._cooldown_until}"
                )
            return self._buy(last_price, bar_time)
        if signal == 0 and units > 0.0:
            return self._sell(units, last_price, bar_time, "signal exit")
        return LiveStep(False, None, "no position change")

    def _arm_cooldown(self, bar_time: pd.Timestamp) -> None:
        self._armed = False
        cooldown_end = bar_time + pd.Timedelta(
            milliseconds=self._trade_rules.cooldown_bars * self._bar_ms
        )
        self._cooldown_until = cooldown_end.isoformat()

    def _cooldown_over(self, bar_time: pd.Timestamp) -> bool:
        return self._cooldown_until is None or bar_time >= pd.Timestamp(self._cooldown_until)

    # -- order paths ---------------------------------------------------------

    def _reject(self, side: str, qty: float, last_price: float, reason: str) -> LiveStep:
        self._audit.record_order(
            mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
            symbol=self._scfg.symbol, side=side, qty=qty, price=last_price,
            status="rejected", reason=reason,
        )
        return LiveStep(False, None, f"{side} rejected: {reason}")

    def _buy(self, last_price: float, bar_time: pd.Timestamp) -> LiveStep:
        assert self._cfg.risk.max_capital_usd is not None
        # Skimmed live profit is earmarked for the vault and never redeployed
        # (until explicitly redistributed via the CLI).
        max_capital = max(0.0, self._cfg.risk.max_capital_usd - self._audit.vault_live_earmark())
        if max_capital <= 0.0:
            return self._reject(
                "buy", 0.0, last_price, "no deployable capital: vault earmark covers the cap"
            )
        exposure = self.exposure_usd(last_price)
        decision = size_entry(
            max_capital_usd=max_capital,
            per_strategy_capital_frac=self._cfg.risk.per_strategy_capital_frac,
            current_exposure_usd=exposure,
        )
        if decision.notional_usd <= 0.0:
            return self._reject("buy", 0.0, last_price, decision.reason)

        try:
            check_capital_cap(exposure, decision.notional_usd, max_capital)
        except CapitalCapExceeded as exc:
            return self._reject("buy", decision.notional_usd / last_price, last_price, str(exc))

        qty = self._rules.clamp_amount(decision.notional_usd / last_price)
        unfit = self._rules.reject_reason(qty, last_price)
        if unfit is not None:
            return self._reject("buy", qty, last_price, f"market rules: {unfit}")
        return self._execute("buy", qty, last_price, bar_time)

    def _sell(
        self, units: float, last_price: float, bar_time: pd.Timestamp, why: str
    ) -> LiveStep:
        qty = self._rules.clamp_amount(units)
        unfit = self._rules.reject_reason(qty, last_price)
        if unfit is not None:
            return self._reject("sell", qty, last_price, f"market rules (dust?): {unfit}")
        step = self._execute("sell", qty, last_price, bar_time, reason=why)
        if step.acted:
            return LiveStep(True, "sell", f"{step.detail} ({why})")
        return step

    def _execute(
        self,
        side: str,
        qty: float,
        last_price: float,
        bar_time: pd.Timestamp,
        reason: str | None = None,
    ) -> LiveStep:
        coid = client_order_id(self._scfg.name, bar_time, side)
        params = {"clientOrderId": coid}
        try:
            if side == "buy":
                response = self._client.create_market_buy_order(self._scfg.symbol, qty, params)
            else:
                response = self._client.create_market_sell_order(self._scfg.symbol, qty, params)
        except Exception as exc:  # noqa: BLE001 - every client failure must be audited
            self._consecutive_api_errors += 1
            self._audit.record(
                "api_error",
                {"error": str(exc), "side": side, "client_order_id": coid},
                strategy=self._scfg.name,
            )
            self._audit.record_order(
                mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
                symbol=self._scfg.symbol, side=side, qty=qty, price=last_price,
                status="error", reason=str(exc), client_order_id=coid,
            )
            return LiveStep(
                False,
                None,
                f"order error ({self._consecutive_api_errors} in a row): {exc}. "
                "If this order may have reached the exchange, run "
                "`quant-lab live reconcile` before the next entry.",
            )

        self._consecutive_api_errors = 0
        order_id = self._audit.record_order(
            mode="live", strategy=self._scfg.name, exchange=self._scfg.exchange,
            symbol=self._scfg.symbol, side=side, qty=qty, price=last_price,
            status="filled", client_order_id=coid, reason=reason,
        )
        fill_price = float(response.get("average") or response.get("price") or last_price)
        fill_qty = float(response.get("filled") or qty)
        fee_usd = float((response.get("fee") or {}).get("cost") or 0.0)
        self._audit.record_fill(
            order_id=order_id, mode="live", strategy=self._scfg.name,
            symbol=self._scfg.symbol, side=side, qty=fill_qty, price=fill_price,
            fee_usd=fee_usd,
        )
        if side == "buy":
            self._entry_price = fill_price
            self._entry_cost = fill_qty * fill_price + fee_usd
        else:
            proceeds_net = fill_qty * fill_price - fee_usd
            if (
                self._cfg.vault.enabled
                and self._entry_cost is not None
                and proceeds_net > self._entry_cost
            ):
                realized = proceeds_net - self._entry_cost
                skim = realized * self._cfg.vault.skim_pct / 100.0
                self._audit.vault_credit(
                    skim,
                    strategy=self._scfg.name,
                    mode="live",
                    ref_order_id=order_id,
                    note=f"{self._cfg.vault.skim_pct}% of ${realized:,.2f} win",
                )
                self._alerter.fill(
                    f"[LIVE] {self._scfg.name}: ${skim:,.2f} skimmed to vault "
                    f"({self._cfg.vault.skim_pct}% of ${realized:,.2f} win)"
                )
            self._entry_price = None
            self._entry_cost = None
        self._alerter.fill(
            f"[LIVE] {self._scfg.name}: {side} {fill_qty:.8f} {self._scfg.symbol} "
            f"@ {fill_price:.2f}, fee ${fee_usd:.2f}"
        )
        return LiveStep(True, side, f"{side} {fill_qty:.8f} @ {fill_price:.2f}")
