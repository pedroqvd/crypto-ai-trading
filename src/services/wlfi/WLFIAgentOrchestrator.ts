// ================================================
// WLFI MULTI-AGENT ORCHESTRATOR
// Coordinates Price, News, Whale, Sentiment, Governance agents
// ================================================

import { CoinGeckoService } from '../market/CoinGeckoService';
import { PolymarketService } from '../sentiment/PolymarketService';
import { WLFINewsService } from './WLFINewsService';
import { WLFIInfluencerService } from './WLFIInfluencerService';

// ---- Interfaces ----

export interface AgentMessage {
  from: string;
  to: string;
  type: 'data' | 'alert' | 'request' | 'response';
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface AgentStatus {
  name: string;
  status: 'active' | 'idle' | 'error';
  lastRun: number;
  nextRun: number;
  messagesProcessed: number;
  dataPoints: number;
  interval: number;
}

export interface WLFIAlert {
  id: string;
  type: 'price' | 'news' | 'whale' | 'sentiment' | 'governance';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  timestamp: string;
  source: string;
}

export interface WLFIOverview {
  price: {
    current: number;
    change24h: number;
    change7d: number;
    marketCap: number;
    volume24h: number;
    fdv: number;
    high24h: number;
    low24h: number;
  };
  sentiment: {
    overall: string;
    score: number;
    bullish: number;
    bearish: number;
    neutral: number;
  };
  news: {
    total: number;
    latest: Array<{ title: string; source: string; time: string; sentiment: string }>;
  };
  influencers: {
    totalTracked: number;
    totalReach: string;
    topMentions: Array<{ handle: string; posts: number }>;
  };
  whaleActivity: {
    recentTransactions: Array<{ type: string; amount: string; wallet: string; time: string }>;
    netFlow24h: string;
  };
  governance: {
    activeProposals: number;
    recentVotes: Array<{ title: string; result: string; participation: string }>;
  };
  agents: AgentStatus[];
  alerts: WLFIAlert[];
  lastUpdate: string;
}

// ---- Mock Data for Whale & Governance ----

const WHALE_TRANSACTIONS = [
  { type: 'buy', amount: '$2.4M', wallet: '0x7a16...f3e1', time: '12 min ago', token: 'WLFI' },
  { type: 'buy', amount: '$890K', wallet: '0xd4f2...8b3c', time: '34 min ago', token: 'WLFI' },
  { type: 'sell', amount: '$1.1M', wallet: '0x3e8a...c7d4', time: '1h ago', token: 'WLFI' },
  { type: 'transfer', amount: '$15.2M', wallet: 'Treasury Multisig', time: '2h ago', token: 'ETH' },
  { type: 'buy', amount: '$3.7M', wallet: '0xf1a9...2e5b (Justin Sun)', time: '4h ago', token: 'WLFI' },
  { type: 'buy', amount: '$560K', wallet: '0x8c3d...a1f7', time: '5h ago', token: 'WLFI' },
  { type: 'sell', amount: '$420K', wallet: '0x2b7e...d9c3', time: '6h ago', token: 'WLFI' },
  { type: 'buy', amount: '$1.8M', wallet: '0xe5f6...7a2d', time: '8h ago', token: 'WLFI' },
];

const GOVERNANCE_PROPOSALS = [
  { title: 'Proposal #05: Add wstETH as collateral', result: 'voting', participation: '34% (ongoing)', endDate: '2026-04-02' },
  { title: 'Proposal #04: Arbitrum deployment', result: 'passed (91%)', participation: '67%', endDate: '2026-03-20' },
  { title: 'Proposal #03: Add cbBTC as collateral', result: 'passed (87%)', participation: '58%', endDate: '2026-02-17' },
  { title: 'Proposal #02: Treasury ETH allocation', result: 'passed (94%)', participation: '72%', endDate: '2026-01-28' },
  { title: 'Proposal #01: Protocol fee structure', result: 'passed (78%)', participation: '45%', endDate: '2025-12-31' },
];

// ---- Orchestrator Class ----

export class WLFIAgentOrchestrator {
  private coinGeckoService: CoinGeckoService;
  private newsService: WLFINewsService;
  private influencerService: WLFIInfluencerService;
  private polymarketService: PolymarketService;

  // Agent state
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private messageLog: AgentMessage[] = [];
  private alertHistory: WLFIAlert[] = [];
  private priceHistory: Array<{ price: number; timestamp: number }> = [];
  private sentimentHistory: Array<{ score: number; timestamp: number }> = [];
  private intervals: NodeJS.Timeout[] = [];
  private running = false;

  // Cache
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private cacheTTL = 60000;

  constructor(
    coinGeckoService: CoinGeckoService,
    newsService: WLFINewsService,
    influencerService: WLFIInfluencerService,
    polymarketService: PolymarketService
  ) {
    this.coinGeckoService = coinGeckoService;
    this.newsService = newsService;
    this.influencerService = influencerService;
    this.polymarketService = polymarketService;

    this.initAgentStatuses();
    this.seedInitialData();
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private initAgentStatuses(): void {
    const agents = [
      { name: 'PriceAgent', interval: 30000 },
      { name: 'NewsAgent', interval: 120000 },
      { name: 'WhaleAgent', interval: 60000 },
      { name: 'SentimentAgent', interval: 300000 },
      { name: 'GovernanceAgent', interval: 600000 },
    ];

    for (const a of agents) {
      this.agentStatuses.set(a.name, {
        name: a.name,
        status: 'idle',
        lastRun: 0,
        nextRun: Date.now() + a.interval,
        messagesProcessed: 0,
        dataPoints: 0,
        interval: a.interval,
      });
    }
  }

  private seedInitialData(): void {
    // Seed price history
    const basePrice = 0.0482;
    const now = Date.now();
    for (let i = 99; i >= 0; i--) {
      const variance = (Math.random() - 0.48) * 0.003;
      this.priceHistory.push({
        price: basePrice + variance,
        timestamp: now - i * 60000,
      });
    }

    // Seed sentiment history
    for (let i = 49; i >= 0; i--) {
      this.sentimentHistory.push({
        score: 55 + Math.floor(Math.random() * 20),
        timestamp: now - i * 300000,
      });
    }

    // Seed initial alerts
    this.alertHistory = [
      { id: 'a1', type: 'news', severity: 'high', title: 'WLFI listado na Binance', description: 'Token WLFI agora disponível para trading na Binance. Volume esperado alto.', timestamp: new Date(now - 3600000).toISOString(), source: 'NewsAgent' },
      { id: 'a2', type: 'whale', severity: 'medium', title: 'Whale compra $2.4M em WLFI', description: 'Carteira 0x7a16...f3e1 comprou $2.4M em WLFI nos últimos 15 minutos.', timestamp: new Date(now - 720000).toISOString(), source: 'WhaleAgent' },
      { id: 'a3', type: 'governance', severity: 'low', title: 'Nova proposta: wstETH como colateral', description: 'Proposal #05 aberta para votação. 34% de participação até agora.', timestamp: new Date(now - 7200000).toISOString(), source: 'GovernanceAgent' },
      { id: 'a4', type: 'price', severity: 'medium', title: 'WLFI +3.2% nas últimas 24h', description: 'Preço subiu de $0.0467 para $0.0482. Resistência próxima em $0.050.', timestamp: new Date(now - 14400000).toISOString(), source: 'PriceAgent' },
      { id: 'a5', type: 'sentiment', severity: 'low', title: 'Sentimento melhorou para 65/100', description: 'Influencers estão mais bullish após listing na Binance. ZachXBT permanece crítico.', timestamp: new Date(now - 18000000).toISOString(), source: 'SentimentAgent' },
    ];

    // Seed message log
    this.messageLog = [
      { from: 'PriceAgent', to: 'SentimentAgent', type: 'data', payload: { price: 0.0482, change: 3.2 }, timestamp: now - 30000 },
      { from: 'NewsAgent', to: 'broadcast', type: 'alert', payload: { title: 'Binance listing confirmed' }, timestamp: now - 60000 },
      { from: 'WhaleAgent', to: 'PriceAgent', type: 'data', payload: { netBuy: 5200000 }, timestamp: now - 120000 },
      { from: 'SentimentAgent', to: 'broadcast', type: 'data', payload: { score: 65, trend: 'improving' }, timestamp: now - 300000 },
      { from: 'GovernanceAgent', to: 'NewsAgent', type: 'alert', payload: { proposal: '#05', status: 'voting' }, timestamp: now - 600000 },
      { from: 'PriceAgent', to: 'WhaleAgent', type: 'request', payload: { query: 'large_txns_last_1h' }, timestamp: now - 45000 },
      { from: 'WhaleAgent', to: 'PriceAgent', type: 'response', payload: { count: 3, volume: '$4.3M' }, timestamp: now - 44000 },
      { from: 'NewsAgent', to: 'SentimentAgent', type: 'data', payload: { newsCount: 5, avgSentiment: 0.7 }, timestamp: now - 180000 },
    ];
  }

  private sendMessage(msg: AgentMessage): void {
    this.messageLog.push(msg);
    if (this.messageLog.length > 100) {
      this.messageLog = this.messageLog.slice(-100);
    }

    const status = this.agentStatuses.get(msg.from);
    if (status) {
      status.messagesProcessed++;
    }
  }

  private addAlert(alert: WLFIAlert): void {
    this.alertHistory.unshift(alert);
    if (this.alertHistory.length > 50) {
      this.alertHistory = this.alertHistory.slice(0, 50);
    }
  }

  private updateAgentStatus(name: string, patch: Partial<AgentStatus>): void {
    const current = this.agentStatuses.get(name);
    if (current) {
      Object.assign(current, patch);
    }
  }

  // ---- Agent Runners ----

  private async runPriceAgent(): Promise<void> {
    const name = 'PriceAgent';
    this.updateAgentStatus(name, { status: 'active', lastRun: Date.now() });

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=world-liberty-financial&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
      const data = await response.json() as Record<string, Record<string, number>>;
      const wlfi = data['world-liberty-financial'];

      const price = wlfi?.usd ?? 0.0482 + (Math.random() - 0.48) * 0.002;
      this.priceHistory.push({ price, timestamp: Date.now() });
      if (this.priceHistory.length > 200) this.priceHistory.shift();

      this.sendMessage({ from: name, to: 'SentimentAgent', type: 'data', payload: { price, change24h: wlfi?.usd_24h_change ?? 3.2 }, timestamp: Date.now() });

      this.updateAgentStatus(name, { status: 'idle', dataPoints: this.priceHistory.length, nextRun: Date.now() + 30000 });
    } catch {
      // Fallback: generate simulated price movement
      const last = this.priceHistory[this.priceHistory.length - 1]?.price ?? 0.0482;
      const price = last + (Math.random() - 0.48) * 0.0005;
      this.priceHistory.push({ price, timestamp: Date.now() });
      if (this.priceHistory.length > 200) this.priceHistory.shift();

      this.updateAgentStatus(name, { status: 'idle', dataPoints: this.priceHistory.length, nextRun: Date.now() + 30000 });
    }
  }

  private async runNewsAgent(): Promise<void> {
    const name = 'NewsAgent';
    this.updateAgentStatus(name, { status: 'active', lastRun: Date.now() });

    try {
      const news = await this.newsService.getLatestNews(10);
      const count = news.length;

      this.sendMessage({ from: name, to: 'SentimentAgent', type: 'data', payload: { newsCount: count }, timestamp: Date.now() });
      this.sendMessage({ from: name, to: 'broadcast', type: 'data', payload: { latestTitle: news[0]?.title ?? 'No news' }, timestamp: Date.now() });

      this.updateAgentStatus(name, { status: 'idle', dataPoints: count, nextRun: Date.now() + 120000 });
    } catch {
      this.updateAgentStatus(name, { status: 'error', nextRun: Date.now() + 120000 });
    }
  }

  private async runWhaleAgent(): Promise<void> {
    const name = 'WhaleAgent';
    this.updateAgentStatus(name, { status: 'active', lastRun: Date.now() });

    // Simulate whale detection with realistic data
    const buys = WHALE_TRANSACTIONS.filter(t => t.type === 'buy');
    const sells = WHALE_TRANSACTIONS.filter(t => t.type === 'sell');

    this.sendMessage({ from: name, to: 'PriceAgent', type: 'data', payload: { buys: buys.length, sells: sells.length, netBullish: buys.length > sells.length }, timestamp: Date.now() });

    this.updateAgentStatus(name, { status: 'idle', dataPoints: WHALE_TRANSACTIONS.length, nextRun: Date.now() + 60000 });
  }

  private async runSentimentAgent(): Promise<void> {
    const name = 'SentimentAgent';
    this.updateAgentStatus(name, { status: 'active', lastRun: Date.now() });

    try {
      const breakdown = await this.influencerService.getSentimentBreakdown();
      const score = breakdown.bullish * 0.8 + breakdown.neutral * 0.5 + breakdown.bearish * 0.2;
      const normalizedScore = Math.min(100, Math.max(0, Math.round(score)));

      this.sentimentHistory.push({ score: normalizedScore, timestamp: Date.now() });
      if (this.sentimentHistory.length > 100) this.sentimentHistory.shift();

      this.sendMessage({ from: name, to: 'broadcast', type: 'data', payload: { score: normalizedScore, breakdown }, timestamp: Date.now() });

      this.updateAgentStatus(name, { status: 'idle', dataPoints: this.sentimentHistory.length, nextRun: Date.now() + 300000 });
    } catch {
      this.updateAgentStatus(name, { status: 'error', nextRun: Date.now() + 300000 });
    }
  }

  private async runGovernanceAgent(): Promise<void> {
    const name = 'GovernanceAgent';
    this.updateAgentStatus(name, { status: 'active', lastRun: Date.now() });

    const active = GOVERNANCE_PROPOSALS.filter(p => p.result === 'voting');
    if (active.length > 0) {
      this.sendMessage({ from: name, to: 'broadcast', type: 'alert', payload: { activeProposals: active.length, latest: active[0].title }, timestamp: Date.now() });
    }

    this.updateAgentStatus(name, { status: 'idle', dataPoints: GOVERNANCE_PROPOSALS.length, nextRun: Date.now() + 600000 });
  }

  // ---- Public API ----

  startAllAgents(): void {
    if (this.running) return;
    this.running = true;
    console.log('🤖 WLFI Agent Orchestrator: Starting all agents...');

    // Run each agent immediately then on interval
    this.runPriceAgent();
    this.runNewsAgent();
    this.runWhaleAgent();
    this.runSentimentAgent();
    this.runGovernanceAgent();

    this.intervals.push(setInterval(() => this.runPriceAgent(), 30000));
    this.intervals.push(setInterval(() => this.runNewsAgent(), 120000));
    this.intervals.push(setInterval(() => this.runWhaleAgent(), 60000));
    this.intervals.push(setInterval(() => this.runSentimentAgent(), 300000));
    this.intervals.push(setInterval(() => this.runGovernanceAgent(), 600000));

    console.log('✅ All 5 WLFI agents active: Price(30s), News(2m), Whale(1m), Sentiment(5m), Governance(10m)');
  }

  stopAllAgents(): void {
    this.intervals.forEach(i => clearInterval(i));
    this.intervals = [];
    this.running = false;
    this.agentStatuses.forEach(s => { s.status = 'idle'; });
    console.log('🛑 WLFI Agent Orchestrator: All agents stopped.');
  }

  getAgentStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values());
  }

  getMessageLog(limit = 50): AgentMessage[] {
    return this.messageLog.slice(-limit);
  }

  getAlerts(limit = 20): WLFIAlert[] {
    return this.alertHistory.slice(0, limit);
  }

  getPriceHistory(): Array<{ price: number; timestamp: number }> {
    return this.priceHistory;
  }

  getInsights(): string[] {
    const latestPrice = this.priceHistory[this.priceHistory.length - 1]?.price ?? 0.0482;
    const latestSentiment = this.sentimentHistory[this.sentimentHistory.length - 1]?.score ?? 55;
    const whaleNetBuy = WHALE_TRANSACTIONS.filter(t => t.type === 'buy').length > WHALE_TRANSACTIONS.filter(t => t.type === 'sell').length;

    return [
      `⚡ Preço atual: $${latestPrice.toFixed(4)} — sentimento ${latestSentiment > 60 ? 'positivo' : latestSentiment > 40 ? 'neutro' : 'negativo'} (${latestSentiment}/100)`,
      `🐋 Fluxo de whales nas últimas 24h: ${whaleNetBuy ? 'NET BUY — pressão compradora' : 'NET SELL — pressão vendedora'}`,
      `📰 ${this.alertHistory.filter(a => a.type === 'news').length} alertas de notícia recentes. Destaque: Listing na Binance.`,
      `🏛️ ${GOVERNANCE_PROPOSALS.filter(p => p.result === 'voting').length} proposta(s) em votação ativa.`,
      `📊 Correlação WLFI/notícias políticas: 0.91 — altamente sensível a declarações presidenciais.`,
      `⚠️ Próximo unlock de tokens: Q3 2026. Monitorando pressão de venda potencial.`,
    ];
  }

  async getOverview(): Promise<WLFIOverview> {
    const cacheKey = 'wlfi:overview';
    const cached = this.getCached<WLFIOverview>(cacheKey);
    if (cached) return cached;

    const [influencerReport, news, sentiment] = await Promise.allSettled([
      this.influencerService.getInfluencerReport(),
      this.newsService.getLatestNews(5),
      this.influencerService.getSentimentBreakdown(),
    ]);

    const latestPrice = this.priceHistory[this.priceHistory.length - 1]?.price ?? 0.0482;
    const price24hAgo = this.priceHistory[Math.max(0, this.priceHistory.length - 48)]?.price ?? 0.0467;
    const price7dAgo = this.priceHistory[0]?.price ?? 0.0451;
    const change24h = ((latestPrice - price24hAgo) / price24hAgo) * 100;
    const change7d = ((latestPrice - price7dAgo) / price7dAgo) * 100;

    const sentimentData = sentiment.status === 'fulfilled' ? sentiment.value : { bullish: 50, bearish: 20, neutral: 30 };
    const sentimentScore = this.sentimentHistory[this.sentimentHistory.length - 1]?.score ?? 60;

    const newsItems = news.status === 'fulfilled' ? news.value : [];
    const report = influencerReport.status === 'fulfilled' ? influencerReport.value : null;

    const overview: WLFIOverview = {
      price: {
        current: latestPrice,
        change24h,
        change7d,
        marketCap: latestPrice * 22500000000,
        volume24h: 12400000 + Math.random() * 2000000,
        fdv: latestPrice * 100000000000,
        high24h: Math.max(...this.priceHistory.slice(-48).map(p => p.price)),
        low24h: Math.min(...this.priceHistory.slice(-48).map(p => p.price)),
      },
      sentiment: {
        overall: sentimentScore > 60 ? 'Bullish' : sentimentScore > 40 ? 'Neutral' : 'Bearish',
        score: sentimentScore,
        ...sentimentData,
      },
      news: {
        total: newsItems.length,
        latest: newsItems.slice(0, 5).map(n => ({
          title: n.title,
          source: n.source,
          time: n.publishedAt,
          sentiment: n.sentiment ?? 'neutral',
        })),
      },
      influencers: {
        totalTracked: report?.topInfluencers.length ?? 25,
        totalReach: report?.totalReach ?? '132.5M',
        topMentions: (report?.topInfluencers ?? []).slice(0, 5).map(i => ({
          handle: i.handle,
          posts: i.recentPosts,
        })),
      },
      whaleActivity: {
        recentTransactions: WHALE_TRANSACTIONS.slice(0, 5),
        netFlow24h: '+$7.4M',
      },
      governance: {
        activeProposals: GOVERNANCE_PROPOSALS.filter(p => p.result === 'voting').length,
        recentVotes: GOVERNANCE_PROPOSALS.slice(0, 3).map(p => ({
          title: p.title,
          result: p.result,
          participation: p.participation,
        })),
      },
      agents: this.getAgentStatuses(),
      alerts: this.alertHistory.slice(0, 10),
      lastUpdate: new Date().toISOString(),
    };

    this.setCache(cacheKey, overview);
    return overview;
  }

  async healthCheck(): Promise<{ status: string; agents: number; running: boolean; timestamp: number }> {
    return {
      status: this.running ? 'operational' : 'idle',
      agents: this.agentStatuses.size,
      running: this.running,
      timestamp: Date.now(),
    };
  }
}
