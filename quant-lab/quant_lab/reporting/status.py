"""Is the bot actually running, and is it allowed to trade?

Two independent facts, deliberately kept apart:

* **liveness** — a trading loop stamps a heartbeat every poll, so a stale
  stamp means nobody is watching the market, whatever the config says;
* **permission** — the durable run switch the owner flips from the dashboard
  or the CLI.

Reporting them as one word ("running") would hide the failure everyone cares
about: a bot that is switched on but not actually polling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from quant_lab.audit.log import AuditLog

# A loop counts as offline once it has missed this many poll intervals,
# floored so a fast interval does not make the status flicker.
_STALE_INTERVALS = 3.0
_STALE_FLOOR_S = 150.0


def stale_after_s(interval_s: float | None) -> float:
    return max(_STALE_FLOOR_S, _STALE_INTERVALS * float(interval_s or 0.0))


def humanize_age(seconds: float | None) -> str:
    if seconds is None:
        return "never"
    if seconds < 90:
        return f"{seconds:.0f}s ago"
    if seconds < 5400:
        return f"{seconds / 60:.0f}m ago"
    if seconds < 172_800:
        return f"{seconds / 3600:.1f}h ago"
    return f"{seconds / 86_400:.1f}d ago"


@dataclass(frozen=True)
class BotStatus:
    label: str  # Trading | Paused | Stopped | Offline
    tone: str  # good | warn | bad | idle
    detail: str
    trading_enabled: bool
    running: bool
    age_s: float | None
    reason: str | None

    def as_dict(self) -> dict[str, object]:
        return {
            "label": self.label,
            "tone": self.tone,
            "detail": self.detail,
            "trading_enabled": self.trading_enabled,
            "running": self.running,
            "age_s": self.age_s,
            "reason": self.reason,
        }


def bot_status(audit: AuditLog, scope: str = "paper", now: datetime | None = None) -> BotStatus:
    enabled, _changed, reason = audit.run_control()
    row = audit.heartbeat(scope)
    age = audit.heartbeat_age_s(scope, now=now)
    interval = float(row["interval_s"]) if row is not None and row["interval_s"] else None
    running = age is not None and age <= stale_after_s(interval)
    seen = f"last poll {humanize_age(age)}"

    if running and enabled:
        return BotStatus("Trading", "good", seen, enabled, running, age, reason)
    if running and not enabled:
        detail = "no new entries — open positions still exit on their rules"
        return BotStatus("Paused", "warn", detail, enabled, running, age, reason)
    if not enabled:
        return BotStatus(
            "Stopped", "idle", f"loop not polling · {seen}", enabled, running, age, reason
        )
    return BotStatus(
        "Offline",
        "bad",
        f"switched on but not polling · {seen}",
        enabled,
        running,
        age,
        reason,
    )
