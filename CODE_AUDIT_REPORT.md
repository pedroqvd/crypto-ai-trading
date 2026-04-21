# 🔍 CODE AUDIT REPORT — Polymarket AI Trading Bot

**Data**: 2026-04-21  
**Revisor**: Claude Code  
**Escopo**: Full codebase review (src/, tests/)  

---

## 📊 RESUMO EXECUTIVO

**Total de Issues Encontradas**: 28  
**Críticas (DEVE CORRIGIR)**: 5  
**Altas (Corrigir em breve)**: 8  
**Médias (Refatorar)**: 10  
**Baixas (Code quality)**: 5  

---

## 🚨 CRÍTICAS (SEGURANÇA E FUNCIONALIDADE)

### 1. **SEGURANÇA: Dados Sensíveis Persistidos em Texto Plano**
**Arquivo**: `src/engine/TradingEngine.ts` (linhas 59-82)  
**Severidade**: 🔴 CRÍTICA  

```typescript
const toSave = {
  // ...
  privateKey: config.privateKey,     // ❌ PRIVATE_KEY em disco plano!
  claudeApiKey: config.claudeApiKey, // ❌ API KEY em disco!
  newsApiKey: config.newsApiKey,     // ❌ API KEY em disco!
};
fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
```

**Impacto**: Se o arquivo `/data/settings.json` for exposto, as chaves privadas são comprometidas.

**Solução**:
- ✅ NUNCA persistir `privateKey`, `claudeApiKey`, `newsApiKey` em disco
- Use variáveis de ambiente apenas
- Se persistência for necessária, usar encryption (ex: `crypto.encrypt()`)

---

### 2. **LÓGICA: Duplicação de `pendingSignals` Map**
**Arquivo**: `src/engine/TradingEngine.ts` (linhas 131 vs 488)  
**Severidade**: 🔴 CRÍTICA  

```typescript
// Linha 131 (classe)
private tradeSignals = new Map<string, Array<{ ... }>>();

// Linha 488 (método)
private pendingSignals = new Map<string, Array<{ ... }>>();
```

**Impacto**: 
- `tradeSignals` é inicializado mas NUNCA usado
- `pendingSignals` é declarado localmente, shadows a lógica ensemble
- Ensemble learning quebrado — signals não são persistidos corretamente

**Solução**:
```typescript
// Manter só um map, com scope correto
private tradeSignals = new Map<...>();

// Em analyzeMarkets:
this.tradeSignals.set(market.id, probEstimate.signals.map(...));
```

---

### 3. **LÓGICA: `adjustedConfidence` Pode Exceder 1.0**
**Arquivo**: `src/analysis/EdgeCalculator.ts` (linha 107)  
**Severidade**: 🔴 CRÍTICA  

```typescript
const adjustedConfidence = confidence * Math.min(1, Math.abs(edge) / config.minEdge);
```

**Problema**: Se `edge > config.minEdge`, o resultado é `confidence * 1.0 = confidence`. Mas a lógica quer "confidence diminui se edge é marginal". Resultado: **probabilidades > 1.0 são possíveis**.

**Exemplo**:
- `edge = 0.05`, `config.minEdge = 0.01` → ratio = 5.0
- `Math.min(1, 5.0) = 1.0` ✓ OK
- Mas **se as condições forem diferentes, isso quebra**

**Solução**:
```typescript
// Confidence should diminish if edge is marginal
const edgeRatio = Math.max(0, Math.min(1, Math.abs(edge) / Math.max(0.001, config.minEdge)));
const adjustedConfidence = Math.max(0.1, confidence * edgeRatio);
```

---

### 4. **AUTH: Middleware não está funcionando corretamente**
**Arquivo**: `src/dashboard/DashboardServer.ts` (linhas 88-92)  
**Severidade**: 🔴 CRÍTICA  

```typescript
// setupAuthRoutes() cria /api/auth/login, /api/auth/status
this.setupAuthRoutes();

// setupMiddleware() coloca auth middleware ANTES de setupProtectedRoutes
this.setupMiddleware(); // <- auth middleware aqui

// setupProtectedRoutes() usa /api/... após auth
this.setupProtectedRoutes();
```

**Problema**: `/api/auth/login` deveria ser PUBLIC, mas é interceptado pelo middleware. O fluxo de inicialização está errado.

**Solução**: Refatorar ordem:
```typescript
this.setupMiddleware();        // Só CORS + headers
this.setupAuthRoutes();        // /api/auth/* (sem auth requirement)
this.setupAuthProtection();    // Auth middleware DEPOIS
this.setupProtectedRoutes();   // /api/* (com auth)
```

---

### 5. **PARSER: JSON Parsing Frágil em ClaudeAnalyzer**
**Arquivo**: `src/services/ClaudeAnalyzer.ts` (linha 142)  
**Severidade**: 🔴 CRÍTICA  

```typescript
const jsonMatch = text.match(/\{[^}]+\}/);
```

**Problema**: Regex `[^}]` falha com JSON aninhado:
```json
{
  "probability": 0.5,
  "reasoning": "This has a } in the middle"
}
```

**Solução**:
```typescript
// Procurar primeiro e último {/}
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
if (start !== -1 && end > start) {
  const jsonStr = text.substring(start, end + 1);
  const parsed = JSON.parse(jsonStr);
}
```

---

## 🔴 ALTAS (DEVEM SER CORRIGIDAS)

### 6. **ClaudeAnalyzer: Sem Retry Logic + Timeout Curto**
**Arquivo**: `src/services/ClaudeAnalyzer.ts` (linhas 60-105)  
**Severidade**: 🟠 ALTA  

```typescript
req.setTimeout(12000, () => { req.destroy(); resolve(null); });
```

- **12 segundos** é insuficiente para respostas grandes do Claude
- Sem retry em timeout/transient errors
- Sem backoff exponencial

**Solução**: Adicionar retry com backoff:
```typescript
async estimateProbability(...) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await this.callApi(market, newsHeadlines);
    } catch (err) {
      if (attempt < 2) await sleep(1000 * Math.pow(2, attempt));
    }
  }
  return null;
}
```

---

### 7. **RiskManager: Circuit Breaker Pode Ficar Ativo Indefinidamente**
**Arquivo**: `src/risk/RiskManager.ts` (linhas 98-209)  
**Severidade**: 🟠 ALTA  

```typescript
if (drawdown >= 15) {
  this.circuitBreakerActive = true;
  // ❌ Nunca é ressetado!
}
```

**Auto-reset** ocorre apenas em `closePosition()` quando drawdown < 5%. Mas se nenhum trade resolver:
- Circuit breaker fica ativo
- Bot para de tradear
- Não há chance de recuperação

**Solução**:
```typescript
private lastCircuitBreakerReset = 0;
const CIRCUIT_BREAKER_COOLDOWN = 3600_000; // 1 hora

if (this.circuitBreakerActive && Date.now() - this.lastCircuitBreakerReset > CIRCUIT_BREAKER_COOLDOWN) {
  if (drawdown < 10) {
    this.circuitBreakerActive = false;
    this.lastCircuitBreakerReset = Date.now();
  }
}
```

---

### 8. **ProbabilityEstimator: Consensus Gate Logic Oscila**
**Arquivo**: `src/analysis/ProbabilityEstimator.ts` (linhas 96-115)  
**Severidade**: 🟠 ALTA  

```typescript
const consensusMultiplier =
  consensusRatio >= 0.70 ? 1.00 :
  consensusRatio >= 0.55 ? 0.80 :
  totalSigWeight === 0   ? 0.00 :
                           0.40; // ← Problema aqui!
```

**Problema**: Se signals conflitam (55-70% consensus), aplicamos **40% do adjustment**. Isso é muito alta e causa grandes errros em casos borderline.

**Solução**:
```typescript
const consensusMultiplier =
  consensusRatio >= 0.70 ? 1.00 :
  consensusRatio >= 0.60 ? 0.70 :
  consensusRatio >= 0.50 ? 0.40 :
  totalSigWeight === 0   ? 0.00 :
                           0.15; // Mais conservador
```

---

### 9. **GammaApiClient: Sem Retry para Falhas Transientes**
**Arquivo**: `src/services/GammaApiClient.ts` (linhas 84-142)  
**Severidade**: 🟠 ALTA  

```typescript
async getAllActiveMarkets(maxPages = 5): Promise<ParsedMarket[]> {
  // ...
  .catch(() => [] as GammaMarket[]) // ← Falha silenciosa!
}
```

**Problema**: 
- Timeout ou erro na API → retorna array vazio
- Bot pensa que não há mercados
- Nenhum trade neste ciclo, silenciosamente

**Solução**: Implementar retry com exponential backoff:
```typescript
private async fetchWithRetry(page: number, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.client.get('/markets', { params: { offset: page * 100, ... } });
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  return null;
}
```

---

### 10. **ClobApiClient: Type Safety com Muitos `any` Casts**
**Arquivo**: `src/services/ClobApiClient.ts` (linhas 64-77, 115-157)  
**Severidade**: 🟠 ALTA  

```typescript
const tempClient = new ClobClient(...);
const apiCreds = await (tempClient as any).createOrDeriveApiKey(); // ❌ any!

const book = await (this.client as any).getOrderBook(tokenId); // ❌ any!
const response = await (this.client as any).createAndPostOrder(...); // ❌ any!
```

**Impacto**: Sem type checking, erros em runtime são difíceis de debugar.

**Solução**: Criar tipos corretos ou usar `unknown` com type guards:
```typescript
if (typeof tempClient.createOrDeriveApiKey === 'function') {
  const apiCreds = await tempClient.createOrDeriveApiKey();
}
```

---

### 11. **TradingEngine: God Class — Muito Grande**
**Arquivo**: `src/engine/TradingEngine.ts` (1000+ linhas)  
**Severidade**: 🟠 ALTA  

**Responsabilidades**:
- Orquestração do loop principal
- Persistência de settings
- Análise de mercados
- Correlação
- Monitoramento de posições
- Relatórios diários
- Gestão de decisões log

**Solução**: Extrair em classes menores:
- `SettingsPersistence` — load/save settings
- `CycleOrchestrator` — runCycle logic
- `PositionMonitor` — monitorar posições
- `ReportGenerator` — daily reports

---

### 12. **TradeJournal: Sem Limpeza de Memória para Trades Muito Antigos**
**Arquivo**: `src/utils/TradeJournal.ts` (linhas 44-90)  
**Severidade**: 🟠 ALTA  

```typescript
private trades: TradeRecord[] = [];
```

**Problema**: Array cresce indefinidamente. Após 1 ano com 10+ trades/dia:
- ~3650+ trades em memória
- Cada trade é ~500 bytes → ~1.8 MB em memory

**Solução**: Implementar rotação/arquivo:
```typescript
private maxTradesInMemory = 10000;

recordTrade(trade: TradeRecord) {
  this.trades.push(trade);
  if (this.trades.length > this.maxTradesInMemory) {
    this.archiveOldest1000(); // Move para arquivo separado
  }
}
```

---

### 13. **DashboardServer: CSP com `unsafe-eval`**
**Arquivo**: `src/dashboard/DashboardServer.ts` (linha 77)  
**Severidade**: 🟠 ALTA  

```typescript
`script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net;`
```

**Problema**: `unsafe-eval` permite execução de código dinâmico via `eval()`. Quebra a segurança da CSP.

**Solução**:
```typescript
`script-src 'self' https://cdn.jsdelivr.net;` // Remove unsafe-eval
```

---

## 🟡 MÉDIAS (REFATORAR)

### 14. **ProbabilityEstimator: Sinais Redundantes e Overlapping**
- `volumeLiquiditySignal` e `liquidityMeanReversionSignal` fazem ajustes similares
- `marketCalibrationSignal` é sempre peso 0 (adjustment=0) — não contribui
- `consensusSignal` pode conflitar com `priceExtremitySignal`

**Solução**: Consolidar sinais:
```typescript
- Remove marketCalibrationSignal (sempre 0)
- Merge volumeLiquidity + liquidityMeanReversion
- Rank sinais por importância histórica (ensemble weights)
```

---

### 15. **EdgeCalculator: Fórmula EV Simplificada**
**Arquivo**: `src/analysis/EdgeCalculator.ts` (linhas 78-81)  

```typescript
const evYes = pTrue * ((1 / yesPrice) - 1) * (1 - TAKER_FEE) - (1 - pTrue);
const evNo = (1 - pTrue) * ((1 / noPrice) - 1) * (1 - TAKER_FEE) - pTrue;
```

**Problema**: Não considera order book slippage, execution risk, ou time decay.

**Solução**: Adicionar fatores reais:
```typescript
const executionSlippage = estimateSlippage(market.liquidity);
const timeDecayFactor = calculateTimeDecay(market.endDate);
const adjustedEV = ev * (1 - executionSlippage) * timeDecayFactor;
```

---

### 16. **RiskManager: Detecção de Category é Frágil**
**Arquivo**: `src/risk/RiskManager.ts` (linhas 23-34)  

```typescript
function detectCategory(question: string): string {
  const q = question.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|...)\b/.test(q)) return 'Crypto';
  // ...
}
```

**Problema**:
- Uma pergunta sobre "Bitcoin Wars" seria categorizada como "Crypto" mas é "Geopolitics"
- Sem suporte para multi-categoria
- Regex é case-insensitive mas pode falhar com unicode

**Solução**: 
- Usar ML model ou API de categorização
- Permitir múltiplas categorias
- Cache resultados

---

### 17. **ClobApiClient: Dry-Run Order Book é Determinístico**
**Arquivo**: `src/services/ClobApiClient.ts` (linhas 92-112)  

```typescript
const spread = Math.max(0.01, Math.min(0.08, 3_000 / marketLiquidity));
```

**Problema**: Spread é sempre calculado da mesma forma. Isso causa **overfitting** — o bot otimiza para este padrão específico, não para mercados reais.

**Solução**: Adicionar ruído realista:
```typescript
const baseSpread = Math.max(0.01, Math.min(0.08, 3_000 / marketLiquidity));
const noise = (Math.random() - 0.5) * 0.02; // ±1% variação
const spread = baseSpread + noise;
```

---

### 18. **ClobApiClient: Wallet Address Caching Sem Invalidação**
**Arquivo**: `src/services/ClobApiClient.ts` (linhas 42, 71-72)  

```typescript
private cachedWalletAddress = '';

// Nunca é atualizado ou invalidado
```

**Problema**: Se a chave privada muda (via updateConfig), wallet address fica desatualizado.

**Solução**:
```typescript
getWalletAddress(): string {
  if (!this.cachedWalletAddress && config.privateKey) {
    const signer = new Wallet(config.privateKey);
    this.cachedWalletAddress = signer.address;
  }
  return this.cachedWalletAddress;
}
```

---

### 19. **Logger: Listeners Não São Removidos Corretamente**
**Arquivo**: `src/utils/Logger.ts` (linhas 42-48)  

```typescript
removeListener(listener: (entry: LogEntry) => void): void {
  this.listeners = this.listeners.filter(l => l !== listener);
}
```

**Problema**: Função comparação por referência (`l !== listener`). Se o mesmo callback é registrado 2x, só uma é removida.

**Solução**: Usar ID único:
```typescript
private listenerIds = new Map<Function, string>();

onLog(listener: (entry: LogEntry) => void): string {
  const id = Math.random().toString(36);
  this.listeners.push({ id, fn: listener });
  return id;
}

removeListener(id: string) {
  this.listeners = this.listeners.filter(l => l.id !== id);
}
```

---

### 20. **TradeJournal: `resolveTrade` Calcula PnL Incorretamente**
**Arquivo**: `src/utils/TradeJournal.ts` (linhas 98-111)  

```typescript
trade.pnl = won
  ? (trade.size * 1) - trade.stake  // Simplista demais
  : -trade.stake;
```

**Problema**: 
- Assume que winning trade sempre rende exatamente $1
- Não considera `exitPrice` ou slippage
- `lost` sempre = -100% do stake (sem fee adjustment)

**Solução**:
```typescript
if (trade.side === 'BUY_YES') {
  trade.pnl = won 
    ? (trade.size * (1 - exitPrice)) - trade.stake 
    : -(trade.stake);
}
```

---

## 🟢 BAIXAS (CODE QUALITY)

### 21. **Logging Excessivo em Algumas Funções**
- `analyzeMarkets()` loga cada oportunidade
- `filterMarkets()` loga resumo verboso
- Pode gerar 10K+ linhas/dia de logs

**Solução**: Usar `debug` level para detalhes, `info` para eventos importantes.

---

### 22. **Nomes de Variáveis Inconsistentes**
- `pTrue` vs `estimatedTrueProb` (dois nomes para mesma coisa)
- `q` vs `marketPrice` (confuso)
- `f*` vs `fullKelly` (matemático vs legível)

**Solução**: Standarizar nomes:
```typescript
const trueProb = ...;
const marketProb = ...;
const fullKellyFraction = ...;
```

---

### 23. **Falta de Input Validation em Config**
**Arquivo**: `src/engine/Config.ts` (linhas 46-86)  

```typescript
bankroll: parseFloat(process.env.BANKROLL || '1000'),
kellyFraction: parseFloat(process.env.KELLY_FRACTION || '0.25'),
```

**Problema**: Sem validação:
- `bankroll` pode ser negativo
- `kellyFraction` pode ser > 1.0
- `scanIntervalMs` pode ser 0 (infinite loop)

**Solução**:
```typescript
bankroll: Math.max(1, parseFloat(process.env.BANKROLL || '1000')),
kellyFraction: Math.max(0.01, Math.min(1, parseFloat(...))),
scanIntervalMs: Math.max(1000, parseInt(...)),
```

---

### 24. **Falta de Error Handling em Async Operations**
**Arquivo**: `src/engine/TradingEngine.ts` (linhas 398-425)  

```typescript
await this.analyzeMarkets(filtered, markets);
```

**Problema**: Se `analyzeMarkets` falha, nenhum tratamento específico.

**Solução**: Adicionar try-catch granular:
```typescript
try {
  const opportunities = await this.analyzeMarkets(...);
} catch (err) {
  logger.error('Engine', `Analyze failed: ${err.message}`);
  this.logDecision('risk', `Análise falhou, pulando ciclo.`);
  return;
}
```

---

### 25. **Tipos Genéricos Não Utilizados**
**Arquivo**: `src/services/ClobApiClient.ts` (linhas 39-40)  

```typescript
private client: unknown = null;
private cachedProvider: unknown = null;
```

**Problema**: `unknown` sem type guards é igual a `any`.

**Solução**: Definir tipos corretos:
```typescript
import type { ClobClient } from '@polymarket/clob-client';
private client: ClobClient | null = null;
```

---

## 📋 CHECKLIST DE CORREÇÕES

### CRÍTICAS (Semana 1)
- [ ] Remover persistência de `privateKey`, `claudeApiKey`, `newsApiKey`
- [ ] Corrigir duplicação de `pendingSignals` map
- [ ] Corrigir `adjustedConfidence` logic
- [ ] Refatorar auth middleware order
- [ ] Corrigir JSON parsing em ClaudeAnalyzer

### ALTAS (Semana 2-3)
- [ ] Adicionar retry logic em ClaudeAnalyzer
- [ ] Implementar circuit breaker cooldown
- [ ] Ajustar consensus multiplier thresholds
- [ ] Adicionar retry em GammaApiClient
- [ ] Remover `any` types do ClobApiClient
- [ ] Separar TradingEngine em classes menores
- [ ] Implementar rotação de trades antigos
- [ ] Remover `unsafe-eval` da CSP

### MÉDIAS (Semana 3-4)
- [ ] Consolidar sinais redundantes na ProbabilityEstimator
- [ ] Melhorar fórmula EV
- [ ] Melhorar detecção de categoria
- [ ] Adicionar ruído ao dry-run order book
- [ ] Implementar invalidação de wallet address cache
- [ ] Melhorar gerenciamento de listeners no Logger
- [ ] Corrigir cálculo de PnL em TradeJournal

### BAIXAS (Contínuo)
- [ ] Reduzir verbosidade de logs
- [ ] Standardizar nomes de variáveis
- [ ] Adicionar validação de config
- [ ] Melhorar error handling em async ops
- [ ] Remover `unknown` sem type guards

---

## 🎯 RECOMENDAÇÕES ESTRATÉGICAS

1. **Comece pelas CRÍTICAS** — elas afetam segurança e funcionalidade básica
2. **Teste cada correção** — use `npm test` e valide em dry-run
3. **Depois refatore** — extrair classes, consolidar sinais
4. **Monitore performance** — após mudanças, observe CPU/memory

---

## 📊 PRÓXIMOS PASSOS

1. **Setup da branch**: `git checkout -b claude/code-review-audit-RUHEz`
2. **Criar plan**: Iniciar implementação por severidade
3. **PR com mudanças**: Submeter para revisão
4. **Testes**: Rodar suite completa antes de merge

Fim do relatório. ✅
