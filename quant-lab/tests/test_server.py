"""The dashboard server, exercised over real HTTP.

Two things are being pinned down here: that the page and the control API
work, and that nothing else can drive them. The server can halt trading, so
its authorization rules are as much a safety property as the kill switch.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.config import AppConfig
from quant_lab.server import DashboardApp, make_server, server_url

CONFIG: dict[str, Any] = {
    "mode": "paper",
    "exchanges": {"kraken": {"taker_fee_bps": 26, "maker_fee_bps": 16}},
    "data": {
        "exchange": "kraken",
        "symbols": ["BTC/USD"],
        "timeframes": ["1h"],
        "parquet_dir": "data/parquet",
    },
    "walkforward": {"in_sample_bars": 400, "out_of_sample_bars": 200, "step_bars": 200},
    "risk": {
        "kill_switches": {
            "max_daily_loss_pct": 3.0,
            "max_drawdown_pct": 10.0,
            "max_consecutive_api_errors": 5,
        }
    },
    "vault": {"enabled": True, "skim_pct": 15.0},
}


@pytest.fixture
def cfg() -> AppConfig:
    return AppConfig.model_validate(CONFIG)


@pytest.fixture
def db(tmp_path: Path) -> Path:
    audit = AuditLog(tmp_path / "audit.db")
    audit.beat("paper", interval_s=60.0, detail="1 strategy")
    audit.close()
    return tmp_path / "audit.db"


class Live:
    """A running server plus the helpers to talk to it."""

    def __init__(self, cfg: AppConfig, db: Path) -> None:
        self.httpd = make_server(cfg, [], lambda: AuditLog(db), host="127.0.0.1", port=0)
        self.token = self.httpd.app.token
        self.url = server_url(self.httpd)
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self._thread.join(timeout=5)

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, str]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.url.rstrip("/") + path, data=data, method=method
        )
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode()

    def control(self, action: str, **headers: str) -> tuple[int, str]:
        return self.request(
            "/api/control",
            method="POST",
            body={"action": action},
            headers={"Content-Type": "application/json", "X-QL-Token": self.token, **headers},
        )


@pytest.fixture
def live(cfg: AppConfig, db: Path) -> Iterator[Live]:
    server = Live(cfg, db)
    yield server
    server.close()


# -- serving ---------------------------------------------------------------


def test_index_serves_a_live_dashboard_with_controls(live: Live) -> None:
    code, body = live.request("/")
    assert code == 200
    assert "Heehaw" in body
    assert 'id="ql-start"' in body
    assert 'id="ql-stop"' in body
    assert live.token in body  # the page carries its own control token
    assert "Trading" in body


def test_state_endpoint_reports_status(live: Live) -> None:
    code, body = live.request("/api/state")
    assert code == 200
    state = json.loads(body)
    assert state["trading_enabled"] is True
    assert state["running"] is True
    assert state["label"] == "Trading"
    assert state["kill_switch"] is False
    assert isinstance(state["revision"], int)


def test_unknown_paths_404(live: Live) -> None:
    assert live.request("/../etc/passwd")[0] == 404
    assert live.request("/admin")[0] == 404


# -- control ---------------------------------------------------------------


def test_stop_then_start_round_trip(live: Live, db: Path) -> None:
    code, body = live.control("pause")
    assert code == 200
    assert json.loads(body)["changed"] is True
    assert json.loads(body)["trading_enabled"] is False
    assert AuditLog(db).trading_enabled() is False  # durable, not in-memory

    code, body = live.control("resume")
    assert code == 200
    assert json.loads(body)["trading_enabled"] is True
    assert AuditLog(db).trading_enabled() is True


def test_control_is_audited_with_the_dashboard_as_actor(live: Live, db: Path) -> None:
    live.control("pause")
    events = AuditLog(db).events(kind="trading_paused")
    assert len(events) == 1
    assert "dashboard" in str(events[0]["payload"])


def test_unknown_action_refused(live: Live, db: Path) -> None:
    code, body = live.request(
        "/api/control",
        method="POST",
        body={"action": "flatten_everything"},
        headers={"X-QL-Token": live.token},
    )
    assert code == 400
    assert "pause" in json.loads(body)["error"]
    assert AuditLog(db).trading_enabled() is True


def test_malformed_body_refused(live: Live) -> None:
    req = urllib.request.Request(
        live.url + "api/control", data=b"{not json", method="POST"
    )
    req.add_header("X-QL-Token", live.token)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    assert code == 400


# -- authorization ---------------------------------------------------------


def test_control_requires_the_token(live: Live, db: Path) -> None:
    code, body = live.request("/api/control", method="POST", body={"action": "pause"})
    assert code == 403
    assert "token" in json.loads(body)["error"]
    assert AuditLog(db).trading_enabled() is True


def test_wrong_token_refused(live: Live, db: Path) -> None:
    code, _ = live.request(
        "/api/control",
        method="POST",
        body={"action": "pause"},
        headers={"X-QL-Token": "not-the-token"},
    )
    assert code == 403
    assert AuditLog(db).trading_enabled() is True


def test_cross_origin_control_refused_even_with_the_token(live: Live, db: Path) -> None:
    """A page on another site must not be able to stop the bot."""
    code, body = live.control("pause", Origin="https://evil.example")
    assert code == 403
    assert "cross-origin" in json.loads(body)["error"]
    assert AuditLog(db).trading_enabled() is True


def test_foreign_host_header_refused(live: Live) -> None:
    """DNS rebinding: a hostile domain re-resolved to 127.0.0.1 still fails."""
    code, body = live.request("/api/state", headers={"Host": "evil.example"})
    assert code == 403
    assert "Host" in json.loads(body)["error"]


def test_loopback_host_names_accepted(live: Live) -> None:
    port = live.httpd.server_address[1]
    assert live.request("/api/state", headers={"Host": f"localhost:{port}"})[0] == 200
    assert live.request("/api/state", headers={"Host": f"127.0.0.1:{port}"})[0] == 200


# -- unit-level checks on the authorization helpers ------------------------


def _app(cfg: AppConfig, db: Path, host: str) -> DashboardApp:
    return DashboardApp(cfg, [], lambda: AuditLog(db), bind_host=host, token="tok")


def test_host_matching_handles_ports_and_ipv6(cfg: AppConfig, db: Path) -> None:
    app = _app(cfg, db, "127.0.0.1")
    assert app.host_ok("127.0.0.1:8787")
    assert app.host_ok("localhost")
    assert app.host_ok("[::1]:8787")
    assert not app.host_ok("bot.evil.example:8787")
    assert not app.host_ok("")


def test_binding_all_interfaces_cannot_scope_the_host_check(cfg: AppConfig, db: Path) -> None:
    """Opting into LAN access necessarily gives up rebinding protection; the
    token is what still stands between a stranger and the Stop button."""
    app = _app(cfg, db, "0.0.0.0")
    assert app.host_ok("192.168.1.20:8787")
    assert app.token_ok("tok")
    assert not app.token_ok("guess")


def test_token_comparison_rejects_prefixes(cfg: AppConfig, db: Path) -> None:
    app = _app(cfg, db, "127.0.0.1")
    assert not app.token_ok("to")
    assert not app.token_ok("tok ")
    assert not app.token_ok(None)
