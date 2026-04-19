// ================================================
// PERFORMANCE METRICS
// Sharpe ratio, Calmar ratio, max drawdown,
// equity curve, and P&L attribution by category.
//
// Computes on closed trades only.
// Assumes initial bankroll from config at construction.
// ================================================

import { TradeRecord } from './TradeJournal';
import { config } from '../engine/Config';

export interface DrawdownPeriod {
  peak: number;           // bankroll at peak
  trough: number;         // bankroll at trough
  drawdownPct: number;    // (peak - trough) / peak * 100
  peakAt: string;         // ISO date of peak
  troughAt: string;       // ISO date of trough
  recoveredAt?: string;   // ISO date of recovery (if recovered)
  durationDays: number;   // trough date - peak date in days
}

export interface EquityPoint {
  date: string;           // ISO date (day)
  bankroll: number;
  pnl: number;            // cumulative P&L at this point
}

export interface CategoryStats {
  category: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgEdge: number;
}

export interface PerformanceReport {
  // Core ratios
  sharpeRatio: number;      // annualised, risk-free = 0
  calmarRatio: number;      // CAGR / maxDrawdown
  sortinoRatio: number;     // like Sharpe but only downside vol
  profitFactor: number;     // gross wins / gross losses

  // Drawdown
  maxDrawdownPct: number;
  maxDrawdown: DrawdownPeriod | null;
  currentDrawdownPct: number;

  // Returns
  totalReturn: number;      // absolute $
  totalReturnPct: number;   // % vs initial bankroll
  avgReturnPerTrade: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;       // avg return per trade

  // Time
  tradingDays: number;
  tradesPerDay: number;

  // Equity curve (daily resolution)
  equityCurve: EquityPoint[];

  // Category breakdown
  byCategory: CategoryStats[];
}

// ── CATEGORY DETECTION ────────────────────────────────────────────────────
// Infers category from question text for P&L attribution.
function detectCategory(question: string): string {
  const q = question.toLowerCase();

  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|sol)\b/.test(q))
    return 'Crypto';
  if (/\b(election|president|vote|senator|congress|governor|parliament|prime minister)\b/.test(q))
    return 'Politics';
  if (/\b(fed|interest rate|inflation|gdp|recession|economy|employment|cpi)\b/.test(q))
    return 'Economics';
  if (/\b(nba|nfl|nhl|mlb|soccer|football|basketball|tennis|golf|olympic)\b/.test(q))
    return 'Sports';
  if (/\b(ai|artificial intelligence|chatgpt|openai|google|microsoft|apple|meta|amazon)\b/.test(q))
    return 'Tech / AI';
  if (/\b(war|conflict|military|nato|russia|ukraine|china|taiwan|iran|north korea)\b/.test(q))
    return 'Geopolitics';
  if (/\b(climate|carbon|temperature|hurricane|earthquake|weather|environment)\b/.test(q))
    return 'Science / Climate';
  if (/\b(covid|vaccine|fda|drug|clinical trial|cancer|disease|pandemic)\b/.test(q))
    return 'Health / Bio';

  return 'Other';
}

export class PerformanceMetrics {
  // ========================================
  // MAIN: BUILD FULL REPORT
  // ========================================
  compute(trades: TradeRecord[], initialBankroll?: number): PerformanceReport {
    const startBankroll = initialBankroll ?? config.bankroll;
    const closed = trades
      .filter(t => t.status !== 'open' && t.pnl !== undefined && t.resolvedAt)
      .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime());

    if (closed.length === 0) {
      return this.emptyReport(startBankroll);
    }

    const equityCurve = this.buildEquityCurve(closed, startBankroll);
    const maxDD = this.computeMaxDrawdown(equityCurve);
    const dailyReturns = this.computeDailyReturns(equityCurve);

    const wins  = closed.filter(t => (t.pnl ?? 0) > 0);
    const losses = closed.filter(t => (t.pnl ?? 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

    const grossWins   = wins.reduce((s, t)   => s + (t.pnl ?? 0), 0);
    const grossLosses = losses.reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);

    const avgWin  = wins.length  > 0 ? grossWins / wins.length   : 0;
    const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const expectancy = closed.length > 0 ? totalPnl / closed.length : 0;

    // Trading days
    const firstDate = new Date(closed[0].resolvedAt!);
    const lastDate  = new Date(closed[closed.length - 1].resolvedAt!);
    const tradingDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / 86_400_000);

    // Annualisation factor (252 trading days)
    const annFactor = Math.sqrt(252 / Math.max(tradingDays, 1));

    const sharpe  = this.sharpe(dailyReturns, annFactor);
    const sortino = this.sortino(dailyReturns, annFactor);

    // CAGR approximation: (finalBankroll/startBankroll)^(365/days) - 1
    const finalBankroll = startBankroll + totalPnl;
    const cagr = Math.pow(Math.max(0.01, finalBankroll / startBankroll), 365 / tradingDays) - 1;
    const calmar = maxDD.drawdownPct > 0 ? cagr / (maxDD.drawdownPct / 100) : 0;

    // Current drawdown
    const currentBankroll = finalBankroll;
    const peakBankroll = Math.max(...equityCurve.map(p => p.bankroll));
    const currentDrawdownPct = peakBankroll > 0
      ? ((peakBankroll - currentBankroll) / peakBankroll) * 100
      : 0;

    return {
      sharpeRatio:    +sharpe.toFixed(3),
      calmarRatio:    +calmar.toFixed(3),
      sortinoRatio:   +sortino.toFixed(3),
      profitFactor:   grossLosses > 0 ? +(grossWins / grossLosses).toFixed(3) : 0,
      maxDrawdownPct: +maxDD.drawdownPct.toFixed(2),
      maxDrawdown:    maxDD.drawdownPct > 0 ? maxDD : null,
      currentDrawdownPct: +currentDrawdownPct.toFixed(2),
      totalReturn:    +totalPnl.toFixed(2),
      totalReturnPct: +((totalPnl / startBankroll) * 100).toFixed(2),
      avgReturnPerTrade: +expectancy.toFixed(2),
      winRate:        +winRate.toFixed(4),
      avgWin:         +avgWin.toFixed(2),
      avgLoss:        +avgLoss.toFixed(2),
      expectancy:     +expectancy.toFixed(2),
      tradingDays:    Math.round(tradingDays),
      tradesPerDay:   +(closed.length / tradingDays).toFixed(3),
      equityCurve,
      byCategory: this.categoryBreakdown(closed),
    };
  }

  // ========================================
  // EQUITY CURVE — daily resolution
  // ========================================
  private buildEquityCurve(closed: TradeRecord[], startBankroll: number): EquityPoint[] {
    const dayMap = new Map<string, number>();

    for (const t of closed) {
      const day = t.resolvedAt!.substring(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + (t.pnl ?? 0));
    }

    const days = [...dayMap.keys()].sort();
    let bankroll = startBankroll;
    let cumPnl = 0;
    const curve: EquityPoint[] = [{ date: days[0] ?? 'n/a', bankroll: startBankroll, pnl: 0 }];

    for (const day of days) {
      const dailyPnl = dayMap.get(day) ?? 0;
      bankroll += dailyPnl;
      cumPnl   += dailyPnl;
      curve.push({ date: day, bankroll: +bankroll.toFixed(2), pnl: +cumPnl.toFixed(2) });
    }

    return curve;
  }

  // ========================================
  // MAX DRAWDOWN
  // ========================================
  private computeMaxDrawdown(curve: EquityPoint[]): DrawdownPeriod {
    let peak = curve[0]?.bankroll ?? 0;
    let peakAt = curve[0]?.date ?? '';
    let maxDd: DrawdownPeriod = {
      peak: 0, trough: 0, drawdownPct: 0,
      peakAt: '', troughAt: '', durationDays: 0,
    };

    let troughBankroll = peak;
    let troughAt = peakAt;

    for (const point of curve) {
      if (point.bankroll >= peak) {
        peak = point.bankroll;
        peakAt = point.date;
        troughBankroll = peak;
        troughAt = peakAt;
      } else if (point.bankroll < troughBankroll) {
        troughBankroll = point.bankroll;
        troughAt = point.date;
        const dd = peak > 0 ? ((peak - troughBankroll) / peak) * 100 : 0;
        if (dd > maxDd.drawdownPct) {
          const durationMs = new Date(troughAt).getTime() - new Date(peakAt).getTime();
          maxDd = {
            peak,
            trough: troughBankroll,
            drawdownPct: +dd.toFixed(2),
            peakAt,
            troughAt,
            durationDays: Math.max(0, Math.round(durationMs / 86_400_000)),
          };
        }
      }
    }

    return maxDd;
  }

  // ========================================
  // DAILY RETURNS (% change)
  // ========================================
  private computeDailyReturns(curve: EquityPoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1].bankroll;
      if (prev > 0) returns.push((curve[i].bankroll - prev) / prev);
    }
    return returns;
  }

  // ========================================
  // SHARPE
  // ========================================
  private sharpe(returns: number[], annFactor: number): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * annFactor : 0;
  }

  // ========================================
  // SORTINO (downside deviation only)
  // ========================================
  private sortino(returns: number[], annFactor: number): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const downside = returns.filter(r => r < 0);
    if (downside.length === 0) return mean > 0 ? 99 : 0;
    const downsideVar = downside.reduce((s, r) => s + r ** 2, 0) / downside.length;
    const downsideStd = Math.sqrt(downsideVar);
    return downsideStd > 0 ? (mean / downsideStd) * annFactor : 0;
  }

  // ========================================
  // CATEGORY BREAKDOWN
  // ========================================
  private categoryBreakdown(closed: TradeRecord[]): CategoryStats[] {
    const map = new Map<string, TradeRecord[]>();

    for (const t of closed) {
      const cat = detectCategory(t.question);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    }

    return [...map.entries()]
      .map(([category, trades]) => {
        const wins   = trades.filter(t => (t.pnl ?? 0) > 0).length;
        const losses = trades.filter(t => (t.pnl ?? 0) <= 0).length;
        const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const avgEdge  = trades.reduce((s, t) => s + t.edge, 0) / trades.length;
        return {
          category,
          trades: trades.length,
          wins,
          losses,
          winRate:  +(trades.length > 0 ? wins / trades.length : 0).toFixed(4),
          totalPnl: +totalPnl.toFixed(2),
          avgEdge:  +avgEdge.toFixed(4),
        };
      })
      .sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl));
  }

  // ========================================
  // EMPTY REPORT (no closed trades yet)
  // ========================================
  private emptyReport(startBankroll: number): PerformanceReport {
    return {
      sharpeRatio: 0, calmarRatio: 0, sortinoRatio: 0, profitFactor: 0,
      maxDrawdownPct: 0, maxDrawdown: null, currentDrawdownPct: 0,
      totalReturn: 0, totalReturnPct: 0, avgReturnPerTrade: 0,
      winRate: 0, avgWin: 0, avgLoss: 0, expectancy: 0,
      tradingDays: 0, tradesPerDay: 0,
      equityCurve: [{ date: new Date().toISOString().substring(0, 10), bankroll: startBankroll, pnl: 0 }],
      byCategory: [],
    };
  }
}
