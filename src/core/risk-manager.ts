import { Trade } from '../database/models';
import { db } from '../database/models';
import config from '../config';
import logger from '../utils/logger';

export class RiskManager {
  private dailyTrades: Map<string, number> = new Map(); // user_id -> count
  private dailyLoss: Map<string, number> = new Map(); // user_id -> loss amount

  async checkTrade(trade: Trade): Promise<{ allowed: boolean; reason?: string }> {
    const userId = trade.user_id;

    // Check position size
    const tradeValue = trade.quantity * (trade.price || 0);
    if (tradeValue > config.risk.maxPositionSizeUsd) {
      return {
        allowed: false,
        reason: `Trade size ($${tradeValue.toFixed(2)}) exceeds limit ($${config.risk.maxPositionSizeUsd})`,
      };
    }

    // Check max trades per day
    const today = new Date().toDateString();
    const dayKey = `${userId}-${today}`;
    const tradesToday = this.dailyTrades.get(dayKey) || 0;
    if (tradesToday >= config.risk.maxTradesPerDay) {
      return {
        allowed: false,
        reason: `Daily trade limit (${config.risk.maxTradesPerDay}) reached`,
      };
    }

    // Check stop loss (would need position data)
    // TODO: implement when positions table is populated

    return { allowed: true };
  }

  recordTrade(trade: Trade) {
    const userId = trade.user_id;
    const today = new Date().toDateString();
    const dayKey = `${userId}-${today}`;

    this.dailyTrades.set(dayKey, (this.dailyTrades.get(dayKey) || 0) + 1);

    // Accumulate losses if trade is a sell at a loss
    if (trade.type === 'SELL' && trade.pnl) {
      const existingLoss = this.dailyLoss.get(userId) || 0;
      const newLoss = existingLoss + (trade.pnl < 0 ? Math.abs(trade.pnl) : 0);
      this.dailyLoss.set(userId, newLoss);

      if (newLoss > config.risk.dailyLossLimitUsd) {
        logger.warn(`Daily loss limit exceeded for user ${userId}: $${newLoss.toFixed(2)}`);
        // TODO: emit event to disable trading for this user for the day
      }
    }
  }

  getDailyStats(userId: string) {
    const today = new Date().toDateString();
    const dayKey = `${userId}-${today}`;
    return {
      tradesToday: this.dailyTrades.get(dayKey) || 0,
      dailyLoss: this.dailyLoss.get(userId) || 0,
      maxTradesPerDay: config.risk.maxTradesPerDay,
      dailyLossLimit: config.risk.dailyLossLimitUsd,
    };
  }
}