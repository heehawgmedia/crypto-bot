"""SQLite audit trail and pipeline state.

Everything consequential — orders, fills, config changes, promotions,
kill-switch events — lands in one database with UTC timestamps. The same
database holds durable pipeline state (strategy stages, paper broker state,
kill-switch latch) so the audit record and the state it explains can never
drift apart.
"""

from __future__ import annotations

import contextlib
import json
import os
import socket
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

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
    reason TEXT,
    client_order_id TEXT            -- deterministic id sent to the exchange (live only)
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
    updated_utc TEXT NOT NULL,
    entry_price REAL,               -- fill price of the open position (stop/target base)
    reentry_armed INTEGER NOT NULL DEFAULT 1,
    cooldown_until_utc TEXT
);

CREATE TABLE IF NOT EXISTS kill_switch (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tripped INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    tripped_utc TEXT
);
INSERT OR IGNORE INTO kill_switch (id, tripped) VALUES (1, 0);

-- Durable live-engine state. Risk anchors persist here so a process restart
-- can never reset the drawdown peak or the daily-loss baseline (which would
-- amount to a kill-switch bypass).
CREATE TABLE IF NOT EXISTS live_state (
    strategy TEXT PRIMARY KEY,
    last_bar_utc TEXT,
    day_date TEXT,
    day_start_equity REAL,
    peak_equity REAL,
    updated_utc TEXT NOT NULL,
    entry_price REAL,               -- fill price of the open position (stop/target base)
    reentry_armed INTEGER NOT NULL DEFAULT 1,
    cooldown_until_utc TEXT
);

CREATE TABLE IF NOT EXISTS config_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_hash TEXT NOT NULL,
    config_json TEXT NOT NULL,
    updated_utc TEXT NOT NULL
);

-- Manual run switch, flipped from the dashboard or the CLI. Durable on
-- purpose: a bot stopped by its owner stays stopped across restarts and
-- reboots, exactly like the kill-switch latch.
CREATE TABLE IF NOT EXISTS run_control (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    trading_enabled INTEGER NOT NULL DEFAULT 1,
    changed_utc TEXT,
    changed_by TEXT,
    reason TEXT
);
INSERT OR IGNORE INTO run_control (id, trading_enabled) VALUES (1, 1);

-- Liveness: each poll of a trading loop stamps this row, so any reader can
-- tell whether a bot is actually running rather than merely configured to.
CREATE TABLE IF NOT EXISTS heartbeat (
    scope TEXT PRIMARY KEY,         -- paper | live
    ts_utc TEXT NOT NULL,
    pid INTEGER,
    host TEXT,
    interval_s REAL,
    detail TEXT
);

-- Vault: profit skimmed out of trading capital. Balance is the sum of skims
-- minus withdrawals and redistributions; the ledger is append-only.
CREATE TABLE IF NOT EXISTS vault_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc TEXT NOT NULL,
    kind TEXT NOT NULL,             -- skim | withdraw | redistribute
    amount_usd REAL NOT NULL CHECK (amount_usd > 0),
    strategy TEXT,
    mode TEXT,                      -- paper | live (skims only)
    ref_order_id INTEGER,
    note TEXT
);
"""

# Additive migrations for databases created before a column existed.
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("orders", "client_order_id", "ALTER TABLE orders ADD COLUMN client_order_id TEXT"),
    ("paper_state", "entry_price", "ALTER TABLE paper_state ADD COLUMN entry_price REAL"),
    (
        "paper_state",
        "reentry_armed",
        "ALTER TABLE paper_state ADD COLUMN reentry_armed INTEGER NOT NULL DEFAULT 1",
    ),
    (
        "paper_state",
        "cooldown_until_utc",
        "ALTER TABLE paper_state ADD COLUMN cooldown_until_utc TEXT",
    ),
    ("live_state", "entry_price", "ALTER TABLE live_state ADD COLUMN entry_price REAL"),
    (
        "live_state",
        "reentry_armed",
        "ALTER TABLE live_state ADD COLUMN reentry_armed INTEGER NOT NULL DEFAULT 1",
    ),
    (
        "live_state",
        "cooldown_until_utc",
        "ALTER TABLE live_state ADD COLUMN cooldown_until_utc TEXT",
    ),
    ("paper_state", "entry_cost_usd", "ALTER TABLE paper_state ADD COLUMN entry_cost_usd REAL"),
    ("live_state", "entry_cost_usd", "ALTER TABLE live_state ADD COLUMN entry_cost_usd REAL"),
]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AuditLog:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        # The dashboard server reads this database from its request threads
        # while a trading loop writes to it from another. WAL lets those
        # overlap; the busy timeout turns a momentary write lock into a short
        # wait instead of a "database is locked" crash mid-trade.
        with contextlib.suppress(sqlite3.DatabaseError):
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=10000")
        self._conn.executescript(_SCHEMA)
        for table, column, ddl in _MIGRATIONS:
            existing = {row["name"] for row in self._conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                self._conn.execute(ddl)
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
        client_order_id: str | None = None,
    ) -> int:
        cursor = self._conn.execute(
            "INSERT INTO orders (ts_utc, mode, strategy, exchange, symbol, side, qty, price,"
            " status, reason, client_order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                _now_iso(), mode, strategy, exchange, symbol, side, qty, price, status,
                reason, client_order_id,
            ),
        )
        self._conn.commit()
        return int(cursor.lastrowid or 0)

    def orders(
        self,
        strategy: str | None = None,
        mode: str | None = None,
        status: str | None = None,
    ) -> list[sqlite3.Row]:
        query = "SELECT * FROM orders WHERE 1=1"
        args: list[Any] = []
        if strategy is not None:
            query += " AND strategy = ?"
            args.append(strategy)
        if mode is not None:
            query += " AND mode = ?"
            args.append(mode)
        if status is not None:
            query += " AND status = ?"
            args.append(status)
        return list(self._conn.execute(query + " ORDER BY id", args))

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
        self,
        strategy: str,
        cash_usd: float,
        units: float,
        last_bar_utc: str | None,
        entry_price: float | None = None,
        reentry_armed: bool = True,
        cooldown_until_utc: str | None = None,
        entry_cost_usd: float | None = None,
    ) -> None:
        self._conn.execute(
            "INSERT INTO paper_state (strategy, cash_usd, units, last_bar_utc, updated_utc,"
            " entry_price, reentry_armed, cooldown_until_utc, entry_cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(strategy) DO UPDATE SET cash_usd = excluded.cash_usd,"
            " units = excluded.units, last_bar_utc = excluded.last_bar_utc,"
            " updated_utc = excluded.updated_utc, entry_price = excluded.entry_price,"
            " reentry_armed = excluded.reentry_armed,"
            " cooldown_until_utc = excluded.cooldown_until_utc,"
            " entry_cost_usd = excluded.entry_cost_usd",
            (
                strategy, cash_usd, units, last_bar_utc, _now_iso(),
                entry_price, int(reentry_armed), cooldown_until_utc, entry_cost_usd,
            ),
        )
        self._conn.commit()

    # -- live engine state (bar dedup + persisted risk anchors) ------------

    def get_live_state(self, strategy: str) -> sqlite3.Row | None:
        row = self._conn.execute(
            "SELECT * FROM live_state WHERE strategy = ?", (strategy,)
        ).fetchone()
        return row if isinstance(row, sqlite3.Row) else None

    def set_live_state(
        self,
        strategy: str,
        *,
        last_bar_utc: str | None,
        day_date: str | None,
        day_start_equity: float | None,
        peak_equity: float | None,
        entry_price: float | None = None,
        reentry_armed: bool = True,
        cooldown_until_utc: str | None = None,
        entry_cost_usd: float | None = None,
    ) -> None:
        self._conn.execute(
            "INSERT INTO live_state (strategy, last_bar_utc, day_date, day_start_equity,"
            " peak_equity, updated_utc, entry_price, reentry_armed, cooldown_until_utc,"
            " entry_cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(strategy) DO UPDATE SET last_bar_utc = excluded.last_bar_utc,"
            " day_date = excluded.day_date, day_start_equity = excluded.day_start_equity,"
            " peak_equity = excluded.peak_equity, updated_utc = excluded.updated_utc,"
            " entry_price = excluded.entry_price, reentry_armed = excluded.reentry_armed,"
            " cooldown_until_utc = excluded.cooldown_until_utc,"
            " entry_cost_usd = excluded.entry_cost_usd",
            (
                strategy, last_bar_utc, day_date, day_start_equity, peak_equity,
                _now_iso(), entry_price, int(reentry_armed), cooldown_until_utc,
                entry_cost_usd,
            ),
        )
        self._conn.commit()

    # -- config-change tracking --------------------------------------------

    def note_config(self, config_hash: str, config_json: str) -> bool:
        """Record the active config; log a config_change event when it differs
        from the last one seen. Returns True when a change was recorded."""
        row = self._conn.execute("SELECT config_hash FROM config_state WHERE id = 1").fetchone()
        previous = row["config_hash"] if row else None
        if previous == config_hash:
            return False
        self._conn.execute(
            "INSERT INTO config_state (id, config_hash, config_json, updated_utc)"
            " VALUES (1, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET config_hash = excluded.config_hash,"
            " config_json = excluded.config_json, updated_utc = excluded.updated_utc",
            (config_hash, config_json, _now_iso()),
        )
        self._conn.commit()
        kind = "config_registered" if previous is None else "config_change"
        self.record(kind, {"old_hash": previous, "new_hash": config_hash})
        return True

    # -- vault -------------------------------------------------------------

    def vault_credit(
        self,
        amount_usd: float,
        *,
        strategy: str,
        mode: str,
        ref_order_id: int | None = None,
        note: str | None = None,
    ) -> None:
        if amount_usd <= 0:
            raise ValueError("vault credits must be positive")
        self._conn.execute(
            "INSERT INTO vault_ledger (ts_utc, kind, amount_usd, strategy, mode,"
            " ref_order_id, note) VALUES (?, 'skim', ?, ?, ?, ?, ?)",
            (_now_iso(), amount_usd, strategy, mode, ref_order_id, note),
        )
        self._conn.commit()
        self.record(
            "vault_skim",
            {"amount_usd": amount_usd, "mode": mode, "ref_order_id": ref_order_id},
            strategy=strategy,
        )

    def vault_debit(self, amount_usd: float, kind: str, note: str | None = None) -> None:
        if kind not in ("withdraw", "redistribute"):
            raise ValueError(f"invalid vault debit kind {kind!r}")
        if amount_usd <= 0:
            raise ValueError("vault debits must be positive")
        balance = self.vault_balance()
        if amount_usd > balance + 1e-9:
            raise ValueError(
                f"vault balance is ${balance:,.2f}; cannot {kind} ${amount_usd:,.2f}"
            )
        self._conn.execute(
            "INSERT INTO vault_ledger (ts_utc, kind, amount_usd, note) VALUES (?, ?, ?, ?)",
            (_now_iso(), kind, amount_usd, note),
        )
        self._conn.commit()
        self.record(f"vault_{kind}", {"amount_usd": amount_usd, "note": note})

    def vault_balance(self) -> float:
        row = self._conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN kind = 'skim' THEN amount_usd"
            " ELSE -amount_usd END), 0) AS balance FROM vault_ledger"
        ).fetchone()
        return float(row["balance"])

    def vault_totals(self) -> dict[str, float]:
        totals = {"skim": 0.0, "withdraw": 0.0, "redistribute": 0.0}
        for row in self._conn.execute(
            "SELECT kind, COALESCE(SUM(amount_usd), 0) AS total FROM vault_ledger GROUP BY kind"
        ):
            totals[str(row["kind"])] = float(row["total"])
        return totals

    def vault_ledger(self) -> list[sqlite3.Row]:
        return list(self._conn.execute("SELECT * FROM vault_ledger ORDER BY id"))

    def vault_live_earmark(self) -> float:
        """Portion of the vault balance that reduces LIVE capital headroom.

        Paper skims are simulated money, so debits (withdraw/redistribute)
        are attributed to paper skims first; only the remainder releases the
        live earmark. Conservative: live headroom stays reduced longest.
        """
        totals = self.vault_totals()
        debits = totals["withdraw"] + totals["redistribute"]
        paper_skims = 0.0
        for row in self._conn.execute(
            "SELECT COALESCE(SUM(amount_usd), 0) AS t FROM vault_ledger"
            " WHERE kind = 'skim' AND mode = 'paper'"
        ):
            paper_skims = float(row["t"])
        live_skims = totals["skim"] - paper_skims
        debits_hitting_live = max(0.0, debits - paper_skims)
        return max(0.0, live_skims - debits_hitting_live)

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

    # -- manual run switch (dashboard / CLI) -------------------------------

    def run_control(self) -> tuple[bool, str | None, str | None]:
        """(trading_enabled, changed_utc, reason)."""
        row = self._conn.execute("SELECT * FROM run_control WHERE id = 1").fetchone()
        if row is None:  # pragma: no cover - the schema seeds this row
            return True, None, None
        return bool(row["trading_enabled"]), row["changed_utc"], row["reason"]

    def trading_enabled(self) -> bool:
        return self.run_control()[0]

    def set_trading_enabled(
        self, enabled: bool, *, actor: str, reason: str | None = None
    ) -> bool:
        """Pause or resume new entries. Returns True if the state changed.

        This never touches open positions: the trading loops keep honouring
        stop-loss, take-profit, and signal exits while paused, so pausing can
        never strand a position without its risk controls.
        """
        changed = self.trading_enabled() != enabled
        self._conn.execute(
            "UPDATE run_control SET trading_enabled = ?, changed_utc = ?, changed_by = ?,"
            " reason = ? WHERE id = 1",
            (int(enabled), _now_iso(), actor, reason),
        )
        self._conn.commit()
        if changed:
            self.record(
                "trading_resumed" if enabled else "trading_paused",
                {"actor": actor, "reason": reason},
            )
        return changed

    # -- liveness ----------------------------------------------------------

    def beat(self, scope: str, *, interval_s: float | None = None, detail: str = "") -> None:
        """Stamp the heartbeat for a trading loop ('paper' or 'live')."""
        self._conn.execute(
            "INSERT INTO heartbeat (scope, ts_utc, pid, host, interval_s, detail)"
            " VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(scope) DO UPDATE SET ts_utc = excluded.ts_utc, pid = excluded.pid,"
            " host = excluded.host, interval_s = excluded.interval_s, detail = excluded.detail",
            (scope, _now_iso(), os.getpid(), socket.gethostname(), interval_s, detail),
        )
        self._conn.commit()

    def heartbeat(self, scope: str) -> sqlite3.Row | None:
        row = self._conn.execute("SELECT * FROM heartbeat WHERE scope = ?", (scope,)).fetchone()
        return cast("sqlite3.Row | None", row)

    def heartbeat_age_s(self, scope: str, now: datetime | None = None) -> float | None:
        """Seconds since the loop last polled, or None if it never has."""
        row = self.heartbeat(scope)
        if row is None:
            return None
        seen = datetime.fromisoformat(str(row["ts_utc"]))
        return max(0.0, ((now or datetime.now(UTC)) - seen).total_seconds())

    def revision(self) -> int:
        """Cheap change counter: bumps whenever anything user-visible lands.

        The dashboard polls this to decide when a reload would show something
        new, instead of reloading on a timer and fighting the reader.
        """
        row = self._conn.execute(
            "SELECT (SELECT COUNT(*) FROM fills) + (SELECT COUNT(*) FROM orders)"
            " + (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM vault_ledger) AS n"
        ).fetchone()
        return int(row["n"])
