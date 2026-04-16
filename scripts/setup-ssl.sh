#!/bin/bash
# ================================================
# HTTPS SETUP — Oracle Cloud (Ubuntu)
# Configura nginx como reverse proxy + Let's Encrypt
#
# USO:
#   Com domínio:  sudo bash setup-ssl.sh --domain SEU.DOMINIO.COM
#   Sem domínio:  sudo bash setup-ssl.sh --self-signed
# ================================================

set -e

DOMAIN=""
SELF_SIGNED=false
BOT_PORT=3000

# Parse args
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN="$2"; shift ;;
    --self-signed) SELF_SIGNED=true ;;
    *) echo "Uso: $0 [--domain SEU.DOMINIO.COM | --self-signed]"; exit 1 ;;
  esac
  shift
done

if [[ -z "$DOMAIN" && "$SELF_SIGNED" == false ]]; then
  echo "❌ Informe --domain SEU.DOMINIO.COM ou --self-signed"
  exit 1
fi

echo "📦 Instalando nginx..."
apt-get update -qq
apt-get install -y nginx

# ------------------------------------------------
# Nginx reverse proxy config
# ------------------------------------------------
NGINX_CONF="/etc/nginx/sites-available/polymarket-bot"

cat > "$NGINX_CONF" << NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};

    location / {
        proxy_pass http://127.0.0.1:${BOT_PORT};
        proxy_http_version 1.1;

        # WebSocket support
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
# Certificado SSL
# ------------------------------------------------
if [[ "$SELF_SIGNED" == true ]]; then
  echo "🔐 Gerando certificado self-signed..."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/polymarket-selfsigned.key \
    -out /etc/ssl/certs/polymarket-selfsigned.crt \
    -subj "/C=BR/ST=SP/L=SP/O=PolymarketBot/CN=localhost"

  cat >> "$NGINX_CONF" << NGINX_SSL

server {
    listen 443 ssl;
    server_name ${DOMAIN:-_};

    ssl_certificate     /etc/ssl/certs/polymarket-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/polymarket-selfsigned.key;

    location / {
        proxy_pass http://127.0.0.1:${BOT_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }
}
NGINX_SSL

  nginx -t && systemctl reload nginx
  echo ""
  echo "✅ Self-signed HTTPS configurado!"
  echo "   Acesse: https://$(curl -s ifconfig.me)"
  echo "   ⚠️  O browser vai mostrar aviso de certificado — clique em 'Avançado > Continuar'"

else
  echo "📜 Instalando Certbot (Let's Encrypt)..."
  apt-get install -y certbot python3-certbot-nginx

  echo "🔐 Obtendo certificado para $DOMAIN..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect

  echo ""
  echo "✅ HTTPS com Let's Encrypt configurado!"
  echo "   Acesse: https://${DOMAIN}"
  echo "   Renovação automática: já configurada pelo certbot"
fi

# ------------------------------------------------
# Abrir porta 443 no Oracle Cloud firewall
# ------------------------------------------------
echo ""
echo "⚠️  Lembre-se de abrir a porta 443 no Oracle Cloud:"
echo "   Networking → Virtual Cloud Networks → Security Lists → Add Ingress Rule"
echo "   Source CIDR: 0.0.0.0/0  |  Port: 443"
echo ""
echo "   E no iptables do servidor:"
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
echo "   Portas 80 e 443 abertas no iptables ✅"
