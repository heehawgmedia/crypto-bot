"""The manual run switch: durability, audit trail, and what it does NOT stop.

The switch is the dashboard's Stop button and `quant-lab pause`. Its contract:
it halts new entries and nothing else, so an open position never loses its
stop-loss because somebody paused the bot.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import StrategyInstanceConfig
from quant_lab.paper.engine import PaperEngine
from quant_lab.reporting.status import bot_status, humanize_age, stale_after_s
from tests.conftest import make_ohlcv

COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(tmp_path / "audit.db")


def _scfg(**extra: object) -> StrategyInstanceConfig:
    base: dict[str, object] = {
        "name": "ctrl_test",
        "strategy": "ema_cross",
        "exchange": "kraken",
        "symbol": "BTC/USD",
        "timeframe": "1h",
        "params": {"fast": 3, "slow": 8},
    }
    return StrategyInstanceConfig.model_validate(base | extra)


def _rising(bars: int = 40) -> pd.DataFrame:
    """A frame whose EMA cross is unambiguously long at the final bar."""
    df = make_ohlcv(bars=bars)
    ramp = pd.Series(range(bars), index=df.index) * 2.0
    for col in ("open", "high", "low", "close"):
        df[col] = 100.0 + ramp
    df["high"] += 1.0
    df["low"] -= 1.0
    return df


# -- the switch itself -----------------------------------------------------


def test_defaults_to_enabled_and_round_trips(audit: AuditLog) -> None:
    assert audit.trading_enabled() is True

    assert audit.set_trading_enabled(False, actor="cli", reason="going on holiday") is True
    enabled, changed_utc, reason = audit.run_control()
    assert enabled is False
    assert reason == "going on holiday"
    assert changed_utc is not None

    # Idempotent: setting the same value again is not a state change.
    assert audit.set_trading_enabled(False, actor="cli") is False
    assert audit.set_trading_enabled(True, actor="dashboard") is True
    assert audit.trading_enabled() is True


def test_switch_survives_reopening_the_database(tmp_path: Path) -> None:
    """A stopped bot must stay stopped across a restart or reboot."""
    path = tmp_path / "audit.db"
    first = AuditLog(path)
    first.set_trading_enabled(False, actor="dashboard")
    first.close()

    assert AuditLog(path).trading_enabled() is False


def test_state_changes_are_audited(audit: AuditLog) -> None:
    audit.set_trading_enabled(False, actor="dashboard", reason="market looks wild")
    audit.set_trading_enabled(False, actor="dashboard")  # no-op, no event
    audit.set_trading_enabled(True, actor="cli")

    kinds = [row["kind"] for row in audit.events()]
    assert kinds == ["trading_paused", "trading_resumed"]
    paused = audit.events(kind="trading_paused")[0]
    assert "market looks wild" in str(paused["payload"])
    assert "dashboard" in str(paused["payload"])


# -- what pausing does to the paper engine ---------------------------------


def test_pause_blocks_new_entries(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0)
    audit.set_trading_enabled(False, actor="test")

    step = engine.step(_rising())

    assert step.acted is False
    assert step.side is None
    assert "paused" in step.detail
    assert audit.fills() == []


def test_resuming_does_not_backfill_the_missed_bar(audit: AuditLog) -> None:
    """Bars seen while paused are marked processed, so resuming trades from
    now on rather than replaying an entry the owner was not there for."""
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0)
    df = _rising()
    audit.set_trading_enabled(False, actor="test")
    engine.step(df)

    audit.set_trading_enabled(True, actor="test")
    again = engine.step(df)  # same final bar

    assert again.acted is False
    assert again.detail == "bar already processed"
    assert audit.fills() == []

    # The next bar is fair game.
    nxt = _rising(bars=41)
    assert engine.step(nxt).side == "buy"


def test_pause_still_lets_a_stop_loss_fire(audit: AuditLog) -> None:
    """The whole point: pausing must never strand a position without its stop."""
    engine = PaperEngine(_scfg(stop_loss_pct=5.0), COST, audit, 10_000.0)
    entry = engine.step(_rising())
    assert entry.side == "buy"

    audit.set_trading_enabled(False, actor="test")
    crashed = _rising(bars=41)
    crashed.iloc[-1, crashed.columns.get_loc("low")] = 1.0  # blows through the stop
    crashed.iloc[-1, crashed.columns.get_loc("close")] = 2.0

    exit_step = engine.step(crashed)

    assert exit_step.side == "sell"
    assert "stop_loss" in exit_step.detail
    assert [f["side"] for f in audit.fills()] == ["buy", "sell"]


def test_pause_still_lets_a_signal_exit_fire(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0)
    assert engine.step(_rising()).side == "buy"

    audit.set_trading_enabled(False, actor="test")
    falling = _rising(bars=60)
    falling.loc[falling.index[40:], ["open", "high", "low", "close"]] = 50.0

    assert engine.step(falling).side == "sell"


# -- liveness --------------------------------------------------------------


def test_heartbeat_records_and_ages(audit: AuditLog) -> None:
    assert audit.heartbeat("paper") is None
    assert audit.heartbeat_age_s("paper") is None

    audit.beat("paper", interval_s=60.0, detail="2 strategies")
    row = audit.heartbeat("paper")
    assert row is not None
    assert row["interval_s"] == 60.0
    assert row["pid"] > 0
    assert (audit.heartbeat_age_s("paper") or 0.0) < 5.0

    later = datetime.now(UTC) + timedelta(minutes=10)
    assert (audit.heartbeat_age_s("paper", now=later) or 0.0) > 590.0


def test_beat_upserts_rather_than_appending(audit: AuditLog) -> None:
    audit.beat("paper", interval_s=60.0)
    audit.beat("paper", interval_s=3600.0, detail="second")
    rows = list(audit._conn.execute("SELECT * FROM heartbeat"))
    assert len(rows) == 1
    assert rows[0]["detail"] == "second"


def test_revision_bumps_only_on_real_activity(audit: AuditLog) -> None:
    before = audit.revision()
    audit.beat("paper")  # liveness is not activity
    assert audit.revision() == before

    audit.record("something_happened", {})
    assert audit.revision() == before + 1


@pytest.mark.parametrize(
    ("interval", "expected"),
    [(None, 150.0), (10.0, 150.0), (60.0, 180.0), (3600.0, 10_800.0)],
)
def test_stale_threshold_scales_with_poll_interval(interval: float | None, expected: float) -> None:
    assert stale_after_s(interval) == expected


def test_humanize_age_units() -> None:
    assert humanize_age(None) == "never"
    assert humanize_age(12.0) == "12s ago"
    assert humanize_age(600.0) == "10m ago"
    assert humanize_age(7200.0) == "2.0h ago"
    assert humanize_age(259_200.0) == "3.0d ago"


# -- the four states a reader can see --------------------------------------


def test_status_trading_when_fresh_and_enabled(audit: AuditLog) -> None:
    audit.beat("paper", interval_s=60.0)
    status = bot_status(audit)
    assert (status.label, status.tone) == ("Trading", "good")
    assert status.running is True


def test_status_paused_when_fresh_but_switched_off(audit: AuditLog) -> None:
    audit.beat("paper", interval_s=60.0)
    audit.set_trading_enabled(False, actor="test")
    status = bot_status(audit)
    assert (status.label, status.tone) == ("Paused", "warn")
    assert "still exit" in status.detail


def test_status_offline_when_switched_on_but_not_polling(audit: AuditLog) -> None:
    """The failure that matters: configured to trade, nobody actually looking."""
    audit.beat("paper", interval_s=60.0)
    stale = datetime.now(UTC) + timedelta(hours=2)
    status = bot_status(audit, now=stale)
    assert (status.label, status.tone) == ("Offline", "bad")
    assert status.running is False


def test_status_stopped_when_neither_running_nor_enabled(audit: AuditLog) -> None:
    audit.set_trading_enabled(False, actor="test")
    status = bot_status(audit)
    assert (status.label, status.tone) == ("Stopped", "idle")


def test_a_running_loop_sees_a_pause_made_on_another_connection(tmp_path: Path) -> None:
    """The linchpin of the Stop button.

    The dashboard writes the switch on its own SQLite connection while the
    trading loop holds a long-lived one opened before the click. If that
    connection did not observe the commit, Stop would appear to work and the
    bot would keep buying.
    """
    path = tmp_path / "audit.db"
    loop_conn = AuditLog(path)
    engine = PaperEngine(_scfg(), COST, loop_conn, 10_000.0)
    assert loop_conn.trading_enabled() is True

    dashboard_conn = AuditLog(path)
    dashboard_conn.set_trading_enabled(False, actor="dashboard")

    assert loop_conn.trading_enabled() is False
    assert engine.step(_rising()).side is None
    assert loop_conn.fills() == []
