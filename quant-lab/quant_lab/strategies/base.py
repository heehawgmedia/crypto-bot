"""Strategy base class.

A strategy is a pure signal generator: given OHLCV history it emits a target
position per bar (1 = long, 0 = flat; spot only, so shorts don't exist).
It contains zero execution logic — fills, fees, sizing, and risk live
elsewhere.

Causality contract: the signal value at bar t may depend only on bars <= t.
The no-lookahead test suite enforces this for every registered strategy.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

import pandas as pd
from pydantic import BaseModel, ConfigDict


class StrategyParams(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Strategy(ABC):
    name: ClassVar[str]
    params_model: ClassVar[type[StrategyParams]]

    def __init__(self, **params: Any) -> None:
        self.params = self.params_model(**params)

    @abstractmethod
    def signals(self, df: pd.DataFrame) -> pd.Series:
        """Target position per bar close: 1 long, 0 flat. Index-aligned to df."""

    @property
    def warmup_bars(self) -> int:
        """Bars needed before signals are meaningful (indicator warmup)."""
        return 1
