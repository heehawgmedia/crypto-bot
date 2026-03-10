import { EventEmitter } from 'events';
import type { DCAStrategy } from '../strategies/dca';
export declare class TradingBot extends EventEmitter {
    private strategies;
    private riskManager;
    private isRunning;
    private userId;
    constructor();
    initialize(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    private loadStrategies;
    private addStrategy;
    private testConnections;
    private runLoop;
    private updatePortfolio;
    private saveTrade;
    getStrategies(): DCAStrategy[];
}
export declare function getBot(): TradingBot;
//# sourceMappingURL=bot.d.ts.map