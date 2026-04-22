// ================================================
// INPUT VALIDATOR — Request payload validation
// ================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const validators = {
  // Validate operating mode (DIRECTIONAL or MARKET_MAKER)
  mode(value: unknown): 'DIRECTIONAL' | 'MARKET_MAKER' {
    const modes = ['DIRECTIONAL', 'MARKET_MAKER'];
    if (!modes.includes(value as string)) {
      throw new ValidationError(`Invalid mode. Must be one of: ${modes.join(', ')}`);
    }
    return value as 'DIRECTIONAL' | 'MARKET_MAKER';
  },

  // Validate positive number
  positiveNumber(value: unknown, field: string): number {
    const num = Number(value);
    if (isNaN(num) || num <= 0) {
      throw new ValidationError(`${field} must be a positive number. Got: ${value}`);
    }
    return num;
  },

  // Validate percentage (0-1)
  percentage(value: unknown, field: string): number {
    const num = Number(value);
    if (isNaN(num) || num < 0 || num > 1) {
      throw new ValidationError(`${field} must be between 0 and 1 (percentage). Got: ${value}`);
    }
    return num;
  },

  // Validate days (positive integer)
  days(value: unknown): number {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new ValidationError(`Days must be a non-negative integer. Got: ${value}`);
    }
    return num;
  },

  // Validate trade status
  tradeStatus(value: unknown): 'won' | 'lost' | 'open' | 'exited' {
    const statuses = ['won', 'lost', 'open', 'exited'];
    if (!statuses.includes(value as string)) {
      throw new ValidationError(`Invalid status. Must be one of: ${statuses.join(', ')}`);
    }
    return value as 'won' | 'lost' | 'open' | 'exited';
  },

  // Validate search string (max 100 chars, no injection attempts)
  search(value: unknown): string {
    if (typeof value !== 'string') {
      throw new ValidationError('Search must be a string');
    }
    if (value.length > 100) {
      throw new ValidationError('Search string too long (max 100 chars)');
    }
    // Basic SQL injection prevention
    if (/[;\'"\\]|--/.test(value)) {
      throw new ValidationError('Invalid characters in search string');
    }
    return value;
  },

  // Validate object for settings update
  settingsObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ValidationError('Settings must be a valid JSON object');
    }
    return value as Record<string, unknown>;
  },
};

export function validateSettingsUpdate(data: unknown): Record<string, unknown> {
  const obj = validators.settingsObject(data);
  const validated: Record<string, unknown> = {};

  const ALLOWED_KEYS = new Set([
    'dryRun', 'bankroll', 'kellyFraction', 'minEdge', 'maxPositionPct', 'maxTotalExposurePct',
    'scanIntervalMs', 'exitPriceTarget', 'stopLossPct', 'trailingStopActivation',
    'trailingStopDistance', 'timeDecayHours', 'edgeReversalEnabled', 'momentumExitCycles',
    'correlationEnabled', 'claudeEnabled', 'calibrationEnabled',
    'claudeApiKey', 'newsApiKey', 'privateKey', 'discordWebhookUrl',
  ]);

  for (const [key, val] of Object.entries(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ValidationError(`Unknown settings key: ${key}`);
    }

    // Skip empty strings for sensitive keys (user left field blank = keep existing)
    const sensitiveKeys = new Set(['privateKey', 'claudeApiKey', 'newsApiKey']);
    if (sensitiveKeys.has(key) && val === '') continue;

    switch (key) {
      case 'dryRun':
      case 'edgeReversalEnabled':
      case 'correlationEnabled':
      case 'claudeEnabled':
      case 'calibrationEnabled':
        if (typeof val !== 'boolean') throw new ValidationError(`${key} must be boolean`);
        validated[key] = val;
        break;

      case 'bankroll':
        validated[key] = validators.positiveNumber(val, 'bankroll');
        break;

      case 'scanIntervalMs':
        validated[key] = validators.positiveNumber(val, 'scanIntervalMs');
        break;

      case 'momentumExitCycles':
        validated[key] = validators.positiveNumber(val, 'momentumExitCycles');
        break;

      case 'timeDecayHours':
        validated[key] = validators.positiveNumber(val, 'timeDecayHours');
        break;

      case 'kellyFraction':
      case 'minEdge':
      case 'maxPositionPct':
      case 'maxTotalExposurePct':
      case 'exitPriceTarget':
      case 'stopLossPct':
      case 'trailingStopActivation':
      case 'trailingStopDistance':
        validated[key] = validators.percentage(val, key);
        break;

      case 'claudeApiKey':
      case 'newsApiKey':
      case 'privateKey':
      case 'discordWebhookUrl':
        // String fields — basic length check, no other validation
        if (typeof val !== 'string') throw new ValidationError(`${key} must be a string`);
        if (val.length > 512) throw new ValidationError(`${key} is too long`);
        validated[key] = val;
        break;
    }
  }

  return validated;
}

export function validateTradeHistoryFilters(query: Record<string, unknown>): {
  dryRun?: string;
  status?: string;
  days?: number;
  search?: string;
} {
  const validated: Record<string, unknown> = {};

  if (query.dryRun !== undefined) {
    if (typeof query.dryRun !== 'string' || !['true', 'false'].includes(query.dryRun)) {
      throw new ValidationError('dryRun must be "true" or "false"');
    }
    validated.dryRun = query.dryRun;
  }

  if (query.status !== undefined) {
    validated.status = validators.tradeStatus(query.status);
  }

  if (query.days !== undefined) {
    validated.days = validators.days(query.days);
  }

  if (query.search !== undefined) {
    validated.search = validators.search(query.search);
  }

  return validated as any;
}
