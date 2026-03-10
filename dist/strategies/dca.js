"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DCAStrategy = void 0;
exports.createDCAStrategy = createDCAStrategy;
const config_1 = __importDefault(require("../config"));
class DCAStrategy {
    exchange;
    params;
    strategyId;
    userId;
    lastExecution = null;
    isRunning = false;
    constructor(exchange, params, strategyId, userId) {
        this.exchange = exchange;
        this.params = params;
        this.strategyId = strategyId;
        this.userId = userId;
    }
    async execute(riskManager) {
        if (!this.shouldExecute()) {
            return null;
        }
        const now = new Date();
        this.lastExecution = now;
        // logger.info is global from utils/logger - we'll use console for now or inject logger
        console.log(`[DCA] Executing DCA buy for ${this.params.symbol} - $${this.params.amount_usd}`);
        try {
            // Get current price
            const ticker = await this.exchange.fetchTicker(config_1.default.bot.defaultExchange, this.params.symbol);
            const price = ticker.last;
            if (!price) {
                throw new Error('Unable to fetch current price');
            }
            // Calculate quantity
            const quantity = this.params.amount_usd / price;
            // Create preliminary trade object for risk check
            const preliminaryTrade = {
                user_id: this.userId,
                strategy_id: this.strategyId,
                symbol: this.params.symbol,
                type: 'BUY',
                order_type: 'MARKET',
                side: 'buy',
                quantity: quantity,
                price: price,
            };
            // Check risk limits
            const riskCheck = await riskManager.checkTrade(preliminaryTrade);
            if (!riskCheck.allowed) {
                console.warn(`Risk check failed: ${riskCheck.reason}`);
                return null;
            }
            // Create buy order
            const order = await this.exchange.createOrder(config_1.default.bot.defaultExchange, this.params.symbol, 'buy', 'market', quantity);
            const trade = {
                id: '', // will be set by DB
                user_id: this.userId,
                strategy_id: this.strategyId,
                symbol: this.params.symbol,
                type: 'BUY',
                status: 'FILLED',
                order_type: 'MARKET',
                side: 'buy',
                quantity: quantity,
                price: price,
                filled_quantity: order.filled || quantity,
                avg_fill_price: order.average || price,
                fee: 0,
                fee_currency: 'USDT',
                pnl: undefined,
                exchange_order_id: order.id,
                opened_at: now,
                closed_at: now,
                created_at: now,
                updated_at: now,
            };
            console.log(`[DCA] Order executed: ${quantity.toFixed(6)} @ $${price.toFixed(2)}`);
            return trade;
        }
        catch (error) {
            console.error('[DCA] Execution error:', error);
            throw error;
        }
    }
    shouldExecute() {
        if (this.isRunning) {
            return false;
        }
        const now = new Date();
        // Check start date
        if (this.params.start_date) {
            const startDate = new Date(this.params.start_date);
            if (now < startDate) {
                console.log(`[DCA] Not started yet. Start date: ${startDate}`);
                return false;
            }
        }
        // Check interval
        if (!this.lastExecution) {
            return true;
        }
        const elapsedMs = now.getTime() - this.lastExecution.getTime();
        const intervalMs = this.params.interval_minutes * 60 * 1000;
        return elapsedMs >= intervalMs;
    }
    getParams() {
        return { ...this.params };
    }
    updateParams(newParams) {
        this.params = { ...this.params, ...newParams };
    }
    setRunning(running) {
        this.isRunning = running;
    }
}
exports.DCAStrategy = DCAStrategy;
// Factory function
function createDCAStrategy(exchange, strategyConfig, strategyId, userId) {
    const params = {
        symbol: strategyConfig.symbol ? String(strategyConfig.symbol) : 'BTC/USDT',
        amount_usd: typeof strategyConfig.amount_usd === 'number' ? strategyConfig.amount_usd : 100,
        interval_minutes: typeof strategyConfig.interval_minutes === 'number' ? strategyConfig.interval_minutes : 1440,
        start_date: strategyConfig.start_date ? String(strategyConfig.start_date) : undefined,
    };
    return new DCAStrategy(exchange, params, strategyId, userId);
}
//# sourceMappingURL=dca.js.map