import axios from 'axios';
import logger from './logger';
import config from '../config';

export const alert = {
  async tradeExecuted(trade: any) {
    const message = `Trade executed: ${trade.side.toUpperCase()} ${trade.quantity} ${trade.symbol} @ $${trade.avg_fill_price || 'market'}`;
    logger.info(message);

    await this.sendToAll({
      title: 'Trade Executed',
      message,
      type: 'TRADE_EXECUTED',
    });
  },

  async stopLossTriggered(trade: any) {
    const message = `Stop loss triggered for ${trade.symbol} at $${trade.price}`;
    logger.warn(message);

    await this.sendToAll({
      title: 'Stop Loss Hit',
      message,
      type: 'STOP_LOSS',
    });
  },

  async takeProfitTriggered(trade: any) {
    const message = `Take profit hit for ${trade.symbol} at $${trade.price}`;
    logger.info(message);

    await this.sendToAll({
      title: 'Take Profit',
      message,
      type: 'TAKE_PROFIT',
    });
  },

  async error(error: Error | string, context?: Record<string, any>) {
    const message = error instanceof Error ? error.message : error;
    logger.error(`Bot error${context ? ` (${JSON.stringify(context)})` : ''}:`, message);

    await this.sendToAll({
      title: 'Bot Error',
      message: `${message}\nContext: ${JSON.stringify(context, null, 2)}`,
      type: 'ERROR',
    });
  },

  async dailySummary(stats: { totalValue: number; pnl24h: number; tradesCount: number }) {
    const message = `Daily Summary:
Portfolio: $${stats.totalValue.toFixed(2)}
24h P&L: $${stats.pnl24h.toFixed(2)}
Trades: ${stats.tradesCount}`;

    logger.info(message);

    await this.sendToAll({
      title: 'Daily Summary',
      message,
      type: 'DAILY_SUMMARY',
    });
  },

  async lowBalance(currency: string, balance: number, threshold: number) {
    const message = `Low balance alert: ${currency} = ${balance.toFixed(4)} (below ${threshold})`;
    logger.warn(message);

    await this.sendToAll({
      title: 'Low Balance',
      message,
      type: 'LOW_BALANCE',
    });
  },

  private async sendToAll(notification: { title: string; message: string; type: string }) {
    const promises: Promise<void>[] = [];

    if (config.notifications.telegram.botToken && config.notifications.telegram.chatId) {
      promises.push(this.sendTelegram(notification));
    }

    if (config.notifications.discord.webhookUrl) {
      promises.push(this.sendDiscord(notification));
    }

    await Promise.allSettled(promises);
  }

  private async sendTelegram(notification: { title: string; message: string }) {
    const { botToken, chatId } = config.notifications.telegram;
    const text = `*${notification.title}*\n${notification.message}`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }
      );
    } catch (error) {
      logger.error('Failed to send Telegram message:', error);
    }
  }

  private async sendDiscord(notification: { title: string; message: string }) {
    const { webhookUrl } = config.notifications.discord;

    try {
      await axios.post(webhookUrl, {
        embeds: [
          {
            title: notification.title,
            description: notification.message,
            color: notification.type === 'ERROR' ? 16711680 : 3447003, // red or blue
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      logger.error('Failed to send Discord message:', error);
    }
  }
};