// ================================================
// CRITICAL EVENT MONITOR — System health tracking
// ================================================

import { logger } from '../utils/Logger';

export type CriticalEventType =
  | 'emergency_stop'
  | 'circuit_breaker'
  | 'significant_loss'
  | 'trade_failure'
  | 'api_error'
  | 'balance_divergence'
  | 'high_drawdown'
  | 'rate_limit_hit';

export type EventSeverity = 'critical' | 'warning' | 'info';

export interface CriticalEvent {
  id: string;
  timestamp: string;
  type: CriticalEventType;
  severity: EventSeverity;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  resolved?: boolean;
}

export class CriticalEventMonitor {
  private events: CriticalEvent[] = [];
  private readonly MAX_EVENTS = 500;
  private eventCallbacks: Map<CriticalEventType, Array<(event: CriticalEvent) => void>> = new Map();

  /**
   * Record a critical event
   */
  recordEvent(
    type: CriticalEventType,
    severity: EventSeverity,
    title: string,
    message: string,
    data?: Record<string, unknown>
  ): CriticalEvent {
    const event: CriticalEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      type,
      severity,
      title,
      message,
      data,
      resolved: false,
    };

    this.events.push(event);

    // Keep only recent events
    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS);
    }

    // Log event
    const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    logger.warn('Monitor', `${icon} [${type.toUpperCase()}] ${title}: ${message}`);

    // Trigger callbacks
    const callbacks = this.eventCallbacks.get(type) || [];
    callbacks.forEach(cb => {
      try {
        cb(event);
      } catch (err) {
        logger.error('Monitor', 'Event callback error', err);
      }
    });

    return event;
  }

  /**
   * Record an emergency stop event
   */
  recordEmergencyStop(reason: string, data?: Record<string, unknown>): CriticalEvent {
    return this.recordEvent(
      'emergency_stop',
      'critical',
      'Emergency Stop Activated',
      reason,
      data
    );
  }

  /**
   * Record a circuit breaker event
   */
  recordCircuitBreaker(reason: string, data?: Record<string, unknown>): CriticalEvent {
    return this.recordEvent(
      'circuit_breaker',
      'critical',
      'Circuit Breaker Activated',
      reason,
      data
    );
  }

  /**
   * Record a significant loss
   */
  recordSignificantLoss(pnl: number, pnlPct: number): CriticalEvent {
    return this.recordEvent(
      'significant_loss',
      'warning',
      'Significant Loss Detected',
      `PnL: $${pnl.toFixed(2)} (${(pnlPct * 100).toFixed(1)}%)`,
      { pnl, pnlPct }
    );
  }

  /**
   * Record a trade failure
   */
  recordTradeFailure(marketId: string, error: string): CriticalEvent {
    return this.recordEvent(
      'trade_failure',
      'warning',
      'Trade Execution Failed',
      `Market ${marketId}: ${error}`,
      { marketId, error }
    );
  }

  /**
   * Record an API error
   */
  recordApiError(apiName: string, error: string): CriticalEvent {
    return this.recordEvent(
      'api_error',
      'warning',
      `${apiName} API Error`,
      error,
      { apiName }
    );
  }

  /**
   * Record balance divergence
   */
  recordBalanceDivergence(onChain: number, engine: number, divergencePct: number): CriticalEvent {
    return this.recordEvent(
      'balance_divergence',
      'warning',
      'Balance Divergence Detected',
      `On-chain: $${onChain.toFixed(2)}, Engine: $${engine.toFixed(2)} (${divergencePct.toFixed(1)}%)`,
      { onChain, engine, divergencePct }
    );
  }

  /**
   * Record high drawdown
   */
  recordHighDrawdown(drawdownPct: number, threshold: number): CriticalEvent {
    return this.recordEvent(
      'high_drawdown',
      'warning',
      'High Drawdown',
      `Drawdown: ${drawdownPct.toFixed(1)}% (threshold: ${threshold.toFixed(1)}%)`,
      { drawdownPct, threshold }
    );
  }

  /**
   * Record rate limit hit
   */
  recordRateLimitHit(apiName: string, retryAfterMs?: number): CriticalEvent {
    return this.recordEvent(
      'rate_limit_hit',
      'info',
      `${apiName} Rate Limit`,
      retryAfterMs ? `Retry after ${(retryAfterMs / 1000).toFixed(0)}s` : 'Rate limit exceeded',
      { apiName, retryAfterMs }
    );
  }

  /**
   * Mark event as resolved
   */
  resolveEvent(eventId: string): boolean {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.resolved = true;
      logger.info('Monitor', `✅ Event resolved: ${event.title}`);
      return true;
    }
    return false;
  }

  /**
   * Get recent critical events (filtered by type or severity)
   */
  getRecentEvents(
    options: {
      limit?: number;
      type?: CriticalEventType;
      severity?: EventSeverity;
      onlyUnresolved?: boolean;
    } = {}
  ): CriticalEvent[] {
    const { limit = 50, type, severity, onlyUnresolved = false } = options;

    let filtered = this.events;

    if (type) filtered = filtered.filter(e => e.type === type);
    if (severity) filtered = filtered.filter(e => e.severity === severity);
    if (onlyUnresolved) filtered = filtered.filter(e => !e.resolved);

    return filtered.slice(-limit);
  }

  /**
   * Get unresolved critical events
   */
  getUnresolvedCriticalEvents(): CriticalEvent[] {
    return this.getRecentEvents({
      severity: 'critical',
      onlyUnresolved: true,
      limit: 100,
    });
  }

  /**
   * Get statistics about recent events
   */
  getStatistics(windowHours = 24): {
    total: number;
    byType: Record<CriticalEventType, number>;
    bySeverity: Record<EventSeverity, number>;
    unresolved: number;
  } {
    const now = Date.now();
    const windowMs = windowHours * 3600000;

    const recent = this.events.filter(
      e => (now - new Date(e.timestamp).getTime()) <= windowMs
    );

    const stats = {
      total: recent.length,
      byType: {} as Record<CriticalEventType, number>,
      bySeverity: {} as Record<EventSeverity, number>,
      unresolved: recent.filter(e => !e.resolved).length,
    };

    recent.forEach(e => {
      stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
      stats.bySeverity[e.severity] = (stats.bySeverity[e.severity] || 0) + 1;
    });

    return stats;
  }

  /**
   * Register callback for specific event type
   */
  onEvent(type: CriticalEventType, callback: (event: CriticalEvent) => void): void {
    if (!this.eventCallbacks.has(type)) {
      this.eventCallbacks.set(type, []);
    }
    this.eventCallbacks.get(type)!.push(callback);
  }

  /**
   * Clear all events (for testing or reset)
   */
  clear(): void {
    this.events = [];
    logger.info('Monitor', 'Event history cleared');
  }
}
