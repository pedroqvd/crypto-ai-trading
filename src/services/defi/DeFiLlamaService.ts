// ================================================
// DEFI LLAMA SERVICE - TVL, Protocols & Chains
// API gratuita, sem key: https://api.llama.fi
// ================================================

import axios, { AxiosInstance } from 'axios';

interface Protocol {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  chains: string[];
  tvl: number;
  change_1h: number | null;
  change_1d: number | null;
  change_7d: number | null;
  category: string;
  url: string;
}

interface ChainTVL {
  name: string;
  tvl: number;
  tokenSymbol: string;
}

interface DeFiOverview {
  totalTVL: number;
  totalTVLChange24h: number;
  topProtocols: Protocol[];
  topChains: ChainTVL[];
  timestamp: number;
}

export class DeFiLlamaService {
  private client: AxiosInstance;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 180000; // 3 min

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.llama.fi',
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    console.log('🦙 DeFiLlamaService inicializado');
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data as T;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ========================================
  // TOP PROTOCOLOS POR TVL
  // ========================================
  async getProtocols(limit = 30): Promise<Protocol[]> {
    const cacheKey = `protocols:${limit}`;
    const cached = this.getCached<Protocol[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/protocols');
      const protocols: Protocol[] = (response.data || [])
        .slice(0, limit)
        .map((p: any) => ({
          id: p.id || p.slug,
          name: p.name,
          symbol: p.symbol || '',
          chain: p.chain || '',
          chains: p.chains || [],
          tvl: p.tvl || 0,
          change_1h: p.change_1h ?? null,
          change_1d: p.change_1d ?? null,
          change_7d: p.change_7d ?? null,
          category: p.category || 'Unknown',
          url: p.url || ''
        }));

      this.setCache(cacheKey, protocols);
      return protocols;
    } catch (error) {
      console.error('❌ DeFiLlama getProtocols error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // TVL POR CHAIN
  // ========================================
  async getChains(): Promise<ChainTVL[]> {
    const cacheKey = 'chains';
    const cached = this.getCached<ChainTVL[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/v2/chains');
      const chains: ChainTVL[] = (response.data || [])
        .map((c: any) => ({
          name: c.name,
          tvl: c.tvl || 0,
          tokenSymbol: c.tokenSymbol || ''
        }))
        .sort((a: ChainTVL, b: ChainTVL) => b.tvl - a.tvl);

      this.setCache(cacheKey, chains);
      return chains;
    } catch (error) {
      console.error('❌ DeFiLlama getChains error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  // ========================================
  // TVL DE UM PROTOCOLO ESPECÍFICO
  // ========================================
  async getProtocolTVL(protocol: string): Promise<number | null> {
    const cacheKey = `tvl:${protocol}`;
    const cached = this.getCached<number>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await this.client.get(`/tvl/${protocol}`);
      const tvl = response.data || 0;
      this.setCache(cacheKey, tvl);
      return tvl;
    } catch (error) {
      console.error(`❌ DeFiLlama getProtocolTVL(${protocol}) error:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // OVERVIEW COMPLETO DO DEFI
  // ========================================
  async getDeFiOverview(): Promise<DeFiOverview> {
    const cacheKey = 'defi_overview';
    const cached = this.getCached<DeFiOverview>(cacheKey);
    if (cached) return cached;

    try {
      const [protocols, chains] = await Promise.all([
        this.getProtocols(20),
        this.getChains()
      ]);

      const totalTVL = chains.reduce((sum, c) => sum + c.tvl, 0);

      // Calcular mudança 24h baseada nos top protocols
      const protocolsWithChange = protocols.filter(p => p.change_1d !== null);
      const avgChange = protocolsWithChange.length > 0
        ? protocolsWithChange.reduce((sum, p) => sum + (p.change_1d || 0), 0) / protocolsWithChange.length
        : 0;

      const overview: DeFiOverview = {
        totalTVL,
        totalTVLChange24h: avgChange,
        topProtocols: protocols.slice(0, 10),
        topChains: chains.slice(0, 10),
        timestamp: Date.now()
      };

      this.setCache(cacheKey, overview);
      return overview;
    } catch (error) {
      console.error('❌ DeFiLlama getDeFiOverview error:', error instanceof Error ? error.message : error);
      return {
        totalTVL: 0,
        totalTVLChange24h: 0,
        topProtocols: [],
        topChains: [],
        timestamp: Date.now()
      };
    }
  }

  // ========================================
  // RESUMO PARA AI
  // ========================================
  async getDeFiSummary(): Promise<string> {
    const overview = await this.getDeFiOverview();

    const tvlBillions = (overview.totalTVL / 1e9).toFixed(2);
    let summary = `DeFi TVL Total: $${tvlBillions}B (${overview.totalTVLChange24h > 0 ? '+' : ''}${overview.totalTVLChange24h.toFixed(2)}% 24h). `;

    if (overview.topChains.length > 0) {
      const top3Chains = overview.topChains.slice(0, 3);
      summary += 'Top chains: ' + top3Chains.map(c =>
        `${c.name} ($${(c.tvl / 1e9).toFixed(1)}B)`
      ).join(', ') + '. ';
    }

    if (overview.topProtocols.length > 0) {
      const top3 = overview.topProtocols.slice(0, 3);
      summary += 'Top protocolos: ' + top3.map(p =>
        `${p.name} ($${(p.tvl / 1e9).toFixed(1)}B)`
      ).join(', ') + '.';
    }

    return summary;
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      await this.client.get('/v2/chains');
      return { status: 'operational', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
