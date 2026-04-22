// ================================================
// TRADE EXECUTOR — Places orders and records trades
// ================================================

import { config } from './Config';
import { logger } from '../utils/Logger';
import { TradeJournal, TradeRecord } from '../utils/TradeJournal';
import { GammaApiClient } from '../services/GammaApiClient';
import { ClobApiClient } from '../services/ClobApiClient';
import { NotificationService } from '../services/NotificationService';
import { NewsApiClient } from '../services/NewsApiClient';
import { EdgeAnalysis } from '../analysis/EdgeCalculator';
import { KellyCalculator } from '../analysis/KellyCalculator';
import { RiskManager } from '../risk/RiskManager';
import { EdgeCalculator } from '../analysis/EdgeCalculator';
import { ClaudeAnalyzer } from '../services/ClaudeAnalyzer';
import { SignalSnapshot, LogDecisionFn, EmitFn, MAX_LIQUIDITY_IMPACT } from './engine-types';

export class TradeExecutor {
  private clobApi: ClobApiClient;
  private gammaApi: GammaApiClient;
  private newsApi: NewsApiClient;
  private claudeAnalyzer: ClaudeAnalyzer | null;
  private kellyCalc: KellyCalculator;
  private riskManager: RiskManager;
  private edgeCalc: EdgeCalculator;
  private journal: TradeJournal;
  private notifications: NotificationService;
  private activeMarketIds: Set<string>;
  private pendingSignals: Map<string, SignalSnapshot[]>;
  private tradeSignals: Map<string, SignalSnapshot[]>;
  private logDecision: LogDecisionFn;
  private emit: EmitFn;

  constructor(
    clobApi: ClobApiClient,
    gammaApi: GammaApiClient,
    newsApi: NewsApiClient,
    claudeAnalyzer: ClaudeAnalyzer | null,
    kellyCalc: KellyCalculator,
    riskManager: RiskManager,
    edgeCalc: EdgeCalculator,
    journal: TradeJournal,
    notifications: NotificationService,
    activeMarketIds: Set<string>,
    pendingSignals: Map<string, SignalSnapshot[]>,
    tradeSignals: Map<string, SignalSnapshot[]>,
    logDecision: LogDecisionFn,
    emit: EmitFn,
  ) {
    this.clobApi = clobApi;
    this.gammaApi = gammaApi;
    this.newsApi = newsApi;
    this.claudeAnalyzer = claudeAnalyzer;
    this.kellyCalc = kellyCalc;
    this.riskManager = riskManager;
    this.edgeCalc = edgeCalc;
    this.journal = journal;
    this.notifications = notifications;
    this.activeMarketIds = activeMarketIds;
    this.pendingSignals = pendingSignals;
    this.tradeSignals = tradeSignals;
    this.logDecision = logDecision;
    this.emit = emit;
  }

  setClaudeAnalyzer(analyzer: ClaudeAnalyzer | null): void {
    this.claudeAnalyzer = analyzer;
  }

  resetClaudeCycleCounter(): void {
    this.claudeAnalyzer?.resetCycleCounter();
  }

  async execute(opportunities: EdgeAnalysis[], cycleCount: number): Promise<number> {
    const toExecute = opportunities.slice(0, 3);
    let tradesExecuted = 0;

    for (const opp of toExecute) {
      const currentBankroll = this.riskManager.getStatus().bankroll;

      const kellyDiscount = this.riskManager.getCategoryKellyDiscount(opp.question);
      const dynamicMulti = this.riskManager.getDynamicKellyMultiplier();
      const kelly = this.kellyCalc.calculate(
        opp.estimatedTrueProb,
        opp.marketPrice,
        currentBankroll,
        opp.liquidity,
        kellyDiscount,
        dynamicMulti
      );

      if (kelly.finalStake < 1) {
        this.logDecision('reject', `Stake muito pequeno para "${opp.question.substring(0, 50)}...". Kelly: $${kelly.finalStake.toFixed(2)}`);
        continue;
      }

      // ── NEWS CHECK (per opportunity, rate-limit friendly) ────────────
      // Fetch news for this specific market before committing capital.
      // If news is present and aligned, confidence and stake get boosted
      // through re-estimation; if contradicted, skip.
      let newsHeadlines: string[] | undefined = undefined;

      if (config.newsApiKey) {
        const newsResult = await this.newsApi.searchRelevantNews(opp.question);

        if (newsResult.hasRecentNews) {
          newsHeadlines = newsResult.articles?.map(a => a.title).slice(0, 3);

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

      // ── CLAUDE AI CONFIRMATION ──────────────────────────────────────
      if (this.claudeAnalyzer && config.claudeEnabled) {
        const market = await this.gammaApi.getMarketById(opp.marketId);
        if (market) {
          const claudeEst = await this.claudeAnalyzer.estimateProbability(market, newsHeadlines);
          if (claudeEst && claudeEst.confidence >= 0.5) {
            const claudeBullish = claudeEst.probability > market.yesPrice;
            const ourBullish    = opp.side === 'BUY_YES';
            if (claudeBullish !== ourBullish) {
              this.logDecision('reject',
                `🤖 Claude discorda (est=${(claudeEst.probability * 100).toFixed(0)}%, conf=${(claudeEst.confidence * 100).toFixed(0)}%) ` +
                `para "${opp.question.substring(0, 40)}..." — skipping`
              );
              continue;
            }
            this.logDecision('opportunity',
              `🤖 Claude confirma: est=${(claudeEst.probability * 100).toFixed(0)}% — "${claudeEst.reasoning}"`
            );
          }
        }
      }

      // ── ORDER BOOK PRE-CHECK ─────────────────────────────────────────
      const tokenId = opp.side === 'BUY_YES' ? opp.yesTokenId : opp.noTokenId;
      const price   = opp.side === 'BUY_YES' ? opp.marketPrice : (1 - opp.marketPrice);
      let   size    = kelly.finalStake / price;

      // In DRY-RUN the order book is synthetic — depth checks are not meaningful.
      // Only apply real order book checks in LIVE mode.
      if (!config.dryRun) {
        const orderBook = await this.clobApi.getOrderBook(tokenId, price, opp.liquidity);
        if (orderBook) {
          // Skip if spread is too wide (expensive to trade)
          if (orderBook.spread > config.maxOrderSpreadPct) {
            logger.info('Engine', `[REJECT] Spread alto (${(orderBook.spread * 100).toFixed(1)}% > ${(config.maxOrderSpreadPct * 100).toFixed(0)}%) "${opp.question.substring(0, 50)}"`);
            this.logDecision('reject',
              `Spread muito alto (${(orderBook.spread * 100).toFixed(1)}% > ${(config.maxOrderSpreadPct * 100).toFixed(0)}%) ` +
              `para "${opp.question.substring(0, 40)}..."`
            );
            continue;
          }

          // Cap size to available depth (within maxOrderSpreadPct slippage, not 2%)
          const slippageTolerance = 1 + config.maxOrderSpreadPct;
          const availableShares = orderBook.asks
            .filter(a => a.price <= price * slippageTolerance)
            .reduce((sum, a) => sum + a.size, 0);

          if (availableShares < config.minOrderBookShares) {
            logger.info('Engine', `[REJECT] Profundidade insuficiente (${availableShares.toFixed(0)} shares < ${config.minOrderBookShares}) "${opp.question.substring(0, 50)}"`);
            this.logDecision('reject',
              `Profundidade insuficiente (${availableShares.toFixed(0)} shares < ${config.minOrderBookShares}) ` +
              `para "${opp.question.substring(0, 40)}..."`
            );
            continue;
          }

          // Don't take more than 40% of available liquidity to avoid price impact
          const maxSizeByDepth = availableShares * MAX_LIQUIDITY_IMPACT;
          if (size > maxSizeByDepth) {
            logger.info('Engine', `Reduzindo size de ${size.toFixed(0)} → ${maxSizeByDepth.toFixed(0)} shares (liquidez disponível)`);
            size = maxSizeByDepth;
          }
        }
      }

      // ── RISK CHECK ───────────────────────────────────────────────────
      const stakeAfterSizeAdjust = size * price;
      const circuitBreakerWasActive = this.riskManager.getStatus().circuitBreaker;
      const riskCheck = this.riskManager.checkTrade(stakeAfterSizeAdjust, opp.marketId, opp.question);

      if (!riskCheck.allowed) {
        this.logDecision('risk', riskCheck.reason);
        if (!circuitBreakerWasActive && this.riskManager.getStatus().circuitBreaker) {
          await this.notifications.notifyRiskAlert(riskCheck.reason);
        }
        continue;
      }

      // ── EXECUTE ──────────────────────────────────────────────────────
      let executionPrice = price;
      let modeTag = '';

      if (config.tradeMode === 'MARKET_MAKER') {
        const spreadAdvantage = 0.02; // Capturar 2% de spread em cima do preço justo
        executionPrice = Math.max(0.01, Math.min(0.99, opp.estimatedTrueProb - spreadAdvantage));
        modeTag = '[MM] ';
        this.logDecision('trade', `[MARKET MAKER] Provisão restrita de Liquidez: ordem Limit postada @ $${executionPrice.toFixed(4)}`);
      }

      const result = await this.clobApi.placeLimitOrder(tokenId, 'BUY', executionPrice, size, opp.negRisk);

      if (result.success) {
        tradesExecuted++;

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
        this.riskManager.registerPosition(finalStake, tradeRecord.id, opp.question);
        this.activeMarketIds.add(opp.marketId);
        // Store signal snapshot for ensemble learning at resolution
        const signals = this.pendingSignals.get(opp.marketId);
        if (signals) this.tradeSignals.set(tradeRecord.id, signals);

        this.logDecision('trade',
          `✅ ${modeTag}${opp.side} "${opp.question.substring(0, 50)}..." @ $${executionPrice.toFixed(4)}, ` +
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

    return tradesExecuted;
  }
}
