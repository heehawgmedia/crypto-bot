# quant-lab

Crypto strategy research and execution pipeline: idea → backtest → walk-forward
validation → paper trading → capital-capped live trading, with hard promotion
gates enforced **in code**. The system's job is to kill bad strategies cheaply
and honestly — assume most strategies will fail validation.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Data layer + integrity tests | **done** |
| 2 | Backtester + no-lookahead test suite | **done** |
| 3 | Walk-forward engine + promotion gates | **done** |
| 4 | Paper engine + Telegram alerts | **done** |
| 5 | Live engine + kill switches | **done** |

## Setup

Requires Python 3.11+.

```bash
cd quant-lab
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## API key hygiene (read before creating any keys)

Data, backtesting, validation, and paper trading need **no API keys** — OHLCV
endpoints are public. Keys are needed only for `live run`. When you create
them:

1. Grant **trade-only** permission.
2. **Disable withdrawals** on the key.
3. Enable the exchange's **IP allowlist** and restrict it to the machine
   running quant-lab.

Keys are read from environment variables only (`cp .env.example .env`, fill it
in). `.env` is gitignored; keys never appear in YAML config or the database.

## The pipeline, end to end

```bash
# 1. Data: download/extend OHLCV history, then verify it
quant-lab data update                 # everything in config/config.yaml
quant-lab data update --symbol BTC/USD --timeframe 1h
quant-lab data check                  # gaps/dupes/NaNs/OHLC sanity; non-zero exit on failure
quant-lab data ls

# 2. Research (in-sample only, never a promotion criterion)
quant-lab backtest run -s config/strategies/ema_cross_btc.yaml

# 3. Walk-forward validation — the only promotion path.
#    Prints the stitched OOS record vs buy-and-hold and applies the gates:
#    >= min_windows, >= 30 closed OOS trades (no override), >= min OOS Sharpe.
#    On pass, the strategy is recorded as stage=validated.
quant-lab validate run -s config/strategies/ema_cross_btc.yaml

# 4. Paper trading (live data, simulated fills, durable track record)
quant-lab promote paper -s config/strategies/ema_cross_btc.yaml
quant-lab paper run -s config/strategies/ema_cross_btc.yaml         # loop; --once for one poll
quant-lab paper status -s config/strategies/ema_cross_btc.yaml

# 5. Live (after >= min_paper_days of paper + typed-name confirmation)
quant-lab promote live -s config/strategies/ema_cross_btc.yaml
#    ...then set mode: live and max_capital_usd in config/config.yaml, and:
quant-lab live run -s config/strategies/ema_cross_btc.yaml

# Kill switches
quant-lab risk status
quant-lab risk reset                  # the only way to re-enable after a trip
```

Data lands in `quant-lab/data/parquet/<exchange>/<symbol>/<timeframe>.parquet`
(gitignored). Updates are incremental — re-running `data update` fetches only
new bars, refreshing the most recent stored candle in case it was still forming.
Orders, fills, promotions, kill-switch events, and paper state live in
`quant-lab/data/quantlab.db` (SQLite, UTC timestamps).

## Tests

```bash
pytest
```

## Non-negotiables (enforced in code, not documentation)

- Signals compute on bar close, fills happen at next bar open; fees + slippage
  always applied. Tests prove no lookahead.
- Walk-forward out-of-sample results are the only official record.
- < 30 OOS trades → auto-reject, no override flag exists.
- Paper before live (min 56 days by default), typed confirmation to promote.
- `risk.max_capital_usd` has no default; live mode refuses to start without it,
  and any order pushing total exposure above it is hard-rejected.
- Kill switches latch until manually reset via CLI.
- Every order, fill, config change, promotion, and kill-switch event is written
  to SQLite with UTC timestamps.
