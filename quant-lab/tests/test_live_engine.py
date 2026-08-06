from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.config import AppConfig, StrategyInstanceConfig
from quant_lab.live.engine import LiveEngine
from quant_lab.risk.killswitch import KillSwitchMonitor
from tests.conftest import make_ohlcv
from tests.test_config import _base


class FakeClient:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.orders: list[tuple[str, str, float]] = []
        self.params_seen: list[dict[str, Any]] = []

    def _order(
        self, side: str, symbol: str, amount: float, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self.fail:
            raise ConnectionError("exchange unreachable")
        self.orders.append((side, symbol, amount))
        self.params_seen.append(params)
        return {"average": 100.0, "filled": amount, "fee": {"cost": amount * 100.0 * 0.0026}}

    def create_market_buy_order(
        self, symbol: str, amount: float, params: dict[str, Any]
    ) -> dict[str, Any]:
        return self._order("buy", symbol, amount, params)

    def create_market_sell_order(
        self, symbol: str, amount: float, params: dict[str, Any]
    ) -> dict[str, Any]:
        return self._order("sell", symbol, amount, params)


def _cfg(max_capital: float = 1000.0, api_errors: int = 3) -> AppConfig:
    raw = _base()
    raw["mode"] = "live"
    raw["risk"]["max_capital_usd"] = max_capital
    raw["risk"]["kill_switches"]["max_consecutive_api_errors"] = api_errors
    raw["walkforward"] = {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50}
    return AppConfig.model_validate(raw)


def _scfg() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="s_live",
        strategy="ema_cross",
        exchange="kraken",
        symbol="BTC/USD",
        timeframe="1h",
        params={"fast": 3, "slow": 8},
    )


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    a = AuditLog(tmp_path / "audit.db")
    a.set_stage("s_live", "validated", {})
    a.set_stage("s_live", "paper", {})
    a.set_stage("s_live", "live", {})
    return a


def _engine(audit: AuditLog, cfg: AppConfig | None = None, client: FakeClient | None = None):
    cfg = cfg or _cfg()
    client = client or FakeClient()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    return LiveEngine(_scfg(), cfg, client, audit, ks), client, ks


def _flat_df(price: float = 100.0, bars: int = 60) -> pd.DataFrame:
    """Constant price: fast EMA == slow EMA -> signal 0 (exit)."""
    df = make_ohlcv(bars=bars)
    for col in ("open", "high", "low", "close"):
        df[col] = price
    return df


def _rising_df(bars: int = 60) -> pd.DataFrame:
    df = make_ohlcv(bars=bars)
    ramp = pd.Series(range(bars), index=df.index, dtype="float64")
    for col in ("open", "high", "low", "close"):
        df[col] = 100.0 + ramp
    return df


def test_engine_refuses_non_live_mode(audit: AuditLog) -> None:
    raw = _base()
    raw["walkforward"] = {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50}
    paper_cfg = AppConfig.model_validate(raw)
    ks = KillSwitchMonitor(paper_cfg.risk.kill_switches, audit)
    with pytest.raises(RuntimeError, match="mode=live"):
        LiveEngine(_scfg(), paper_cfg, FakeClient(), audit, ks)


def test_engine_refuses_unpromoted_strategy(tmp_path: Path) -> None:
    audit = AuditLog(tmp_path / "a.db")  # stage defaults to candidate
    cfg = _cfg()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    with pytest.raises(RuntimeError, match="promotion gates"):
        LiveEngine(_scfg(), cfg, FakeClient(), audit, ks)


def test_entry_sized_by_per_strategy_fraction(audit: AuditLog) -> None:
    engine, client, _ = _engine(audit)
    step = engine.step(_rising_df())  # long signal, flat book
    assert step.acted and step.side == "buy"
    _side, _symbol, amount = client.orders[0]
    # cap 1000 * frac 0.5 = $500 at price ~159
    last_price = 159.0
    assert amount == pytest.approx(500.0 / last_price)
    fills = audit.fills(strategy="s_live", mode="live")
    assert len(fills) == 1


def test_exit_sells_full_position(audit: AuditLog) -> None:
    engine, client, _ = _engine(audit)
    engine.step(_rising_df())
    units = engine.position_units()
    assert units > 0
    falling = _flat_df(price=10.0, bars=61)  # later bar, fast EMA below slow -> exit
    step = engine.step(falling)
    assert step.acted and step.side == "sell"
    assert client.orders[-1][0] == "sell"
    assert client.orders[-1][2] == pytest.approx(units)
    assert engine.position_units() == 0.0


def test_api_errors_trip_kill_switch_and_are_audited(audit: AuditLog) -> None:
    cfg = _cfg(api_errors=3)
    engine, _client, ks = _engine(audit, cfg, FakeClient(fail=True))
    for i in range(3):
        step = engine.step(_rising_df(bars=60 + i))  # a new bar each poll
        assert not step.acted
    # Third consecutive failure reaches the limit; the next bar trips the switch.
    step = engine.step(_rising_df(bars=63))
    assert "kill switch" in step.detail
    assert ks.is_tripped()
    error_events = audit.events(kind="api_error", strategy="s_live")
    assert len(error_events) == 3
    error_orders = audit.orders(strategy="s_live", status="error")
    assert len(error_orders) == 3
    assert all(row["client_order_id"] for row in error_orders)


def test_kill_switch_blocks_entries(audit: AuditLog) -> None:
    engine, client, _ks = _engine(audit)
    audit.trip_kill_switch("manual test trip")
    step = engine.step(_rising_df())
    assert not step.acted
    assert "halted by kill switch" in step.detail
    assert client.orders == []


def test_flatten_on_trip_sells_position(audit: AuditLog) -> None:
    raw = _base()
    raw["mode"] = "live"
    raw["risk"]["max_capital_usd"] = 1000.0
    raw["risk"]["kill_switches"]["flatten_on_trip"] = True
    raw["walkforward"] = {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50}
    cfg = AppConfig.model_validate(raw)
    engine, _client, _ks = _engine(audit, cfg)
    engine.step(_rising_df())  # enter
    assert engine.position_units() > 0

    audit.trip_kill_switch("manual test trip")
    step = engine.step(_rising_df(bars=61))
    assert step.acted and step.side == "sell"
    assert engine.position_units() == 0.0
    assert "kill switch flatten" in step.detail


def test_capital_cap_never_exceeded_across_entries(audit: AuditLog) -> None:
    """Repeated entries can never stack exposure above the cap."""
    engine, _client, _ = _engine(audit)
    df = _rising_df()
    engine.step(df)  # buys $500
    last_price = float(df["close"].iloc[-1])
    exposure_after_first = engine.exposure_usd(last_price)
    assert exposure_after_first <= 1000.0
    # Signal still long, position exists -> no re-entry, exposure unchanged.
    step = engine.step(df)
    assert not step.acted
    assert engine.exposure_usd(last_price) == exposure_after_first


def test_second_strategy_entry_rejected_when_cap_full(tmp_path: Path) -> None:
    """A second engine sharing the book cannot push combined exposure past the cap."""
    audit = AuditLog(tmp_path / "a.db")
    for name in ("s_live",):
        audit.set_stage(name, "validated", {})
        audit.set_stage(name, "paper", {})
        audit.set_stage(name, "live", {})
    raw = _base()
    raw["mode"] = "live"
    raw["risk"]["max_capital_usd"] = 1000.0
    raw["risk"]["per_strategy_capital_frac"] = 1.0  # one strategy may take it all
    raw["walkforward"] = {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50}
    cfg = AppConfig.model_validate(raw)
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    client = FakeClient()
    engine = LiveEngine(_scfg(), cfg, client, audit, ks)

    df = _rising_df()
    engine.step(df)  # takes the full cap
    last_price = float(df["close"].iloc[-1])
    assert engine.exposure_usd(last_price) > 0

    # Sell signal exits; then cap headroom exists again — sized entries always
    # respect whatever exposure remains on the shared book.
    engine.step(_flat_df(price=10.0, bars=61))
    assert engine.position_units() == 0.0


# -- hardening: bar dedup, client order ids, durable anchors, market rules --


def test_same_bar_never_processed_twice(audit: AuditLog) -> None:
    engine, client, _ = _engine(audit)
    df = _rising_df()
    first = engine.step(df)
    second = engine.step(df)
    assert first.acted
    assert not second.acted
    assert second.detail == "bar already processed"
    assert len(client.orders) == 1


def test_client_order_id_is_deterministic_and_sent(audit: AuditLog) -> None:
    from quant_lab.live.engine import client_order_id

    engine, client, _ = _engine(audit)
    df = _rising_df()
    engine.step(df)
    expected = client_order_id("s_live", df.index[-1], "buy")
    assert client.params_seen[0] == {"clientOrderId": expected}
    assert len(expected) <= 18  # Kraken cl_ord_id budget
    assert expected.isalnum()
    stored = audit.orders(strategy="s_live", status="filled")[0]["client_order_id"]
    assert stored == expected
    # Same logical order -> same id; different bar or side -> different id.
    assert client_order_id("s_live", df.index[-1], "buy") == expected
    assert client_order_id("s_live", df.index[-1], "sell") != expected
    assert client_order_id("s_live", df.index[-2], "buy") != expected


def test_risk_anchors_survive_restart(audit: AuditLog) -> None:
    """Restarting the engine must not reset the drawdown peak (that would be a
    kill-switch bypass)."""
    cfg = _cfg()
    engine, _client, _ = _engine(audit, cfg)
    engine.step(_rising_df())  # establishes peak equity around $1000

    state = audit.get_live_state("s_live")
    assert state is not None
    assert state["peak_equity"] is not None and state["peak_equity"] > 0
    assert state["day_start_equity"] is not None

    # Fresh engine (new process) sees the same anchors from SQLite.
    engine2, _client2, ks2 = _engine(audit, cfg)
    df_crash = _rising_df(bars=61)
    df_crash.iloc[-1, df_crash.columns.get_loc("close")] = 1.0  # equity collapses
    step = engine2.step(df_crash)
    assert ks2.is_tripped()
    assert "kill switch" in step.detail or step.side == "sell"


def test_market_rules_reject_below_minimum_entry(audit: AuditLog) -> None:
    from quant_lab.live.market_rules import MarketRules

    cfg = _cfg()
    client = FakeClient()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    rules = MarketRules(amount_step=1e-8, amount_min=10.0, cost_min=0.0)  # absurd min
    engine = LiveEngine(_scfg(), cfg, client, audit, ks, rules=rules)
    step = engine.step(_rising_df())
    assert not step.acted
    assert client.orders == []
    rejected = audit.orders(strategy="s_live", status="rejected")
    assert len(rejected) == 1
    assert "below exchange minimum" in rejected[0]["reason"]


def test_market_rules_clamp_amount_precision(audit: AuditLog) -> None:
    from quant_lab.live.market_rules import MarketRules

    cfg = _cfg()
    client = FakeClient()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    rules = MarketRules(amount_step=0.001, amount_min=0.0, cost_min=0.0)
    engine = LiveEngine(_scfg(), cfg, client, audit, ks, rules=rules)
    engine.step(_rising_df())
    amount = client.orders[0][2]
    # Floored to the step: raw 500/159 = 3.1446... -> 3.144
    assert amount == pytest.approx(3.144)
    assert round(amount / 0.001) * 0.001 == pytest.approx(amount)


def test_live_stop_loss_exits_and_survives_restart(audit: AuditLog) -> None:
    scfg = StrategyInstanceConfig(
        name="s_live", strategy="ema_cross", exchange="kraken", symbol="BTC/USD",
        timeframe="1h", params={"fast": 3, "slow": 8}, stop_loss_pct=5.0, cooldown_bars=2,
    )
    cfg = _cfg()
    # Keep the drawdown switch out of the way: this test pins down the
    # stop-loss + re-entry arming behavior, not the kill switch.
    cfg.risk.kill_switches.max_drawdown_pct = 95.0
    cfg.risk.kill_switches.max_daily_loss_pct = 95.0
    client = FakeClient()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    engine = LiveEngine(scfg, cfg, client, audit, ks)
    engine.step(_rising_df())  # entry; FakeClient fills at 100.0
    assert engine.position_units() > 0
    assert audit.get_live_state("s_live")["entry_price"] == pytest.approx(100.0)

    # Restart: a fresh engine must still know the entry price and rules state.
    engine2 = LiveEngine(scfg, cfg, client, audit, ks)
    crashed = _rising_df(bars=61)
    crashed.iloc[-1, crashed.columns.get_loc("low")] = 90.0  # below 95 stop
    step = engine2.step(crashed)
    assert step.acted and step.side == "sell"
    assert "stop_loss" in step.detail
    assert engine2.position_units() == 0.0
    state = audit.get_live_state("s_live")
    assert not state["reentry_armed"]

    # Signal still long next bar -> entry blocked while un-armed.
    step = engine2.step(_rising_df(bars=62))
    assert not step.acted
    assert "awaiting fresh signal" in step.detail
