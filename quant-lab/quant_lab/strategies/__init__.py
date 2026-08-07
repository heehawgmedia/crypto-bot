"""Strategy registry. All strategies plug in through the same base class."""

from __future__ import annotations

from typing import Any

from quant_lab.strategies.base import Strategy, StrategyParams
from quant_lab.strategies.donchian import Donchian
from quant_lab.strategies.ema_cross import EmaCross
from quant_lab.strategies.rsi_mr import RsiMr
from quant_lab.strategies.trend_regime import TrendRegime

REGISTRY: dict[str, type[Strategy]] = {
    cls.name: cls for cls in (EmaCross, RsiMr, Donchian, TrendRegime)
}

__all__ = ["REGISTRY", "Strategy", "StrategyParams", "build_strategy"]


def build_strategy(name: str, params: dict[str, Any]) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy {name!r}; available: {sorted(REGISTRY)}")
    return REGISTRY[name](**params)
