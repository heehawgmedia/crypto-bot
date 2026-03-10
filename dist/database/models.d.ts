import { PoolClient } from 'pg';
import { Redis } from 'ioredis';
export declare class Database {
    private pool;
    private redis;
    constructor();
    query(text: string, params?: any[]): Promise<import("pg").QueryResult<any>>;
    transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getRedis(): Promise<Redis>;
    close(): Promise<void>;
}
export declare const db: Database;
export interface User {
    id: string;
    email: string;
    encrypted_password: string;
    created_at: Date;
    updated_at: Date;
}
export interface Exchange {
    id: string;
    user_id: string;
    name: string;
    encrypted_api_key: string;
    encrypted_api_secret: string;
    encrypted_passphrase?: string;
    is_paper_trading: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface Strategy {
    id: string;
    user_id: string;
    name: string;
    type: 'DCA' | 'SWING' | 'GRID' | 'MANUAL';
    config: Record<string, any>;
    is_enabled: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface Trade {
    id: string;
    user_id: string;
    exchange_id?: string;
    strategy_id?: string;
    symbol: string;
    type: 'BUY' | 'SELL';
    status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'FAILED';
    order_type: 'MARKET' | 'LIMIT' | 'STOP_LIMIT' | 'STOP_MARKET';
    side: 'buy' | 'sell';
    quantity: number;
    price?: number;
    filled_quantity: number;
    avg_fill_price?: number;
    fee: number;
    fee_currency?: string;
    pnl?: number;
    exchange_order_id?: string;
    metadata?: Record<string, any>;
    opened_at?: Date;
    closed_at?: Date;
    created_at: Date;
    updated_at: Date;
}
export interface Position {
    id: string;
    user_id: string;
    symbol: string;
    side: 'long' | 'short';
    quantity: number;
    entry_price: number;
    current_price?: number;
    unrealized_pnl?: number;
    stop_loss?: number;
    take_profit?: number;
    opened_at: Date;
    updated_at: Date;
}
export interface BalanceSnapshot {
    id: string;
    user_id: string;
    exchange_id?: string;
    total_value_usd: number;
    balances: Record<string, number>;
    created_at: Date;
}
export interface Notification {
    id: string;
    user_id: string;
    type: 'TRADE_EXECUTED' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'ERROR' | 'DAILY_SUMMARY' | 'LOW_BALANCE';
    title: string;
    message: string;
    is_read: boolean;
    sent_at?: Date;
    created_at: Date;
}
export default db;
//# sourceMappingURL=models.d.ts.map