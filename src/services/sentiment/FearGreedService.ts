// ================================================
// FEAR & GREED INDEX SERVICE
// API gratuita: https://api.alternative.me/fng/
// ================================================

import axios from 'axios';

interface FearGreedData {
  value: number;           // 0-100
  classification: string;  // Extreme Fear, Fear, Neutral, Greed, Extreme Greed
  timestamp: number;
}

interface FearGreedHistory {
  current: FearGreedData;
  yesterday: FearGreedData | null;
  lastWeek: FearGreedData | null;
  lastMonth: FearGreedData | null;
  trend: 'improving' | 'worsening' | 'stable';
}

export class FearGreedService {
  private baseUrl = 'https://api.alternative.me/fng/';
  private cache: { data: FearGreedHistory | null; timestamp: number } = { data: null, timestamp: 0 };
  private cacheTTL = 300000; // 5 min (atualiza a cada 5 min na API)

  constructor() {
    console.log('😱 FearGreedService inicializado');
  }

  // ========================================
  // ÍNDICE ATUAL
  // ========================================
  async getCurrentIndex(): Promise<FearGreedData | null> {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { limit: 1, format: 'json' },
        timeout: 10000
      });

      const entry = response.data.data?.[0];
      if (!entry) return null;

      return {
        value: parseInt(entry.value),
        classification: entry.value_classification,
        timestamp: parseInt(entry.timestamp) * 1000
      };
    } catch (error) {
      console.error('❌ FearGreed getCurrentIndex error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // HISTÓRICO COM TENDÊNCIA
  // ========================================
  async getHistoryWithTrend(): Promise<FearGreedHistory | null> {
    if (this.cache.data && Date.now() - this.cache.timestamp < this.cacheTTL) {
      return this.cache.data;
    }

    try {
      const response = await axios.get(this.baseUrl, {
        params: { limit: 31, format: 'json' },
        timeout: 10000
      });

      const entries = response.data.data;
      if (!entries || entries.length === 0) return null;

      const parseEntry = (entry: any): FearGreedData => ({
        value: parseInt(entry.value),
        classification: entry.value_classification,
        timestamp: parseInt(entry.timestamp) * 1000
      });

      const current = parseEntry(entries[0]);
      const yesterday = entries.length > 1 ? parseEntry(entries[1]) : null;
      const lastWeek = entries.length > 7 ? parseEntry(entries[7]) : null;
      const lastMonth = entries.length > 30 ? parseEntry(entries[30]) : null;

      // Calcular tendência
      let trend: 'improving' | 'worsening' | 'stable' = 'stable';
      if (lastWeek) {
        const diff = current.value - lastWeek.value;
        if (diff > 5) trend = 'improving';
        else if (diff < -5) trend = 'worsening';
      }

      const result: FearGreedHistory = {
        current,
        yesterday,
        lastWeek,
        lastMonth,
        trend
      };

      this.cache = { data: result, timestamp: Date.now() };
      return result;
    } catch (error) {
      console.error('❌ FearGreed getHistoryWithTrend error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ========================================
  // INTERPRETAÇÃO PARA AI
  // ========================================
  async getSentimentSummary(): Promise<string> {
    const history = await this.getHistoryWithTrend();
    if (!history) return 'Fear & Greed Index indisponível no momento.';

    const { current, yesterday, lastWeek, trend } = history;

    let summary = `Fear & Greed Index: ${current.value}/100 (${current.classification}).`;

    if (yesterday) {
      const diff = current.value - yesterday.value;
      summary += ` Variação 24h: ${diff > 0 ? '+' : ''}${diff} pontos.`;
    }

    if (lastWeek) {
      const diff = current.value - lastWeek.value;
      summary += ` Variação 7d: ${diff > 0 ? '+' : ''}${diff} pontos.`;
    }

    summary += ` Tendência: ${trend === 'improving' ? 'melhorando' : trend === 'worsening' ? 'piorando' : 'estável'}.`;

    return summary;
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      const index = await this.getCurrentIndex();
      return { status: index ? 'operational' : 'error', timestamp: Date.now() };
    } catch {
      return { status: 'error', timestamp: Date.now() };
    }
  }
}
