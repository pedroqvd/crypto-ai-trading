// ================================================
// CONFIG — Central Configuration
// ================================================

import 'dotenv/config';
import { z } from 'zod';

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
  oracleBackendUrl: string;
  allowedOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn';
}

const configSchema = z.object({
  kellyFraction: z.number().min(0.01, 'Kelly deve estar entre 1% e 25%').max(0.25),
  minEdge: z.number().min(0.005, 'Edge mínimo deve ser ≥ 0.5%').max(0.5, 'Edge máximo deve ser ≤ 50%'),
  bankroll: z.number().positive('Bankroll deve ser > 0').max(500_000, 'Bankroll suspeito: >$500k'),
  maxPositionPct: z.number().min(0.001, 'Posição máxima deve ser ≥ 0.1%').max(0.2, 'Posição máxima deve ser ≤ 20%'),
  maxTotalExposurePct: z.number().min(0.01, 'Exposição máxima deve ser ≥ 1%').max(1.0, 'Exposição máxima deve ser ≤ 100%'),
  exitPriceTarget: z.number().min(0.5, 'Target de saída deve ser ≥ 50%').max(0.99, 'Target de saída deve ser ≤ 99%'),
});

export function loadConfig(): TradingConfig {
  const rawConfig = {
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
    oracleBackendUrl: (process.env.ORACLE_BACKEND_URL || '').replace(/\/$/, ''),
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : [],
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
  };

  // Validar parâmetros críticos de risco
  const validated = configSchema.safeParse(rawConfig);
  if (!validated.success) {
    throw new Error(`❌ Configuração inválida: ${validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }

  return rawConfig;
}

export const config = loadConfig();
