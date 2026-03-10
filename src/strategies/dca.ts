import config from '../config';
import { ExchangeAdapter } from '../exchange/ccxt';
import { Trade } from '../database/models';
import { RiskManager } from '../core/risk-manager';

export interface DCAParams {
  symbol: string;
  amount_usd: number;
  interval_minutes: number;
  start_date?: string; // ISO date
}

export class DCAStrategy {
  private exchange: ExchangeAdapter;
  private params: DCAParams;
  private strategyId: string;
  private userId: string;
  private lastExecution: Date | null = null;
  private isRunning: boolean = false;

  constructor(
    exchange: ExchangeAdapter,
    params: DCAParams,
    strategyId: string,
    userId: string
  ) {
    this.exchange = exchange;
    this.params = params;
    this.strategyId = strategyId;
    this.userId = userId;
  }

  async execute(riskManager: RiskManager): Promise<Trade | null> {
    if (!this.shouldExecute()) {
      return null;
    }

    const now = new Date();
    this.lastExecution = now;

    // logger.info is global from utils/logger - we'll use console for now or inject logger
    console.log(`[DCA] Executing DCA buy for ${this.params.symbol} - $${this.params.amount_usd}`);

    try {
      // Get current price
      const ticker = await this.exchange.fetchTicker(config.bot.defaultExchange, this.params.symbol);
      const price = ticker.last;

      if (!price) {
        throw new Error('Unable to fetch current price');
      }

      // Calculate quantity
      const quantity = this.params.amount_usd / price;

      // Create preliminary trade object for risk check
      const preliminaryTrade: Partial<Trade> = {
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
      const riskCheck = await riskManager.checkTrade(preliminaryTrade as Trade);
      if (!riskCheck.allowed) {
        console.warn(`Risk check failed: ${riskCheck.reason}`);
        return null;
      }

      // Create buy order
      const order = await this.exchange.createOrder(
        config.bot.defaultExchange,
        this.params.symbol,
        'buy',
        'market',
        quantity
      );

      const trade: Trade = {
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
    } catch (error) {
      console.error('[DCA] Execution error:', error);
      throw error;
    }
  }

  private shouldExecute(): boolean {
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

  getParams(): DCAParams {
    return { ...this.params };
  }

  updateParams(newParams: Partial<DCAParams>) {
    this.params = { ...this.params, ...newParams };
  }

  setRunning(running: boolean) {
    this.isRunning = running;
  }
}

// Factory function
export function createDCAStrategy(
  exchange: ExchangeAdapter,
  strategyConfig: Record<string, any>,
  strategyId: string,
  userId: string
): DCAStrategy {
  const params: DCAParams = {
    symbol: strategyConfig.symbol ? String(strategyConfig.symbol) : 'BTC/USDT',
    amount_usd: typeof strategyConfig.amount_usd === 'number' ? strategyConfig.amount_usd : 100,
    interval_minutes: typeof strategyConfig.interval_minutes === 'number' ? strategyConfig.interval_minutes : 1440,
    start_date: strategyConfig.start_date ? String(strategyConfig.start_date) : undefined,
  };

  return new DCAStrategy(exchange, params, strategyId, userId);
}