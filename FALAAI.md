# FALAAI.md — Histórico de Sessões entre IAs

> Este arquivo é o canal de comunicação entre sessões de IA.
> Sempre leia antes de começar. Sempre atualize ao terminar.

---

## Sessão Atual — 2026-04-15

**Branch:** `claude/review-incomplete-code-8qT6W`
**PR:** [#8](https://github.com/pedroqvd/crypto-ai-trading/pull/8)
**Status:** Aberto, aguardando Vercel re-deploy após fix do `vercel.json`

### O que foi feito

#### 1. Exit Strategy (`src/engine/TradingEngine.ts`)
- `monitorPositions()` agora verifica se o preço atual atingiu `EXIT_PRICE_TARGET` (padrão 85%)
- Quando atingido: envia ordem de SELL no CLOB ou simula em dry-run
- Chama `journal.exitTrade()` registrando pnl realizado

#### 2. Order Book Pre-check (`src/engine/TradingEngine.ts`)
- Antes de entrar em qualquer trade: verifica spread ≤ `MAX_ORDER_SPREAD_PCT` (3%)
- Verifica profundidade ≥ `MIN_ORDER_BOOK_SHARES` (5 shares)
- Limita size a 40% da liquidez disponível no book

#### 3. NewsAPI Integration (`src/services/NewsApiClient.ts`) — arquivo novo
- Integração com newsapi.org (100 req/dia no plano free)
- Cache de 30 min por mercado para economizar quota
- `extractKeywords()` extrai termos relevantes da pergunta do mercado
- `analyzeSentiment()` classifica bullish/bearish/null
- Notícias alinhadas ao edge: +8% confiança; contrárias: trade bloqueado
- Desativado automaticamente quando `NEWS_API_KEY` está vazia

#### 4. Correlation Analysis (`src/analysis/CorrelationAnalyzer.ts`) — arquivo novo
- Detecta over-book (soma YES > 1.0) e under-book (soma YES < 1.0)
- Identifica o mercado mais mispriced de cada evento
- Oportunidades logadas como decisões no dashboard
- Controlado por `CORRELATION_ENABLED` (padrão true)

#### 5. Market Age Signal — Signal #8 (`src/analysis/ProbabilityEstimator.ts`)
- Mercados < 2 dias: weight 1.5, nudge de mean-reversion de 2.5%
- Mercados < 7 dias: weight 1.0, nudge de 1%
- Mercados > 60 dias: weight 1.0, adjustment 0 (mercado maduro, confiar)
- Total de signals subiu de 7 para 8

#### 6. Status 'exited' (`src/utils/TradeJournal.ts`, `public/js/dashboard.js`)
- Novo status no union: `'open' | 'won' | 'lost' | 'cancelled' | 'exited'`
- `exitTrade(tradeId, exitPrice, pnl)` grava saída antecipada
- Dashboard exibe label "💰 Saída" para trades com status `exited`

#### 7. Fix Vercel Deploy
- **Causa raiz:** PR #7 foi mergeado sem `vercel.json` → Vercel não achava entrypoint Express
- **Fix 1:** `vercel.json` criado com `@vercel/node` apontando para `src/index.ts`
- **Fix 2:** `src/index.ts` refatorado para `export default app` (handler serverless)
- **Fix 3:** `engine.start()` e `dashboard.start()` guardados por `if (!process.env.VERCEL)`
- **Fix 4:** `DashboardServer.getExpressApp()` adicionado para expor o Express app
- **Fix 5 (PR #8):** `functions` e `builds` não podem coexistir no `vercel.json` — movido `maxDuration` para `builds[].config`

#### 8. gh CLI instalado no container Linux
- `apt-get install gh` funcionou via repositório Ubuntu padrão (v2.45.0)
- Autenticado com token PAT do usuário `pedroqvd`
- **Atenção:** O token foi configurado nesta sessão; pode expirar ou ser revogado

### Variáveis de Ambiente Novas
```env
EXIT_PRICE_TARGET=0.85        # Sai quando YES atinge 85%
MAX_ORDER_SPREAD_PCT=0.03     # Spread máximo bid-ask aceito
MIN_ORDER_BOOK_SHARES=5       # Profundidade mínima no book
NEWS_API_KEY=                 # newsapi.org (opcional)
NEWS_RELEVANCE_HOURS=6        # Janela de relevância das notícias
CORRELATION_ENABLED=true      # Detectar inconsistências entre mercados
```

### Arquivos Criados
- `vercel.json`
- `src/services/NewsApiClient.ts`
- `src/analysis/CorrelationAnalyzer.ts`

### Arquivos Modificados
- `src/index.ts` — export default + guard VERCEL
- `src/dashboard/DashboardServer.ts` — getExpressApp()
- `src/engine/TradingEngine.ts` — exit strategy, order book check, news, correlation
- `src/engine/Config.ts` — 6 novos parâmetros
- `src/analysis/ProbabilityEstimator.ts` — Signal #8 + news boost
- `src/utils/TradeJournal.ts` — status 'exited' + exitTrade()
- `src/services/GammaApiClient.ts` — ParsedEvent, createdAt, getActiveEventsWithMarkets()
- `public/js/dashboard.js` — label 'exited'
- `.env.example` — novos campos documentados
- `tests/ProbabilityEstimator.test.ts` — makeMarket() + signal count 8

### Estado dos Testes
```
148 testes passando (8 suites)
tsc --noEmit: zero erros
```

### Pendências
- [ ] Aguardar Vercel re-deploy do PR #8 (fix do `vercel.json`)
- [ ] Mesclar PR #8 quando CI passar
- [ ] Configurar variáveis de ambiente no Vercel (painel do projeto)
- [ ] Socket.IO não funciona no Vercel (limitação arquitetural) — para bot completo usar Railway/Render/Fly.io

---

## Sessão Anterior — 2026-04-14

**Branch:** `claude/review-incomplete-code-8qT6W`
**PR:** [#7](https://github.com/pedroqvd/crypto-ai-trading/pull/7) — MERGED (com falha de CI no Vercel)
**Commit:** `1e705b6`

### O que foi feito

8 melhorias de qualidade implementadas:

1. **Safety — Dry-run guard duplo:** verificação explícita de `config.dryRun` antes de qualquer chamada ao CLOB
2. **Signal accuracy — Calibration signal:** novo sinal comparando preço de mercado com histórico de calibração do Polymarket
3. **UX — Banner de startup melhorado:** exibe configuração completa ao iniciar (Kelly, edge mínimo, bankroll, etc.)
4. **Risk — Circuit breaker de drawdown:** para o engine se o drawdown ultrapassar threshold configurável
5. **Data — Persistência de decisões:** `recentDecisions` salvo em disco junto com posições abertas
6. **Signal — Volume ponderado por tempo:** sinal de volume considera janela temporal recente vs. total
7. **UX — Notificações granulares:** Discord/log distingue entre oportunidade encontrada, trade executado e trade resolvido
8. **Test — 148 testes unitários:** cobertura dos módulos principais

---

## Contexto do Projeto

**Repositório:** `pedroqvd/crypto-ai-trading`
**Stack:** TypeScript + Node.js, Express, Socket.IO, Polymarket CLOB SDK, ethers v5
**Deploy dashboard:** Vercel (somente dashboard, sem engine)
**Deploy bot completo:** Railway / Render / Fly.io / VPS (necessita processo persistente)

**Arquitetura:**
```
src/
  engine/          TradingEngine (loop autônomo), Config
  analysis/        ProbabilityEstimator (8 sinais), EdgeCalculator, KellyCalculator, CorrelationAnalyzer
  services/        GammaApiClient (market data), ClobApiClient (trading), NewsApiClient, NotificationService
  risk/            RiskManager (circuit breakers, position limits)
  dashboard/       DashboardServer (Express + Socket.IO)
  utils/           TradeJournal, Logger
  auth/            AuthService, authMiddleware
public/            Dashboard UI (read-only)
data/              Persistência: positions.json, trade_history.json, decisions.json
tests/             148 testes unitários
```

**Limitação conhecida — Vercel:**
- Funções stateless → `engine.start()` (loop contínuo) não roda no Vercel
- Socket.IO WebSocket não funciona (sem conexão persistente)
- Filesystem efêmero → `data/*.json` não persiste entre invocações
- Solução: dashboard estático no Vercel; bot + engine em host persistente

---

*Atualizado em: 2026-04-15 | Sessão: claude-sonnet-4-6*
