import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { db, Trade, Strategy as DBStrategy, Position } from '../database/models';
import { exchangeAdapter } from '../exchange/ccxt';
import { createDCAStrategy } from '../strategies/dca';
import type { DCAStrategy } from '../strategies/dca';
import config from '../config';
import logger from '../utils/logger';
import { alert } from '../utils/alerts';
import { RiskManager } from './risk-manager';
import { startApiServer } from '../api/server';

export class TradingBot extends EventEmitter {
  private strategies: Map<string, DCAStrategy> = new Map();
  private riskManager: RiskManager;
  private isRunning: boolean = false;
  private userId: string; // TODO: multi-user support

  constructor() {
    super();
    this.riskManager = new RiskManager();
    this.userId = 'default'; // TODO: get actual user
  }

  async initialize() {
    logger.info('Initializing trading bot...');

    // Load strategies from DB
    await this.loadStrategies();

    // Test exchange connections
    await this.testConnections();

    this.emit('initialized');
  }

  async start() {
    if (this.isRunning) {
      throw new Error('Bot is already running');
    }

    if (!config.bot.tradingEnabled) {
      logger.warn('Trading is disabled in config (TRADING_ENABLED=false). Running in analysis mode only.');
    }

    logger.info('Starting trading bot...');
    this.isRunning = true;

    // Start main loop
    this.runLoop();

    this.emit('started');
  }

  async stop() {
    logger.info('Stopping trading bot...');
    this.isRunning = false;
    exchangeAdapter.close();
    this.emit('stopped');
  }

  private async loadStrategies() {
    logger.info('Loading strategies from database...');

    const result = await db.query(
      'SELECT * FROM strategies WHERE user_id = $1 AND is_enabled = true',
      [this.userId]
    );

    for (const row of result.rows) {
      this.addStrategy(row as DBStrategy);
    }

    logger.info(`Loaded ${result.rows.length} strategies`);
  }

  private addStrategy(dbStrategy: DBStrategy) {
    let strategy;

    switch (dbStrategy.type) {
      case 'DCA':
        strategy = createDCAStrategy(
          exchangeAdapter,
          dbStrategy.config,
          dbStrategy.id,
          this.userId
        );
        break;

      default:
        logger.warn(`Unknown strategy type: ${dbStrategy.type}`);
        return;
    }

    this.strategies.set(dbStrategy.id, strategy);
    logger.info(`Added strategy: ${dbStrategy.name} (${dbStrategy.type})`);
  }

  private async testConnections() {
    const exchanges = ['binance', 'coinbase'];

    for (const exchangeName of exchanges) {
      try {
        const connected = await exchangeAdapter.testConnection(exchangeName);
        if (connected) {
          logger.info(`✓ Connected to ${exchangeName}`);
        } else {
          logger.warn(`✗ Failed to connect to ${exchangeName}`);
        }
      } catch (error) {
        logger.error(`Connection error for ${exchangeName}:`, error);
      }
    }
  }

  private async runLoop() {
    if (!this.isRunning) return;

    try {
      // Update portfolio snapshot
      await this.updatePortfolio();

      // Execute strategies
      for (const [strategyId, strategy] of this.strategies) {
        try {
          const trade = await strategy.execute(this.riskManager);

          if (trade) {
            // Save trade to database
            const savedTrade = await this.saveTrade(trade);
            this.emit('tradeExecuted', savedTrade);

            // Update risk manager
            this.riskManager.recordTrade(savedTrade);

            // Send notification
            await alert.tradeExecuted(savedTrade);
          }
        } catch (error) {
          logger.error(`Strategy ${strategyId} execution error:`, error);
          await alert.error(`Strategy error: ${error}`);
        }
      }
    } catch (error) {
      logger.error('Main loop error:', error);
    }

    // Run again in 60 seconds
    setTimeout(() => this.runLoop(), 60 * 1000);
  }

  private async updatePortfolio() {
    try {
      const exchangeName = config.bot.defaultExchange;
      const balance = await exchangeAdapter.fetchBalance(exchangeName);

      // Calculate total value in USD
      let totalValueUsd = 0;
      const balances: Record<string, number> = {};

      for (const [currency, info] of Object.entries(balance)) {
        const typedInfo = info as { free: number; total: number; usdValue?: number };
        const amount = typedInfo.total || typedInfo.free || 0;

        if (amount > 0) {
          balances[currency] = amount;

          if (typedInfo.usdValue) {
            totalValueUsd += typedInfo.usdValue;
          } else if (currency === 'USDT' || currency === 'USDC' || currency === 'BUSD') {
            totalValueUsd += amount;
          } else {
            // Try to get ticker price
            try {
              const ticker = await exchangeAdapter.fetchTicker(exchangeName, `${currency}/USDT`);
              if (ticker.last) {
                totalValueUsd += amount * ticker.last;
              }
            } catch {
              // skip
            }
          }
        }
      }

      // Save snapshot to DB
      const userId = this.userId;
      await db.query(
        `INSERT INTO balance_snapshots (user_id, total_value_usd, balances)
         VALUES ($1, $2, $3)`,
        [userId, totalValueUsd, balances]
      );

      logger.debug(`Portfolio snapshot: $${totalValueUsd.toFixed(2)}`);
    } catch (error) {
      logger.error('Failed to update portfolio:', error);
    }
  }

  private async saveTrade(trade: Trade): Promise<Trade> {
    const result = await db.query(
      `INSERT INTO trades (
        user_id, strategy_id, symbol, type, status, order_type, side,
        quantity, price, filled_quantity, avg_fill_price, fee, fee_currency,
        exchange_order_id, opened_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        trade.user_id,
        trade.strategy_id,
        trade.symbol,
        trade.type,
        trade.status,
        trade.order_type,
        trade.side,
        trade.quantity,
        trade.price,
        trade.filled_quantity,
        trade.avg_fill_price,
        trade.fee,
        trade.fee_currency,
        trade.exchange_order_id,
        trade.opened_at,
        trade.closed_at,
      ]
    );

    return result.rows[0];
  }

  getStrategies() {
    return Array.from(this.strategies.values());
  }
}

// Singleton
let botInstance: TradingBot | null = null;

export function getBot(): TradingBot {
  if (!botInstance) {
    botInstance = new TradingBot();
  }
  return botInstance;
}