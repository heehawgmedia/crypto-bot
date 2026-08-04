"""Position reconciliation: audited book vs actual exchange balance.

The audit database is the bot's source of truth for what it owns. Before live
trading (and on demand), that book is checked against the exchange: the bot's
units must actually exist in the account. The account holding MORE than the
book is fine — those are the owner's own coins; holding LESS means fills were
lost, coins were withdrawn, or someone traded manually, and the engine must
not run until a human sorts it out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from quant_lab.audit.log import AuditLog
from quant_lab.config import StrategyInstanceConfig


class BalanceClient(Protocol):
    def fetch_balance(self) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ReconcileReport:
    strategy: str
    symbol: str
    audited_units: float
    exchange_units: float
    tolerance_units: float
    ok: bool
    detail: str


def audited_position_units(audit: AuditLog, strategy: str) -> float:
    units = 0.0
    for f in audit.fills(strategy=strategy, mode="live"):
        units += f["qty"] if f["side"] == "buy" else -f["qty"]
    return max(units, 0.0)


def _base_currency_total(balance: dict[str, Any], base: str) -> float:
    totals = balance.get("total")
    if isinstance(totals, dict) and base in totals:
        return float(totals[base] or 0.0)
    entry = balance.get(base)
    if isinstance(entry, dict):
        return float(entry.get("total") or 0.0)
    return 0.0


def reconcile_position(
    client: BalanceClient,
    audit: AuditLog,
    scfg: StrategyInstanceConfig,
    tolerance_frac: float,
) -> ReconcileReport:
    audited = audited_position_units(audit, scfg.name)
    base = scfg.symbol.split("/")[0]
    exchange_units = _base_currency_total(client.fetch_balance(), base)
    tolerance = audited * tolerance_frac
    ok = exchange_units >= audited - tolerance
    if ok:
        detail = (
            f"OK: book holds {audited:.10f} {base}, exchange reports "
            f"{exchange_units:.10f} {base}"
        )
    else:
        detail = (
            f"DRIFT: book holds {audited:.10f} {base} but exchange reports only "
            f"{exchange_units:.10f} {base} (tolerance {tolerance:.10f}). Fills may "
            "have been lost or funds moved manually — resolve on the exchange and "
            "in the audit log before trading."
        )
    report = ReconcileReport(
        strategy=scfg.name,
        symbol=scfg.symbol,
        audited_units=audited,
        exchange_units=exchange_units,
        tolerance_units=tolerance,
        ok=ok,
        detail=detail,
    )
    audit.record(
        "reconcile",
        {
            "ok": ok,
            "audited_units": audited,
            "exchange_units": exchange_units,
            "tolerance_units": tolerance,
        },
        strategy=scfg.name,
    )
    return report
