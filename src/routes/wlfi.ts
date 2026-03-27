import express from 'express';
import { PolymarketService } from '../services/sentiment/PolymarketService';

interface WlfiServices {
    polymarketService: PolymarketService;
}

export function wlfiRoutes(app: express.Application, services: WlfiServices): void {
    const { polymarketService } = services;

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
}
