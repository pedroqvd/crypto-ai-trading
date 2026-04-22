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
  tradeMode: 'DIRECTIONAL' | 'MARKET_MAKER';
  // Exit strategy
  exitPriceTarget: number;
  stopLossPct: number;
  trailingStopActivation: number;
  trailingStopDistance: number;
  timeDecayHours: number;
  edgeReversalEnabled: boolean;
  momentumExitCycles: number;
  maxOrderSpreadPct: number;
  minOrderBookShares: number;
  scanIntervalMs: number;
  dashboardPort: number;
  telegramBotToken?: string;
  telegramChatId?: string;
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
    minEdge: parseFloat(process.env.MIN_EDGE || '0.01'),
    minLiquidity: parseFloat(process.env.MIN_LIQUIDITY || '5000'),
    minVolume: parseFloat(process.env.MIN_VOLUME || '10000'),
    maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || '0.05'),
    maxTotalExposurePct: parseFloat(process.env.MAX_TOTAL_EXPOSURE_PCT || '0.50'),
    tradeMode: 'DIRECTIONAL',
    exitPriceTarget: parseFloat(process.env.EXIT_PRICE_TARGET || '0.85'),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '0.40'),
    trailingStopActivation: parseFloat(process.env.TRAILING_STOP_ACTIVATION || '0.20'),
    trailingStopDistance: parseFloat(process.env.TRAILING_STOP_DISTANCE || '0.12'),
    timeDecayHours: parseFloat(process.env.TIME_DECAY_HOURS || '6'),
    edgeReversalEnabled: process.env.EDGE_REVERSAL_ENABLED !== 'false',
    momentumExitCycles: parseInt(process.env.MOMENTUM_EXIT_CYCLES || '3'),
    maxOrderSpreadPct: parseFloat(process.env.MAX_ORDER_SPREAD_PCT || '0.08'),
    minOrderBookShares: parseFloat(process.env.MIN_ORDER_BOOK_SHARES || '5'),
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000'),
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    newsApiKey: process.env.NEWS_API_KEY || '',
    newsRelevanceHours: parseInt(process.env.NEWS_RELEVANCE_HOURS || '6'),
    correlationEnabled: process.env.CORRELATION_ENABLED !== 'false',
    claudeApiKey: process.env.CLAUDE_API_KEY || '',
    claudeEnabled: process.env.CLAUDE_ENABLED === 'true',
    claudeMaxCallsPerCycle: parseInt(process.env.CLAUDE_MAX_CALLS_PER_CYCLE || '5'),
    calibrationEnabled: process.env.CALIBRATION_ENABLED !== 'false',
    backendUrl: (process.env.BACKEND_URL || '').replace(/\/$/, ''),
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
      : [],
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn') || 'info',
  };
}

function validateConfig(c: TradingConfig): TradingConfig {
  const warn = (field: string, val: number, min: number, max: number, clamped: number) =>
    console.warn(`⚠️  Config: ${field}=${val} fora do intervalo [${min}, ${max}] → usando ${clamped}`);

  const clamp = (val: number, min: number, max: number, field: string): number => {
    if (isNaN(val) || !isFinite(val)) { warn(field, val, min, max, min); return min; }
    if (val < min) { warn(field, val, min, max, min); return min; }
    if (val > max) { warn(field, val, min, max, max); return max; }
    return val;
  };

  return {
    ...c,
    bankroll:            clamp(c.bankroll,            1,    10_000_000, 'BANKROLL'),
    kellyFraction:       clamp(c.kellyFraction,       0.01, 1.0,        'KELLY_FRACTION'),
    minEdge:             clamp(c.minEdge,             0.001, 0.99,      'MIN_EDGE'),
    minLiquidity:        clamp(c.minLiquidity,        100,  10_000_000, 'MIN_LIQUIDITY'),
    minVolume:           clamp(c.minVolume,           100,  10_000_000, 'MIN_VOLUME'),
    maxPositionPct:      clamp(c.maxPositionPct,      0.001, 0.5,       'MAX_POSITION_PCT'),
    maxTotalExposurePct: clamp(c.maxTotalExposurePct, 0.01,  1.0,       'MAX_TOTAL_EXPOSURE_PCT'),
    exitPriceTarget:     clamp(c.exitPriceTarget,     0.5,   0.99,      'EXIT_PRICE_TARGET'),
    stopLossPct:         clamp(c.stopLossPct,         0.01,  0.99,      'STOP_LOSS_PCT'),
    trailingStopActivation: clamp(c.trailingStopActivation, 0.01, 0.99, 'TRAILING_STOP_ACTIVATION'),
    trailingStopDistance:   clamp(c.trailingStopDistance,   0.01, 0.5,  'TRAILING_STOP_DISTANCE'),
    timeDecayHours:      clamp(c.timeDecayHours,      1,    168,        'TIME_DECAY_HOURS'),
    scanIntervalMs:      clamp(c.scanIntervalMs,      10_000, 3_600_000, 'SCAN_INTERVAL_MS'),
    dashboardPort:       clamp(c.dashboardPort,       1024,  65535,     'DASHBOARD_PORT'),
    claudeMaxCallsPerCycle: clamp(c.claudeMaxCallsPerCycle, 1, 20,      'CLAUDE_MAX_CALLS_PER_CYCLE'),
  };
}

export const config = validateConfig(loadConfig());

// Startup safety check: block live trading without a wallet key
if (!config.dryRun && !config.privateKey) {
  console.error('\n❌ ERRO FATAL: DRY_RUN=false mas PRIVATE_KEY não está configurada.');
  console.error('   Configure PRIVATE_KEY ou defina DRY_RUN=true para simulação.\n');
  process.exit(1);
}
