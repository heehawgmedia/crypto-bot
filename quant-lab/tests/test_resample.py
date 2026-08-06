from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.data.integrity import check_ohlcv
from quant_lab.data.resample import derive_timeframe, pick_source, resample_ohlcv
from quant_lab.data.store import ParquetStore
from tests.conftest import make_ohlcv


def test_resample_1h_to_4h_alignment_and_aggregation() -> None:
    df = make_ohlcv(start="2024-01-01", bars=48, timeframe="1h", seed=3)
    out = resample_ohlcv(df, "1h", "4h")
    assert len(out) == 12
    assert out.index[0] == pd.Timestamp("2024-01-01 00:00", tz="UTC")
    assert (out.index.hour % 4 == 0).all()  # aligned to UTC 00/04/08...

    first = df.iloc[:4]
    assert out["open"].iloc[0] == first["open"].iloc[0]
    assert out["close"].iloc[0] == first["close"].iloc[-1]
    assert out["high"].iloc[0] == first["high"].max()
    assert out["low"].iloc[0] == first["low"].min()
    assert out["volume"].iloc[0] == pytest.approx(first["volume"].sum())


def test_resample_drops_trailing_partial_bucket() -> None:
    # 46 hourly bars: 11 full 4h buckets + 2 leftover hours that must NOT
    # become a repainting half-bucket.
    df = make_ohlcv(start="2024-01-01", bars=46, timeframe="1h")
    out = resample_ohlcv(df, "1h", "4h")
    assert len(out) == 11
    assert out.index[-1] == pd.Timestamp("2024-01-02 16:00", tz="UTC")


def test_resample_1h_to_1d() -> None:
    df = make_ohlcv(start="2024-01-01", bars=72, timeframe="1h")
    out = resample_ohlcv(df, "1h", "1d")
    assert len(out) == 3
    report = check_ohlcv(out, "1d", max_gap_bars=0)
    assert report.ok


def test_resample_rejects_non_divisible_or_downsample() -> None:
    df = make_ohlcv(bars=10)
    with pytest.raises(ValueError, match="larger multiple"):
        resample_ohlcv(df, "1h", "90m")
    with pytest.raises(ValueError, match="larger multiple"):
        resample_ohlcv(df, "4h", "1h")


def test_pick_source_prefers_coarsest_divisor() -> None:
    assert pick_source(["1h", "4h", "1d"], "4h") == "1h"
    assert pick_source(["1h", "4h", "1d"], "1d") == "4h"  # 4h divides 1d, coarser than 1h
    assert pick_source(["1d"], "4h") is None  # nothing finer available
    assert pick_source(["4h"], "4h") is None  # itself doesn't count


def test_derive_timeframe_writes_store(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path / "p")
    store.write("coinbase", "BTC/USD", "1h", make_ohlcv(bars=48, timeframe="1h"))
    n = derive_timeframe(store, "coinbase", "BTC/USD", "1h", "4h")
    assert n == 12
    derived = store.read("coinbase", "BTC/USD", "4h")
    assert len(derived) == 12
    assert check_ohlcv(derived, "4h", max_gap_bars=0).ok


def test_derive_timeframe_no_source_is_noop(tmp_path: Path) -> None:
    store = ParquetStore(tmp_path / "p")
    assert derive_timeframe(store, "coinbase", "BTC/USD", "1h", "4h") == 0
    assert store.read("coinbase", "BTC/USD", "4h").empty
