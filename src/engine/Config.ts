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

  // Timing
  scanIntervalMs: number;

  // Dashboard
  dashboardPort: number;

  // Notifications
  discordWebhookUrl?: string;

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

    // Timing
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000'),

    // Dashboard
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),

    // Notifications
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,

    // Logging
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
  };
}

export const config = loadConfig();
