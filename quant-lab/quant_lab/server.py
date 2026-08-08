"""Local dashboard server: live view plus start/stop control.

The static dashboard is a snapshot; this serves the same page rendered fresh
from SQLite on every request, and adds two buttons that flip the durable run
switch the trading loops honour. Because the switch lives in the database, a
bot stopped from the browser stays stopped across restarts and reboots.

Security posture — this process can halt and resume trading, so:

* it binds loopback by default and is not reachable from the network;
* every mutating request must carry a per-process token that is only handed
  out inside the served page, in a **custom header** — a cross-origin POST
  carrying one triggers a CORS preflight, which is refused, so a malicious
  page in another tab cannot stop the bot;
* the ``Host`` header must name the interface actually bound, which defeats
  DNS rebinding (a hostile domain re-resolved to 127.0.0.1);
* an ``Origin`` header, when present, must match this server.

Nothing here reaches the exchange. The server only reads the local database
and writes one boolean to it.
"""

from __future__ import annotations

import hmac
import json
import secrets
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

from quant_lab.audit.log import AuditLog
from quant_lab.config import AppConfig, StrategyInstanceConfig
from quant_lab.reporting.dashboard import ControlContext, render_dashboard
from quant_lab.reporting.status import bot_status

_MAX_BODY = 8192
_LOOPBACK = frozenset({"127.0.0.1", "localhost", "::1"})
# Bind addresses meaning "every interface" — the Host check cannot be scoped
# to one name when the server answers on all of them.
_ANY_HOST = frozenset({"0.0.0.0", "::", ""})


def _hostname(raw: str) -> str:
    """Host header without its port. Handles ``[::1]:8787``."""
    raw = raw.strip()
    if raw.startswith("["):
        end = raw.find("]")
        return raw[1:end] if end > 0 else raw
    return raw.rsplit(":", 1)[0] if ":" in raw else raw


class DashboardApp:
    """Request-handling logic, independent of the HTTP plumbing.

    Each caller thread gets its own SQLite connection: connections are not
    shareable across threads, and a request must never block or corrupt the
    trading loop's writes.
    """

    def __init__(
        self,
        cfg: AppConfig,
        strategies: list[StrategyInstanceConfig],
        audit_factory: Callable[[], AuditLog],
        *,
        bind_host: str,
        token: str | None = None,
    ) -> None:
        self._cfg = cfg
        self._strategies = strategies
        self._audit_factory = audit_factory
        self._local = threading.local()
        self.token = token or secrets.token_urlsafe(24)
        self.allowed_hosts: frozenset[str] | None = (
            None if bind_host in _ANY_HOST else frozenset({bind_host}) | _LOOPBACK
        )

    def audit(self) -> AuditLog:
        got: AuditLog | None = getattr(self._local, "audit", None)
        if got is None:
            got = self._audit_factory()
            self._local.audit = got
        return got

    def close_thread_audit(self) -> None:
        got: AuditLog | None = getattr(self._local, "audit", None)
        if got is not None:
            got.close()
            self._local.audit = None

    # -- responses ---------------------------------------------------------

    def page(self) -> str:
        audit = self.audit()
        return render_dashboard(
            self._cfg,
            audit,
            self._strategies,
            controls=ControlContext(token=self.token, revision=audit.revision()),
        )

    def state(self) -> dict[str, Any]:
        audit = self.audit()
        tripped, ks_reason, _ = audit.kill_switch_state()
        status = bot_status(audit)
        return {
            **status.as_dict(),
            "revision": audit.revision(),
            "kill_switch": tripped,
            "kill_switch_reason": ks_reason,
        }

    def set_trading(self, enabled: bool, *, reason: str | None = None) -> dict[str, Any]:
        changed = self.audit().set_trading_enabled(
            enabled, actor="dashboard", reason=reason
        )
        return {**self.state(), "changed": changed}

    # -- authorization -----------------------------------------------------

    def host_ok(self, host_header: str) -> bool:
        if self.allowed_hosts is None:
            return True
        return _hostname(host_header) in self.allowed_hosts

    def token_ok(self, presented: str | None) -> bool:
        return hmac.compare_digest(presented or "", self.token)

    def origin_ok(self, origin: str | None) -> bool:
        if origin is None:
            return True  # same-origin fetches from our own page send none
        host = urlsplit(origin).hostname or ""
        return self.allowed_hosts is None or host in self.allowed_hosts


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    app: DashboardApp


class _Handler(BaseHTTPRequestHandler):
    server_version = "HeehawsLab"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    # Keep-alive is on, so a client that opens a socket and says nothing would
    # otherwise pin a thread indefinitely.
    timeout = 60

    @property
    def _app(self) -> DashboardApp:
        server: _Server = self.server  # type: ignore[assignment]
        return server.app

    def handle(self) -> None:
        """Serve one connection, then release its database handle.

        ThreadingHTTPServer runs each connection on its own thread and each
        thread opens its own SQLite connection; closing it here keeps a
        long-lived dashboard from accumulating handles.
        """
        try:
            super().handle()
        finally:
            self._app.close_thread_audit()

    def log_message(self, format: str, *args: Any) -> None:
        """Silence per-request logging; the trading log is the signal."""

    # -- plumbing ----------------------------------------------------------

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # A trading console has no business being framed, sniffed, or leaking
        # its URL to third parties.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict[str, Any], code: int = 200) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json; charset=utf-8")

    def _error(self, code: int, message: str) -> None:
        self._json({"error": message}, code=code)

    def _guard(self) -> bool:
        if not self._app.host_ok(self.headers.get("Host", "")):
            self._error(403, "unrecognized Host header")
            return False
        return True

    def _dispatch(self, route: Callable[[], None]) -> None:
        """Answer every request, even a failing one.

        Without this a render error would drop the connection with no
        response, and the dashboard would look hung rather than broken.
        """
        try:
            route()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser navigated away mid-response
        except Exception as exc:  # noqa: BLE001 - the page must say what went wrong
            self._error(500, f"dashboard error: {exc}")

    # -- routes ------------------------------------------------------------

    def do_GET(self) -> None:
        self._dispatch(self._get)

    def do_POST(self) -> None:
        self._dispatch(self._post)

    def _get(self) -> None:
        if not self._guard():
            return
        path = urlsplit(self.path).path
        if path == "/":
            self._send(200, self._app.page().encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/state":
            self._json(self._app.state())
        elif path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
        else:
            self._error(404, "not found")

    def _post(self) -> None:
        if not self._guard():
            return
        if urlsplit(self.path).path != "/api/control":
            self._error(404, "not found")
            return
        if not self._app.token_ok(self.headers.get("X-QL-Token")):
            self._error(403, "bad or missing control token — reload the dashboard")
            return
        if not self._app.origin_ok(self.headers.get("Origin")):
            self._error(403, "cross-origin control requests are refused")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._error(400, "bad Content-Length")
            return
        if length > _MAX_BODY:
            self._error(413, "body too large")
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, UnicodeDecodeError):
            self._error(400, "malformed JSON")
            return
        action = payload.get("action") if isinstance(payload, dict) else None
        if action not in ("pause", "resume"):
            self._error(400, "action must be 'pause' or 'resume'")
            return
        reason = payload.get("reason") if isinstance(payload, dict) else None
        self._json(
            self._app.set_trading(
                action == "resume",
                reason=str(reason)[:200] if reason else None,
            )
        )


def make_server(
    cfg: AppConfig,
    strategies: list[StrategyInstanceConfig],
    audit_factory: Callable[[], AuditLog],
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    token: str | None = None,
) -> _Server:
    """Build (but do not start) the dashboard server. Port 0 picks a free one."""
    app = DashboardApp(cfg, strategies, audit_factory, bind_host=host, token=token)
    httpd = _Server((host, port), _Handler)
    httpd.app = app
    return httpd


def server_url(httpd: _Server) -> str:
    host, port = httpd.server_address[0], httpd.server_address[1]
    shown = "127.0.0.1" if str(host) in _ANY_HOST else str(host)
    if ":" in shown:
        shown = f"[{shown}]"
    return f"http://{shown}:{port}/"
