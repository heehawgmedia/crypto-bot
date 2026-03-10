import { ExchangeAdapter } from '../exchange/ccxt';
import { Trade } from '../database/models';
import { RiskManager } from '../core/risk-manager';
export interface DCAParams {
    symbol: string;
    amount_usd: number;
    interval_minutes: number;
    start_date?: string;
}
export declare class DCAStrategy {
    private exchange;
    private params;
    private strategyId;
    private userId;
    private lastExecution;
    private isRunning;
    constructor(exchange: ExchangeAdapter, params: DCAParams, strategyId: string, userId: string);
    execute(riskManager: RiskManager): Promise<Trade | null>;
    private shouldExecute;
    getParams(): DCAParams;
    updateParams(newParams: Partial<DCAParams>): void;
    setRunning(running: boolean): void;
}
export declare function createDCAStrategy(exchange: ExchangeAdapter, strategyConfig: Record<string, any>, strategyId: string, userId: string): DCAStrategy;
//# sourceMappingURL=dca.d.ts.map