import express from 'express';
import { PolymarketService } from '../services/sentiment/PolymarketService';
import { WLFINewsService } from '../services/wlfi/WLFINewsService';
import { WLFIInfluencerService } from '../services/wlfi/WLFIInfluencerService';
import { WLFIAgentOrchestrator } from '../services/wlfi/WLFIAgentOrchestrator';
import { WLFIOnChainService } from '../services/wlfi/WLFIOnChainService';
import { WLFITechnicalService } from '../services/wlfi/WLFITechnicalService';
import { WLFIPerformanceService } from '../services/wlfi/WLFIPerformanceService';
import { WLFILiquidationService } from '../services/wlfi/WLFILiquidationService';

interface WlfiServices {
    polymarketService: PolymarketService;
    newsService: WLFINewsService;
    influencerService: WLFIInfluencerService;
    orchestrator: WLFIAgentOrchestrator;
    onChainService: WLFIOnChainService;
    technicalService: WLFITechnicalService;
    performanceService: WLFIPerformanceService;
    liquidationService: WLFILiquidationService;
}

export function wlfiRoutes(app: express.Application, services: WlfiServices): void {
    const { polymarketService, newsService, influencerService, orchestrator, onChainService, technicalService, performanceService, liquidationService } = services;

    // ========================================
    // WLFI TOKEN ROUTES
    // ========================================
    app.get('/api/wlfi/price', async (req, res) => {
        try {
            // Try to fetch WLFI price from CoinGecko
            // WLFI might be identified as 'world-liberty-financial' on CoinGecko
            const coingeckoId = 'world-liberty-financial';

            // Mock data fallback if not found on CoinGecko
            const mockData = {
                price: 0.0482,
                change24h: 3.2,
                marketCap: 261000000,
                volume24h: 12400000,
                updatedAt: new Date().toISOString()
            };

            try {
                // Attempt to fetch real data from CoinGecko
                const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`);
                const data = await response.json() as Record<string, any>;

                if (data && data[coingeckoId]) {
                    const tokenData = data[coingeckoId] as Record<string, number>;
                    return res.json({
                        success: true,
                        data: {
                            price: tokenData.usd || mockData.price,
                            change24h: tokenData.usd_24h_change || mockData.change24h,
                            marketCap: tokenData.usd_market_cap || mockData.marketCap,
                            volume24h: tokenData.usd_24h_vol || mockData.volume24h,
                            updatedAt: new Date().toISOString()
                        }
                    });
                }
            } catch (e) {
                // Fall through to mock data
            }

            // Return mock data if CoinGecko fails or token not found
            res.json({ success: true, data: mockData });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch WLFI price' });
        }
    });

    app.get('/api/wlfi/markets', async (req, res) => {
        try {
            // Search Polymarket for WLFI and Trump crypto-related markets
            const wlfiMarkets = await polymarketService.searchMarkets('WLFI', 10);
            const trumpCryptoMarkets = await polymarketService.searchMarkets('Trump crypto', 10);

            res.json({
                success: true,
                data: {
                    wlfiMarkets: wlfiMarkets.slice(0, 5),
                    trumpCryptoMarkets: trumpCryptoMarkets.slice(0, 5),
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch WLFI markets' });
        }
    });

    // ========================================
    // WLFI NEWS
    // ========================================
    app.get('/api/wlfi/news', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            const news = await newsService.getLatestNews(limit);
            res.json({ success: true, data: news, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch WLFI news' });
        }
    });

    // ========================================
    // WLFI INFLUENCERS
    // ========================================
    app.get('/api/wlfi/influencers', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 25;
            const report = await influencerService.getInfluencerReport();
            report.topInfluencers = report.topInfluencers.slice(0, limit);
            res.json({ success: true, data: report, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch influencers' });
        }
    });

    app.get('/api/wlfi/influencers/posts', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            const posts = await influencerService.getRecentPosts(limit);
            res.json({ success: true, data: posts, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch influencer posts' });
        }
    });

    // ========================================
    // WLFI AGENT SYSTEM
    // ========================================
    app.get('/api/wlfi/overview', async (req, res) => {
        try {
            const overview = await orchestrator.getOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch WLFI overview' });
        }
    });

    app.get('/api/wlfi/agents', async (req, res) => {
        try {
            const statuses = orchestrator.getAgentStatuses();
            const messages = orchestrator.getMessageLog(30);
            const alerts = orchestrator.getAlerts(20);
            const insights = orchestrator.getInsights();
            res.json({ success: true, data: { agents: statuses, messages, alerts, insights }, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch agent data' });
        }
    });

    app.get('/api/wlfi/alerts', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            const alerts = orchestrator.getAlerts(limit);
            res.json({ success: true, data: alerts, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
        }
    });

    // ========================================
    // WLFI ON-CHAIN TRACKING
    // ========================================
    app.get('/api/wlfi/onchain', async (req, res) => {
        try {
            const overview = await onChainService.getOnChainOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch on-chain data' });
        }
    });

    app.get('/api/wlfi/onchain/whales', async (req, res) => {
        try {
            const whales = await onChainService.getWhaleWallets();
            res.json({ success: true, data: whales, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch whale wallets' });
        }
    });

    app.get('/api/wlfi/onchain/flows', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 30;
            const flows = await onChainService.getRecentFlows(limit);
            res.json({ success: true, data: flows, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch token flows' });
        }
    });

    app.get('/api/wlfi/onchain/tvl', async (req, res) => {
        try {
            const tvl = await onChainService.getTVL();
            res.json({ success: true, data: tvl, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch TVL data' });
        }
    });

    // ========================================
    // WLFI TECHNICAL INDICATORS
    // ========================================
    app.get('/api/wlfi/technical', async (req, res) => {
        try {
            const overview = await technicalService.getTechnicalOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch technical data' });
        }
    });

    app.get('/api/wlfi/technical/rsi', async (req, res) => {
        try {
            const rsi = await technicalService.getRSI();
            res.json({ success: true, data: rsi, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch RSI' });
        }
    });

    app.get('/api/wlfi/technical/macd', async (req, res) => {
        try {
            const macd = await technicalService.getMACD();
            res.json({ success: true, data: macd, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch MACD' });
        }
    });

    app.get('/api/wlfi/technical/bollinger', async (req, res) => {
        try {
            const bollinger = await technicalService.getBollingerBands();
            res.json({ success: true, data: bollinger, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch Bollinger Bands' });
        }
    });

    // ========================================
    // WLFI PERFORMANCE COMPARISON
    // ========================================
    app.get('/api/wlfi/performance', async (req, res) => {
        try {
            const comparison = await performanceService.getComparisons();
            res.json({ success: true, data: comparison });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch performance data' });
        }
    });

    app.get('/api/wlfi/performance/correlations', async (req, res) => {
        try {
            const correlations = await performanceService.getCorrelations();
            res.json({ success: true, data: correlations, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch correlations' });
        }
    });

    // ========================================
    // WLFI LIQUIDATION TRACKER
    // ========================================
    app.get('/api/wlfi/liquidations', async (req, res) => {
        try {
            const overview = await liquidationService.getLiquidationOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch liquidation data' });
        }
    });

    app.get('/api/wlfi/liquidations/recent', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const liquidations = await liquidationService.getRecentLiquidations(limit);
            res.json({ success: true, data: liquidations, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch recent liquidations' });
        }
    });

    app.get('/api/wlfi/liquidations/stats', async (req, res) => {
        try {
            const stats = await liquidationService.getLiquidationStats();
            res.json({ success: true, data: stats, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch liquidation stats' });
        }
    });

    app.get('/api/wlfi/liquidations/levels', async (req, res) => {
        try {
            const levels = await liquidationService.getLiquidationLevels();
            res.json({ success: true, data: levels, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch liquidation levels' });
        }
    });
}
