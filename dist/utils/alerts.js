"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.alert = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
const config_1 = __importDefault(require("../config"));
class AlertService {
    async tradeExecuted(trade) {
        const message = `Trade executed: ${trade.side.toUpperCase()} ${trade.quantity} ${trade.symbol} @ $${trade.avg_fill_price || 'market'}`;
        logger_1.default.info(message);
        await this.sendToAll({
            title: 'Trade Executed',
            message,
            type: 'TRADE_EXECUTED',
        });
    }
    async stopLossTriggered(trade) {
        const message = `Stop loss triggered for ${trade.symbol} at $${trade.price}`;
        logger_1.default.warn(message);
        await this.sendToAll({
            title: 'Stop Loss Hit',
            message,
            type: 'STOP_LOSS',
        });
    }
    async takeProfitTriggered(trade) {
        const message = `Take profit hit for ${trade.symbol} at $${trade.price}`;
        logger_1.default.info(message);
        await this.sendToAll({
            title: 'Take Profit',
            message,
            type: 'TAKE_PROFIT',
        });
    }
    async error(error, context) {
        const message = error instanceof Error ? error.message : error;
        logger_1.default.error(`Bot error${context ? ` (${JSON.stringify(context)})` : ''}:`, message);
        await this.sendToAll({
            title: 'Bot Error',
            message: `${message}\nContext: ${JSON.stringify(context, null, 2)}`,
            type: 'ERROR',
        });
    }
    async dailySummary(stats) {
        const message = `Daily Summary:
Portfolio: $${stats.totalValue.toFixed(2)}
24h P&L: $${stats.pnl24h.toFixed(2)}
Trades: ${stats.tradesCount}`;
        logger_1.default.info(message);
        await this.sendToAll({
            title: 'Daily Summary',
            message,
            type: 'DAILY_SUMMARY',
        });
    }
    async lowBalance(currency, balance, threshold) {
        const message = `Low balance alert: ${currency} = ${balance.toFixed(4)} (below ${threshold})`;
        logger_1.default.warn(message);
        await this.sendToAll({
            title: 'Low Balance',
            message,
            type: 'LOW_BALANCE',
        });
    }
    async sendToAll(notification) {
        const promises = [];
        if (config_1.default.notifications.telegram.botToken && config_1.default.notifications.telegram.chatId) {
            promises.push(this.sendTelegram(notification));
        }
        if (config_1.default.notifications.discord.webhookUrl) {
            promises.push(this.sendDiscord(notification));
        }
        await Promise.allSettled(promises);
    }
    async sendTelegram(notification) {
        const { botToken, chatId } = config_1.default.notifications.telegram;
        const text = `*${notification.title}*\n${notification.message}`;
        try {
            await axios_1.default.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
            });
        }
        catch (error) {
            logger_1.default.error('Failed to send Telegram message:', error);
        }
    }
    async sendDiscord(notification) {
        const { webhookUrl } = config_1.default.notifications.discord;
        try {
            await axios_1.default.post(webhookUrl, {
                embeds: [
                    {
                        title: notification.title,
                        description: notification.message,
                        color: notification.type === 'ERROR' ? 16711680 : 3447003, // red or blue
                        timestamp: new Date().toISOString(),
                    },
                ],
            });
        }
        catch (error) {
            logger_1.default.error('Failed to send Discord message:', error);
        }
    }
}
exports.alert = new AlertService();
//# sourceMappingURL=alerts.js.map