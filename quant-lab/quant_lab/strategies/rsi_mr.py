from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import Field, model_validator

from quant_lab.strategies.base import Strategy, StrategyParams


class RsiMrParams(StrategyParams):
    period: int = Field(gt=1)
    oversold: float = Field(gt=0, lt=100)
    overbought: float = Field(gt=0, lt=100)

    @model_validator(mode="after")
    def _bands_ordered(self) -> RsiMrParams:
        if self.oversold >= self.overbought:
            raise ValueError(
                f"oversold ({self.oversold}) must be < overbought ({self.overbought})"
            )
        return self


def wilder_rsi(close: pd.Series, period: int) -> pd.Series:
    """Wilder RSI via smoothed moving average (causal: ewm looks backward only)."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    return rsi.fillna(50.0)


class RsiMr(Strategy):
    """Mean reversion: buy when RSI dips below oversold, exit above overbought."""

    name = "rsi_mr"
    params_model = RsiMrParams

    def signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.params
        assert isinstance(p, RsiMrParams)
        rsi = wilder_rsi(df["close"], p.period)
        raw = pd.Series(np.nan, index=df.index)
        raw[rsi < p.oversold] = 1.0
        raw[rsi > p.overbought] = 0.0
        return raw.ffill().fillna(0.0).astype("int64")

    @property
    def warmup_bars(self) -> int:
        p = self.params
        assert isinstance(p, RsiMrParams)
        return p.period * 5
