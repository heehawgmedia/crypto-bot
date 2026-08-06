"""Trade-rules engine (stop-loss / take-profit / cooldown / re-entry arming).

The rules path is a bar loop; its no-rules behavior is proven identical to the
vectorized engine by a differential test, then each rule is pinned down with
hand-crafted bars.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quant_lab.backtest.engine import (
    CostModel,
    _run_backtest_with_rules,
    run_backtest,
)
from quant_lab.risk.stops import NO_RULES, TradeRules
from tests.conftest import make_ohlcv

NO_COST = CostModel(taker_fee_bps=0.0, slippage_bps=0.0)
REAL_COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)


def ohlc_df(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
) -> pd.DataFrame:
    n = len(opens)
    index = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": [1.0] * n},
        index=index,
    )


def sig(df: pd.DataFrame, values: list[int]) -> pd.Series:
    return pd.Series(values, index=df.index, dtype="int64")


# -- equivalence with the vectorized engine when rules are off --------------


@pytest.mark.parametrize("seed", [1, 2, 3])
@pytest.mark.parametrize("cost", [NO_COST, REAL_COST], ids=["no-cost", "real-cost"])
def test_rules_engine_matches_vectorized_when_disabled(seed: int, cost: CostModel) -> None:
    df = make_ohlcv(bars=300, seed=seed)
    rng = np.random.default_rng(seed + 7)
    signals = pd.Series(rng.integers(0, 2, len(df)), index=df.index, dtype="int64")

    vector = run_backtest(df, signals, cost, 10_000.0)
    loop = _run_backtest_with_rules(df, signals, cost, 10_000.0, NO_RULES)

    np.testing.assert_allclose(loop.equity.to_numpy(), vector.equity.to_numpy(), rtol=1e-9)
    np.testing.assert_array_equal(loop.position.to_numpy(), vector.position.to_numpy())
    assert len(loop.trades) == len(vector.trades)
    assert loop.total_fees_usd == pytest.approx(vector.total_fees_usd, rel=1e-9)
    for lt, vt in zip(loop.trades, vector.trades, strict=True):
        assert lt.entry_time == vt.entry_time
        assert lt.exit_time == vt.exit_time
        assert lt.pnl_usd == pytest.approx(vt.pnl_usd, rel=1e-9, abs=1e-9)


# -- stop-loss --------------------------------------------------------------


def test_stop_loss_exits_at_next_open() -> None:
    # Entry at open1 (100). Stop 5% -> 95. Bar2 low touches 94 -> exit at open3.
    df = ohlc_df(
        opens=[100, 100, 100, 96, 97, 98],
        highs=[101, 101, 101, 97, 98, 99],
        lows=[99, 99, 94, 95, 96, 97],
        closes=[100, 100, 95, 96, 97, 98],
    )
    signals = sig(df, [1, 1, 1, 1, 1, 1])
    rules = TradeRules(stop_loss_pct=5.0)
    result = run_backtest(df, signals, NO_COST, 1000.0, rules=rules)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.exit_reason == "stop_loss"
    assert trade.entry_time == df.index[1]
    assert trade.exit_time == df.index[3]
    assert trade.exit_price == pytest.approx(96.0)  # next open, not the stop price
    assert result.final_equity == pytest.approx(1000.0 * 96.0 / 100.0)
    # Signal never dropped to 0 -> no re-entry after the stop-out.
    assert (result.position.iloc[4:] == 0).all()


def test_take_profit_exits_at_next_open() -> None:
    df = ohlc_df(
        opens=[100, 100, 100, 107, 107, 107],
        highs=[101, 101, 106, 108, 108, 108],
        lows=[99, 99, 99, 106, 106, 106],
        closes=[100, 100, 105, 107, 107, 107],
    )
    signals = sig(df, [1, 1, 1, 1, 1, 1])
    rules = TradeRules(take_profit_pct=5.0)  # target 105, bar2 high 106 hits
    result = run_backtest(df, signals, NO_COST, 1000.0, rules=rules)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.exit_reason == "take_profit"
    assert trade.exit_time == df.index[3]
    assert trade.exit_price == pytest.approx(107.0)
    assert result.final_equity == pytest.approx(1000.0 * 107.0 / 100.0)


def test_stop_wins_when_both_touched_in_one_bar() -> None:
    df = ohlc_df(
        opens=[100, 100, 100, 96, 96],
        highs=[101, 101, 110, 97, 97],  # bar2 touches both target (105)...
        lows=[99, 99, 90, 95, 95],  # ...and stop (95): stop wins
        closes=[100, 100, 96, 96, 96],
    )
    signals = sig(df, [1, 1, 1, 1, 1])
    rules = TradeRules(stop_loss_pct=5.0, take_profit_pct=5.0)
    result = run_backtest(df, signals, NO_COST, 1000.0, rules=rules)
    assert result.trades[0].exit_reason == "stop_loss"


def test_stop_costs_applied_to_exit_fill() -> None:
    df = ohlc_df(
        opens=[100, 100, 100, 96, 96],
        highs=[101, 101, 101, 97, 97],
        lows=[99, 99, 94, 95, 95],
        closes=[100, 100, 95, 96, 96],
    )
    signals = sig(df, [1, 1, 1, 1, 1])
    rules = TradeRules(stop_loss_pct=5.0)
    result = run_backtest(df, signals, REAL_COST, 1000.0, rules=rules)
    fee, slip = REAL_COST.fee, REAL_COST.slippage
    buy_price = 100.0 * (1 + slip)
    units = 1000.0 * (1 - fee) / buy_price
    sell_price = 96.0 * (1 - slip)
    expected_cash = units * sell_price * (1 - fee)
    assert result.final_equity == pytest.approx(expected_cash, rel=1e-12)


# -- re-entry arming and cooldown ------------------------------------------


def _stopout_df(bars: int = 12) -> pd.DataFrame:
    opens = [100.0] * bars
    highs = [101.0] * bars
    lows = [99.0] * bars
    closes = [100.0] * bars
    lows[2] = 94.0  # triggers a 5% stop while holding
    closes[2] = 95.0
    return ohlc_df(opens, highs, lows, closes)


def test_no_reentry_until_signal_drops() -> None:
    df = _stopout_df()
    signals = sig(df, [1] * 12)  # never drops
    result = run_backtest(df, signals, NO_COST, 1000.0, rules=TradeRules(stop_loss_pct=5.0))
    assert len(result.trades) == 1
    assert (result.position.iloc[4:] == 0).all()


def test_reentry_after_fresh_signal_edge() -> None:
    df = _stopout_df()
    values = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]  # drops at bar4, re-signals bar5
    result = run_backtest(
        df, sig(df, values), NO_COST, 1000.0, rules=TradeRules(stop_loss_pct=5.0)
    )
    assert len(result.trades) == 2
    second = result.trades[1]
    assert second.entry_time == df.index[6]  # signal at close5 -> entry open6


def test_cooldown_delays_reentry() -> None:
    df = _stopout_df()
    values = [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1]  # fresh edge right after stop-out
    result = run_backtest(
        df,
        sig(df, values),
        NO_COST,
        1000.0,
        rules=TradeRules(stop_loss_pct=5.0, cooldown_bars=3),
    )
    assert len(result.trades) == 2
    # Stop exit at open3 -> cooldown 3 bars -> earliest entry open 3+1+3=7.
    assert result.trades[1].entry_time == df.index[7]


def test_walkforward_accepts_rules() -> None:
    from quant_lab.config import WalkforwardConfig
    from quant_lab.validation.walkforward import run_walkforward

    df = make_ohlcv(bars=600, seed=5)
    wf_cfg = WalkforwardConfig(
        in_sample_bars=200, out_of_sample_bars=100, step_bars=100, min_windows=2
    )
    wf = run_walkforward(
        df,
        "ema_cross",
        {"fast": 5, "slow": 20},
        {},
        wf_cfg,
        REAL_COST,
        10_000.0,
        "1h",
        rules=TradeRules(stop_loss_pct=3.0, cooldown_bars=2),
    )
    assert len(wf.windows) == 4
    # Any stop-loss exits in the official record carry their reason.
    reasons = {t.exit_reason for t in wf.closed_oos_trades}
    assert reasons <= {"signal", "stop_loss", "take_profit"}
