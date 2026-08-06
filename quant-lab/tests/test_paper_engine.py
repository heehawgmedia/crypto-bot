from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import StrategyInstanceConfig
from quant_lab.paper.engine import PaperEngine
from tests.conftest import make_ohlcv

COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)


class SpyAlerter:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def fill(self, text: str) -> None:
        self.messages.append(text)

    def kill_switch(self, text: str) -> None:
        self.messages.append(text)


def _scfg() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="ema_test",
        strategy="ema_cross",
        exchange="kraken",
        symbol="BTC/USD",
        timeframe="1h",
        params={"fast": 3, "slow": 8},
    )


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(tmp_path / "audit.db")


def _engine(audit: AuditLog, alerter: SpyAlerter | None = None) -> PaperEngine:
    return PaperEngine(_scfg(), COST, audit, 10_000.0, alerter)


def _trending_up(bars: int) -> pd.DataFrame:
    df = make_ohlcv(bars=bars, seed=1)
    ramp = pd.Series(range(bars), index=df.index) * 2.0
    for col in ("open", "high", "low", "close"):
        df[col] = 100.0 + ramp
    return df


def test_first_step_initializes_and_buys_on_long_signal(audit: AuditLog) -> None:
    alerter = SpyAlerter()
    engine = _engine(audit, alerter)
    df = _trending_up(50)  # rising: fast EMA > slow EMA -> long
    step = engine.step(df)

    assert step.acted and step.side == "buy"
    state = audit.get_paper_state("ema_test")
    assert state is not None
    assert state["cash_usd"] == 0.0
    assert state["units"] > 0.0
    fills = audit.fills(strategy="ema_test", mode="paper")
    assert len(fills) == 1
    assert fills[0]["side"] == "buy"
    # Fill priced off last close with slippage; fee on the cash deployed.
    last_close = float(df["close"].iloc[-1])
    assert fills[0]["price"] == pytest.approx(last_close * (1 + COST.slippage))
    assert fills[0]["fee_usd"] == pytest.approx(10_000.0 * COST.fee)
    assert len(alerter.messages) == 1
    assert "buy" in alerter.messages[0]


def test_same_bar_is_never_processed_twice(audit: AuditLog) -> None:
    engine = _engine(audit)
    df = _trending_up(50)
    first = engine.step(df)
    second = engine.step(df)  # identical frame: same last bar
    assert first.acted
    assert not second.acted
    assert second.detail == "bar already processed"
    assert len(audit.fills(strategy="ema_test")) == 1


def test_full_round_trip_and_state_survives_restart(audit: AuditLog) -> None:
    up = _trending_up(50)
    engine = _engine(audit)
    engine.step(up)

    # New engine instance (simulated process restart) sees durable state.
    engine2 = _engine(audit)
    down = up.copy()
    extra = make_ohlcv(bars=10, start="2024-01-03 02:00:00")
    for col in ("open", "high", "low", "close"):
        extra[col] = 60.0  # crash: fast EMA drops below slow
    down = pd.concat([down, extra])
    step = engine2.step(down)

    assert step.acted and step.side == "sell"
    fills = audit.fills(strategy="ema_test", mode="paper")
    assert [f["side"] for f in fills] == ["buy", "sell"]
    state = audit.get_paper_state("ema_test")
    assert state["units"] == 0.0
    assert state["cash_usd"] > 0.0


def test_no_trade_when_signal_unchanged(audit: AuditLog) -> None:
    engine = _engine(audit)
    df = _trending_up(50)
    engine.step(df)  # buys
    more = _trending_up(60)  # still long
    step = engine.step(more)
    assert not step.acted
    assert step.detail == "no position change"
    assert len(audit.fills(strategy="ema_test")) == 1


def test_paper_fees_and_slippage_are_charged_both_ways(audit: AuditLog) -> None:
    engine = _engine(audit)
    up = _trending_up(50)
    engine.step(up)
    extra = make_ohlcv(bars=10, start="2024-01-03 02:00:00")
    for col in ("open", "high", "low", "close"):
        extra[col] = 60.0
    engine.step(pd.concat([up, extra]))
    fills = audit.fills(strategy="ema_test")
    buy, sell = fills
    assert buy["fee_usd"] > 0
    assert sell["fee_usd"] > 0
    last = 60.0
    assert sell["price"] == pytest.approx(last * (1 - COST.slippage))


# -- trade rules in paper mode ----------------------------------------------


def _scfg_with_stops() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="ema_test",
        strategy="ema_cross",
        exchange="kraken",
        symbol="BTC/USD",
        timeframe="1h",
        params={"fast": 3, "slow": 8},
        stop_loss_pct=5.0,
        cooldown_bars=3,
    )


def test_paper_stop_loss_exit_and_no_instant_reentry(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg_with_stops(), COST, audit, 10_000.0)
    up = _trending_up(50)
    engine.step(up)  # buys; entry price recorded
    state = audit.get_paper_state("ema_test")
    assert state["entry_price"] is not None

    # Next bar crashes through the 5% stop but the trend signal stays long.
    crashed = _trending_up(51)
    entry = float(state["entry_price"])
    crashed.iloc[-1, crashed.columns.get_loc("low")] = entry * 0.90
    crashed.iloc[-1, crashed.columns.get_loc("close")] = entry * 0.999  # signal still long
    crashed.iloc[-1, crashed.columns.get_loc("open")] = entry
    step = engine.step(crashed)
    assert step.acted and step.side == "sell"
    assert "stop_loss" in step.detail

    sells = [o for o in audit.orders(strategy="ema_test") if o["side"] == "sell"]
    assert sells[0]["reason"] == "stop_loss"
    state = audit.get_paper_state("ema_test")
    assert not state["reentry_armed"]
    assert state["cooldown_until_utc"] is not None

    # Signal still long on the next bar -> blocked (not armed).
    still_up = _trending_up(52)
    step = engine.step(still_up)
    assert not step.acted
    assert audit.get_paper_state("ema_test")["units"] == 0.0
