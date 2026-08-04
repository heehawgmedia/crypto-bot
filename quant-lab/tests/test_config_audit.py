from __future__ import annotations

import hashlib
from pathlib import Path

from quant_lab.audit.log import AuditLog


def _note(audit: AuditLog, payload: str) -> bool:
    return audit.note_config(hashlib.sha256(payload.encode()).hexdigest(), payload)


def test_first_config_is_registered(tmp_path: Path) -> None:
    audit = AuditLog(tmp_path / "a.db")
    assert _note(audit, '{"slippage": 10}')
    kinds = [row["kind"] for row in audit.events()]
    assert kinds == ["config_registered"]


def test_unchanged_config_records_nothing(tmp_path: Path) -> None:
    audit = AuditLog(tmp_path / "a.db")
    _note(audit, '{"slippage": 10}')
    assert not _note(audit, '{"slippage": 10}')
    assert len(audit.events()) == 1


def test_changed_config_records_change_event(tmp_path: Path) -> None:
    audit = AuditLog(tmp_path / "a.db")
    _note(audit, '{"slippage": 10}')
    assert _note(audit, '{"slippage": 25}')
    change = audit.events(kind="config_change")
    assert len(change) == 1
    assert "old_hash" in change[0]["payload"]


def test_migration_adds_client_order_id_to_old_db(tmp_path: Path) -> None:
    """A database created before the column existed gains it on open."""
    import sqlite3

    db = tmp_path / "old.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_utc TEXT NOT NULL,"
        " mode TEXT NOT NULL, strategy TEXT NOT NULL, exchange TEXT NOT NULL,"
        " symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, price REAL,"
        " status TEXT NOT NULL, reason TEXT)"
    )
    conn.commit()
    conn.close()

    audit = AuditLog(db)  # must not raise, must add the column
    order_id = audit.record_order(
        mode="live", strategy="s", exchange="kraken", symbol="BTC/USD", side="buy",
        qty=1.0, price=1.0, status="filled", client_order_id="abc123",
    )
    assert audit.orders()[0]["client_order_id"] == "abc123"
    assert order_id > 0
