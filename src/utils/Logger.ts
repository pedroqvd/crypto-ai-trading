// ================================================
// LOGGER — Structured logging with emojis
// ================================================

import { config } from '../engine/Config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '📊',
  warn: '⚠️',
  error: '❌',
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

class Logger {
  private minLevel: LogLevel;
  private listeners: Array<(entry: LogEntry) => void> = [];

  constructor() {
    this.minLevel = config.logLevel || 'info';
  }

  /**
   * Subscribe to log entries (used by dashboard for real-time feed)
   */
  onLog(listener: (entry: LogEntry) => void): void {
    this.listeners.push(listener);
  }

  removeListener(listener: (entry: LogEntry) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  debug(module: string, message: string, data?: unknown): void {
    this.log('debug', module, message, data);
  }

  info(module: string, message: string, data?: unknown): void {
    this.log('info', module, message, data);
  }

  warn(module: string, message: string, data?: unknown): void {
    this.log('warn', module, message, data);
  }

  error(module: string, message: string, data?: unknown): void {
    this.log('error', module, message, data);
  }

  private log(level: LogLevel, module: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
    };

    // Console output
    const icon = LEVEL_ICONS[level];
    const timeStr = new Date().toLocaleTimeString('pt-BR');
    const prefix = `${icon} [${timeStr}] [${module}]`;

    if (data) {
      console.log(`${prefix} ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 0) : data);
    } else {
      console.log(`${prefix} ${message}`);
    }

    // Notify listeners (dashboard)
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Don't let listener errors crash the logger
      }
    }
  }
}

export const logger = new Logger();
