from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.data.fetcher import OhlcvFetcher
from quant_lab.data.store import ParquetStore
from quant_lab.data.timeframes import timeframe_to_ms

BAR_MS = timeframe_to_ms("1h")
START = pd.Timestamp("2024-01-01", tz="UTC")
START_MS = int(START.value // 1_000_000)


class FakeExchange:
    """Serves a fixed candle history the way ccxt's fetch_ohlcv does."""

    def __init__(self, bars: int) -> None:
        self.rows = [
            [START_MS + i * BAR_MS, 100.0 + i, 101.0 + i, 99.0 + i, 100.5 + i, 10.0]
            for i in range(bars)
        ]
        self.calls = 0

    def fetch_ohlcv(
        self, symbol: str, timeframe: str, since: int | None, limit: int
    ) -> list[list[float]]:
        self.calls += 1
        assert since is not None
        eligible = [r for r in self.rows if r[0] >= since]
        return eligible[:limit]


@pytest.fixture
def store(tmp_path: Path) -> ParquetStore:
    return ParquetStore(tmp_path / "parquet")


def test_initial_fetch_pages_through_history(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=1200)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetched = fetcher.update("BTC/USD", "1h", START, batch_limit=500)
    assert fetched == 1200
    assert exchange.calls == 4  # 500 + 500 + 200 + empty page ends the walk
    df = store.read("kraken", "BTC/USD", "1h")
    assert len(df) == 1200
    assert df.index[0] == START


def test_incremental_update_fetches_only_tail(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=100)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetcher.update("BTC/USD", "1h", START)

    exchange.rows = FakeExchange(bars=110).rows  # 10 new candles appear
    fetched = fetcher.update("BTC/USD", "1h", START)
    # 10 new bars plus the refresh window over the previously-last bar
    assert fetched <= 12
    assert len(store.read("kraken", "BTC/USD", "1h")) == 110


def test_update_refreshes_forming_candle(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=50)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetcher.update("BTC/USD", "1h", START)

    exchange.rows[-1][4] = 999.0  # last candle finalizes with a new close
    fetcher.update("BTC/USD", "1h", START)
    df = store.read("kraken", "BTC/USD", "1h")
    assert df["close"].iloc[-1] == 999.0
    assert len(df) == 50


def test_empty_exchange_response(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=0)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    assert fetcher.update("BTC/USD", "1h", START) == 0
    assert store.read("kraken", "BTC/USD", "1h").empty


def test_stuck_cursor_terminates(store: ParquetStore) -> None:
    """An exchange that ignores `since` and replays old rows must not loop forever."""

    class StuckExchange(FakeExchange):
        def fetch_ohlcv(
            self, symbol: str, timeframe: str, since: int | None, limit: int
        ) -> list[list[float]]:
            self.calls += 1
            return self.rows[:limit]  # always the same head, ignoring since

    exchange = StuckExchange(bars=600)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetched = fetcher.update("BTC/USD", "1h", START, batch_limit=500)
    assert fetched == 500  # first page accepted, replayed page filtered out, loop ends
    assert exchange.calls == 2


def test_forming_candle_never_stored(store: ParquetStore) -> None:
    """The exchange returns the in-progress candle as its last row; only
    closed candles (bar end <= now) may reach the store."""
    exchange = FakeExchange(bars=50)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    # "now" is mid-way through the 50th candle: its bar hasn't closed yet.
    now_ms = START_MS + 49 * BAR_MS + BAR_MS // 2
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=now_ms)
    assert stored == 49
    df = store.read("kraken", "BTC/USD", "1h")
    assert len(df) == 49
    assert df.index[-1] == START + pd.Timedelta(hours=48)

    # Once the bar closes, the next update picks it up as final.
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=START_MS + 50 * BAR_MS)
    assert stored >= 1
    assert len(store.read("kraken", "BTC/USD", "1h")) == 50


def test_exactly_closed_candle_is_stored(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=10)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    # now == exact close time of the final bar: it is closed, keep it.
    fetcher.update("BTC/USD", "1h", START, now_ms=START_MS + 10 * BAR_MS)
    assert len(store.read("kraken", "BTC/USD", "1h")) == 10


def test_pagination_survives_exchange_page_caps(store: ParquetStore) -> None:
    """coinbase caps pages at 300 candles regardless of the requested limit —
    a short page must NOT end the walk (this bug once stopped a 60k-bar
    download after a single page)."""

    class CappedExchange(FakeExchange):
        PAGE_CAP = 300

        def fetch_ohlcv(
            self, symbol: str, timeframe: str, since: int | None, limit: int
        ) -> list[list[float]]:
            self.calls += 1
            assert since is not None
            eligible = [r for r in self.rows if r[0] >= since]
            return eligible[: self.PAGE_CAP]  # ignores the requested limit

    exchange = CappedExchange(bars=1000)
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    stored = fetcher.update("BTC/USD", "1h", START, batch_limit=500)
    assert stored == 1000
    assert exchange.calls == 5  # 300+300+300+100, then an empty page ends it
    df = store.read("coinbase", "BTC/USD", "1h")
    assert len(df) == 1000
    assert df.index.is_monotonic_increasing
