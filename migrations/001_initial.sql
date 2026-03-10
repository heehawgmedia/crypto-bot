-- Create enum types
CREATE TYPE trade_type AS ENUM ('BUY', 'SELL');
CREATE TYPE trade_status AS ENUM ('PENDING', 'OPEN', 'FILLED', 'CANCELLED', 'FAILED');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP_LIMIT', 'STOP_MARKET');
CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK');
CREATE TYPE strategy_type AS ENUM ('DCA', 'SWING', 'GRID', 'MANUAL');
CREATE TYPE notification_type AS ENUM ('TRADE_EXECUTED', 'STOP_LOSS', 'TAKE_PROFIT', 'ERROR', 'DAILY_SUMMARY', 'LOW_BALANCE');

-- Users table (for multi-user support)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  encrypted_password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Exchanges table
CREATE TABLE IF NOT EXISTS exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL, -- 'binance', 'coinbase', etc.
  encrypted_api_key TEXT NOT NULL,
  encrypted_api_secret TEXT NOT NULL,
  encrypted_passphrase TEXT, -- for coinbase
  is_paper_trading BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Trading strategies
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type strategy_type NOT NULL,
  config JSONB NOT NULL, -- strategy-specific parameters
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  exchange_id UUID REFERENCES exchanges(id),
  strategy_id UUID REFERENCES strategies(id),
  symbol VARCHAR(20) NOT NULL, -- e.g., 'BTC/USDT'
  type trade_type NOT NULL,
  status trade_status DEFAULT 'PENDING',
  order_type order_type NOT NULL,
  side VARCHAR(4) NOT NULL, -- 'buy' or 'sell'
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8), -- null for market orders
  filled_quantity DECIMAL(20, 8) DEFAULT 0,
  avg_fill_price DECIMAL(20, 8),
  fee DECIMAL(20, 8) DEFAULT 0,
  fee_currency VARCHAR(10),
  pnl DECIMAL(20, 8), -- realized P&L when closed
  exchange_order_id VARCHAR(255), -- order ID from exchange
  metadata JSONB, -- additional data
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Positions table (open positions)
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(4) NOT NULL, -- 'long' or 'short'
  quantity DECIMAL(20, 8) NOT NULL,
  entry_price DECIMAL(20, 8) NOT NULL,
  current_price DECIMAL(20, 8),
  unrealized_pnl DECIMAL(20, 8),
  stop_loss DECIMAL(20, 8),
  take_profit DECIMAL(20, 8),
  opened_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, symbol, side, opened_at)
);

-- Balance snapshots (for tracking portfolio over time)
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  exchange_id UUID REFERENCES exchanges(id),
  total_value_usd DECIMAL(20, 2) NOT NULL,
  balances JSONB NOT NULL, -- { 'BTC': 0.5, 'USDT': 1000, ... }
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- System logs
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  level VARCHAR(10) NOT NULL, -- error, warn, info, debug
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_created_at ON trades(created_at);
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_balance_snapshots_user_id ON balance_snapshots(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_system_logs_created_at ON system_logs(created_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_exchanges_updated_at BEFORE UPDATE ON exchanges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_strategies_updated_at BEFORE UPDATE ON strategies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();