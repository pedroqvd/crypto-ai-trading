// ================================================
// POSITION MONITOR — Monitors open positions, handles exits and resolution
// ================================================

import { config } from './Config';
import { logger } from '../utils/Logger';
import { TradeJournal } from '../utils/TradeJournal';
import { GammaApiClient, ParsedMarket } from '../services/GammaApiClient';
import { ClobApiClient } from '../services/ClobApiClient';
import { NotificationService } from '../services/NotificationService';
import { EdgeCalculator } from '../analysis/EdgeCalculator';
import { RiskManager } from '../risk/RiskManager';
import { BayesianCalibrator } from '../analysis/BayesianCalibrator';
import { EnsembleWeightTracker } from '../analysis/EnsembleWeightTracker';
import { ConsensusClient } from '../services/ConsensusClient';
import {
  SignalSnapshot,
  PositionTrackState,
  LogDecisionFn,
  EmitFn,
  STALE_ORDER_MS,
  FORCED_EXIT_AFTER_MS,
  POLYMARKET_TAKER_FEE,
} from './engine-types';

export class PositionMonitor {
  private clobApi: ClobApiClient;
  private gammaApi: GammaApiClient;
  private riskManager: RiskManager;
  private calibrator: BayesianCalibrator;
  private ensembleTracker: EnsembleWeightTracker;
  private journal: TradeJournal;
  private notifications: NotificationService;
  private edgeCalc: EdgeCalculator;
  private consensusClient: ConsensusClient;
  private activeMarketIds: Set<string>;
  private positionState: Map<string, PositionTrackState>;
  private tradeSignals: Map<string, SignalSnapshot[]>;
  private logDecision: LogDecisionFn;
  private emit: EmitFn;

  constructor(
    clobApi: ClobApiClient,
    gammaApi: GammaApiClient,
    riskManager: RiskManager,
    calibrator: BayesianCalibrator,
    ensembleTracker: EnsembleWeightTracker,
    journal: TradeJournal,
    notifications: NotificationService,
    edgeCalc: EdgeCalculator,
    consensusClient: ConsensusClient,
    activeMarketIds: Set<string>,
    positionState: Map<string, PositionTrackState>,
    tradeSignals: Map<string, SignalSnapshot[]>,
    logDecision: LogDecisionFn,
    emit: EmitFn,
  ) {
    this.clobApi = clobApi;
    this.gammaApi = gammaApi;
    this.riskManager = riskManager;
    this.calibrator = calibrator;
    this.ensembleTracker = ensembleTracker;
    this.journal = journal;
    this.notifications = notifications;
    this.edgeCalc = edgeCalc;
    this.consensusClient = consensusClient;
    this.activeMarketIds = activeMarketIds;
    this.positionState = positionState;
    this.tradeSignals = tradeSignals;
    this.logDecision = logDecision;
    this.emit = emit;
  }

  async monitor(currentMarkets: ParsedMarket[] = []): Promise<void> {
    const openTrades = this.journal.getOpenTrades();
    if (openTrades.length === 0) return;

    logger.debug('Engine', `Monitorando ${openTrades.length} posições abertas`);

    const marketMap = new Map(currentMarkets.map(m => [m.id, m]));

    // Fetch open CLOB orders for stale-order detection (live only)
    let openOrderIds: Set<string> = new Set();
    if (!config.dryRun) {
      const openOrders = await this.clobApi.getOpenOrders();
      for (const order of openOrders as Array<{ id?: string; orderID?: string }>) {
        const id = order.id || order.orderID;
        if (id) openOrderIds.add(id);
      }
    }

    // STALE_ORDER_MS and FORCED_EXIT_AFTER_MS are module-level constants
    const now = Date.now();

    for (const trade of openTrades) {
      // ── STALE ORDER ─────────────────────────────────────────────────
      if (!config.dryRun && !trade.dryRun) {
        const tradeAge = now - new Date(trade.timestamp).getTime();
        if (tradeAge > STALE_ORDER_MS && openOrderIds.has(trade.id)) {
          const cancelled = await this.clobApi.cancelOrder(trade.id);
          if (cancelled) {
            this.journal.cancelTrade(trade.id);
            this.riskManager.closePosition(trade.stake, 0, trade.id);
            this.activeMarketIds.delete(trade.marketId);
            this.positionState.delete(trade.id);
            this.tradeSignals.delete(trade.id);
            this.logDecision('monitor', `🚫 Ordem stale cancelada: "${trade.question.substring(0, 50)}..." (>24h)`);
          }
          continue;
        }
      }

      const market = marketMap.get(trade.marketId) || await this.gammaApi.getMarketById(trade.marketId);
      if (!market) continue;

      // ── MARKET RESOLUTION ───────────────────────────────────────────
      if (market.closed) {
        const resolvedYes = market.yesPrice >= 0.99;
        const resolvedNo  = market.noPrice  >= 0.99;

        if (!resolvedYes && !resolvedNo) {
          // If the market has been closed for >48h without Polymarket settling it,
          // force-exit at current price rather than holding an unresolvable position.
          const closedSinceMs = market.endDate
            ? now - new Date(market.endDate).getTime()
            : 0;

          if (closedSinceMs > FORCED_EXIT_AFTER_MS) {
            const exitPrice = trade.side === 'BUY_YES' ? market.yesPrice : market.noPrice;
            const pnl = exitPrice * trade.size * (1 - POLYMARKET_TAKER_FEE) - trade.stake;
            const hours = Math.round(closedSinceMs / 3_600_000);

            this.journal.exitTrade(trade.id, exitPrice, pnl);
            this.riskManager.closePosition(trade.stake, pnl, trade.id);
            this.activeMarketIds.delete(trade.marketId);
            this.positionState.delete(trade.id);
            this.tradeSignals.delete(trade.id);
            this.logDecision('monitor',
              `⏰ SAÍDA FORÇADA: "${trade.question.substring(0, 50)}..." fechado há ${hours}h sem resolução Polymarket. ` +
              `P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
            );
            await this.notifications.notifyRiskAlert(
              `Saída forçada após ${hours}h: "${trade.question.substring(0, 60)}" não foi resolvido pela Polymarket.`
            );
            this.emit('tradeResolved', { trade, won: pnl >= 0, pnl });
          } else {
            const hours = (closedSinceMs / 3_600_000).toFixed(1);
            this.logDecision('monitor',
              `⚠️ Resultado ambíguo: "${trade.question.substring(0, 50)}..." — aguardando resolução (${hours}h fechado)`
            );
          }
          continue;
        }

        const won = (trade.side === 'BUY_YES' && resolvedYes) || (trade.side === 'BUY_NO' && resolvedNo);
        const exitPrice = won ? 1.0 : 0.0;
        const pnl = won ? (trade.size * 1) - trade.stake : -trade.stake;

        this.journal.resolveTrade(trade.id, won, exitPrice);
        this.riskManager.closePosition(trade.stake, pnl, trade.id);
        this.activeMarketIds.delete(trade.marketId);
        this.positionState.delete(trade.id);
        if (config.calibrationEnabled) {
          this.calibrator.recordOutcome(trade.entryPrice, won, trade.question);
          const signals = this.tradeSignals.get(trade.id);
          if (signals) {
            this.ensembleTracker.recordOutcome(signals, won, trade.side);
            this.tradeSignals.delete(trade.id);
          }
        }

        if (won) {
          this.logDecision('monitor', `🎯 GANHOU: "${trade.question.substring(0, 50)}..." → +$${pnl.toFixed(2)}`);
          await this.notifications.notifyTradeWon(trade.question, pnl);
        } else {
          this.logDecision('monitor', `💀 PERDEU: "${trade.question.substring(0, 50)}..." → -$${Math.abs(pnl).toFixed(2)}`);
          await this.notifications.notifyTradeLost(trade.question, pnl);
        }
        this.emit('tradeResolved', { trade, won, pnl });
        continue;
      }

      // ── ACTIVE POSITION — check exit rules ──────────────────────────
      const currentSidePrice = trade.side === 'BUY_YES' ? market.yesPrice : market.noPrice;

      // Persist current price so dashboard can show real-time VARIAÇÃO column
      this.journal.updateCurrentPrice(trade.id, currentSidePrice);

      // Update per-position state (for trailing stop + momentum)
      const state = this.positionState.get(trade.id) ?? {
        peakPrice: trade.entryPrice,
        declineCount: 0,
        lastPrice: trade.entryPrice,
      };
      if (currentSidePrice > state.peakPrice) state.peakPrice = currentSidePrice;
      state.declineCount = currentSidePrice < state.lastPrice ? state.declineCount + 1 : 0;
      state.lastPrice = currentSidePrice;
      this.positionState.set(trade.id, state);

      // Determine exit reason (priority order)
      let exitReason: string | null = null;

      // 1. PROFIT TARGET — lock in gains
      if (currentSidePrice >= config.exitPriceTarget) {
        exitReason = `🎯 PROFIT TARGET atingido @ ${(currentSidePrice * 100).toFixed(1)}¢ (alvo=${(config.exitPriceTarget * 100).toFixed(0)}¢)`;
      }

      // 2. TRAILING STOP — protect accumulated gains
      if (!exitReason && state.peakPrice >= trade.entryPrice * (1 + config.trailingStopActivation)) {
        const trailingStopPrice = state.peakPrice * (1 - config.trailingStopDistance);
        if (currentSidePrice <= trailingStopPrice) {
          exitReason = `📉 TRAILING STOP @ ${(currentSidePrice * 100).toFixed(1)}¢ (pico=${(state.peakPrice * 100).toFixed(1)}¢, stop=${(trailingStopPrice * 100).toFixed(1)}¢)`;
        }
      }

      // 3. STOP-LOSS — cap catastrophic losses
      if (!exitReason && currentSidePrice <= trade.entryPrice * (1 - config.stopLossPct)) {
        exitReason = `🛑 STOP-LOSS: queda de ${(config.stopLossPct * 100).toFixed(0)}% do preço de entrada (${(trade.entryPrice * 100).toFixed(1)}¢ → ${(currentSidePrice * 100).toFixed(1)}¢)`;
      }

      // 4. EDGE REVERSAL — thesis invalidated (fresh consensus re-estimation)
      // FIX: Uses LIVE consensus data (Metaculus + Manifold) instead of static entry probability.
      // This catches macro shifts that weren't available when the position was opened.
      if (!exitReason && config.edgeReversalEnabled) {
        let freshProb: number | null = null;

        try {
          const consensusEstimates = await this.consensusClient.getConsensus(trade.question);
          if (consensusEstimates.length > 0) {
            // Weighted average by confidence
            const totalWeight = consensusEstimates.reduce((s, e) => s + e.confidence, 0);
            freshProb = consensusEstimates.reduce((s, e) => s + e.probability * e.confidence, 0) / totalWeight;
          }
        } catch (_) { /* consensus unavailable — fall back to entry estimate */ }

        // Fall back to entry-time estimate if consensus returned nothing
        const probForReversal = freshProb ?? (
          trade.side === 'BUY_YES'
            ? trade.entryPrice + trade.edge
            : 1 - trade.entryPrice - trade.edge
        );

        const currentEdgeAnalysis = this.edgeCalc.calculateEdge(
          trade.marketId, trade.question, market.yesPrice,
          probForReversal, trade.confidence ?? 0.5,
          market.liquidity, market.yesTokenId, market.noTokenId, market.negRisk
        );

        const REVERSAL_EDGE_THRESHOLD = config.minEdge * 2.0; // must be twice minEdge to trigger
        const oppositeHasEdge =
          (trade.side === 'BUY_YES' && currentEdgeAnalysis.side === 'BUY_NO'  && Math.abs(currentEdgeAnalysis.edge) > REVERSAL_EDGE_THRESHOLD) ||
          (trade.side === 'BUY_NO'  && currentEdgeAnalysis.side === 'BUY_YES' && Math.abs(currentEdgeAnalysis.edge) > REVERSAL_EDGE_THRESHOLD);

        if (oppositeHasEdge) {
          const source = freshProb ? 'consenso externo' : 'estimativa de entrada';
          exitReason = `🔄 EDGE REVERSAL [${source}]: mercado agora favorece o lado oposto (edge=${(currentEdgeAnalysis.edgePercent).toFixed(1)}%)`;
        }
      }

      // 5. TIME DECAY — exit losing positions near expiry
      if (!exitReason && market.endDate && config.timeDecayHours > 0) {
        const hoursToExpiry = (new Date(market.endDate).getTime() - now) / (1000 * 60 * 60);
        if (hoursToExpiry > 0 && hoursToExpiry < config.timeDecayHours && currentSidePrice < trade.entryPrice) {
          exitReason = `⏰ TIME DECAY: ${hoursToExpiry.toFixed(1)}h até vencimento com posição no prejuízo (entrada=${(trade.entryPrice * 100).toFixed(1)}¢, atual=${(currentSidePrice * 100).toFixed(1)}¢)`;
        }
      }

      // 6. MOMENTUM EXIT — FIX: require BOTH consecutive declines AND meaningful price drop
      // Before: 3 cycles of decline (3 minutes) was enough — far too aggressive.
      // Now: requires consecutive declines AND price is >=5% below peak (real trend, not noise).
      if (!exitReason && state.declineCount >= config.momentumExitCycles && currentSidePrice < trade.entryPrice) {
        const dropFromPeak = (state.peakPrice - currentSidePrice) / state.peakPrice;
        const MIN_MEANINGFUL_DROP = 0.05; // 5% from peak before treating as trend reversal
        if (dropFromPeak >= MIN_MEANINGFUL_DROP) {
          exitReason = `📊 MOMENTUM NEGATIVO: ${state.declineCount} ciclos consecutivos + queda de ${(dropFromPeak * 100).toFixed(1)}% do pico (${(state.peakPrice * 100).toFixed(1)}¢ → ${(currentSidePrice * 100).toFixed(1)}¢)`;
        }
      }

      if (!exitReason) continue;

      // ── EXECUTE EXIT ────────────────────────────────────────────────
      const sellTokenId = trade.side === 'BUY_YES' ? market.yesTokenId : market.noTokenId;
      let exitSuccess = false;

      if (config.dryRun || trade.dryRun) {
        exitSuccess = true;
        logger.info('Engine', `🏜️ [DRY-RUN] Exit simulado: ${exitReason} @ $${currentSidePrice.toFixed(3)}`);
      } else {
        // FIX: Try limit order first (better price), fallback to market order (guaranteed fill).
        // This ensures positions are ALWAYS closed when an exit signal fires in LIVE mode.
        logger.info('Engine', `Executing LIVE exit: SELL ${trade.size.toFixed(2)} shares @ $${currentSidePrice.toFixed(4)} [${sellTokenId.slice(0, 12)}...]`);

        const limitResult = await this.clobApi.placeLimitOrder(
          sellTokenId, 'SELL', currentSidePrice, trade.size, market.negRisk
        );

        if (limitResult.success) {
          exitSuccess = true;
          logger.info('Engine', `✅ SELL Limit Order aceita: ${limitResult.orderId}`);
        } else {
          // Fallback: market sell at 2% below current price to guarantee fill
          logger.warn('Engine', `Limit SELL falhou (${limitResult.error}), tentando market sell...`);
          const marketPrice = Math.max(0.01, currentSidePrice * 0.98);
          const marketResult = await this.clobApi.placeLimitOrder(
            sellTokenId, 'SELL', marketPrice, trade.size, market.negRisk
          );
          if (marketResult.success) {
            exitSuccess = true;
            logger.info('Engine', `✅ SELL Market fallback: preenchido @ $${marketPrice.toFixed(4)}`);
          } else {
            logger.error('Engine', `❌ SELL falhou: limit=${limitResult.error} | market=${marketResult.error}. Posição mantida aberta.`);
          }
        }
      }


      if (exitSuccess) {
        // Deduct Polymarket taker fee (~2%) from exit proceeds to simulate real P&L
        const exitProceeds = config.dryRun
          ? currentSidePrice * trade.size * (1 - POLYMARKET_TAKER_FEE)
          : currentSidePrice * trade.size;
        const pnl = exitProceeds - trade.stake;
        this.journal.exitTrade(trade.id, currentSidePrice, pnl);
        this.riskManager.closePosition(trade.stake, pnl, trade.id);
        this.activeMarketIds.delete(trade.marketId);
        this.positionState.delete(trade.id);
        if (config.calibrationEnabled) {
          this.calibrator.recordOutcome(trade.entryPrice, pnl >= 0, trade.question);
          const signals = this.tradeSignals.get(trade.id);
          if (signals) {
            this.ensembleTracker.recordOutcome(signals, pnl >= 0, trade.side);
            this.tradeSignals.delete(trade.id);
          }
        }

        this.logDecision('monitor',
          `${pnl >= 0 ? '💰' : '💸'} SAÍDA [${exitReason}] — P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
        );

        if (pnl >= 0) {
          await this.notifications.notifyTradeWon(trade.question, pnl);
          this.emit('tradeResolved', { trade, won: true, pnl });
        } else {
          await this.notifications.notifyTradeLost(trade.question, pnl);
          this.emit('tradeResolved', { trade, won: false, pnl });
        }
      }
    }
  }
}
