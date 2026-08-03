"""quant-lab CLI. Phase 1 exposes the data layer; later phases add
backtest / validate / paper / live / risk sub-apps."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import pandas as pd
import typer

from quant_lab.config import AppConfig, load_config
from quant_lab.data.fetcher import OhlcvFetcher, make_ccxt_client
from quant_lab.data.integrity import check_ohlcv
from quant_lab.data.store import ParquetStore

app = typer.Typer(no_args_is_help=True, help="Crypto strategy research and execution pipeline.")
data_app = typer.Typer(no_args_is_help=True, help="Fetch, update, and verify OHLCV data.")
app.add_typer(data_app, name="data")

ConfigOpt = Annotated[
    Path, typer.Option("--config", "-c", help="Path to config.yaml", exists=True, dir_okay=False)
]
DEFAULT_CONFIG = Path("config/config.yaml")


def _load(config_path: Path) -> AppConfig:
    try:
        return load_config(config_path)
    except Exception as exc:
        typer.secho(f"config error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc


def _targets(
    cfg: AppConfig, symbol: str | None, timeframe: str | None
) -> list[tuple[str, str]]:
    symbols = [symbol] if symbol else cfg.data.symbols
    timeframes = [timeframe] if timeframe else cfg.data.timeframes
    return [(s, tf) for s in symbols for tf in timeframes]


@data_app.command()
def update(
    config: ConfigOpt = DEFAULT_CONFIG,
    symbol: Annotated[str | None, typer.Option(help="Limit to one symbol")] = None,
    timeframe: Annotated[str | None, typer.Option(help="Limit to one timeframe")] = None,
) -> None:
    """Fetch new OHLCV bars for configured symbols/timeframes (incremental)."""
    cfg = _load(config)
    exchange = cfg.data.exchange
    client = make_ccxt_client(exchange, cfg.exchanges[exchange].rate_limit_ms)
    store = ParquetStore(cfg.data.parquet_dir)
    fetcher = OhlcvFetcher(client, store, exchange)
    start = pd.Timestamp(cfg.data.start_date, tz="UTC")

    for sym, tf in _targets(cfg, symbol, timeframe):
        fetched = fetcher.update(sym, tf, start)
        total = len(store.read(exchange, sym, tf))
        typer.echo(f"{exchange} {sym} {tf}: fetched {fetched} bars, {total} stored")


@data_app.command()
def check(
    config: ConfigOpt = DEFAULT_CONFIG,
    symbol: Annotated[str | None, typer.Option(help="Limit to one symbol")] = None,
    timeframe: Annotated[str | None, typer.Option(help="Limit to one timeframe")] = None,
) -> None:
    """Run integrity checks on stored data; exits non-zero on any failure."""
    cfg = _load(config)
    store = ParquetStore(cfg.data.parquet_dir)
    failed = False
    for sym, tf in _targets(cfg, symbol, timeframe):
        df = store.read(cfg.data.exchange, sym, tf)
        report = check_ohlcv(df, tf, cfg.data.max_gap_bars)
        typer.echo(f"{cfg.data.exchange} {sym} {tf}: {report.summary()}")
        failed = failed or not report.ok
    if failed:
        raise typer.Exit(code=1)


@data_app.command("ls")
def ls(config: ConfigOpt = DEFAULT_CONFIG) -> None:
    """Show what's in the store for each configured symbol/timeframe."""
    cfg = _load(config)
    store = ParquetStore(cfg.data.parquet_dir)
    for sym, tf in _targets(cfg, None, None):
        df = store.read(cfg.data.exchange, sym, tf)
        if df.empty:
            typer.echo(f"{cfg.data.exchange} {sym} {tf}: (no data)")
        else:
            typer.echo(
                f"{cfg.data.exchange} {sym} {tf}: {len(df)} bars, "
                f"{df.index[0]} -> {df.index[-1]}"
            )


if __name__ == "__main__":
    app()
