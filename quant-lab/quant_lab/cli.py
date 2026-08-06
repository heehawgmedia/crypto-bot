"""quant-lab CLI."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import pandas as pd
import typer

from quant_lab.alerts import alerter_from_config
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel, buy_and_hold, run_backtest
from quant_lab.config import AppConfig, StrategyInstanceConfig, load_config, load_strategy_config
from quant_lab.data.fetcher import OhlcvFetcher, make_ccxt_client
from quant_lab.data.integrity import check_ohlcv
from quant_lab.data.store import ParquetStore
from quant_lab.paper.engine import PaperEngine
from quant_lab.reporting.metrics import compute_metrics
from quant_lab.reporting.tearsheet import render_tearsheet
from quant_lab.risk.killswitch import KillSwitchMonitor
from quant_lab.strategies import build_strategy
from quant_lab.validation.gates import (
    check_transition,
    evaluate_live_gate,
    evaluate_validation_gate,
)
from quant_lab.validation.walkforward import run_walkforward

app = typer.Typer(no_args_is_help=True, help="Crypto strategy research and execution pipeline.")
data_app = typer.Typer(no_args_is_help=True, help="Fetch, update, and verify OHLCV data.")
backtest_app = typer.Typer(no_args_is_help=True, help="Run in-sample backtests (research only).")
validate_app = typer.Typer(no_args_is_help=True, help="Walk-forward validation (the only promotion path).")
promote_app = typer.Typer(no_args_is_help=True, help="Promote strategies through pipeline stages.")
paper_app = typer.Typer(no_args_is_help=True, help="Paper trading on live data, simulated fills.")
live_app = typer.Typer(no_args_is_help=True, help="Live execution (capital-capped, gated).")
risk_app = typer.Typer(no_args_is_help=True, help="Kill-switch status and manual reset.")
audit_app = typer.Typer(no_args_is_help=True, help="Inspect the audit trail.")
app.add_typer(data_app, name="data")
app.add_typer(backtest_app, name="backtest")
app.add_typer(validate_app, name="validate")
app.add_typer(promote_app, name="promote")
app.add_typer(paper_app, name="paper")
app.add_typer(live_app, name="live")
app.add_typer(risk_app, name="risk")
app.add_typer(audit_app, name="audit")


def _open_audit(cfg: AppConfig) -> AuditLog:
    """Open the audit DB and record the active config (hash) so any config
    change between runs lands in the audit trail."""
    import hashlib

    audit = AuditLog(cfg.audit.sqlite_path)
    snapshot = cfg.model_dump_json()
    audit.note_config(hashlib.sha256(snapshot.encode()).hexdigest(), snapshot)
    return audit

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
    """Fetch new OHLCV bars for configured symbols/timeframes (incremental).

    Timeframes the exchange can't serve are derived locally from a finer
    configured timeframe (e.g. 4h from 1h)."""
    from quant_lab.data.resample import derive_timeframe, pick_source

    cfg = _load(config)
    exchange = cfg.data.exchange
    client = make_ccxt_client(exchange, cfg.exchanges[exchange].rate_limit_ms)
    store = ParquetStore(cfg.data.parquet_dir)
    fetcher = OhlcvFetcher(client, store, exchange)
    start = pd.Timestamp(cfg.data.start_date, tz="UTC")

    for sym, tf in _targets(cfg, symbol, timeframe):
        try:
            fetched = fetcher.update(sym, tf, start)
            total = len(store.read(exchange, sym, tf))
            typer.echo(f"{exchange} {sym} {tf}: fetched {fetched} bars, {total} stored")
        except Exception as exc:  # noqa: BLE001 - fall back to local derivation
            src = pick_source(cfg.data.timeframes, tf)
            if src is not None and not store.read(exchange, sym, src).empty:
                n = derive_timeframe(store, exchange, sym, src, tf)
                total = len(store.read(exchange, sym, tf))
                typer.echo(
                    f"{exchange} {sym} {tf}: derived {n} bars from {src} "
                    f"(exchange fetch failed), {total} stored"
                )
            else:
                typer.secho(
                    f"{exchange} {sym} {tf}: fetch failed ({exc})",
                    fg=typer.colors.YELLOW,
                    err=True,
                )


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


@data_app.command("import-csv")
def import_csv(
    path: Annotated[Path, typer.Argument(exists=True, dir_okay=False, help="CSV file to import")],
    symbol: Annotated[str, typer.Option(help="Market symbol, e.g. BTC/USD")],
    timeframe: Annotated[str, typer.Option(help="Bar timeframe, e.g. 1h")],
    config: ConfigOpt = DEFAULT_CONFIG,
    exchange: Annotated[str | None, typer.Option(help="Exchange (default: data.exchange)")] = None,
) -> None:
    """Bulk-import OHLCV history from a CSV (e.g. Kraken's OHLCVT archives).

    Kraken's API only serves the most recent ~720 candles; use their
    downloadable OHLCVT files for deep history, then keep current with
    `quant-lab data update`.
    """
    from quant_lab.data.importer import read_ohlcv_csv

    cfg = _load(config)
    exch = exchange or cfg.data.exchange
    try:
        df = read_ohlcv_csv(path)
    except ValueError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2) from exc
    store = ParquetStore(cfg.data.parquet_dir)
    total = store.write(exch, symbol, timeframe, df)
    typer.echo(f"imported {len(df)} bars from {path}; {total} stored for {exch} {symbol} {timeframe}")
    report = check_ohlcv(
        store.read(exch, symbol, timeframe), timeframe, cfg.data.max_gap_bars
    )
    typer.echo(report.summary())
    if not report.ok:
        raise typer.Exit(code=1)


StrategyOpt = Annotated[
    Path,
    typer.Option("--strategy", "-s", help="Path to a strategy YAML", exists=True, dir_okay=False),
]


def _load_strategy_inputs(
    cfg: AppConfig, strategy_path: Path
) -> tuple[StrategyInstanceConfig, pd.DataFrame, CostModel]:
    scfg = load_strategy_config(strategy_path)
    for exch in {scfg.exchange, scfg.data_source}:
        if exch not in cfg.exchanges:
            typer.secho(f"exchange {exch!r} not configured", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2)
    store = ParquetStore(cfg.data.parquet_dir)
    df = store.read(scfg.data_source, scfg.symbol, scfg.timeframe)
    if df.empty:
        typer.secho(
            f"no stored data for {scfg.data_source} {scfg.symbol} {scfg.timeframe}; "
            "run `quant-lab data update` first",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=2)
    report = check_ohlcv(df, scfg.timeframe, cfg.data.max_gap_bars)
    if not report.ok:
        typer.secho("data integrity check failed:", fg=typer.colors.RED, err=True)
        typer.echo(report.summary(), err=True)
        raise typer.Exit(code=2)
    cost = CostModel(
        taker_fee_bps=cfg.exchanges[scfg.exchange].taker_fee_bps,
        slippage_bps=cfg.backtest.slippage_bps,
    )
    return scfg, df, cost


@backtest_app.command("run")
def backtest_run(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Backtest a strategy YAML over all stored history.

    This is a research tool: results here are IN-SAMPLE and are never a
    promotion criterion. Walk-forward OOS results are the official record.
    """
    from quant_lab.risk.stops import TradeRules

    cfg = _load(config)
    scfg, df, cost = _load_strategy_inputs(cfg, strategy)
    strat = build_strategy(scfg.strategy, scfg.params)

    result = run_backtest(
        df,
        strat.signals(df),
        cost,
        cfg.backtest.initial_capital_usd,
        rules=TradeRules.from_strategy(scfg),
    )
    bench = buy_and_hold(df, cost, cfg.backtest.initial_capital_usd)
    sheet = render_tearsheet(
        f"[IN-SAMPLE] {scfg.name} ({scfg.strategy} on {scfg.exchange} "
        f"{scfg.symbol} {scfg.timeframe})",
        compute_metrics(result, scfg.timeframe),
        compute_metrics(bench, scfg.timeframe),
        (df.index[0], df.index[-1]),
    )
    typer.echo(sheet)
    typer.secho(
        "\nNOTE: in-sample only. Run `quant-lab validate run` for the official "
        "walk-forward OOS record.",
        fg=typer.colors.YELLOW,
    )


@validate_app.command("run")
def validate_run(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Walk-forward validate a strategy; on a gate pass, record stage=validated.

    The stitched out-of-sample record printed here is the strategy's official
    performance. In-sample numbers are used only to select parameters.
    """
    cfg = _load(config)
    scfg, df, cost = _load_strategy_inputs(cfg, strategy)

    from quant_lab.risk.stops import TradeRules

    try:
        wf = run_walkforward(
            df,
            scfg.strategy,
            scfg.params,
            scfg.param_grid,
            cfg.walkforward,
            cost,
            cfg.backtest.initial_capital_usd,
            scfg.timeframe,
            rules=TradeRules.from_strategy(scfg),
        )
    except ValueError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.echo(f"walk-forward windows: {len(wf.windows)}")
    for w in wf.windows:
        oos = w.oos_result
        typer.echo(
            f"  [{w.window.index}] OOS {df.index[w.window.oos_start]} -> "
            f"{df.index[w.window.oos_end - 1]}  params={w.best_params}  "
            f"oos_return={(oos.final_equity / oos.initial_capital - 1) * 100:+.2f}%  "
            f"closed_trades={len(oos.closed_trades)}"
        )

    stitched = wf.as_backtest_result()
    oos_start_i = wf.windows[0].window.oos_start
    oos_end_i = wf.windows[-1].window.oos_end
    bench = buy_and_hold(df.iloc[oos_start_i:oos_end_i], cost, cfg.backtest.initial_capital_usd)
    typer.echo("")
    typer.echo(
        render_tearsheet(
            f"[OFFICIAL OOS RECORD] {scfg.name}",
            compute_metrics(stitched, scfg.timeframe),
            compute_metrics(bench, scfg.timeframe),
            (df.index[oos_start_i], df.index[oos_end_i - 1]),
        )
    )

    decision = evaluate_validation_gate(wf, cfg, scfg.timeframe)
    typer.echo("")
    audit = _open_audit(cfg)
    if decision.passed:
        current = audit.get_stage(scfg.name)
        if current == "candidate":
            audit.set_stage(
                scfg.name,
                "validated",
                {"windows": len(wf.windows), "closed_oos_trades": len(wf.closed_oos_trades)},
            )
            typer.secho(
                f"gate: PASS — {scfg.name} promoted to 'validated'", fg=typer.colors.GREEN
            )
        else:
            # Re-validation of an already-promoted strategy: report, don't move.
            audit.record(
                "revalidation_pass",
                {"windows": len(wf.windows), "closed_oos_trades": len(wf.closed_oos_trades)},
                strategy=scfg.name,
            )
            typer.secho(
                f"gate: PASS — {scfg.name} remains at stage {current!r}", fg=typer.colors.GREEN
            )
    else:
        audit.record(
            "validation_rejected", {"reasons": decision.reasons}, strategy=scfg.name
        )
        typer.secho(f"gate: {decision.summary()}", fg=typer.colors.RED)
        raise typer.Exit(code=1)


@promote_app.command("paper")
def promote_paper(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Move a validated strategy into paper trading (starts the paper clock)."""
    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    transition = check_transition(audit.get_stage(scfg.name), "paper")
    if not transition.passed:
        typer.secho(transition.summary(), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    audit.set_stage(scfg.name, "paper", {})
    typer.secho(
        f"{scfg.name} promoted to 'paper'. Live promotion unlocks after "
        f"{cfg.promotion.min_paper_days} days of paper trading.",
        fg=typer.colors.GREEN,
    )


@promote_app.command("live")
def promote_live(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Promote paper -> live: shows the full paper track record, checks the
    minimum paper duration, and requires typing the exact strategy name."""
    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)

    transition = check_transition(audit.get_stage(scfg.name), "live")
    if not transition.passed:
        typer.secho(transition.summary(), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    if cfg.risk.max_capital_usd is None:
        typer.secho(
            "risk.max_capital_usd is not set; set an explicit capital cap in "
            "config before any live promotion",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    # Full paper track record, on the record before any confirmation.
    fills = audit.fills(strategy=scfg.name, mode="paper")
    state = audit.get_paper_state(scfg.name)
    started = audit.paper_started_at(scfg.name)
    typer.echo(f"paper track record for {scfg.name} (started {started}):")
    if not fills:
        typer.echo("  (no paper fills recorded)")
    for f in fills:
        typer.echo(
            f"  {f['ts_utc']}  {f['side']:<4} {f['qty']:.8f} {f['symbol']} "
            f"@ {f['price']:.2f}  fee ${f['fee_usd']:.2f}"
        )
    if state is not None:
        typer.echo(
            f"  current paper state: cash ${state['cash_usd']:.2f}, "
            f"units {state['units']:.8f}"
        )

    typer.echo("")
    typed = typer.prompt(
        f"Type the strategy name exactly ({scfg.name!r}) to confirm LIVE promotion"
    )
    decision = evaluate_live_gate(started, typed, scfg.name, cfg)
    if not decision.passed:
        audit.record("live_promotion_rejected", {"reasons": decision.reasons}, strategy=scfg.name)
        typer.secho(decision.summary(), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    audit.set_stage(scfg.name, "live", {"paper_fills": len(fills)})
    typer.secho(
        f"{scfg.name} promoted to 'live'. Capital cap: "
        f"${cfg.risk.max_capital_usd:,.2f}. Set mode: live in config to enable execution.",
        fg=typer.colors.GREEN,
    )


def _refresh_and_read(
    cfg: AppConfig, scfg: StrategyInstanceConfig
) -> pd.DataFrame:
    """Fetch the newest bars for the strategy's market and return the frame.

    The fetcher stores only closed candles, so the last row is always a
    completed bar — safe to compute signals on."""
    from quant_lab.data.resample import derive_timeframe, pick_source

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


@paper_app.command("run")
def paper_run(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
    once: Annotated[bool, typer.Option("--once", help="Single poll instead of a loop")] = False,
    interval: Annotated[int, typer.Option(help="Poll interval in seconds")] = 60,
) -> None:
    """Run paper trading: live market data, simulated fills, durable state."""
    import time

    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    stage = audit.get_stage(scfg.name)
    if stage not in ("paper", "live"):
        typer.secho(
            f"{scfg.name} is at stage {stage!r}; run `quant-lab validate run` then "
            "`quant-lab promote paper` first",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    cost = CostModel(
        taker_fee_bps=cfg.exchanges[scfg.exchange].taker_fee_bps,
        slippage_bps=cfg.backtest.slippage_bps,
    )
    engine = PaperEngine(
        scfg, cost, audit, cfg.backtest.initial_capital_usd, alerter_from_config(cfg.alerts)
    )
    while True:
        try:
            df = _refresh_and_read(cfg, scfg)
            if df.empty:
                typer.secho("no data returned from exchange", fg=typer.colors.YELLOW)
            else:
                step = engine.step(df)
                typer.echo(
                    f"{step.bar_time}  equity ${step.equity_usd:,.2f}  {step.detail}"
                )
        except Exception as exc:
            if once:
                raise
            typer.secho(f"poll failed, retrying in {interval}s: {exc}", fg=typer.colors.YELLOW)
        if once:
            break
        time.sleep(interval)


@paper_app.command("status")
def paper_status(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Show the paper track record: start date, state, and every fill."""
    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    typer.echo(f"stage: {audit.get_stage(scfg.name)}")
    typer.echo(f"paper started: {audit.paper_started_at(scfg.name)}")
    state = audit.get_paper_state(scfg.name)
    if state is not None:
        typer.echo(
            f"state: cash ${state['cash_usd']:,.2f}, units {state['units']:.8f}, "
            f"last bar {state['last_bar_utc']}"
        )
    fills = audit.fills(strategy=scfg.name, mode="paper")
    typer.echo(f"fills: {len(fills)}")
    for f in fills:
        typer.echo(
            f"  {f['ts_utc']}  {f['side']:<4} {f['qty']:.8f} {f['symbol']} "
            f"@ {f['price']:.2f}  fee ${f['fee_usd']:.2f}"
        )


@live_app.command("run")
def live_run(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
    once: Annotated[bool, typer.Option("--once", help="Single poll instead of a loop")] = False,
    interval: Annotated[int, typer.Option(help="Poll interval in seconds")] = 60,
) -> None:
    """Run live execution. Requires mode=live, stage=live, and API keys in env.

    Every constraint (capital cap, kill switches, spot-only) is enforced inside
    the engine; this command only wires it together.
    """
    import time

    from quant_lab.live.engine import LiveEngine
    from quant_lab.live.market_rules import rules_from_ccxt
    from quant_lab.live.reconcile import reconcile_position

    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    client = _authed_client(scfg)

    # Position reconciliation is a hard precondition: the audited book must
    # actually exist on the exchange before any order can go out.
    report = reconcile_position(client, audit, scfg, cfg.risk.reconcile_tolerance_frac)
    typer.echo(report.detail)
    if not report.ok:
        raise typer.Exit(code=1)

    try:
        rules = rules_from_ccxt(client, scfg.symbol)
    except Exception as exc:
        typer.secho(f"could not load market rules: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    killswitch = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    alerter = alerter_from_config(cfg.alerts)
    try:
        engine = LiveEngine(scfg, cfg, client, audit, killswitch, alerter, rules=rules)
    except RuntimeError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(
        f"LIVE trading {scfg.name} on {scfg.exchange} {scfg.symbol} — capital cap "
        f"${cfg.risk.max_capital_usd:,.2f}",
        fg=typer.colors.YELLOW,
    )
    while True:
        try:
            df = _refresh_and_read(cfg, scfg)
            if df.empty:
                typer.secho("no data returned from exchange", fg=typer.colors.YELLOW)
            else:
                step = engine.step(df)
                typer.echo(f"{df.index[-1]}  {step.detail}")
        except Exception as exc:
            if once:
                raise
            typer.secho(f"poll failed, retrying in {interval}s: {exc}", fg=typer.colors.YELLOW)
        if once:
            break
        time.sleep(interval)


def _authed_client(scfg: StrategyInstanceConfig):  # type: ignore[no-untyped-def]
    """ccxt client with API keys from env; exits with guidance when missing."""
    import os

    import ccxt

    prefix = f"QL_{scfg.exchange.upper()}"
    api_key = os.environ.get(f"{prefix}_API_KEY", "")
    api_secret = os.environ.get(f"{prefix}_API_SECRET", "")
    if not api_key or not api_secret:
        typer.secho(
            f"missing {prefix}_API_KEY / {prefix}_API_SECRET in environment",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)
    return getattr(ccxt, scfg.exchange)(
        {"apiKey": api_key, "secret": api_secret, "enableRateLimit": True}
    )


@live_app.command("reconcile")
def live_reconcile(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Check that the audited position actually exists on the exchange.

    Run this after any order error, and any time you move funds manually.
    Non-zero exit on drift.
    """
    from quant_lab.live.reconcile import reconcile_position

    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    client = _authed_client(scfg)
    report = reconcile_position(client, audit, scfg, cfg.risk.reconcile_tolerance_frac)
    typer.echo(report.detail)
    if not report.ok:
        raise typer.Exit(code=1)


@risk_app.command("status")
def risk_status(config: ConfigOpt = DEFAULT_CONFIG) -> None:
    """Show kill-switch state and configured limits."""
    cfg = _load(config)
    audit = _open_audit(cfg)
    tripped, reason, ts = audit.kill_switch_state()
    ks = cfg.risk.kill_switches
    typer.echo(f"kill switch: {'TRIPPED' if tripped else 'armed (not tripped)'}")
    if tripped:
        typer.echo(f"  reason: {reason}")
        typer.echo(f"  tripped at: {ts}")
    typer.echo(
        f"limits: daily loss {ks.max_daily_loss_pct}%, drawdown {ks.max_drawdown_pct}%, "
        f"api errors {ks.max_consecutive_api_errors}, flatten_on_trip={ks.flatten_on_trip}"
    )
    cap = cfg.risk.max_capital_usd
    typer.echo(f"max_capital_usd: {'NOT SET' if cap is None else f'${cap:,.2f}'}")


@risk_app.command("reset")
def risk_reset(config: ConfigOpt = DEFAULT_CONFIG) -> None:
    """Manually reset a tripped kill switch (the only way to re-enable trading)."""
    cfg = _load(config)
    audit = _open_audit(cfg)
    tripped, reason, ts = audit.kill_switch_state()
    if not tripped:
        typer.echo("kill switch is not tripped; nothing to reset")
        raise typer.Exit(code=0)
    typer.echo(f"kill switch tripped at {ts}: {reason}")
    typed = typer.prompt("Type RESET to confirm re-enabling trading")
    if typed != "RESET":
        typer.secho("confirmation mismatch; kill switch remains tripped", fg=typer.colors.RED)
        raise typer.Exit(code=1)
    audit.reset_kill_switch(confirmed_by="cli")
    typer.secho("kill switch reset; trading re-enabled", fg=typer.colors.GREEN)


@app.command("setup")
def setup(config: ConfigOpt = DEFAULT_CONFIG) -> None:
    """One-shot bootstrap: download history, verify it, and print what's next.

    Safe to re-run any time — data updates are incremental and nothing here
    trades or needs API keys.
    """
    cfg = _load(config)
    _open_audit(cfg)
    exchange = cfg.data.exchange
    store = ParquetStore(cfg.data.parquet_dir)
    start = pd.Timestamp(cfg.data.start_date, tz="UTC")
    targets = _targets(cfg, None, None)

    typer.secho(f"[1/3] downloading OHLCV history from {exchange}...", bold=True)
    client = make_ccxt_client(exchange, cfg.exchanges[exchange].rate_limit_ms)
    fetcher = OhlcvFetcher(client, store, exchange)
    failed: list[tuple[str, str]] = []
    for sym, tf in targets:
        try:
            fetched = fetcher.update(sym, tf, start)
            total = len(store.read(exchange, sym, tf))
            typer.echo(f"  {sym} {tf}: +{fetched} bars ({total} total)")
        except Exception as exc:  # noqa: BLE001 - setup reports and continues
            failed.append((sym, tf))
            typer.secho(f"  {sym} {tf}: fetch failed ({exc})", fg=typer.colors.YELLOW)

    # Timeframes the exchange can't serve (e.g. coinbase has no 4h) are built
    # locally from a finer stored timeframe.
    from quant_lab.data.resample import derive_timeframe, pick_source

    derive_targets = [t for t in failed] + [
        (sym, tf) for sym, tf in targets
        if (sym, tf) not in failed and store.read(exchange, sym, tf).empty
    ]
    still_failed = 0
    for sym, tf in derive_targets:
        src = pick_source(cfg.data.timeframes, tf)
        if src is not None and not store.read(exchange, sym, src).empty:
            n = derive_timeframe(store, exchange, sym, src, tf)
            typer.echo(f"  {sym} {tf}: derived {n} bars locally from {src} data")
        else:
            still_failed += 1
    if still_failed:
        typer.secho(
            f"  {still_failed} dataset(s) unavailable — check your internet "
            "connection and re-run `quant-lab setup`; already-stored data is kept.",
            fg=typer.colors.YELLOW,
        )

    typer.secho("[2/3] verifying data integrity...", bold=True)
    have_data = False
    all_ok = True
    for sym, tf in targets:
        df = store.read(exchange, sym, tf)
        if df.empty:
            typer.echo(f"  {sym} {tf}: no data")
            all_ok = False
            continue
        have_data = True
        report = check_ohlcv(df, tf, cfg.data.max_gap_bars)
        typer.echo(f"  {sym} {tf}: {report.summary().splitlines()[0]}")
        all_ok = all_ok and report.ok

    typer.secho("[3/3] next steps", bold=True)
    strategies_dir = Path("config/strategies")
    yamls = sorted(strategies_dir.glob("*.yaml")) if strategies_dir.is_dir() else []
    if not have_data:
        typer.secho(
            "no data yet — get online and re-run `quant-lab setup`", fg=typer.colors.RED
        )
        raise typer.Exit(code=1)
    typer.echo("  validate a strategy (the only path toward live trading):")
    for path in yamls:
        typer.echo(f"    quant-lab validate run -s {path}")
    typer.echo("  then: quant-lab promote paper -s <yaml>  ->  quant-lab paper run -s <yaml>")
    typer.echo("  check progress any time with: quant-lab status")
    if not all_ok:
        typer.secho(
            "note: some datasets have integrity issues (see [2/3]); validation "
            "refuses bad data, so re-run setup or investigate before validating.",
            fg=typer.colors.YELLOW,
        )


@app.command("status")
def status(
    config: ConfigOpt = DEFAULT_CONFIG,
    strategies_dir: Annotated[
        Path, typer.Option(help="Directory of strategy YAMLs")
    ] = Path("config/strategies"),
) -> None:
    """Pipeline overview: every strategy's stage, paper clock, and fills."""
    from datetime import UTC, datetime

    cfg = _load(config)
    audit = _open_audit(cfg)
    tripped, reason, _ = audit.kill_switch_state()
    typer.echo(f"mode: {cfg.mode.value}")
    cap = cfg.risk.max_capital_usd
    typer.echo(f"capital cap: {'NOT SET' if cap is None else f'${cap:,.2f}'}")
    typer.echo(f"kill switch: {'TRIPPED — ' + str(reason) if tripped else 'armed'}")
    typer.echo("")

    yamls = sorted(strategies_dir.glob("*.yaml")) if strategies_dir.is_dir() else []
    if not yamls:
        typer.echo(f"(no strategy YAMLs found in {strategies_dir})")
        return
    for path in yamls:
        try:
            scfg = load_strategy_config(path)
        except Exception as exc:  # noqa: BLE001 - preflight reports, never crashes
            typer.secho(f"{path.name}: invalid ({exc})", fg=typer.colors.RED)
            continue
        stage = audit.get_stage(scfg.name)
        line = (
            f"{scfg.name:<24} {stage:<10} {scfg.strategy} on "
            f"{scfg.exchange} {scfg.symbol} {scfg.timeframe}"
        )
        started = audit.paper_started_at(scfg.name)
        if started is not None and stage in ("paper", "live"):
            days = (datetime.now(UTC) - started).total_seconds() / 86_400
            fills = len(audit.fills(strategy=scfg.name, mode="paper"))
            line += f"  | paper {days:.1f}/{cfg.promotion.min_paper_days}d, {fills} fills"
        typer.echo(line)


@live_app.command("preflight")
def live_preflight(
    strategy: StrategyOpt,
    config: ConfigOpt = DEFAULT_CONFIG,
) -> None:
    """Read-only go-live checklist. Places NO orders.

    Verifies: config mode + capital cap, strategy stage, kill switch, API key
    connectivity, market rules for the symbol, data freshness, and position
    reconciliation. Non-zero exit if anything blocks going live.
    """
    from quant_lab.live.market_rules import rules_from_ccxt
    from quant_lab.live.reconcile import reconcile_position

    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = _open_audit(cfg)
    ok = True

    def check(label: str, passed: bool, detail: str) -> None:
        nonlocal ok
        ok = ok and passed
        mark = typer.style("PASS", fg=typer.colors.GREEN) if passed else typer.style(
            "FAIL", fg=typer.colors.RED
        )
        typer.echo(f"[{mark}] {label}: {detail}")

    check("mode", cfg.mode.value == "live", f"config mode is {cfg.mode.value!r}")
    cap = cfg.risk.max_capital_usd
    check("capital cap", cap is not None, "NOT SET" if cap is None else f"${cap:,.2f}")
    stage = audit.get_stage(scfg.name)
    check("stage", stage == "live", f"{scfg.name} is at stage {stage!r}")
    tripped, reason, _ = audit.kill_switch_state()
    check("kill switch", not tripped, str(reason) if tripped else "armed, not tripped")

    store = ParquetStore(cfg.data.parquet_dir)
    df = store.read(scfg.data_source, scfg.symbol, scfg.timeframe)
    if df.empty:
        check("data", False, "no stored history — run `quant-lab data update`")
    else:
        report = check_ohlcv(df, scfg.timeframe, cfg.data.max_gap_bars)
        check("data", report.ok, f"{len(df)} bars, last {df.index[-1]}")

    try:
        client = _authed_client(scfg)
        balance_ok = True
        try:
            client.fetch_balance()
        except Exception as exc:  # noqa: BLE001 - preflight reports, never crashes
            balance_ok = False
            check("api keys", False, f"balance query failed: {exc}")
        if balance_ok:
            check("api keys", True, "balance query succeeded")
            try:
                rules = rules_from_ccxt(client, scfg.symbol)
                check(
                    "market rules",
                    True,
                    f"min {rules.amount_min}, step {rules.amount_step}, "
                    f"min notional {rules.cost_min}",
                )
            except Exception as exc:  # noqa: BLE001 - preflight reports, never crashes
                check("market rules", False, str(exc))
            rec = reconcile_position(client, audit, scfg, cfg.risk.reconcile_tolerance_frac)
            check("reconcile", rec.ok, rec.detail)
    except typer.Exit:
        check("api keys", False, "QL_*_API_KEY / QL_*_API_SECRET not set")

    typer.echo("")
    if ok:
        typer.secho("preflight PASS — ready for `quant-lab live run`", fg=typer.colors.GREEN)
    else:
        typer.secho("preflight FAIL — resolve the failures above", fg=typer.colors.RED)
        raise typer.Exit(code=1)


@audit_app.command("events")
def audit_events(
    config: ConfigOpt = DEFAULT_CONFIG,
    kind: Annotated[str | None, typer.Option(help="Filter by event kind")] = None,
    strategy: Annotated[str | None, typer.Option(help="Filter by strategy name")] = None,
    limit: Annotated[int, typer.Option(help="Show at most N most-recent events")] = 50,
) -> None:
    """Show audit events (promotions, kill-switch trips, config changes, errors...)."""
    cfg = _load(config)
    audit = _open_audit(cfg)
    rows = audit.events(kind=kind, strategy=strategy)
    for row in rows[-limit:]:
        who = f" [{row['strategy']}]" if row["strategy"] else ""
        typer.echo(f"{row['ts_utc']}  {row['kind']}{who}  {row['payload']}")
    typer.echo(f"({min(limit, len(rows))} of {len(rows)} events)")


@audit_app.command("orders")
def audit_orders(
    config: ConfigOpt = DEFAULT_CONFIG,
    strategy: Annotated[str | None, typer.Option(help="Filter by strategy name")] = None,
    mode: Annotated[str | None, typer.Option(help="paper or live")] = None,
    status: Annotated[str | None, typer.Option(help="filled, rejected, or error")] = None,
) -> None:
    """Show the order log, including rejections and errors."""
    cfg = _load(config)
    audit = _open_audit(cfg)
    for row in audit.orders(strategy=strategy, mode=mode, status=status):
        reason = f"  ({row['reason']})" if row["reason"] else ""
        coid = f"  coid={row['client_order_id']}" if row["client_order_id"] else ""
        typer.echo(
            f"{row['ts_utc']}  [{row['mode']}] {row['strategy']}  {row['side']:<4} "
            f"{row['qty']:.8f} {row['symbol']} @ {row['price']}  {row['status']}"
            f"{reason}{coid}"
        )


@audit_app.command("export")
def audit_export(
    out: Annotated[Path, typer.Option("--out", "-o", help="Output CSV path")],
    config: ConfigOpt = DEFAULT_CONFIG,
    strategy: Annotated[str | None, typer.Option(help="Filter by strategy name")] = None,
    mode: Annotated[str | None, typer.Option(help="paper or live")] = None,
) -> None:
    """Export the fill log to CSV (e.g. for tax reporting)."""
    import csv

    cfg = _load(config)
    audit = _open_audit(cfg)
    rows = audit.fills(strategy=strategy, mode=mode)
    with out.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["ts_utc", "mode", "strategy", "symbol", "side", "qty", "price", "fee_usd"]
        )
        for row in rows:
            writer.writerow(
                [
                    row["ts_utc"], row["mode"], row["strategy"], row["symbol"],
                    row["side"], f"{row['qty']:.10f}", f"{row['price']:.8f}",
                    f"{row['fee_usd']:.6f}",
                ]
            )
    typer.echo(f"exported {len(rows)} fills to {out}")


@audit_app.command("fills")
def audit_fills(
    config: ConfigOpt = DEFAULT_CONFIG,
    strategy: Annotated[str | None, typer.Option(help="Filter by strategy name")] = None,
    mode: Annotated[str | None, typer.Option(help="paper or live")] = None,
) -> None:
    """Show the fill log."""
    cfg = _load(config)
    audit = _open_audit(cfg)
    for row in audit.fills(strategy=strategy, mode=mode):
        typer.echo(
            f"{row['ts_utc']}  [{row['mode']}] {row['strategy']}  {row['side']:<4} "
            f"{row['qty']:.8f} {row['symbol']} @ {row['price']:.2f}  fee ${row['fee_usd']:.2f}"
        )


if __name__ == "__main__":
    app()
