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
import { validators, validateSettingsUpdate, validateTradeHistoryFilters, ValidationError } from '../utils/InputValidator';

export class DashboardServer {
  private app: express.Application;
  private server: Server;
  private io: SocketIOServer;
  private authService: AuthService;

  constructor(private engine: TradingEngine) {
    this.app = express();
    this.server = createServer(this.app);

    // Allow explicitly configured origins; default to '*' (since we use Bearer tokens, not cookies)
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

    const corsOptions = {
      origin: allowedOriginsValue,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
      optionsSuccessStatus: 204,
    };

    // Handle preflight requests for all routes
    this.app.options('*', cors(corsOptions));
    this.app.use(cors(corsOptions));
    this.app.use(express.json());

    // Security and cache headers
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
        `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:${extraConnect}; img-src 'self' data:`);
        
      // Ensure APIs are never cached by the browser
      if (req.path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
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
        const refreshToken = this.authService.generateRefreshToken(email);
        res.json({ token, refreshToken, expiresIn: '24h', refreshExpiresIn: '7d' });
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

    // Refresh token
    this.app.post('/api/auth/refresh', (req, res) => {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({ error: 'Refresh token é obrigatório', code: 'MISSING_TOKEN' });
        return;
      }

      const newToken = this.authService.refreshToken(refreshToken);

      if (newToken) {
        res.json({ token: newToken, expiresIn: '24h' });
      } else {
        res.status(401).json({ error: 'Refresh token inválido ou expirado', code: 'INVALID_REFRESH_TOKEN' });
      }
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

    // Advanced Trade History (Search & Filter)
    this.app.get('/api/trades/history', (req, res) => {
      try {
        const validated = validateTradeHistoryFilters(req.query as Record<string, unknown>);
        const journal = this.engine.getJournal();

        const filters = {
          search: validated.search,
          dryRun: validated.dryRun ? validated.dryRun === 'true' : undefined,
          status: validated.status as any,
          days: validated.days,
        };

        const trades = journal.getFilteredTrades(filters);
        res.json({
          count: trades.length,
          trades: trades,
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
        } else {
          logger.error('Dashboard', 'History error', err);
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Risk status
    this.app.get('/api/risk', (req, res) => {
      res.json(this.engine.getRiskManager().getStatus());
    });

    // Toggle market maker mode
    this.app.post('/api/settings/mode', (req, res) => {
      try {
        const mode = validators.mode(req.body.mode);
        this.engine.updateConfig({ tradeMode: mode });
        logger.info('Engine', `🚀 Config: tradeMode alterado para ${mode} via Dashboard.`);
        res.json({ success: true, mode });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
        } else {
          logger.error('Dashboard', 'Settings mode error', err);
          res.status(500).json({ error: 'Internal server error' });
        }
      }
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

    // Reset emergency stop (requires manual admin action — auth protected)
    this.app.post('/api/risk/emergency-reset', (req, res) => {
      const riskManager = this.engine.getRiskManager();
      const status = riskManager.getStatus();
      if (!status.emergencyStop) {
        res.status(400).json({ error: 'Emergency stop não está ativo.' });
        return;
      }
      riskManager.resetEmergencyStop();
      logger.warn('Dashboard', '⚠️ EMERGENCY STOP resetado manualmente via dashboard');
      res.json({ success: true, message: 'Emergency stop resetado. Monitore com atenção.' });
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

    // API health status (GammaAPI, ClobAPI liveness)
    this.app.get('/api/health/apis', (req, res) => {
      res.json(this.engine.getApiHealth());
    });

    // Calibration report (Brier score, per-category stats, bucket accuracy)
    this.app.get('/api/calibration', (req, res) => {
      res.json(this.engine.getCalibrationReport());
    });

    // Ensemble signal weights
    this.app.get('/api/ensemble', (req, res) => {
      res.json(this.engine.getEnsembleStats());
    });

    // Learning data export (calibration + ensemble) — backup before redeploy
    this.app.get('/api/learning/export', (req, res) => {
      const payload = {
        exportedAt: new Date().toISOString(),
        calibration: this.engine.exportCalibrationData(),
        ensemble: this.engine.exportEnsembleData(),
      };
      res.setHeader('Content-Disposition', 'attachment; filename="polymarket-learning.json"');
      res.setHeader('Content-Type', 'application/json');
      res.json(payload);
    });

    // Performance metrics (Sharpe, Calmar, equity curve, category breakdown)
    this.app.get('/api/performance', (req, res) => {
      res.json(this.engine.getPerformanceReport());
    });

    // Trade CSV export
    this.app.get('/api/trades/export', (req, res) => {
      const csv = this.engine.getJournal().toCSV();
      res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
      res.setHeader('Content-Type', 'text/csv');
      res.send(csv);
    });

    // Backup management
    this.app.get('/api/backups/list', (req, res) => {
      const backups = this.engine.getBackupService().getBackupList();
      res.json({ backups });
    });

    // Manually trigger a backup
    this.app.post('/api/backups/create', (req, res) => {
      const calibration = this.engine.exportCalibrationData();
      const ensemble = this.engine.exportEnsembleData();
      const trades = this.engine.getJournal().getAllTrades();

      this.engine.getBackupService().createBackup(calibration, ensemble, trades)
        .then(success => {
          if (success) {
            res.json({ success: true, message: 'Backup criado com sucesso' });
          } else {
            res.status(500).json({ error: 'Falha ao criar backup' });
          }
        })
        .catch(err => {
          logger.error('Dashboard', 'Backup creation error', err);
          res.status(500).json({ error: 'Internal server error' });
        });
    });

    // Delete a backup
    this.app.delete('/api/backups/:name', (req, res) => {
      const { name } = req.params;
      const success = this.engine.getBackupService().deleteBackup(name);
      if (success) {
        res.json({ success: true, message: 'Backup deletado com sucesso' });
      } else {
        res.status(404).json({ error: 'Backup não encontrado' });
      }
    });

    // Critical events monitoring
    this.app.get('/api/events/critical', (req, res) => {
      const monitor = this.engine.getCriticalEventMonitor();
      const limit = parseInt(req.query.limit as string) || 50;
      const type = req.query.type as string | undefined;
      const severity = req.query.severity as string | undefined;

      const events = monitor.getRecentEvents({
        limit,
        type: type as any,
        severity: severity as any,
      });

      res.json({ events });
    });

    // Critical events statistics
    this.app.get('/api/events/stats', (req, res) => {
      const monitor = this.engine.getCriticalEventMonitor();
      const windowHours = parseInt(req.query.window as string) || 24;
      const stats = monitor.getStatistics(windowHours);
      res.json(stats);
    });

    // Unresolved critical events
    this.app.get('/api/events/unresolved', (req, res) => {
      const monitor = this.engine.getCriticalEventMonitor();
      const events = monitor.getUnresolvedCriticalEvents();
      res.json({ events });
    });

    // Resolve an event
    this.app.post('/api/events/:id/resolve', (req, res) => {
      const { id } = req.params;
      const monitor = this.engine.getCriticalEventMonitor();
      const success = monitor.resolveEvent(id);

      if (success) {
        res.json({ success: true, message: 'Evento resolvido' });
      } else {
        res.status(404).json({ error: 'Evento não encontrado' });
      }
    });

    // Logging configuration
    this.app.get('/api/logging/config', (req, res) => {
      res.json({
        jsonOutput: logger.isJsonOutput(),
      });
    });

    this.app.post('/api/logging/json', (req, res) => {
      const { enabled } = req.body;
      logger.setJsonOutput(enabled === true);
      res.json({ success: true, jsonOutput: logger.isJsonOutput() });
    });

    // Learning data import — restore after redeploy
    this.app.post('/api/learning/import', (req, res) => {
      const body = req.body as { calibration?: unknown; ensemble?: unknown };
      if (!body || (!body.calibration && !body.ensemble)) {
        res.status(400).json({ error: 'Body deve conter "calibration" e/ou "ensemble".' });
        return;
      }
      const errors: string[] = [];
      if (body.calibration) {
        try { this.engine.importCalibrationData(body.calibration); }
        catch (e) { errors.push('calibration: ' + (e instanceof Error ? e.message : e)); }
      }
      if (body.ensemble) {
        try { this.engine.importEnsembleData(body.ensemble); }
        catch (e) { errors.push('ensemble: ' + (e instanceof Error ? e.message : e)); }
      }
      if (errors.length > 0) {
        res.status(422).json({ error: errors.join('; ') });
        return;
      }
      logger.info('Dashboard', '📥 Dados de aprendizado importados via dashboard');
      res.json({ success: true });
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
    const ALLOWED_SETTING_KEYS = new Set([
      'dryRun', 'bankroll', 'kellyFraction', 'minEdge',
      'maxPositionPct', 'maxTotalExposurePct', 'scanIntervalMs',
      'exitPriceTarget', 'stopLossPct', 'trailingStopActivation',
      'trailingStopDistance', 'timeDecayHours', 'edgeReversalEnabled', 'momentumExitCycles',
      'correlationEnabled', 'claudeEnabled', 'claudeApiKey', 'calibrationEnabled',
      'discordWebhookUrl', 'privateKey', 'newsApiKey',
    ]);

    this.app.post('/api/settings', (req, res) => {
      try {
        const validated = validateSettingsUpdate(req.body);
        const updates: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(validated)) {
          if (ALLOWED_SETTING_KEYS.has(key)) updates[key] = value;
        }
        if (Object.keys(updates).length === 0) {
          res.status(400).json({ error: 'Nenhum campo válido enviado.' });
          return;
        }
        this.engine.updateConfig(updates as Parameters<typeof this.engine.updateConfig>[0]);
        this.io.emit('statusUpdate', this.engine.getStatus());
        this.io.emit('settingsUpdated', this.engine.getPublicConfig());
        logger.info('Dashboard', '⚙️ Settings atualizadas via dashboard');
        res.json({ success: true });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: err.message });
        } else {
          logger.error('Dashboard', 'Settings error', err);
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Serve dashboard (protected by auth middleware)
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
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

    // Emit risk update whenever status changes (risk state is part of every cycle)
    this.engine.on('statusUpdate', () => {
      this.io.emit('riskUpdate', this.engine.getRiskManager().getStatus());
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
