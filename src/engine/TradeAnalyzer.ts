// ================================================
// TRADE ANALYZER — Probability estimation, edge calculation, correlation
// ================================================

import { config } from './Config';
import { GammaApiClient, ParsedMarket, ParsedEvent } from '../services/GammaApiClient';
import { ProbabilityEstimator } from '../analysis/ProbabilityEstimator';
import { EdgeCalculator, EdgeAnalysis } from '../analysis/EdgeCalculator';
import { BayesianCalibrator } from '../analysis/BayesianCalibrator';
import { EnsembleWeightTracker } from '../analysis/EnsembleWeightTracker';
import { ConsensusClient } from '../services/ConsensusClient';
import { CorrelationAnalyzer } from '../analysis/CorrelationAnalyzer';
import { SignalSnapshot, LogDecisionFn } from './engine-types';

export class TradeAnalyzer {
  private probEstimator: ProbabilityEstimator;
  private edgeCalc: EdgeCalculator;
  private calibrator: BayesianCalibrator;
  private ensembleTracker: EnsembleWeightTracker;
  private consensusClient: ConsensusClient;
  private correlationAnalyzer: CorrelationAnalyzer;
  private pendingSignals: Map<string, SignalSnapshot[]>;
  private activeMarketIds: Set<string>;
  private logDecision: LogDecisionFn;

  constructor(
    probEstimator: ProbabilityEstimator,
    edgeCalc: EdgeCalculator,
    calibrator: BayesianCalibrator,
    ensembleTracker: EnsembleWeightTracker,
    consensusClient: ConsensusClient,
    correlationAnalyzer: CorrelationAnalyzer,
    pendingSignals: Map<string, SignalSnapshot[]>,
    activeMarketIds: Set<string>,
    logDecision: LogDecisionFn,
  ) {
    this.probEstimator = probEstimator;
    this.edgeCalc = edgeCalc;
    this.calibrator = calibrator;
    this.ensembleTracker = ensembleTracker;
    this.consensusClient = consensusClient;
    this.correlationAnalyzer = correlationAnalyzer;
    this.pendingSignals = pendingSignals;
    this.activeMarketIds = activeMarketIds;
    this.logDecision = logDecision;
  }

  async analyze(filtered: ParsedMarket[], allMarkets: ParsedMarket[]): Promise<EdgeAnalysis[]> {
    const edgeAnalyses: EdgeAnalysis[] = [];
    const learnedWeights = this.ensembleTracker.getLearnedWeights();

    // Pre-compute median volume once to avoid O(n²) recalculation inside the loop
    const medianVolume = allMarkets.length > 0
      ? [...allMarkets].sort((a, b) => a.volume - b.volume)[Math.floor(allMarkets.length / 2)].volume
      : undefined;

    for (const market of filtered) {
      // Pre-estimate to see if consensus lookup is worthwhile (edge proxy)
      // Only query consensus when market price shows ≥3% directional signal from 50/50.
      const roughEdge = Math.abs(market.yesPrice - 0.5) > 0.03;
      let consensusEstimates = undefined;
      if (roughEdge) {
        consensusEstimates = await this.consensusClient.getConsensus(market.question);
        if (consensusEstimates.length === 0) consensusEstimates = undefined;
      }

      const probEstimate = this.probEstimator.estimate(market, allMarkets, medianVolume, undefined, learnedWeights, consensusEstimates);

      // Store signal snapshot for ensemble learning at resolution
      this.pendingSignals.set(market.id, probEstimate.signals.map(s => ({
        name: s.name, adjustment: s.adjustment, weight: s.weight,
      })));

      // Apply Bayesian calibration correction (category-aware, time-weighted)
      let calibratedProb = probEstimate.estimatedTrueProb;
      let calibratedConf = probEstimate.confidence;
      if (config.calibrationEnabled) {
        const cal = this.calibrator.getCalibrationAdjustment(probEstimate.estimatedTrueProb, market.question);
        if (cal) {
          calibratedProb = Math.max(0.01, Math.min(0.99, probEstimate.estimatedTrueProb + cal.adjustment));
          calibratedConf = Math.min(0.95, probEstimate.confidence + cal.confidence * 0.1);
        }
      }

      const edgeAnalysis = this.edgeCalc.calculateEdge(
        market.id,
        market.question,
        market.yesPrice,
        calibratedProb,
        calibratedConf,
        market.liquidity,
        market.yesTokenId,
        market.noTokenId,
        market.negRisk
      );

      edgeAnalyses.push(edgeAnalysis);
    }

    const tradeable = this.edgeCalc.filterTradeableOpportunities(edgeAnalyses);

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

  async analyzeCorrelation(events: ParsedEvent[], allMarkets: ParsedMarket[]): Promise<EdgeAnalysis[]> {
    const inconsistencies = this.correlationAnalyzer.findInconsistencies(events);
    if (inconsistencies.length === 0) return [];

    const marketMap = new Map(allMarkets.map(m => [m.id, m]));
    const result: EdgeAnalysis[] = [];

    for (const opp of inconsistencies.slice(0, 5)) {
      const summary = this.correlationAnalyzer.summarize(opp);
      this.logDecision('opportunity', `🔗 CORRELAÇÃO: ${summary}`);

      // Skip markets already in active positions
      if (this.activeMarketIds.has(opp.marketId)) continue;

      const market = marketMap.get(opp.marketId);
      if (!market) continue;

      // fairPrice is the correlation-derived true probability
      const estimatedTrueProb = opp.recommendation === 'BUY_YES'
        ? opp.fairPrice
        : 1 - opp.fairPrice;

      const edgeAnalysis = this.edgeCalc.calculateEdge(
        opp.marketId,
        opp.question,
        market.yesPrice,
        estimatedTrueProb,
        0.70, // correlation signal has good confidence
        market.liquidity,
        market.yesTokenId,
        market.noTokenId,
        market.negRisk
      );

      if (edgeAnalysis.side !== 'NO_TRADE') {
        edgeAnalysis.reasoning = `[CORRELAÇÃO] ${edgeAnalysis.reasoning}`;
        result.push(edgeAnalysis);
      }
    }

    return result;
  }
}
