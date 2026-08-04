"""Engine-level lookahead proofs. Strategy-level causality lives in
test_strategies.py; these tests pin down the execution timing itself."""

from __future__ import annotations

import numpy as np
import pandas as pd

from quant_lab.backtest.engine import CostModel, run_backtest
from quant_lab.strategies import REGISTRY, build_strategy
from tests.conftest import make_ohlcv
from tests.test_strategies import PARAMS

COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)


def test_signal_fills_at_next_bar_open_never_same_bar() -> None:
    df = make_ohlcv(bars=10)
    signals = pd.Series(0, index=df.index, dtype="int64")
    signals.iloc[4] = 1  # signal on bar 4's close
    signals.iloc[5] = 1
    result = run_backtest(df, signals, COST, 1000.0)
    assert (result.position.iloc[:5] == 0).all()  # flat through bar 4 inclusive
    assert result.position.iloc[5] == 1  # position exists during bar 5
    assert result.trades[0].entry_time == df.index[5]
    assert result.trades[0].entry_price == float(df["open"].iloc[5]) * (1 + COST.slippage)


def test_signal_on_final_bar_cannot_trade() -> None:
    df = make_ohlcv(bars=10)
    signals = pd.Series(0, index=df.index, dtype="int64")
    signals.iloc[-1] = 1  # no next open exists
    result = run_backtest(df, signals, COST, 1000.0)
    assert result.trades == []
    assert (result.position == 0).all()
    assert result.final_equity == 1000.0


def test_future_price_change_cannot_affect_past_equity() -> None:
    df = make_ohlcv(bars=200, seed=3)
    rng = np.random.default_rng(0)
    signals = pd.Series(rng.integers(0, 2, len(df)), index=df.index, dtype="int64")

    base = run_backtest(df, signals, COST, 1000.0)

    mutated = df.copy()
    mutated.iloc[150:, :] = mutated.iloc[150:, :].to_numpy() * 3.0  # rewrite the future
    perturbed = run_backtest(mutated, signals, COST, 1000.0)

    pd.testing.assert_series_equal(base.equity.iloc[:150], perturbed.equity.iloc[:150])
    pd.testing.assert_series_equal(base.position.iloc[:150], perturbed.position.iloc[:150])


def test_end_to_end_no_lookahead_per_strategy() -> None:
    """Full pipeline: strategy signals + engine on a prefix must equal the
    prefix of the full run, for every registered strategy."""
    df = make_ohlcv(bars=400, seed=21)
    cut = 300
    for name in sorted(REGISTRY):
        strategy = build_strategy(name, PARAMS[name])
        full = run_backtest(df, strategy.signals(df), COST, 1000.0)
        prefix_df = df.iloc[:cut]
        prefix = run_backtest(prefix_df, strategy.signals(prefix_df), COST, 1000.0)
        pd.testing.assert_series_equal(full.equity.iloc[:cut], prefix.equity, check_names=False)


def test_prophet_strategy_gains_nothing_from_final_bar_knowledge() -> None:
    """A 'strategy' that knows the future return of bar t+1 still cannot act on
    bar t+1's price: it trades at t+1's open, one bar after its information.
    This documents that the engine timing, not strategy honesty, is the
    protection layer."""
    df = make_ohlcv(bars=50, seed=9)
    future_up = (df["close"].shift(-1) > df["close"]).astype("int64")  # cheating signal
    result = run_backtest(df, future_up, CostModel(0.0, 0.0), 1000.0)
    # The cheater's fills still occur at the open AFTER the bar it predicted.
    for trade in result.trades:
        entry_loc = df.index.get_loc(trade.entry_time)
        assert future_up.iloc[entry_loc - 1] == 1
