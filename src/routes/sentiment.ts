import express from 'express';
import { FearGreedService } from '../services/sentiment/FearGreedService';
import { PolymarketService } from '../services/sentiment/PolymarketService';
import { PolymarketTraderService } from '../services/sentiment/PolymarketTraderService';

interface SentimentServices {
    fearGreedService: FearGreedService;
    polymarketService: PolymarketService;
    polymarketTraderService: PolymarketTraderService;
}

export function sentimentRoutes(app: express.Application, services: SentimentServices): void {
    const { fearGreedService, polymarketService, polymarketTraderService } = services;

    // ========================================
    // SENTIMENT ROUTES (Fear & Greed + Polymarket)
    // ========================================
    app.get('/api/sentiment/fear-greed', async (req, res) => {
        try {
            const data = await fearGreedService.getHistoryWithTrend();
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch Fear & Greed' });
        }
    });

    app.get('/api/sentiment/polymarket', async (req, res) => {
        try {
            const report = await polymarketService.getCryptoSentimentReport();
            res.json({ success: true, data: report });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch Polymarket sentiment' });
        }
    });

    app.get('/api/sentiment/polymarket/search', async (req, res) => {
        try {
            const query = req.query.q as string;
            if (!query) {
                return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
            }
            const markets = await polymarketService.searchMarkets(query);
            res.json({ success: true, count: markets.length, data: markets });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to search Polymarket' });
        }
    });

    // ========================================
    // POLYMARKET TRADER TRACKING ROUTES
    // ========================================
    app.get('/api/polymarket/top-traders', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            const traders = await polymarketTraderService.getTopTraders(limit);
            res.json({ success: true, count: traders.length, data: traders });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch top traders' });
        }
    });

    app.get('/api/polymarket/trader/:address', async (req, res) => {
        try {
            const address = req.params.address;
            const name = req.query.name as string | undefined;
            if (!address || !address.startsWith('0x')) {
                return res.status(400).json({ success: false, error: 'Valid Ethereum address required (0x...)' });
            }
            const profile = await polymarketTraderService.buildTraderProfile(address, name);
            res.json({ success: true, data: profile });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch trader profile' });
        }
    });

    app.get('/api/sentiment/overview', async (req, res) => {
        try {
            const [fearGreed, polymarket] = await Promise.allSettled([
                fearGreedService.getHistoryWithTrend(),
                polymarketService.getCryptoSentimentReport()
            ]);

            res.json({
                success: true,
                data: {
                    fearGreed: fearGreed.status === 'fulfilled' ? fearGreed.value : null,
                    polymarket: polymarket.status === 'fulfilled' ? polymarket.value : null,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch sentiment overview' });
        }
    });
}
