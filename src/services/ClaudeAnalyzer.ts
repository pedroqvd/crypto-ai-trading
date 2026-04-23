// ================================================
// CLAUDE ANALYZER — LLM-powered probability estimation
// Calls the Anthropic API to get a calibrated probability
// estimate for prediction market questions.
//
// Rate-limited to maxCallsPerCycle per engine cycle.
// Results are cached for CACHE_TTL_MS to avoid redundant calls.
// ================================================

import * as https from 'https';
import { ParsedMarket } from './GammaApiClient';
import { logger } from '../utils/Logger';

export interface ClaudeEstimate {
  probability: number;
  confidence: number;
  reasoning: string;
  cached: boolean;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class ClaudeAnalyzer {
  private readonly apiKey: string;
  private cache: Map<string, { estimate: ClaudeEstimate; ts: number }> = new Map();
  private callsThisCycle = 0;
  private readonly maxCallsPerCycle: number;

  constructor(apiKey: string, maxCallsPerCycle = 5) {
    this.apiKey = apiKey;
    this.maxCallsPerCycle = maxCallsPerCycle;
  }

  async testConnection(): Promise<boolean> {
    if (!this.apiKey) return false;
    // Tiny no-op style request to verify key
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Ping' }],
    });
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        res => {
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    });
  }

  resetCycleCounter(): void {
    this.callsThisCycle = 0;
  }

  async estimateProbability(
    market: ParsedMarket,
    newsHeadlines?: string[]
  ): Promise<ClaudeEstimate | null> {
    if (!this.apiKey) return null;
    if (this.callsThisCycle >= this.maxCallsPerCycle) return null;

    const bucketKey = `${market.id}-${Math.floor(Date.now() / CACHE_TTL_MS)}`;
    const cached = this.cache.get(bucketKey);
    if (cached) return { ...cached.estimate, cached: true };

    this.callsThisCycle++;
    // Retry once on timeout — LLM API can be slow under load.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const estimate = await this.callApi(market, newsHeadlines);
        if (estimate) this.cache.set(bucketKey, { estimate, ts: Date.now() });
        return estimate;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');
        if (attempt === 2 || !isTimeout) {
          logger.warn('Claude', `API call failed: ${msg}`);
          return null;
        }
        logger.warn('Claude', `API timeout on attempt ${attempt}, retrying…`);
      }
    }
    return null;
  }

  private callApi(market: ParsedMarket, newsHeadlines?: string[]): Promise<ClaudeEstimate | null> { // rejects on timeout/network
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: this.buildPrompt(market, newsHeadlines) }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const text = parsed.content?.[0]?.text?.trim();
              if (!text) { resolve(null); return; }
              const estimate = this.parseResponse(text, market);
              if (estimate) {
                logger.debug('Claude',
                  `"${market.question.substring(0, 50)}..." → ` +
                  `prob=${(estimate.probability * 100).toFixed(0)}% ` +
                  `conf=${(estimate.confidence * 100).toFixed(0)}%`
                );
              }
              resolve(estimate);
            } catch { resolve(null); }
          });
        }
      );
      req.on('error', (err) => { reject(err); });
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  private buildPrompt(market: ParsedMarket, newsHeadlines?: string[]): string {
    const price = (market.yesPrice * 100).toFixed(0);
    const endDate = market.endDate
      ? new Date(market.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'unknown';

    let prompt =
      `You are a calibrated superforecaster analysing a prediction market.\n\n` +
      `Question: "${market.question}"\n` +
      `Current market price (implied probability): ${price}%\n` +
      `Resolution date: ${endDate}`;

    if (market.description && market.description.length > 30) {
      prompt += `\nMarket context: ${market.description.substring(0, 400)}`;
    }

    if (newsHeadlines && newsHeadlines.length > 0) {
      prompt += `\nRecent relevant news:\n${newsHeadlines.map(h => `• ${h}`).join('\n')}`;
    }

    prompt +=
      `\n\nRespond ONLY with valid JSON in exactly this format:\n` +
      `{"probability": 0.XX, "confidence": 0.X, "reasoning": "one sentence"}\n\n` +
      `Rules:\n` +
      `- probability: your calibrated estimate for YES (0.01–0.99)\n` +
      `- confidence: 0.3 = low, 0.5 = moderate, 0.7 = high, 0.9 = very high\n` +
      `- If you have insufficient information, keep probability close to market price and confidence ≤ 0.4\n` +
      `- Do NOT repeat the market price as your estimate without reasoning`;

    return prompt;
  }

  private parseResponse(text: string, market: ParsedMarket): ClaudeEstimate | null {
    try {
      // Use first '{' and last '}' to handle JSON with nested braces or '}' inside strings.
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      const parsed = JSON.parse(text.substring(start, end + 1));

      const probability = parseFloat(parsed.probability);
      const confidence = parseFloat(parsed.confidence);
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

      if (isNaN(probability) || isNaN(confidence)) return null;
      if (probability < 0.01 || probability > 0.99) return null;
      if (confidence < 0.1 || confidence > 0.95) return null;

      // Sanity: if Claude barely differs from market, treat as low-signal
      const deviation = Math.abs(probability - market.yesPrice);
      if (deviation < 0.02 && confidence > 0.5) {
        return { probability, confidence: 0.3, reasoning, cached: false };
      }

      return {
        probability: Math.max(0.01, Math.min(0.99, probability)),
        confidence: Math.max(0.1, Math.min(0.9, confidence)),
        reasoning,
        cached: false,
      };
    } catch { return null; }
  }
}
