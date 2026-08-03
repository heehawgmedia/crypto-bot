# quant-lab

Crypto strategy research and execution pipeline: idea → backtest → walk-forward
validation → paper trading → capital-capped live trading, with hard promotion
gates enforced **in code**. The system's job is to kill bad strategies cheaply
and honestly — assume most strategies will fail validation.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Data layer + integrity tests | **done** |
| 2 | Backtester + no-lookahead test suite | not started |
| 3 | Walk-forward engine + promotion gates | not started |
| 4 | Paper engine + Telegram alerts | not started |
| 5 | Live engine + kill switches | not started |

## Setup

Requires Python 3.11+.

```bash
cd quant-lab
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## API key hygiene (read before creating any keys)

Phase 1 needs **no API keys** — OHLCV endpoints are public. When you do create
exchange keys (paper/live phases):

1. Grant **trade-only** permission.
2. **Disable withdrawals** on the key.
3. Enable the exchange's **IP allowlist** and restrict it to the machine
   running quant-lab.

Keys are read from environment variables only (`cp .env.example .env`, fill it
in). `.env` is gitignored; keys never appear in YAML config or the database.

## Usage (Phase 1)

```bash
# Download/extend OHLCV history for everything in config/config.yaml
quant-lab data update

# Just one series
quant-lab data update --symbol BTC/USD --timeframe 1h

# Verify integrity (gaps, duplicates, NaNs, OHLC sanity); non-zero exit on failure
quant-lab data check

# What's stored
quant-lab data ls
```

Data lands in `quant-lab/data/parquet/<exchange>/<symbol>/<timeframe>.parquet`
(gitignored). Updates are incremental — re-running `data update` fetches only
new bars, refreshing the most recent stored candle in case it was still forming.

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
