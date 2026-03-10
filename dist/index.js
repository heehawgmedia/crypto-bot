"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("./config"));
const logger_1 = __importDefault(require("./utils/logger"));
const migrate_1 = require("./database/migrate");
const bot_1 = require("./core/bot");
const server_1 = require("./api/server");
const alerts_1 = require("./utils/alerts");
async function main() {
    logger_1.default.info('Starting Crypto Trading Bot...');
    logger_1.default.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger_1.default.info(`Trading enabled: ${config_1.default.bot.tradingEnabled ? 'YES' : 'NO (analysis mode)'}`);
    logger_1.default.info(`Paper trading: ${config_1.default.bot.paperTrading ? 'YES' : 'NO (live)'}`);
    try {
        // Run database migrations
        await (0, migrate_1.runMigrations)();
        logger_1.default.info('Database migrations completed');
        // Initialize bot
        const bot = (0, bot_1.getBot)();
        await bot.initialize();
        // Start API server
        (0, server_1.startApiServer)();
        // Start trading loop (only if trading enabled)
        if (config_1.default.bot.tradingEnabled) {
            await bot.start();
        }
        else {
            logger_1.default.warn('Bot running in analysis mode only. No trades will be executed.');
            logger_1.default.warn('Set TRADING_ENABLED=true in .env to enable trading.');
        }
        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger_1.default.info('Shutting down...');
            await bot.stop();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.default.info('Received SIGTERM, shutting down...');
            await bot.stop();
            process.exit(0);
        });
        process.on('unhandledRejection', (err) => {
            logger_1.default.error('Unhandled rejection:', err);
            alerts_1.alert.error(err instanceof Error ? err : new Error(String(err)));
        });
        process.on('uncaughtException', (err) => {
            logger_1.default.error('Uncaught exception:', err);
            process.exit(1);
        });
        logger_1.default.info('Bot initialized successfully');
    }
    catch (error) {
        logger_1.default.error('Failed to start bot:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map