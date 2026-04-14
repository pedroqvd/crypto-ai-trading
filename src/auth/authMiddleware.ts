// ================================================
// AUTH MIDDLEWARE — Protect all routes & WebSocket
// ================================================

import { Request, Response, NextFunction } from 'express';
import { AuthService } from './AuthService';

/**
 * Express middleware that protects routes behind JWT authentication.
 * Allows only: /login, /api/auth/login, and static auth assets.
 */
export function createAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Always allow access to login page and auth endpoints
    const publicPaths = [
      '/login',
      '/login.html',
      '/api/auth/login',
      '/api/auth/status',
      '/css/login.css',
      '/js/login.js',
    ];

    if (publicPaths.some(p => req.path === p || req.path.startsWith(p))) {
      next();
      return;
    }

    // Allow font and favicon requests
    if (req.path.endsWith('.woff2') || req.path.endsWith('.woff') || req.path === '/favicon.ico') {
      next();
      return;
    }

    // Check for JWT token in multiple locations
    let token: string | null = null;

    // 1. Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // 2. Cookie
    if (!token && req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').map(c => c.trim());
      const authCookie = cookies.find(c => c.startsWith('auth_token='));
      if (authCookie) {
        token = authCookie.split('=')[1];
      }
    }

    // 3. Query parameter (for WebSocket upgrade)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    // Verify token
    if (!token) {
      // If requesting an API endpoint, return 401
      if (req.path.startsWith('/api/')) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      // Otherwise redirect to login
      res.redirect('/login');
      return;
    }

    const payload = authService.verifyToken(token);
    if (!payload) {
      if (req.path.startsWith('/api/')) {
        res.status(401).json({ error: 'Token inválido ou expirado' });
        return;
      }
      res.redirect('/login');
      return;
    }

    // Token valid — allow access
    (req as any).user = payload;
    next();
  };
}

/**
 * Verify WebSocket connection authentication
 */
export function verifySocketAuth(authService: AuthService, handshake: any): boolean {
  // Check auth from handshake
  const token = handshake.auth?.token ||
    handshake.query?.token ||
    extractCookieToken(handshake.headers?.cookie);

  if (!token) return false;

  const payload = authService.verifyToken(token);
  return payload !== null;
}

function extractCookieToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const authCookie = cookies.find(c => c.startsWith('auth_token='));
  return authCookie ? authCookie.split('=')[1] : null;
}
