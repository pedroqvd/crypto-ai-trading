// ================================================
// HEALTH MONITOR — Proactive API liveness checks
// ================================================
//
// Pings GammaAPI and (if live) ClobAPI every CHECK_INTERVAL_MS.
// Emits alerts via the provided callback when an endpoint goes
// down or comes back up, so the trading engine can pause/resume.
// ================================================

import * as https from 'https';
import { logger } from '../utils/Logger';

const CHECK_INTERVAL_MS = 60_000;  // check every 60 s
const TIMEOUT_MS        = 10_000;  // probe timeout
const FAILURE_THRESHOLD = 2;       // consecutive failures before declared DOWN

export type HealthStatus = 'up' | 'down' | 'degraded';

export interface ApiHealth {
  name: string;
  status: HealthStatus;
  latencyMs: number | null;
  consecutiveFailures: number;
  lastChecked: Date;
  lastError: string | null;
}

export type HealthChangeCallback = (health: ApiHealth) => void;

interface ProbeTarget {
  name: string;
  hostname: string;
  path: string;
  expectedStatus?: number;
}

export class HealthMonitor {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private health: Map<string, ApiHealth> = new Map();
  private readonly targets: ProbeTarget[];
  private readonly onChange: HealthChangeCallback;

  constructor(liveMode: boolean, onChange: HealthChangeCallback) {
    this.onChange = onChange;
    this.targets = [
      { name: 'GammaAPI', hostname: 'gamma-api.polymarket.com', path: '/markets?limit=1', expectedStatus: 200 },
    ];
    if (liveMode) {
      this.targets.push(
        { name: 'ClobAPI', hostname: 'clob.polymarket.com', path: '/health', expectedStatus: 200 }
      );
    }
    for (const t of this.targets) {
      this.health.set(t.name, {
        name: t.name,
        status: 'up',
        latencyMs: null,
        consecutiveFailures: 0,
        lastChecked: new Date(),
        lastError: null,
      });
    }
  }

  start(): void {
    if (this.timerId) return;
    // Run an initial check immediately, then on interval
    this.checkAll();
    this.timerId = setInterval(() => this.checkAll(), CHECK_INTERVAL_MS);
    logger.info('HealthMonitor', `Started. Monitoring ${this.targets.map(t => t.name).join(', ')}`);
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  getHealth(): ApiHealth[] {
    return Array.from(this.health.values());
  }

  isAllUp(): boolean {
    return Array.from(this.health.values()).every(h => h.status === 'up');
  }

  private async checkAll(): Promise<void> {
    await Promise.all(this.targets.map(t => this.probe(t)));
  }

  private probe(target: ProbeTarget): Promise<void> {
    return new Promise(resolve => {
      const start = Date.now();
      const req = https.request(
        {
          hostname: target.hostname,
          path: target.path,
          method: 'GET',
          timeout: TIMEOUT_MS,
        },
        res => {
          res.resume(); // drain response body
          const latencyMs = Date.now() - start;
          const ok = !target.expectedStatus || res.statusCode === target.expectedStatus
            || (res.statusCode !== undefined && res.statusCode < 500);
          if (ok) {
            this.recordSuccess(target.name, latencyMs);
          } else {
            this.recordFailure(target.name, `HTTP ${res.statusCode}`);
          }
          resolve();
        }
      );
      req.on('error', err => { this.recordFailure(target.name, err.message); resolve(); });
      req.on('timeout', () => { req.destroy(); this.recordFailure(target.name, 'timeout'); resolve(); });
      req.end();
    });
  }

  private recordSuccess(name: string, latencyMs: number): void {
    const h = this.health.get(name)!;
    const wasDown = h.status !== 'up';
    h.status = 'up';
    h.latencyMs = latencyMs;
    h.consecutiveFailures = 0;
    h.lastChecked = new Date();
    h.lastError = null;
    if (wasDown) {
      logger.info('HealthMonitor', `✅ ${name} recovered (${latencyMs}ms)`);
      this.onChange(h);
    } else {
      logger.debug('HealthMonitor', `${name} OK (${latencyMs}ms)`);
    }
  }

  private recordFailure(name: string, error: string): void {
    const h = this.health.get(name)!;
    h.consecutiveFailures++;
    h.lastChecked = new Date();
    h.lastError = error;
    if (h.consecutiveFailures >= FAILURE_THRESHOLD) {
      const wasUp = h.status !== 'down';
      h.status = 'down';
      if (wasUp) {
        logger.error('HealthMonitor', `🔴 ${name} DOWN after ${h.consecutiveFailures} failures: ${error}`);
        this.onChange(h);
      }
    } else {
      h.status = 'degraded';
      logger.warn('HealthMonitor', `⚠️ ${name} probe failed (${h.consecutiveFailures}/${FAILURE_THRESHOLD}): ${error}`);
    }
  }
}
