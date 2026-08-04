from __future__ import annotations

import itertools

import numpy as np
import pytest
from pydantic import ValidationError

from quant_lab.backtest.engine import CostModel
from quant_lab.config import WalkforwardConfig
from quant_lab.strategies import build_strategy
from quant_lab.validation.walkforward import (
    generate_windows,
    param_combinations,
    run_walkforward,
)
from tests.conftest import make_ohlcv

COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)
WF = WalkforwardConfig(in_sample_bars=200, out_of_sample_bars=100, step_bars=100, min_windows=2)


def test_window_generation_rolls_without_oos_overlap() -> None:
    windows = generate_windows(600, WF)
    assert len(windows) == 4  # starts at 0, 100, 200, 300
    for w in windows:
        assert w.is_end - w.is_start == 200
        assert w.oos_end - w.oos_start == 100
        assert w.oos_start == w.is_end
    for a, b in itertools.pairwise(windows):
        assert b.oos_start >= a.oos_end  # stitched record never double-counts


def test_config_rejects_overlapping_oos() -> None:
    with pytest.raises(ValidationError, match="double-count"):
        WalkforwardConfig(in_sample_bars=200, out_of_sample_bars=100, step_bars=50)


def test_param_combinations() -> None:
    combos = param_combinations({"fast": 5, "slow": 20}, {"fast": [5, 10], "slow": [20, 40]})
    assert len(combos) == 4
    assert {"fast": 10, "slow": 40} in combos
    assert param_combinations({"fast": 5, "slow": 20}, {}) == [{"fast": 5, "slow": 20}]


def test_insufficient_data_raises() -> None:
    df = make_ohlcv(bars=250)
    with pytest.raises(ValueError, match="not enough data"):
        run_walkforward(df, "ema_cross", {"fast": 5, "slow": 20}, {}, WF, COST, 10_000.0, "1h")


def test_walkforward_end_to_end() -> None:
    df = make_ohlcv(bars=700, seed=17)
    wf = run_walkforward(
        df,
        "ema_cross",
        {"fast": 5, "slow": 20},
        {"fast": [3, 5], "slow": [15, 20]},
        WF,
        COST,
        10_000.0,
        "1h",
    )
    assert len(wf.windows) == 5
    # Stitched equity covers exactly the OOS bars, in order, no duplicates.
    expected_index = df.index[200:700]
    assert wf.stitched_equity.index.equals(expected_index)
    assert not wf.stitched_equity.index.has_duplicates
    # Chosen params always come from the declared grid.
    for w in wf.windows:
        assert w.best_params["fast"] in (3, 5)
        assert w.best_params["slow"] in (15, 20)


def test_stitched_equity_compounds_window_returns() -> None:
    df = make_ohlcv(bars=600, seed=23)
    wf = run_walkforward(df, "ema_cross", {"fast": 5, "slow": 20}, {}, WF, COST, 10_000.0, "1h")
    manual = 10_000.0
    for w in wf.windows:
        manual *= w.oos_result.final_equity / w.oos_result.initial_capital
    assert wf.final_equity == pytest.approx(manual, rel=1e-9)


def test_oos_signals_warm_but_causal() -> None:
    """OOS signals must equal signals computed on data ending at the OOS window
    end — i.e. warmup uses only the past; data after the window is invisible."""
    df = make_ohlcv(bars=600, seed=29)
    wf = run_walkforward(df, "ema_cross", {"fast": 5, "slow": 20}, {}, WF, COST, 10_000.0, "1h")
    w = wf.windows[0]
    strategy = build_strategy("ema_cross", w.best_params)
    visible = df.iloc[: w.window.oos_end]
    expected_positions = (
        strategy.signals(visible).iloc[w.window.oos_start : w.window.oos_end].shift(1).fillna(0)
    )
    np.testing.assert_array_equal(
        w.oos_result.position.to_numpy(), expected_positions.to_numpy()
    )


def test_official_record_is_oos_only() -> None:
    """The stitched record must contain zero in-sample bars."""
    df = make_ohlcv(bars=600, seed=31)
    wf = run_walkforward(df, "ema_cross", {"fast": 5, "slow": 20}, {}, WF, COST, 10_000.0, "1h")
    is_bars = df.index[:200]  # first window's in-sample region
    assert wf.stitched_equity.index.intersection(is_bars).empty
