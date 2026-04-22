// ================================================
// NOTIFICATION SERVICE — Multi-Channel Alerts
// ================================================

import axios from 'axios';
import { config } from '../engine/Config';
import { logger } from '../utils/Logger';

export type NotificationType = 'trade' | 'win' | 'loss' | 'risk' | 'report' | 'system';

export interface Notification {
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export class NotificationService {
  private listeners: Array<(notification: Notification) => void> = [];
  private recentNotifications: Notification[] = [];
  private maxRecent = 100;

  constructor() {
    logger.info('Notifications', 'Notification service initialized');
  }

  /**
   * Subscribe to notifications (used by dashboard WebSocket)
   */
  onNotification(listener: (notification: Notification) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Get recent notifications for dashboard initial load
   */
  getRecent(count = 50): Notification[] {
    return this.recentNotifications.slice(-count);
  }

  // ========================================
  // TRADE NOTIFICATIONS
  // ========================================

  async notifyTradeExecuted(
    question: string,
    side: string,
    price: number,
    stake: number,
    edge: number,
    dryRun: boolean
  ): Promise<void> {
    const prefix = dryRun ? '🏜️ [DRY-RUN]' : '🟢';
    await this.send({
      type: 'trade',
      title: `${prefix} Trade Executado`,
      message: `[${side}] "${question}" @ $${price.toFixed(4)}, stake $${stake.toFixed(2)}, edge +${(edge * 100).toFixed(1)}%`,
      timestamp: new Date().toISOString(),
      data: { question, side, price, stake, edge, dryRun },
    });
  }

  async notifyTradeWon(question: string, profit: number): Promise<void> {
    await this.send({
      type: 'win',
      title: '🎯 Posição Vencedora!',
      message: `"${question}" → +$${profit.toFixed(2)} profit`,
      timestamp: new Date().toISOString(),
      data: { question, profit },
    });
  }

  async notifyTradeLost(question: string, loss: number): Promise<void> {
    await this.send({
      type: 'loss',
      title: '💀 Posição Perdida',
      message: `"${question}" → -$${Math.abs(loss).toFixed(2)}`,
      timestamp: new Date().toISOString(),
      data: { question, loss },
    });
  }

  async notifyRiskAlert(message: string): Promise<void> {
    await this.send({
      type: 'risk',
      title: '🚨 Alerta de Risco',
      message,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyDailyReport(stats: Record<string, unknown>): Promise<void> {
    await this.send({
      type: 'report',
      title: '📊 Relatório Diário',
      message: `Trades: ${stats.trades}, P&L: $${stats.pnl}, Win Rate: ${stats.winRate}%`,
      timestamp: new Date().toISOString(),
      data: stats,
    });
  }

  async notifySystemEvent(message: string): Promise<void> {
    await this.send({
      type: 'system',
      title: '⚙️ Sistema',
      message,
      timestamp: new Date().toISOString(),
    });
  }

  // ========================================
  // CORE SEND
  // ========================================
  private async send(notification: Notification): Promise<void> {
    // Store in recent — shift oldest rather than recreating the array.
    this.recentNotifications.push(notification);
    if (this.recentNotifications.length > this.maxRecent) {
      this.recentNotifications.shift();
    }

    // Emit to WebSocket listeners (dashboard)
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch (err) {
        logger.warn('Notifications', `Listener error: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Send to Discord webhook if configured
    if (config.discordWebhookUrl) {
      await this.sendDiscord(notification);
    }

    // Send to Telegram if configured
    if (config.telegramBotToken && config.telegramChatId) {
      await this.sendTelegram(notification);
    }
  }

  // ========================================
  // TELEGRAM INTEGRATION
  // ========================================
  private async sendTelegram(notification: Notification): Promise<void> {
    if (!config.telegramBotToken || !config.telegramChatId) return;

    try {
      const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
      const text = `*${notification.title}*\n${notification.message}`;
      
      await axios.post(url, {
        chat_id: config.telegramChatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    } catch (err) {
      logger.warn('Notifications', `Telegram send falhou: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ========================================
  // DISCORD INTEGRATION
  // ========================================
  private async sendDiscord(notification: Notification): Promise<void> {
    if (!config.discordWebhookUrl) return;

    try {
      const colorMap: Record<NotificationType, number> = {
        trade: 0x3498db,   // Blue
        win: 0x2ecc71,     // Green
        loss: 0xe74c3c,    // Red
        risk: 0xf39c12,    // Orange
        report: 0x9b59b6,  // Purple
        system: 0x95a5a6,  // Gray
      };

      await axios.post(config.discordWebhookUrl, {
        embeds: [{
          title: notification.title,
          description: notification.message,
          color: colorMap[notification.type] || 0xffffff,
          timestamp: notification.timestamp,
          footer: { text: 'Polymarket AI Trader' },
        }],
      });
    } catch (err) {
      logger.warn('Notifications', `Discord webhook falhou: ${err instanceof Error ? err.message : err}`);
    }
  }
}
