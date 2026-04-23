## Sessão Atual — 2026-04-23 (Otimização de Sinais & Validação de Infra)

**Branch:** `main`
**Status:** Motor de análise consolidado. Interface de validação de conectividade operacional no Dashboard.

### Melhorias de Engenharia (V3.1)

**1. Consolidação de Sinais Heurísticos** (`src/analysis/ProbabilityEstimator.ts`)
- Removida a redundância entre sinais de volume e liquidez.
- Implementado o `liquidityDynamicsSignal`: uma métrica unificada que evita a diluição por "zeros" neutros.
- Introduzido o **Calibration Dampening** para ajustar a agressividade da IA em mercados de alta eficiência.

**2. Sistema de Validação de API (Anti-Crash)**
- Adicionado endpoint `POST /api/config/test` e métodos de `testConnection()` em todos os serviços (Gamma, CLOB, Claude, News, Discord).
- Previne que o bot falhe silenciosamente no meio de um ciclo por chaves expiradas.

**3. Atualização do Diagnóstico e Framework**
- O arquivo `diagnostico_trades.md` foi gerado/atualizado detalhando o pipeline de 6 camadas (Scanner -> Estimator -> Edge -> Risk -> Executor -> Monitor).

---


## Sessão Atual — 2026-04-19 (Fase 2 Institucional & Market Maker)

**Branch:** `main` (ou branch de feature atual)
**Status:** Expansões Fase 2 concluídas. Aba Market Maker operante via Dashboard. Telegram ativo. CSS Responsivo.

### Expansão Arquitetural de 5 Camadas (Fase 2)

**1. Motor de *Dynamic Kelly*** (`src/risk/RiskManager.ts`)
- Novo multiplicador matemático lê o `Drawdown`.
- Se perda >5%, o `KellyFraction` sofre desconto de 50%. Se perda >10%, o desconto é de 75%. Isso estanca perdas contínuas drasticamente, transformando apostas de 1% em 0.25% para forçar a sobrevivência do capital em tempos sombrios, liberando gradualmente no momento de lucros.

**2. Bot do Telegram** (`src/services/NotificationService.ts`)
- Pipeline autônomo e informativo plugado via Axios para a API `api.telegram.org`.
- Permite uso de `.env` `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` para entregar reports formatados sem depender do Discord. Nenhuma aprovação requerida por lá. Apenas Data Mining puro caindo na sua tela.

**3. Integração Claude+News** (`src/engine/TradingEngine.ts`)
- O motor não apenas consulta Breaking News via `NewsApiClient`, como agora mapeia `newsHeadlines` para dentro da memória em tempo real do Claude LLM. Isso previne mortes por desastres onde a heurística detecta preço em queda como *'Value Edge'*, mas na verdade retrata um atentado ou desistência confirmada de candidato político.

**4. Design Responsivo do App** (`public/css/dashboard.css`)
- A UI no formato V2 era quebrada no Safari/Mobile. Adicionada regra `@media (max-width: 768px)` com uma transposição brilhante de CSS Grids para "Bottom Navigation Tab Menu" idêntico a um aplicativo nativo.

**5. Aba de Market Making (BETA)** (`src/engine/TradingEngine.ts` / Dashboard)
- A infraestrutura parou de forçar execuções na linha de frente (`Directional`) e agora suporta um regime em que a aba lateral (`/api/settings/mode`) muda a base do script para `MARKET_MAKER`.
- Quando ativo, o bot recua e oferta provisão de liquidez (+2% *Spread Advantage*) nos cantos do livro. É menos agressivo e paga o spread natural invertido para sua conta.

---

## Sessão Anterior — 2026-04-19 (Auditoria Geral e Correção do Algoritmo)

**Status:** Correções de Edge Calculator implementadas. Auditoria de Backend concluída.

### O que foi feito

#### Auditoria de Backend & Comunicações
Realizou-se uma auditoria profunda do código que controla o `TradingEngine`, conexões com a `GammaApiClient`, `ClobApiClient`, e Segurança do dashboard. O diagnóstico validou que:
- **Proteções de Capital:** Circuit Breakers rígidos (Interrupção em 15% de Drawdown, teto diário de perdas em 10% do bankroll limitam exposição catastrófica).
- **Proteção de Execução:** O CLOB client simula o impacto do trade baseado na profundidade da `liquidity` atual do OrderBook (`availableShares`), barrando compras acima de 40% da liquidez imediata para evitar *Slippage*.
- **Conformidade em Autenticação:** A separação com JWT nos Sockets e endpoints bloqueados blinda contra ataques remotos sem chave secreta.

#### A Descoberta: O Sufocamento Matemático de Trades 🚨
Apesar de um código majestoso e impecavelmente seguro, o bot **nunca executava compras.** 
- **Razão Fundamental:** A heurística de `ProbabilityEstimator.ts` operava de forma prejudicial. Se o bot encontrava uma anomalia em de volume (ajuste de +4%), mas 6 outras métricas retornavam "Neutro (Ajuste 0%)", o cálculo do "Média Ponderada" adicionava o peso dos 6 zeros e dividia o Edge pela somatória irreal, afundando o lucro para <0.5%.
- Com `MIN_EDGE` barrando qualquer coisa menor que 1%, nada operava.
- Ademais, o *Consensus Multiplier* (que avalia se os heurísticos convergem) também taxava a oportunidade excessivamente caso as lógicas discordassem, zerando o *Edge*.
- Spread da Polygon era barrado no hardcode limite de `3%`, mesmo existindo lucros massivos em spreads maiores típicos da Polymarket.

### Ações Corretivas Executadas (Hotfix)

1. `src/analysis/ProbabilityEstimator.ts` (19 Abr 2026, 16:51 GMT-3)
   - **Correção da Média:** O *loop* só considera adicionar `signal.weight` ao divisor caso o sinal apresente ativamente `signal.adjustment > 0.001` (abandono dos Zeros Neutros).
   - **Afrouxamento de Consenso:** Diminuído o taxamento cruel (se houvesse leve discordância o multiplicador caía pra 0.50 e pra 0.15). Foram alteradas as quebras de teto para manter `0.80`, e base `0.40`. O limite rígido final (*Cap*) pulou de 5% para poder capturar até `10%` (`0.10`) de assimetrias brutas no mercado.

2. `src/engine/Config.ts` (19 Abr 2026, 16:51 GMT-3)
   - **Tolerância de Spread Ampliada:** `maxOrderSpreadPct` escalonado de forma nativa de `0.03` para `0.08` (8%). Isso permite execuções em *orderbooks* voláteis onde a oportunidade de Edge é maior que as taxas brutas.

---

## Sessão Anterior — 2026-04-16

**Branch:** `claude/oracle-site-integration-ZXHoe`
**Status:** Implementação concluída, aguardando push e testes

### O que foi feito

#### Oracle ↔ Site Integration (link entre Oracle Cloud e o site/Vercel)

**Problema:** O frontend usava `io()` com URL relativa, então ao rodar no Vercel
o Socket.IO tentava conectar ao próprio Vercel (serverless, sem WebSocket) em vez
do Oracle Cloud VM onde o bot roda. As chamadas de API (`/api/trades` etc.) também
iam para o Vercel sem engine.

**Solução:** Endpoint público `/api/config` expõe `ORACLE_BACKEND_URL`. O frontend
busca esse endpoint no boot e usa a URL retornada para Socket.IO e todas as chamadas
de API. Quando rodando diretamente no Oracle Cloud, `backendUrl` é `''` e tudo
funciona com URL relativa (sem mudança de comportamento).

#### 1. `src/auth/authMiddleware.ts`
- Adicionado `/api/config` na lista de `publicPaths` (não requer JWT)

#### 2. `src/engine/Config.ts`
- Adicionados campos `oracleBackendUrl` (string) e `allowedOrigins` (string[])
- Lidos de `ORACLE_BACKEND_URL` e `ALLOWED_ORIGINS` (separados por vírgula)

#### 3. `src/dashboard/DashboardServer.ts`
- Endpoint público `GET /api/config` → `{ backendUrl: oracleBackendUrl }`
- CORS do Express e do Socket.IO agora usa `config.allowedOrigins` (ou `'*'` se vazio)
- CSP `connect-src` dinamicamente inclui `ORACLE_BACKEND_URL` (HTTP e WS) quando configurado

#### 4. `public/js/dashboard.js`
- Refatorado para async: `init()` busca `/api/config` antes de qualquer operação
- Socket.IO: `io(backendUrl, opts)` quando `backendUrl` está definido, senão `io(opts)`
- `authFetch(path)` prefixa `backendUrl` em todas as chamadas de API

#### 5. `public/js/login.js`
- Refatorado para async: `init()` busca `/api/config` antes de montar os listeners
- Função `apiCall(path, opts)` usa `backendUrl` como prefixo para `/api/auth/login` e `/api/auth/status`

#### 6. `.env.example`
- Adicionadas variáveis `ORACLE_BACKEND_URL` e `ALLOWED_ORIGINS` com documentação

### Variáveis de Ambiente Novas
```env
ORACLE_BACKEND_URL=   # URL do Oracle Cloud VM (ex: http://1.2.3.4:3000)
                      # Vazio = mesmo host (Oracle direct access)
ALLOWED_ORIGINS=      # CORS origins permitidas (ex: https://meuapp.vercel.app)
                      # Vazio = wildcard (*)
```

### Como configurar

**Cenário 1 — Oracle Cloud only (bot + dashboard no mesmo host):**
```env
# Não precisa configurar ORACLE_BACKEND_URL nem ALLOWED_ORIGINS
# Acesse http://<IP>:3000
```

**Cenário 2 — Vercel (frontend) + Oracle Cloud (backend):**
```env
# No Vercel (variáveis de ambiente do projeto):
ORACLE_BACKEND_URL=http://<IP_ORACLE>:3000
JWT_SECRET=<mesmo valor do Oracle>   # token precisa ser válido nos dois lados

# No Oracle Cloud (.env):
ALLOWED_ORIGINS=https://meuapp.vercel.app
JWT_SECRET=<mesmo valor do Vercel>
```

### Pendências
- [ ] Testar cenário Vercel → Oracle com IP real
- [ ] Verificar se o `JWT_SECRET` está sincronizado entre Vercel e Oracle (requisito de segurança)

---

## Sessão Anterior — 2026-04-15

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
MAX_ORDER_SPREAD_PCT=0.03     # Spread máximo bid-ask aceito ---> Hotfix: Agora 0.08
MIN_ORDER_BOOK_SHARES=5       # Profundidade mínima no book
NEWS_API_KEY=                 # newsapi.org (opcional)
NEWS_RELEVANCE_HOURS=6        # Janela de relevância das notícias
CORRELATION_ENABLED=true      # Detectar inconsistências entre mercados
```

## Contexto do Projeto
**Repositório:** `pedroqvd/crypto-ai-trading`
**Stack:** TypeScript + Node.js, Express, Socket.IO, Polymarket CLOB SDK, ethers v5
**Deploy dashboard:** Vercel (somente dashboard, sem engine)
**Deploy bot completo:** Railway / Render / Fly.io / VPS (necessita processo persistente)
