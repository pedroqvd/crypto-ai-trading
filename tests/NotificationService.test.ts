// ================================================
// TESTS: NotificationService
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: {
    discordWebhookUrl: undefined,
    logLevel: 'warn',
  },
}));

// Mock axios to prevent real HTTP calls
jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ status: 204 }),
}));

import { NotificationService, Notification } from '../src/services/NotificationService';
import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
    jest.clearAllMocks();
  });

  // ----------------------------------------
  // getRecent
  // ----------------------------------------
  describe('getRecent', () => {
    it('returns empty array initially', () => {
      expect(service.getRecent()).toHaveLength(0);
    });

    it('stores notifications after send', async () => {
      await service.notifySystemEvent('test message');
      expect(service.getRecent()).toHaveLength(1);
    });

    it('respects count parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await service.notifySystemEvent(`msg ${i}`);
      }
      expect(service.getRecent(3)).toHaveLength(3);
    });

    it('stores notifications in order (oldest first)', async () => {
      await service.notifySystemEvent('first');
      await service.notifySystemEvent('second');
      const recent = service.getRecent();
      expect(recent[0].message).toBe('first');
      expect(recent[1].message).toBe('second');
    });
  });

  // ----------------------------------------
  // onNotification listener
  // ----------------------------------------
  describe('onNotification', () => {
    it('calls listener when notification is sent', async () => {
      const listener = jest.fn();
      service.onNotification(listener);
      await service.notifySystemEvent('hello');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('passes correct notification to listener', async () => {
      const listener = jest.fn();
      service.onNotification(listener);
      await service.notifySystemEvent('test event');

      const notification: Notification = listener.mock.calls[0][0];
      expect(notification.type).toBe('system');
      expect(notification.message).toBe('test event');
      expect(notification.timestamp).toBeDefined();
    });

    it('calls multiple listeners', async () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      service.onNotification(l1);
      service.onNotification(l2);
      await service.notifySystemEvent('msg');
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('does not crash when listener throws', async () => {
      service.onNotification(() => { throw new Error('listener crash'); });
      await expect(service.notifySystemEvent('msg')).resolves.not.toThrow();
    });
  });

  // ----------------------------------------
  // Individual notification types
  // ----------------------------------------
  describe('notification types', () => {
    it('notifyTradeExecuted sends type=trade', async () => {
      const received: Notification[] = [];
      service.onNotification(n => received.push(n));
      await service.notifyTradeExecuted('Q?', 'BUY_YES', 0.45, 50, 0.10, true);
      expect(received[0].type).toBe('trade');
    });

    it('notifyTradeWon sends type=win', async () => {
      const received: Notification[] = [];
      service.onNotification(n => received.push(n));
      await service.notifyTradeWon('Q?', 25);
      expect(received[0].type).toBe('win');
      expect(received[0].title).toContain('Vencedora');
    });

    it('notifyTradeLost sends type=loss', async () => {
      const received: Notification[] = [];
      service.onNotification(n => received.push(n));
      await service.notifyTradeLost('Q?', -10);
      expect(received[0].type).toBe('loss');
    });

    it('notifyRiskAlert sends type=risk', async () => {
      const received: Notification[] = [];
      service.onNotification(n => received.push(n));
      await service.notifyRiskAlert('circuit breaker activated');
      expect(received[0].type).toBe('risk');
      expect(received[0].message).toBe('circuit breaker activated');
    });

    it('notifyDailyReport sends type=report', async () => {
      const received: Notification[] = [];
      service.onNotification(n => received.push(n));
      await service.notifyDailyReport({ trades: 5, pnl: '10.00', winRate: '60.0' });
      expect(received[0].type).toBe('report');
    });
  });

  // ----------------------------------------
  // Discord integration
  // ----------------------------------------
  describe('Discord webhook', () => {
    it('does NOT call axios when discordWebhookUrl is not set', async () => {
      await service.notifySystemEvent('test');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('calls axios.post when discordWebhookUrl is configured', async () => {
      // Override config for this test
      const { config } = jest.requireMock('../src/engine/Config');
      config.discordWebhookUrl = 'https://discord.com/api/webhooks/test';

      const svc = new NotificationService();
      await svc.notifySystemEvent('test');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.objectContaining({ embeds: expect.any(Array) })
      );

      // Restore
      config.discordWebhookUrl = undefined;
    });

    it('does not crash when Discord webhook fails', async () => {
      const { config } = jest.requireMock('../src/engine/Config');
      config.discordWebhookUrl = 'https://discord.com/api/webhooks/test';
      mockedAxios.post.mockRejectedValueOnce(new Error('network error'));

      const svc = new NotificationService();
      await expect(svc.notifySystemEvent('test')).resolves.not.toThrow();

      config.discordWebhookUrl = undefined;
    });
  });

  // ----------------------------------------
  // Max recent notifications cap (100)
  // ----------------------------------------
  describe('recent notifications cap', () => {
    it('keeps at most 100 notifications', async () => {
      for (let i = 0; i < 110; i++) {
        await service.notifySystemEvent(`msg ${i}`);
      }
      expect(service.getRecent(200)).toHaveLength(100);
    });

    it('keeps the most recent ones when over cap', async () => {
      for (let i = 0; i < 110; i++) {
        await service.notifySystemEvent(`msg ${i}`);
      }
      const recent = service.getRecent(200);
      expect(recent[0].message).toBe('msg 10'); // oldest surviving
      expect(recent[recent.length - 1].message).toBe('msg 109'); // newest
    });
  });
});
