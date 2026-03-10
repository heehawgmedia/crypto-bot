import { Trade } from '../database/models';
export declare class RiskManager {
    private dailyTrades;
    private dailyLoss;
    checkTrade(trade: Trade): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
    recordTrade(trade: Trade): void;
    getDailyStats(userId: string): {
        tradesToday: number;
        dailyLoss: number;
        maxTradesPerDay: any;
        dailyLossLimit: any;
    };
}
//# sourceMappingURL=risk-manager.d.ts.map