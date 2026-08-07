"""OHLCV fetching via ccxt with incremental updates and head backfill.

Public market-data endpoints only — no API keys are needed or read here.
The exchange client is injected so tests can drive the fetcher with a fake.

Hard-won real-world rules encoded here:

- Pages are bounded by an explicit [since, until] window. Some exchanges
  (coinbase) anchor on the *end* of a window and return the latest candles
  when only `since` is given; passing the unified ``until`` param pins the
  window to where the cursor actually is.
- Requests never extend past "now": exchanges reject future start times
  (coinbase errors outright) and a bar that hasn't closed is banned from the
  store anyway.
- A mid-walk page error keeps the rows already collected: losing 200 good
  pages because page 201 hiccuped would make deep backfills impossible on
  flaky connections. The incremental resume repairs the rest on the next run.
- If stored data starts AFTER the requested start date (e.g. an earlier
  buggy fetch stored only recent candles), the missing head is backfilled
  before the tail is extended.
"""

from __future__ import annotations

from typing import Any, Protocol, cast

import pandas as pd

from quant_lab.data.store import OHLCV_COLUMNS, ParquetStore
from quant_lab.data.timeframes import timeframe_to_ms

# Candles at or after (now - this window) are refetched on update: the most
# recent stored candle may have been written while still forming.
_REFRESH_BARS = 2


class OhlcvClient(Protocol):
    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        since: int | None,
        limit: int,
        params: dict[str, Any],
    ) -> list[list[float]]: ...


def make_ccxt_client(exchange_id: str, rate_limit_ms: int) -> OhlcvClient:
    import ccxt

    cls = getattr(ccxt, exchange_id, None)
    if cls is None:
        raise ValueError(f"unknown ccxt exchange id {exchange_id!r}")
    return cast(OhlcvClient, cls({"enableRateLimit": True, "rateLimit": rate_limit_ms}))


def rows_to_frame(rows: list[list[float]]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["timestamp", *OHLCV_COLUMNS])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return df.set_index("timestamp").astype("float64")


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


class OhlcvFetcher:
    def __init__(self, client: OhlcvClient, store: ParquetStore, exchange: str) -> None:
        self._client = client
        self._store = store
        self._exchange = exchange

    def fetch_range(
        self,
        symbol: str,
        timeframe: str,
        since_ms: int,
        until_ms: int,
        batch_limit: int = 300,
    ) -> pd.DataFrame:
        """Page through fetch_ohlcv over [since_ms, until_ms).

        Termination is driven purely by cursor progress, never by page size:
        exchanges cap pages at different sizes (coinbase returns at most 300
        candles regardless of the requested limit), so a short page means
        nothing — only an empty page, a non-advancing cursor, or reaching
        ``until_ms`` ends the walk.
        """
        bar_ms = timeframe_to_ms(timeframe)
        all_rows: list[list[float]] = []
        cursor = since_ms
        while cursor < until_ms:
            window_end = min(cursor + batch_limit * bar_ms, until_ms)
            try:
                rows = self._client.fetch_ohlcv(
                    symbol,
                    timeframe,
                    since=cursor,
                    limit=batch_limit,
                    params={"until": window_end},
                )
            except Exception:
                if all_rows:
                    break  # keep what we have; the next update resumes here
                raise
            if not rows:
                # Nothing in this window; move to the next one (data can be
                # genuinely absent early in a market's life).
                cursor = window_end
                continue
            # Guard against exchanges that ignore the window and resend data.
            rows = [r for r in rows if since_ms <= r[0] < until_ms and r[0] >= cursor]
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

        Fetches in two phases, both bounded by "now" so no request can ask
        the exchange for the future:
          1. head backfill — history between ``start`` and the earliest
             stored bar, if the store begins later than requested;
          2. tail extension — from the last stored bar forward.

        Only CLOSED candles are ever stored: a bar is closed once its end
        (open time + bar length) is at or before now. Forming candles repaint
        and would contaminate backtests.
        """
        bar_ms = timeframe_to_ms(timeframe)
        if now_ms is None:
            now_ms = _now_ms()
        start_ms = int(start.value // 1_000_000)
        # Last fully-closed bar opens at or before now - bar.
        closed_end = now_ms - bar_ms + 1

        stored = 0
        first = self._store.first_timestamp(self._exchange, symbol, timeframe)
        last = self._store.last_timestamp(self._exchange, symbol, timeframe)

        if first is not None and int(first.value // 1_000_000) > start_ms + bar_ms:
            head_end = int(first.value // 1_000_000)
            stored += self._fetch_and_store(
                symbol, timeframe, start_ms, head_end, batch_limit, now_ms, bar_ms
            )

        since_ms = (
            start_ms if last is None else int(last.value // 1_000_000) - (_REFRESH_BARS - 1) * bar_ms
        )
        stored += self._fetch_and_store(
            symbol, timeframe, since_ms, closed_end, batch_limit, now_ms, bar_ms
        )
        return stored

    def _fetch_and_store(
        self,
        symbol: str,
        timeframe: str,
        since_ms: int,
        until_ms: int,
        batch_limit: int,
        now_ms: int,
        bar_ms: int,
    ) -> int:
        if since_ms >= until_ms:
            return 0
        df = self.fetch_range(symbol, timeframe, since_ms, until_ms, batch_limit=batch_limit)
        if df.empty:
            return 0
        # Resolution-independent epoch-ms (index may be datetime64[ms] or [ns]).
        index = cast(pd.DatetimeIndex, df.index)
        open_ms = (index - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1)
        df = df[open_ms + bar_ms <= now_ms]
        if df.empty:
            return 0
        self._store.write(self._exchange, symbol, timeframe, df)
        return len(df)
