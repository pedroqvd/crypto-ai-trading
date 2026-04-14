# Polymarket AI Autonomous Trader

## Project Essence
Bot **100% autônomo** que opera no Polymarket. A IA escaneia mercados, identifica mispricings, calcula edge, dimensiona posições com Kelly e executa trades. O usuário acompanha via dashboard web.

## Core Formulas

### 1. Identificação de Erros de Precificação (Edge)
```
Edge = P_true - P_implied

P_true    = Probabilidade real estimada pelo modelo
P_implied = Preço de mercado (probabilidade implícita)
```

### 2. Cálculo Refinado de Valor Esperado (EV)
```
EV_yes = P_true × (1/q - 1) × (1 - fee) - (1 - P_true)
EV_no  = (1 - P_true) × (1/(1-q) - 1) × (1 - fee) - P_true

q = preço de mercado do YES
fee = ~2% (200 bps taker fee)
```

### 3. Fórmula de Kelly para Controle de Posição
```
f* = (p - q) / (1 - q)
stake = bankroll × (KELLY_FRACTION × f*)

Safety: stake ≤ bankroll × MAX_POSITION_PCT
        stake ≤ market_liquidity × 10%
```

## Architecture
- **Engine**: `src/engine/` — TradingEngine (loop autônomo), Config
- **Analysis**: `src/analysis/` — ProbabilityEstimator, EdgeCalculator, KellyCalculator
- **Services**: `src/services/` — GammaApiClient (market data), ClobApiClient (trading), NotificationService
- **Risk**: `src/risk/` — RiskManager (circuit breakers, position limits)
- **Dashboard**: `src/dashboard/` — DashboardServer (Express + WebSocket)
- **UI**: `public/` — Real-time monitoring dashboard (read-only)
- **Data**: `data/` — Persistent state (positions, trade history)

## Development Guidelines
- **Full Autonomy**: A IA gerencia TUDO. O dashboard é apenas leitura.
- **Freedom to Refactor**: Refazer qualquer módulo se necessário.
- **TypeScript Strict**: Sempre tipar. Evitar `any`.
- **DRY-RUN First**: Sempre testar em dry-run antes de live.
- **Risk First**: Nunca remover ou enfraquecer as proteções do RiskManager.

## Tech Stack
- TypeScript + Node.js
- `@polymarket/clob-client` — SDK oficial do Polymarket
- `ethers` v5 — Wallet e assinatura
- Express + Socket.IO — Dashboard + WebSocket real-time
- Axios — API calls

## Environment Variables
```
PRIVATE_KEY=          # Wallet private key (Polygon)
DRY_RUN=true          # true = simulação, false = trades reais
BANKROLL=1000         # Capital em USDC
KELLY_FRACTION=0.25   # Fração Kelly (0.25 = quarter-Kelly)
MIN_EDGE=0.03         # Edge mínimo (3%)
MIN_LIQUIDITY=5000    # Liquidez mínima do mercado
MIN_VOLUME=10000      # Volume mínimo
MAX_POSITION_PCT=0.05 # Máx 5% do bankroll por posição
SCAN_INTERVAL_MS=60000 # Scan a cada 60 segundos
DASHBOARD_PORT=3000
DISCORD_WEBHOOK_URL=  # Opcional
```
