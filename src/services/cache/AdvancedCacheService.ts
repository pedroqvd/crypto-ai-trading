// ================================================
// ADVANCED CACHE SERVICE - Redis-like Performance
// Cache inteligente para dados de mercado
// ================================================

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
  hits: number;
}

interface CacheStats {
  totalEntries: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  memoryUsage: number;
}

export class AdvancedCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats = {
    hits: 0,
    misses: 0
  };
  private cleanupInterval: NodeJS.Timeout;
  private maxSize = 10000; // Máximo de entradas
  private defaultTTL = 60000; // 1 minuto padrão

  constructor() {
    // Limpeza automática a cada 30 segundos
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000);

    console.log('🚀 AdvancedCacheService inicializado');
  }

  // ========================================
  // CORE CACHE OPERATIONS
  // ========================================
  set(key: string, data: any, ttl?: number): void {
    const finalTTL = ttl || this.defaultTTL;
    
    // Verificar limite de tamanho
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: finalTTL,
      hits: 0
    });
  }

  get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Verificar se expirou
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Incrementar hits
    entry.hits++;
    this.stats.hits++;
    
    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Verificar se expirou
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  // ========================================
  // SPECIALIZED MARKET DATA METHODS
  // ========================================
  
  // Cache para preços com TTL curto
  setPrice(symbol: string, exchange: string, price: number, ttl = 5000): void {
    const key = `price:${exchange}:${symbol}`;
    this.set(key, { price, timestamp: Date.now() }, ttl);
  }

  getPrice(symbol: string, exchange: string): { price: number; timestamp: number } | null {
    const key = `price:${exchange}:${symbol}`;
    return this.get(key);
  }

  // Cache para order books com TTL muito curto
  setOrderBook(symbol: string, exchange: string, orderBook: any, ttl = 2000): void {
    const key = `orderbook:${exchange}:${symbol}`;
    this.set(key, orderBook, ttl);
  }

  getOrderBook(symbol: string, exchange: string): any | null {
    const key = `orderbook:${exchange}:${symbol}`;
    return this.get(key);
  }

  // Cache para dados OHLCV com TTL médio
  setOHLCV(symbol: string, exchange: string, timeframe: string, data: any, ttl = 60000): void {
    const key = `ohlcv:${exchange}:${symbol}:${timeframe}`;
    this.set(key, data, ttl);
  }

  getOHLCV(symbol: string, exchange: string, timeframe: string): any | null {
    const key = `ohlcv:${exchange}:${symbol}:${timeframe}`;
    return this.get(key);
  }

  // Cache para análises técnicas com TTL longo
  setAnalysis(symbol: string, analysis: any, ttl = 300000): void {
    const key = `analysis:${symbol}`;
    this.set(key, analysis, ttl);
  }

  getAnalysis(symbol: string): any | null {
    const key = `analysis:${symbol}`;
    return this.get(key);
  }

  // Cache para notícias e sentimentos
  setNews(keyword: string, news: any, ttl = 600000): void {
    const key = `news:${keyword}`;
    this.set(key, news, ttl);
  }

  getNews(keyword: string): any | null {
    const key = `news:${keyword}`;
    return this.get(key);
  }

  // Cache para configurações do usuário (TTL longo)
  setUserConfig(userId: string, config: any, ttl = 86400000): void { // 24 horas
    const key = `config:${userId}`;
    this.set(key, config, ttl);
  }

  getUserConfig(userId: string): any | null {
    const key = `config:${userId}`;
    return this.get(key);
  }

  // ========================================
  // BATCH OPERATIONS
  // ========================================
  setMultiple(entries: Array<{ key: string; data: any; ttl?: number }>): void {
    entries.forEach(({ key, data, ttl }) => {
      this.set(key, data, ttl);
    });
  }

  getMultiple<T = any>(keys: string[]): Map<string, T> {
    const results = new Map<string, T>();
    
    keys.forEach(key => {
      const data = this.get<T>(key);
      if (data !== null) {
        results.set(key, data);
      }
    });
    
    return results;
  }

  deleteMultiple(keys: string[]): number {
    let deleted = 0;
    keys.forEach(key => {
      if (this.delete(key)) {
        deleted++;
      }
    });
    return deleted;
  }

  // ========================================
  // PATTERN MATCHING
  // ========================================
  getByPattern(pattern: string): Map<string, any> {
    const results = new Map();
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    
    this.cache.forEach((entry, key) => {
      if (regex.test(key)) {
        // Verificar se não expirou
        if (Date.now() - entry.timestamp <= entry.ttl) {
          results.set(key, entry.data);
        }
      }
    });
    
    return results;
  }

  deleteByPattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let deleted = 0;
    
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => {
      if (this.delete(key)) {
        deleted++;
      }
    });
    
    return deleted;
  }

  // ========================================
  // CACHE MANAGEMENT
  // ========================================
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      console.log(`🧹 Cache cleanup: ${cleaned} entradas removidas`);
    }
  }

  private evictLRU(): void {
    // Encontrar entrada menos usada (Least Recently Used)
    let lruKey = '';
    let lruHits = Infinity;
    
    this.cache.forEach((entry, key) => {
      if (entry.hits < lruHits) {
        lruHits = entry.hits;
        lruKey = key;
      }
    });
    
    if (lruKey) {
      this.cache.delete(lruKey);
    }
  }

  // ========================================
  // CACHE STATISTICS
  // ========================================
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    // Estimar uso de memória (aproximado)
    let memoryUsage = 0;
    this.cache.forEach((entry) => {
      memoryUsage += JSON.stringify(entry.data).length;
    });
    
    return {
      totalEntries: this.cache.size,
      hitRate: Number(hitRate.toFixed(2)),
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      memoryUsage: Math.round(memoryUsage / 1024) // KB
    };
  }

  getTopKeys(limit = 10): Array<{ key: string; hits: number }> {
    const entries = Array.from(this.cache.entries())
      .map(([key, entry]) => ({ key, hits: entry.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
    
    return entries;
  }

  // ========================================
  // CACHE WARMING (Pre-cache dados importantes)
  // ========================================
  async warmupMarketData(symbols: string[], exchanges: string[]): Promise<void> {
    console.log('🔥 Iniciando cache warmup...');
    
    // Pre-cache símbolos populares
    const popularSymbols = symbols.slice(0, 20);
    const now = Date.now();
    
    popularSymbols.forEach(symbol => {
      exchanges.forEach(exchange => {
        // Simular dados iniciais
        this.setPrice(symbol, exchange, 0, 30000);
      });
    });
    
    console.log(`🔥 Cache warmup concluído: ${popularSymbols.length * exchanges.length} entradas`);
  }

  // ========================================
  // HEALTH CHECK
  // ========================================
  healthCheck(): any {
    const stats = this.getStats();
    const isHealthy = stats.hitRate > 70 && stats.totalEntries < this.maxSize * 0.9;
    
    return {
      healthy: isHealthy,
      stats,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      timestamp: Date.now()
    };
  }

  // ========================================
  // DESTROY
  // ========================================
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
    console.log('🔥 AdvancedCacheService destruído');
  }

  // ========================================
  // CACHE STRATEGIES
  // ========================================
  
  // Cache-aside pattern
  async getOrSet<T>(
    key: string, 
    fetcher: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    // Tentar pegar do cache primeiro
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    // Se não estiver no cache, buscar e cachear
    const data = await fetcher();
    this.set(key, data, ttl);
    return data;
  }

  // Write-through pattern
  setAndStore<T>(key: string, data: T, ttl?: number): T {
    this.set(key, data, ttl);
    // Aqui você poderia salvar em um banco de dados também
    return data;
  }

  // Write-behind pattern (async)
  async setAndStoreAsync<T>(key: string, data: T, ttl?: number): Promise<T> {
    this.set(key, data, ttl);
    
    // Salvar no banco de dados assincronamente
    setTimeout(async () => {
      try {
        // Implementar salvamento no banco se necessário
        console.log(`💾 Salvando ${key} no banco de dados`);
      } catch (error) {
        console.error('❌ Erro ao salvar no banco:', error);
      }
    }, 100);
    
    return data;
  }
}