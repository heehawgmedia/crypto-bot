"""Plain-text tearsheet: strategy metrics side by side with buy-and-hold over
the identical window. The benchmark column is not optional — a strategy that
can't be compared to just holding is not reportable."""

from __future__ import annotations

import math

import pandas as pd

from quant_lab.reporting.metrics import Metrics

_ROWS: list[tuple[str, str, str]] = [
    ("Net PnL (USD)", "net_pnl_usd", "+,.2f"),
    ("Net return %", "net_return_pct", "+.2f"),
    ("CAGR %", "cagr_pct", "+.2f"),
    ("Sharpe", "sharpe", ".2f"),
    ("Sortino", "sortino", ".2f"),
    ("Max drawdown %", "max_drawdown_pct", ".2f"),
    ("Win rate %", "win_rate_pct", ".1f"),
    ("Profit factor", "profit_factor", ".2f"),
    ("Avg trade %", "avg_trade_pct", "+.3f"),
    ("Exposure %", "exposure_pct", ".1f"),
    ("Total trades", "total_trades", "d"),
    ("Fees paid (USD)", "total_fees_usd", ",.2f"),
]


def _fmt(value: float, spec: str) -> str:
    if isinstance(value, float) and math.isinf(value):
        return "inf"
    return format(value, spec)


def render_tearsheet(
    title: str,
    strategy: Metrics,
    benchmark: Metrics,
    window: tuple[pd.Timestamp, pd.Timestamp],
    benchmark_label: str = "buy & hold",
) -> str:
    start, end = window
    lines = [
        title,
        f"window: {start} -> {end} (UTC)",
        "",
        f"{'metric':<20} {'strategy':>14} {benchmark_label:>14}",
        "-" * 50,
    ]
    for label, attr, spec in _ROWS:
        s = _fmt(getattr(strategy, attr), spec)
        b = _fmt(getattr(benchmark, attr), spec)
        lines.append(f"{label:<20} {s:>14} {b:>14}")
    return "\n".join(lines)
