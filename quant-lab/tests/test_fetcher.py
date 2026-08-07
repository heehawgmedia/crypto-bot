from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from quant_lab.data.fetcher import OhlcvFetcher
from quant_lab.data.store import ParquetStore
from quant_lab.data.timeframes import timeframe_to_ms

BAR_MS = timeframe_to_ms("1h")
START = pd.Timestamp("2024-01-01", tz="UTC")
START_MS = int(START.value // 1_000_000)


def _now(bars: int) -> int:
    """Epoch-ms 'now' at which exactly ``bars`` candles have closed."""
    return START_MS + bars * BAR_MS


class FakeExchange:
    """Serves a fixed candle history the way ccxt's fetch_ohlcv does."""

    def __init__(self, bars: int, first_bar: int = 0) -> None:
        self.rows = [
            [START_MS + i * BAR_MS, 100.0 + i, 101.0 + i, 99.0 + i, 100.5 + i, 10.0]
            for i in range(first_bar, first_bar + bars)
        ]
        self.calls = 0
        self.requests: list[tuple[int, int]] = []  # (since, until)

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        since: int | None,
        limit: int,
        params: dict[str, Any],
    ) -> list[list[float]]:
        self.calls += 1
        assert since is not None
        self.requests.append((since, params.get("until", 0)))
        eligible = [r for r in self.rows if r[0] >= since]
        return eligible[:limit]


@pytest.fixture
def store(tmp_path: Path) -> ParquetStore:
    return ParquetStore(tmp_path / "parquet")


def test_initial_fetch_pages_through_history(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=1200)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    stored = fetcher.update("BTC/USD", "1h", START, batch_limit=500, now_ms=_now(1200))
    assert stored == 1200
    assert exchange.calls == 3  # 500 + 500 + 200, bounded by now — no wasted calls
    df = store.read("kraken", "BTC/USD", "1h")
    assert len(df) == 1200
    assert df.index[0] == START


def test_incremental_update_fetches_only_tail(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=100)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetcher.update("BTC/USD", "1h", START, now_ms=_now(100))

    exchange.rows = FakeExchange(bars=110).rows  # 10 new candles appear
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(110))
    # 10 new bars plus the refresh window over the previously-last bar.
    assert stored <= 12
    assert len(store.read("kraken", "BTC/USD", "1h")) == 110


def test_update_refreshes_forming_candle(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=50)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    fetcher.update("BTC/USD", "1h", START, now_ms=_now(50))

    exchange.rows[-1][4] = 999.0  # last candle finalizes with a new close
    fetcher.update("BTC/USD", "1h", START, now_ms=_now(50))
    df = store.read("kraken", "BTC/USD", "1h")
    assert df["close"].iloc[-1] == 999.0
    assert len(df) == 50


def test_empty_exchange_response(store: ParquetStore) -> None:
    exchange = FakeExchange(bars=0)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    assert fetcher.update("BTC/USD", "1h", START, now_ms=_now(10)) == 0
    assert store.read("kraken", "BTC/USD", "1h").empty


def test_stuck_cursor_terminates(store: ParquetStore) -> None:
    """An exchange that ignores `since` and replays old rows must not loop forever."""

    class StuckExchange(FakeExchange):
        def fetch_ohlcv(
            self,
            symbol: str,
            timeframe: str,
            since: int | None,
            limit: int,
            params: dict[str, Any],
        ) -> list[list[float]]:
            self.calls += 1
            return self.rows[:limit]  # always the same head, ignoring since

    exchange = StuckExchange(bars=600)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    stored = fetcher.update("BTC/USD", "1h", START, batch_limit=500, now_ms=_now(600))
    assert stored == 500  # first page accepted, replayed page filtered out, loop ends
    assert exchange.calls == 2


def test_forming_candle_never_stored(store: ParquetStore) -> None:
    """Only closed candles (bar end <= now) may reach the store."""
    exchange = FakeExchange(bars=50)
    fetcher = OhlcvFetcher(exchange, store, "kraken")
    # "now" is mid-way through the 50th candle: its bar hasn't closed yet.
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(49) + BAR_MS // 2)
    assert stored == 49
    df = store.read("kraken", "BTC/USD", "1h")
    assert len(df) == 49
    assert df.index[-1] == START + pd.Timedelta(hours=48)

    # Once the bar closes, the next update picks it up as final.
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(50))
    assert stored >= 1
    assert len(store.read("kraken", "BTC/USD", "1h")) == 50


def test_pagination_survives_exchange_page_caps(store: ParquetStore) -> None:
    """coinbase caps pages at 300 candles regardless of the requested limit —
    a short page must NOT end the walk (this bug once stopped a 60k-bar
    download after a single page)."""

    class CappedExchange(FakeExchange):
        PAGE_CAP = 300

        def fetch_ohlcv(
            self,
            symbol: str,
            timeframe: str,
            since: int | None,
            limit: int,
            params: dict[str, Any],
        ) -> list[list[float]]:
            self.calls += 1
            assert since is not None
            eligible = [r for r in self.rows if r[0] >= since]
            return eligible[: self.PAGE_CAP]  # ignores the requested limit

    exchange = CappedExchange(bars=1000)
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    stored = fetcher.update("BTC/USD", "1h", START, batch_limit=500, now_ms=_now(1000))
    assert stored == 1000
    assert exchange.calls == 4  # 300 + 300 + 300 + 100, bounded by now
    df = store.read("coinbase", "BTC/USD", "1h")
    assert len(df) == 1000
    assert df.index.is_monotonic_increasing


def test_no_request_ever_asks_for_the_future(store: ParquetStore) -> None:
    """coinbase rejects start times in the future; the fetcher must never
    issue one (this bug once broke every incremental update)."""
    now_ms = _now(100)

    class StrictExchange(FakeExchange):
        def fetch_ohlcv(
            self,
            symbol: str,
            timeframe: str,
            since: int | None,
            limit: int,
            params: dict[str, Any],
        ) -> list[list[float]]:
            assert since is not None and since <= now_ms, "start must not be in the future"
            return super().fetch_ohlcv(symbol, timeframe, since, limit, params)

    exchange = StrictExchange(bars=100)
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    fetcher.update("BTC/USD", "1h", START, now_ms=now_ms)
    # Immediately updating again (store is current) must also never go future.
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=now_ms)
    assert stored <= 2  # just the refresh window
    assert len(store.read("coinbase", "BTC/USD", "1h")) == 100


def test_head_backfill_when_store_starts_late(store: ParquetStore) -> None:
    """A store that begins long after start_date (e.g. an earlier buggy fetch
    kept only recent candles) gets its missing history backfilled."""
    exchange = FakeExchange(bars=600)
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    # Seed the store with only the most recent 100 bars (bars 500..599).
    recent = pd.DataFrame(
        [r[1:] for r in exchange.rows[500:]],
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex(
            [pd.Timestamp(r[0], unit="ms", tz="UTC") for r in exchange.rows[500:]],
            name="timestamp",
        ),
    )
    store.write("coinbase", "BTC/USD", "1h", recent)

    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(600))
    assert stored >= 500  # the missing head
    df = store.read("coinbase", "BTC/USD", "1h")
    assert len(df) == 600
    assert df.index[0] == START
    assert df.index.is_monotonic_increasing
    assert not df.index.has_duplicates


def test_midwalk_error_keeps_collected_pages(store: ParquetStore) -> None:
    """A page error after progress keeps the rows already fetched; the next
    update resumes from where it stopped."""

    class FlakyExchange(FakeExchange):
        def __init__(self, bars: int, fail_on_call: int) -> None:
            super().__init__(bars)
            self.fail_on_call = fail_on_call

        def fetch_ohlcv(
            self,
            symbol: str,
            timeframe: str,
            since: int | None,
            limit: int,
            params: dict[str, Any],
        ) -> list[list[float]]:
            if self.calls + 1 == self.fail_on_call:
                self.calls += 1
                raise ConnectionError("blip")
            return super().fetch_ohlcv(symbol, timeframe, since, limit, params)

    exchange = FlakyExchange(bars=900, fail_on_call=3)
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(900))
    assert stored == 600  # two good pages of 300 kept despite the error
    # Second run heals the rest.
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(900))
    assert len(store.read("coinbase", "BTC/USD", "1h")) == 900


def test_listing_gap_is_walked_through(store: ParquetStore) -> None:
    """A market listed after start_date has empty early windows; the walk
    must skip through them instead of giving up."""
    exchange = FakeExchange(bars=300, first_bar=700)  # data exists only from bar 700
    fetcher = OhlcvFetcher(exchange, store, "coinbase")
    stored = fetcher.update("BTC/USD", "1h", START, now_ms=_now(1000))
    assert stored == 300
    df = store.read("coinbase", "BTC/USD", "1h")
    assert df.index[0] == START + pd.Timedelta(hours=700)
