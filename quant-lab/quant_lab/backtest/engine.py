"""Vectorized backtester.

Execution model (the only one in v1, enforced by config):

- A signal is computed on the CLOSE of bar t and can only trade at the OPEN
  of bar t+1. A signal on the final bar never trades — there is no next open.
- Buys fill at open*(1 + slippage); sells at open*(1 - slippage).
- Fees are charged on cash flow: buying converts cash C into
  C*(1-fee)/buy_price units (fee_usd = C*fee); selling U units yields
  U*sell_price*(1-fee) cash (fee_usd = U*sell_price*fee).
- All-in/all-out: a long position deploys the full running equity. Capital
  allocation across strategies is a risk-layer concern, not a backtest one.
- Equity is marked to close each bar.

The math is vectorized over per-bar growth factors; the test suite checks it
bar-for-bar against a plain-Python reference simulator and hand-computed
fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class CostModel:
    taker_fee_bps: float
    slippage_bps: float

    @property
    def fee(self) -> float:
        return self.taker_fee_bps / 10_000.0

    @property
    def slippage(self) -> float:
        return self.slippage_bps / 10_000.0


@dataclass(frozen=True)
class Trade:
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp | None  # None -> still open at the end of the data
    entry_price: float  # slippage-adjusted fill price
    exit_price: float | None
    bars_held: int
    return_pct: float  # equity-based, net of fees and slippage
    pnl_usd: float
    fees_usd: float


@dataclass
class BacktestResult:
    equity: pd.Series  # marked at close, starts at initial_capital
    position: pd.Series  # 0/1 held during each bar
    returns: pd.Series  # per-bar equity returns
    trades: list[Trade]
    initial_capital: float
    total_fees_usd: float

    @property
    def final_equity(self) -> float:
        return float(self.equity.iloc[-1])

    @property
    def closed_trades(self) -> list[Trade]:
        return [t for t in self.trades if t.exit_time is not None]


def _validate_signals(df: pd.DataFrame, signals: pd.Series) -> pd.Series:
    if not signals.index.equals(df.index):
        raise ValueError("signals must be aligned to the OHLCV index")
    values = set(pd.unique(signals.dropna()))
    if not values <= {0, 1}:
        raise ValueError(f"signals must be in {{0, 1}} (spot, long-only); got {values}")
    return signals.fillna(0).astype("int64")


def run_backtest(
    df: pd.DataFrame,
    signals: pd.Series,
    cost: CostModel,
    initial_capital: float,
) -> BacktestResult:
    signals = _validate_signals(df, signals)
    if len(df) < 2:
        raise ValueError("need at least 2 bars to backtest")

    open_ = df["open"].to_numpy(dtype="float64")
    close = df["close"].to_numpy(dtype="float64")
    n = len(df)

    # Position held during bar t = signal from bar t-1's close.
    pos = signals.shift(1).fillna(0).astype("int64").to_numpy()
    prev_pos = np.concatenate([[0], pos[:-1]])
    entering = (pos == 1) & (prev_pos == 0)  # bought at open[t]
    exiting = (pos == 0) & (prev_pos == 1)  # sold at open[t]
    holding = (pos == 1) & (prev_pos == 1)

    fee, slip = cost.fee, cost.slippage
    buy_price = open_ * (1.0 + slip)
    sell_price = open_ * (1.0 - slip)
    prev_close = np.concatenate([[np.nan], close[:-1]])

    # Per-bar growth factor of equity, marked at close.
    growth = np.ones(n)
    growth[entering] = (1.0 - fee) * close[entering] / buy_price[entering]
    growth[holding] = close[holding] / prev_close[holding]
    growth[exiting] = (1.0 - fee) * sell_price[exiting] / prev_close[exiting]

    equity = initial_capital * np.cumprod(growth)
    equity_prev = np.concatenate([[initial_capital], equity[:-1]])

    # Fees in USD: entry fee is charged on the cash deployed (equity at the
    # previous close); exit fee on the sale notional.
    fees = np.zeros(n)
    fees[entering] = equity_prev[entering] * fee
    units_at_exit = equity_prev[exiting] / prev_close[exiting]
    fees[exiting] = units_at_exit * sell_price[exiting] * fee

    trades = _extract_trades(
        df.index, entering, exiting, buy_price, sell_price, equity_prev, equity, fees
    )

    index = df.index
    equity_s = pd.Series(equity, index=index, name="equity")
    return BacktestResult(
        equity=equity_s,
        position=pd.Series(pos, index=index, name="position"),
        returns=equity_s.pct_change().fillna(equity_s.iloc[0] / initial_capital - 1.0),
        trades=trades,
        initial_capital=initial_capital,
        total_fees_usd=float(fees.sum()),
    )


def _extract_trades(
    index: pd.Index,
    entering: np.ndarray,
    exiting: np.ndarray,
    buy_price: np.ndarray,
    sell_price: np.ndarray,
    equity_prev: np.ndarray,
    equity: np.ndarray,
    fees: np.ndarray,
) -> list[Trade]:
    trades: list[Trade] = []
    entry_indices = np.flatnonzero(entering)
    exit_indices = np.flatnonzero(exiting)
    for entry_i in (int(i) for i in entry_indices):
        later_exits = exit_indices[exit_indices > entry_i]
        if later_exits.size:
            exit_i = int(later_exits[0])
            capital_before = equity_prev[entry_i]
            trades.append(
                Trade(
                    entry_time=index[entry_i],
                    exit_time=index[exit_i],
                    entry_price=float(buy_price[entry_i]),
                    exit_price=float(sell_price[exit_i]),
                    bars_held=exit_i - entry_i,
                    return_pct=float(equity[exit_i] / capital_before - 1.0),
                    pnl_usd=float(equity[exit_i] - capital_before),
                    fees_usd=float(fees[entry_i] + fees[exit_i]),
                )
            )
        else:
            # Still open at the end: marked to the final close, no exit fees.
            capital_before = equity_prev[entry_i]
            trades.append(
                Trade(
                    entry_time=index[entry_i],
                    exit_time=None,
                    entry_price=float(buy_price[entry_i]),
                    exit_price=None,
                    bars_held=len(index) - 1 - entry_i,
                    return_pct=float(equity[-1] / capital_before - 1.0),
                    pnl_usd=float(equity[-1] - capital_before),
                    fees_usd=float(fees[entry_i]),
                )
            )
    return trades


def buy_and_hold(df: pd.DataFrame, cost: CostModel, initial_capital: float) -> BacktestResult:
    """Benchmark: long from the first tradable open to the end, same cost model."""
    signals = pd.Series(1, index=df.index, dtype="int64")
    return run_backtest(df, signals, cost, initial_capital)
