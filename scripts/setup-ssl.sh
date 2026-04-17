#!/bin/bash
# ================================================
# HTTPS SETUP — Oracle Cloud (Ubuntu)
# Usa sslip.io para obter HTTPS grátis sem domínio
#
# USO:
#   sudo bash setup-ssl.sh
#
# O script detecta o IP público automaticamente e
# configura nginx + Let's Encrypt via IP.sslip.io
# ================================================

set -e

BOT_PORT=3000

echo "🔍 Detectando IP público..."
PUBLIC_IP=$(curl -s ifconfig.me)

if [[ -z "$PUBLIC_IP" ]]; then
  echo "❌ Não foi possível detectar o IP público."
  exit 1
fi

DOMAIN="${PUBLIC_IP}.sslip.io"
echo "🌐 Domínio automático: $DOMAIN"
echo ""

# ------------------------------------------------
# Abrir portas no iptables (Oracle Cloud bloqueia por padrão)
# ------------------------------------------------
echo "🔓 Abrindo portas 80 e 443..."
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true

# ------------------------------------------------
# Instalar nginx e certbot
# ------------------------------------------------
echo "📦 Instalando nginx e certbot..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

# ------------------------------------------------
# Config nginx — HTTP (necessário para o certbot verificar o domínio)
# ------------------------------------------------
NGINX_CONF="/etc/nginx/sites-available/polymarket-bot"

cat > "$NGINX_CONF" << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${BOT_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/polymarket-bot
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ------------------------------------------------
# Obter certificado Let's Encrypt
# ------------------------------------------------
echo "🔐 Obtendo certificado SSL para $DOMAIN..."
certbot --nginx -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --redirect

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ HTTPS configurado com sucesso!                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  🌐 URL do backend: https://${DOMAIN}"
echo ""
echo "  ➡️  Atualize no Vercel:"
echo "     ORACLE_BACKEND_URL = https://${DOMAIN}"
echo ""
echo "  ➡️  Atualize no .env do Oracle (ALLOWED_ORIGINS):"
echo "     ALLOWED_ORIGINS = https://SEU-APP.vercel.app"
echo ""
echo "  🔄 Renovação automática: já configurada pelo certbot"
echo ""
echo "⚠️  Lembre de abrir a porta 443 no Oracle Cloud Console:"
echo "   Networking → VCN → Security Lists → Add Ingress Rule"
echo "   Source CIDR: 0.0.0.0/0  |  Destination Port: 443"
