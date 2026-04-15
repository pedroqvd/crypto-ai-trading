# FALAAI — Status do Projeto

> Última atualização: 2026-04-15

---

## O QUE FOI FEITO

### Engine Principal
- **`TradingEngine`** — Loop autônomo completo com 8 etapas por ciclo:
  1. Scan de mercados (Gamma API, até 5 páginas)
  2. Filtro de mercados (liquidez, volume, negRisk, faixa de preço 3%–97%)
  3. Análise de probabilidade + edge + EV
  4. Análise de correlação cross-market (over/under-book)
  5. Execução: checagem de notícias → order book → risco → trade
  6. Monitoramento de posições abertas (saída antecipada, ordem stale, resolução)
  7. Sync de saldo on-chain a cada 10 ciclos
  8. Relatório diário automático via Discord

- **`Config`** — Todas as variáveis de ambiente tipadas com defaults seguros. `DRY_RUN=true` por padrão.

### Análise
- **`ProbabilityEstimator`** — 8 sinais de microestrutura de mercado com consensus gate + liquidity dampening + news boost. Cap de ±5pp no ajuste final.
- **`EdgeCalculator`** — Fórmulas exatas de Edge/EV do CLAUDE.md com fee de 2%. Filtra somente oportunidades com edge ≥ `MIN_EDGE`.
- **`KellyCalculator`** — Quarter-Kelly com cap por posição (`MAX_POSITION_PCT`) e cap por liquidez (10% do book).
- **`CorrelationAnalyzer`** — Detecta inconsistências over/under-book entre mercados do mesmo evento no Polymarket. Identifica qual mercado está mispriced e recomenda BUY_YES ou BUY_NO.

### Serviços
- **`GammaApiClient`** — Busca mercados ativos paginados, mercados por evento e mercado por ID. Parsing completo para `ParsedMarket` e `ParsedEvent`.
- **`ClobApiClient`** — Integração com `@polymarket/clob-client` via `ethers` v5. Suporte a `placeLimitOrder` (BUY/SELL), `cancelOrder`, `getOrderBook`, `getOpenOrders`, `getBalance`. Dry-run mode simulado localmente.
- **`NotificationService`** — Discord webhook para: trade executado, trade ganho/perdido, risco, evento de sistema, relatório diário.
- **`NewsApiClient`** — newsapi.org com cache de 30 min por mercado. Análise de sentimento bullish/bearish por keywords. Rate-limit friendly (só chama para top 3 oportunidades/ciclo).

### Risco
- **`RiskManager`** — Proteções em camadas:
  - Circuit breaker ao atingir 15% de drawdown
  - Limite de perda diária (10% do bankroll)
  - Limite por posição (`MAX_POSITION_PCT`)
  - Limite de exposição total (`MAX_TOTAL_EXPOSURE_PCT`, padrão 50%)
  - Spread máximo no order book (`MAX_ORDER_SPREAD_PCT`, padrão 3%)
  - Profundidade mínima no book (`MIN_ORDER_BOOK_SHARES`, padrão 5 shares)
  - Cancelamento automático de ordens não preenchidas após 24h

### Autenticação
- **`AuthService`** — Login email/senha com bcrypt (12 salt rounds) + JWT (24h). Rate limiting: 5 tentativas → bloqueio de 15 minutos por IP.
- **`authMiddleware`** — Protege todas as rotas do dashboard. Socket.IO validado via query token.
- **`setup.ts`** — Script para gerar hash da senha e configurar `AUTH_EMAIL`, `AUTH_PASSWORD_HASH`, `JWT_SECRET` no `.env`.

### Dashboard
- **`DashboardServer`** — Express + Socket.IO com headers de segurança (CSP, X-Frame-Options, etc.). Rotas protegidas por JWT.
- **`public/index.html` + `dashboard.js` + `dashboard.css`** — Dashboard em tempo real: status do engine, P&L, bankroll, trades abertos/fechados, log de decisões, risco.
- **`public/login.html` + `login.js` + `login.css`** — Tela de login com feedback de erro e sessão JWT no localStorage.

### Utils
- **`Logger`** — Logger estruturado com níveis `debug/info/warn/error` e timestamps.
- **`TradeJournal`** — Persistência em `data/trade_history.json`. Métodos: `recordTrade`, `exitTrade`, `resolveTrade`, `cancelTrade`, `getStats`, `getOpenTrades`.

### Infraestrutura
- **`vercel.json`** — Configuração de deploy serverless.
- **148 testes unitários** em 8 arquivos cobrindo: EdgeCalculator, KellyCalculator, ProbabilityEstimator, RiskManager, TradeJournal, NotificationService, AuthService, authMiddleware.

---

## O QUE FALTA FAZER

### Alta Prioridade

- [ ] **`.env.example`** — Arquivo de exemplo com todas as variáveis necessárias comentadas. Sem isso, novos deploys são confusos.

- [ ] **Graceful shutdown** — Handler para `SIGTERM`/`SIGINT` no `src/index.ts`. Ao receber sinal, parar o engine, fechar o servidor HTTP e gravar estado antes de sair. Sem isso, um `Ctrl+C` mata o processo mid-cycle.

- [ ] **Deploy como processo persistente** — O bot é um loop infinito: incompatível com Vercel (max 60s). Precisa de guia/config para VPS (PM2) ou Docker. O `vercel.json` atual só serve para o dashboard estático.

- [ ] **Modelo de probabilidade real (IA/ML)** — O `ProbabilityEstimator` atual é puramente heurístico (sinais de microestrutura). Para um bot chamado "AI Trader", o próximo passo natural é um modelo real: Bayesian, LLM prompt-based, ou fine-tuned classifier em dados históricos do Polymarket.

### Média Prioridade

- [ ] **Backtesting** — Sem backtest, não é possível validar se a estratégia teria sido lucrativa no passado antes de arriscar capital real. Precisaria de: dataset histórico do Gamma API, simulador de execução com slippage, e métricas de performance (Sharpe, win rate, max drawdown).

- [ ] **P&L não realizado no dashboard** — Posições abertas no dashboard mostram apenas o preço de entrada. Falta buscar o preço atual de mercado e calcular o P&L não realizado em tempo real.

- [ ] **Gráfico de equity curve** — O dashboard mostra o bankroll atual mas não o histórico. Um gráfico de P&L acumulado ao longo do tempo seria essencial para acompanhar a performance.

- [ ] **Stop-loss por posição** — O `RiskManager` tem proteção a nível de portfólio (circuit breaker 15%), mas não tem stop-loss por trade individual. Falta: se preço cair X% abaixo do entry, vender automaticamente para limitar a perda.

- [ ] **Retry/backoff para falhas de API** — `GammaApiClient` e `ClobApiClient` não têm retry automático em falhas de rede. Um erro 429 ou timeout derruba o ciclo inteiro. Falta implementar exponential backoff.

- [ ] **Telegram como alternativa ao Discord** — Muitos usuários preferem Telegram. O `NotificationService` só suporta Discord webhook. Adicionar suporte a Telegram Bot API.

### Baixa Prioridade

- [ ] **Filtro por categoria de mercado** — O engine scanneia todos os mercados ativos. Seria útil poder configurar categorias (ex: só "Politics", excluir "Crypto") via variável de ambiente.

- [ ] **Export CSV do histórico** — Um endpoint `/api/trades/export` para baixar `trade_history.json` como CSV. Útil para análise externa.

- [ ] **Modal de detalhe de trade no dashboard** — Clicar em um trade na tabela deveria abrir um modal com todos os campos: sinais do ProbabilityEstimator, reasoning, histórico de preço, edge no momento da entrada.

- [ ] **Sentiment analysis com LLM** — A análise de notícias atual usa keyword matching simples. Um LLM (ex: Claude via API) daria respostas muito mais precisas sobre se uma notícia é bullish/bearish para o outcome específico da pergunta.

- [ ] **Docker + docker-compose** — Para facilitar o deploy em VPS. Um `Dockerfile` com build TypeScript + `docker-compose.yml` com volume para `data/` e `.env` seria o setup ideal para produção.

- [ ] **Verificação de integridade do CLOB em live** — O `ClobApiClient` foi desenvolvido contra a API do Polymarket mas não foi testado com capital real. Antes de mudar `DRY_RUN=false`, fazer um checklist de integração: autenticação da wallet, placing de ordem mínima, cancelamento.

---

## RESUMO

| Categoria | Status |
|---|---|
| Engine autônomo | ✅ Completo |
| Análise heurística (8 sinais) | ✅ Completo |
| Kelly + gestão de risco | ✅ Completo |
| Correlação cross-market | ✅ Completo |
| Integração Gamma API | ✅ Completo |
| Integração CLOB (trades) | ✅ Completo (dry-run testado) |
| Notificações Discord | ✅ Completo |
| Integração notícias | ✅ Completo |
| Dashboard + Auth JWT | ✅ Completo |
| Testes unitários (148) | ✅ Completo |
| `.env.example` | ❌ Faltando |
| Graceful shutdown | ❌ Faltando |
| Deploy persistente (Docker/PM2) | ❌ Faltando |
| Modelo de IA real | ❌ Faltando |
| Backtesting | ❌ Faltando |
| P&L não realizado | ❌ Faltando |
| Equity curve no dashboard | ❌ Faltando |
| Stop-loss por posição | ❌ Faltando |
