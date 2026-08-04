from __future__ import annotations

import numpy as np
import pandas as pd
from pydantic import Field

from quant_lab.strategies.base import Strategy, StrategyParams


class DonchianParams(StrategyParams):
    entry_lookback: int = Field(gt=1)
    exit_lookback: int = Field(gt=1)


class Donchian(Strategy):
    """Breakout: long on a close above the prior entry-lookback high, exit on a
    close below the prior exit-lookback low.

    Channels use shift(1) so the breakout bar itself is never part of its own
    channel — comparing close(t) against a channel that includes bar t would
    be lookahead by construction.
    """

    name = "donchian"
    params_model = DonchianParams

    def signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.params
        assert isinstance(p, DonchianParams)
        upper = df["high"].rolling(p.entry_lookback).max().shift(1)
        lower = df["low"].rolling(p.exit_lookback).min().shift(1)
        raw = pd.Series(np.nan, index=df.index)
        raw[df["close"] > upper] = 1.0
        raw[df["close"] < lower] = 0.0
        return raw.ffill().fillna(0.0).astype("int64")

    @property
    def warmup_bars(self) -> int:
        p = self.params
        assert isinstance(p, DonchianParams)
        return max(p.entry_lookback, p.exit_lookback) + 1
