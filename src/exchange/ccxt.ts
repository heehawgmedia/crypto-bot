import * as ccxt from 'ccxt';
import config from '../config';

export type ExchangeInstance = ccxt.Exchange & {
  apiKey: string;
  secret: string;
  password?: string;
};

export class ExchangeAdapter {
  private exchanges: Map<string, ExchangeInstance> = new Map();

  constructor() {
    this.initializeExchanges();
  }

  private initializeExchanges() {
    // Binance
    const binance = new ccxt.binance({
      apiKey: config.exchange.binance.apiKey,
      secret: config.exchange.binance.apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'spot',
      },
    }) as ExchangeInstance;
    binance.apiKey = config.exchange.binance.apiKey;
    binance.secret = config.exchange.binance.apiSecret;
    this.exchanges.set('binance', binance);

    // Coinbase (Advanced Trade)
    const coinbase = new ccxt.coinbase({
      apiKey: config.exchange.coinbase.apiKey,
      secret: config.exchange.coinbase.apiSecret,
      password: config.exchange.coinbase.passphrase,
      enableRateLimit: true,
    }) as ExchangeInstance;
    coinbase.apiKey = config.exchange.coinbase.apiKey;
    coinbase.secret = config.exchange.coinbase.apiSecret;
    coinbase.password = config.exchange.coinbase.passphrase;
    this.exchanges.set('coinbase', coinbase);
  }

  getExchange(name: string): ExchangeInstance | undefined {
    return this.exchanges.get(name.toLowerCase());
  }

  async testConnection(exchangeName: string): Promise<boolean> {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) {
      throw new Error(`Exchange ${exchangeName} not configured`);
    }

    try {
      await exchange.fetchBalance();
      return true;
    } catch (error) {
      console.error(`Connection test failed for ${exchangeName}:`, error);
      return false;
    }
  }

  async fetchMarkets(exchangeName: string) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);
    return await exchange.loadMarkets();
  }

  async fetchTicker(exchangeName: string, symbol: string) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);
    return await exchange.fetchTicker(symbol);
  }

  async fetchBalance(exchangeName: string) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);
    return await exchange.fetchBalance();
  }

  async createOrder(
    exchangeName: string,
    symbol: string,
    side: 'buy' | 'sell',
    type: 'market' | 'limit',
    amount: number,
    price?: number,
    params: Record<string, any> = {}
  ) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);

    if (config.bot.paperTrading) {
      console.log(`[PAPER] Would create ${side} ${type} order for ${symbol}: ${amount} @ ${price}`);
      return {
        id: `paper-${Date.now()}`,
        status: 'closed',
        filled: amount,
        average: price,
      };
    }

    const order = await exchange.createOrder(symbol, type, side, amount, price, params);
    return order;
  }

  async cancelOrder(exchangeName: string, orderId: string, symbol: string) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);

    if (config.bot.paperTrading) {
      console.log(`[PAPER] Would cancel order ${orderId} for ${symbol}`);
      return { id: orderId, status: 'canceled' };
    }

    return await exchange.cancelOrder(orderId, symbol);
  }

  async fetchOrder(exchangeName: string, orderId: string, symbol: string) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);

    if (config.bot.paperTrading) {
      // Simulate filled order in paper trading
      return {
        id: orderId,
        status: 'closed',
        filled: 1,
        average: 0,
      };
    }

    return await exchange.fetchOrder(orderId, symbol);
  }

  async fetchOHLCV(
    exchangeName: string,
    symbol: string,
    timeframe: string = '1h',
    since?: number,
    limit: number = 100
  ) {
    const exchange = this.getExchange(exchangeName);
    if (!exchange) throw new Error(`Exchange ${exchangeName} not found`);

    // Adjust timeframe for Coinbase (they use different format)
    const tf = exchangeName === 'coinbase' ? timeframe.replace('h', 'h') : timeframe;

    return await exchange.fetchOHLCV(symbol, tf, since, limit);
  }

  close() {
    for (const [name, exchange] of this.exchanges) {
      console.log(`Closing exchange connection: ${name}`);
      exchange.close();
    }
  }
}

export const exchangeAdapter = new ExchangeAdapter();