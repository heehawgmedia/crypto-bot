declare class AlertService {
    tradeExecuted(trade: any): Promise<void>;
    stopLossTriggered(trade: any): Promise<void>;
    takeProfitTriggered(trade: any): Promise<void>;
    error(error: Error | string, context?: Record<string, any>): Promise<void>;
    dailySummary(stats: {
        totalValue: number;
        pnl24h: number;
        tradesCount: number;
    }): Promise<void>;
    lowBalance(currency: string, balance: number, threshold: number): Promise<void>;
    private sendToAll;
    private sendTelegram;
    private sendDiscord;
}
export declare const alert: AlertService;
export {};
//# sourceMappingURL=alerts.d.ts.map