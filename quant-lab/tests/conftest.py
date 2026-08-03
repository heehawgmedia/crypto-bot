from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


def make_ohlcv(
    start: str = "2024-01-01", bars: int = 100, timeframe: str = "1h", seed: int = 7
) -> pd.DataFrame:
    """Deterministic, integrity-clean OHLCV frame."""
    rng = np.random.default_rng(seed)
    index = pd.date_range(start=start, periods=bars, freq=timeframe.replace("m", "min"), tz="UTC")
    close = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, bars)))
    open_ = np.concatenate([[100.0], close[:-1]])
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.005, bars))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.005, bars))
    volume = rng.uniform(1, 50, bars)
    df = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index,
    )
    df.index.name = "timestamp"
    return df


@pytest.fixture
def ohlcv() -> pd.DataFrame:
    return make_ohlcv()
