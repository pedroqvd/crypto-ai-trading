// ================================================
// TESTS: AuthService
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: { logLevel: 'warn' },
}));

import { AuthService } from '../src/auth/AuthService';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'SecurePass123!';
const TEST_SECRET = 'test-jwt-secret-32-chars-long!!';

async function makeConfiguredService(): Promise<AuthService> {
  const hash = await AuthService.hashPassword(TEST_PASSWORD);
  process.env.AUTH_EMAIL = TEST_EMAIL;
  process.env.AUTH_PASSWORD_HASH = hash;
  process.env.JWT_SECRET = TEST_SECRET;
  return new AuthService();
}

describe('AuthService', () => {
  afterEach(() => {
    delete process.env.AUTH_EMAIL;
    delete process.env.AUTH_PASSWORD_HASH;
    delete process.env.JWT_SECRET;
  });

  // ----------------------------------------
  // isConfigured
  // ----------------------------------------
  describe('isConfigured', () => {
    it('returns false when env vars missing', () => {
      const service = new AuthService();
      expect(service.isConfigured()).toBe(false);
    });

    it('returns true when all env vars are set', async () => {
      const service = await makeConfiguredService();
      expect(service.isConfigured()).toBe(true);
    });
  });

  // ----------------------------------------
  // login
  // ----------------------------------------
  describe('login', () => {
    it('returns JWT token on correct credentials', async () => {
      const service = await makeConfiguredService();
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, '127.0.0.1');
      expect(token).not.toBeNull();
      expect(typeof token).toBe('string');
    });

    it('returns null on wrong password', async () => {
      const service = await makeConfiguredService();
      const token = await service.login(TEST_EMAIL, 'wrongpassword', '127.0.0.1');
      expect(token).toBeNull();
    });

    it('returns null on wrong email', async () => {
      const service = await makeConfiguredService();
      const token = await service.login('wrong@example.com', TEST_PASSWORD, '127.0.0.1');
      expect(token).toBeNull();
    });

    it('is case-insensitive for email', async () => {
      const service = await makeConfiguredService();
      const token = await service.login(TEST_EMAIL.toUpperCase(), TEST_PASSWORD, '127.0.0.1');
      expect(token).not.toBeNull();
    });

    it('returns null when not configured', async () => {
      const service = new AuthService(); // no env vars
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, '127.0.0.1');
      expect(token).toBeNull();
    });

    it('JWT contains email in payload', async () => {
      const service = await makeConfiguredService();
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, '127.0.0.1');
      const decoded = jwt.verify(token!, TEST_SECRET) as { email: string };
      expect(decoded.email).toBe(TEST_EMAIL.toLowerCase());
    });
  });

  // ----------------------------------------
  // verifyToken
  // ----------------------------------------
  describe('verifyToken', () => {
    it('returns payload for valid token', async () => {
      const service = await makeConfiguredService();
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, '127.0.0.1');
      const payload = service.verifyToken(token!);
      expect(payload).not.toBeNull();
      expect(payload!.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it('returns null for invalid token', async () => {
      const service = await makeConfiguredService();
      const payload = service.verifyToken('invalid.token.here');
      expect(payload).toBeNull();
    });

    it('returns null for token signed with wrong secret', async () => {
      const service = await makeConfiguredService();
      const wrongToken = jwt.sign({ email: TEST_EMAIL }, 'wrong-secret', { expiresIn: '1h' });
      const payload = service.verifyToken(wrongToken);
      expect(payload).toBeNull();
    });

    it('returns null for expired token', async () => {
      const service = await makeConfiguredService();
      // Create token that expired 1 second ago
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL },
        TEST_SECRET,
        { expiresIn: -1 }
      );
      const payload = service.verifyToken(expiredToken);
      expect(payload).toBeNull();
    });
  });

  // ----------------------------------------
  // Rate limiting (brute force protection)
  // ----------------------------------------
  describe('rate limiting', () => {
    it('blocks IP after 5 failed attempts', async () => {
      const service = await makeConfiguredService();
      const ip = '192.168.1.100';

      for (let i = 0; i < 5; i++) {
        await service.login(TEST_EMAIL, 'wrongpass', ip);
      }

      // 6th attempt — should be blocked
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, ip);
      expect(token).toBeNull();
    });

    it('allows different IP after another IP is blocked', async () => {
      const service = await makeConfiguredService();
      const blockedIp = '10.0.0.1';
      const allowedIp = '10.0.0.2';

      for (let i = 0; i < 5; i++) {
        await service.login(TEST_EMAIL, 'wrongpass', blockedIp);
      }

      // Different IP should still work
      const token = await service.login(TEST_EMAIL, TEST_PASSWORD, allowedIp);
      expect(token).not.toBeNull();
    });

    it('clears failed attempts on successful login', async () => {
      const service = await makeConfiguredService();
      const ip = '192.168.1.200';

      // 3 failures, then success
      for (let i = 0; i < 3; i++) {
        await service.login(TEST_EMAIL, 'wrongpass', ip);
      }
      await service.login(TEST_EMAIL, TEST_PASSWORD, ip); // success — clears attempts

      // Subsequent 5 failures should block again (not 2 more)
      for (let i = 0; i < 5; i++) {
        await service.login(TEST_EMAIL, 'wrongpass', ip);
      }
      const blocked = await service.login(TEST_EMAIL, TEST_PASSWORD, ip);
      expect(blocked).toBeNull();
    });
  });

  // ----------------------------------------
  // hashPassword (static)
  // ----------------------------------------
  describe('hashPassword', () => {
    it('produces a bcrypt hash', async () => {
      const hash = await AuthService.hashPassword('mypassword');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it('hash verifies correctly', async () => {
      const hash = await AuthService.hashPassword('mypassword');
      const valid = await bcrypt.compare('mypassword', hash);
      expect(valid).toBe(true);
    });

    it('different calls produce different salts', async () => {
      const hash1 = await AuthService.hashPassword('same');
      const hash2 = await AuthService.hashPassword('same');
      expect(hash1).not.toBe(hash2);
    });
  });
});
