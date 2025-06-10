// Remover tudo e adicionar:
function initTradingViewWidgets() {
  // Widget Principal - Advanced Chart
  new TradingView.widget({
    autosize: true,
    symbol: "BINANCE:BTCUSDT",
    interval: "1H",
    timezone: "America/Sao_Paulo",
    theme: "dark",
    style: "1",
    locale: "pt",
    toolbar_bg: "#1a1a1a",
    enable_publishing: false,
    allow_symbol_change: true,
    studies: ["RSI@tv-basicstudies"],
    container_id: "main-chart"
  });
}