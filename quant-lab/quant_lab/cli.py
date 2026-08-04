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
app.add_typer(data_app, name="data")
app.add_typer(backtest_app, name="backtest")
app.add_typer(validate_app, name="validate")
app.add_typer(promote_app, name="promote")
app.add_typer(paper_app, name="paper")
app.add_typer(live_app, name="live")
app.add_typer(risk_app, name="risk")

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


StrategyOpt = Annotated[
    Path,
    typer.Option("--strategy", "-s", help="Path to a strategy YAML", exists=True, dir_okay=False),
]


def _load_strategy_inputs(
    cfg: AppConfig, strategy_path: Path
) -> tuple[StrategyInstanceConfig, pd.DataFrame, CostModel]:
    scfg = load_strategy_config(strategy_path)
    if scfg.exchange not in cfg.exchanges:
        typer.secho(f"exchange {scfg.exchange!r} not configured", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)
    store = ParquetStore(cfg.data.parquet_dir)
    df = store.read(scfg.exchange, scfg.symbol, scfg.timeframe)
    if df.empty:
        typer.secho(
            f"no stored data for {scfg.exchange} {scfg.symbol} {scfg.timeframe}; "
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
    cfg = _load(config)
    scfg, df, cost = _load_strategy_inputs(cfg, strategy)
    strat = build_strategy(scfg.strategy, scfg.params)

    result = run_backtest(df, strat.signals(df), cost, cfg.backtest.initial_capital_usd)
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
    audit = AuditLog(cfg.audit.sqlite_path)
    if decision.passed:
        transition = check_transition(audit.get_stage(scfg.name), "validated")
        if not transition.passed:
            typer.secho(transition.summary(), fg=typer.colors.RED, err=True)
            raise typer.Exit(code=1)
        audit.set_stage(
            scfg.name,
            "validated",
            {"windows": len(wf.windows), "closed_oos_trades": len(wf.closed_oos_trades)},
        )
        typer.secho(f"gate: PASS — {scfg.name} promoted to 'validated'", fg=typer.colors.GREEN)
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
    audit = AuditLog(cfg.audit.sqlite_path)
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
    audit = AuditLog(cfg.audit.sqlite_path)

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
    """Fetch the newest bars for the strategy's market and return the frame,
    dropping the still-forming candle so signals only ever see closed bars."""
    client = make_ccxt_client(scfg.exchange, cfg.exchanges[scfg.exchange].rate_limit_ms)
    store = ParquetStore(cfg.data.parquet_dir)
    fetcher = OhlcvFetcher(client, store, scfg.exchange)
    fetcher.update(scfg.symbol, scfg.timeframe, pd.Timestamp(cfg.data.start_date, tz="UTC"))
    df = store.read(scfg.exchange, scfg.symbol, scfg.timeframe)
    return df.iloc[:-1] if len(df) else df


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
    audit = AuditLog(cfg.audit.sqlite_path)
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
        df = _refresh_and_read(cfg, scfg)
        if df.empty:
            typer.secho("no data returned from exchange", fg=typer.colors.YELLOW)
        else:
            step = engine.step(df)
            typer.echo(
                f"{step.bar_time}  equity ${step.equity_usd:,.2f}  {step.detail}"
            )
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
    audit = AuditLog(cfg.audit.sqlite_path)
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
    import os
    import time

    import ccxt

    from quant_lab.live.engine import LiveEngine

    cfg = _load(config)
    scfg = load_strategy_config(strategy)
    audit = AuditLog(cfg.audit.sqlite_path)

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
    client = getattr(ccxt, scfg.exchange)(
        {"apiKey": api_key, "secret": api_secret, "enableRateLimit": True}
    )

    killswitch = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    alerter = alerter_from_config(cfg.alerts)
    try:
        engine = LiveEngine(scfg, cfg, client, audit, killswitch, alerter)
    except RuntimeError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(
        f"LIVE trading {scfg.name} on {scfg.exchange} {scfg.symbol} — capital cap "
        f"${cfg.risk.max_capital_usd:,.2f}",
        fg=typer.colors.YELLOW,
    )
    while True:
        df = _refresh_and_read(cfg, scfg)
        if df.empty:
            typer.secho("no data returned from exchange", fg=typer.colors.YELLOW)
        else:
            step = engine.step(df)
            typer.echo(f"{df.index[-1]}  {step.detail}")
        if once:
            break
        time.sleep(interval)


@risk_app.command("status")
def risk_status(config: ConfigOpt = DEFAULT_CONFIG) -> None:
    """Show kill-switch state and configured limits."""
    cfg = _load(config)
    audit = AuditLog(cfg.audit.sqlite_path)
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
    audit = AuditLog(cfg.audit.sqlite_path)
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


if __name__ == "__main__":
    app()
