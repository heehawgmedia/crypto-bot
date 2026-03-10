import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  // Exchange
  BINANCE_API_KEY: Joi.string().allow(''),
  BINANCE_API_SECRET: Joi.string().allow(''),
  COINBASE_API_KEY: Joi.string().allow(''),
  COINBASE_API_SECRET: Joi.string().allow(''),
  COINBASE_API_PASSPHRASE: Joi.string().allow(''),

  // Database
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  // Bot
  TRADING_ENABLED: Joi.boolean().default(false),
  PAPER_TRADING: Joi.boolean().default(true),
  DEFAULT_EXCHANGE: Joi.string().default('binance'),

  // Risk
  MAX_POSITION_SIZE_USD: Joi.number().default(1000),
  DAILY_LOSS_LIMIT_USD: Joi.number().default(100),
  MAX_TRADES_PER_DAY: Joi.number().default(10),

  // Notifications
  TELEGRAM_BOT_TOKEN: Joi.string().allow(''),
  TELEGRAM_CHAT_ID: Joi.string().allow(''),
  DISCORD_WEBHOOK_URL: Joi.string().allow(''),

  // API
  API_PORT: Joi.number().default(3001),
  JWT_SECRET: Joi.string().required(),

  // Logging
  LOG_LEVEL: Joi.string().default('info'),
});

const { error, value } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Environment validation error: ${error.message}`);
}

export const config = {
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

export default config;