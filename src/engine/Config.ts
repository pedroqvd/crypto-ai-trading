// ================================================
// CONFIG — Central Configuration
// ================================================

import 'dotenv/config';

export interface TradingConfig {
  privateKey: string;
  dryRun: boolean;
  bankroll: number;
  kellyFraction: number;
  minEdge: number;
  minLiquidity: number;
  minVolume: number;
  maxPositionPct: number;
  maxTotalExposurePct: number;
  exitPriceTarget: number;
  maxOrderSpreadPct: number;
  minOrderBookShares: number;
  scanIntervalMs: number;
  dashboardPort: number;
  discordWebhookUrl?: string;
  newsApiKey: string;
  newsRelevanceHours: number;
  correlationEnabled: boolean;
  claudeApiKey: string;
  claudeEnabled: boolean;
  claudeMaxCallsPerCycle: number;
  calibrationEnabled: boolean;
  backendUrl: string;
  allowedOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn';
}

export function loadConfig(): TradingConfig {
  return {
    privateKey: process.env.PRIVATE_KEY || '',
    dryRun: process.env.DRY_RUN !== 'false',
    bankroll: parseFloat(process.env.BANKROLL || '1000'),
    kellyFraction: parseFloat(process.env.KELLY_FRACTION || '0.25'),
    minEdge: parseFloat(process.env.MIN_EDGE || '0.03'),
    minLiquidity: parseFloat(process.env.MIN_LIQUIDITY || '5000'),
    minVolume: parseFloat(process.env.MIN_VOLUME || '10000'),
    maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || '0.05'),
    maxTotalExposurePct: parseFloat(process.env.MAX_TOTAL_EXPOSURE_PCT || '0.50'),
    exitPriceTarget: parseFloat(process.env.EXIT_PRICE_TARGET || '0.85'),
    maxOrderSpreadPct: parseFloat(process.env.MAX_ORDER_SPREAD_PCT || '0.03'),
    minOrderBookShares: parseFloat(process.env.MIN_ORDER_BOOK_SHARES || '5'),
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000'),
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    newsApiKey: process.env.NEWS_API_KEY || '',
    newsRelevanceHours: parseInt(process.env.NEWS_RELEVANCE_HOURS || '6'),
    correlationEnabled: process.env.CORRELATION_ENABLED !== 'false',
    claudeApiKey: process.env.CLAUDE_API_KEY || '',
    claudeEnabled: process.env.CLAUDE_ENABLED !== 'false',
    claudeMaxCallsPerCycle: parseInt(process.env.CLAUDE_MAX_CALLS_PER_CYCLE || '5'),
    calibrationEnabled: process.env.CALIBRATION_ENABLED !== 'false',
    backendUrl: (process.env.BACKEND_URL || '').replace(/\/$/, ''),
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : [],
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
  };
}

export const config = loadConfig();
