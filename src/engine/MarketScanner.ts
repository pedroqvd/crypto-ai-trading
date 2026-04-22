// ================================================
// MARKET SCANNER — Fetches and filters active markets
// ================================================

import { config } from './Config';
import { logger } from '../utils/Logger';
import { GammaApiClient, ParsedMarket, ParsedEvent } from '../services/GammaApiClient';
import { MarketQualityAnalyzer } from '../analysis/MarketQualityAnalyzer';
import { LogDecisionFn, EmitFn } from './engine-types';

export class MarketScanner {
  private gammaApi: GammaApiClient;
  private qualityAnalyzer: MarketQualityAnalyzer;
  private activeMarketIds: Set<string>;
  private logDecision: LogDecisionFn;
  private emit: EmitFn;

  constructor(
    gammaApi: GammaApiClient,
    qualityAnalyzer: MarketQualityAnalyzer,
    activeMarketIds: Set<string>,
    logDecision: LogDecisionFn,
    emit: EmitFn,
  ) {
    this.gammaApi = gammaApi;
    this.qualityAnalyzer = qualityAnalyzer;
    this.activeMarketIds = activeMarketIds;
    this.logDecision = logDecision;
    this.emit = emit;
  }

  async scan(): Promise<{ markets: ParsedMarket[]; events: ParsedEvent[] }> {
    // Fetch flat market list and (optionally) event groups in parallel
    const [markets, events] = await Promise.all([
      this.gammaApi.getAllActiveMarkets(5),
      config.correlationEnabled
        ? this.gammaApi.getActiveEventsWithMarkets(3)
        : Promise.resolve<ParsedEvent[]>([]),
    ]);

    this.logDecision('scan', `Escaneou ${markets.length} mercados ativos${events.length > 0 ? `, ${events.length} eventos` : ''}.`);
    this.emit('scanComplete', { count: markets.length });

    return { markets, events };
  }

  filter(markets: ParsedMarket[]): ParsedMarket[] {
    const filtered = markets.filter(m => {
      if (this.activeMarketIds.has(m.id)) return false;
      if (m.negRisk) return false;
      if (m.liquidity < config.minLiquidity) return false;
      if (m.volume < config.minVolume) return false;
      if (!m.acceptingOrders) return false;
      if (m.yesPrice > 0.97 || m.yesPrice < 0.03) return false;

      // Market quality gate — reject low-quality markets before analysis
      if (!this.qualityAnalyzer.passes(m)) return false;

      return true;
    });

    logger.info('Engine', `[Filtro] ${markets.length} → ${filtered.length} (liq>=${config.minLiquidity/1000}K, vol>=${config.minVolume/1000}K, quality>=40, price 3%-97%).`);
    return filtered;
  }
}
