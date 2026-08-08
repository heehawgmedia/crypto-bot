from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from quant_lab.audit.log import AuditLog
from quant_lab.backtest.engine import CostModel
from quant_lab.config import StrategyInstanceConfig, VaultConfig
from quant_lab.paper.engine import PaperEngine
from tests.conftest import make_ohlcv

COST = CostModel(taker_fee_bps=26.0, slippage_bps=10.0)
VAULT = VaultConfig(enabled=True, skim_pct=15.0)


@pytest.fixture
def audit(tmp_path: Path) -> AuditLog:
    return AuditLog(tmp_path / "audit.db")


def _scfg() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="v_test", strategy="ema_cross", exchange="kraken", symbol="BTC/USD",
        timeframe="1h", params={"fast": 3, "slow": 8},
    )


def _ramp(bars: int, level: float | None = None) -> pd.DataFrame:
    df = make_ohlcv(bars=bars, seed=1)
    values = (
        pd.Series(level, index=df.index)
        if level is not None
        else 100.0 + pd.Series(range(bars), index=df.index) * 2.0
    )
    for col in ("open", "high", "low", "close"):
        df[col] = values
    return df


# -- ledger ------------------------------------------------------------------


def test_ledger_balance_and_totals(audit: AuditLog) -> None:
    audit.vault_credit(100.0, strategy="s", mode="paper")
    audit.vault_credit(50.0, strategy="s", mode="live")
    audit.vault_debit(30.0, "withdraw")
    audit.vault_debit(20.0, "redistribute")
    assert audit.vault_balance() == pytest.approx(100.0)
    totals = audit.vault_totals()
    assert totals == {"skim": 150.0, "withdraw": 30.0, "redistribute": 20.0}


def test_debit_cannot_exceed_balance(audit: AuditLog) -> None:
    audit.vault_credit(10.0, strategy="s", mode="paper")
    with pytest.raises(ValueError, match="cannot withdraw"):
        audit.vault_debit(11.0, "withdraw")
    with pytest.raises(ValueError, match="invalid vault debit kind"):
        audit.vault_debit(1.0, "spend")


def test_live_earmark_attributes_debits_to_paper_first(audit: AuditLog) -> None:
    audit.vault_credit(100.0, strategy="s", mode="paper")
    audit.vault_credit(60.0, strategy="s", mode="live")
    assert audit.vault_live_earmark() == pytest.approx(60.0)
    audit.vault_debit(80.0, "withdraw")  # eats all paper (100)? no: 80 < 100 paper
    assert audit.vault_live_earmark() == pytest.approx(60.0)
    audit.vault_debit(50.0, "withdraw")  # 130 total debits: 100 paper + 30 live
    assert audit.vault_live_earmark() == pytest.approx(30.0)


def test_vault_events_are_audited(audit: AuditLog) -> None:
    audit.vault_credit(5.0, strategy="s", mode="paper")
    audit.vault_debit(2.0, "withdraw", note="test")
    kinds = [row["kind"] for row in audit.events()]
    assert "vault_skim" in kinds
    assert "vault_withdraw" in kinds


# -- paper engine skim -------------------------------------------------------


def test_paper_winning_trade_skims_exactly_15_pct(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0, vault=VAULT)
    engine.step(_ramp(50))  # buys at ~198

    state = audit.get_paper_state("v_test")
    entry_cost = float(state["entry_cost_usd"])
    units = float(state["units"])
    assert entry_cost == pytest.approx(10_000.0)

    # Price doubles, then the signal dies -> profitable exit.
    exit_df = _ramp(60, level=400.0)
    step = engine.step(exit_df)
    assert step.side == "sell"
    fill = 400.0 * (1 - COST.slippage)
    proceeds_net = units * fill * (1 - COST.fee)
    realized = proceeds_net - entry_cost
    expected_skim = realized * 0.15

    assert audit.vault_balance() == pytest.approx(expected_skim, rel=1e-9)
    state = audit.get_paper_state("v_test")
    assert float(state["cash_usd"]) == pytest.approx(proceeds_net - expected_skim, rel=1e-9)
    ledger = audit.vault_ledger()
    assert len(ledger) == 1
    assert ledger[0]["mode"] == "paper"
    assert ledger[0]["ref_order_id"] is not None
    assert "skimmed to vault" in step.detail


def test_paper_losing_trade_skims_nothing(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0, vault=VAULT)
    engine.step(_ramp(50))
    engine.step(_ramp(60, level=50.0))  # crash exit at a loss
    assert audit.vault_balance() == 0.0
    assert audit.vault_ledger() == []


def test_vault_disabled_skims_nothing(audit: AuditLog) -> None:
    engine = PaperEngine(_scfg(), COST, audit, 10_000.0, vault=VaultConfig(enabled=False))
    engine.step(_ramp(50))
    engine.step(_ramp(60, level=400.0))
    assert audit.vault_balance() == 0.0


# -- live engine skim + earmark ----------------------------------------------


def test_live_win_skims_and_earmark_reduces_sizing(tmp_path: Path) -> None:
    from quant_lab.config import AppConfig
    from quant_lab.live.engine import LiveEngine
    from quant_lab.risk.killswitch import KillSwitchMonitor
    from tests.test_config import _base
    from tests.test_live_engine import FakeClient, _flat_df, _rising_df

    audit = AuditLog(tmp_path / "a.db")
    audit.set_stage("s_live", "validated", {})
    audit.set_stage("s_live", "paper", {})
    audit.set_stage("s_live", "live", {})

    raw = _base()
    raw["mode"] = "live"
    raw["risk"]["max_capital_usd"] = 1000.0
    raw["risk"]["kill_switches"]["max_daily_loss_pct"] = 95.0
    raw["risk"]["kill_switches"]["max_drawdown_pct"] = 95.0
    raw["vault"] = {"enabled": True, "skim_pct": 15.0}
    raw["walkforward"] = {"in_sample_bars": 100, "out_of_sample_bars": 50, "step_bars": 50}
    cfg = AppConfig.model_validate(raw)

    class PricedClient(FakeClient):
        """Fills at a settable price so the round trip is profitable."""

        price = 100.0

        def _order(self, side, symbol, amount, params):
            self.orders.append((side, symbol, amount))
            self.params_seen.append(params)
            return {
                "average": self.price,
                "filled": amount,
                "fee": {"cost": amount * self.price * 0.0026},
            }

    client = PricedClient()
    ks = KillSwitchMonitor(cfg.risk.kill_switches, audit)
    engine = LiveEngine(scfg=_live_scfg(), cfg=cfg, client=client, audit=audit, killswitch=ks)

    client.price = 100.0
    engine.step(_rising_df())  # buy ~5 units at 100
    state = audit.get_live_state("s_live")
    entry_cost = float(state["entry_cost_usd"])
    units = engine.position_units()
    assert entry_cost == pytest.approx(units * 100.0 * 1.0026)

    client.price = 200.0  # sells fill at 200 -> big win
    step = engine.step(_flat_df(price=10.0, bars=61))  # signal exit
    assert step.side == "sell"
    proceeds_net = units * 200.0 * (1 - 0.0026)
    expected_skim = (proceeds_net - entry_cost) * 0.15
    assert audit.vault_balance() == pytest.approx(expected_skim, rel=1e-9)
    assert audit.vault_live_earmark() == pytest.approx(expected_skim, rel=1e-9)

    # Next entry sizes off (cap - earmark), not the full cap.
    client.price = 100.0
    engine.step(_rising_df(bars=62))
    last_price = 161.0  # close of _rising_df(62)
    amount = client.orders[-1][2]
    expected_capital = 1000.0 - expected_skim
    assert amount == pytest.approx(expected_capital * 0.5 / last_price, rel=1e-9)

    # Redistribution frees the headroom again.
    audit.vault_debit(expected_skim, "redistribute")
    assert audit.vault_live_earmark() == 0.0


def _live_scfg() -> StrategyInstanceConfig:
    return StrategyInstanceConfig(
        name="s_live", strategy="ema_cross", exchange="kraken", symbol="BTC/USD",
        timeframe="1h", params={"fast": 3, "slow": 8},
    )
