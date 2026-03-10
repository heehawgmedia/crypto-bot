import { Pool, PoolClient } from 'pg';
import { DefaultEventsMap } from 'socket.io';
import Redis from 'ioredis';
import config from '../config';

export class Database {
  private pool: Pool;
  private redis: Redis.Redis;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.redis = new Redis(config.database.redisUrl);
  }

  async query(text: string, params?: any[]) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      console.error('Database query error', { text, error });
      throw error;
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRedis(): Promise<Redis.Redis> {
    return this.redis;
  }

  async close() {
    await this.pool.end();
    await this.redis.quit();
  }
}

// Singleton instance
export const db = new Database();

// Type definitions (simplified ORM-like interfaces)
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