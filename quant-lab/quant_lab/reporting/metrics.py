"""Performance metrics over a BacktestResult.

Annualization derives from the bar timeframe (crypto trades 24/7, so a year
is 365 full days of bars). Risk-free rate is assumed 0.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from quant_lab.backtest.engine import BacktestResult
from quant_lab.data.timeframes import timeframe_to_ms

_MS_PER_YEAR = 365 * 24 * 3_600_000


def bars_per_year(timeframe: str) -> float:
    return _MS_PER_YEAR / timeframe_to_ms(timeframe)


@dataclass(frozen=True)
class Metrics:
    net_pnl_usd: float
    net_return_pct: float
    cagr_pct: float
    sharpe: float
    sortino: float
    max_drawdown_pct: float
    win_rate_pct: float
    profit_factor: float
    avg_trade_pct: float
    exposure_pct: float
    total_trades: int
    total_fees_usd: float


def max_drawdown_pct(equity: pd.Series) -> float:
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    return float(-drawdown.min() * 100.0)


def _annualized_ratio(returns: pd.Series, periods_per_year: float, downside: bool) -> float:
    if len(returns) < 2:
        return 0.0
    mean = float(returns.mean())
    if downside:
        neg = returns[returns < 0]
        denom = float(np.sqrt((neg**2).sum() / len(returns))) if len(neg) else 0.0
    else:
        denom = float(returns.std(ddof=1))
    if denom == 0.0:
        return 0.0 if mean == 0.0 else math.inf * np.sign(mean)
    return mean / denom * math.sqrt(periods_per_year)


def compute_metrics(result: BacktestResult, timeframe: str) -> Metrics:
    equity = result.equity
    returns = result.returns
    ppy = bars_per_year(timeframe)

    net_pnl = result.final_equity - result.initial_capital
    net_return = result.final_equity / result.initial_capital - 1.0

    years = len(equity) / ppy
    cagr = (result.final_equity / result.initial_capital) ** (1.0 / years) - 1.0 if years > 0 else 0.0

    closed = result.closed_trades
    wins = [t for t in closed if t.pnl_usd > 0]
    gross_profit = sum(t.pnl_usd for t in closed if t.pnl_usd > 0)
    gross_loss = -sum(t.pnl_usd for t in closed if t.pnl_usd < 0)
    if gross_loss > 0:
        profit_factor = gross_profit / gross_loss
    else:
        profit_factor = math.inf if gross_profit > 0 else 0.0

    return Metrics(
        net_pnl_usd=net_pnl,
        net_return_pct=net_return * 100.0,
        cagr_pct=cagr * 100.0,
        sharpe=_annualized_ratio(returns, ppy, downside=False),
        sortino=_annualized_ratio(returns, ppy, downside=True),
        max_drawdown_pct=max_drawdown_pct(equity),
        win_rate_pct=(100.0 * len(wins) / len(closed)) if closed else 0.0,
        profit_factor=profit_factor,
        avg_trade_pct=(100.0 * float(np.mean([t.return_pct for t in closed]))) if closed else 0.0,
        exposure_pct=float(result.position.mean() * 100.0),
        total_trades=len(closed),
        total_fees_usd=result.total_fees_usd,
    )
