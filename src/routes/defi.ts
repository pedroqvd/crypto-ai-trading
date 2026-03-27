import express from 'express';
import { DeFiLlamaService } from '../services/defi/DeFiLlamaService';
import { BlockchainService } from '../services/onchain/BlockchainService';

interface DeFiServices {
    defiLlamaService: DeFiLlamaService;
    blockchainService: BlockchainService;
}

export function defiRoutes(app: express.Application, services: DeFiServices): void {
    const { defiLlamaService, blockchainService } = services;

    // ========================================
    // DEFI LLAMA ROUTES
    // ========================================
    app.get('/api/defi/overview', async (req, res) => {
        try {
            const overview = await defiLlamaService.getDeFiOverview();
            res.json({ success: true, data: overview });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch DeFi overview' });
        }
    });

    app.get('/api/defi/protocols', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 30;
            const protocols = await defiLlamaService.getProtocols(limit);
            res.json({ success: true, count: protocols.length, data: protocols });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch protocols' });
        }
    });

    app.get('/api/defi/chains', async (req, res) => {
        try {
            const chains = await defiLlamaService.getChains();
            res.json({ success: true, count: chains.length, data: chains });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch chains' });
        }
    });

    // ========================================
    // ON-CHAIN ROUTES (Bitcoin)
    // ========================================
    app.get('/api/onchain/btc', async (req, res) => {
        try {
            const stats = await blockchainService.getStats();
            res.json({ success: true, data: stats });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch BTC on-chain' });
        }
    });

    app.get('/api/onchain/mempool', async (req, res) => {
        try {
            const mempool = await blockchainService.getMempoolCount();
            res.json({ success: true, data: mempool });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch mempool' });
        }
    });
}
