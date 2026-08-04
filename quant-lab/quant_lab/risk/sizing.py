"""Position sizing and the capital cap.

The capital cap is a hard precondition checked before any order reaches an
exchange: if projected total exposure would exceed ``max_capital_usd``, the
order is rejected outright — there is no partial fill down to the cap and no
override. Spot only: no leverage, no margin, no shorts.
"""

from __future__ import annotations

from dataclasses import dataclass


class CapitalCapExceeded(Exception):
    pass


@dataclass(frozen=True)
class SizingDecision:
    notional_usd: float
    reason: str


def check_capital_cap(
    current_exposure_usd: float, order_notional_usd: float, max_capital_usd: float
) -> None:
    """Raise CapitalCapExceeded if the order would push exposure above the cap."""
    projected = current_exposure_usd + order_notional_usd
    if projected > max_capital_usd:
        raise CapitalCapExceeded(
            f"order of ${order_notional_usd:,.2f} would push total exposure to "
            f"${projected:,.2f}, above the max_capital_usd cap of ${max_capital_usd:,.2f}"
        )


def size_entry(
    *,
    max_capital_usd: float,
    per_strategy_capital_frac: float,
    current_exposure_usd: float,
) -> SizingDecision:
    """Notional for a new entry: the per-strategy slice, shrunk to whatever
    room remains under the cap. Zero when the cap is fully utilized."""
    per_strategy = max_capital_usd * per_strategy_capital_frac
    headroom = max(0.0, max_capital_usd - current_exposure_usd)
    notional = min(per_strategy, headroom)
    if notional <= 0.0:
        return SizingDecision(0.0, "no capital headroom under max_capital_usd")
    return SizingDecision(notional, f"per-strategy slice ${per_strategy:,.2f}, headroom ${headroom:,.2f}")
