// ================================================
// BLOCKCHAIN SERVICE - On-Chain Data (Bitcoin)
// API gratuita: https://api.blockchain.info
// ================================================

import axios from 'axios';

interface BlockchainStats {
  marketPrice: number;
  hashRate: number;           // TH/s
  totalBtcSent: number;       // BTC
  nTx: number;                // transações nas últimas 24h
  nBlocks: number;            // blocos minerados
  difficulty: number;
  estimatedBtcSent: number;
  minerRevenue: number;       // USD
  totalFees: number;          // BTC
  memPoolSize: number;
  timestamp: number;
}

interface MempoolInfo {
  count: number;              // transações não confirmadas
  timestamp: number;
}

export class BlockchainService {
  private baseUrl = 'https://api.blockchain.info';
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 120000; // 2 min

  constructor() {
    console.log('⛓️  BlockchainService inicializado');
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
  // ESTATÍSTICAS GERAIS DO BITCOIN
  // ========================================
  async getStats(): Promise<BlockchainStats | null> {
    const cacheKey = 'btc_stats';
    const cached = this.getCached<BlockchainStats>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.baseUrl}/stats`, {
        params: { format: 'json' },
        timeout: 10000
      });

      const data = response.data;
      const stats: BlockchainStats = {
        marketPrice: data.market_price_usd || 0,
        hashRate: data.hash_rate || 0,
        totalBtcSent: data.total_btc_sent / 1e8 || 0,
        nTx: data.n_tx || 0,
        nBlocks: data.n_blocks_mined || 0,
        difficulty: data.difficulty || 0,
        estimatedBtcSent: data.estimated_btc_sent / 1e8 || 0,
        minerRevenue: data.miners_revenue_usd || 0,
        totalFees: data.total_fees_btc / 1e8 || 0,
        memPoolSize: data.mempool_size || 0,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, stats);
      return stats;
    } catch (error) {
      console.error('❌ Blockchain getStats error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // TAMANHO DA MEMPOOL (CONGESTIONAMENTO)
  // ========================================
  async getMempoolCount(): Promise<MempoolInfo | null> {
    const cacheKey = 'mempool';
    const cached = this.getCached<MempoolInfo>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.baseUrl}/q/unconfirmedcount`, {
        timeout: 10000
      });

      const info: MempoolInfo = {
        count: parseInt(response.data) || 0,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, info);
      return info;
    } catch (error) {
      console.error('❌ Blockchain getMempoolCount error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // RESUMO ON-CHAIN PARA AI
  // ========================================
  async getOnChainSummary(): Promise<string> {
    const stats = await this.getStats();
    if (!stats) return 'Dados on-chain Bitcoin indisponíveis no momento.';

    const mempool = await this.getMempoolCount();

    let summary = `Bitcoin On-Chain: `;
    summary += `Hash Rate: ${(stats.hashRate / 1e6).toFixed(2)} EH/s. `;
    summary += `Transações 24h: ${stats.nTx.toLocaleString()}. `;
    summary += `Blocos minerados: ${stats.nBlocks}. `;
    summary += `Receita mineradores: $${(stats.minerRevenue / 1e6).toFixed(2)}M. `;
    summary += `Fees totais: ${stats.totalFees.toFixed(4)} BTC. `;

    if (mempool) {
      summary += `Mempool: ${mempool.count.toLocaleString()} txs não confirmadas. `;
      if (mempool.count > 100000) {
        summary += '(CONGESTIONADO) ';
      } else if (mempool.count > 50000) {
        summary += '(moderado) ';
      } else {
        summary += '(saudável) ';
      }
    }

    return summary;
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      await axios.get(`${this.baseUrl}/stats`, { params: { format: 'json' }, timeout: 5000 });
      return { status: 'operational', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
