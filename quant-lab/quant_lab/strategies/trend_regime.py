from __future__ import annotations

import pandas as pd
from pydantic import Field, model_validator

from quant_lab.strategies.base import Strategy, StrategyParams


class TrendRegimeParams(StrategyParams):
    regime_len: int = Field(gt=10)  # long-term SMA regime filter
    fast: int = Field(gt=1)
    slow: int = Field(gt=1)

    @model_validator(mode="after")
    def _ordered(self) -> TrendRegimeParams:
        if self.fast >= self.slow:
            raise ValueError(f"fast ({self.fast}) must be < slow ({self.slow})")
        if self.slow >= self.regime_len:
            raise ValueError(
                f"slow ({self.slow}) must be < regime_len ({self.regime_len})"
            )
        return self


class TrendRegime(Strategy):
    """Trend following gated by a long-term regime filter.

    Long only when BOTH hold on the bar close:
      - regime: close above its long SMA (the market is in an uptrend at all)
      - trend: fast EMA above slow EMA (momentum currently agrees)

    Either condition failing exits. Designed for daily bars: the double
    condition trades a handful of times per year, so fees stay small, while
    still catching the large multi-month runs that make up most of BTC's
    long-term return.
    """

    name = "trend_regime"
    params_model = TrendRegimeParams

    def signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.params
        assert isinstance(p, TrendRegimeParams)
        close = df["close"]
        regime = close > close.rolling(p.regime_len).mean()
        trend = (
            close.ewm(span=p.fast, adjust=False).mean()
            > close.ewm(span=p.slow, adjust=False).mean()
        )
        return (regime & trend).astype("int64")

    @property
    def warmup_bars(self) -> int:
        p = self.params
        assert isinstance(p, TrendRegimeParams)
        return p.regime_len + 1
