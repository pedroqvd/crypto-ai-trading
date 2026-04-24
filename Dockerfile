# ================================================
# Polymarket AI Trader — Dockerfile
# Multi-stage build: compila TypeScript e cria
# imagem mínima para produção (~180MB)
# ================================================

# ---- Estágio 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copia manifests primeiro (cache layer)
COPY package*.json ./
COPY tsconfig.json ./

# Instala TODAS as dependências (incluindo devDeps para compilar)
RUN npm ci

# Copia código fonte e compila
COPY src/ ./src/
RUN npm run build

# Remove devDependencies após build
RUN npm prune --production

# ---- Estágio 2: Runtime ----
FROM node:20-alpine AS runtime

# Metadados
LABEL maintainer="pedroqvd"
LABEL description="Polymarket Autonomous AI Trader"

# Python3 + requests para o snapshot daemon (sem torch/sentence-transformers)
RUN apk add --no-cache python3 py3-requests

# Cria usuário não-root para segurança
RUN addgroup -S bot && adduser -S bot -G bot

WORKDIR /app

# Copia apenas o necessário do estágio de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copia assets estáticos do dashboard
COPY public/ ./public/

# Copia scripts de coleta de dados (apenas os que rodam em produção)
COPY backtest/data_collector.py  ./backtest/data_collector.py
COPY backtest/price_recorder.py  ./backtest/price_recorder.py
COPY backtest/snapshot_daemon.py ./backtest/snapshot_daemon.py

# Script de inicialização: sobe o daemon Python em background + Node.js em foreground
COPY start.sh /app/start.sh

# Cria diretórios persistentes com permissão correta
RUN mkdir -p data logs backtest && \
    chmod +x /app/start.sh && \
    chown -R bot:bot /app

# Troca para usuário não-root
USER bot

# Porta do dashboard
EXPOSE 3000

# Health check: verifica se o dashboard está respondendo
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Sobe daemon de snapshots + bot Node.js
CMD ["/app/start.sh"]
