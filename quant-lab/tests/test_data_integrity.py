from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quant_lab.data.integrity import check_ohlcv
from quant_lab.data.timeframes import timeframe_to_ms
from tests.conftest import make_ohlcv


def test_clean_data_passes(ohlcv: pd.DataFrame) -> None:
    report = check_ohlcv(ohlcv, "1h", max_gap_bars=3)
    assert report.ok
    assert report.rows == len(ohlcv)
    assert not report.gaps


def test_small_gap_reported_but_allowed(ohlcv: pd.DataFrame) -> None:
    df = ohlcv.drop(ohlcv.index[10:12])  # 2 missing bars
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert report.ok
    assert len(report.gaps) == 1
    assert report.gaps[0].missing_bars == 2


def test_large_gap_fails(ohlcv: pd.DataFrame) -> None:
    df = ohlcv.drop(ohlcv.index[10:15])  # 5 missing bars
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any("gap of 5 bars" in e for e in report.errors)


def test_duplicate_timestamps_fail(ohlcv: pd.DataFrame) -> None:
    df = pd.concat([ohlcv, ohlcv.iloc[[5]]]).sort_index()
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any("duplicate" in e for e in report.errors)


def test_unsorted_timestamps_fail(ohlcv: pd.DataFrame) -> None:
    df = ohlcv.iloc[::-1]
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any("sorted" in e for e in report.errors)


def test_nan_rows_fail(ohlcv: pd.DataFrame) -> None:
    df = ohlcv.copy()
    df.iloc[3, df.columns.get_loc("close")] = np.nan
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any("NaN" in e for e in report.errors)


@pytest.mark.parametrize(
    ("column", "value", "fragment"),
    [
        ("high", 0.0001, "OHLC sanity"),  # high below open/close/low
        ("low", 1e9, "OHLC sanity"),  # low above open/close/high
        ("close", -5.0, "OHLC sanity"),  # non-positive price
        ("volume", -1.0, "OHLC sanity"),  # negative volume
    ],
)
def test_bad_bars_fail(ohlcv: pd.DataFrame, column: str, value: float, fragment: str) -> None:
    df = ohlcv.copy()
    df.iloc[7, df.columns.get_loc(column)] = value
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any(fragment in e for e in report.errors)


def test_off_grid_timestamp_fails(ohlcv: pd.DataFrame) -> None:
    df = ohlcv.copy()
    idx = df.index.to_list()
    idx[20] = idx[20] + pd.Timedelta(minutes=7)
    df.index = pd.DatetimeIndex(idx, name="timestamp")
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok
    assert any("off-grid" in e for e in report.errors)


def test_empty_dataset_fails() -> None:
    df = make_ohlcv(bars=1).iloc[:0]
    report = check_ohlcv(df, "1h", max_gap_bars=3)
    assert not report.ok


def test_timeframe_parsing() -> None:
    assert timeframe_to_ms("1h") == 3_600_000
    assert timeframe_to_ms("15m") == 900_000
    assert timeframe_to_ms("4h") == 4 * 3_600_000
    assert timeframe_to_ms("1d") == 86_400_000
    with pytest.raises(ValueError):
        timeframe_to_ms("1M")  # months are variable-length: unsupported
    with pytest.raises(ValueError):
        timeframe_to_ms("bogus")
