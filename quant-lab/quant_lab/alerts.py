"""Telegram alerts for fills and kill-switch events.

Credentials come from environment variables only (QL_TELEGRAM_BOT_TOKEN,
QL_TELEGRAM_CHAT_ID). Alert delivery is best-effort: a Telegram outage must
never take down or block the trading loop, so failures are swallowed after
being noted on stderr.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from typing import Protocol

from quant_lab.config import AlertsConfig


class Alerter(Protocol):
    def fill(self, text: str) -> None: ...

    def kill_switch(self, text: str) -> None: ...


class NullAlerter:
    def fill(self, text: str) -> None:
        return None

    def kill_switch(self, text: str) -> None:
        return None


class TelegramAlerter:
    def __init__(self, token: str, chat_id: str, on_fill: bool, on_kill_switch: bool) -> None:
        self._url = f"https://api.telegram.org/bot{token}/sendMessage"
        self._chat_id = chat_id
        self._on_fill = on_fill
        self._on_kill_switch = on_kill_switch

    def _send(self, text: str) -> None:
        payload = json.dumps({"chat_id": self._chat_id, "text": text}).encode()
        request = urllib.request.Request(
            self._url, data=payload, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=10):
                pass
        except Exception as exc:  # noqa: BLE001 - alerting must never break trading
            print(f"telegram alert failed: {exc}", file=sys.stderr)

    def fill(self, text: str) -> None:
        if self._on_fill:
            self._send(text)

    def kill_switch(self, text: str) -> None:
        if self._on_kill_switch:
            self._send(text)


class DiscordAlerter:
    """Posts to a Discord webhook (QL_DISCORD_WEBHOOK_URL). Best-effort."""

    def __init__(self, webhook_url: str, on_fill: bool, on_kill_switch: bool) -> None:
        self._url = webhook_url
        self._on_fill = on_fill
        self._on_kill_switch = on_kill_switch

    def _send(self, text: str) -> None:
        payload = json.dumps({"content": text}).encode()
        request = urllib.request.Request(
            self._url, data=payload, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=10):
                pass
        except Exception as exc:  # noqa: BLE001 - alerting must never break trading
            print(f"discord alert failed: {exc}", file=sys.stderr)

    def fill(self, text: str) -> None:
        if self._on_fill:
            self._send(text)

    def kill_switch(self, text: str) -> None:
        if self._on_kill_switch:
            self._send(text)


class MultiAlerter:
    def __init__(self, alerters: list[Alerter]) -> None:
        self._alerters = alerters

    def fill(self, text: str) -> None:
        for a in self._alerters:
            a.fill(text)

    def kill_switch(self, text: str) -> None:
        for a in self._alerters:
            a.kill_switch(text)


def alerter_from_config(cfg: AlertsConfig) -> Alerter:
    alerters: list[Alerter] = []

    tg = cfg.telegram
    if tg.enabled:
        token = os.environ.get("QL_TELEGRAM_BOT_TOKEN", "")
        chat_id = os.environ.get("QL_TELEGRAM_CHAT_ID", "")
        if token and chat_id:
            alerters.append(TelegramAlerter(token, chat_id, tg.on_fill, tg.on_kill_switch))
        else:
            print(
                "telegram alerts enabled but QL_TELEGRAM_BOT_TOKEN / QL_TELEGRAM_CHAT_ID "
                "not set; telegram alerts disabled",
                file=sys.stderr,
            )

    dc = cfg.discord
    if dc.enabled:
        webhook = os.environ.get("QL_DISCORD_WEBHOOK_URL", "")
        if webhook:
            alerters.append(DiscordAlerter(webhook, dc.on_fill, dc.on_kill_switch))
        else:
            print(
                "discord alerts enabled but QL_DISCORD_WEBHOOK_URL not set; "
                "discord alerts disabled",
                file=sys.stderr,
            )

    if not alerters:
        return NullAlerter()
    if len(alerters) == 1:
        return alerters[0]
    return MultiAlerter(alerters)
