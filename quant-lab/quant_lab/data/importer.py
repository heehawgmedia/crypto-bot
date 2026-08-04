"""Bulk OHLCV import from CSV files.

Kraken's REST OHLC endpoint only serves the most recent ~720 candles, so deep
history has to come from their downloadable OHLCVT archives
(https://support.kraken.com -> "Downloadable historical OHLCVT data").

Accepted layouts (no header row, epoch-second timestamps):
  6 columns: time, open, high, low, close, volume
  7 columns: time, open, high, low, close, volume, trades       (Kraken OHLCVT)
  8 columns: time, open, high, low, close, vwap, volume, count  (Kraken API dump)
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from quant_lab.data.store import OHLCV_COLUMNS

_LAYOUTS: dict[int, list[str]] = {
    6: ["time", "open", "high", "low", "close", "volume"],
    7: ["time", "open", "high", "low", "close", "volume", "trades"],
    8: ["time", "open", "high", "low", "close", "vwap", "volume", "count"],
}


def read_ohlcv_csv(path: Path) -> pd.DataFrame:
    raw = pd.read_csv(path, header=None)
    n_cols = raw.shape[1]
    if n_cols not in _LAYOUTS:
        raise ValueError(
            f"{path}: expected 6, 7, or 8 columns (Kraken OHLCVT layouts), got {n_cols}"
        )
    raw.columns = pd.Index(_LAYOUTS[n_cols])
    df = raw[["time", *OHLCV_COLUMNS]].copy()
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("time")
    df.index.name = "timestamp"
    return df.astype("float64")
