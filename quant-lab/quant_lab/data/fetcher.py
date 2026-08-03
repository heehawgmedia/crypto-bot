"""OHLCV fetching via ccxt with incremental updates.

Public market-data endpoints only — no API keys are needed or read here.
The exchange client is injected so tests can drive the fetcher with a fake.
"""

from __future__ import annotations

from typing import Protocol

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
        self, symbol: str, timeframe: str, since_ms: int, batch_limit: int = 500
    ) -> pd.DataFrame:
        """Page through fetch_ohlcv from ``since_ms`` until the exchange runs dry."""
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
            cursor = int(rows[-1][0]) + bar_ms
            if len(rows) < batch_limit:
                break
        return rows_to_frame(all_rows)

    def update(
        self, symbol: str, timeframe: str, start: pd.Timestamp, batch_limit: int = 500
    ) -> int:
        """Incrementally extend the store; returns the number of rows fetched.

        Resumes from the last stored bar (minus a small refresh window so a
        candle stored while still forming gets overwritten with final values).
        """
        bar_ms = timeframe_to_ms(timeframe)
        last = self._store.last_timestamp(self._exchange, symbol, timeframe)
        if last is None:
            since_ms = int(start.value // 1_000_000)
        else:
            since_ms = int(last.value // 1_000_000) - (_REFRESH_BARS - 1) * bar_ms

        df = self.fetch_range(symbol, timeframe, since_ms, batch_limit=batch_limit)
        if df.empty:
            return 0
        self._store.write(self._exchange, symbol, timeframe, df)
        return len(df)
