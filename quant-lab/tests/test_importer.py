from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.data.importer import read_ohlcv_csv
from quant_lab.data.integrity import check_ohlcv
from quant_lab.data.store import OHLCV_COLUMNS, ParquetStore

_T0 = 1704067200  # 2024-01-01 00:00:00 UTC


def _rows(n: int, cols: int) -> str:
    lines = []
    for i in range(n):
        t = _T0 + i * 3600
        o, h, low, c, v = 100 + i, 101 + i, 99 + i, 100.5 + i, 5.0
        if cols == 6:
            lines.append(f"{t},{o},{h},{low},{c},{v}")
        elif cols == 7:
            lines.append(f"{t},{o},{h},{low},{c},{v},12")
        else:  # 8: vwap between low/high, then volume, count
            lines.append(f"{t},{o},{h},{low},{c},{100.2 + i},{v},12")
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize("cols", [6, 7, 8])
def test_import_layouts(tmp_path: Path, cols: int) -> None:
    csv = tmp_path / "hist.csv"
    csv.write_text(_rows(48, cols))
    df = read_ohlcv_csv(csv)
    assert list(df.columns) == OHLCV_COLUMNS
    assert len(df) == 48
    assert df.index[0] == pd.Timestamp("2024-01-01", tz="UTC")
    assert df["open"].iloc[1] == pytest.approx(101.0)
    assert df["volume"].iloc[0] == pytest.approx(5.0)
    # Round-trips through the store and passes integrity checks.
    store = ParquetStore(tmp_path / "parquet")
    store.write("kraken", "BTC/USD", "1h", df)
    report = check_ohlcv(store.read("kraken", "BTC/USD", "1h"), "1h", max_gap_bars=3)
    assert report.ok


def test_import_rejects_unknown_layout(tmp_path: Path) -> None:
    csv = tmp_path / "bad.csv"
    csv.write_text("1,2,3\n4,5,6\n")
    with pytest.raises(ValueError, match="expected 6, 7, or 8"):
        read_ohlcv_csv(csv)


def test_import_merges_with_existing_data(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path / "parquet")
    first = read_ohlcv_csv(_write(tmp_path / "a.csv", _rows(48, 7)))
    store.write("kraken", "BTC/USD", "1h", first)
    # Overlapping re-import (same file again) must not duplicate rows.
    total = store.write("kraken", "BTC/USD", "1h", first)
    assert total == 48


def _write(path: Path, content: str) -> Path:
    path.write_text(content)
    return path
