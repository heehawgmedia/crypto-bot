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

from quant_lab.risk.stops import TradeRules


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
    exit_reason: str | None = None  # signal | stop_loss | take_profit | None (open)


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
    rules: TradeRules | None = None,
) -> BacktestResult:
    """Backtest with the standard execution model. When ``rules`` is active
    (stop-loss / take-profit / cooldown), the path-dependent bar-loop engine
    runs; otherwise the vectorized engine does. The two are held equivalent
    for the no-rules case by a differential test."""
    if rules is not None and rules.active:
        return _run_backtest_with_rules(df, signals, cost, initial_capital, rules)
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
                    exit_reason="signal",
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


def _run_backtest_with_rules(
    df: pd.DataFrame,
    signals: pd.Series,
    cost: CostModel,
    initial_capital: float,
    rules: TradeRules,
) -> BacktestResult:
    """Bar-loop engine for path-dependent trade rules (SL/TP/cooldown).

    Timing is identical to the vectorized engine: decisions are taken on bar
    close and execute at the NEXT bar open. Stop/target triggers are evaluated
    against the completed bar's low/high and also exit at the next open — this
    system trades from closed candles and does not rest stop orders, and the
    backtest must not pretend otherwise. After a stop/target exit, re-entry
    requires the signal to drop to 0 first, plus ``cooldown_bars`` bars.
    """
    sig = _validate_signals(df, signals)
    if len(df) < 2:
        raise ValueError("need at least 2 bars to backtest")

    open_ = df["open"].to_numpy(dtype="float64")
    high = df["high"].to_numpy(dtype="float64")
    low = df["low"].to_numpy(dtype="float64")
    close = df["close"].to_numpy(dtype="float64")
    index = df.index
    n = len(df)
    fee, slip = cost.fee, cost.slippage

    cash, units = initial_capital, 0.0
    entry_price = 0.0
    entry_bar = -1
    entry_fee = 0.0
    capital_before = 0.0
    total_fees = 0.0
    armed = True  # re-entry allowed; cleared by stop/target exits until signal drops to 0
    cooldown_until = 0  # earliest bar index at whose open an entry may execute
    pending: str | None = None  # action queued at last close: buy | sell
    pending_reason = "signal"

    equity = np.empty(n)
    position = np.zeros(n, dtype="int64")
    trades: list[Trade] = []

    for t in range(n):
        # 1. Execute the action queued at the previous close, at this open.
        if pending == "buy" and units == 0.0 and t >= cooldown_until:
            fill = open_[t] * (1.0 + slip)
            entry_fee = cash * fee
            units = cash * (1.0 - fee) / fill
            capital_before = cash
            cash = 0.0
            entry_price = fill
            entry_bar = t
            total_fees += entry_fee
        elif pending == "sell" and units > 0.0:
            fill = open_[t] * (1.0 - slip)
            proceeds = units * fill
            exit_fee = proceeds * fee
            cash = proceeds * (1.0 - fee)
            total_fees += exit_fee
            trades.append(
                Trade(
                    entry_time=index[entry_bar],
                    exit_time=index[t],
                    entry_price=entry_price,
                    exit_price=fill,
                    bars_held=t - entry_bar,
                    return_pct=cash / capital_before - 1.0,
                    pnl_usd=cash - capital_before,
                    fees_usd=entry_fee + exit_fee,
                    exit_reason=pending_reason,
                )
            )
            units = 0.0
            if pending_reason != "signal":
                cooldown_until = t + 1 + rules.cooldown_bars
        pending = None

        # 2. Mark to close.
        equity[t] = cash + units * close[t]
        position[t] = 1 if units > 0.0 else 0

        # 3. Decide at this close what happens at the next open.
        s = int(sig.iloc[t])
        if s == 0:
            armed = True
        if units > 0.0:
            trigger = rules.exit_trigger(entry_price, low[t], high[t])
            if trigger is not None:
                pending, pending_reason = "sell", trigger
                armed = False
            elif s == 0:
                pending, pending_reason = "sell", "signal"
        elif s == 1 and armed:
            pending = "buy"

    if units > 0.0:
        trades.append(
            Trade(
                entry_time=index[entry_bar],
                exit_time=None,
                entry_price=entry_price,
                exit_price=None,
                bars_held=n - 1 - entry_bar,
                return_pct=equity[-1] / capital_before - 1.0,
                pnl_usd=float(equity[-1] - capital_before),
                fees_usd=entry_fee,
                exit_reason=None,
            )
        )

    equity_s = pd.Series(equity, index=index, name="equity")
    return BacktestResult(
        equity=equity_s,
        position=pd.Series(position, index=index, name="position"),
        returns=equity_s.pct_change().fillna(equity_s.iloc[0] / initial_capital - 1.0),
        trades=trades,
        initial_capital=initial_capital,
        total_fees_usd=total_fees,
    )
