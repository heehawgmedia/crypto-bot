"""Walk-forward validation.

Rolling in-sample (IS) windows are grid-searched for the best parameters,
which are then run once on the following out-of-sample (OOS) window. The
strategy's official record is the stitched OOS performance only — IS numbers
exist solely to pick parameters and are never reported as results.

OOS signal computation is causal but warm: signals for an OOS window are
computed on all data up to the window's end, so indicators enter the window
already warmed up on strictly-past data (no cold start, no future access).
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Any

import pandas as pd

from quant_lab.backtest.engine import BacktestResult, CostModel, Trade, run_backtest
from quant_lab.config import WalkforwardConfig
from quant_lab.reporting.metrics import compute_metrics
from quant_lab.risk.stops import NO_RULES, TradeRules
from quant_lab.strategies import build_strategy


@dataclass(frozen=True)
class Window:
    index: int
    is_start: int
    is_end: int  # exclusive
    oos_start: int
    oos_end: int  # exclusive


@dataclass
class WindowResult:
    window: Window
    best_params: dict[str, Any]
    is_metric: float
    oos_result: BacktestResult


@dataclass
class WalkForwardResult:
    windows: list[WindowResult]
    stitched_equity: pd.Series  # compounded across OOS windows only
    stitched_returns: pd.Series
    initial_capital: float

    @property
    def oos_trades(self) -> list[Trade]:
        return [t for w in self.windows for t in w.oos_result.trades]

    @property
    def closed_oos_trades(self) -> list[Trade]:
        return [t for t in self.oos_trades if t.exit_time is not None]

    @property
    def total_fees_usd(self) -> float:
        return sum(w.oos_result.total_fees_usd for w in self.windows)

    @property
    def final_equity(self) -> float:
        return float(self.stitched_equity.iloc[-1])

    def as_backtest_result(self) -> BacktestResult:
        """Stitched OOS record shaped like a single backtest, for reporting."""
        position = pd.concat([w.oos_result.position for w in self.windows])
        return BacktestResult(
            equity=self.stitched_equity,
            position=position,
            returns=self.stitched_returns,
            trades=self.oos_trades,
            initial_capital=self.initial_capital,
            total_fees_usd=self.total_fees_usd,
        )


def generate_windows(n_bars: int, cfg: WalkforwardConfig) -> list[Window]:
    windows = []
    start = 0
    i = 0
    while start + cfg.in_sample_bars + cfg.out_of_sample_bars <= n_bars:
        is_end = start + cfg.in_sample_bars
        windows.append(
            Window(
                index=i,
                is_start=start,
                is_end=is_end,
                oos_start=is_end,
                oos_end=is_end + cfg.out_of_sample_bars,
            )
        )
        start += cfg.step_bars
        i += 1
    return windows


def param_combinations(
    base_params: dict[str, Any], grid: dict[str, list[Any]]
) -> list[dict[str, Any]]:
    if not grid:
        return [dict(base_params)]
    keys = sorted(grid)
    combos = []
    for values in itertools.product(*(grid[k] for k in keys)):
        params = dict(base_params)
        params.update(dict(zip(keys, values)))
        combos.append(params)
    return combos


def _metric_value(result: BacktestResult, metric: str, timeframe: str) -> float:
    m = compute_metrics(result, timeframe)
    return {"sharpe": m.sharpe, "sortino": m.sortino, "profit_factor": m.profit_factor}[metric]


def _oos_signals(
    strategy_name: str, params: dict[str, Any], df: pd.DataFrame, window: Window
) -> pd.Series:
    strategy = build_strategy(strategy_name, params)
    # History up to oos_end only: warmup comes from the past, never the future.
    visible = df.iloc[: window.oos_end]
    return strategy.signals(visible).iloc[window.oos_start : window.oos_end]


def run_walkforward(
    df: pd.DataFrame,
    strategy_name: str,
    base_params: dict[str, Any],
    param_grid: dict[str, list[Any]],
    wf_cfg: WalkforwardConfig,
    cost: CostModel,
    initial_capital: float,
    timeframe: str,
    rules: TradeRules = NO_RULES,
) -> WalkForwardResult:
    windows = generate_windows(len(df), wf_cfg)
    if not windows:
        raise ValueError(
            f"not enough data for a single walk-forward window: {len(df)} bars < "
            f"{wf_cfg.in_sample_bars} IS + {wf_cfg.out_of_sample_bars} OOS"
        )

    combos = param_combinations(base_params, param_grid)
    results: list[WindowResult] = []
    for window in windows:
        is_df = df.iloc[window.is_start : window.is_end]
        best_params, best_value = combos[0], float("-inf")
        for params in combos:
            strategy = build_strategy(strategy_name, params)
            is_result = run_backtest(
                is_df, strategy.signals(is_df), cost, initial_capital, rules=rules
            )
            value = _metric_value(is_result, wf_cfg.optimize_metric, timeframe)
            if value > best_value:
                best_params, best_value = params, value

        oos_df = df.iloc[window.oos_start : window.oos_end]
        oos_signals = _oos_signals(strategy_name, best_params, df, window)
        oos_result = run_backtest(oos_df, oos_signals, cost, initial_capital, rules=rules)
        results.append(
            WindowResult(
                window=window,
                best_params=best_params,
                is_metric=best_value,
                oos_result=oos_result,
            )
        )

    # Stitch: compound per-bar OOS returns in chronological order. Each window
    # starts from the equity where the previous window left off.
    stitched_returns = pd.concat([w.oos_result.returns for w in results])
    stitched_equity = initial_capital * (1.0 + stitched_returns).cumprod()
    stitched_equity.name = "equity"
    return WalkForwardResult(
        windows=results,
        stitched_equity=stitched_equity,
        stitched_returns=stitched_returns,
        initial_capital=initial_capital,
    )
