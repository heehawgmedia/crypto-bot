from __future__ import annotations

import inspect
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd

from quant_lab.backtest.engine import CostModel, run_backtest
from quant_lab.config import AppConfig
from quant_lab.validation.gates import (
    check_transition,
    evaluate_live_gate,
    evaluate_validation_gate,
)
from quant_lab.validation.walkforward import (
    WalkForwardResult,
    Window,
    WindowResult,
)
from tests.test_config import _base

NO_COST = CostModel(taker_fee_bps=0.0, slippage_bps=0.0)


def _cfg(**overrides) -> AppConfig:
    raw = _base()
    raw["walkforward"] = {
        "in_sample_bars": 200,
        "out_of_sample_bars": 100,
        "step_bars": 100,
        "min_windows": 2,
    }
    raw.update(overrides)
    return AppConfig.model_validate(raw)


def _rising_df(bars: int, start: str) -> pd.DataFrame:
    """Steadily rising market: every round trip is a winner (zero cost)."""
    index = pd.date_range(start, periods=bars, freq="1h", tz="UTC")
    close = 100.0 * 1.01 ** np.arange(bars)
    open_ = np.concatenate([[100.0], close[:-1]])
    return pd.DataFrame(
        {"open": open_, "high": close * 1.02, "low": open_ * 0.99, "close": close,
         "volume": np.ones(bars)},
        index=index,
    )


def _manual_wf(n_windows: int, active: bool) -> WalkForwardResult:
    """Build a real WalkForwardResult from controlled backtests.

    active=True -> alternating signals, ~50 closed trades per window.
    active=False -> one short trade per window.
    """
    windows: list[WindowResult] = []
    for i in range(n_windows):
        df = _rising_df(100, start=f"2024-0{i + 1}-01")
        if active:
            sig = pd.Series((np.arange(100) % 2), index=df.index, dtype="int64")
        else:
            sig = pd.Series(0, index=df.index, dtype="int64")
            sig.iloc[10:20] = 1
        bt = run_backtest(df, sig, NO_COST, 10_000.0)
        windows.append(
            WindowResult(
                window=Window(i, 0, 0, 0, 100),
                best_params={},
                is_metric=0.0,
                oos_result=bt,
            )
        )
    stitched_returns = pd.concat([w.oos_result.returns for w in windows])
    stitched_equity = 10_000.0 * (1.0 + stitched_returns).cumprod()
    return WalkForwardResult(
        windows=windows,
        stitched_equity=stitched_equity,
        stitched_returns=stitched_returns,
        initial_capital=10_000.0,
    )


def test_thirty_trade_floor_rejects_thin_records() -> None:
    wf = _manual_wf(n_windows=3, active=False)
    assert len(wf.closed_oos_trades) == 3  # far under the floor
    decision = evaluate_validation_gate(wf, _cfg(), "1h")
    assert not decision.passed
    assert any("closed OOS trades" in r and "no override" in r for r in decision.reasons)


def test_gate_passes_with_enough_trades_and_positive_oos() -> None:
    wf = _manual_wf(n_windows=2, active=True)
    assert len(wf.closed_oos_trades) >= 30
    decision = evaluate_validation_gate(wf, _cfg(), "1h")
    assert decision.passed, decision.reasons


def test_min_windows_gate() -> None:
    wf = _manual_wf(n_windows=1, active=True)
    decision = evaluate_validation_gate(wf, _cfg(), "1h")
    assert not decision.passed
    assert any("walk-forward windows" in r for r in decision.reasons)


def test_min_oos_sharpe_gate() -> None:
    wf = _manual_wf(n_windows=2, active=True)
    cfg = _cfg()
    cfg.promotion.min_oos_sharpe = 1e9  # unreachable bar
    decision = evaluate_validation_gate(wf, cfg, "1h")
    assert not decision.passed
    assert any("Sharpe" in r for r in decision.reasons)


def test_gate_functions_have_no_override_parameter() -> None:
    """The no-override rule, enforced structurally: no gate accepts anything
    resembling a force/override/skip flag."""
    for fn in (evaluate_validation_gate, evaluate_live_gate, check_transition):
        for param in inspect.signature(fn).parameters:
            assert not any(
                word in param.lower() for word in ("force", "override", "skip", "bypass")
            ), f"{fn.__name__} exposes suspicious parameter {param!r}"


def test_live_gate_requires_paper_duration() -> None:
    cfg = _cfg()
    now = datetime.now(UTC)
    early = now - timedelta(days=cfg.promotion.min_paper_days - 1)
    decision = evaluate_live_gate(early, "s1", "s1", cfg, now=now)
    assert not decision.passed
    assert any("paper track" in r for r in decision.reasons)

    ready = now - timedelta(days=cfg.promotion.min_paper_days + 1)
    assert evaluate_live_gate(ready, "s1", "s1", cfg, now=now).passed


def test_live_gate_requires_exact_typed_name() -> None:
    cfg = _cfg()
    now = datetime.now(UTC)
    started = now - timedelta(days=100)
    for typed in ("s2", "S1", " s1", ""):
        decision = evaluate_live_gate(started, typed, "s1", cfg, now=now)
        assert not decision.passed, f"typed {typed!r} should not pass"
    assert evaluate_live_gate(started, "s1", "s1", cfg, now=now).passed


def test_live_gate_requires_paper_history() -> None:
    decision = evaluate_live_gate(None, "s1", "s1", _cfg())
    assert not decision.passed
    assert any("never run in paper" in r for r in decision.reasons)


def test_stage_transitions_one_step_only() -> None:
    assert check_transition("candidate", "validated").passed
    assert check_transition("validated", "paper").passed
    assert check_transition("paper", "live").passed
    for current, target in [
        ("candidate", "paper"),
        ("candidate", "live"),
        ("validated", "live"),
        ("live", "live"),
        ("paper", "validated"),
    ]:
        assert not check_transition(current, target).passed, f"{current} -> {target}"
