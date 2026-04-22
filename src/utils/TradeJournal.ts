// ================================================
// TRADE JOURNAL — Persistent trade history
// ================================================

import fs from 'fs';
import path from 'path';
import { logger } from './Logger';

// Cap the number of closed trades kept in memory. Open trades are always retained.
const MAX_CLOSED_IN_MEMORY = 5_000;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface TradeRecord {
  id: string;
  timestamp: string;
  marketId: string;
  question: string;
  side: 'BUY_YES' | 'BUY_NO';
  entryPrice: number;
  currentPrice?: number;   // Live price from Polymarket (updated each monitor cycle, not persisted)
  size: number;
  stake: number;
  edge: number;
  ev: number;
  kellyFraction: number;
  confidence: number;
  reasoning: string;
  status: 'open' | 'won' | 'lost' | 'cancelled' | 'exited';
  exitPrice?: number;
  pnl?: number;
  resolvedAt?: string;
  dryRun: boolean;
}

export interface DailyReport {
  date: string;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgEdge: number;
  avgEv: number;
  bankrollStart: number;
  bankrollEnd: number;
}

export class TradeJournal {
  private trades: TradeRecord[] = [];
  private dataDir: string;
  private tradesFile: string;
  private persistenceAvailable = false;
  private statsCache: ReturnType<TradeJournal['getStats']> | null = null;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.tradesFile = path.join(this.dataDir, 'trade_history.json');
    this.persistenceAvailable = this.ensureDataDir();
    if (this.persistenceAvailable) this.loadFromDisk();
  }

  // Returns true when filesystem is writable (false on Vercel / read-only envs)
  private ensureDataDir(): boolean {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      return true;
    } catch {
      logger.warn('TradeJournal', 'Filesystem read-only — running in-memory mode (data will not persist)');
      return false;
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.tradesFile)) {
        const raw = fs.readFileSync(this.tradesFile, 'utf-8');
        this.trades = JSON.parse(raw);
        logger.info('TradeJournal', `Loaded ${this.trades.length} historical trades from disk`);
      }
    } catch (err) {
      logger.warn('TradeJournal', 'Failed to load trade history, starting fresh');
      this.trades = [];
    }
  }

  private saveToDisk(): void {
    if (!this.persistenceAvailable) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      const payload = JSON.stringify(this.trades, null, 2);
      fs.writeFile(this.tradesFile, payload, err => {
        if (err) logger.error('TradeJournal', 'Failed to save trade history to disk');
      });
    }, 1000);
  }

  private trimMemory(): void {
    const open = this.trades.filter(t => t.status === 'open');
    const closed = this.trades.filter(t => t.status !== 'open');
    if (closed.length > MAX_CLOSED_IN_MEMORY) {
      this.trades = [...closed.slice(-MAX_CLOSED_IN_MEMORY), ...open];
    }
  }

  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);
    this.trimMemory();
    this.statsCache = null;
    this.saveToDisk();
    logger.info('TradeJournal', `Trade recorded: ${trade.side} "${trade.question}" @ $${trade.stake.toFixed(2)}`);
  }

  resolveTrade(tradeId: string, won: boolean, exitPrice: number): void {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    trade.status = won ? 'won' : 'lost';
    trade.exitPrice = exitPrice;
    trade.pnl = won
      ? (trade.size * 1) - trade.stake  // Won: receive $1 per share minus stake
      : -trade.stake;                     // Lost: lose entire stake
    trade.resolvedAt = new Date().toISOString();

    this.statsCache = null;
    this.saveToDisk();
    logger.info('TradeJournal', `Trade resolved: ${trade.status} "${trade.question}" P&L: $${trade.pnl?.toFixed(2)}`);
  }

  cancelTrade(tradeId: string): void {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    trade.status = 'cancelled';
    trade.pnl = 0;
    trade.resolvedAt = new Date().toISOString();

    this.statsCache = null;
    this.saveToDisk();
    logger.info('TradeJournal', `Trade cancelled: "${trade.question}"`);
  }

  /**
   * Record an early exit (sell before resolution).
   * P&L is based on the spread between exit price and entry price.
   * exitPrice: the price at which we sold (e.g., 0.85 for a YES position)
   * pnl: (exitPrice - entryPrice) × size, pre-calculated by the caller
   */
  exitTrade(tradeId: string, exitPrice: number, pnl: number): void {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    trade.status = 'exited';
    trade.exitPrice = exitPrice;
    trade.pnl = pnl;
    trade.resolvedAt = new Date().toISOString();

    this.statsCache = null;
    this.saveToDisk();
    logger.info('TradeJournal',
      `Trade exited early: "${trade.question}" @ $${exitPrice.toFixed(4)}, P&L: $${pnl.toFixed(2)}`
    );
  }

  /**
   * Update the live market price for an open position.
   * This is in-memory only (not persisted to disk) — updated every monitor cycle.
   */
  updateCurrentPrice(tradeId: string, currentPrice: number): void {
    const trade = this.trades.find(t => t.id === tradeId);
    if (trade) trade.currentPrice = currentPrice;
  }

  getDailyReport(date: string, bankrollStart: number): DailyReport {
    const dayTrades = this.trades.filter(t => t.timestamp.startsWith(date));
    const closed = dayTrades.filter(t => t.status !== 'open');
    const wins = closed.filter(t => t.status === 'won').length;
    const losses = closed.filter(t => t.status === 'lost').length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgEdge = dayTrades.length > 0
      ? dayTrades.reduce((sum, t) => sum + t.edge, 0) / dayTrades.length
      : 0;
    const avgEv = dayTrades.length > 0
      ? dayTrades.reduce((sum, t) => sum + t.ev, 0) / dayTrades.length
      : 0;

    return {
      date,
      tradesCount: dayTrades.length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
      totalPnl,
      avgEdge,
      avgEv,
      bankrollStart,
      bankrollEnd: bankrollStart + totalPnl,
    };
  }

  getOpenTrades(): TradeRecord[] {
    return this.trades.filter(t => t.status === 'open');
  }

  getClosedTrades(): TradeRecord[] {
    return this.trades.filter(t => t.status !== 'open');
  }

  getAllTrades(): TradeRecord[] {
    return [...this.trades];
  }

  /**
   * Advanced lookup with filters
   */
  getFilteredTrades(filters: {
    search?: string;
    dryRun?: boolean;
    status?: string;
    days?: number;
  }): TradeRecord[] {
    let result = [...this.trades];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(t => 
        t.question.toLowerCase().includes(q) || 
        t.marketId.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    }

    if (filters.dryRun !== undefined) {
      result = result.filter(t => t.dryRun === filters.dryRun);
    }

    if (filters.status && filters.status !== 'all') {
      result = result.filter(t => t.status === filters.status);
    }

    if (filters.days && filters.days > 0) {
      const cutoff = Date.now() - (filters.days * 24 * 60 * 60 * 1000);
      result = result.filter(t => new Date(t.timestamp).getTime() >= cutoff);
    }

    // Sort by most recent first for history view
    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  getRecentTrades(count: number): TradeRecord[] {
    return this.trades.slice(-count);
  }

  getStats(): {
    totalTrades: number;
    openTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgEdge: number;
    avgEv: number;
    bestTrade: number;
    worstTrade: number;
  } {
    if (this.statsCache) return this.statsCache;
    const closed = this.getClosedTrades();
    const wins = closed.filter(t => t.status === 'won').length;
    const losses = closed.filter(t => t.status === 'lost').length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgEdge = this.trades.length > 0
      ? this.trades.reduce((sum, t) => sum + t.edge, 0) / this.trades.length
      : 0;
    const avgEv = this.trades.length > 0
      ? this.trades.reduce((sum, t) => sum + t.ev, 0) / this.trades.length
      : 0;
    const pnls = closed.map(t => t.pnl || 0);

    const result = {
      totalTrades: this.trades.length,
      openTrades: this.getOpenTrades().length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
      totalPnl,
      avgEdge,
      avgEv,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
    };
    this.statsCache = result;
    return result;
  }

  // Export all trades as CSV string
  toCSV(): string {
    const header = [
      'id', 'timestamp', 'marketId', 'question', 'side',
      'entryPrice', 'size', 'stake', 'edge', 'ev',
      'kellyFraction', 'confidence', 'status',
      'exitPrice', 'pnl', 'resolvedAt', 'dryRun',
    ].join(',');

    const rows = this.trades.map(t => [
      csvEscape(t.id),
      csvEscape(t.timestamp),
      csvEscape(t.marketId),
      csvEscape(t.question),
      t.side,
      t.entryPrice.toFixed(6),
      t.size.toFixed(4),
      t.stake.toFixed(4),
      t.edge.toFixed(6),
      t.ev.toFixed(6),
      t.kellyFraction.toFixed(6),
      t.confidence.toFixed(4),
      t.status,
      t.exitPrice !== undefined ? t.exitPrice.toFixed(6) : '',
      t.pnl !== undefined ? t.pnl.toFixed(4) : '',
      csvEscape(t.resolvedAt ?? ''),
      t.dryRun ? 'true' : 'false',
    ].join(','));

    return [header, ...rows].join('\n');
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
