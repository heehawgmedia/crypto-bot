from __future__ import annotations

import pandas as pd
import pytest
from pydantic import ValidationError

from quant_lab.strategies import REGISTRY, Strategy, build_strategy
from tests.conftest import make_ohlcv

PARAMS = {
    "ema_cross": {"fast": 5, "slow": 20},
    "rsi_mr": {"period": 14, "oversold": 30, "overbought": 70},
    "donchian": {"entry_lookback": 10, "exit_lookback": 5},
}


def _build(name: str) -> Strategy:
    return build_strategy(name, PARAMS[name])


def test_registry_has_all_baselines() -> None:
    assert set(REGISTRY) == {"ema_cross", "rsi_mr", "donchian"}
    assert set(PARAMS) == set(REGISTRY)


def test_unknown_strategy_rejected() -> None:
    with pytest.raises(KeyError, match="unknown strategy"):
        build_strategy("hodl_and_pray", {})


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_unknown_params_rejected(name: str) -> None:
    params = dict(PARAMS[name], not_a_real_param=1)
    with pytest.raises(ValidationError):
        build_strategy(name, params)


def test_ema_cross_requires_fast_below_slow() -> None:
    with pytest.raises(ValidationError):
        build_strategy("ema_cross", {"fast": 50, "slow": 20})


def test_rsi_requires_ordered_bands() -> None:
    with pytest.raises(ValidationError):
        build_strategy("rsi_mr", {"period": 14, "oversold": 70, "overbought": 30})


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_signals_are_binary_and_aligned(name: str) -> None:
    df = make_ohlcv(bars=300)
    sig = _build(name).signals(df)
    assert sig.index.equals(df.index)
    assert set(sig.unique()) <= {0, 1}


@pytest.mark.parametrize("name", sorted(REGISTRY))
@pytest.mark.parametrize("cut", [50, 120, 299])
def test_signals_are_causal(name: str, cut: int) -> None:
    """The signal at bar t must be identical whether or not the future exists.

    This is the strategy-level no-lookahead proof: computing signals on the
    full series and on a truncated prefix must agree on the prefix.
    """
    df = make_ohlcv(bars=300, seed=11)
    strategy = _build(name)
    full = strategy.signals(df)
    prefix = strategy.signals(df.iloc[:cut])
    pd.testing.assert_series_equal(full.iloc[:cut], prefix, check_names=False)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_signals_ignore_future_perturbation(name: str) -> None:
    """Rewriting the last 50 bars must not change any signal before them."""
    df = make_ohlcv(bars=300, seed=13)
    strategy = _build(name)
    before = strategy.signals(df).iloc[:250]
    mutated = df.copy()
    mutated.iloc[250:, :4] = mutated.iloc[250:, :4].to_numpy() * 5.0  # violent future move
    after = strategy.signals(mutated).iloc[:250]
    pd.testing.assert_series_equal(before, after)
