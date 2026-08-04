"""SQLite audit trail and pipeline state.

Everything consequential — orders, fills, config changes, promotions,
kill-switch events — lands in one database with UTC timestamps. The same
database holds durable pipeline state (strategy stages, paper broker state,
kill-switch latch) so the audit record and the state it explains can never
drift apart.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc TEXT NOT NULL,
    kind TEXT NOT NULL,
    strategy TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_strategy ON events(strategy);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc TEXT NOT NULL,
    mode TEXT NOT NULL,             -- paper | live
    strategy TEXT NOT NULL,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,             -- buy | sell
    qty REAL NOT NULL,
    price REAL,                     -- reference price at submission
    status TEXT NOT NULL,           -- filled | rejected | error
    reason TEXT
);

CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    ts_utc TEXT NOT NULL,
    mode TEXT NOT NULL,
    strategy TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    price REAL NOT NULL,            -- actual fill price (slippage included)
    fee_usd REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_stage (
    strategy TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    updated_utc TEXT NOT NULL,
    paper_started_utc TEXT
);

CREATE TABLE IF NOT EXISTS paper_state (
    strategy TEXT PRIMARY KEY,
    cash_usd REAL NOT NULL,
    units REAL NOT NULL,
    last_bar_utc TEXT,
    updated_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kill_switch (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tripped INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    tripped_utc TEXT
);
INSERT OR IGNORE INTO kill_switch (id, tripped) VALUES (1, 0);
"""


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AuditLog:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # -- events ------------------------------------------------------------

    def record(self, kind: str, payload: dict[str, Any], strategy: str | None = None) -> None:
        self._conn.execute(
            "INSERT INTO events (ts_utc, kind, strategy, payload) VALUES (?, ?, ?, ?)",
            (_now_iso(), kind, strategy, json.dumps(payload, default=str)),
        )
        self._conn.commit()

    def events(self, kind: str | None = None, strategy: str | None = None) -> list[sqlite3.Row]:
        query = "SELECT * FROM events WHERE 1=1"
        args: list[Any] = []
        if kind is not None:
            query += " AND kind = ?"
            args.append(kind)
        if strategy is not None:
            query += " AND strategy = ?"
            args.append(strategy)
        return list(self._conn.execute(query + " ORDER BY id", args))

    # -- orders / fills ----------------------------------------------------

    def record_order(
        self,
        *,
        mode: str,
        strategy: str,
        exchange: str,
        symbol: str,
        side: str,
        qty: float,
        price: float | None,
        status: str,
        reason: str | None = None,
    ) -> int:
        cursor = self._conn.execute(
            "INSERT INTO orders (ts_utc, mode, strategy, exchange, symbol, side, qty, price,"
            " status, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (_now_iso(), mode, strategy, exchange, symbol, side, qty, price, status, reason),
        )
        self._conn.commit()
        return int(cursor.lastrowid or 0)

    def record_fill(
        self,
        *,
        order_id: int,
        mode: str,
        strategy: str,
        symbol: str,
        side: str,
        qty: float,
        price: float,
        fee_usd: float,
    ) -> None:
        self._conn.execute(
            "INSERT INTO fills (order_id, ts_utc, mode, strategy, symbol, side, qty, price,"
            " fee_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (order_id, _now_iso(), mode, strategy, symbol, side, qty, price, fee_usd),
        )
        self._conn.commit()

    def fills(self, strategy: str | None = None, mode: str | None = None) -> list[sqlite3.Row]:
        query = "SELECT * FROM fills WHERE 1=1"
        args: list[Any] = []
        if strategy is not None:
            query += " AND strategy = ?"
            args.append(strategy)
        if mode is not None:
            query += " AND mode = ?"
            args.append(mode)
        return list(self._conn.execute(query + " ORDER BY id", args))

    # -- strategy stages ---------------------------------------------------

    def get_stage(self, strategy: str) -> str:
        row = self._conn.execute(
            "SELECT stage FROM strategy_stage WHERE strategy = ?", (strategy,)
        ).fetchone()
        return str(row["stage"]) if row else "candidate"

    def set_stage(self, strategy: str, stage: str, detail: dict[str, Any]) -> None:
        now = _now_iso()
        paper_started = now if stage == "paper" else None
        self._conn.execute(
            "INSERT INTO strategy_stage (strategy, stage, updated_utc, paper_started_utc)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(strategy) DO UPDATE SET stage = excluded.stage,"
            " updated_utc = excluded.updated_utc,"
            " paper_started_utc = COALESCE(excluded.paper_started_utc, paper_started_utc)",
            (strategy, stage, now, paper_started),
        )
        self._conn.commit()
        self.record("promotion", {"stage": stage, **detail}, strategy=strategy)

    def paper_started_at(self, strategy: str) -> datetime | None:
        row = self._conn.execute(
            "SELECT paper_started_utc FROM strategy_stage WHERE strategy = ?", (strategy,)
        ).fetchone()
        if row is None or row["paper_started_utc"] is None:
            return None
        return datetime.fromisoformat(row["paper_started_utc"])

    # -- paper broker state ------------------------------------------------

    def get_paper_state(self, strategy: str) -> sqlite3.Row | None:
        row = self._conn.execute(
            "SELECT * FROM paper_state WHERE strategy = ?", (strategy,)
        ).fetchone()
        return row if isinstance(row, sqlite3.Row) else None

    def set_paper_state(
        self, strategy: str, cash_usd: float, units: float, last_bar_utc: str | None
    ) -> None:
        self._conn.execute(
            "INSERT INTO paper_state (strategy, cash_usd, units, last_bar_utc, updated_utc)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(strategy) DO UPDATE SET cash_usd = excluded.cash_usd,"
            " units = excluded.units, last_bar_utc = excluded.last_bar_utc,"
            " updated_utc = excluded.updated_utc",
            (strategy, cash_usd, units, last_bar_utc, _now_iso()),
        )
        self._conn.commit()

    # -- kill switch latch -------------------------------------------------

    def kill_switch_state(self) -> tuple[bool, str | None, str | None]:
        row = self._conn.execute("SELECT * FROM kill_switch WHERE id = 1").fetchone()
        return bool(row["tripped"]), row["reason"], row["tripped_utc"]

    def trip_kill_switch(self, reason: str) -> None:
        self._conn.execute(
            "UPDATE kill_switch SET tripped = 1, reason = ?, tripped_utc = ? WHERE id = 1",
            (reason, _now_iso()),
        )
        self._conn.commit()
        self.record("kill_switch_trip", {"reason": reason})

    def reset_kill_switch(self, confirmed_by: str) -> None:
        self._conn.execute(
            "UPDATE kill_switch SET tripped = 0, reason = NULL, tripped_utc = NULL WHERE id = 1"
        )
        self._conn.commit()
        self.record("kill_switch_reset", {"confirmed_by": confirmed_by})
