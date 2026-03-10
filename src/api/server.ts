import express from 'express';
import { db } from '../database/models';
import { exchangeAdapter } from '../exchange/ccxt';
import { getBot } from '../core/bot';
import config from '../config';
import logger from '../utils/logger';

const app = express();
const port = config.api.port;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard: Get portfolio summary
app.get('/api/portfolio', async (req, res) => {
  try {
    const userId = 'default'; // TODO: get from auth
    const result = await db.query(
      `SELECT * FROM balance_snapshots
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ totalValueUsd: 0, balances: {} });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Portfolio fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// Dashboard: Get recent trades
app.get('/api/trades', async (req, res) => {
  try {
    const userId = 'default';
    const { limit = 50 } = req.query;

    const result = await db.query(
      `SELECT * FROM trades
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    logger.error('Trades fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Dashboard: Get strategies
app.get('/api/strategies', async (req, res) => {
  try {
    const userId = 'default';
    const result = await db.query(
      'SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Strategies fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
});

// Dashboard: Get positions
app.get('/api/positions', async (req, res) => {
  try {
    const userId = 'default';
    const result = await db.query(
      'SELECT * FROM positions WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Positions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Dashboard: Get notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = 'default';
    const { limit = 50, unreadOnly = false } = req.query;

    let query = 'SELECT * FROM notifications WHERE user_id = $1';
    const params: any[] = [userId];

    if (unreadOnly) {
      query += ' AND is_read = false';
    }

    query += ' ORDER BY created_at DESC LIMIT $2';
    params.push(limit);

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Notifications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1',
      [id]
    );
    res.json({ ok: true });
  } catch (error) {
    logger.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Create strategy
app.post('/api/strategies', async (req, res) => {
  try {
    const userId = 'default';
    const { name, type, config: strategyConfig } = req.body;

    const result = await db.query(
      `INSERT INTO strategies (user_id, name, type, config, is_enabled)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [userId, name, type, strategyConfig]
    );

    const newStrategy = result.rows[0];

    // Reload strategies in bot
    const bot = getBot();
    // TODO: dynamically add strategy to running bot

    res.status(201).json(newStrategy);
  } catch (error) {
    logger.error('Create strategy error:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Toggle strategy enabled
app.patch('/api/strategies/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_enabled } = req.body;

    const result = await db.query(
      'UPDATE strategies SET is_enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [is_enabled, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Reload strategies in bot
    const bot = getBot();
    // TODO: dynamically reload

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Toggle strategy error:', error);
    res.status(500).json({ error: 'Failed to toggle strategy' });
  }
});

// Exchange status
app.get('/api/exchanges/status', async (req, res) => {
  try {
    const exchanges = ['binance', 'coinbase'];
    const status: Record<string, boolean> = {};

    for (const exchangeName of exchanges) {
      try {
        const connected = await exchangeAdapter.testConnection(exchangeName);
        status[exchangeName] = connected;
      } catch {
        status[exchangeName] = false;
      }
    }

    res.json(status);
  } catch (error) {
    logger.error('Exchange status error:', error);
    res.status(500).json({ error: 'Failed to check exchanges' });
  }
});

// Risk stats
app.get('/api/risk/stats', (req, res) => {
  try {
    const bot = getBot();
    // TODO: get actual userId from auth
    const stats = bot['riskManager']?.getDailyStats('default') || {
      tradesToday: 0,
      dailyLoss: 0,
      maxTradesPerDay: config.risk.maxTradesPerDay,
      dailyLossLimit: config.risk.dailyLossLimitUsd,
    };
    res.json(stats);
  } catch (error) {
    logger.error('Risk stats error:', error);
    res.status(500).json({ error: 'Failed to fetch risk stats' });
  }
});

export function startApiServer() {
  app.listen(port, () => {
    logger.info(`API server listening on port ${port}`);
  });
}