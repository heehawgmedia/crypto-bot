from __future__ import annotations

import json
from pathlib import Path

import pytest

from quant_lab.audit.log import AuditLog


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(tmp_path / "audit.db")


def test_events_have_utc_timestamps(audit: AuditLog) -> None:
    audit.record("config_change", {"field": "slippage_bps", "old": 10, "new": 12})
    rows = audit.events(kind="config_change")
    assert len(rows) == 1
    from datetime import datetime

    ts = datetime.fromisoformat(rows[0]["ts_utc"])
    assert ts.tzinfo is not None
    assert ts.utcoffset().total_seconds() == 0  # UTC
    assert json.loads(rows[0]["payload"])["field"] == "slippage_bps"


def test_orders_and_fills_roundtrip(audit: AuditLog) -> None:
    order_id = audit.record_order(
        mode="paper", strategy="s1", exchange="kraken", symbol="BTC/USD",
        side="buy", qty=0.01, price=50_000.0, status="filled",
    )
    audit.record_fill(
        order_id=order_id, mode="paper", strategy="s1", symbol="BTC/USD",
        side="buy", qty=0.01, price=50_050.0, fee_usd=1.30,
    )
    fills = audit.fills(strategy="s1", mode="paper")
    assert len(fills) == 1
    assert fills[0]["order_id"] == order_id
    assert fills[0]["price"] == 50_050.0
    assert audit.fills(strategy="other") == []


def test_stage_defaults_to_candidate(audit: AuditLog) -> None:
    assert audit.get_stage("never_seen") == "candidate"


def test_stage_promotion_records_event_and_paper_clock(audit: AuditLog) -> None:
    audit.set_stage("s1", "validated", {"windows": 4})
    assert audit.get_stage("s1") == "validated"
    assert audit.paper_started_at("s1") is None

    audit.set_stage("s1", "paper", {})
    started = audit.paper_started_at("s1")
    assert started is not None
    assert started.tzinfo is not None

    # Promotion to live must not clobber the paper start time.
    audit.set_stage("s1", "live", {})
    assert audit.paper_started_at("s1") == started

    kinds = [row["kind"] for row in audit.events(strategy="s1")]
    assert kinds.count("promotion") == 3


def test_paper_state_roundtrip(audit: AuditLog) -> None:
    assert audit.get_paper_state("s1") is None
    audit.set_paper_state("s1", cash_usd=9_000.0, units=0.02, last_bar_utc="2024-01-01T00:00:00+00:00")
    state = audit.get_paper_state("s1")
    assert state is not None
    assert state["cash_usd"] == 9_000.0
    assert state["units"] == 0.02


def test_kill_switch_latch_and_reset(audit: AuditLog) -> None:
    assert audit.kill_switch_state() == (False, None, None)
    audit.trip_kill_switch("max_daily_loss_pct breached: -3.4%")
    tripped, reason, tripped_ts = audit.kill_switch_state()
    assert tripped
    assert reason is not None and "max_daily_loss_pct" in reason
    assert tripped_ts is not None

    # A second connection sees the latch (it's durable, not in-memory).
    tripped2, _, _ = audit.kill_switch_state()
    assert tripped2

    audit.reset_kill_switch(confirmed_by="cli")
    assert audit.kill_switch_state() == (False, None, None)
    kinds = [row["kind"] for row in audit.events()]
    assert "kill_switch_trip" in kinds
    assert "kill_switch_reset" in kinds
