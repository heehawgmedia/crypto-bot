from __future__ import annotations

import pandas as pd
from pydantic import Field, model_validator

from quant_lab.strategies.base import Strategy, StrategyParams


class EmaCrossParams(StrategyParams):
    fast: int = Field(gt=1)
    slow: int = Field(gt=1)

    @model_validator(mode="after")
    def _fast_below_slow(self) -> EmaCrossParams:
        if self.fast >= self.slow:
            raise ValueError(f"fast ({self.fast}) must be < slow ({self.slow})")
        return self


class EmaCross(Strategy):
    """Long while the fast EMA is above the slow EMA."""

    name = "ema_cross"
    params_model = EmaCrossParams

    def signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.params
        assert isinstance(p, EmaCrossParams)
        fast = df["close"].ewm(span=p.fast, adjust=False).mean()
        slow = df["close"].ewm(span=p.slow, adjust=False).mean()
        return (fast > slow).astype("int64")

    @property
    def warmup_bars(self) -> int:
        p = self.params
        assert isinstance(p, EmaCrossParams)
        return p.slow * 3
