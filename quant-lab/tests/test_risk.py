from __future__ import annotations

from pathlib import Path

import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.config import KillSwitchConfig
from quant_lab.risk.killswitch import KillSwitchMonitor, RiskSnapshot
from quant_lab.risk.sizing import CapitalCapExceeded, check_capital_cap, size_entry

# -- capital cap -----------------------------------------------------------


def test_cap_rejects_order_pushing_exposure_over() -> None:
    with pytest.raises(CapitalCapExceeded, match="max_capital_usd"):
        check_capital_cap(
            current_exposure_usd=900.0, order_notional_usd=200.0, max_capital_usd=1000.0
        )


def test_cap_allows_order_at_or_below_cap() -> None:
    check_capital_cap(900.0, 100.0, 1000.0)
    check_capital_cap(0.0, 1000.0, 1000.0)


def test_size_entry_respects_per_strategy_fraction() -> None:
    d = size_entry(max_capital_usd=1000.0, per_strategy_capital_frac=0.5, current_exposure_usd=0.0)
    assert d.notional_usd == 500.0


def test_size_entry_shrinks_to_headroom() -> None:
    d = size_entry(max_capital_usd=1000.0, per_strategy_capital_frac=0.5, current_exposure_usd=800.0)
    assert d.notional_usd == 200.0


def test_size_entry_zero_when_cap_utilized() -> None:
    d = size_entry(max_capital_usd=1000.0, per_strategy_capital_frac=0.5, current_exposure_usd=1000.0)
    assert d.notional_usd == 0.0
    assert "headroom" in d.reason


def test_sized_entry_always_passes_cap_check() -> None:
    for exposure in (0.0, 300.0, 999.0):
        d = size_entry(
            max_capital_usd=1000.0, per_strategy_capital_frac=0.9, current_exposure_usd=exposure
        )
        if d.notional_usd > 0:
            check_capital_cap(exposure, d.notional_usd, 1000.0)  # must not raise


# -- kill switches ---------------------------------------------------------

KS_CFG = KillSwitchConfig(
    max_daily_loss_pct=3.0, max_drawdown_pct=10.0, max_consecutive_api_errors=5
)


@pytest.fixture
def monitor(tmp_path: Path) -> KillSwitchMonitor:
    return KillSwitchMonitor(KS_CFG, AuditLog(tmp_path / "audit.db"))


def _snap(
    equity: float = 100.0,
    day_start: float = 100.0,
    peak: float = 100.0,
    api_errors: int = 0,
) -> RiskSnapshot:
    return RiskSnapshot(
        equity_usd=equity,
        day_start_equity_usd=day_start,
        peak_equity_usd=peak,
        consecutive_api_errors=api_errors,
    )


def test_healthy_snapshot_does_not_trip(monitor: KillSwitchMonitor) -> None:
    assert monitor.observe(_snap()) is None
    assert not monitor.is_tripped()


def test_daily_loss_trips(monitor: KillSwitchMonitor) -> None:
    reason = monitor.observe(_snap(equity=96.9, day_start=100.0))
    assert reason is not None and "max_daily_loss_pct" in reason
    assert monitor.is_tripped()


def test_drawdown_from_peak_trips(monitor: KillSwitchMonitor) -> None:
    reason = monitor.observe(_snap(equity=89.9, day_start=90.0, peak=100.0))
    assert reason is not None and "max_drawdown_pct" in reason


def test_api_errors_trip(monitor: KillSwitchMonitor) -> None:
    assert monitor.observe(_snap(api_errors=4)) is None
    reason = monitor.observe(_snap(api_errors=5))
    assert reason is not None and "max_consecutive_api_errors" in reason


def test_trip_latches_until_manual_reset(tmp_path: Path) -> None:
    audit = AuditLog(tmp_path / "audit.db")
    monitor = KillSwitchMonitor(KS_CFG, audit)
    monitor.observe(_snap(equity=50.0))
    assert monitor.is_tripped()

    # A perfectly healthy snapshot cannot clear the latch.
    reason = monitor.observe(_snap())
    assert reason is not None
    assert monitor.is_tripped()

    # A fresh monitor over the same DB still sees the latch (durability).
    monitor2 = KillSwitchMonitor(KS_CFG, audit)
    assert monitor2.is_tripped()

    monitor2.reset(confirmed_by="cli")
    assert not monitor2.is_tripped()
    assert monitor2.observe(_snap()) is None
