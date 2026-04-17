// ================================================
// DASHBOARD SERVER — Secured with Authentication
// Express + Socket.IO (read-only, no trading controls)
// ================================================

import express from 'express';
import { createServer, Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import cors from 'cors';
import { config } from '../engine/Config';
import { TradingEngine } from '../engine/TradingEngine';
import { logger } from '../utils/Logger';
import { AuthService } from '../auth/AuthService';
import { createAuthMiddleware, verifySocketAuth } from '../auth/authMiddleware';

export class DashboardServer {
  private app: express.Application;
  private server: Server;
  private io: SocketIOServer;
  private authService: AuthService;

  constructor(private engine: TradingEngine) {
    this.app = express();
    this.server = createServer(this.app);

    // Allow any explicitly configured origins; fall back to wildcard
    const allowedOrigins = config.allowedOrigins.length > 0
      ? config.allowedOrigins
      : '*';

    this.io = new SocketIOServer(this.server, {
      cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
    });
    this.authService = new AuthService();

    this.setupMiddleware();
    this.setupAuthRoutes();
    this.setupProtectedRoutes();
    this.setupWebSocket();
    this.setupEngineEvents();
  }

  // ========================================
  // MIDDLEWARE
  // ========================================
  private setupMiddleware(): void {
    const allowedOriginsValue = config.allowedOrigins.length > 0
      ? config.allowedOrigins
      : '*';

    this.app.use(cors({ origin: allowedOriginsValue }));
    this.app.use(express.json());

    // Security headers
    this.app.use((req, res, next) => {
      // Build connect-src: allow self + ws/wss + backend URL when running split (Vercel + Fly.io)
      const extraConnect = config.backendUrl
        ? ` ${config.backendUrl} ${config.backendUrl.replace(/^http/, 'ws')}`
        : '';

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy',
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:${extraConnect}; img-src 'self' data:`);
      next();
    });

    // Auth middleware — blocks all routes except login
    this.app.use(createAuthMiddleware(this.authService));

    // Serve static files AFTER auth middleware
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  // ========================================
  // AUTH ROUTES (PUBLIC — before middleware)
  // ========================================
  private setupAuthRoutes(): void {
    // Public config endpoint — tells the frontend where the backend lives
    // when running split (Vercel frontend → Fly.io backend).
    // Empty string means same-origin (frontend served by the bot itself).
    this.app.get('/api/config', (req, res) => {
      res.json({ backendUrl: config.backendUrl });
    });

    // Login page
    this.app.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/login.html'));
    });

    // Login API
    this.app.post('/api/auth/login', async (req, res) => {
      const { email, password } = req.body;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';

      if (!email || !password) {
        res.status(400).json({ error: 'E-mail e senha são obrigatórios', code: 'INVALID_CREDENTIALS' });
        return;
      }

      if (!this.authService.isConfigured()) {
        res.status(503).json({
          error: 'Autenticação não configurada. Execute: npx ts-node src/auth/setup.ts',
          code: 'NOT_CONFIGURED'
        });
        return;
      }

      const token = await this.authService.login(email, password, ip);

      if (token) {
        res.json({ token, expiresIn: '24h' });
      } else {
        res.status(401).json({ error: 'Credenciais inválidas', code: 'INVALID_CREDENTIALS' });
      }
    });

    // Auth status check
    this.app.get('/api/auth/status', (req, res) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = this.authService.verifyToken(token);
        if (payload) {
          res.json({ authenticated: true, email: payload.email });
          return;
        }
      }
      res.json({ authenticated: false });
    });

    // Logout
    this.app.post('/api/auth/logout', (req, res) => {
      // Client clears the cookie; server doesn't need to do much
      // In production, you'd add the token to a blacklist
      res.json({ success: true });
    });
  }

  // ========================================
  // PROTECTED API ROUTES (require auth)
  // ========================================
  private setupProtectedRoutes(): void {
    // Engine status — NEVER exposes private key or sensitive data
    this.app.get('/api/status', (req, res) => {
      const status = this.engine.getStatus();
      res.json(status);
    });

    // Recent decisions
    this.app.get('/api/decisions', (req, res) => {
      const count = parseInt(req.query.count as string) || 50;
      res.json(this.engine.getRecentDecisions(count));
    });

    // Trade journal
    this.app.get('/api/trades', (req, res) => {
      const journal = this.engine.getJournal();
      res.json({
        stats: journal.getStats(),
        open: journal.getOpenTrades(),
        recent: journal.getRecentTrades(50),
      });
    });

    // Risk status
    this.app.get('/api/risk', (req, res) => {
      res.json(this.engine.getRiskManager().getStatus());
    });

    // Reset circuit breaker (manual override — auth protected)
    this.app.post('/api/risk/reset', (req, res) => {
      const riskManager = this.engine.getRiskManager();
      const status = riskManager.getStatus();

      if (!status.circuitBreaker) {
        res.status(400).json({ error: 'Circuit breaker não está ativo.' });
        return;
      }

      riskManager.resetCircuitBreaker();
      logger.warn('Dashboard', '⚠️ Circuit breaker resetado manualmente via dashboard');
      res.json({ success: true, message: 'Circuit breaker resetado. Trading reativado.' });
    });

    // Notifications
    this.app.get('/api/notifications', (req, res) => {
      const count = parseInt(req.query.count as string) || 50;
      res.json(this.engine.getNotificationService().getRecent(count));
    });

    // Health
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Bot control — stop
    this.app.post('/api/bot/stop', (req, res) => {
      if (!this.engine.isRunning()) {
        res.status(400).json({ error: 'Bot já está parado.' });
        return;
      }
      this.engine.stop();
      this.io.emit('statusUpdate', this.engine.getStatus());
      logger.warn('Dashboard', '🛑 Bot parado via dashboard');
      res.json({ success: true, message: 'Bot parado.' });
    });

    // Bot control — start
    this.app.post('/api/bot/start', (req, res) => {
      if (this.engine.isRunning()) {
        res.status(400).json({ error: 'Bot já está rodando.' });
        return;
      }
      this.engine.start().catch(err =>
        logger.error('Dashboard', `Erro ao iniciar engine: ${err.message}`)
      );
      logger.info('Dashboard', '▶️ Bot iniciado via dashboard');
      res.json({ success: true, message: 'Bot iniciando...' });
    });

    // Settings — read (never exposes private key)
    this.app.get('/api/settings', (req, res) => {
      res.json(this.engine.getPublicConfig());
    });

    // Settings — update
    this.app.post('/api/settings', (req, res) => {
      const allowed = [
        'dryRun', 'bankroll', 'kellyFraction', 'minEdge',
        'maxPositionPct', 'maxTotalExposurePct', 'scanIntervalMs',
        'exitPriceTarget', 'correlationEnabled', 'claudeEnabled',
        'discordWebhookUrl', 'privateKey', 'newsApiKey', 'claudeApiKey',
      ];
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      this.engine.updateConfig(updates as Parameters<typeof this.engine.updateConfig>[0]);
      this.io.emit('settingsUpdated', this.engine.getPublicConfig());
      res.json({ success: true });
    });

    // Serve dashboard (protected by auth middleware)
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    // ── BOT CONTROL ──────────────────────────────────────────────────────────
    this.app.post('/api/bot/stop', (req, res) => {
      this.engine.stop();
      const status = this.engine.getStatus();
      this.io.emit('statusUpdate', status);
      res.json({ success: true, running: false });
    });

    this.app.post('/api/bot/start', (req, res) => {
      if (this.engine.isRunning()) {
        res.status(400).json({ error: 'Bot já está rodando.' });
        return;
      }
      this.engine.start().catch((err) =>
        logger.error('Dashboard', 'Erro ao iniciar engine', err instanceof Error ? err.message : err)
      );
      res.json({ success: true, running: true });
    });

    // ── SETTINGS ─────────────────────────────────────────────────────────────
    this.app.get('/api/settings', (req, res) => {
      res.json(this.engine.getPublicConfig());
    });

    const ALLOWED_SETTING_KEYS = new Set([
      'dryRun', 'bankroll', 'scanIntervalMs', 'minEdge', 'kellyFraction',
      'maxPositionPct', 'exitPriceTarget', 'stopLossPct', 'trailingStopActivation',
      'trailingStopDistance', 'timeDecayHours', 'edgeReversalEnabled', 'momentumExitCycles',
      'maxTotalExposurePct', 'correlationEnabled', 'claudeEnabled', 'discordWebhookUrl',
      'privateKey', 'claudeApiKey', 'newsApiKey',
    ]);

    this.app.post('/api/settings', (req, res) => {
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (ALLOWED_SETTING_KEYS.has(key)) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'Nenhum campo válido enviado.' });
        return;
      }
      this.engine.updateConfig(updates as Parameters<typeof this.engine.updateConfig>[0]);
      const status = this.engine.getStatus();
      this.io.emit('statusUpdate', status);
      this.io.emit('settingsUpdated', this.engine.getPublicConfig());
      logger.info('Dashboard', `⚙️ Settings atualizadas via dashboard`);
      res.json({ success: true });
    });
  }

  // ========================================
  // WEBSOCKET — Secured with JWT
  // ========================================
  private setupWebSocket(): void {
    // Authenticate WebSocket connections
    this.io.use((socket, next) => {
      const isValid = verifySocketAuth(this.authService, socket.handshake);
      if (isValid) {
        next();
      } else {
        logger.warn('Dashboard', `🚫 WebSocket rejeitado: autenticação inválida (${socket.id})`);
        next(new Error('Autenticação necessária'));
      }
    });

    this.io.on('connection', (socket) => {
      logger.info('Dashboard', `👤 Dashboard autenticado conectado: ${socket.id}`);

      // Send initial state
      socket.emit('init', {
        status: this.engine.getStatus(),
        decisions: this.engine.getRecentDecisions(30),
        trades: {
          stats: this.engine.getJournal().getStats(),
          open: this.engine.getJournal().getOpenTrades(),
          recent: this.engine.getJournal().getRecentTrades(20),
        },
        risk: this.engine.getRiskManager().getStatus(),
        notifications: this.engine.getNotificationService().getRecent(20),
      });

      socket.on('disconnect', () => {
        logger.debug('Dashboard', `Dashboard client disconnected: ${socket.id}`);
      });
    });
  }

  // ========================================
  // ENGINE EVENT FORWARDING
  // ========================================
  private setupEngineEvents(): void {
    this.engine.on('statusUpdate', (status) => {
      this.io.emit('statusUpdate', status);
    });

    this.engine.on('decision', (decision) => {
      this.io.emit('decision', decision);
    });

    this.engine.on('tradeExecuted', (trade) => {
      this.io.emit('tradeExecuted', trade);
    });

    this.engine.on('tradeResolved', (data) => {
      this.io.emit('tradeResolved', data);
    });

    this.engine.on('scanComplete', (data) => {
      this.io.emit('scanComplete', data);
    });

    this.engine.getNotificationService().onNotification((notification) => {
      this.io.emit('notification', notification);
    });

    logger.onLog((entry) => {
      this.io.emit('log', entry);
    });
  }

  getExpressApp(): express.Application {
    return this.app;
  }

  // ========================================
  // START
  // ========================================
  start(): void {
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('Dashboard', `❌ Porta ${config.dashboardPort} já está em uso. Dashboard não iniciado.`);
      } else {
        logger.error('Dashboard', `❌ Erro ao iniciar servidor: ${err.message}`);
      }
      process.exit(1);
    });

    this.server.listen(config.dashboardPort, () => {
      logger.info('Dashboard', `\n🌐 Dashboard: http://localhost:${config.dashboardPort}`);
      logger.info('Dashboard', `🔐 Login: http://localhost:${config.dashboardPort}/login`);
      logger.info('Dashboard', `📡 WebSocket secured with JWT\n`);
    });
  }
}
