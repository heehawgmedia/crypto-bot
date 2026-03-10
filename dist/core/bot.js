"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingBot = void 0;
exports.getBot = getBot;
const events_1 = require("events");
const models_1 = require("../database/models");
const ccxt_1 = require("../exchange/ccxt");
const dca_1 = require("../strategies/dca");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../utils/logger"));
const alerts_1 = require("../utils/alerts");
const risk_manager_1 = require("./risk-manager");
class TradingBot extends events_1.EventEmitter {
    strategies = new Map();
    riskManager;
    isRunning = false;
    userId; // TODO: multi-user support
    constructor() {
        super();
        this.riskManager = new risk_manager_1.RiskManager();
        this.userId = 'default'; // TODO: get actual user
    }
    async initialize() {
        logger_1.default.info('Initializing trading bot...');
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
        if (!config_1.default.bot.tradingEnabled) {
            logger_1.default.warn('Trading is disabled in config (TRADING_ENABLED=false). Running in analysis mode only.');
        }
        logger_1.default.info('Starting trading bot...');
        this.isRunning = true;
        // Start main loop
        this.runLoop();
        this.emit('started');
    }
    async stop() {
        logger_1.default.info('Stopping trading bot...');
        this.isRunning = false;
        ccxt_1.exchangeAdapter.close();
        this.emit('stopped');
    }
    async loadStrategies() {
        logger_1.default.info('Loading strategies from database...');
        const result = await models_1.db.query('SELECT * FROM strategies WHERE user_id = $1 AND is_enabled = true', [this.userId]);
        for (const row of result.rows) {
            this.addStrategy(row);
        }
        logger_1.default.info(`Loaded ${result.rows.length} strategies`);
    }
    addStrategy(dbStrategy) {
        let strategy;
        switch (dbStrategy.type) {
            case 'DCA':
                strategy = (0, dca_1.createDCAStrategy)(ccxt_1.exchangeAdapter, dbStrategy.config, dbStrategy.id, this.userId);
                break;
            default:
                logger_1.default.warn(`Unknown strategy type: ${dbStrategy.type}`);
                return;
        }
        this.strategies.set(dbStrategy.id, strategy);
        logger_1.default.info(`Added strategy: ${dbStrategy.name} (${dbStrategy.type})`);
    }
    async testConnections() {
        const exchanges = ['binance', 'coinbase'];
        for (const exchangeName of exchanges) {
            try {
                const connected = await ccxt_1.exchangeAdapter.testConnection(exchangeName);
                if (connected) {
                    logger_1.default.info(`✓ Connected to ${exchangeName}`);
                }
                else {
                    logger_1.default.warn(`✗ Failed to connect to ${exchangeName}`);
                }
            }
            catch (error) {
                logger_1.default.error(`Connection error for ${exchangeName}:`, error);
            }
        }
    }
    async runLoop() {
        if (!this.isRunning)
            return;
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
                        await alerts_1.alert.tradeExecuted(savedTrade);
                    }
                }
                catch (error) {
                    logger_1.default.error(`Strategy ${strategyId} execution error:`, error);
                    await alerts_1.alert.error(`Strategy error: ${error}`);
                }
            }
        }
        catch (error) {
            logger_1.default.error('Main loop error:', error);
        }
        // Run again in 60 seconds
        setTimeout(() => this.runLoop(), 60 * 1000);
    }
    async updatePortfolio() {
        try {
            const exchangeName = config_1.default.bot.defaultExchange;
            const balance = await ccxt_1.exchangeAdapter.fetchBalance(exchangeName);
            // Calculate total value in USD
            let totalValueUsd = 0;
            const balances = {};
            for (const [currency, info] of Object.entries(balance)) {
                const typedInfo = info;
                const amount = typedInfo.total || typedInfo.free || 0;
                if (amount > 0) {
                    balances[currency] = amount;
                    if (typedInfo.usdValue) {
                        totalValueUsd += typedInfo.usdValue;
                    }
                    else if (currency === 'USDT' || currency === 'USDC' || currency === 'BUSD') {
                        totalValueUsd += amount;
                    }
                    else {
                        // Try to get ticker price
                        try {
                            const ticker = await ccxt_1.exchangeAdapter.fetchTicker(exchangeName, `${currency}/USDT`);
                            if (ticker.last) {
                                totalValueUsd += amount * ticker.last;
                            }
                        }
                        catch {
                            // skip
                        }
                    }
                }
            }
            // Save snapshot to DB
            const userId = this.userId;
            await models_1.db.query(`INSERT INTO balance_snapshots (user_id, total_value_usd, balances)
         VALUES ($1, $2, $3)`, [userId, totalValueUsd, balances]);
            logger_1.default.debug(`Portfolio snapshot: $${totalValueUsd.toFixed(2)}`);
        }
        catch (error) {
            logger_1.default.error('Failed to update portfolio:', error);
        }
    }
    async saveTrade(trade) {
        const result = await models_1.db.query(`INSERT INTO trades (
        user_id, strategy_id, symbol, type, status, order_type, side,
        quantity, price, filled_quantity, avg_fill_price, fee, fee_currency,
        exchange_order_id, opened_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`, [
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
        ]);
        return result.rows[0];
    }
    getStrategies() {
        return Array.from(this.strategies.values());
    }
}
exports.TradingBot = TradingBot;
// Singleton
let botInstance = null;
function getBot() {
    if (!botInstance) {
        botInstance = new TradingBot();
    }
    return botInstance;
}
//# sourceMappingURL=bot.js.map