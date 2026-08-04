"""Exchange market rules: amount precision, minimum size, minimum notional.

Kraken (and every real exchange) rejects orders that violate lot rules. Worse,
some reject in ways that count against rate limits. So order quantities are
floored to the exchange's amount step and checked against minimums *before*
anything is submitted; unfit orders are audited as rejections locally.

Rules come from ccxt's ``load_markets()`` metadata but are held in a plain
dataclass so tests (and paper mode) can inject exact values.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Protocol


class MarketsClient(Protocol):
    def load_markets(self) -> dict[str, Any]: ...


@dataclass(frozen=True)
class MarketRules:
    amount_step: float  # order quantity granularity (e.g. 1e-8 BTC)
    amount_min: float  # minimum order quantity in base units
    cost_min: float  # minimum order notional in quote currency (0 = none)

    def clamp_amount(self, qty: float) -> float:
        """Floor qty to the amount step (never rounds up — no oversized orders)."""
        if qty <= 0.0 or self.amount_step <= 0.0:
            return max(qty, 0.0)
        steps = math.floor(qty / self.amount_step + 1e-12)
        return steps * self.amount_step

    def reject_reason(self, qty: float, price: float) -> str | None:
        """Why this order can't be submitted, or None if it's fine."""
        if qty <= 0.0:
            return "quantity is zero after precision clamping"
        if qty < self.amount_min:
            return f"quantity {qty:.10f} below exchange minimum {self.amount_min:.10f}"
        if self.cost_min > 0.0 and qty * price < self.cost_min:
            return (
                f"notional ${qty * price:,.2f} below exchange minimum "
                f"${self.cost_min:,.2f}"
            )
        return None


#: Permissive fallback when exchange metadata is unavailable (paper/tests).
UNRESTRICTED = MarketRules(amount_step=0.0, amount_min=0.0, cost_min=0.0)


def _precision_to_step(value: float | None) -> float:
    """ccxt precision is either a step size (0.0001) or a decimal count (4)."""
    if value is None:
        return 0.0
    v = float(value)
    if v <= 0.0:
        return 1.0 if v == 0.0 else 0.0
    if v >= 1.0 and v.is_integer():
        return 10.0 ** -int(v)
    return v


def rules_from_ccxt(client: MarketsClient, symbol: str) -> MarketRules:
    markets = client.load_markets()
    if symbol not in markets:
        raise KeyError(f"symbol {symbol!r} not found on exchange")
    market = markets[symbol]
    precision = market.get("precision") or {}
    limits = market.get("limits") or {}
    amount_limits = limits.get("amount") or {}
    cost_limits = limits.get("cost") or {}
    return MarketRules(
        amount_step=_precision_to_step(precision.get("amount")),
        amount_min=float(amount_limits.get("min") or 0.0),
        cost_min=float(cost_limits.get("min") or 0.0),
    )
