"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeAdapter = exports.ExchangeAdapter = void 0;
const ccxt = __importStar(require("ccxt"));
const config_1 = __importDefault(require("../config"));
class ExchangeAdapter {
    exchanges = new Map();
    constructor() {
        this.initializeExchanges();
    }
    initializeExchanges() {
        // Binance
        const binance = new ccxt.binance({
            apiKey: config_1.default.exchange.binance.apiKey,
            secret: config_1.default.exchange.binance.apiSecret,
            enableRateLimit: true,
            options: {
                defaultType: 'spot',
            },
        });
        binance.apiKey = config_1.default.exchange.binance.apiKey;
        binance.secret = config_1.default.exchange.binance.apiSecret;
        this.exchanges.set('binance', binance);
        // Coinbase (Advanced Trade)
        const coinbase = new ccxt.coinbase({
            apiKey: config_1.default.exchange.coinbase.apiKey,
            secret: config_1.default.exchange.coinbase.apiSecret,
            password: config_1.default.exchange.coinbase.passphrase,
            enableRateLimit: true,
        });
        coinbase.apiKey = config_1.default.exchange.coinbase.apiKey;
        coinbase.secret = config_1.default.exchange.coinbase.apiSecret;
        coinbase.password = config_1.default.exchange.coinbase.passphrase;
        this.exchanges.set('coinbase', coinbase);
    }
    getExchange(name) {
        return this.exchanges.get(name.toLowerCase());
    }
    async testConnection(exchangeName) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange) {
            throw new Error(`Exchange ${exchangeName} not configured`);
        }
        try {
            await exchange.fetchBalance();
            return true;
        }
        catch (error) {
            console.error(`Connection test failed for ${exchangeName}:`, error);
            return false;
        }
    }
    async fetchMarkets(exchangeName) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        return await exchange.loadMarkets();
    }
    async fetchTicker(exchangeName, symbol) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        return await exchange.fetchTicker(symbol);
    }
    async fetchBalance(exchangeName) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        return await exchange.fetchBalance();
    }
    async createOrder(exchangeName, symbol, side, type, amount, price, params = {}) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        if (config_1.default.bot.paperTrading) {
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
    async cancelOrder(exchangeName, orderId, symbol) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        if (config_1.default.bot.paperTrading) {
            console.log(`[PAPER] Would cancel order ${orderId} for ${symbol}`);
            return { id: orderId, status: 'canceled' };
        }
        return await exchange.cancelOrder(orderId, symbol);
    }
    async fetchOrder(exchangeName, orderId, symbol) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
        if (config_1.default.bot.paperTrading) {
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
    async fetchOHLCV(exchangeName, symbol, timeframe = '1h', since, limit = 100) {
        const exchange = this.getExchange(exchangeName);
        if (!exchange)
            throw new Error(`Exchange ${exchangeName} not found`);
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
exports.ExchangeAdapter = ExchangeAdapter;
exports.exchangeAdapter = new ExchangeAdapter();
//# sourceMappingURL=ccxt.js.map