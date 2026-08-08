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


def test_audit_export_csv(workspace: Path) -> None:
    result = runner.invoke(
        app, ["audit", "export", "--out", "fills.csv"]
    )
    assert result.exit_code == 0, result.output
    content = (workspace / "fills.csv").read_text()
    assert content.startswith("ts_utc,mode,strategy,symbol,side,qty,price,fee_usd")


DUAL_EXCHANGE_CONFIG = CONFIG.replace(
    "exchanges:\n  kraken: {taker_fee_bps: 26, maker_fee_bps: 16}",
    "exchanges:\n  kraken: {taker_fee_bps: 26, maker_fee_bps: 16}\n"
    "  coinbase: {taker_fee_bps: 60, maker_fee_bps: 40}",
).replace("exchange: kraken", "exchange: coinbase")  # data.exchange only


def test_data_exchange_split_reads_history_from_data_source(workspace: Path) -> None:
    """Strategy trades on kraken but reads coinbase history via data_exchange."""
    (workspace / "config" / "config.yaml").write_text(DUAL_EXCHANGE_CONFIG)
    (workspace / "config" / "strategies" / "s.yaml").write_text(
        STRATEGY + "data_exchange: coinbase\n"
    )
    # History exists ONLY under coinbase; the kraken store is empty.
    store = ParquetStore(workspace / "data" / "parquet")
    store.write("coinbase", "BTC/USD", "1h", make_ohlcv(start="2023-01-01", bars=2500, seed=7))

    result = runner.invoke(app, ["backtest", "run", "-s", "config/strategies/s.yaml"])
    assert result.exit_code == 0, result.output
    assert "[IN-SAMPLE]" in result.output


def test_setup_offline_keeps_existing_data_and_guides(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`quant-lab setup` with no network must not destroy anything: it warns
    about failed fetches, verifies the stored data, and prints next steps.

    The network is stubbed out — this test must behave identically on and
    offline (it once fetched real Kraken candles when run on a machine with
    internet, which is exactly the kind of non-hermetic test this suite
    exists to prevent).
    """

    def no_network(self: object, *args: object, **kwargs: object) -> int:
        raise ConnectionError("offline (stubbed for test)")

    monkeypatch.setattr("quant_lab.cli.OhlcvFetcher.update", no_network)
    result = runner.invoke(app, ["setup"])
    assert "fetch failed" in result.output
    # Data was pre-seeded by the workspace fixture and must still verify.
    assert "BTC/USD 1h: rows=2500" in result.output
    assert "validate run" in result.output


def test_data_heal_refetches_then_flat_fills(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Gaps are refetched from the exchange when possible; true outage holes
    are flat-filled with zero-volume candles and land in the audit trail."""
    from quant_lab.data.store import ParquetStore as PS

    full = make_ohlcv(start="2023-01-01", bars=200, seed=7)
    refetchable = full.iloc[50:52]  # the exchange still has these two bars
    outage = full.index[120:123]  # the exchange lost these three forever

    gappy = full.drop(full.index[50:52]).drop(outage)
    store = PS(workspace / "data" / "parquet")
    store.path_for("kraken", "BTC/USD", "1h").unlink()  # replace fixture data
    store.write("kraken", "BTC/USD", "1h", gappy)

    class HealFake:
        def fetch_ohlcv(self, symbol, timeframe, since, limit, params):
            rows = []
            for ts, row in refetchable.iterrows():
                ms = int(ts.value // 1_000_000)
                if since <= ms < params["until"]:
                    rows.append([ms, row["open"], row["high"], row["low"],
                                 row["close"], row["volume"]])
            return rows

    monkeypatch.setattr("quant_lab.cli.make_ccxt_client", lambda *a, **k: HealFake())
    result = runner.invoke(app, ["data", "heal"])
    assert result.exit_code == 0, result.output
    assert "3 bar(s) flat-filled" in result.output
    assert "status=OK" in result.output

    healed = store.read("kraken", "BTC/USD", "1h")
    assert len(healed) == 200
    # Refetched bars carry real values; outage bars are flat at prior close.
    assert healed.loc[full.index[50], "close"] == pytest.approx(full["close"].iloc[50])
    prev_close = full["close"].iloc[119]
    for ts in outage:
        assert healed.loc[ts, "close"] == pytest.approx(prev_close)
        assert healed.loc[ts, "volume"] == 0.0

    events = runner.invoke(app, ["audit", "events", "--kind", "gap_fill"])
    assert "gap_fill" in events.output


def test_vault_cli_and_dashboard(workspace: Path) -> None:
    """Vault status/withdraw/redistribute plus dashboard generation."""
    from quant_lab.audit.log import AuditLog

    audit = AuditLog(workspace / "data" / "quantlab.db")
    order_id = audit.record_order(
        mode="paper", strategy="cli_flow_test", exchange="kraken", symbol="BTC/USD",
        side="buy", qty=1.0, price=100.0, status="filled",
    )
    audit.record_fill(order_id=order_id, mode="paper", strategy="cli_flow_test",
                      symbol="BTC/USD", side="buy", qty=1.0, price=100.0, fee_usd=0.3)
    sell_id = audit.record_order(
        mode="paper", strategy="cli_flow_test", exchange="kraken", symbol="BTC/USD",
        side="sell", qty=1.0, price=150.0, status="filled",
    )
    audit.record_fill(order_id=sell_id, mode="paper", strategy="cli_flow_test",
                      symbol="BTC/USD", side="sell", qty=1.0, price=150.0, fee_usd=0.4)
    audit.vault_credit(7.40, strategy="cli_flow_test", mode="paper", ref_order_id=sell_id)
    audit.close()

    result = runner.invoke(app, ["vault", "status"])
    assert result.exit_code == 0, result.output
    assert "vault balance: $7.40" in result.output

    result = runner.invoke(app, ["vault", "withdraw", "--amount", "3"])
    assert result.exit_code == 0, result.output
    result = runner.invoke(app, ["vault", "withdraw", "--amount", "100"])
    assert result.exit_code == 1  # over balance

    result = runner.invoke(app, ["vault", "redistribute", "--amount", "2"])
    assert result.exit_code == 0, result.output

    result = runner.invoke(app, ["dashboard", "--out", "data/dash.html"])
    assert result.exit_code == 0, result.output
    html_out = (workspace / "data" / "dash.html").read_text(encoding="utf-8")
    assert "Heehaw" in html_out
    assert "Vault" in html_out
    assert "cli_flow_test" in html_out          # trade row present
    assert "Cumulative realized PnL" in html_out
    assert "$7.40" in html_out or "7.40" in html_out


def test_paper_run_fleet_mode(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`paper run` without -s polls every paper-stage strategy in one process."""
    from quant_lab.audit.log import AuditLog

    (workspace / "config" / "strategies" / "s2.yaml").write_text(
        STRATEGY.replace("cli_flow_test", "cli_flow_two")
    )
    audit = AuditLog(workspace / "data" / "quantlab.db")
    for name in ("cli_flow_test", "cli_flow_two"):
        audit.set_stage(name, "validated", {})
        audit.set_stage(name, "paper", {})
    audit.close()

    def no_network(self, *args, **kwargs):
        return 0  # store already seeded by the fixture

    monkeypatch.setattr("quant_lab.cli.OhlcvFetcher.update", no_network)
    result = runner.invoke(app, ["paper", "run", "--once"])
    assert result.exit_code == 0, result.output
    assert "paper trading 2 strategies" in result.output
    assert "cli_flow_test" in result.output
    assert "cli_flow_two" in result.output


def test_paper_run_fleet_mode_requires_promoted_strategy(workspace: Path) -> None:
    result = runner.invoke(app, ["paper", "run", "--once"])
    assert result.exit_code == 1
    assert "no paper-stage strategies" in result.output


def _promote_to_paper(workspace: Path, *names: str) -> None:
    from quant_lab.audit.log import AuditLog

    audit = AuditLog(workspace / "data" / "quantlab.db")
    for name in names:
        audit.set_stage(name, "validated", {})
        audit.set_stage(name, "paper", {})
    audit.close()


def test_pause_and_resume_round_trip(workspace: Path) -> None:
    from quant_lab.audit.log import AuditLog

    result = runner.invoke(app, ["pause", "--reason", "travelling"])
    assert result.exit_code == 0, result.output
    assert "PAUSED" in result.output
    assert "still exit" in result.output
    assert AuditLog(workspace / "data" / "quantlab.db").trading_enabled() is False

    # Pausing twice is honest about being a no-op.
    assert "already paused" in runner.invoke(app, ["pause"]).output

    result = runner.invoke(app, ["resume"])
    assert result.exit_code == 0, result.output
    assert "RESUMED" in result.output
    assert AuditLog(workspace / "data" / "quantlab.db").trading_enabled() is True


def test_resume_warns_when_no_loop_is_running(workspace: Path) -> None:
    runner.invoke(app, ["pause"])
    result = runner.invoke(app, ["resume"])
    assert "no trading loop is polling" in result.output
    assert "quant-lab serve" in result.output


def test_paper_run_while_paused_takes_no_entry(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from quant_lab.audit.log import AuditLog

    _promote_to_paper(workspace, "cli_flow_test")
    runner.invoke(app, ["pause"])

    def no_network(self, *args, **kwargs):
        return 0

    monkeypatch.setattr("quant_lab.cli.OhlcvFetcher.update", no_network)
    result = runner.invoke(app, ["paper", "run", "--once"])
    assert result.exit_code == 0, result.output
    assert "trading is PAUSED" in result.output
    assert AuditLog(workspace / "data" / "quantlab.db").fills() == []


def test_paper_run_stamps_a_heartbeat(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`status` can only be honest about liveness if the loop leaves a mark."""
    from quant_lab.audit.log import AuditLog

    _promote_to_paper(workspace, "cli_flow_test")

    def no_network(self, *args, **kwargs):
        return 0

    monkeypatch.setattr("quant_lab.cli.OhlcvFetcher.update", no_network)
    runner.invoke(app, ["paper", "run", "--once", "--interval", "3600"])

    audit = AuditLog(workspace / "data" / "quantlab.db")
    beat = audit.heartbeat("paper")
    assert beat is not None
    assert beat["interval_s"] == 3600.0
    assert "trading" in str(beat["detail"])

    result = runner.invoke(app, ["status"])
    assert "bot: Trading" in result.output


def test_status_reports_offline_before_anything_runs(workspace: Path) -> None:
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.output
    assert "bot: Offline" in result.output
    assert "never" in result.output


def test_static_dashboard_has_no_control_buttons(workspace: Path) -> None:
    """A file on disk cannot authenticate anyone, so it must not pretend to."""
    result = runner.invoke(app, ["dashboard", "--out", "data/dash.html"])
    assert result.exit_code == 0, result.output
    html_out = (workspace / "data" / "dash.html").read_text(encoding="utf-8")
    assert 'id="ql-start"' not in html_out
    assert "/api/control" not in html_out
    assert "quant-lab serve" in html_out
    assert "static snapshot" in result.output


def test_serve_refuses_a_port_already_in_use(workspace: Path) -> None:
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        port = sock.getsockname()[1]
        result = runner.invoke(app, ["serve", "--port", str(port), "--no-trade"])
    assert result.exit_code == 1
    assert "cannot bind" in result.output
