from __future__ import annotations

from typing import Any

import pytest

from quant_lab.live.market_rules import (
    UNRESTRICTED,
    MarketRules,
    rules_from_ccxt,
)


def test_clamp_floors_to_step() -> None:
    rules = MarketRules(amount_step=0.001, amount_min=0.0, cost_min=0.0)
    assert rules.clamp_amount(3.14159) == pytest.approx(3.141)
    assert rules.clamp_amount(0.0009) == 0.0
    assert rules.clamp_amount(2.0) == pytest.approx(2.0)  # exact multiples untouched


def test_clamp_never_rounds_up() -> None:
    rules = MarketRules(amount_step=0.1, amount_min=0.0, cost_min=0.0)
    for qty in (0.19999, 0.10001, 0.999999):
        assert rules.clamp_amount(qty) <= qty


def test_unrestricted_passes_everything() -> None:
    assert UNRESTRICTED.clamp_amount(0.123456789) == 0.123456789
    assert UNRESTRICTED.reject_reason(1e-12, 0.01) is None


def test_reject_below_amount_min() -> None:
    rules = MarketRules(amount_step=1e-8, amount_min=0.0001, cost_min=0.0)
    assert rules.reject_reason(5e-5, 50_000.0) is not None
    assert rules.reject_reason(2e-4, 50_000.0) is None


def test_reject_below_cost_min() -> None:
    rules = MarketRules(amount_step=1e-8, amount_min=0.0, cost_min=10.0)
    assert "notional" in (rules.reject_reason(0.0001, 50_000.0) or "")  # $5 < $10
    assert rules.reject_reason(0.001, 50_000.0) is None  # $50 >= $10


def test_reject_zero_quantity() -> None:
    rules = MarketRules(amount_step=0.001, amount_min=0.0, cost_min=0.0)
    assert "zero" in (rules.reject_reason(0.0, 100.0) or "")


class FakeMarketsClient:
    def __init__(self, market: dict[str, Any]) -> None:
        self._market = market

    def load_markets(self) -> dict[str, Any]:
        return {"BTC/USD": self._market}


def test_rules_from_ccxt_step_style_precision() -> None:
    # ccxt 4.x kraken style: precision values are step sizes
    client = FakeMarketsClient(
        {
            "precision": {"amount": 1e-8, "price": 0.1},
            "limits": {"amount": {"min": 0.0001}, "cost": {"min": 0.5}},
        }
    )
    rules = rules_from_ccxt(client, "BTC/USD")
    assert rules.amount_step == pytest.approx(1e-8)
    assert rules.amount_min == pytest.approx(0.0001)
    assert rules.cost_min == pytest.approx(0.5)


def test_rules_from_ccxt_decimal_style_precision() -> None:
    # older style: precision values are decimal-place counts
    client = FakeMarketsClient(
        {"precision": {"amount": 8}, "limits": {"amount": {"min": None}, "cost": {}}}
    )
    rules = rules_from_ccxt(client, "BTC/USD")
    assert rules.amount_step == pytest.approx(1e-8)
    assert rules.amount_min == 0.0
    assert rules.cost_min == 0.0


def test_rules_from_ccxt_missing_metadata_is_permissive() -> None:
    rules = rules_from_ccxt(FakeMarketsClient({}), "BTC/USD")
    assert rules.amount_min == 0.0
    assert rules.cost_min == 0.0


def test_rules_from_ccxt_unknown_symbol() -> None:
    with pytest.raises(KeyError, match="not found"):
        rules_from_ccxt(FakeMarketsClient({}), "DOGE/USD")
