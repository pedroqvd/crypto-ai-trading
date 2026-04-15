#!/bin/bash
# ================================================
# DEPLOY — Oracle Cloud Always Free (Ubuntu)
# Execute uma vez após criar a VM
# ================================================

set -e  # para se qualquer comando falhar

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     🤖 POLYMARKET BOT — Oracle Cloud Setup   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ------------------------------------------------
# 1. Atualizar sistema
# ------------------------------------------------
echo "📦 Atualizando sistema..."
sudo apt-get update -q && sudo apt-get upgrade -y -q

# ------------------------------------------------
# 2. Instalar Node.js 20 LTS
# ------------------------------------------------
echo "⬇️  Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "✅ Node: $(node -v) | NPM: $(npm -v)"

# ------------------------------------------------
# 3. Instalar PM2 (process manager)
# ------------------------------------------------
echo "⬇️  Instalando PM2..."
sudo npm install -g pm2

# ------------------------------------------------
# 4. Clonar repositório
# ------------------------------------------------
echo "📂 Clonando repositório..."
cd ~
if [ -d "crypto-ai-trading" ]; then
  echo "   Repositório já existe, atualizando..."
  cd crypto-ai-trading
  git pull origin main
else
  git clone https://github.com/pedroqvd/crypto-ai-trading.git
  cd crypto-ai-trading
fi

# ------------------------------------------------
# 5. Instalar dependências
# ------------------------------------------------
echo "📦 Instalando dependências..."
npm install --production=false

# ------------------------------------------------
# 6. Criar .env se não existir
# ------------------------------------------------
if [ ! -f ".env" ]; then
  echo ""
  echo "⚠️  Arquivo .env não encontrado!"
  echo "   Copiando .env.example → .env"
  cp .env.example .env
  echo ""
  echo "   ┌─────────────────────────────────────────┐"
  echo "   │  Edite o .env antes de continuar:       │"
  echo "   │  nano .env                               │"
  echo "   │                                         │"
  echo "   │  Campos obrigatórios:                   │"
  echo "   │  • PRIVATE_KEY                           │"
  echo "   │  • AUTH_EMAIL                            │"
  echo "   │  • AUTH_PASSWORD_HASH  (via setup.ts)   │"
  echo "   │  • JWT_SECRET          (via setup.ts)   │"
  echo "   └─────────────────────────────────────────┘"
  echo ""
  echo "   Para gerar AUTH_PASSWORD_HASH e JWT_SECRET:"
  echo "   npx ts-node src/auth/setup.ts"
  echo ""
  read -p "   Pressione ENTER após editar o .env..."
fi

# ------------------------------------------------
# 7. Compilar TypeScript
# ------------------------------------------------
echo "🔨 Compilando TypeScript..."
npm run build

# ------------------------------------------------
# 8. Criar diretório de logs
# ------------------------------------------------
mkdir -p logs data

# ------------------------------------------------
# 9. Iniciar com PM2
# ------------------------------------------------
echo "🚀 Iniciando bot com PM2..."
pm2 start ecosystem.config.js

# Salvar config do PM2 para reiniciar após reboot
pm2 save

# Configurar PM2 para iniciar no boot do sistema
pm2 startup | tail -1 | bash 2>/dev/null || \
  echo "   (Execute o comando 'pm2 startup' manualmente se necessário)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     ✅ Deploy concluído!                      ║"
echo "║                                              ║"
echo "║  Comandos úteis:                             ║"
echo "║  pm2 status          → ver status            ║"
echo "║  pm2 logs            → ver logs em tempo     ║"
echo "║  pm2 restart all     → reiniciar bot         ║"
echo "║  pm2 stop all        → parar bot             ║"
echo "║                                              ║"
echo "║  Dashboard local:                            ║"
echo "║  http://<IP-da-VM>:3000                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
