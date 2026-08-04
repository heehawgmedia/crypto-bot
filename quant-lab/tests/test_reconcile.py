from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.config import StrategyInstanceConfig
from quant_lab.live.reconcile import audited_position_units, reconcile_position


class FakeBalanceClient:
    def __init__(self, totals: dict[str, float]) -> None:
        self._totals = totals

    def fetch_balance(self) -> dict[str, Any]:
        return {"total": dict(self._totals)}


def _scfg() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="s1", strategy="ema_cross", exchange="kraken", symbol="BTC/USD",
        timeframe="1h", params={"fast": 3, "slow": 8},
    )


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(tmp_path / "a.db")


def _record_buy(audit: AuditLog, qty: float) -> None:
    order_id = audit.record_order(
        mode="live", strategy="s1", exchange="kraken", symbol="BTC/USD",
        side="buy", qty=qty, price=50_000.0, status="filled",
    )
    audit.record_fill(
        order_id=order_id, mode="live", strategy="s1", symbol="BTC/USD",
        side="buy", qty=qty, price=50_000.0, fee_usd=1.0,
    )


def test_audited_position_from_fills(audit: AuditLog) -> None:
    assert audited_position_units(audit, "s1") == 0.0
    _record_buy(audit, 0.02)
    assert audited_position_units(audit, "s1") == pytest.approx(0.02)


def test_reconcile_ok_when_exchange_holds_book(audit: AuditLog) -> None:
    _record_buy(audit, 0.02)
    report = reconcile_position(
        FakeBalanceClient({"BTC": 0.02}), audit, _scfg(), tolerance_frac=0.01
    )
    assert report.ok
    assert "OK" in report.detail


def test_reconcile_ok_when_exchange_holds_more_than_book(audit: AuditLog) -> None:
    """User's personal coins in the same account are not drift."""
    _record_buy(audit, 0.02)
    report = reconcile_position(
        FakeBalanceClient({"BTC": 1.5}), audit, _scfg(), tolerance_frac=0.01
    )
    assert report.ok


def test_reconcile_detects_missing_funds(audit: AuditLog) -> None:
    _record_buy(audit, 0.02)
    report = reconcile_position(
        FakeBalanceClient({"BTC": 0.005}), audit, _scfg(), tolerance_frac=0.01
    )
    assert not report.ok
    assert "DRIFT" in report.detail
    # The reconcile itself lands in the audit trail.
    events = audit.events(kind="reconcile", strategy="s1")
    assert len(events) == 1


def test_reconcile_tolerates_dust_shortfall(audit: AuditLog) -> None:
    _record_buy(audit, 1.0)
    report = reconcile_position(
        FakeBalanceClient({"BTC": 0.995}), audit, _scfg(), tolerance_frac=0.01
    )
    assert report.ok  # 0.5% short, within 1% tolerance


def test_reconcile_flat_book_always_ok(audit: AuditLog) -> None:
    report = reconcile_position(
        FakeBalanceClient({}), audit, _scfg(), tolerance_frac=0.01
    )
    assert report.ok
    assert report.audited_units == 0.0
