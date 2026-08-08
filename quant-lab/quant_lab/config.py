"""Configuration models.

All YAML config is validated through these pydantic models. Unknown keys are
rejected (extra="forbid") so a typo can never silently disable a safety limit.

Promotion gates that the spec declares non-negotiable are frozen at the model
level: e.g. ``min_oos_trades`` has a validation floor of 30, so no config file
can lower it.
"""

from __future__ import annotations

import enum
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Mode(str, enum.Enum):
    RESEARCH = "research"
    PAPER = "paper"
    LIVE = "live"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExchangeConfig(_StrictModel):
    taker_fee_bps: float = Field(ge=0)
    maker_fee_bps: float = Field(ge=0)
    rate_limit_ms: int = Field(default=1000, ge=0)


class DataConfig(_StrictModel):
    exchange: str
    symbols: list[str] = Field(min_length=1)
    timeframes: list[str] = Field(min_length=1)
    start_date: str = "2019-01-01"
    parquet_dir: Path = Path("data/parquet")
    max_gap_bars: int = Field(default=3, ge=0)


class BacktestConfig(_StrictModel):
    slippage_bps: float = Field(default=10.0, ge=0)
    initial_capital_usd: float = Field(default=10_000.0, gt=0)
    # Only next-bar-open execution exists in v1: signals computed on bar close
    # can never fill on the same bar.
    execution: Literal["next_bar_open"] = "next_bar_open"


class WalkforwardConfig(_StrictModel):
    in_sample_bars: int = Field(gt=0)
    out_of_sample_bars: int = Field(gt=0)
    step_bars: int = Field(gt=0)
    min_windows: int = Field(default=4, ge=1)
    optimize_metric: Literal["sharpe", "sortino", "profit_factor"] = "sharpe"

    @model_validator(mode="after")
    def _oos_windows_must_not_overlap(self) -> WalkforwardConfig:
        # Overlapping OOS windows would double-count bars in the stitched
        # record, inflating the official track. Gaps are allowed; overlap isn't.
        if self.step_bars < self.out_of_sample_bars:
            raise ValueError(
                f"step_bars ({self.step_bars}) must be >= out_of_sample_bars "
                f"({self.out_of_sample_bars}): overlapping OOS windows would "
                "double-count the stitched record"
            )
        return self


class PromotionConfig(_StrictModel):
    # ge=30 is the enforcement of the 30-trade floor: a config asking for less
    # fails validation before anything runs. There is deliberately no override.
    min_oos_trades: int = Field(default=30, ge=30)
    min_paper_days: int = Field(default=56, ge=1)
    min_oos_sharpe: float = 0.0


class KillSwitchConfig(_StrictModel):
    max_daily_loss_pct: float = Field(gt=0)
    max_drawdown_pct: float = Field(gt=0)
    max_consecutive_api_errors: int = Field(gt=0)
    flatten_on_trip: bool = False


class RiskConfig(_StrictModel):
    # No default on purpose: the owner sets this value explicitly. null is
    # accepted for research/paper; live mode with null fails at startup
    # (see AppConfig validator).
    max_capital_usd: float | None = Field(default=None, gt=0)
    max_positions: int = Field(default=3, ge=1, le=3)
    per_strategy_capital_frac: float = Field(default=0.5, gt=0, le=1.0)
    # Allowed shortfall (fraction of the audited position) between the audit
    # book and the exchange balance before live trading refuses to start.
    reconcile_tolerance_frac: float = Field(default=0.01, ge=0, le=0.5)
    kill_switches: KillSwitchConfig


class TelegramConfig(_StrictModel):
    enabled: bool = False
    on_fill: bool = True
    on_kill_switch: bool = True


class DiscordConfig(_StrictModel):
    enabled: bool = False
    on_fill: bool = True
    on_kill_switch: bool = True


class AlertsConfig(_StrictModel):
    telegram: TelegramConfig = TelegramConfig()
    discord: DiscordConfig = DiscordConfig()


class VaultConfig(_StrictModel):
    """Profit skimming: a slice of each winning trade's net profit is moved
    out of trading capital into a vault ledger (withdraw or redistribute via
    the CLI). Applies to paper and live fills; every movement is audited."""

    enabled: bool = False
    skim_pct: float = Field(default=15.0, gt=0, lt=100)


class AuditConfig(_StrictModel):
    sqlite_path: Path = Path("data/quantlab.db")


class AppConfig(_StrictModel):
    mode: Mode = Mode.PAPER
    exchanges: dict[str, ExchangeConfig]
    data: DataConfig
    backtest: BacktestConfig = BacktestConfig()
    walkforward: WalkforwardConfig
    promotion: PromotionConfig = PromotionConfig()
    risk: RiskConfig
    vault: VaultConfig = VaultConfig()
    alerts: AlertsConfig = AlertsConfig()
    audit: AuditConfig = AuditConfig()

    @model_validator(mode="after")
    def _live_requires_capital_cap(self) -> AppConfig:
        if self.mode is Mode.LIVE and self.risk.max_capital_usd is None:
            raise ValueError(
                "mode=live requires risk.max_capital_usd to be set explicitly; "
                "there is no default capital cap"
            )
        return self

    @model_validator(mode="after")
    def _data_exchange_known(self) -> AppConfig:
        if self.data.exchange not in self.exchanges:
            raise ValueError(
                f"data.exchange {self.data.exchange!r} is not configured under 'exchanges'"
            )
        return self


class WalkforwardOverride(_StrictModel):
    """Per-strategy overrides of the global walk-forward windows (a daily
    strategy needs far smaller bar counts than an hourly one)."""

    in_sample_bars: int | None = Field(default=None, gt=0)
    out_of_sample_bars: int | None = Field(default=None, gt=0)
    step_bars: int | None = Field(default=None, gt=0)
    min_windows: int | None = Field(default=None, ge=1)
    optimize_metric: Literal["sharpe", "sortino", "profit_factor"] | None = None


def effective_walkforward(
    base: WalkforwardConfig, override: WalkforwardOverride | None
) -> WalkforwardConfig:
    """Merge a strategy's overrides onto the global config; the merged result
    passes through full validation (incl. the OOS-overlap rule)."""
    if override is None:
        return base
    merged = base.model_dump()
    for key, value in override.model_dump().items():
        if value is not None:
            merged[key] = value
    return WalkforwardConfig.model_validate(merged)


class StrategyInstanceConfig(_StrictModel):
    """One strategy instance (config/strategies/*.yaml)."""

    name: str = Field(min_length=1)
    strategy: str
    exchange: str  # where orders execute (fees + live client)
    symbol: str
    timeframe: str
    params: dict[str, Any]
    param_grid: dict[str, list[Any]] = Field(default_factory=dict)
    # Where OHLCV history comes from (default: the trading exchange).
    # Kraken's API only serves ~720 candles, so deep history is typically
    # sourced from coinbase while still trading on kraken.
    data_exchange: str | None = None

    @property
    def data_source(self) -> str:
        return self.data_exchange or self.exchange
    # Optional trade rules, applied identically in backtest, walk-forward,
    # paper, and live (see quant_lab.risk.stops).
    stop_loss_pct: float | None = Field(default=None, gt=0, lt=100)
    take_profit_pct: float | None = Field(default=None, gt=0)
    cooldown_bars: int = Field(default=0, ge=0)
    # Optional per-strategy walk-forward window sizes.
    walkforward: WalkforwardOverride | None = None


def _load_yaml(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        raise TypeError(f"{path} must contain a YAML mapping, got {type(raw).__name__}")
    return raw


def load_config(path: Path) -> AppConfig:
    return AppConfig.model_validate(_load_yaml(path))


def load_strategy_config(path: Path) -> StrategyInstanceConfig:
    return StrategyInstanceConfig.model_validate(_load_yaml(path))
