"""OHLCV fetching via ccxt with incremental updates.

Public market-data endpoints only — no API keys are needed or read here.
The exchange client is injected so tests can drive the fetcher with a fake.
"""

from __future__ import annotations

from typing import Protocol, cast

import pandas as pd

from quant_lab.data.store import OHLCV_COLUMNS, ParquetStore
from quant_lab.data.timeframes import timeframe_to_ms

# Candles at or after (now - this window) are refetched on update: the most
# recent stored candle may have been written while still forming.
_REFRESH_BARS = 2


class OhlcvClient(Protocol):
    def fetch_ohlcv(
        self, symbol: str, timeframe: str, since: int | None, limit: int
    ) -> list[list[float]]: ...


def make_ccxt_client(exchange_id: str, rate_limit_ms: int) -> OhlcvClient:
    import ccxt

    cls = getattr(ccxt, exchange_id, None)
    if cls is None:
        raise ValueError(f"unknown ccxt exchange id {exchange_id!r}")
    return cls({"enableRateLimit": True, "rateLimit": rate_limit_ms})  # type: ignore[no-any-return]


def rows_to_frame(rows: list[list[float]]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["timestamp", *OHLCV_COLUMNS])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return df.set_index("timestamp").astype("float64")


class OhlcvFetcher:
    def __init__(self, client: OhlcvClient, store: ParquetStore, exchange: str) -> None:
        self._client = client
        self._store = store
        self._exchange = exchange

    def fetch_range(
        self, symbol: str, timeframe: str, since_ms: int, batch_limit: int = 300
    ) -> pd.DataFrame:
        """Page through fetch_ohlcv from ``since_ms`` until the exchange runs dry.

        Termination is driven purely by cursor progress, never by page size:
        exchanges cap pages at different sizes (coinbase returns at most 300
        candles regardless of the requested limit), so a short page means
        nothing — only an empty or non-advancing page ends the walk.
        """
        bar_ms = timeframe_to_ms(timeframe)
        all_rows: list[list[float]] = []
        cursor = since_ms
        while True:
            rows = self._client.fetch_ohlcv(symbol, timeframe, since=cursor, limit=batch_limit)
            if not rows:
                break
            # Guard against exchanges that ignore `since` and resend old data.
            rows = [r for r in rows if r[0] >= cursor]
            if not rows:
                break
            all_rows.extend(rows)
            new_cursor = int(rows[-1][0]) + bar_ms
            if new_cursor <= cursor:
                break
            cursor = new_cursor
        return rows_to_frame(all_rows)

    def update(
        self,
        symbol: str,
        timeframe: str,
        start: pd.Timestamp,
        batch_limit: int = 300,
        now_ms: int | None = None,
    ) -> int:
        """Incrementally extend the store; returns the number of rows stored.

        Resumes from the last stored bar (minus a small refresh window so a
        candle refetched at the boundary gets overwritten with final values).

        Only CLOSED candles are ever stored: exchanges return the currently
        forming candle as their last row, and a forming candle repaints —
        letting it into the store would contaminate backtests and make live
        signals differ from what the backtest saw. A bar is closed once its
        end (open time + bar length) is at or before ``now``.
        """
        import time

        bar_ms = timeframe_to_ms(timeframe)
        last = self._store.last_timestamp(self._exchange, symbol, timeframe)
        if last is None:
            since_ms = int(start.value // 1_000_000)
        else:
            since_ms = int(last.value // 1_000_000) - (_REFRESH_BARS - 1) * bar_ms

        df = self.fetch_range(symbol, timeframe, since_ms, batch_limit=batch_limit)
        if df.empty:
            return 0
        if now_ms is None:
            now_ms = int(time.time() * 1000)
        # Resolution-independent epoch-ms (index may be datetime64[ms] or [ns]).
        index = cast(pd.DatetimeIndex, df.index)
        open_ms = (index - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1)
        df = df[open_ms + bar_ms <= now_ms]
        if df.empty:
            return 0
        self._store.write(self._exchange, symbol, timeframe, df)
        return len(df)
