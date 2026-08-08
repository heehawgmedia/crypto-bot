"""Pull the newest bars for a strategy's market and hand back the frame.

Shared by every live-data consumer (paper loop, live loop, dashboard server)
so they all see the same history, fetched the same way.
"""

from __future__ import annotations

import pandas as pd

from quant_lab.config import AppConfig, StrategyInstanceConfig
from quant_lab.data.fetcher import OhlcvFetcher, make_ccxt_client
from quant_lab.data.resample import derive_timeframe, pick_source
from quant_lab.data.store import ParquetStore


def refresh_and_read(cfg: AppConfig, scfg: StrategyInstanceConfig) -> pd.DataFrame:
    """Fetch new candles for the strategy's market and return the full frame.

    The fetcher stores only closed candles, so the last row is always a
    completed bar — safe to compute signals on. Exchanges that do not serve
    the requested timeframe (Coinbase has no 4h) fall back to deriving it
    from finer bars.
    """
    source = scfg.data_source
    client = make_ccxt_client(source, cfg.exchanges[source].rate_limit_ms)
    store = ParquetStore(cfg.data.parquet_dir)
    fetcher = OhlcvFetcher(client, store, source)
    start = pd.Timestamp(cfg.data.start_date, tz="UTC")
    try:
        fetcher.update(scfg.symbol, scfg.timeframe, start)
    except Exception:  # noqa: BLE001 - timeframe unsupported: derive from finer bars
        src = pick_source(cfg.data.timeframes, scfg.timeframe)
        if src is not None:
            fetcher.update(scfg.symbol, src, start)
            derive_timeframe(store, source, scfg.symbol, src, scfg.timeframe)
    return store.read(source, scfg.symbol, scfg.timeframe)
