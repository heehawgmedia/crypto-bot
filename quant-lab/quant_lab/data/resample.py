"""Derive coarser timeframes from finer ones (e.g. 4h candles from 1h).

Exchanges disagree about which granularities they serve (coinbase has no 4h),
so timeframes an exchange can't provide are built locally from a finer one:
open = first, high = max, low = min, close = last, volume = sum, buckets
aligned to UTC midnight. Only buckets whose full period is covered by source
data are emitted — a trailing half-full bucket would repaint on the next
update, which is exactly the forming-candle contamination this system bans.
"""

from __future__ import annotations

from collections.abc import Hashable, Mapping
from typing import cast

import pandas as pd

from quant_lab.data.store import OHLCV_COLUMNS, ParquetStore
from quant_lab.data.timeframes import timeframe_to_ms

_AGG: Mapping[Hashable, str] = {
    "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"
}


_PANDAS_UNITS = {"m": "min", "h": "h", "d": "D", "w": "W"}


def _pandas_rule(timeframe: str) -> str:
    # Our notation is 15m/1h/4h/1d/1w; pandas wants 15min/1h/4h/1D/1W.
    return timeframe[:-1] + _PANDAS_UNITS[timeframe[-1]]


def resample_ohlcv(df: pd.DataFrame, source_tf: str, target_tf: str) -> pd.DataFrame:
    """Aggregate ``df`` (bars of ``source_tf``) into ``target_tf`` bars."""
    source_ms = timeframe_to_ms(source_tf)
    target_ms = timeframe_to_ms(target_tf)
    if target_ms % source_ms != 0 or target_ms <= source_ms:
        raise ValueError(
            f"cannot build {target_tf} bars from {source_tf}: target must be a "
            "larger multiple of the source"
        )
    if df.empty:
        return df

    out = df.resample(_pandas_rule(target_tf), label="left", closed="left").agg(_AGG)
    out = out.dropna(subset=["open"])
    out = out[OHLCV_COLUMNS].astype("float64")
    out.index.name = "timestamp"

    # Keep only buckets fully covered by source data: the bucket must end at
    # or before the end of the last source bar.
    source_end = df.index[-1] + pd.Timedelta(milliseconds=source_ms)
    complete = out.index + pd.Timedelta(milliseconds=target_ms) <= source_end
    return cast(pd.DataFrame, out[complete])


def pick_source(available: list[str], target: str) -> str | None:
    """The coarsest timeframe in ``available`` that can build ``target``."""
    target_ms = timeframe_to_ms(target)
    candidates = [
        tf
        for tf in available
        if tf != target
        and target_ms % timeframe_to_ms(tf) == 0
        and timeframe_to_ms(tf) < target_ms
    ]
    if not candidates:
        return None
    return max(candidates, key=timeframe_to_ms)


def derive_timeframe(
    store: ParquetStore, exchange: str, symbol: str, source_tf: str, target_tf: str
) -> int:
    """Build and store ``target_tf`` bars from stored ``source_tf`` data.

    Returns the number of derived bars written (0 if no source data).
    """
    source = store.read(exchange, symbol, source_tf)
    if source.empty:
        return 0
    derived = resample_ohlcv(source, source_tf, target_tf)
    if derived.empty:
        return 0
    store.write(exchange, symbol, target_tf, derived)
    return len(derived)
