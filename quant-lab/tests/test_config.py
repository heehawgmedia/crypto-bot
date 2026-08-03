from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from quant_lab.config import Mode, load_config

REPO_CONFIG = Path(__file__).resolve().parent.parent / "config" / "config.yaml"


def _base() -> dict:
    return {
        "mode": "paper",
        "exchanges": {"kraken": {"taker_fee_bps": 26, "maker_fee_bps": 16}},
        "data": {"exchange": "kraken", "symbols": ["BTC/USD"], "timeframes": ["1h"]},
        "walkforward": {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50},
        "risk": {
            "kill_switches": {
                "max_daily_loss_pct": 3.0,
                "max_drawdown_pct": 10.0,
                "max_consecutive_api_errors": 5,
            }
        },
    }


def _validate(raw: dict):
    from quant_lab.config import AppConfig

    return AppConfig.model_validate(raw)


def test_shipped_config_is_valid() -> None:
    cfg = load_config(REPO_CONFIG)
    assert cfg.mode is Mode.PAPER
    assert cfg.promotion.min_oos_trades == 30
    assert cfg.risk.max_capital_usd is None


def test_unknown_keys_rejected() -> None:
    raw = _base()
    raw["risk"]["kill_switches"]["max_daily_los_pct"] = 1.0  # typo must not pass silently
    with pytest.raises(ValidationError):
        _validate(raw)


def test_min_oos_trades_floor_cannot_be_lowered() -> None:
    raw = _base()
    raw["promotion"] = {"min_oos_trades": 29}
    with pytest.raises(ValidationError):
        _validate(raw)
    raw["promotion"] = {"min_oos_trades": 30}
    assert _validate(raw).promotion.min_oos_trades == 30


def test_live_mode_requires_capital_cap() -> None:
    raw = _base()
    raw["mode"] = "live"
    with pytest.raises(ValidationError, match="max_capital_usd"):
        _validate(raw)
    raw["risk"]["max_capital_usd"] = 500.0
    assert _validate(raw).risk.max_capital_usd == 500.0


def test_paper_mode_allows_null_capital_cap() -> None:
    assert _validate(_base()).risk.max_capital_usd is None


def test_data_exchange_must_be_configured() -> None:
    raw = _base()
    raw["data"]["exchange"] = "coinbase"  # not present under exchanges
    with pytest.raises(ValidationError, match="not configured"):
        _validate(raw)


def test_max_positions_capped_at_three() -> None:
    raw = _base()
    raw["risk"]["max_positions"] = 4
    with pytest.raises(ValidationError):
        _validate(raw)
