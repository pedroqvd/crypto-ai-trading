import express from 'express';
import { AnthropicService } from '../services/ai/AnthropicService';
import { FearGreedService } from '../services/sentiment/FearGreedService';
import { DeFiLlamaService } from '../services/defi/DeFiLlamaService';
import { BlockchainService } from '../services/onchain/BlockchainService';
import { PolymarketService } from '../services/sentiment/PolymarketService';

interface ClaudeServices {
    anthropicService: AnthropicService;
    fearGreedService: FearGreedService;
    defiLlamaService: DeFiLlamaService;
    blockchainService: BlockchainService;
    polymarketService: PolymarketService;
}

export function claudeRoutes(app: express.Application, services: ClaudeServices): void {
    const { anthropicService, fearGreedService, defiLlamaService, blockchainService, polymarketService } = services;

    app.post('/api/claude/chat', async (req, res) => {
        try {
            const { message } = req.body;

            if (!message || typeof message !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Message is required'
                });
            }

            // Enriquecer contexto com dados de mercado para o Claude
            let enrichedMessage = message;

            if (req.body.includeContext !== false) {
                try {
                    const [fearGreedSummary, defiSummary, onChainSummary, polymarketSummary] = await Promise.allSettled([
                        fearGreedService.getSentimentSummary(),
                        defiLlamaService.getDeFiSummary(),
                        blockchainService.getOnChainSummary(),
                        polymarketService.getCryptoSentimentReport()
                    ]);

                    let context = '\n\n--- Contexto de Mercado Atual ---\n';
                    if (fearGreedSummary.status === 'fulfilled') context += fearGreedSummary.value + '\n';
                    if (defiSummary.status === 'fulfilled') context += defiSummary.value + '\n';
                    if (onChainSummary.status === 'fulfilled') context += onChainSummary.value + '\n';
                    if (polymarketSummary.status === 'fulfilled' && polymarketSummary.value.summary) {
                        context += polymarketSummary.value.summary + '\n';
                    }

                    enrichedMessage = message + context;
                } catch {
                    // Continuar sem contexto se falhar
                }
            }

            const response = await anthropicService.chat(enrichedMessage);

            res.json({
                success: true,
                response,
                timestamp: Date.now()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                response: 'Sistema em modo demo.'
            });
        }
    });
}
