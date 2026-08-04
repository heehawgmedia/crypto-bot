from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from quant_lab.backtest.engine import CostModel, run_backtest
from quant_lab.reporting.metrics import bars_per_year, compute_metrics, max_drawdown_pct
from quant_lab.reporting.tearsheet import render_tearsheet
from tests.conftest import make_ohlcv


def test_bars_per_year() -> None:
    assert bars_per_year("1h") == pytest.approx(8760)
    assert bars_per_year("1d") == pytest.approx(365)


def test_max_drawdown_known_series() -> None:
    equity = pd.Series([100.0, 120.0, 90.0, 110.0, 130.0])
    # Peak 120 -> trough 90 = -25%
    assert max_drawdown_pct(equity) == pytest.approx(25.0)


def test_max_drawdown_monotonic_equity_is_zero() -> None:
    equity = pd.Series([100.0, 101.0, 102.0])
    assert max_drawdown_pct(equity) == pytest.approx(0.0)


def _result(seed: int = 5):
    df = make_ohlcv(bars=500, seed=seed)
    rng = np.random.default_rng(seed)
    signals = pd.Series(rng.integers(0, 2, len(df)), index=df.index, dtype="int64")
    return run_backtest(df, signals, CostModel(26.0, 10.0), 10_000.0)


def test_metrics_basic_consistency() -> None:
    result = _result()
    m = compute_metrics(result, "1h")
    assert m.net_pnl_usd == pytest.approx(result.final_equity - 10_000.0)
    assert m.total_trades == len(result.closed_trades)
    assert 0.0 <= m.win_rate_pct <= 100.0
    assert 0.0 <= m.exposure_pct <= 100.0
    assert m.total_fees_usd == pytest.approx(result.total_fees_usd)
    assert m.max_drawdown_pct >= 0.0


def test_flat_strategy_metrics_are_all_zero() -> None:
    df = make_ohlcv(bars=100)
    signals = pd.Series(0, index=df.index, dtype="int64")
    m = compute_metrics(run_backtest(df, signals, CostModel(26.0, 10.0), 10_000.0), "1h")
    assert m.net_pnl_usd == 0.0
    assert m.sharpe == 0.0
    assert m.total_trades == 0
    assert m.exposure_pct == 0.0
    assert m.profit_factor == 0.0
    assert m.total_fees_usd == 0.0


def test_profit_factor_all_winners_is_inf() -> None:
    # One clean profitable round trip, no losers.
    df = make_ohlcv(bars=10, seed=1)
    df.loc[:, "open"] = 100.0
    df.loc[:, "close"] = 100.0
    df.iloc[2, df.columns.get_loc("close")] = 150.0  # held bar rallies
    df.iloc[3, df.columns.get_loc("open")] = 150.0
    signals = pd.Series([1, 1, 0, 0, 0, 0, 0, 0, 0, 0], index=df.index, dtype="int64")
    m = compute_metrics(run_backtest(df, signals, CostModel(0.0, 0.0), 1000.0), "1h")
    assert m.total_trades == 1
    assert m.win_rate_pct == 100.0
    assert math.isinf(m.profit_factor)


def test_tearsheet_renders_all_spec_metrics() -> None:
    result = _result()
    m = compute_metrics(result, "1h")
    sheet = render_tearsheet(
        "test", m, m, (result.equity.index[0], result.equity.index[-1])
    )
    for label in (
        "Net PnL", "CAGR", "Sharpe", "Sortino", "Max drawdown", "Win rate",
        "Profit factor", "Avg trade", "Exposure", "Total trades", "Fees paid",
    ):
        assert label in sheet
    assert "buy & hold" in sheet
