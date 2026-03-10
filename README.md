# Crypto Trading Bot

Automated cryptocurrency trading bot with multiple strategy support, risk management, and web dashboard.

## Features

- **Multiple Exchanges:** Binance, Coinbase Pro (more via CCXT)
- **Trading Strategies:**
  - DCA (Dollar-Cost Averaging)
  - Swing Trading (RSI, MACD, Bollinger Bands)
  - Grid Trading
  - Custom strategy support
- **Risk Management:**
  - Stop-loss & take-profit
  - Position sizing limits
  - Daily loss limits
  - Cooldown periods
- **Paper Trading:** Test strategies with fake money first
- **Monitoring Dashboard:** Real-time P&L, trade history, portfolio
- **Alerts:** Telegram, Discord, Slack notifications
- **Export:** CSV/JSON trade logs for tax reporting
- **Secure:** API keys encrypted at rest

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/heehawgmedia/crypto-bot.git
cd crypto-bot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and settings
```

### 3. Set Up Database

```bash
# Using Docker (recommended)
docker-compose up -d postgres redis

# Or manually create PostgreSQL database
createdb crypto_bot
```

### 4. Run Migrations

```bash
npm run migrate
```

### 5. Start the Bot

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### 6. Access Dashboard

Open `http://localhost:3001` in your browser.

## Configuration

### Exchange Setup

1. Create API keys on your exchange (enable trading, disable withdrawals)
2. Add keys to `.env`:
   ```
   BINANCE_API_KEY=your_key
   BINANCE_API_SECRET=your_secret
   ```

### Strategies

Configure strategies in `config/strategies.json`:

```json
{
  "dca": {
    "enabled": true,
    "symbol": "BTC/USDT",
    "amount_usd": 100,
    "interval_minutes": 1440
  },
  "swing": {
    "enabled": false,
    "symbol": "ETH/USDT",
    "rsi_period": 14,
    "rsi_oversold": 30,
    "rsi_overbought": 70
  }
}
```

### Risk Limits

Set in `.env`:

- `MAX_POSITION_SIZE_USD` - Max size per trade
- `DAILY_LOSS_LIMIT_USD` - Stop trading if losses exceed this
- `MAX_TRADES_PER_DAY` - Limit trade frequency

## Dashboard

The built-in dashboard (port 3001) shows:

- Portfolio value & allocation
- Recent trades
- P&L over time
- Strategy performance
- System health

Access via: `http://localhost:3001`

## Notifications

Configure any of:

- **Telegram:** Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- **Discord:** Set `DISCORD_WEBHOOK_URL`
- **Logs:** Always logged to Winston (file/console)

## Safety

**IMPORTANT:**

1. **Start with paper trading** - Set `PAPER_TRADING=true` and `TRADING_ENABLED=false` initially
2. **Use API keys without withdrawal permissions**
3. **Set daily loss limits** conservative
4. **Monitor alerts** closely when first starting
5. **Test strategies** thoroughly in paper mode before going live

## Deployment

### Docker

```bash
docker build -t crypto-bot .
docker run -d --env-file .env crypto-bot
```

### Using Docker Compose (full stack)

```bash
docker-compose up -d
```

This starts:
- crypto-bot
- postgres
- redis
- pgadmin (optional)

## Project Structure

```
crypto-bot/
├── src/
│   ├── index.ts           # Main entry
│   ├── bot/               # Trading engine
│   ├── exchange/          # Exchange adapters (CCXT)
│   ├── strategies/        # Trading strategies
│   ├── models/            # Database models
│   ├── api/               # Dashboard REST API
│   ├── utils/             # Helpers, alerts, logging
│   └── config/            # Configuration loader
├── migrations/            # DB migrations
├── public/                # Dashboard frontend
├── .env.example
├── docker-compose.yml
└── Dockerfile
```

## Disclaimer

This software is for educational purposes. Trading cryptocurrencies is risky. You are responsible for your own trades. Past performance doesn't guarantee future results. **Never trade with money you can't afford to lose.**

## License

MIT