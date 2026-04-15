// ================================================
// TRADING ENGINE — Autonomous Orchestrator
// The brain that runs the full trading loop
// ================================================

import { EventEmitter } from 'events';
import { config } from './Config';
import { logger } from '../utils/Logger';
import { TradeJournal, TradeRecord } from '../utils/TradeJournal';
import { GammaApiClient, ParsedMarket, ParsedEvent } from '../services/GammaApiClient';
import { ClobApiClient } from '../services/ClobApiClient';
import { NotificationService } from '../services/NotificationService';
import { NewsApiClient } from '../services/NewsApiClient';
import { ProbabilityEstimator } from '../analysis/ProbabilityEstimator';
import { EdgeCalculator, EdgeAnalysis } from '../analysis/EdgeCalculator';
import { KellyCalculator } from '../analysis/KellyCalculator';
import { RiskManager } from '../risk/RiskManager';
import { CorrelationAnalyzer, CorrelationOpportunity } from '../analysis/CorrelationAnalyzer';

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
  private newsApi: NewsApiClient;
  private journal: TradeJournal;

  // Analysis
  private probEstimator: ProbabilityEstimator;
  private edgeCalc: EdgeCalculator;
  private kellyCalc: KellyCalculator;
  private riskManager: RiskManager;
  private correlationAnalyzer: CorrelationAnalyzer;

  // State
  private running = false;
  private cycleCount = 0;
  private startTime = 0;
  private marketsScanned = 0;
  private opportunitiesFound = 0;
  private tradesExecuted = 0;
  private decisionLog: DecisionLog[] = [];
  private maxDecisionLog = 200;
  private activeMarketIds: Set<string> = new Set();
  private lastDailyReportDate = '';

  constructor() {
    super();
    this.gammaApi = new GammaApiClient();
    this.clobApi = new ClobApiClient();
    this.notifications = new NotificationService();
    this.newsApi = new NewsApiClient();
    this.journal = new TradeJournal();
    this.probEstimator = new ProbabilityEstimator();
    this.edgeCalc = new EdgeCalculator();
    this.kellyCalc = new KellyCalculator();
    this.riskManager = new RiskManager(this.journal);
    this.correlationAnalyzer = new CorrelationAnalyzer();

    const openTrades = this.journal.getOpenTrades();
    openTrades.forEach(t => this.activeMarketIds.add(t.marketId));

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
    logger.info('Engine', `🚪 Exit Target: ${(config.exitPriceTarget * 100).toFixed(0)}%`);
    logger.info('Engine', `📰 News: ${config.newsApiKey ? `✅ (${config.newsRelevanceHours}h window)` : '❌ disabled'}`);
    logger.info('Engine', `🔗 Correlation: ${config.correlationEnabled ? '✅' : '❌'}`);
    logger.info('Engine', `⏱️ Scan Interval: ${config.scanIntervalMs / 1000}s`);
    logger.info('Engine', `🚀 ========================================\n`);

    // PRIVATE_KEY validation before first cycle
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

    while (this.running) {
      try {
        await this.runCycle();
      } catch (err) {
        logger.error('Engine', 'Cycle error', err instanceof Error ? err.message : err);
        this.logDecision('system', `Erro no ciclo: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
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

    // Step 1: Scan markets (flat list + events for correlation)
    const { markets, events } = await this.scanMarkets();
    if (markets.length === 0) {
      this.logDecision('scan', 'Nenhum mercado encontrado. Tentando novamente no próximo ciclo.');
      return;
    }

    // Step 2: Filter
    const filtered = this.filterMarkets(markets);

    // Step 3: Analyze — probability, edge, EV
    const opportunities = await this.analyzeMarkets(filtered, markets);

    // Step 4: Correlation analysis (runs in parallel with main pipeline)
    if (config.correlationEnabled && events.length > 0) {
      await this.runCorrelationAnalysis(events, markets);
    }

    // Step 5: Execute best opportunities
    await this.executeOpportunities(opportunities);

    // Step 6: Monitor existing positions (exit strategy + resolution)
    await this.monitorPositions(markets);

    // Step 7: Balance sync every 10 cycles
    if (this.cycleCount % 10 === 0) {
      await this.syncBalance();
    }

    // Step 8: Daily report
    await this.maybeSendDailyReport();

    this.emit('statusUpdate', this.getStatus());
    this.emit('decisionsUpdate', this.getRecentDecisions(20));
  }

  // ========================================
  // STEP 1: SCAN
  // ========================================
  private async scanMarkets(): Promise<{ markets: ParsedMarket[]; events: ParsedEvent[] }> {
    // Fetch flat market list and (optionally) event groups in parallel
    const [markets, events] = await Promise.all([
      this.gammaApi.getAllActiveMarkets(5),
      config.correlationEnabled
        ? this.gammaApi.getActiveEventsWithMarkets(3)
        : Promise.resolve<ParsedEvent[]>([]),
    ]);

    this.marketsScanned = markets.length;
    this.logDecision('scan', `Escaneou ${markets.length} mercados ativos${events.length > 0 ? `, ${events.length} eventos` : ''}.`);
    this.emit('scanComplete', { count: markets.length });

    return { markets, events };
  }

  // ========================================
  // STEP 2: FILTER
  // ========================================
  private filterMarkets(markets: ParsedMarket[]): ParsedMarket[] {
    const filtered = markets.filter(m => {
      if (this.activeMarketIds.has(m.id)) return false;
      if (m.negRisk) return false;
      if (m.liquidity < config.minLiquidity) return false;
      if (m.volume < config.minVolume) return false;
      if (!m.acceptingOrders) return false;
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
      // Note: news is fetched per-opportunity in executeOpportunities (rate limit friendly)
      const probEstimate = this.probEstimator.estimate(market, allMarkets);

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

    const tradeable = this.edgeCalc.filterTradeableOpportunities(edgeAnalyses);
    this.opportunitiesFound = tradeable.length;

    if (tradeable.length > 0) {
      this.logDecision('opportunity',
        `Encontrou ${tradeable.length} oportunidades com edge ≥ ${(config.minEdge * 100).toFixed(0)}%.`,
        {
          opportunities: tradeable.map(t => ({
            question: t.question.substring(0, 60),
            edge: `${(t.edgePercent).toFixed(1)}%`,
            ev: `${(t.evPercent).toFixed(1)}%`,
            side: t.side,
          })),
        }
      );
    } else {
      this.logDecision('scan', `Nenhuma oportunidade com edge ≥ ${(config.minEdge * 100).toFixed(0)}% encontrada.`);
    }

    return tradeable;
  }

  // ========================================
  // STEP 4: CORRELATION ANALYSIS
  // ========================================
  private async runCorrelationAnalysis(events: ParsedEvent[], allMarkets: ParsedMarket[]): Promise<void> {
    const inconsistencies = this.correlationAnalyzer.findInconsistencies(events);
    if (inconsistencies.length === 0) return;

    for (const opp of inconsistencies.slice(0, 3)) {
      const summary = this.correlationAnalyzer.summarize(opp);
      this.logDecision('opportunity', `🔗 CORRELAÇÃO: ${summary}`);

      // Boost the mispriced market if it's in our opportunity list
      // (the correlation signal acts as additional confirmation)
      logger.debug('Correlation', summary);
    }
  }

  // ========================================
  // STEP 5: EXECUTE
  // ========================================
  private async executeOpportunities(opportunities: EdgeAnalysis[]): Promise<void> {
    const toExecute = opportunities.slice(0, 3);

    for (const opp of toExecute) {
      const currentBankroll = this.riskManager.getStatus().bankroll;

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

      // ── NEWS CHECK (per opportunity, rate-limit friendly) ────────────
      // Fetch news for this specific market before committing capital.
      // If news is present and aligned, confidence and stake get boosted
      // through re-estimation; if contradicted, skip.
      if (config.newsApiKey) {
        const newsResult = await this.newsApi.searchRelevantNews(opp.question);

        if (newsResult.hasRecentNews) {
          // If sentiment contradicts our edge direction, skip
          const edgeBullish = opp.side === 'BUY_YES';
          if (
            (edgeBullish && newsResult.sentiment === 'bearish') ||
            (!edgeBullish && newsResult.sentiment === 'bullish')
          ) {
            this.logDecision('reject',
              `📰 Notícias contradizem a tese (${newsResult.sentiment}) para "${opp.question.substring(0, 40)}..." — skipping`
            );
            continue;
          }

          if (newsResult.sentiment) {
            this.logDecision('opportunity',
              `📰 Notícias confirmam (${newsResult.sentiment}) para "${opp.question.substring(0, 40)}..."`
            );
          }
        }
      }

      // ── ORDER BOOK PRE-CHECK ─────────────────────────────────────────
      const tokenId = opp.side === 'BUY_YES' ? opp.yesTokenId : opp.noTokenId;
      const price   = opp.side === 'BUY_YES' ? opp.marketPrice : (1 - opp.marketPrice);
      let   size    = kelly.finalStake / price;

      const orderBook = await this.clobApi.getOrderBook(tokenId);
      if (orderBook) {
        // Skip if spread is too wide (expensive to trade)
        if (orderBook.spread > config.maxOrderSpreadPct) {
          this.logDecision('reject',
            `Spread muito alto (${(orderBook.spread * 100).toFixed(1)}% > ${(config.maxOrderSpreadPct * 100).toFixed(0)}%) ` +
            `para "${opp.question.substring(0, 40)}..."`
          );
          continue;
        }

        // Cap size to available depth at our target price (avoid moving the market)
        const availableShares = orderBook.asks
          .filter(a => a.price <= price * 1.02) // within 2% slippage
          .reduce((sum, a) => sum + a.size, 0);

        if (availableShares < config.minOrderBookShares) {
          this.logDecision('reject',
            `Profundidade insuficiente (${availableShares.toFixed(0)} shares < ${config.minOrderBookShares}) ` +
            `para "${opp.question.substring(0, 40)}..."`
          );
          continue;
        }

        // Don't take more than 40% of available liquidity to avoid price impact
        const maxSizeByDepth = availableShares * 0.4;
        if (size > maxSizeByDepth) {
          logger.debug('Engine', `Reduzindo size de ${size.toFixed(0)} → ${maxSizeByDepth.toFixed(0)} shares (liquidez disponível)`);
          size = maxSizeByDepth;
        }
      }

      // ── RISK CHECK ───────────────────────────────────────────────────
      const stakeAfterSizeAdjust = size * price;
      const circuitBreakerWasActive = this.riskManager.getStatus().circuitBreaker;
      const riskCheck = this.riskManager.checkTrade(stakeAfterSizeAdjust, opp.marketId);

      if (!riskCheck.allowed) {
        this.logDecision('risk', riskCheck.reason);
        if (!circuitBreakerWasActive && this.riskManager.getStatus().circuitBreaker) {
          await this.notifications.notifyRiskAlert(riskCheck.reason);
        }
        continue;
      }

      // ── EXECUTE ──────────────────────────────────────────────────────
      const result = await this.clobApi.placeLimitOrder(tokenId, 'BUY', price, size, opp.negRisk);

      if (result.success) {
        this.tradesExecuted++;

        const finalStake = size * price;
        const tradeRecord: TradeRecord = {
          id: result.orderId || `trade-${Date.now()}`,
          timestamp: new Date().toISOString(),
          marketId: opp.marketId,
          question: opp.question,
          side: opp.side as 'BUY_YES' | 'BUY_NO',
          entryPrice: price,
          size,
          stake: finalStake,
          edge: opp.edge,
          ev: opp.ev,
          kellyFraction: kelly.fractionalKelly,
          confidence: opp.confidence,
          reasoning: opp.reasoning,
          status: 'open',
          dryRun: config.dryRun,
        };

        this.journal.recordTrade(tradeRecord);
        this.riskManager.registerPosition(finalStake);
        this.activeMarketIds.add(opp.marketId);

        this.logDecision('trade',
          `✅ ${opp.side} "${opp.question.substring(0, 50)}..." @ $${price.toFixed(4)}, ` +
          `stake $${finalStake.toFixed(2)}, edge +${(opp.edgePercent).toFixed(1)}%`
        );

        await this.notifications.notifyTradeExecuted(
          opp.question, opp.side, price, finalStake, opp.edge, config.dryRun
        );

        this.emit('tradeExecuted', tradeRecord);
      } else {
        this.logDecision('reject', `Falha ao executar trade: ${result.error}`);
      }
    }
  }

  // ========================================
  // STEP 6: MONITOR POSITIONS
  // — Early exit when price target is reached
  // — Stale order cancellation (>24h unfilled)
  // — Market resolution detection
  // ========================================
  private async monitorPositions(currentMarkets: ParsedMarket[] = []): Promise<void> {
    const openTrades = this.journal.getOpenTrades();
    if (openTrades.length === 0) return;

    logger.debug('Engine', `Monitorando ${openTrades.length} posições abertas`);

    // Build a quick-lookup map from the scan results to avoid extra API calls
    const marketMap = new Map(currentMarkets.map(m => [m.id, m]));

    // Fetch open CLOB orders once for stale-order detection (live only)
    let openOrderIds: Set<string> = new Set();
    if (!config.dryRun) {
      const openOrders = await this.clobApi.getOpenOrders();
      for (const order of openOrders as Array<{ id?: string; orderID?: string }>) {
        const id = order.id || order.orderID;
        if (id) openOrderIds.add(id);
      }
    }

    const STALE_ORDER_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const trade of openTrades) {
      // ── STALE ORDER CHECK ───────────────────────────────────────────
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
          continue;
        }
      }

      // Get current market state (prefer cached scan data, fallback to API)
      const market = marketMap.get(trade.marketId) || await this.gammaApi.getMarketById(trade.marketId);
      if (!market) continue;

      // ── EXIT STRATEGY ────────────────────────────────────────────────
      // Sell the position when it reaches the price target to lock in profit
      // before waiting for resolution (avoids late-stage reversals).
      if (!market.closed) {
        const currentSidePrice = trade.side === 'BUY_YES' ? market.yesPrice : market.noPrice;

        if (currentSidePrice >= config.exitPriceTarget) {
          const sellTokenId = trade.side === 'BUY_YES' ? market.yesTokenId : market.noTokenId;

          // In dry-run, simulate without calling CLOB
          let exitSuccess = false;
          if (config.dryRun || trade.dryRun) {
            exitSuccess = true;
            logger.info('Engine', `🏜️ [DRY-RUN] Exit simulado @ $${currentSidePrice.toFixed(3)}`);
          } else {
            const sellResult = await this.clobApi.placeLimitOrder(
              sellTokenId, 'SELL', currentSidePrice, trade.size, market.negRisk
            );
            exitSuccess = sellResult.success;
            if (!exitSuccess) {
              logger.warn('Engine', `Falha ao colocar ordem de venda para "${trade.question.substring(0, 40)}...": ${sellResult.error}`);
            }
          }

          if (exitSuccess) {
            const pnl = (currentSidePrice - trade.entryPrice) * trade.size;
            this.journal.exitTrade(trade.id, currentSidePrice, pnl);
            this.riskManager.closePosition(trade.stake, pnl);
            this.activeMarketIds.delete(trade.marketId);

            this.logDecision('monitor',
              `💰 SAÍDA ANTECIPADA: "${trade.question.substring(0, 50)}..." ` +
              `@ $${currentSidePrice.toFixed(3)} (target=${(config.exitPriceTarget * 100).toFixed(0)}%), ` +
              `P&L +$${pnl.toFixed(2)}`
            );

            await this.notifications.notifyTradeWon(trade.question, pnl);
            this.emit('tradeResolved', { trade, won: true, pnl });
          }

          continue; // Don't also check resolution for this trade
        }
      }

      // ── MARKET RESOLUTION ────────────────────────────────────────────
      if (market.closed) {
        const resolvedYes = market.yesPrice >= 0.99;
        const resolvedNo  = market.noPrice  >= 0.99;

        if (!resolvedYes && !resolvedNo) {
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
  // BALANCE SYNC (every 10 cycles)
  // ========================================
  private async syncBalance(): Promise<void> {
    logger.debug('Engine', 'Sincronizando saldo on-chain...');

    const onChainBalance = await this.clobApi.getBalance();
    const engineBalance  = this.riskManager.getStatus().bankroll;

    if (engineBalance <= 0) return;

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
      bankroll: riskStatus.bankroll,
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
