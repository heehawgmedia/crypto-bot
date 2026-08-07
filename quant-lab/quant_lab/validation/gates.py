"""Promotion gates. These functions are the ONLY path to promotion, and none
of them accepts an override parameter — by design there is no flag, env var,
or config value that can bypass a failed gate."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from quant_lab.config import AppConfig, WalkforwardConfig
from quant_lab.reporting.metrics import compute_metrics
from quant_lab.validation.walkforward import WalkForwardResult

# Strategy lifecycle stages, in order. Transitions only ever move one step
# forward through a gate (or back to candidate on demotion).
STAGES = ("candidate", "validated", "paper", "live")


@dataclass
class GateDecision:
    passed: bool
    reasons: list[str] = field(default_factory=list)  # failures; empty when passed

    def summary(self) -> str:
        if self.passed:
            return "PASS"
        return "REJECTED:\n" + "\n".join(f"  - {r}" for r in self.reasons)


def evaluate_validation_gate(
    wf: WalkForwardResult,
    cfg: AppConfig,
    timeframe: str,
    wf_cfg: WalkforwardConfig | None = None,
) -> GateDecision:
    """candidate -> validated: the stitched OOS record must clear every bar.

    ``wf_cfg`` is the effective walk-forward config actually used for the run
    (per-strategy overrides applied); defaults to the global one.
    """
    reasons: list[str] = []
    min_windows = (wf_cfg or cfg.walkforward).min_windows

    n_windows = len(wf.windows)
    if n_windows < min_windows:
        reasons.append(f"only {n_windows} walk-forward windows; need >= {min_windows}")

    n_trades = len(wf.closed_oos_trades)
    if n_trades < cfg.promotion.min_oos_trades:
        reasons.append(
            f"only {n_trades} closed OOS trades; need >= {cfg.promotion.min_oos_trades} "
            "(hard floor, no override exists)"
        )

    oos_metrics = compute_metrics(wf.as_backtest_result(), timeframe)
    if oos_metrics.sharpe < cfg.promotion.min_oos_sharpe:
        reasons.append(
            f"stitched OOS Sharpe {oos_metrics.sharpe:.2f} < "
            f"required {cfg.promotion.min_oos_sharpe:.2f}"
        )

    return GateDecision(passed=not reasons, reasons=reasons)


def evaluate_live_gate(
    paper_started_at: datetime | None,
    typed_name: str,
    strategy_name: str,
    cfg: AppConfig,
    now: datetime | None = None,
) -> GateDecision:
    """paper -> live: minimum paper duration plus typed-name confirmation."""
    now = now or datetime.now(UTC)
    reasons: list[str] = []

    if paper_started_at is None:
        reasons.append("no paper trading start recorded; strategy has never run in paper mode")
    else:
        days = (now - paper_started_at).total_seconds() / 86_400
        if days < cfg.promotion.min_paper_days:
            reasons.append(
                f"paper track is {days:.1f} days; need >= {cfg.promotion.min_paper_days} days"
            )

    if typed_name != strategy_name:
        reasons.append(
            f"typed confirmation {typed_name!r} does not match strategy name {strategy_name!r}"
        )

    return GateDecision(passed=not reasons, reasons=reasons)


def check_transition(current_stage: str, target_stage: str) -> GateDecision:
    """Stages move exactly one step forward; anything else is rejected."""
    if current_stage not in STAGES or target_stage not in STAGES:
        return GateDecision(False, [f"unknown stage: {current_stage!r} -> {target_stage!r}"])
    if STAGES.index(target_stage) != STAGES.index(current_stage) + 1:
        return GateDecision(
            False,
            [
                (
                    f"cannot promote from {current_stage!r} to {target_stage!r}; "
                    f"stages move one step: {' -> '.join(STAGES)}"
                )
            ],
        )
    return GateDecision(True)
