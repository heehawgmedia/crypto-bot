from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.data.store import ParquetStore
from tests.conftest import make_ohlcv


@pytest.fixture
def store(tmp_path: Path) -> ParquetStore:
    return ParquetStore(tmp_path / "parquet")


def test_roundtrip(store: ParquetStore, ohlcv: pd.DataFrame) -> None:
    store.write("kraken", "BTC/USD", "1h", ohlcv)
    out = store.read("kraken", "BTC/USD", "1h")
    pd.testing.assert_frame_equal(out, ohlcv, check_freq=False)


def test_read_missing_returns_empty_canonical_frame(store: ParquetStore) -> None:
    df = store.read("kraken", "BTC/USD", "1h")
    assert df.empty
    assert isinstance(df.index, pd.DatetimeIndex)
    assert str(df.index.tz) == "UTC"


def test_incremental_merge_dedupes_and_sorts(store: ParquetStore) -> None:
    full = make_ohlcv(bars=50)
    first, second = full.iloc[:30], full.iloc[25:]  # 5-bar overlap
    store.write("kraken", "BTC/USD", "1h", first)
    total = store.write("kraken", "BTC/USD", "1h", second)
    assert total == 50
    out = store.read("kraken", "BTC/USD", "1h")
    assert len(out) == 50
    assert out.index.is_monotonic_increasing
    assert not out.index.has_duplicates


def test_merge_overwrite_last_wins(store: ParquetStore, ohlcv: pd.DataFrame) -> None:
    store.write("kraken", "BTC/USD", "1h", ohlcv)
    refreshed = ohlcv.iloc[[-1]].copy()
    refreshed.loc[:, "close"] = 12345.0  # candle finalized with a different close
    store.write("kraken", "BTC/USD", "1h", refreshed)
    out = store.read("kraken", "BTC/USD", "1h")
    assert len(out) == len(ohlcv)
    assert out["close"].iloc[-1] == 12345.0


def test_rejects_naive_timestamps(store: ParquetStore, ohlcv: pd.DataFrame) -> None:
    naive = ohlcv.copy()
    naive.index = naive.index.tz_localize(None)
    with pytest.raises(ValueError, match="timezone-aware"):
        store.write("kraken", "BTC/USD", "1h", naive)


def test_last_timestamp(store: ParquetStore, ohlcv: pd.DataFrame) -> None:
    assert store.last_timestamp("kraken", "BTC/USD", "1h") is None
    store.write("kraken", "BTC/USD", "1h", ohlcv)
    assert store.last_timestamp("kraken", "BTC/USD", "1h") == ohlcv.index[-1]


def test_symbol_slash_maps_to_safe_path(store: ParquetStore) -> None:
    path = store.path_for("kraken", "BTC/USD", "1h")
    assert "BTC_USD" in str(path)
    assert "BTC/USD" not in str(path)
