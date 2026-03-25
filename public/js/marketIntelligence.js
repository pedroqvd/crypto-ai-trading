// ================================================
// MARKET INTELLIGENCE MODULE
// Sentimento, DeFi, On-Chain, Trending & Top Coins
// ================================================

class MarketIntelligence {
    constructor() {
        this.refreshInterval = 60000; // 1 minuto
        this.data = {
            fearGreed: null,
            polymarket: null,
            global: null,
            trending: null,
            topCoins: null,
            defi: null,
            onchain: null,
        };

        this.init();
    }

    async init() {
        this.renderSkeletons();
        await this.fetchAll();
        this.startAutoRefresh();
        console.log('MarketIntelligence iniciado');
    }

    // ============================================
    // SKELETON LOADING
    // ============================================
    renderSkeletons() {
        this.renderFearGreedSkeleton();
        this.renderPolymarketSkeleton();
        this.renderGlobalStatsSkeleton();
        this.renderTrendingSkeleton();
        this.renderTopCoinsSkeleton();
        this.renderDefiSkeleton();
        this.renderOnChainSkeleton();
    }

    skeletonPulse(count, height = '18px', width = '100%') {
        return Array.from({ length: count }, () =>
            `<div class="skeleton" style="height:${height};width:${width};margin-bottom:8px;border-radius:6px;"></div>`
        ).join('');
    }

    renderFearGreedSkeleton() {
        const el = document.getElementById('fear-greed-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-panel-inner">${this.skeletonPulse(3, '20px')}</div>`;
    }

    renderPolymarketSkeleton() {
        const el = document.getElementById('polymarket-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-panel-inner">${this.skeletonPulse(4, '16px')}</div>`;
    }

    renderGlobalStatsSkeleton() {
        const el = document.getElementById('global-stats-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-global-grid">${this.skeletonPulse(4, '50px', '100%')}</div>`;
    }

    renderTrendingSkeleton() {
        const el = document.getElementById('trending-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-trending-row">${Array.from({ length: 5 }, () =>
            `<div class="mi-trending-card skeleton" style="height:70px;width:90px;flex-shrink:0;border-radius:10px;"></div>`
        ).join('')}</div>`;
    }

    renderTopCoinsSkeleton() {
        const el = document.getElementById('top-coins-panel');
        if (!el) return;
        el.innerHTML = this.skeletonPulse(5, '36px');
    }

    renderDefiSkeleton() {
        const el = document.getElementById('defi-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-defi-grid">${this.skeletonPulse(4, '55px', '100%')}</div>`;
    }

    renderOnChainSkeleton() {
        const el = document.getElementById('onchain-panel');
        if (!el) return;
        el.innerHTML = `<div class="mi-onchain-grid">${this.skeletonPulse(4, '55px', '100%')}</div>`;
    }

    // ============================================
    // DATA FETCHING
    // ============================================
    async fetchAll() {
        await Promise.allSettled([
            this.fetchFearGreed(),
            this.fetchPolymarket(),
            this.fetchGlobal(),
            this.fetchTrending(),
            this.fetchTopCoins(),
            this.fetchDefi(),
            this.fetchOnChain(),
        ]);
    }

    async safeFetch(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.warn(`Erro ao buscar ${url}:`, e.message);
            return null;
        }
    }

    async fetchFearGreed() {
        const data = await this.safeFetch('/api/sentiment/fear-greed');
        this.data.fearGreed = data;
        this.renderFearGreed(data);
    }

    async fetchPolymarket() {
        const data = await this.safeFetch('/api/sentiment/polymarket');
        this.data.polymarket = data;
        this.renderPolymarket(data);
    }

    async fetchGlobal() {
        const data = await this.safeFetch('/api/coingecko/global');
        this.data.global = data;
        this.renderGlobalStats(data);
        this.updateHeaderBar(data);
    }

    async fetchTrending() {
        const data = await this.safeFetch('/api/coingecko/trending');
        this.data.trending = data;
        this.renderTrending(data);
    }

    async fetchTopCoins() {
        const data = await this.safeFetch('/api/coingecko/top?limit=20');
        this.data.topCoins = data;
        this.renderTopCoins(data);
    }

    async fetchDefi() {
        const data = await this.safeFetch('/api/defi/overview');
        this.data.defi = data;
        this.renderDefi(data);
    }

    async fetchOnChain() {
        const data = await this.safeFetch('/api/onchain/btc');
        this.data.onchain = data;
        this.renderOnChain(data);
    }

    // ============================================
    // RENDER: FEAR & GREED GAUGE
    // ============================================
    renderFearGreed(data) {
        const el = document.getElementById('fear-greed-panel');
        if (!el) return;

        if (!data || !data.current) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        const { value, classification } = data.current;
        const yesterdayVal = data.yesterday?.value ?? '--';
        const weekVal = data.lastWeek?.value ?? '--';
        const trend = data.trend || 'neutro';

        const color = this.fearGreedColor(value);
        const rotation = (value / 100) * 180 - 90; // -90 to +90 degrees
        const trendIcon = trend === 'improving' ? '↑' : trend === 'declining' ? '↓' : '→';

        el.innerHTML = `
            <div class="fg-gauge-wrap">
                <div class="fg-gauge" title="Índice de Medo e Ganância: ${value}/100">
                    <svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg">
                        <!-- Arc background -->
                        <path d="M10,65 A55,55 0 0,1 110,65" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="10" stroke-linecap="round"/>
                        <!-- Arc colored fill based on value -->
                        <path d="M10,65 A55,55 0 0,1 110,65" fill="none"
                            stroke="url(#fgGrad)" stroke-width="10" stroke-linecap="round"
                            stroke-dasharray="${(value / 100) * 173} 173"/>
                        <defs>
                            <linearGradient id="fgGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" style="stop-color:#ff4757"/>
                                <stop offset="40%" style="stop-color:#ffa502"/>
                                <stop offset="70%" style="stop-color:#eccc68"/>
                                <stop offset="100%" style="stop-color:#00ff88"/>
                            </linearGradient>
                        </defs>
                        <!-- Needle -->
                        <g transform="translate(60,65) rotate(${rotation})">
                            <line x1="0" y1="0" x2="0" y2="-42" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
                            <circle cx="0" cy="0" r="4" fill="${color}"/>
                        </g>
                        <!-- Value text -->
                        <text x="60" y="58" text-anchor="middle" font-size="16" font-weight="bold" fill="${color}">${value}</text>
                    </svg>
                    <div class="fg-label" style="color:${color}">${this.translateClassification(classification)}</div>
                </div>
                <div class="fg-comparison">
                    <div class="fg-cmp-item">
                        <span class="fg-cmp-label">Ontem</span>
                        <span class="fg-cmp-val" style="color:${this.fearGreedColor(yesterdayVal)}">${yesterdayVal}</span>
                    </div>
                    <div class="fg-cmp-item">
                        <span class="fg-cmp-label">Semana</span>
                        <span class="fg-cmp-val" style="color:${this.fearGreedColor(weekVal)}">${weekVal}</span>
                    </div>
                    <div class="fg-cmp-item">
                        <span class="fg-cmp-label">Tendência</span>
                        <span class="fg-cmp-val">${trendIcon} ${trend}</span>
                    </div>
                </div>
            </div>
        `;

        // Update header bar fear greed
        const hbFg = document.getElementById('hb-fear-greed');
        if (hbFg) {
            hbFg.textContent = `${value} – ${this.translateClassification(classification)}`;
            hbFg.style.color = color;
        }
    }

    fearGreedColor(val) {
        const v = parseInt(val);
        if (isNaN(v)) return '#888';
        if (v <= 25) return '#ff4757';
        if (v <= 45) return '#ffa502';
        if (v <= 55) return '#eccc68';
        if (v <= 75) return '#00d4ff';
        return '#00ff88';
    }

    translateClassification(c) {
        if (!c) return 'N/A';
        const map = {
            'Extreme Fear': 'Medo Extremo',
            'Fear': 'Medo',
            'Neutral': 'Neutro',
            'Greed': 'Ganância',
            'Extreme Greed': 'Ganância Extrema',
        };
        return map[c] || c;
    }

    // ============================================
    // RENDER: POLYMARKET SENTIMENT
    // ============================================
    renderPolymarket(data) {
        const el = document.getElementById('polymarket-panel');
        if (!el) return;

        if (!data) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        const score = data.sentimentScore ?? 50;
        const sentiment = data.overallSentiment || 'neutro';
        const bullishPct = score;
        const bearishPct = 100 - score;
        const sentColor = sentiment === 'bullish' ? '#00ff88' : sentiment === 'bearish' ? '#ff4757' : '#eccc68';
        const markets = (data.cryptoMarkets || []).slice(0, 3);

        el.innerHTML = `
            <div class="poly-sentiment-bar-wrap">
                <div class="poly-sentiment-labels">
                    <span style="color:#00ff88"><i class="fas fa-arrow-up"></i> Alta ${bullishPct}%</span>
                    <span class="poly-sentiment-badge" style="color:${sentColor}">${this.translateSentiment(sentiment)}</span>
                    <span style="color:#ff4757">Baixa ${bearishPct}% <i class="fas fa-arrow-down"></i></span>
                </div>
                <div class="poly-bar">
                    <div class="poly-bar-bull" style="width:${bullishPct}%" title="Alta: ${bullishPct}%"></div>
                    <div class="poly-bar-bear" style="width:${bearishPct}%" title="Baixa: ${bearishPct}%"></div>
                </div>
            </div>
            <div class="poly-markets">
                ${markets.map(m => `
                    <div class="poly-market-item">
                        <span class="poly-market-q" title="${m.question || ''}">${this.truncate(m.question || 'Mercado', 42)}</span>
                        <span class="poly-market-yes" style="color:#00ff88">${Math.round((m.yesPrice ?? 0.5) * 100)}% sim</span>
                        <span class="poly-market-vol">Vol: $${this.formatNumber(m.volume ?? 0)}</span>
                    </div>
                `).join('')}
                ${markets.length === 0 ? '<div class="mi-error" style="font-size:0.8rem">Sem dados de mercados</div>' : ''}
            </div>
        `;
    }

    translateSentiment(s) {
        if (!s) return 'Neutro';
        const map = { bullish: 'Otimista', bearish: 'Pessimista', neutral: 'Neutro' };
        return map[s.toLowerCase()] || s;
    }

    // ============================================
    // RENDER: GLOBAL STATS
    // ============================================
    renderGlobalStats(data) {
        const el = document.getElementById('global-stats-panel');
        if (!el) return;

        const mcap = data?.total_market_cap ?? null;
        const mcapChange = data?.market_cap_change_24h ?? null;
        const btcDom = data?.market_cap_percentage?.btc ?? null;
        const ethDom = data?.market_cap_percentage?.eth ?? null;
        const activeCryptos = data?.active_cryptocurrencies ?? null;

        el.innerHTML = `
            <div class="mi-global-grid">
                <div class="mi-global-stat">
                    <div class="mi-gs-label">Cap. Total</div>
                    <div class="mi-gs-value">${mcap !== null ? '$' + this.formatTrillion(mcap) : 'N/A'}</div>
                    <div class="mi-gs-change ${mcapChange !== null && mcapChange >= 0 ? 'positive' : 'negative'}">
                        ${mcapChange !== null ? (mcapChange >= 0 ? '↑' : '↓') + ' ' + Math.abs(mcapChange).toFixed(2) + '%' : '--'}
                    </div>
                </div>
                <div class="mi-global-stat">
                    <div class="mi-gs-label">Dom. BTC</div>
                    <div class="mi-gs-value btc-color">${btcDom !== null ? btcDom.toFixed(1) + '%' : 'N/A'}</div>
                    <div class="mi-gs-change neutral"><i class="fab fa-bitcoin"></i></div>
                </div>
                <div class="mi-global-stat">
                    <div class="mi-gs-label">Dom. ETH</div>
                    <div class="mi-gs-value eth-color">${ethDom !== null ? ethDom.toFixed(1) + '%' : 'N/A'}</div>
                    <div class="mi-gs-change neutral"><i class="fab fa-ethereum"></i></div>
                </div>
                <div class="mi-global-stat">
                    <div class="mi-gs-label">Ativos</div>
                    <div class="mi-gs-value">${activeCryptos !== null ? activeCryptos.toLocaleString('pt-BR') : 'N/A'}</div>
                    <div class="mi-gs-change neutral">Criptos</div>
                </div>
            </div>
        `;
    }

    // ============================================
    // RENDER: HEADER BAR UPDATE
    // ============================================
    updateHeaderBar(data) {
        if (!data) return;
        const mcap = data?.total_market_cap;
        const btcDom = data?.market_cap_percentage?.btc;
        const ethDom = data?.market_cap_percentage?.eth;
        const activeCryptos = data?.active_cryptocurrencies;

        const hbMcap = document.getElementById('hb-market-cap');
        const hbBtc = document.getElementById('hb-btc-dom');
        const hbEth = document.getElementById('hb-eth-dom');
        const hbActive = document.getElementById('hb-active-cryptos');

        if (hbMcap && mcap !== undefined) hbMcap.textContent = '$' + this.formatTrillion(mcap);
        if (hbBtc && btcDom !== undefined) hbBtc.textContent = btcDom.toFixed(1) + '%';
        if (hbEth && ethDom !== undefined) hbEth.textContent = ethDom.toFixed(1) + '%';
        if (hbActive && activeCryptos !== undefined) hbActive.textContent = activeCryptos.toLocaleString('pt-BR');
    }

    // ============================================
    // RENDER: TRENDING COINS
    // ============================================
    renderTrending(data) {
        const el = document.getElementById('trending-panel');
        if (!el) return;

        if (!data || !Array.isArray(data) || data.length === 0) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        el.innerHTML = `
            <div class="mi-trending-row">
                ${data.slice(0, 8).map((coin, i) => `
                    <div class="mi-trending-card" title="${coin.name || ''} - Rank #${coin.market_cap_rank ?? '?'}">
                        <div class="mi-trending-rank">#${i + 1}</div>
                        <div class="mi-trending-icon">
                            ${coin.symbol ? coin.symbol.substring(0, 2).toUpperCase() : '??'}
                        </div>
                        <div class="mi-trending-name">${this.truncate(coin.name || coin.symbol || 'N/A', 8)}</div>
                        <div class="mi-trending-sym">${(coin.symbol || '').toUpperCase()}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ============================================
    // RENDER: TOP COINS (movers)
    // ============================================
    renderTopCoins(data) {
        const el = document.getElementById('top-coins-panel');
        if (!el) return;

        if (!data || !Array.isArray(data) || data.length === 0) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        // Sort by absolute 24h change to get top movers
        const sorted = [...data].sort((a, b) =>
            Math.abs(b.price_change_percentage_24h ?? 0) - Math.abs(a.price_change_percentage_24h ?? 0)
        ).slice(0, 5);

        el.innerHTML = `
            <div class="mi-top-coins-list">
                ${sorted.map(coin => {
                    const chg = coin.price_change_percentage_24h ?? 0;
                    const isPos = chg >= 0;
                    return `
                        <div class="mi-coin-row" data-symbol="${coin.symbol?.toUpperCase()}USDT"
                             title="${coin.symbol?.toUpperCase()} — Clique para ver no gráfico">
                            <div class="mi-coin-sym">${(coin.symbol || '').toUpperCase()}</div>
                            <div class="mi-coin-price">$${this.formatPrice(coin.current_price)}</div>
                            <div class="mi-coin-chg ${isPos ? 'positive' : 'negative'}">
                                ${isPos ? '↑' : '↓'} ${Math.abs(chg).toFixed(2)}%
                            </div>
                            <div class="mi-coin-mcap">${this.formatBillion(coin.market_cap)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Make coin rows clickable to update chart
        el.querySelectorAll('.mi-coin-row[data-symbol]').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const sym = row.dataset.symbol;
                this.updateChartSymbol(`BINANCE:${sym}`);
            });
        });
    }

    updateChartSymbol(symbol) {
        console.log(`Atualizando gráfico para: ${symbol}`);
        // Re-init main chart with new symbol
        if (window.TradingViewWidgets && window.TradingViewWidgets.changeMainSymbol) {
            window.TradingViewWidgets.changeMainSymbol(symbol);
        }
        // Trigger analysis
        if (window.claudeChat) {
            const sym = symbol.replace('BINANCE:', '').replace('USDT', '');
            window.claudeChat.messageInput.value = `Analise brevemente ${sym} agora. Qual é o sentimento atual?`;
        }
    }

    // ============================================
    // RENDER: DEFI OVERVIEW
    // ============================================
    renderDefi(data) {
        const el = document.getElementById('defi-panel');
        if (!el) return;

        if (!data) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        const tvl = data.totalTVL ?? null;
        const tvlChange = data.totalTVLChange24h ?? null;
        const protocols = (data.topProtocols || []).slice(0, 3);
        const chains = (data.topChains || []).slice(0, 3);

        el.innerHTML = `
            <div class="mi-defi-grid">
                <div class="mi-defi-stat">
                    <div class="mi-ds-label">TVL Total DeFi</div>
                    <div class="mi-ds-value">${tvl !== null ? '$' + this.formatBillion(tvl) : 'N/A'}</div>
                    <div class="mi-ds-change ${tvlChange !== null && tvlChange >= 0 ? 'positive' : 'negative'}">
                        ${tvlChange !== null ? (tvlChange >= 0 ? '↑' : '↓') + ' ' + Math.abs(tvlChange).toFixed(2) + '%' : '--'}
                    </div>
                </div>
                <div class="mi-defi-chains">
                    <div class="mi-ds-label">Top Chains</div>
                    ${chains.length > 0 ? chains.map(c => `
                        <div class="mi-chain-row">
                            <span class="mi-chain-name">${c.name || 'N/A'}</span>
                            <span class="mi-chain-tvl">$${this.formatBillion(c.tvl ?? 0)}</span>
                        </div>
                    `).join('') : '<div class="mi-error" style="font-size:0.8rem">N/A</div>'}
                </div>
                <div class="mi-defi-protocols">
                    <div class="mi-ds-label">Top Protocolos</div>
                    ${protocols.length > 0 ? protocols.map(p => `
                        <div class="mi-chain-row">
                            <span class="mi-chain-name">${p.name || 'N/A'}</span>
                            <span class="mi-chain-tvl">$${this.formatBillion(p.tvl ?? 0)}</span>
                        </div>
                    `).join('') : '<div class="mi-error" style="font-size:0.8rem">N/A</div>'}
                </div>
            </div>
        `;
    }

    // ============================================
    // RENDER: ON-CHAIN BTC
    // ============================================
    renderOnChain(data) {
        const el = document.getElementById('onchain-panel');
        if (!el) return;

        if (!data) {
            el.innerHTML = `<div class="mi-error"><i class="fas fa-exclamation-triangle"></i> Dados indisponíveis</div>`;
            return;
        }

        const hashRate = data.hashRate ?? null;
        const txCount = data.nTx ?? null;
        const mempool = data.memPoolSize ?? null;
        const fees = data.totalFees ?? null;
        const minerRev = data.minerRevenue ?? null;

        el.innerHTML = `
            <div class="mi-onchain-grid">
                <div class="mi-oc-stat" title="Taxa de hash da rede Bitcoin em ExaHash por segundo">
                    <i class="fas fa-microchip mi-oc-icon"></i>
                    <div class="mi-oc-val">${hashRate !== null ? this.formatHashRate(hashRate) : 'N/A'}</div>
                    <div class="mi-oc-label">Hash Rate</div>
                </div>
                <div class="mi-oc-stat" title="Transações confirmadas nas últimas 24 horas">
                    <i class="fas fa-exchange-alt mi-oc-icon"></i>
                    <div class="mi-oc-val">${txCount !== null ? Number(txCount).toLocaleString('pt-BR') : 'N/A'}</div>
                    <div class="mi-oc-label">Txs 24h</div>
                </div>
                <div class="mi-oc-stat" title="Número de transações aguardando confirmação na mempool">
                    <i class="fas fa-clock mi-oc-icon"></i>
                    <div class="mi-oc-val">${mempool !== null ? Number(mempool).toLocaleString('pt-BR') : 'N/A'}</div>
                    <div class="mi-oc-label">Mempool</div>
                </div>
                <div class="mi-oc-stat" title="Receita total dos mineradores em 24h (BTC)">
                    <i class="fas fa-coins mi-oc-icon"></i>
                    <div class="mi-oc-val">${minerRev !== null ? this.formatBtc(minerRev) : 'N/A'}</div>
                    <div class="mi-oc-label">Rev. Mineiro</div>
                </div>
            </div>
        `;
    }

    // ============================================
    // UPDATE CHAT CONTEXT BADGES
    // ============================================
    updateContextBadges() {
        const badges = {
            'ctx-fear-greed': !!this.data.fearGreed,
            'ctx-polymarket': !!this.data.polymarket,
            'ctx-defi': !!this.data.defi,
            'ctx-onchain': !!this.data.onchain,
        };

        Object.entries(badges).forEach(([id, hasData]) => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.toggle('ctx-badge-ok', hasData);
                el.classList.toggle('ctx-badge-missing', !hasData);
                el.title = hasData ? 'Dados disponíveis' : 'Dados indisponíveis';
            }
        });
    }

    // ============================================
    // GATHER FULL MARKET CONTEXT (for Claude)
    // ============================================
    getFullContext() {
        return {
            fearGreed: this.data.fearGreed,
            polymarketSentiment: this.data.polymarket,
            globalMarket: this.data.global,
            defi: this.data.defi,
            btcOnChain: this.data.onchain,
        };
    }

    // ============================================
    // AUTO REFRESH
    // ============================================
    startAutoRefresh() {
        setInterval(() => {
            this.fetchAll().then(() => this.updateContextBadges());
        }, this.refreshInterval);

        // Initial badge update
        this.updateContextBadges();
    }

    // ============================================
    // FORMAT HELPERS
    // ============================================
    formatTrillion(n) {
        if (n === null || n === undefined) return 'N/A';
        const t = n / 1e12;
        if (t >= 1) return t.toFixed(2) + 'T';
        return (n / 1e9).toFixed(0) + 'B';
    }

    formatBillion(n) {
        if (n === null || n === undefined) return 'N/A';
        const b = n / 1e9;
        if (b >= 1) return b.toFixed(2) + 'B';
        const m = n / 1e6;
        if (m >= 1) return m.toFixed(1) + 'M';
        return n.toLocaleString('pt-BR');
    }

    formatNumber(n) {
        if (n === null || n === undefined) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    formatPrice(n) {
        if (n === null || n === undefined) return 'N/A';
        if (n >= 1000) return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
        if (n >= 1) return n.toFixed(2);
        if (n >= 0.01) return n.toFixed(4);
        return n.toFixed(6);
    }

    formatHashRate(n) {
        // n in H/s typically, normalize to EH/s
        const eh = n / 1e18;
        if (eh >= 1) return eh.toFixed(0) + ' EH/s';
        const ph = n / 1e15;
        if (ph >= 1) return ph.toFixed(0) + ' PH/s';
        return n.toExponential(2) + ' H/s';
    }

    formatBtc(n) {
        if (n === null || n === undefined) return 'N/A';
        // Satoshis to BTC
        if (n > 1e8) return (n / 1e8).toFixed(2) + ' BTC';
        return n.toFixed(4) + ' BTC';
    }

    truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '…' : str;
    }
}

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    window.marketIntelligence = new MarketIntelligence();
    console.log('MarketIntelligence inicializado');
});

window.MarketIntelligence = MarketIntelligence;
