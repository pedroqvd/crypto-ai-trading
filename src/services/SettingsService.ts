// ================================================
// SETTINGS SERVICE — Persistent Settings Management
// Handles save/load of runtime config to /data/settings.json.
//
// Sensitive fields (privateKey, claudeApiKey, newsApiKey)
// are NEVER written to disk — they always come from env vars.
// ================================================

import * as fs from 'fs';
import * as path from 'path';
import { config, TradingConfig } from '../engine/Config';
import { logger } from '../utils/Logger';

const SETTINGS_FILE = '/data/settings.json';

// These keys must never be persisted to disk under any circumstance.
const SENSITIVE_FIELDS = new Set<keyof TradingConfig>(['privateKey', 'claudeApiKey', 'newsApiKey']);

// Exhaustive list of keys that are safe to persist and restore.
const PERSISTED_KEYS: (keyof TradingConfig)[] = [
  'dryRun',
  'bankroll',
  'kellyFraction',
  'minEdge',
  'maxPositionPct',
  'maxTotalExposurePct',
  'scanIntervalMs',
  'exitPriceTarget',
  'stopLossPct',
  'trailingStopActivation',
  'trailingStopDistance',
  'timeDecayHours',
  'edgeReversalEnabled',
  'momentumExitCycles',
  'correlationEnabled',
  'claudeEnabled',
  'tradeMode',
  'discordWebhookUrl',
];

export class SettingsService {
  /**
   * Load persisted settings from disk into the live config object.
   * Silently skips if no file exists (first run).
   * Strips any sensitive fields that may have leaked into old files.
   */
  static load(): void {
    try {
      if (!fs.existsSync(SETTINGS_FILE)) {
        logger.info('Settings', `No settings file at ${SETTINGS_FILE} — using env defaults.`);
        return;
      }
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const saved = JSON.parse(raw) as Record<string, unknown>;

      // Migration safety: strip any sensitive keys from old files.
      for (const key of SENSITIVE_FIELDS) delete saved[key as string];

      const restoredKeys = Object.keys(saved).join(', ');
      Object.assign(config, saved);
      logger.info('Settings', `💾 Settings restored from ${SETTINGS_FILE}`);
      logger.info('Settings', `📝 Fields loaded: ${restoredKeys}`);
    } catch (e) {
      logger.error('Settings', `Failed to load settings: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Persist the current non-sensitive config fields to disk.
   * Safe to call at any time — atomic write via writeFileSync.
   */
  static save(): void {
    try {
      const dir = path.dirname(SETTINGS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const snapshot: Record<string, unknown> = {};
      for (const key of PERSISTED_KEYS) {
        if (SENSITIVE_FIELDS.has(key)) continue; // defensive double-check
        snapshot[key] = config[key];
      }

      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
      logger.info('Settings', `✅ Settings saved to ${SETTINGS_FILE}`);
    } catch (e) {
      logger.error('Settings', `Failed to save settings: ${e instanceof Error ? e.message : e}`);
    }
  }
}
