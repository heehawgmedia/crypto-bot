# Getting started — from zero to a running pipeline

This is the "I don't know where to start" guide. Do these steps in order on
the computer that will run the bot (it needs to stay on during paper/live
trading — a desktop that's always on, a home server, or a small VPS).

**You need no API keys and no money for steps 1–5.** Keys only matter at the
very end, for live trading.

## 1. Install Python 3.11+

- **Windows**: install from https://www.python.org/downloads/ — check
  "Add python.exe to PATH" during install.
- **Mac**: `brew install python@3.11` (or use the python.org installer).
- **Linux**: `sudo apt install python3.11 python3.11-venv` (or your distro's
  equivalent).

## 2. Get the code and install

**Important:** quant-lab lives on the `claude/quant-lab-crypto-trading-lb6wmx`
branch — a fresh clone lands on `master`, which does NOT contain it. The
checkout step below is required.

**Windows (PowerShell):**

```powershell
git clone https://github.com/heehawgmedia/crypto-bot.git
cd crypto-bot
git checkout claude/quant-lab-crypto-trading-lb6wmx
cd quant-lab
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
pytest          # optional but recommended: ~200 tests should all pass
```

If `Activate.ps1` is blocked by an execution-policy error, run
`Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
once, answer `Y`, and retry. (Tip: cloning somewhere outside OneDrive, e.g.
`C:\bots\`, avoids OneDrive constantly syncing market data files.)

**Mac/Linux:**

```bash
git clone https://github.com/heehawgmedia/crypto-bot.git
cd crypto-bot
git checkout claude/quant-lab-crypto-trading-lb6wmx
cd quant-lab
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

From here on, run everything from the `crypto-bot/quant-lab` folder with the
venv activated (you'll see `(.venv)` in your prompt). In every NEW terminal,
re-activate first: `.venv\Scripts\Activate.ps1` (Windows) or
`source .venv/bin/activate` (Mac/Linux).

## 3. Download market data — one command

```bash
quant-lab setup
```

This downloads BTC/USD and ETH/USD history (from Coinbase's public API, which
serves years of candles — you still *trade* on Kraken later), verifies its
integrity, and prints your next steps. Re-run it any time; updates are
incremental. First run takes a few minutes.

## 4. Find a strategy that survives validation

```bash
quant-lab validate run -s config/strategies/ema_cross_btc.yaml
quant-lab validate run -s config/strategies/rsi_mr_btc.yaml
quant-lab validate run -s config/strategies/donchian_btc.yaml
```

Each prints the strategy's **official out-of-sample record** vs just holding
BTC, then a gate decision. **Expect rejections** — the system exists to kill
bad strategies cheaply, and the three shipped baselines are plumbing tests,
not alpha. Tune parameters/grids in the YAMLs, try different timeframes, or
ask for new strategy types. A strategy is only promotable when its stitched
OOS record clears every gate (≥30 OOS trades, positive risk-adjusted return).

## 5. Paper-trade the survivor (56 days minimum)

```bash
quant-lab promote paper -s config/strategies/<your_strategy>.yaml
quant-lab paper run -s config/strategies/<your_strategy>.yaml
```

`paper run` polls live market data and simulates fills — leave it running
(a terminal that stays open; on a server, run it under `tmux`, `screen`, or a
systemd service). It's restart-safe: stop and start it freely, state is in
SQLite. Watch progress with `quant-lab status` and
`quant-lab paper status -s <yaml>`.

Optional alerts to your phone: create a Telegram bot (@BotFather), put the
token and your chat id in `.env` (see `.env.example`), and set
`alerts.telegram.enabled: true` in `config/config.yaml`.

## 6. Go live (only after the paper gate passes)

1. In `config/config.yaml`, set `risk.max_capital_usd` to an amount you can
   afford to lose entirely. There is no default on purpose.
2. Create a Kraken API key (Settings → API): **Query Funds** +
   **Create & Modify Orders** only, withdrawals OFF, IP allowlist ON.
   Copy `.env.example` to `.env` and fill in `QL_KRAKEN_API_KEY` /
   `QL_KRAKEN_API_SECRET`.
3. ```bash
   quant-lab promote live -s config/strategies/<yaml>   # typed confirmation
   ```
4. Set `mode: live` in `config/config.yaml`, then:
   ```bash
   quant-lab live preflight -s config/strategies/<yaml>  # must be all PASS
   quant-lab live run -s config/strategies/<yaml>
   ```

Kill switches (daily loss, drawdown, API errors) halt trading automatically
and stay latched until you run `quant-lab risk reset`. Everything the bot
ever does is in `quant-lab audit events|orders|fills`.

## The honest timeline

| Step | Time |
|---|---|
| Install + data | under an hour |
| Finding a strategy that passes validation | days to weeks of iteration — most fail, that's the design |
| Paper trading | 56 days minimum, enforced |
| Live | only after all of the above |

Anyone promising faster is skipping the part that protects your money.
