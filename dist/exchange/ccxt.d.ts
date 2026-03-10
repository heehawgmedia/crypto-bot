import * as ccxt from 'ccxt';
export type ExchangeInstance = ccxt.Exchange & {
    apiKey: string;
    secret: string;
    password?: string;
};
export declare class ExchangeAdapter {
    private exchanges;
    constructor();
    private initializeExchanges;
    getExchange(name: string): ExchangeInstance | undefined;
    testConnection(exchangeName: string): Promise<boolean>;
    fetchMarkets(exchangeName: string): Promise<ccxt.Dictionary<ccxt.Market>>;
    fetchTicker(exchangeName: string, symbol: string): Promise<ccxt.Ticker>;
    fetchBalance(exchangeName: string): Promise<ccxt.Balances>;
    createOrder(exchangeName: string, symbol: string, side: 'buy' | 'sell', type: 'market' | 'limit', amount: number, price?: number, params?: Record<string, any>): Promise<ccxt.Order | {
        id: string;
        status: string;
        filled: number;
        average: number | undefined;
    }>;
    cancelOrder(exchangeName: string, orderId: string, symbol: string): Promise<ccxt.Order | {
        id: string;
        status: string;
    }>;
    fetchOrder(exchangeName: string, orderId: string, symbol: string): Promise<ccxt.Order | {
        id: string;
        status: string;
        filled: number;
        average: number;
    }>;
    fetchOHLCV(exchangeName: string, symbol: string, timeframe?: string, since?: number, limit?: number): Promise<ccxt.OHLCV[]>;
    close(): void;
}
export declare const exchangeAdapter: ExchangeAdapter;
//# sourceMappingURL=ccxt.d.ts.map