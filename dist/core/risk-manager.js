"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../utils/logger"));
class RiskManager {
    dailyTrades = new Map(); // user_id -> count
    dailyLoss = new Map(); // user_id -> loss amount
    async checkTrade(trade) {
        const userId = trade.user_id;
        // Check position size
        const tradeValue = trade.quantity * (trade.price || 0);
        if (tradeValue > config_1.default.risk.maxPositionSizeUsd) {
            return {
                allowed: false,
                reason: `Trade size ($${tradeValue.toFixed(2)}) exceeds limit ($${config_1.default.risk.maxPositionSizeUsd})`,
            };
        }
        // Check max trades per day
        const today = new Date().toDateString();
        const dayKey = `${userId}-${today}`;
        const tradesToday = this.dailyTrades.get(dayKey) || 0;
        if (tradesToday >= config_1.default.risk.maxTradesPerDay) {
            return {
                allowed: false,
                reason: `Daily trade limit (${config_1.default.risk.maxTradesPerDay}) reached`,
            };
        }
        // Check stop loss (would need position data)
        // TODO: implement when positions table is populated
        return { allowed: true };
    }
    recordTrade(trade) {
        const userId = trade.user_id;
        const today = new Date().toDateString();
        const dayKey = `${userId}-${today}`;
        this.dailyTrades.set(dayKey, (this.dailyTrades.get(dayKey) || 0) + 1);
        // Accumulate losses if trade is a sell at a loss
        if (trade.type === 'SELL' && trade.pnl) {
            const existingLoss = this.dailyLoss.get(userId) || 0;
            const newLoss = existingLoss + (trade.pnl < 0 ? Math.abs(trade.pnl) : 0);
            this.dailyLoss.set(userId, newLoss);
            if (newLoss > config_1.default.risk.dailyLossLimitUsd) {
                logger_1.default.warn(`Daily loss limit exceeded for user ${userId}: $${newLoss.toFixed(2)}`);
                // TODO: emit event to disable trading for this user for the day
            }
        }
    }
    getDailyStats(userId) {
        const today = new Date().toDateString();
        const dayKey = `${userId}-${today}`;
        return {
            tradesToday: this.dailyTrades.get(dayKey) || 0,
            dailyLoss: this.dailyLoss.get(userId) || 0,
            maxTradesPerDay: config_1.default.risk.maxTradesPerDay,
            dailyLossLimit: config_1.default.risk.dailyLossLimitUsd,
        };
    }
}
exports.RiskManager = RiskManager;
//# sourceMappingURL=risk-manager.js.map