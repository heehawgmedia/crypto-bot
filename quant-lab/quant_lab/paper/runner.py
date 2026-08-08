"""Paper-fleet plumbing shared by the CLI loop and the dashboard server.

``quant-lab paper run`` and ``quant-lab serve`` drive the exact same code, so
the fleet behaves identically whether a terminal or the dashboard is
supervising it.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from quant_lab.alerts import alerter_from_config
from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import AppConfig, StrategyInstanceConfig, load_strategy_config
from quant_lab.data.refresh import refresh_and_read
from quant_lab.paper.engine import PaperEngine

Emit = Callable[[str], None]
RefreshFn = Callable[[AppConfig, StrategyInstanceConfig], pd.DataFrame]


@dataclass(frozen=True)
class FleetMember:
    scfg: StrategyInstanceConfig
    engine: PaperEngine


def discover_strategies(
    strategies_dir: Path, warn: Emit = lambda _m: None
) -> list[StrategyInstanceConfig]:
    """Every parseable strategy YAML in a directory, sorted by filename."""
    found: list[StrategyInstanceConfig] = []
    if not strategies_dir.is_dir():
        return found
    for path in sorted(strategies_dir.glob("*.yaml")):
        try:
            found.append(load_strategy_config(path))
        except Exception as exc:  # noqa: BLE001 - a bad YAML skips, never crashes the fleet
            warn(f"skipping {path.name}: {exc}")
    return found


def build_fleet(
    cfg: AppConfig,
    audit: AuditLog,
    candidates: Iterable[StrategyInstanceConfig],
) -> tuple[list[FleetMember], list[tuple[StrategyInstanceConfig, str]]]:
    """Build paper engines for every candidate whose audited stage allows it.

    Returns (fleet, skipped) where skipped carries the stage that disqualified
    each strategy, so callers can report it in their own voice.
    """
    alerter = alerter_from_config(cfg.alerts)
    fleet: list[FleetMember] = []
    skipped: list[tuple[StrategyInstanceConfig, str]] = []
    for scfg in candidates:
        stage = audit.get_stage(scfg.name)
        if stage not in ("paper", "live"):
            skipped.append((scfg, stage))
            continue
        cost = CostModel(
            taker_fee_bps=cfg.exchanges[scfg.exchange].taker_fee_bps,
            slippage_bps=cfg.backtest.slippage_bps,
        )
        fleet.append(
            FleetMember(
                scfg,
                PaperEngine(
                    scfg,
                    cost,
                    audit,
                    cfg.backtest.initial_capital_usd,
                    alerter,
                    vault=cfg.vault,
                ),
            )
        )
    return fleet, skipped


def poll_fleet(
    cfg: AppConfig,
    audit: AuditLog,
    fleet: list[FleetMember],
    *,
    emit: Emit,
    warn: Emit,
    interval_s: float | None = None,
    refresh: RefreshFn = refresh_and_read,
    raise_on_error: bool = False,
) -> None:
    """One poll of every strategy in the fleet.

    A failure in one strategy never stops the others: the error is reported
    and the next strategy still gets its turn. The heartbeat is stamped
    afterwards either way — it means "this loop is alive", not "all is well".
    """
    for member in fleet:
        try:
            df = refresh(cfg, member.scfg)
            if df.empty:
                warn(f"{member.scfg.name}: no data returned from exchange")
                continue
            step = member.engine.step(df)
            emit(
                f"{step.bar_time}  {member.scfg.name}  "
                f"equity ${step.equity_usd:,.2f}  {step.detail}"
            )
        except Exception as exc:
            if raise_on_error:
                raise
            warn(f"{member.scfg.name}: poll failed, retrying next cycle: {exc}")
    enabled = audit.trading_enabled()
    audit.beat(
        "paper",
        interval_s=interval_s,
        detail=f"{len(fleet)} strategies, {'trading' if enabled else 'paused'}",
    )


def run_fleet_loop(
    cfg: AppConfig,
    audit: AuditLog,
    fleet: list[FleetMember],
    *,
    interval_s: float,
    emit: Emit,
    warn: Emit,
    stop: threading.Event,
    refresh: RefreshFn = refresh_and_read,
) -> None:
    """Poll the fleet until ``stop`` is set. Used by the dashboard server."""
    while True:
        try:
            poll_fleet(
                cfg, audit, fleet, emit=emit, warn=warn, interval_s=interval_s, refresh=refresh
            )
        except Exception as exc:  # noqa: BLE001 - the supervisor outlives any single cycle
            warn(f"poll cycle failed, retrying: {exc}")
        if stop.wait(interval_s):
            return
