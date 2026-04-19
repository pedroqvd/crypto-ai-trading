// ================================================
// TESTS: authMiddleware
// ================================================

jest.mock('../src/engine/Config', () => ({
  config: { logLevel: 'warn' },
}));

import { createAuthMiddleware, verifySocketAuth } from '../src/auth/authMiddleware';
import { AuthService } from '../src/auth/AuthService';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const TEST_EMAIL = 'admin@test.com';
const TEST_SECRET = 'test-secret-for-middleware-tests!!';

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    path: '/',
    headers: {},
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response & { redirected?: string; statusCode?: number; jsonData?: unknown } {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn((url: string) => { res.redirected = url; }),
  };
  return res;
}

function makeAuthService(): AuthService {
  process.env.AUTH_EMAIL = TEST_EMAIL;
  process.env.AUTH_PASSWORD_HASH = '$2a$12$placeholder.hash.for.testing.only';
  process.env.JWT_SECRET = TEST_SECRET;
  return new AuthService();
}

function makeValidToken(email = TEST_EMAIL): string {
  return jwt.sign({ email }, TEST_SECRET, { expiresIn: '1h' });
}

describe('createAuthMiddleware', () => {
  let authService: AuthService;
  let middleware: ReturnType<typeof createAuthMiddleware>;
  let next: NextFunction;

  beforeEach(() => {
    authService = makeAuthService();
    middleware = createAuthMiddleware(authService);
    next = jest.fn();
  });

  afterEach(() => {
    delete process.env.AUTH_EMAIL;
    delete process.env.AUTH_PASSWORD_HASH;
    delete process.env.JWT_SECRET;
  });

  // ----------------------------------------
  // Public paths — always allowed
  // ----------------------------------------
  describe('public paths', () => {
    const publicRoutes = [
      '/login',
      '/login.html',
      '/api/auth/login',
      '/api/auth/status',
      '/css/login.css',
      '/js/login.js',
    ];

    publicRoutes.forEach(path => {
      it(`allows ${path} without token`, () => {
        const req = mockRequest({ path });
        const res = mockResponse();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });

    it('allows font files (.woff2) without token', () => {
      const req = mockRequest({ path: '/fonts/Inter.woff2' });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows favicon without token', () => {
      const req = mockRequest({ path: '/favicon.ico' });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ----------------------------------------
  // Missing token
  // ----------------------------------------
  describe('missing token', () => {
    it('allows GET / (public path — auth done client-side)', () => {
      const req = mockRequest({ path: '/' });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 JSON for protected API requests without token', () => {
      const req = mockRequest({ path: '/api/status' });
      const res = mockResponse();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------
  // Valid token
  // ----------------------------------------
  describe('valid token', () => {
    it('allows request with valid Bearer token', () => {
      const token = makeValidToken();
      const req = mockRequest({
        path: '/api/status',
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows request with valid cookie token', () => {
      const token = makeValidToken();
      const req = mockRequest({
        path: '/api/status',
        headers: { cookie: `auth_token=${token}` },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows request with token in query string', () => {
      const token = makeValidToken();
      const req = mockRequest({
        path: '/api/status',
        query: { token },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // ----------------------------------------
  // Invalid token
  // ----------------------------------------
  describe('invalid token', () => {
    it('allows GET / even with invalid token (public path)', () => {
      const req = mockRequest({
        path: '/',
        headers: { authorization: 'Bearer totally.invalid.token' },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 for invalid Bearer token on API request', () => {
      const req = mockRequest({
        path: '/api/trades',
        headers: { authorization: 'Bearer bad.token.here' },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for expired token on API request', () => {
      const expired = jwt.sign({ email: TEST_EMAIL }, TEST_SECRET, { expiresIn: -1 });
      const req = mockRequest({
        path: '/api/status',
        headers: { authorization: `Bearer ${expired}` },
      });
      const res = mockResponse();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});

// ----------------------------------------
// verifySocketAuth
// ----------------------------------------
describe('verifySocketAuth', () => {
  let authService: AuthService;

  beforeEach(() => {
    process.env.AUTH_EMAIL = TEST_EMAIL;
    process.env.AUTH_PASSWORD_HASH = '$2a$12$placeholder.hash.for.testing.only';
    process.env.JWT_SECRET = TEST_SECRET;
    authService = new AuthService();
  });

  afterEach(() => {
    delete process.env.AUTH_EMAIL;
    delete process.env.AUTH_PASSWORD_HASH;
    delete process.env.JWT_SECRET;
  });

  it('returns true for valid token in handshake.auth', () => {
    const token = makeValidToken();
    const handshake = { auth: { token }, query: {}, headers: {} };
    expect(verifySocketAuth(authService, handshake)).toBe(true);
  });

  it('returns true for valid token in handshake.query', () => {
    const token = makeValidToken();
    const handshake = { auth: {}, query: { token }, headers: {} };
    expect(verifySocketAuth(authService, handshake)).toBe(true);
  });

  it('returns true for valid token in cookie header', () => {
    const token = makeValidToken();
    const handshake = { auth: {}, query: {}, headers: { cookie: `auth_token=${token}` } };
    expect(verifySocketAuth(authService, handshake)).toBe(true);
  });

  it('returns false when no token provided', () => {
    const handshake = { auth: {}, query: {}, headers: {} };
    expect(verifySocketAuth(authService, handshake)).toBe(false);
  });

  it('returns false for invalid token', () => {
    const handshake = { auth: { token: 'invalid.jwt.token' }, query: {}, headers: {} };
    expect(verifySocketAuth(authService, handshake)).toBe(false);
  });
});
