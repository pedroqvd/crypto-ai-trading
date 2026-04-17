// ================================================
// CONFIG — Central Configuration
// ================================================

import 'dotenv/config';

export interface TradingConfig {
  // Wallet
  privateKey: string;

  // Mode
  dryRun: boolean;

  // Capital
  bankroll: number;

  // Strategy
  kellyFraction: number;
  minEdge: number;
  minLiquidity: number;
  minVolume: number;
  maxPositionPct: number;
  maxTotalExposurePct: number;

  // Position management
  exitPriceTarget: number;      // Sell early when position price reaches this (default 0.85)
  maxOrderSpreadPct: number;    // Skip trade if bid-ask spread exceeds this (default 0.03 = 3%)
  minOrderBookShares: number;   // Min shares available in order book to proceed (default 5)

  // Timing
  scanIntervalMs: number;

  // Dashboard
  dashboardPort: number;

  // Notifications
  discordWebhookUrl?: string;

  // News integration
  newsApiKey: string;           // newsapi.org key — optional, skipped if empty
  newsRelevanceHours: number;   // Consider news within last N hours (default 6)

  // Correlation analysis
  correlationEnabled: boolean;  // Detect pricing inconsistencies between related markets

  // Claude LLM analysis
  claudeApiKey: string;
  claudeEnabled: boolean;
  claudeMaxCallsPerCycle: number;

  // Bayesian calibration
  calibrationEnabled: boolean;

  // Remote integration
  backendUrl: string;        // Full URL of Fly.io backend when frontend runs on Vercel
  allowedOrigins: string[];  // CORS allowed origins (comma-separated in env)

  // Logging
  logLevel: 'debug' | 'info' | 'warn';
}

export function loadConfig(): TradingConfig {
  return {
    // Wallet
    privateKey: process.env.PRIVATE_KEY || '',

    // Mode — DRY_RUN by default for safety
    dryRun: process.env.DRY_RUN !== 'false',

    // Capital
    bankroll: parseFloat(process.env.BANKROLL || '1000'),

    // Strategy
    kellyFraction: parseFloat(process.env.KELLY_FRACTION || '0.25'),
    minEdge: parseFloat(process.env.MIN_EDGE || '0.03'),
    minLiquidity: parseFloat(process.env.MIN_LIQUIDITY || '5000'),
    minVolume: parseFloat(process.env.MIN_VOLUME || '10000'),
    maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || '0.05'),
    maxTotalExposurePct: parseFloat(process.env.MAX_TOTAL_EXPOSURE_PCT || '0.50'),

    // Position management
    exitPriceTarget: parseFloat(process.env.EXIT_PRICE_TARGET || '0.85'),
    maxOrderSpreadPct: parseFloat(process.env.MAX_ORDER_SPREAD_PCT || '0.03'),
    minOrderBookShares: parseFloat(process.env.MIN_ORDER_BOOK_SHARES || '5'),

    // Timing
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000'),

    // Dashboard
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),

    // Notifications
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,

    // News
    newsApiKey: process.env.NEWS_API_KEY || '',
    newsRelevanceHours: parseInt(process.env.NEWS_RELEVANCE_HOURS || '6'),

    // Correlation
    correlationEnabled: process.env.CORRELATION_ENABLED !== 'false',

    // Claude LLM analysis
    claudeApiKey: process.env.CLAUDE_API_KEY || '',
    claudeEnabled: process.env.CLAUDE_ENABLED !== 'false',
    claudeMaxCallsPerCycle: parseInt(process.env.CLAUDE_MAX_CALLS_PER_CYCLE || '5'),

    // Bayesian calibration
    calibrationEnabled: process.env.CALIBRATION_ENABLED !== 'false',

    // Remote integration
    backendUrl: (process.env.BACKEND_URL || '').replace(/\/$/, ''),
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : [],

    // Logging
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
  };
}

export const config = loadConfig();
