"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const joi_1 = __importDefault(require("joi"));
dotenv_1.default.config();
const envSchema = joi_1.default.object({
    // Exchange
    BINANCE_API_KEY: joi_1.default.string().allow(''),
    BINANCE_API_SECRET: joi_1.default.string().allow(''),
    COINBASE_API_KEY: joi_1.default.string().allow(''),
    COINBASE_API_SECRET: joi_1.default.string().allow(''),
    COINBASE_API_PASSPHRASE: joi_1.default.string().allow(''),
    // Database
    DATABASE_URL: joi_1.default.string().required(),
    REDIS_URL: joi_1.default.string().required(),
    // Bot
    TRADING_ENABLED: joi_1.default.boolean().default(false),
    PAPER_TRADING: joi_1.default.boolean().default(true),
    DEFAULT_EXCHANGE: joi_1.default.string().default('binance'),
    // Risk
    MAX_POSITION_SIZE_USD: joi_1.default.number().default(1000),
    DAILY_LOSS_LIMIT_USD: joi_1.default.number().default(100),
    MAX_TRADES_PER_DAY: joi_1.default.number().default(10),
    // Notifications
    TELEGRAM_BOT_TOKEN: joi_1.default.string().allow(''),
    TELEGRAM_CHAT_ID: joi_1.default.string().allow(''),
    DISCORD_WEBHOOK_URL: joi_1.default.string().allow(''),
    // API
    API_PORT: joi_1.default.number().default(3001),
    JWT_SECRET: joi_1.default.string().required(),
    // Logging
    LOG_LEVEL: joi_1.default.string().default('info'),
});
const { error, value } = envSchema.validate(process.env);
if (error) {
    throw new Error(`Environment validation error: ${error.message}`);
}
exports.config = {
    exchange: {
        binance: {
            apiKey: value.BINANCE_API_KEY || '',
            apiSecret: value.BINANCE_API_SECRET || '',
        },
        coinbase: {
            apiKey: value.COINBASE_API_KEY || '',
            apiSecret: value.COINBASE_API_SECRET || '',
            passphrase: value.COINBASE_API_PASSPHRASE || '',
        },
    },
    database: {
        url: value.DATABASE_URL,
        redisUrl: value.REDIS_URL,
    },
    bot: {
        tradingEnabled: value.TRADING_ENABLED,
        paperTrading: value.PAPER_TRADING,
        defaultExchange: value.DEFAULT_EXCHANGE,
    },
    risk: {
        maxPositionSizeUsd: value.MAX_POSITION_SIZE_USD,
        dailyLossLimitUsd: value.DAILY_LOSS_LIMIT_USD,
        maxTradesPerDay: value.MAX_TRADES_PER_DAY,
    },
    notifications: {
        telegram: {
            botToken: value.TELEGRAM_BOT_TOKEN || '',
            chatId: value.TELEGRAM_CHAT_ID || '',
        },
        discord: {
            webhookUrl: value.DISCORD_WEBHOOK_URL || '',
        },
    },
    api: {
        port: value.API_PORT,
        jwtSecret: value.JWT_SECRET,
    },
    logging: {
        level: value.LOG_LEVEL,
    },
};
exports.default = exports.config;
//# sourceMappingURL=index.js.map