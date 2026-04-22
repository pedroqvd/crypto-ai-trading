// ================================================
// ENSEMBLE WEIGHT TRACKER — Phase 4
// Learns which probability signals are most accurate
// and adjusts their weights over time.
//
// Each signal gets a multiplier (0.5x–2.0x) based on
// how often its direction matched the actual outcome.
// Persists to data/ensemble-weights.json.
// ================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/Logger';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

interface SignalRecord {
  adjustment: number; // + or - contribution from this signal
  won: boolean;       // whether the trade was profitable
}

interface SignalStats {
  n: number;
  correct: number; // times direction matched outcome
  weight: number;  // current multiplier applied to this signal
}

export type LearnedWeights = Record<string, number>;

const MAX_HISTORY = 100;
const MIN_SAMPLES = 15;
const WEIGHT_MIN = 0.4;
const WEIGHT_MAX = 2.0;
// Signals that are correct less than this fraction after MIN_SAMPLES have their history purged
const POISON_ACCURACY_THRESHOLD = 0.30;

export class EnsembleWeightTracker {
  private history: Record<string, SignalRecord[]> = {};
  private dataPath: string;
  private outcomesSinceLastPurge = 0;

  constructor(dataPath = path.join(process.cwd(), 'data', 'ensemble-weights.json')) {
    this.dataPath = dataPath;
    this.load();
  }

  /**
   * Resets history for any signal whose accuracy has fallen below
   * POISON_ACCURACY_THRESHOLD after accumulating at least MIN_SAMPLES.
   * Prevents a poisoned/broken signal from permanently depressing the ensemble.
   * Returns the names of purged signals.
   */
  purgeUnreliableSignals(): string[] {
    const purged: string[] = [];
    for (const [name, records] of Object.entries(this.history)) {
      if (records.length < MIN_SAMPLES) continue;
      const accuracy = records.filter(r => r.won).length / records.length;
      if (accuracy < POISON_ACCURACY_THRESHOLD) {
        delete this.history[name];
        purged.push(name);
        logger.warn('Ensemble', `Purged unreliable signal "${name}" (accuracy=${(accuracy * 100).toFixed(1)}% < ${(POISON_ACCURACY_THRESHOLD * 100).toFixed(0)}% over ${records.length} samples)`);
      }
    }
    if (purged.length > 0) this.save();
    return purged;
  }

  // Call once per resolved trade, with the signals that led to it
  recordOutcome(
    signals: Array<{ name: string; adjustment: number; weight: number }>,
    won: boolean,
    tradeSide: 'BUY_YES' | 'BUY_NO'
  ): void {
    for (const signal of signals) {
      if (!this.history[signal.name]) this.history[signal.name] = [];

      // Signal was "correct" if its direction aligned with the trade direction and outcome
      const signalBullish = signal.adjustment > 0;
      const tradeBullish = tradeSide === 'BUY_YES';
      const directionMatch = signalBullish === tradeBullish;
      const isCorrect = directionMatch ? won : !won;

      this.history[signal.name].push({ adjustment: signal.adjustment, won: isCorrect });
      if (this.history[signal.name].length > MAX_HISTORY) {
        this.history[signal.name] = this.history[signal.name].slice(-MAX_HISTORY);
      }
    }
    this.outcomesSinceLastPurge++;
    if (this.outcomesSinceLastPurge >= 50) {
      this.outcomesSinceLastPurge = 0;
      this.purgeUnreliableSignals();
    }
    this.save();
  }

  // Returns weight multipliers for each signal name (default 1.0 when not enough data)
  getLearnedWeights(): LearnedWeights {
    const weights: LearnedWeights = {};
    for (const [name, records] of Object.entries(this.history)) {
      if (records.length < MIN_SAMPLES) {
        weights[name] = 1.0;
        continue;
      }
      const correct = records.filter(r => r.won).length;
      const accuracy = correct / records.length;
      // Map accuracy 0→50% to weight 0.4→1.0; 50→100% to weight 1.0→2.0
      const rawWeight = accuracy <= 0.5
        ? WEIGHT_MIN + (accuracy / 0.5) * (1.0 - WEIGHT_MIN)
        : 1.0 + ((accuracy - 0.5) / 0.5) * (WEIGHT_MAX - 1.0);
      weights[name] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, rawWeight));
    }
    return weights;
  }

  getStats(): Array<{ name: string; n: number; accuracy: number; weight: number }> {
    return Object.entries(this.history).map(([name, records]) => {
      const correct = records.filter(r => r.won).length;
      const accuracy = records.length > 0 ? correct / records.length : 0;
      const weights = this.getLearnedWeights();
      return { name, n: records.length, accuracy, weight: weights[name] ?? 1.0 };
    }).sort((a, b) => b.n - a.n);
  }

  exportData(): object {
    return this.history;
  }

  importData(data: unknown): void {
    try {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid format');
      const raw = data as Record<string, unknown>;
      const validated: Record<string, SignalRecord[]> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (!Array.isArray(val)) throw new Error(`Signal "${key}" is not an array`);
        validated[key] = val.map((r, i) => {
          if (typeof r !== 'object' || r === null) throw new Error(`Signal "${key}"[${i}] is not an object`);
          const rec = r as Record<string, unknown>;
          if (typeof rec.adjustment !== 'number' || typeof rec.won !== 'boolean')
            throw new Error(`Signal "${key}"[${i}] missing required fields`);
          return { adjustment: rec.adjustment, won: rec.won };
        });
      }
      this.history = validated;
      this.save();
      logger.info('Ensemble', `✅ Import: ${Object.keys(this.history).length} signals carregados`);
    } catch (err) {
      throw new Error(`Ensemble import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private save(): void {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      const payload = JSON.stringify(this.history, null, 2);
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFile(this.dataPath, payload, err => {
        if (err) logger.warn('Ensemble', `Save failed: ${err.message}`);
      });
    }, 2000);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.dataPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      if (raw && typeof raw === 'object') {
        this.history = raw;
        const totalSignals = Object.keys(this.history).length;
        if (totalSignals > 0) logger.debug('Ensemble', `Loaded weights for ${totalSignals} signals`);
      }
    } catch (err) {
      logger.warn('Ensemble', `Load failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
