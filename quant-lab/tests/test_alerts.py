from __future__ import annotations

import json
import urllib.request

import pytest

from quant_lab.alerts import NullAlerter, TelegramAlerter, alerter_from_config
from quant_lab.config import AlertsConfig


def test_disabled_config_gives_null_alerter() -> None:
    cfg = AlertsConfig.model_validate({"telegram": {"enabled": False}})
    assert isinstance(alerter_from_config(cfg), NullAlerter)


def test_enabled_without_env_falls_back_to_null(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QL_TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("QL_TELEGRAM_CHAT_ID", raising=False)
    cfg = AlertsConfig.model_validate({"telegram": {"enabled": True}})
    assert isinstance(alerter_from_config(cfg), NullAlerter)


def test_enabled_with_env_gives_telegram(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QL_TELEGRAM_BOT_TOKEN", "tok123")
    monkeypatch.setenv("QL_TELEGRAM_CHAT_ID", "chat456")
    cfg = AlertsConfig.model_validate({"telegram": {"enabled": True}})
    assert isinstance(alerter_from_config(cfg), TelegramAlerter)


def test_send_posts_to_bot_api(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode())
        return FakeResponse()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    alerter = TelegramAlerter("tok123", "chat456", on_fill=True, on_kill_switch=True)
    alerter.fill("filled 0.01 BTC")
    assert captured["url"] == "https://api.telegram.org/bottok123/sendMessage"
    assert captured["body"] == {"chat_id": "chat456", "text": "filled 0.01 BTC"}


def test_fill_alerts_respect_toggle(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        TelegramAlerter, "_send", lambda self, text: calls.append(text)
    )
    alerter = TelegramAlerter("t", "c", on_fill=False, on_kill_switch=True)
    alerter.fill("should not send")
    alerter.kill_switch("should send")
    assert calls == ["should send"]


def test_send_failure_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def exploding_urlopen(request, timeout=0):
        raise ConnectionError("telegram down")

    monkeypatch.setattr(urllib.request, "urlopen", exploding_urlopen)
    alerter = TelegramAlerter("t", "c", on_fill=True, on_kill_switch=True)
    alerter.fill("this must not raise")  # trading loop must survive
