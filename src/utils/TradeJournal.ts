// ================================================
// TRADE JOURNAL — Persistent trade history
// ================================================

import fs from 'fs';
import path from 'path';
import { logger } from './Logger';

export interface TradeRecord {
  id: string;
  timestamp: string;
  marketId: string;
  question: string;
  side: 'BUY_YES' | 'BUY_NO';
  entryPrice: number;
  size: number;
  stake: number;
  edge: number;
  ev: number;
  kellyFraction: number;
  confidence: number;
  reasoning: string;
  status: 'open' | 'won' | 'lost' | 'cancelled';
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

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.tradesFile = path.join(this.dataDir, 'trade_history.json');
    this.ensureDataDir();
    this.loadFromDisk();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
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
    try {
      fs.writeFileSync(this.tradesFile, JSON.stringify(this.trades, null, 2));
    } catch (err) {
      logger.error('TradeJournal', 'Failed to save trade history to disk');
    }
  }

  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);
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

    this.saveToDisk();
    logger.info('TradeJournal', `Trade resolved: ${trade.status} "${trade.question}" P&L: $${trade.pnl?.toFixed(2)}`);
  }

  cancelTrade(tradeId: string): void {
    const trade = this.trades.find(t => t.id === tradeId);
    if (!trade) return;

    trade.status = 'cancelled';
    trade.pnl = 0;
    trade.resolvedAt = new Date().toISOString();

    this.saveToDisk();
    logger.info('TradeJournal', `Trade cancelled: "${trade.question}"`);
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

    return {
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
  }
}
