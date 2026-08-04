"""OHLCV integrity checks.

A dataset that fails these checks must not feed a backtest: gaps and bad bars
turn into phantom returns. The CLI `data check` command runs this and exits
non-zero on failure so it can gate scripted pipelines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pandas as pd

from quant_lab.data.store import OHLCV_COLUMNS
from quant_lab.data.timeframes import timeframe_to_ms


@dataclass
class Gap:
    start: pd.Timestamp  # last bar before the gap
    end: pd.Timestamp  # first bar after the gap
    missing_bars: int


@dataclass
class IntegrityReport:
    rows: int
    errors: list[str] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        lines = [f"rows={self.rows} gaps={len(self.gaps)} status={'OK' if self.ok else 'FAIL'}"]
        lines.extend(f"  ERROR: {e}" for e in self.errors)
        lines.extend(
            f"  gap: {g.missing_bars} bars missing between {g.start} and {g.end}"
            for g in self.gaps
        )
        return "\n".join(lines)


def check_ohlcv(df: pd.DataFrame, timeframe: str, max_gap_bars: int) -> IntegrityReport:
    """Validate an OHLCV frame; any gap longer than ``max_gap_bars`` is an error."""
    report = IntegrityReport(rows=len(df))

    if list(df.columns) != OHLCV_COLUMNS:
        report.errors.append(f"expected columns {OHLCV_COLUMNS}, got {list(df.columns)}")
        return report
    if df.empty:
        report.errors.append("dataset is empty")
        return report
    if not isinstance(df.index, pd.DatetimeIndex) or df.index.tz is None:
        report.errors.append("index must be a timezone-aware (UTC) DatetimeIndex")
        return report

    if df.index.has_duplicates:
        dupes = int(df.index.duplicated().sum())
        report.errors.append(f"{dupes} duplicate timestamps")
    if not df.index.is_monotonic_increasing:
        report.errors.append("timestamps are not sorted ascending")

    nan_rows = int(df.isna().any(axis=1).sum())
    if nan_rows:
        report.errors.append(f"{nan_rows} rows contain NaN values")

    clean = df.dropna()
    bad_ohlc = (
        (clean["high"] < clean[["open", "close", "low"]].max(axis=1))
        | (clean["low"] > clean[["open", "close", "high"]].min(axis=1))
        | (clean[["open", "high", "low", "close"]] <= 0).any(axis=1)
        | (clean["volume"] < 0)
    )
    if int(bad_ohlc.sum()):
        report.errors.append(
            f"{int(bad_ohlc.sum())} rows violate OHLC sanity "
            "(high/low bounds, non-positive prices, or negative volume)"
        )

    # Gap detection needs an ordered, de-duplicated index to be meaningful.
    if df.index.is_monotonic_increasing and not df.index.has_duplicates and len(df) > 1:
        bar_ms = timeframe_to_ms(timeframe)
        deltas_ms = df.index.to_series().diff().dropna().dt.total_seconds() * 1000
        for ts_raw, delta in deltas_ms[deltas_ms != bar_ms].items():
            ts = cast(pd.Timestamp, ts_raw)
            if delta % bar_ms != 0:
                report.errors.append(
                    f"bar at {ts} is off-grid: {delta:.0f}ms since previous bar "
                    f"is not a multiple of the {timeframe} bar size"
                )
                continue
            missing = int(delta // bar_ms) - 1
            gap = Gap(start=ts - pd.Timedelta(milliseconds=delta), end=ts, missing_bars=missing)
            report.gaps.append(gap)
            if missing > max_gap_bars:
                report.errors.append(
                    f"gap of {missing} bars (> max_gap_bars={max_gap_bars}) "
                    f"between {gap.start} and {gap.end}"
                )

    return report
