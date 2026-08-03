"""Timeframe parsing shared by the data layer.

Only fixed-duration timeframes are supported: months ("1M") vary in length,
which would make gap detection ambiguous, so they are rejected.
"""

from __future__ import annotations

import re

_UNIT_MS: dict[str, int] = {
    "m": 60_000,
    "h": 3_600_000,
    "d": 86_400_000,
    "w": 604_800_000,
}

_TIMEFRAME_RE = re.compile(r"^(\d+)([mhdw])$")


def timeframe_to_ms(timeframe: str) -> int:
    match = _TIMEFRAME_RE.match(timeframe)
    if match is None:
        raise ValueError(
            f"unsupported timeframe {timeframe!r}; expected e.g. '15m', '1h', '4h', '1d', '1w'"
        )
    count, unit = match.groups()
    return int(count) * _UNIT_MS[unit]
