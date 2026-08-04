"""Backtest math verified two ways: hand-computed fixtures for exact fee and
slippage arithmetic, and a differential test against a bar-by-bar reference
simulator over randomized signals."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quant_lab.backtest.engine import CostModel, buy_and_hold, run_backtest
from tests.conftest import make_ohlcv

NO_COST = CostModel(taker_fee_bps=0.0, slippage_bps=0.0)
REAL_COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)


def simple_df(opens: list[float], closes: list[float]) -> pd.DataFrame:
    n = len(opens)
    index = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    high = [max(o, c) * 1.01 for o, c in zip(opens, closes)]
    low = [min(o, c) * 0.99 for o, c in zip(opens, closes)]
    return pd.DataFrame(
        {"open": opens, "high": high, "low": low, "close": closes, "volume": [1.0] * n},
        index=index,
    )


def sig(df: pd.DataFrame, values: list[int]) -> pd.Series:
    return pd.Series(values, index=df.index, dtype="int64")


def reference_simulator(
    df: pd.DataFrame, signals: pd.Series, cost: CostModel, initial: float
) -> tuple[list[float], float]:
    """Plain-python bar loop implementing the documented execution model."""
    cash, units = initial, 0.0
    fee, slip = cost.fee, cost.slippage
    equity_curve: list[float] = []
    total_fees = 0.0
    for t in range(len(df)):
        target = int(signals.iloc[t - 1]) if t > 0 else 0
        open_t = float(df["open"].iloc[t])
        if target == 1 and units == 0.0:
            fee_usd = cash * fee
            units = cash * (1 - fee) / (open_t * (1 + slip))
            total_fees += fee_usd
            cash = 0.0
        elif target == 0 and units > 0.0:
            proceeds = units * open_t * (1 - slip)
            fee_usd = proceeds * fee
            cash = proceeds * (1 - fee)
            total_fees += fee_usd
            units = 0.0
        equity_curve.append(cash + units * float(df["close"].iloc[t]))
    return equity_curve, total_fees


def test_hand_computed_single_trade_with_costs() -> None:
    # Signal at bar0 close -> buy at bar1 open; signal off at bar2 close -> sell at bar3 open.
    df = simple_df(opens=[100, 100, 110, 120, 125], closes=[100, 105, 115, 122, 126])
    signals = sig(df, [1, 1, 0, 0, 0])
    fee, slip = 0.0026, 0.0010
    result = run_backtest(df, signals, REAL_COST, 1000.0)

    buy_price = 100 * (1 + slip)
    units = 1000.0 * (1 - fee) / buy_price
    eq1 = units * 105  # marked at bar1 close
    eq2 = units * 115
    sell_price = 120 * (1 - slip)
    cash = units * sell_price * (1 - fee)

    expected = [1000.0, eq1, eq2, cash, cash]
    np.testing.assert_allclose(result.equity.to_numpy(), expected, rtol=1e-12)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_time == df.index[1]
    assert trade.exit_time == df.index[3]
    assert trade.entry_price == pytest.approx(buy_price)
    assert trade.exit_price == pytest.approx(sell_price)
    assert trade.pnl_usd == pytest.approx(cash - 1000.0)
    expected_fees = 1000.0 * fee + units * sell_price * fee
    assert trade.fees_usd == pytest.approx(expected_fees)
    assert result.total_fees_usd == pytest.approx(expected_fees)


def test_zero_cost_roundtrip_is_pure_price_ratio() -> None:
    df = simple_df(opens=[100, 100, 110, 120], closes=[100, 105, 118, 121])
    signals = sig(df, [1, 1, 1, 1])
    result = run_backtest(df, signals, NO_COST, 500.0)
    # Buy at bar1 open (100), hold to final close (121).
    assert result.final_equity == pytest.approx(500.0 * 121 / 100)
    assert result.total_fees_usd == 0.0


def test_open_trade_marked_to_market() -> None:
    df = simple_df(opens=[100, 100, 110], closes=[100, 105, 111])
    result = run_backtest(df, sig(df, [1, 1, 1]), NO_COST, 100.0)
    assert len(result.trades) == 1
    assert result.trades[0].exit_time is None
    assert result.closed_trades == []
    assert result.trades[0].pnl_usd == pytest.approx(result.final_equity - 100.0)


def test_buy_and_hold_benchmark_uses_same_engine_conventions() -> None:
    df = simple_df(opens=[100, 102, 104], closes=[101, 103, 106])
    result = buy_and_hold(df, NO_COST, 1000.0)
    # Enters at bar1 open (102) — same next-bar-open rule as any strategy.
    assert result.final_equity == pytest.approx(1000.0 * 106 / 102)


def test_signals_must_be_binary() -> None:
    df = simple_df(opens=[100, 100], closes=[100, 100])
    with pytest.raises(ValueError, match="long-only"):
        run_backtest(df, sig(df, [1, -1]), NO_COST, 100.0)


def test_signals_must_align() -> None:
    df = simple_df(opens=[100, 100], closes=[100, 100])
    bad = pd.Series([1, 0], index=pd.RangeIndex(2))
    with pytest.raises(ValueError, match="aligned"):
        run_backtest(df, bad, NO_COST, 100.0)


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
@pytest.mark.parametrize("cost", [NO_COST, REAL_COST], ids=["no-cost", "real-cost"])
def test_vectorized_engine_matches_reference_simulator(seed: int, cost: CostModel) -> None:
    df = make_ohlcv(bars=400, seed=seed)
    rng = np.random.default_rng(seed + 100)
    signals = pd.Series(rng.integers(0, 2, len(df)), index=df.index, dtype="int64")

    result = run_backtest(df, signals, cost, 10_000.0)
    ref_equity, ref_fees = reference_simulator(df, signals, cost, 10_000.0)

    np.testing.assert_allclose(result.equity.to_numpy(), ref_equity, rtol=1e-10)
    assert result.total_fees_usd == pytest.approx(ref_fees, rel=1e-10)


def test_trade_pnls_reconcile_with_equity() -> None:
    df = make_ohlcv(bars=300, seed=42)
    rng = np.random.default_rng(7)
    signals = pd.Series(rng.integers(0, 2, len(df)), index=df.index, dtype="int64")
    result = run_backtest(df, signals, REAL_COST, 10_000.0)
    total_trade_pnl = sum(t.pnl_usd for t in result.trades)
    assert total_trade_pnl == pytest.approx(result.final_equity - 10_000.0, rel=1e-9)
