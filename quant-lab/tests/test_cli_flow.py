"""CLI integration tests: the real typer app, an isolated working directory,
and the full promotion flow — including the refusals that matter most."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from quant_lab.cli import app
from quant_lab.data.store import ParquetStore
from tests.conftest import make_ohlcv

runner = CliRunner()

CONFIG = """
mode: paper
exchanges:
  kraken: {taker_fee_bps: 26, maker_fee_bps: 16}
data:
  exchange: kraken
  symbols: [BTC/USD]
  timeframes: [1h]
  start_date: "2023-01-01"
  parquet_dir: data/parquet
  max_gap_bars: 3
walkforward:
  in_sample_bars: 400
  out_of_sample_bars: 200
  step_bars: 200
  min_windows: 2
promotion:
  min_oos_trades: 30
  min_paper_days: 56
  min_oos_sharpe: -1000.0   # optional extra bar disabled: this test exercises flow, not alpha
risk:
  kill_switches: {max_daily_loss_pct: 3.0, max_drawdown_pct: 10.0, max_consecutive_api_errors: 5}
"""

STRATEGY = """
name: cli_flow_test
strategy: rsi_mr
exchange: kraken
symbol: BTC/USD
timeframe: 1h
params: {period: 5, oversold: 45, overbought: 55}
"""


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config" / "strategies").mkdir(parents=True)
    (tmp_path / "config" / "config.yaml").write_text(CONFIG)
    (tmp_path / "config" / "strategies" / "s.yaml").write_text(STRATEGY)
    store = ParquetStore(tmp_path / "data" / "parquet")
    store.write("kraken", "BTC/USD", "1h", make_ohlcv(start="2023-01-01", bars=2500, seed=7))
    return tmp_path


def test_data_check_passes(workspace: Path) -> None:
    result = runner.invoke(app, ["data", "check"])
    assert result.exit_code == 0, result.output
    assert "OK" in result.output


def test_promote_paper_refused_before_validation(workspace: Path) -> None:
    result = runner.invoke(app, ["promote", "paper", "-s", "config/strategies/s.yaml"])
    assert result.exit_code == 1
    assert "cannot promote from 'candidate' to 'paper'" in result.output


def test_promote_live_refused_before_paper(workspace: Path) -> None:
    result = runner.invoke(app, ["promote", "live", "-s", "config/strategies/s.yaml"])
    assert result.exit_code == 1
    assert "cannot promote" in result.output


def test_validate_then_paper_then_live_gate(workspace: Path) -> None:
    # Tight RSI bands on 1h bars produce plenty of OOS trades.
    result = runner.invoke(app, ["validate", "run", "-s", "config/strategies/s.yaml"])
    assert "OFFICIAL OOS RECORD" in result.output
    if result.exit_code != 0:
        # The gate is allowed to reject on performance — but then this test's
        # promotion path can't continue, so require the pass case from the data.
        pytest.fail(f"validation gate rejected the fixture strategy:\n{result.output}")

    result = runner.invoke(app, ["promote", "paper", "-s", "config/strategies/s.yaml"])
    assert result.exit_code == 0, result.output
    assert "promoted to 'paper'" in result.output

    # Live promotion with no capital cap configured -> refused outright.
    result = runner.invoke(
        app,
        ["promote", "live", "-s", "config/strategies/s.yaml"],
        input="cli_flow_test\n",
    )
    assert result.exit_code == 1
    assert "max_capital_usd is not set" in result.output

    # With a cap set: paper clock just started -> gate must refuse even with
    # the correct typed name.
    config_path = workspace / "config" / "config.yaml"
    config_path.write_text(CONFIG.replace(
        "risk:\n", "risk:\n  max_capital_usd: 500\n"
    ))
    result = runner.invoke(
        app,
        ["promote", "live", "-s", "config/strategies/s.yaml"],
        input="cli_flow_test\n",
    )
    assert result.exit_code == 1
    assert "paper track is" in result.output

    # And a wrong typed name is refused independently of duration.
    result = runner.invoke(
        app,
        ["promote", "live", "-s", "config/strategies/s.yaml"],
        input="wrong_name\n",
    )
    assert result.exit_code == 1
    assert "does not match strategy name" in result.output


def test_backtest_run_labels_results_in_sample(workspace: Path) -> None:
    result = runner.invoke(app, ["backtest", "run", "-s", "config/strategies/s.yaml"])
    assert result.exit_code == 0, result.output
    assert "[IN-SAMPLE]" in result.output
    assert "in-sample only" in result.output


def test_import_csv_roundtrip(workspace: Path) -> None:
    csv = workspace / "hist.csv"
    t0 = 1577836800  # 2020-01-01, well before the seeded data
    lines = [
        f"{t0 + i * 3600},{100 + i},{101 + i},{99 + i},{100.5 + i},{5.0},{3}"
        for i in range(24)
    ]
    csv.write_text("\n".join(lines) + "\n")
    result = runner.invoke(
        app,
        ["data", "import-csv", str(csv), "--symbol", "BTC/USD", "--timeframe", "1h"],
    )
    assert "imported 24 bars" in result.output


def test_risk_status_reports_unset_cap(workspace: Path) -> None:
    result = runner.invoke(app, ["risk", "status"])
    assert result.exit_code == 0
    assert "NOT SET" in result.output


def test_audit_events_shows_promotions(workspace: Path) -> None:
    runner.invoke(app, ["validate", "run", "-s", "config/strategies/s.yaml"])
    result = runner.invoke(app, ["audit", "events"])
    assert result.exit_code == 0
    assert "config_registered" in result.output


def test_revalidation_is_idempotent(workspace: Path) -> None:
    first = runner.invoke(app, ["validate", "run", "-s", "config/strategies/s.yaml"])
    assert first.exit_code == 0, first.output
    again = runner.invoke(app, ["validate", "run", "-s", "config/strategies/s.yaml"])
    assert again.exit_code == 0, again.output
    assert "remains at stage 'validated'" in again.output


def test_status_overview(workspace: Path) -> None:
    runner.invoke(app, ["validate", "run", "-s", "config/strategies/s.yaml"])
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.output
    assert "cli_flow_test" in result.output
    assert "validated" in result.output
    assert "kill switch: armed" in result.output


def test_preflight_fails_safe_without_live_setup(workspace: Path) -> None:
    """Preflight on an unpromoted strategy with no keys must FAIL, not pass."""
    result = runner.invoke(
        app, ["live", "preflight", "-s", "config/strategies/s.yaml"]
    )
    assert result.exit_code == 1
    assert "preflight FAIL" in result.output
    assert "stage" in result.output
