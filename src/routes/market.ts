import express from 'express';
import { CCXTService } from '../services/exchange/CCXTService';
import { CoinGeckoService } from '../services/market/CoinGeckoService';

interface MarketServices {
    ccxtService: CCXTService;
    coinGeckoService: CoinGeckoService;
}

export function marketRoutes(app: express.Application, services: MarketServices): void {
    const { ccxtService, coinGeckoService } = services;

    app.get('/api/market/tickers', async (req, res) => {
        try {
            const tickers = await ccxtService.getAllTickers();
            res.json({
                success: true,
                count: tickers.length,
                data: tickers,
                timestamp: Date.now()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch tickers'
            });
        }
    });

    app.get('/api/market/arbitrage/:symbol', async (req, res) => {
        try {
            const symbol = req.params.symbol;
            const opportunities = await ccxtService.findArbitrageOpportunities(symbol);
            res.json({ success: true, data: opportunities, timestamp: Date.now() });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Arbitrage check failed'
            });
        }
    });

    app.get('/api/market/stats', async (req, res) => {
        try {
            const stats = await ccxtService.getMarketStats();
            res.json({ success: true, data: stats });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Stats failed'
            });
        }
    });

    // ========================================
    // COINGECKO ROUTES
    // ========================================
    app.get('/api/coingecko/global', async (req, res) => {
        try {
            const data = await coinGeckoService.getGlobalData();
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch global data' });
        }
    });

    app.get('/api/coingecko/trending', async (req, res) => {
        try {
            const data = await coinGeckoService.getTrending();
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch trending' });
        }
    });

    app.get('/api/coingecko/top', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const data = await coinGeckoService.getTopCoins(Math.min(limit, 250));
            res.json({ success: true, count: data.length, data });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch top coins' });
        }
    });
}
