#!/bin/sh
# Inicia o snapshot daemon Python em background e o bot Node.js em foreground.
# Quando o Node.js sair (crash ou restart), o container para e o Fly.io reinicia tudo.
cd /app/backtest
python3 snapshot_daemon.py --db /data/backtest.db --price-interval 300 &
cd /app
exec node dist/index.js
