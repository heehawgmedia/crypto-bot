"""Kill switches.

Three independent trips: max daily loss %, max drawdown from equity peak %,
and max consecutive API errors. A trip latches durably (SQLite) and disables
all new entries until a human resets it via `quant-lab risk reset` — nothing
in the engines can clear it. Optionally the trip also flattens positions.
"""

from __future__ import annotations

from dataclasses import dataclass

from quant_lab.audit.log import AuditLog
from quant_lab.config import KillSwitchConfig


@dataclass(frozen=True)
class RiskSnapshot:
    equity_usd: float
    day_start_equity_usd: float
    peak_equity_usd: float
    consecutive_api_errors: int


class KillSwitchMonitor:
    def __init__(self, cfg: KillSwitchConfig, audit: AuditLog) -> None:
        self._cfg = cfg
        self._audit = audit

    @property
    def flatten_on_trip(self) -> bool:
        return self._cfg.flatten_on_trip

    def is_tripped(self) -> bool:
        tripped, _, _ = self._audit.kill_switch_state()
        return tripped

    def state(self) -> tuple[bool, str | None, str | None]:
        return self._audit.kill_switch_state()

    def observe(self, snapshot: RiskSnapshot) -> str | None:
        """Evaluate the snapshot; trip (and latch) on the first breach found.

        Returns the trip reason, or None. Once tripped, stays tripped — this
        method never un-trips anything.
        """
        if self.is_tripped():
            _, reason, _ = self._audit.kill_switch_state()
            return reason

        reason = self._breach(snapshot)
        if reason is not None:
            self._audit.trip_kill_switch(reason)
        return reason

    def _breach(self, s: RiskSnapshot) -> str | None:
        if s.day_start_equity_usd > 0:
            daily_loss_pct = (1.0 - s.equity_usd / s.day_start_equity_usd) * 100.0
            if daily_loss_pct >= self._cfg.max_daily_loss_pct:
                return (
                    f"max_daily_loss_pct breached: down {daily_loss_pct:.2f}% today "
                    f"(limit {self._cfg.max_daily_loss_pct}%)"
                )
        if s.peak_equity_usd > 0:
            drawdown_pct = (1.0 - s.equity_usd / s.peak_equity_usd) * 100.0
            if drawdown_pct >= self._cfg.max_drawdown_pct:
                return (
                    f"max_drawdown_pct breached: {drawdown_pct:.2f}% below equity peak "
                    f"(limit {self._cfg.max_drawdown_pct}%)"
                )
        if s.consecutive_api_errors >= self._cfg.max_consecutive_api_errors:
            return (
                f"max_consecutive_api_errors breached: {s.consecutive_api_errors} in a row "
                f"(limit {self._cfg.max_consecutive_api_errors})"
            )
        return None

    def reset(self, confirmed_by: str) -> None:
        """Manual reset — only the CLI calls this, never an engine."""
        self._audit.reset_kill_switch(confirmed_by)
