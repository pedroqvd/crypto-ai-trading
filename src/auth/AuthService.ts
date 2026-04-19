// ================================================
// AUTH SERVICE — Email/Password + JWT Authentication
// Single-user system: credentials stored in .env
// ================================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/Logger';

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '24h'; // Session duration

export interface AuthConfig {
  email: string;
  passwordHash: string;
  jwtSecret: string;
}

export interface JwtPayload {
  email: string;
  iat: number;
  exp: number;
}

export class AuthService {
  private config: AuthConfig;
  private loginAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  constructor() {
    const email = process.env.AUTH_EMAIL;
    const passwordHash = process.env.AUTH_PASSWORD_HASH;
    const jwtSecret = process.env.JWT_SECRET;

    if (!email || !passwordHash || !jwtSecret) {
      logger.warn('Auth', '⚠️ Credenciais de autenticação não configuradas!');
      logger.warn('Auth', 'Execute: npx ts-node src/auth/setup.ts para configurar');
      logger.warn('Auth', 'O dashboard ficará BLOQUEADO até a configuração.');
    }

    this.config = {
      email: email || '',
      passwordHash: passwordHash || '',
      jwtSecret: jwtSecret || AuthService.loadOrCreateSecret(),
    };
  }

  /**
   * Check if auth is properly configured
   */
  isConfigured(): boolean {
    return !!(this.config.email && this.config.passwordHash && this.config.jwtSecret !== '');
  }

  /**
   * Authenticate user with email + password
   * Returns JWT token on success, null on failure
   */
  async login(email: string, password: string, ip: string = 'unknown'): Promise<string | null> {
    // Rate limiting — prevent brute force
    if (this.isRateLimited(ip)) {
      logger.warn('Auth', `🚫 Login bloqueado para IP ${ip} — muitas tentativas`);
      return null;
    }

    // Check if configured
    if (!this.isConfigured()) {
      logger.error('Auth', 'Tentativa de login mas credenciais não estão configuradas');
      return null;
    }

    // Validate email (case-insensitive)
    if (email.toLowerCase().trim() !== this.config.email.toLowerCase().trim()) {
      this.recordFailedAttempt(ip);
      logger.warn('Auth', `❌ Login falhou: email incorreto (${email})`);
      return null;
    }

    // Validate password
    const passwordValid = await bcrypt.compare(password, this.config.passwordHash);
    if (!passwordValid) {
      this.recordFailedAttempt(ip);
      logger.warn('Auth', `❌ Login falhou: senha incorreta para ${email}`);
      return null;
    }

    // Clear failed attempts on success
    this.loginAttempts.delete(ip);

    // Generate JWT
    const token = jwt.sign(
      { email: email.toLowerCase().trim() },
      this.config.jwtSecret,
      { expiresIn: TOKEN_EXPIRY }
    );

    logger.info('Auth', `✅ Login bem-sucedido: ${email}`);
    return token;
  }

  /**
   * Verify JWT token
   * Returns decoded payload or null if invalid
   */
  verifyToken(token: string): JwtPayload | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JwtPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Hash a password (used by setup script)
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Load persisted JWT secret from disk, or generate and save a new one.
   * Ensures sessions survive restarts when JWT_SECRET is not set in env.
   */
  private static loadOrCreateSecret(): string {
    const secretPath = path.join(process.cwd(), 'data', '.jwt-secret');
    try {
      if (fs.existsSync(secretPath)) {
        return fs.readFileSync(secretPath, 'utf-8').trim();
      }
      const dir = path.dirname(secretPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const secret = require('crypto').randomBytes(48).toString('hex');
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
      logger.info('Auth', '🔑 JWT secret gerado e salvo em data/.jwt-secret');
      return secret;
    } catch {
      // Fallback — in-memory only (sessions reset on restart)
      return require('crypto').randomBytes(48).toString('hex');
    }
  }

  // ========================================
  // RATE LIMITING
  // ========================================
  private isRateLimited(ip: string): boolean {
    const record = this.loginAttempts.get(ip);
    if (!record) return false;

    // Check if lockout has expired
    if (Date.now() - record.lastAttempt > this.LOCKOUT_DURATION_MS) {
      this.loginAttempts.delete(ip);
      return false;
    }

    return record.count >= this.MAX_ATTEMPTS;
  }

  private recordFailedAttempt(ip: string): void {
    const record = this.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    this.loginAttempts.set(ip, record);

    if (record.count >= this.MAX_ATTEMPTS) {
      logger.warn('Auth', `🔒 IP ${ip} bloqueado por ${this.LOCKOUT_DURATION_MS / 60000} minutos após ${record.count} tentativas`);
    }
  }
}
