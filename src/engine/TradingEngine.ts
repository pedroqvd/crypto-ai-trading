// ================================================
// TRADING ENGINE — Autonomous Orchestrator
// The brain that runs the full trading loop
// ================================================

import { EventEmitter } from 'events';
import { config } from './Config';
import { logger } from '../utils/Logger';
import { TradeJournal, TradeRecord } from '../utils/TradeJournal';
import { GammaApiClient, ParsedMarket } from '../services/GammaApiClient';
import { ClobApiClient } from '../services/ClobApiClient';
import { NotificationService } from '../services/NotificationService';
import { ProbabilityEstimator } from '../analysis/ProbabilityEstimator';
import { EdgeCalculator, EdgeAnalysis } from '../analysis/EdgeCalculator';
import { KellyCalculator } from '../analysis/KellyCalculator';
import { RiskManager } from '../risk/RiskManager';

export interface EngineStatus {
  running: boolean;
  dryRun: boolean;
  uptime: number;
  cycleCount: number;
  marketsScanned: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  bankroll: number;
  totalPnl: number;
  lastScanAt: string;
}

export interface DecisionLog {
  timestamp: string;
  type: 'scan' | 'opportunity' | 'trade' | 'reject' | 'risk' | 'monitor' | 'system';
  message: string;
  data?: Record<string, unknown>;
}

export class TradingEngine extends EventEmitter {
  // Services
  private gammaApi: GammaApiClient;
  private clobApi: ClobApiClient;
  private notifications: NotificationService;
  private journal: TradeJournal;

  // Analysis
  private probEstimator: ProbabilityEstimator;
  private edgeCalc: EdgeCalculator;
  private kellyCalc: KellyCalculator;
  private riskManager: RiskManager;

  // State
  private running = false;
  private cycleCount = 0;
  private startTime = 0;
  private marketsScanned = 0;
  private opportunitiesFound = 0;
  private tradesExecuted = 0;
  private decisionLog: DecisionLog[] = [];
  private maxDecisionLog = 200;
  private activeMarketIds: Set<string> = new Set(); // Markets we already have positions in
  private lastDailyReportDate = '';                  // Track daily report sends

  constructor() {
    super();
    this.gammaApi = new GammaApiClient();
    this.clobApi = new ClobApiClient();
    this.notifications = new NotificationService();
    this.journal = new TradeJournal();
    this.probEstimator = new ProbabilityEstimator();
    this.edgeCalc = new EdgeCalculator();
    this.kellyCalc = new KellyCalculator();
    this.riskManager = new RiskManager(this.journal);

    // Track which markets we have positions in
    const openTrades = this.journal.getOpenTrades();
    openTrades.forEach(t => this.activeMarketIds.add(t.marketId));

    // Sync RiskManager bankroll with persisted P&L from previous sessions
    const historicalStats = this.journal.getStats();
    if (historicalStats.totalPnl !== 0) {
      this.riskManager.updateBankroll(config.bankroll + historicalStats.totalPnl);
    }
  }

  // ========================================
  // MAIN LOOP
  // ========================================
  async start(): Promise<void> {
    this.running = true;
    this.startTime = Date.now();

    const mode = config.dryRun ? '🏜️ DRY-RUN' : '⚡ LIVE';
    logger.info('Engine', `\n🚀 ========================================`);
    logger.info('Engine', `📊 POLYMARKET AI TRADER — ${mode} MODE`);
    logger.info('Engine', `💰 Bankroll: $${config.bankroll}`);
    logger.info('Engine', `📐 Kelly Fraction: ${(config.kellyFraction * 100).toFixed(0)}%`);
    logger.info('Engine', `🎯 Min Edge: ${(config.minEdge * 100).toFixed(0)}%`);
    logger.info('Engine', `⏱️ Scan Interval: ${config.scanIntervalMs / 1000}s`);
    logger.info('Engine', `🚀 ========================================\n`);

    // ── ITEM 7: PRIVATE_KEY validation before first cycle ──────────────
    // Fail early with a clear message instead of letting CLOB init fail silently
    if (!config.dryRun && !config.privateKey) {
      logger.error('Engine', '❌ PRIVATE_KEY não configurada! O modo LIVE requer uma chave privada válida.');
      logger.error('Engine', '   Configure PRIVATE_KEY no arquivo .env e reinicie o bot.');
      this.logDecision('system', 'Startup abortado: PRIVATE_KEY não configurada para modo LIVE');
      this.running = false;
      return;
    }

    this.logDecision('system', `Engine iniciado em modo ${mode}. Bankroll: $${config.bankroll}`);
    await this.notifications.notifySystemEvent(`Bot iniciado em modo ${mode}. Bankroll: $${config.bankroll}`);

    // Initialize CLOB client
    const clobReady = await this.clobApi.initialize();
    if (!clobReady && !config.dryRun) {
      logger.error('Engine', '❌ Falha ao inicializar CLOB client em modo LIVE. Abortando.');
      this.running = false;
      return;
    }

    // Main loop
    while (this.running) {
      try {
        await this.runCycle();
      } catch (err) {
        logger.error('Engine', 'Cycle error', err instanceof Error ? err.message : err);
        this.logDecision('system', `Erro no ciclo: ${err instanceof Error ? err.message : 'Unknown'}`);
      }

      // Wait for next cycle
      await this.sleep(config.scanIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    logger.info('Engine', '🛑 Engine stopped');
    this.logDecision('system', 'Engine parado');
  }

  // ========================================
  // SINGLE CYCLE
  // ========================================
  private async runCycle(): Promise<void> {
    this.cycleCount++;
    logger.info('Engine', `\n--- Ciclo #${this.cycleCount} ---`);

    // Step 1: Scan markets
    const markets = await this.scanMarkets();
    if (markets.length === 0) {
      this.logDecision('scan', 'Nenhum mercado encontrado. Tentando novamente no próximo ciclo.');
      return;
    }

    // Step 2: Filter — remove markets we already have positions in, and low-quality ones
    const filtered = this.filterMarkets(markets);

    // Step 3: Analyze — estimate probabilities and calculate edge
    const opportunities = await this.analyzeMarkets(filtered, markets);

    // Step 4: Execute — size and place trades for the best opportunities
    await this.executeOpportunities(opportunities);

    // Step 5: Monitor — check existing positions and stale orders
    await this.monitorPositions();

    // Step 6: Balance sync — every 10 cycles, reconcile on-chain balance with RiskManager
    if (this.cycleCount % 10 === 0) {
      await this.syncBalance();
    }

    // Step 7: Daily report — send once per day on first cycle of the day
    await this.maybeSendDailyReport();

    // Emit status update for dashboard
    this.emit('statusUpdate', this.getStatus());
    this.emit('decisionsUpdate', this.getRecentDecisions(20));
  }

  // ========================================
  // STEP 1: SCAN
  // ========================================
  private async scanMarkets(): Promise<ParsedMarket[]> {
    const markets = await this.gammaApi.getAllActiveMarkets(5);
    this.marketsScanned = markets.length;

    this.logDecision('scan', `Escaneou ${markets.length} mercados ativos do Polymarket.`);
    this.emit('scanComplete', { count: markets.length });

    return markets;
  }

  // ========================================
  // STEP 2: FILTER
  // ========================================
  private filterMarkets(markets: ParsedMarket[]): ParsedMarket[] {
    const filtered = markets.filter(m => {
      // Skip markets we already have positions in
      if (this.activeMarketIds.has(m.id)) return false;

      // ── ITEM 4: Skip negRisk markets — require different handling ──
      // negRisk markets have mutually exclusive outcomes and different
      // collateral rules; skip until proper support is implemented.
      if (m.negRisk) return false;

      // Minimum liquidity
      if (m.liquidity < config.minLiquidity) return false;

      // Minimum volume
      if (m.volume < config.minVolume) return false;

      // Must be accepting orders
      if (!m.acceptingOrders) return false;

      // Skip extreme prices (>97% or <3%) — almost no edge possible
      if (m.yesPrice > 0.97 || m.yesPrice < 0.03) return false;

      return true;
    });

    logger.debug('Engine', `Filtro: ${markets.length} → ${filtered.length} mercados qualificados`);
    return filtered;
  }

  // ========================================
  // STEP 3: ANALYZE
  // ========================================
  private async analyzeMarkets(filtered: ParsedMarket[], allMarkets: ParsedMarket[]): Promise<EdgeAnalysis[]> {
    const edgeAnalyses: EdgeAnalysis[] = [];

    for (const market of filtered) {
      // Estimate true probability
      const probEstimate = this.probEstimator.estimate(market, allMarkets);

      // Calculate edge and EV
      const edgeAnalysis = this.edgeCalc.calculateEdge(
        market.id,
        market.question,
        market.yesPrice,
        probEstimate.estimatedTrueProb,
        probEstimate.confidence,
        market.liquidity,
        market.yesTokenId,
        market.noTokenId,
        market.negRisk
      );

      edgeAnalyses.push(edgeAnalysis);
    }

    // Filter to tradeable opportunities
    const tradeable = this.edgeCalc.filterTradeableOpportunities(edgeAnalyses);
    this.opportunitiesFound = tradeable.length;

    if (tradeable.length > 0) {
      this.logDecision('opportunity',
        `Encontrou ${tradeable.length} oportunidades com edge ≥ ${(config.minEdge * 100).toFixed(0)}%.`,
        { opportunities: tradeable.map(t => ({
          question: t.question.substring(0, 60),
          edge: `${(t.edgePercent).toFixed(1)}%`,
          ev: `${(t.evPercent).toFixed(1)}%`,
          side: t.side,
        }))
      });
    } else {
      this.logDecision('scan', `Nenhuma oportunidade com edge ≥ ${(config.minEdge * 100).toFixed(0)}% encontrada.`);
    }

    return tradeable;
  }

  // ========================================
  // STEP 4: EXECUTE
  // ========================================
  private async executeOpportunities(opportunities: EdgeAnalysis[]): Promise<void> {
    // Take top 3 opportunities per cycle to avoid overtrading
    const toExecute = opportunities.slice(0, 3);

    for (const opp of toExecute) {
      // Use actual current bankroll from RiskManager (not initial config value)
      const currentBankroll = this.riskManager.getStatus().bankroll;

      // Calculate position size with Kelly (uses real bankroll and real liquidity)
      const kelly = this.kellyCalc.calculate(
        opp.estimatedTrueProb,
        opp.marketPrice,
        currentBankroll,
        opp.liquidity
      );

      if (kelly.finalStake < 1) {
        this.logDecision('reject', `Stake muito pequeno para "${opp.question.substring(0, 50)}...". Kelly: $${kelly.finalStake.toFixed(2)}`);
        continue;
      }

      // Risk check — detect circuit breaker activation to trigger notification
      const circuitBreakerWasActive = this.riskManager.getStatus().circuitBreaker;
      const riskCheck = this.riskManager.checkTrade(kelly.finalStake, opp.marketId);
      if (!riskCheck.allowed) {
        this.logDecision('risk', riskCheck.reason);

        // Notify if circuit breaker just activated (not already active before this check)
        if (!circuitBreakerWasActive && this.riskManager.getStatus().circuitBreaker) {
          await this.notifications.notifyRiskAlert(riskCheck.reason);
        }
        continue;
      }

      // Token IDs are already in EdgeAnalysis (set during market scan)
      const tokenId = opp.side === 'BUY_YES' ? opp.yesTokenId : opp.noTokenId;
      const price = opp.side === 'BUY_YES' ? opp.marketPrice : (1 - opp.marketPrice);
      const size = kelly.finalStake / price; // Number of shares

      // Execute!
      const result = await this.clobApi.placeLimitOrder(tokenId, 'BUY', price, size, opp.negRisk);

      if (result.success) {
        this.tradesExecuted++;

        // Record in journal
        const tradeRecord: TradeRecord = {
          id: result.orderId || `trade-${Date.now()}`,
          timestamp: new Date().toISOString(),
          marketId: opp.marketId,
          question: opp.question,
          side: opp.side as 'BUY_YES' | 'BUY_NO',
          entryPrice: price,
          size,
          stake: kelly.finalStake,
          edge: opp.edge,
          ev: opp.ev,
          kellyFraction: kelly.fractionalKelly,
          confidence: opp.confidence,
          reasoning: opp.reasoning,
          status: 'open',
          dryRun: config.dryRun,
        };

        this.journal.recordTrade(tradeRecord);
        this.riskManager.registerPosition(kelly.finalStake);
        this.activeMarketIds.add(opp.marketId);

        this.logDecision('trade',
          `✅ ${opp.side} "${opp.question.substring(0, 50)}..." @ $${price.toFixed(4)}, ` +
          `stake $${kelly.finalStake.toFixed(2)}, edge +${(opp.edgePercent).toFixed(1)}%`
        );

        await this.notifications.notifyTradeExecuted(
          opp.question, opp.side, price, kelly.finalStake, opp.edge, config.dryRun
        );

        // Emit for dashboard real-time update
        this.emit('tradeExecuted', tradeRecord);
      } else {
        this.logDecision('reject', `Falha ao executar trade: ${result.error}`);
      }
    }
  }

  // ========================================
  // STEP 5: MONITOR POSITIONS
  // ========================================
  private async monitorPositions(): Promise<void> {
    const openTrades = this.journal.getOpenTrades();
    if (openTrades.length === 0) return;

    logger.debug('Engine', `Monitorando ${openTrades.length} posições abertas`);

    // ── ITEM 3: Fetch open orders once for stale-order detection ────────
    // Only relevant in live mode; dry-run orders are always treated as filled.
    let openOrderIds: Set<string> = new Set();
    if (!config.dryRun) {
      const openOrders = await this.clobApi.getOpenOrders();
      for (const order of openOrders as Array<{ id?: string; orderID?: string }>) {
        const id = order.id || order.orderID;
        if (id) openOrderIds.add(id);
      }
    }

    const STALE_ORDER_MS = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const trade of openTrades) {
      // ── ITEM 3: Stale order cancellation ──────────────────────────────
      // If a trade has been 'open' for >24h and its order is still sitting
      // unfilled on the CLOB, cancel it to free capital.
      if (!config.dryRun && !trade.dryRun) {
        const tradeAge = now - new Date(trade.timestamp).getTime();
        if (tradeAge > STALE_ORDER_MS && openOrderIds.has(trade.id)) {
          logger.warn('Engine', `Ordem não preenchida há >24h: "${trade.question.substring(0, 40)}..." — cancelando`);
          const cancelled = await this.clobApi.cancelOrder(trade.id);
          if (cancelled) {
            this.journal.cancelTrade(trade.id);
            this.riskManager.closePosition(trade.stake, 0);
            this.activeMarketIds.delete(trade.marketId);
            this.logDecision('monitor',
              `🚫 Ordem stale cancelada: "${trade.question.substring(0, 50)}..." (>24h sem preenchimento)`
            );
          }
          continue; // Skip resolution check for cancelled orders
        }
      }

      // ── ITEM 2: Market resolution check ───────────────────────────────
      const market = await this.gammaApi.getMarketById(trade.marketId);

      if (market && market.closed) {
        // Determine resolution using precise price thresholds.
        // Polymarket resolves: YES winner → yesPrice → 1.0, noPrice → 0.0
        //                      NO winner  → yesPrice → 0.0, noPrice → 1.0
        const resolvedYes = market.yesPrice >= 0.99;
        const resolvedNo  = market.noPrice  >= 0.99;

        if (!resolvedYes && !resolvedNo) {
          // Market is closed but resolution prices haven't settled (data lag,
          // or INVALID/disputed resolution). Skip and retry next cycle.
          logger.warn('Engine',
            `Mercado fechado com preços ambíguos: "${trade.question.substring(0, 40)}..." ` +
            `yesPrice=${market.yesPrice.toFixed(3)} noPrice=${market.noPrice.toFixed(3)}`
          );
          this.logDecision('monitor',
            `⚠️ Resultado ambíguo para "${trade.question.substring(0, 50)}..." — aguardando resolução definitiva`
          );
          continue;
        }

        const won = (trade.side === 'BUY_YES' && resolvedYes) ||
                    (trade.side === 'BUY_NO'  && resolvedNo);

        const exitPrice = won ? 1.0 : 0.0;
        this.journal.resolveTrade(trade.id, won, exitPrice);

        const pnl = won ? (trade.size * 1) - trade.stake : -trade.stake;
        this.riskManager.closePosition(trade.stake, pnl);
        this.activeMarketIds.delete(trade.marketId);

        if (won) {
          this.logDecision('monitor', `🎯 GANHOU: "${trade.question.substring(0, 50)}..." → +$${pnl.toFixed(2)}`);
          await this.notifications.notifyTradeWon(trade.question, pnl);
        } else {
          this.logDecision('monitor', `💀 PERDEU: "${trade.question.substring(0, 50)}..." → -$${Math.abs(pnl).toFixed(2)}`);
          await this.notifications.notifyTradeLost(trade.question, pnl);
        }

        this.emit('tradeResolved', { trade, won, pnl });
      }
    }
  }

  // ========================================
  // ITEM 5: BALANCE SYNC
  // Reconcile on-chain USDC balance with RiskManager every 10 cycles.
  // Alerts on divergence > 5% so manual intervention can happen early.
  // ========================================
  private async syncBalance(): Promise<void> {
    logger.debug('Engine', 'Sincronizando saldo on-chain...');

    const onChainBalance = await this.clobApi.getBalance();
    const engineBalance  = this.riskManager.getStatus().bankroll;

    if (engineBalance <= 0) return; // Guard against division by zero at startup

    const divergencePct = Math.abs(onChainBalance - engineBalance) / engineBalance * 100;

    if (divergencePct > 5) {
      const msg =
        `Divergência de saldo detectada: on-chain $${onChainBalance.toFixed(2)} ` +
        `vs engine $${engineBalance.toFixed(2)} (${divergencePct.toFixed(1)}%)`;

      logger.warn('Engine', msg);
      this.logDecision('system', `⚠️ ${msg}`);
      await this.notifications.notifyRiskAlert(msg);
    } else {
      logger.debug('Engine',
        `Saldo sincronizado — on-chain $${onChainBalance.toFixed(2)}, ` +
        `engine $${engineBalance.toFixed(2)} (divergência ${divergencePct.toFixed(1)}%)`
      );
    }
  }

  // ========================================
  // STATE & STATUS
  // ========================================
  getStatus(): EngineStatus {
    const riskStatus = this.riskManager.getStatus();
    return {
      running: this.running,
      dryRun: config.dryRun,
      uptime: Date.now() - this.startTime,
      cycleCount: this.cycleCount,
      marketsScanned: this.marketsScanned,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      bankroll: riskStatus.bankroll,   // Use RiskManager — tracks real P&L
      totalPnl: riskStatus.bankroll - config.bankroll,
      lastScanAt: new Date().toISOString(),
    };
  }

  getRecentDecisions(count = 20): DecisionLog[] {
    return this.decisionLog.slice(-count);
  }

  getNotificationService(): NotificationService {
    return this.notifications;
  }

  getJournal(): TradeJournal {
    return this.journal;
  }

  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  // ========================================
  // DAILY REPORT
  // ========================================
  private async maybeSendDailyReport(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    if (today === this.lastDailyReportDate) return;

    this.lastDailyReportDate = today;
    const stats = this.journal.getStats();
    const riskStatus = this.riskManager.getStatus();

    await this.notifications.notifyDailyReport({
      date: today,
      trades: stats.totalTrades,
      openTrades: stats.openTrades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate.toFixed(1),
      pnl: stats.totalPnl.toFixed(2),
      bankroll: riskStatus.bankroll.toFixed(2),
      drawdownPct: riskStatus.drawdownPct.toFixed(1),
      avgEdge: (stats.avgEdge * 100).toFixed(1),
      bestTrade: stats.bestTrade.toFixed(2),
      worstTrade: stats.worstTrade.toFixed(2),
    });

    this.logDecision('system', `📊 Relatório diário enviado para ${today}`);
  }

  private logDecision(type: DecisionLog['type'], message: string, data?: Record<string, unknown>): void {
    const entry: DecisionLog = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
    };

    this.decisionLog.push(entry);
    if (this.decisionLog.length > this.maxDecisionLog) {
      this.decisionLog = this.decisionLog.slice(-this.maxDecisionLog);
    }

    this.emit('decision', entry);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
