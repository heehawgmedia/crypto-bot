import config from './config';
import logger from './utils/logger';
import { runMigrations } from './database/migrate';
import { getBot } from './core/bot';
import { startApiServer } from './api/server';
import { alert } from './utils/alerts';

async function main() {
  logger.info('Starting Crypto Trading Bot...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Trading enabled: ${config.bot.tradingEnabled ? 'YES' : 'NO (analysis mode)'}`);
  logger.info(`Paper trading: ${config.bot.paperTrading ? 'YES' : 'NO (live)'}`);

  try {
    // Run database migrations
    await runMigrations();
    logger.info('Database migrations completed');

    // Initialize bot
    const bot = getBot();
    await bot.initialize();

    // Start API server
    startApiServer();

    // Start trading loop (only if trading enabled)
    if (config.bot.tradingEnabled) {
      await bot.start();
    } else {
      logger.warn('Bot running in analysis mode only. No trades will be executed.');
      logger.warn('Set TRADING_ENABLED=true in .env to enable trading.');
    }

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await bot.stop();
      process.exit(0);
    });

    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled rejection:', err);
      alert.error(err instanceof Error ? err : new Error(String(err)));
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      process.exit(1);
    });

    logger.info('Bot initialized successfully');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();