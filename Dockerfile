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

# Cria usuário não-root para segurança
RUN addgroup -S bot && adduser -S bot -G bot

WORKDIR /app

# Copia apenas o necessário do estágio de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copia assets estáticos do dashboard
COPY public/ ./public/

# Cria diretórios persistentes com permissão correta
RUN mkdir -p data logs && chown -R bot:bot /app

# Troca para usuário não-root
USER bot

# Porta do dashboard
EXPOSE 3000

# Health check: verifica se o dashboard está respondendo
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Inicia o bot compilado
CMD ["node", "dist/index.js"]
