// ================================================
// TRADINGVIEW WIDGETS CONFIGURATION
// ================================================

class TradingViewWidgets {
    constructor() {
        this.widgets = {};
        this.isMobile = window.innerWidth < 768;
        this.initializeWidgets();
    }

    // ========================================
    // MAIN CHART WIDGET (Gráfico Principal)  
    // ========================================
    initMainChart() {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "autosize": true,
            "symbol": "BINANCE:BTCUSDT",
            "interval": this.isMobile ? "1H" : "15",
            "timezone": "America/Sao_Paulo",
            "theme": "dark",
            "style": "1",
            "locale": "pt",
            "toolbar_bg": "#1a1a2e",
            "enable_publishing": false,
            "backgroundColor": "rgba(26, 26, 46, 0)",
            "gridColor": "rgba(255, 255, 255, 0.1)",
            "allow_symbol_change": true,
            "details": true,
            "hotlist": true,
            "calendar": false,
            "studies": [
                "RSI@tv-basicstudies",
                "MACD@tv-basicstudies",
                "BB@tv-basicstudies"
            ],
            "hide_side_toolbar": this.isMobile,
            "container_id": "main-chart-widget"
        });
        
        const container = document.getElementById('main-chart-widget');
        if (container) {
            container.innerHTML = '';
            container.appendChild(script);
        }
    }

    // ========================================
    // TICKER TAPE WIDGET (Preços Rolantes)
    // ========================================
    initTickerTape() {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "symbols": [
                {
                    "proName": "BINANCE:BTCUSDT",
                    "title": "Bitcoin"
                },
                {
                    "proName": "BINANCE:ETHUSDT", 
                    "title": "Ethereum"
                },
                {
                    "proName": "BINANCE:SOLUSDT",
                    "title": "Solana"
                },
                {
                    "proName": "BINANCE:ADAUSDT",
                    "title": "Cardano"
                },
                {
                    "proName": "BINANCE:DOGEUSDT",
                    "title": "Dogecoin"
                },
                {
                    "proName": "BINANCE:MATICUSDT",
                    "title": "Polygon"
                },
                {
                    "proName": "BINANCE:AVAXUSDT",
                    "title": "Avalanche"
                },
                {
                    "proName": "BINANCE:DOTUSDT",
                    "title": "Polkadot"
                }
            ],
            "showSymbolLogo": true,
            "colorTheme": "dark",
            "isTransparent": true,
            "displayMode": "adaptive",
            "locale": "pt"
        });
        
        const container = document.getElementById('ticker-tape-widget');
        if (container) {
            container.innerHTML = '';
            container.appendChild(script);
        }
    }

    // ========================================
    // MARKET OVERVIEW WIDGET (Visão Geral)
    // ========================================
    initMarketOverview() {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "colorTheme": "dark",
            "dateRange": "12M",
            "showChart": true,
            "locale": "pt",
            "width": "100%",
            "height": "100%",
            "plotLineColorGrowing": "rgba(41, 98, 255, 1)",
            "plotLineColorFalling": "rgba(41, 98, 255, 1)",
            "gridLineColor": "rgba(240, 243, 250, 0)",
            "scaleFontColor": "rgba(120, 123, 134, 1)",
            "belowLineFillColorGrowing": "rgba(41, 98, 255, 0.12)",
            "belowLineFillColorFalling": "rgba(41, 98, 255, 0.12)",
            "belowLineFillColorGrowingBottom": "rgba(41, 98, 255, 0)",
            "belowLineFillColorFallingBottom": "rgba(41, 98, 255, 0)",
            "symbolActiveColor": "rgba(41, 98, 255, 0.12)",
            "tabs": [
                {
                    "title": "Crypto",
                    "symbols": [
                        {
                            "s": "BINANCE:BTCUSDT",
                            "d": "Bitcoin"
                        },
                        {
                            "s": "BINANCE:ETHUSDT",
                            "d": "Ethereum"
                        },
                        {
                            "s": "BINANCE:SOLUSDT",
                            "d": "Solana"
                        },
                        {
                            "s": "BINANCE:ADAUSDT",
                            "d": "Cardano"
                        },
                        {
                            "s": "BINANCE:DOGEUSDT",
                            "d": "Dogecoin"
                        }
                    ],
                    "originalTitle": "Cryptocurrencies"
                }
            ],
            "isTransparent": true
        });
        
        const container = document.getElementById('market-overview-widget');
        if (container) {
            container.innerHTML = '';
            container.appendChild(script);
        }
    }

    // ========================================
    // CRYPTO HEATMAP WIDGET (Mapa de Calor)
    // ========================================
    initHeatmap() {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-crypto-coins-heatmap.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "dataSource": "Crypto",
            "blockSize": "market_cap_calc",
            "blockColor": "change",
            "locale": "pt",
            "symbolUrl": "",
            "colorTheme": "dark",
            "hasTopBar": false,
            "isDataSetEnabled": false,
            "isZoomEnabled": true,
            "hasSymbolTooltip": true,
            "width": "100%",
            "height": "100%",
            "isTransparent": true
        });
        
        const container = document.getElementById('heatmap-widget');
        if (container) {
            container.innerHTML = '';
            container.appendChild(script);
        }
    }

    // ========================================
    // INICIALIZAR TODOS OS WIDGETS
    // ========================================
    initializeWidgets() {
        // Aguarda carregamento completo da página
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.loadAllWidgets();
            });
        } else {
            this.loadAllWidgets();
        }
    }

    loadAllWidgets() {
        // Delay escalonado para evitar sobrecarga
        setTimeout(() => this.initTickerTape(), 100);
        setTimeout(() => this.initMainChart(), 300);
        setTimeout(() => this.initMarketOverview(), 500);
        setTimeout(() => this.initHeatmap(), 700);
        
        console.log('🚀 TradingView Widgets iniciados com sucesso!');
    }

    // ========================================
    // MÉTODOS DE CONTROLE
    // ========================================
    
    // Trocar símbolo do gráfico principal
    changeMainSymbol(symbol) {
        console.log(`🔄 Alterando símbolo para: ${symbol}`);
        // Widget será recarregado automaticamente
        this.initMainChart();
    }

    // Refresh de todos os widgets
    refreshAllWidgets() {
        console.log('🔄 Atualizando todos os widgets...');
        this.loadAllWidgets();
    }

    // Ajustar para modo mobile
    adjustForMobile() {
        this.isMobile = window.innerWidth < 768;
        this.refreshAllWidgets();
    }
}

// ========================================
// INICIALIZAÇÃO AUTOMÁTICA
// ========================================
const tradingViewWidgets = new TradingViewWidgets();

// Ajuste responsivo
window.addEventListener('resize', () => {
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        tradingViewWidgets.adjustForMobile();
    }, 250);
});

// Exportar para uso global
window.TradingViewWidgets = tradingViewWidgets;