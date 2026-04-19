# Polymarket AI Quantitative Trader 🤖📈

![Dashboard Preview](https://via.placeholder.com/1200x600.png?text=Polymarket+AI+Quantitative+Dashboard)

## ⚡ Overview
**Polymarket AI Trader** é um motor de trading autônomo focado em derivativos preditivos e mercados de predição (Prediction Markets) focados na rede Polygon. Ele extrai distorções matemáticas (*edge*) dos livros de ordens e aplica execuções cirúrgicas de aportes, aliando aprendizado de máquina, gestão de portfólio restritivo e análises probabilísticas LLM (Claude Anthropic).

## 🚀 Features Institucionais

- 🧠 **Motor de Heurística Bayesiana:** Cálculos de Edge com 8 sinais distintos em tempo real sobre Volume, Age de Mercado, Liquidez e Distorções de Preço de livro de ordens (CLOB).
- 🏛️ **Market Making Automático:** Suporte para atuar providenciando liquidez para o livro de ordens ao invés de atuar direcionalmente de forma passiva, absorvendo os spreads para retornos exponenciais.
- 📉 **Dynamic Kelly Fraction Math:** Quando exposto a Drawdowns sistêmicos, o bot aciona uma trava e espreme sua fração máxima de aposta em -50% ou -75%, prevenindo o bankroll de sumir em flutuações voláteis. Adota Circuit Breakers de Drawdown e limites intra-*DayTrade*.
- 🌐 **Veto Fundamentalista via Claude AI:** Integração ao modelo Claude para devorar o Breaking News do Ativo atrelado à NewsAPI. Se as notícias de última hora quebrarem a heurística numérica (ex: Um partido desistiu), o robô veta a operação a partir da Inteligência Artificial.
- 📱 **Multi-channel Notificações:** Relatórios isolados para o Telegram Autônomo e Discord Webhooks.
- 🛡️ **Zero Trust Dashboard (Frontend V2):** Painel web *Glassmorphism* completo via Node Express construído com autenticação baseada em Json Web Tokens (JWT) blindada para ataques alheios e responsiva de ponta a ponta (Mobile-Native View).

## 🛠 Tech Stack

- **Linguagens:** TypeScript & Node.js, Express, Javascript
- **Blockchain Interface:** Ethers v5 & ClobApiClient (Polygon/Polymarket Endpoint)
- **Web Interface:** Vanilla CSS3 moderno (Variáveis UI) + HTML5 
- **Comunicação:** Socket.IO para Datafeed ao vivo
- **APIs de Integração:** Anthropic SDK (Claude AI), Telegram Bots API, GammaApiClient, NewsAPI

## 🔒 Variáveis de Ambiente Necessárias (`.env`)
Configurado para `dryRun` ou Operações Live:
- `PRIVATE_KEY`: Chave da carteira para envio de Transações na Polygon.
- `CLAUDE_API_KEY`: Acesso ao oráculo LLM.
- `NEWS_API_KEY`: API News global de contexto.
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`: Para recebimento dos disparos de execuções móvel em tempo real.
- `JWT_SECRET`: Para as chancelas SSL do motor dashboard.

## 🚧 Status

**Stable Release** operante para ambientes Node.js ou Virtual Machines (Oracle/AWS/Railway).
