// PM2 — Process Manager config
// Mantém o bot rodando 24/7 e reinicia automaticamente em caso de crash
module.exports = {
  apps: [
    {
      name: 'polymarket-bot',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,      // espera 5s antes de reiniciar após crash
      max_restarts: 10,         // desiste após 10 crashes seguidos (evita loop)
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
    },
  ],
};
