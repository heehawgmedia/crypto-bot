"""Parquet-backed OHLCV storage.

Layout: <parquet_dir>/<exchange>/<symbol with '/' -> '_'>/<timeframe>.parquet

Frames are canonicalized on every write: UTC tz-aware timestamp index,
duplicates dropped (last wins, so refreshed candles replace partial ones),
sorted ascending. Readers can rely on those invariants.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


def _canonicalize(df: pd.DataFrame) -> pd.DataFrame:
    if list(df.columns) != OHLCV_COLUMNS:
        raise ValueError(f"expected columns {OHLCV_COLUMNS}, got {list(df.columns)}")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("expected a DatetimeIndex")
    if df.index.tz is None:
        raise ValueError("timestamp index must be timezone-aware UTC")
    df = df.tz_convert("UTC")
    df = df[~df.index.duplicated(keep="last")]
    df = df.sort_index()
    df.index.name = "timestamp"
    return df.astype("float64")


class ParquetStore:
    def __init__(self, parquet_dir: Path) -> None:
        self._root = parquet_dir

    def path_for(self, exchange: str, symbol: str, timeframe: str) -> Path:
        return self._root / exchange / symbol.replace("/", "_") / f"{timeframe}.parquet"

    def read(self, exchange: str, symbol: str, timeframe: str) -> pd.DataFrame:
        """Return the stored frame, or an empty canonical frame if none exists."""
        path = self.path_for(exchange, symbol, timeframe)
        if not path.exists():
            return pd.DataFrame(
                columns=OHLCV_COLUMNS,
                index=pd.DatetimeIndex([], tz="UTC", name="timestamp"),
                dtype="float64",
            )
        return _canonicalize(pd.read_parquet(path))

    def write(self, exchange: str, symbol: str, timeframe: str, df: pd.DataFrame) -> int:
        """Merge ``df`` into the stored frame; new rows win on timestamp clashes.

        Returns the total number of stored rows after the merge.
        """
        new = _canonicalize(df)
        existing = self.read(exchange, symbol, timeframe)
        merged = _canonicalize(pd.concat([existing, new])) if not existing.empty else new

        path = self.path_for(exchange, symbol, timeframe)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".parquet.tmp")
        merged.to_parquet(tmp)
        tmp.replace(path)
        return len(merged)

    def last_timestamp(self, exchange: str, symbol: str, timeframe: str) -> pd.Timestamp | None:
        df = self.read(exchange, symbol, timeframe)
        return None if df.empty else df.index[-1]
