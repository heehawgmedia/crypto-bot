# Heehaw's Lab

*(package/command name: `quant-lab`)*

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

# Dashboard + vault
quant-lab serve --open                # LIVE dashboard at http://127.0.0.1:8787 with Start/Stop
quant-lab pause                       # halt new entries (open positions still exit on their rules)
quant-lab resume
quant-lab dashboard --open            # static HTML snapshot: trades, PnL charts, vault, events
quant-lab vault status                # 15% of each winning trade lands here (config: vault.skim_pct)
quant-lab vault withdraw --amount 100      # record taking profit out of the system
quant-lab vault redistribute --amount 100  # return vault funds to trading capital

# Oversight
quant-lab status                      # every strategy's stage + paper clock at a glance
quant-lab live preflight -s <yaml>    # read-only go-live checklist (keys, rules, data, reconcile)
quant-lab audit events|orders|fills   # the full audit trail
quant-lab audit export -o fills.csv   # fill log as CSV (tax reporting)
```

## Trade rules (stop-loss / take-profit / cooldown)

Optional per-strategy rules in the strategy YAML:

```yaml
stop_loss_pct: 5.0        # exit if the completed bar's low touches entry * (1 - 5%)
take_profit_pct: 12.0     # exit if the completed bar's high touches entry * (1 + 12%)
cooldown_bars: 4          # no new entry for 4 bars after a stop/target exit
```

Semantics are identical everywhere — backtest, walk-forward validation, paper,
and live: triggers evaluate on the completed bar and exit at the next
opportunity (next bar open in the backtest; the current poll in paper/live).
The backtest never pretends a resting stop order filled at the stop price,
because live trading doesn't rest stop orders. After a stop/target exit,
re-entry requires the signal to drop to 0 first (a fresh edge), plus the
cooldown. If both levels are touched in one bar, the stop wins (worst case).
Rules state (entry price, arming, cooldown) is durable in SQLite — restarts
can't reset it. Stop exits execute even while the kill switch is tripped
(they reduce risk).

## The live dashboard (`quant-lab serve`)

```bash
quant-lab serve --open        # dashboard + paper fleet in one process
```

One process serves the dashboard and runs the paper fleet. The page is
rendered from SQLite on every request (never a stale snapshot), polls for new
trades and reloads itself when one lands, and carries **Start** and **Stop**
buttons.

**What Stop does**: halts *new entries* only. Open positions keep their
stop-loss, take-profit, and signal exits, so a stopped bot is never left
holding an unmanaged position — the same rule a kill-switch trip follows. The
switch is a row in SQLite, so it survives restarts and reboots: a bot you
stopped stays stopped. Both transitions land in the audit trail with who did
it and why. `quant-lab pause` / `quant-lab resume` do the same from a
terminal, and the dashboard reflects them within five seconds.

The status pill distinguishes four states, because "configured to trade" and
"actually trading" are different facts:

| Pill | Meaning |
|---|---|
| **Trading** | loop polling, entries allowed |
| **Paused** | loop polling, entries halted by you |
| **Stopped** | you stopped it and no loop is polling |
| **Offline** | switched on but **nothing is polling** — the failure that matters |

Serving is loopback-only by default. The control endpoint additionally
requires a per-process token that only the served page carries, refuses
cross-origin requests, and validates the `Host` header (DNS-rebinding
defence), so no web page you happen to have open can stop your bot. Binding a
non-loopback address prints a warning: anyone who can load the page can then
press Stop.

## Surviving reboots (Windows)

Two scripts under `scripts/` keep everything running unattended:

- `scripts/run_paper.ps1` — a keeper that runs `quant-lab serve` in an endless
  supervision loop (60s backoff on exit), appending output to
  `data\paper_run.log`.
- `scripts/install_autostart.ps1` — registers a Windows Scheduled Task
  ("Heehaws Lab Paper Trading") that launches the keeper hidden at every
  logon, starts it immediately, and drops a dashboard shortcut on the desktop.

Install from an **administrator** PowerShell in `quant-lab`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install_autostart.ps1
```

Remove with the same command plus `-Remove`. Restarts are safe by design —
all trading state lives in SQLite, and each completed bar is processed at
most once, so duplicate or restarted pollers can never double-trade.

## Alerts

Telegram and/or Discord, configured in `config.yaml` under `alerts:`;
credentials via env (`QL_TELEGRAM_BOT_TOKEN`/`QL_TELEGRAM_CHAT_ID`,
`QL_DISCORD_WEBHOOK_URL`). Delivery is best-effort — an alert outage can
never break the trading loop.

Data lands in `quant-lab/data/parquet/<exchange>/<symbol>/<timeframe>.parquet`
(gitignored). Updates are incremental — re-running `data update` fetches only
new bars, refreshing the most recent stored candle in case it was still forming.
Orders, fills, promotions, kill-switch events, and paper state live in
`quant-lab/data/quantlab.db` (SQLite, UTC timestamps).

## Tests

```bash
pytest
```

## Kraken go-live runbook

The pipeline targets Kraken Pro (spot). Order of operations, once a strategy
has passed walk-forward validation and its paper period:

1. **Deep history.** Kraken's REST API only serves the most recent ~720
   candles per timeframe. Bootstrap history from Kraken's downloadable OHLCVT
   archives, then keep current with the API:
   ```bash
   quant-lab data import-csv XBTUSD_60.csv --symbol BTC/USD --timeframe 1h
   quant-lab data update && quant-lab data check
   ```
2. **API keys** (Kraken -> Settings -> API): create a key with **Query Funds**
   and **Create & Modify Orders** only. No withdrawal permission. Enable the
   IP allowlist. Put the key in `.env` as `QL_KRAKEN_API_KEY` /
   `QL_KRAKEN_API_SECRET`.
3. **Set the capital cap**: `risk.max_capital_usd` in `config/config.yaml`.
   Live promotion and the live engine both refuse to run without it.
4. **Promote**: `quant-lab promote live -s <yaml>` — shows the full paper
   record and requires typing the strategy name.
5. **Set `mode: live`** in config, run `quant-lab live preflight -s <yaml>`
   until every check passes, then `quant-lab live run -s <yaml>`.

Live safety properties (all enforced in code and covered by tests):

- **Reconciliation before trading**: the audited position must actually exist
  in the Kraken account (`quant-lab live reconcile`; `live run` refuses to
  start on drift). Your personal coins in the same account are ignored —
  only a *shortfall* against the bot's book is drift.
- **Idempotent orders**: every order carries a deterministic client order id
  derived from (strategy, bar, side). Kraken rejects duplicate ids, so a
  crash/retry can never double a position.
- **One action per bar**: each completed candle is processed at most once
  (durable marker in SQLite).
- **Exchange market rules**: order sizes are floored to Kraken's amount
  precision and checked against minimum size/notional locally; unfit orders
  are audited as rejections instead of burning API calls.
- **Durable risk anchors**: the drawdown peak and daily-loss baseline live in
  SQLite — restarting the process cannot reset them.
- After any order **error**, run `quant-lab live reconcile` before trusting
  the book (the engine prints this reminder and audits the error).

Inspect everything: `quant-lab audit events|orders|fills`.

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
