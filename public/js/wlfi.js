// ================================================
// WLFI - WORLD LIBERTY FINANCIAL DASHBOARD
// ================================================

const WLFI_UPDATES = [
  { date: '14 Mar 2026', badge: 'official', badgeText: 'Oficial', title: 'WLFI anuncia programa "Gold Card" para holders', desc: 'Holders com mais de 100k WLFI e lock de 12 meses terão acesso a benefícios exclusivos.' },
  { date: '28 Fev 2026', badge: 'market', badgeText: 'Compra', title: 'World Liberty Financial adquire 10,000 ETH (~$25M)', desc: 'O protocolo utilizou <span class="hi">$25M do tesouro</span> para comprar Ethereum.' },
  { date: '17 Fev 2026', badge: 'governance', badgeText: 'Governança', title: 'Votação #03: Adição de cbBTC como colateral aprovada', desc: 'A comunidade aprovou por 87% a adição do Coinbase Wrapped Bitcoin como ativo de colateral.' },
  { date: '20 Jan 2026', badge: 'market', badgeText: 'Investimento', title: 'Justin Sun investe $75M em tokens WLFI', desc: 'O fundador da TRON adquiriu <span class="hi">$75 milhões em tokens WLFI</span>.' },
  { date: '14 Jan 2026', badge: 'official', badgeText: 'Oficial', title: 'WLFI ultrapassa meta de $300M na captação', desc: 'World Liberty Financial confirmou ter levantado mais de <span class="hi">$300M</span> em tokens.' },
  { date: '31 Dez 2025', badge: 'governance', badgeText: 'Governança', title: 'Sistema de governança on-chain vai ao ar', desc: 'O módulo de votação do protocolo foi lançado na mainnet do Ethereum.' },
  { date: '14 Nov 2025', badge: 'market', badgeText: 'Captação', title: 'WLFI levanta $135M adicionais após vitória eleitoral de Trump', desc: 'Em uma semana após a reeleição, o projeto recebeu <span class="hi">$135M</span> em novos aportes.' },
  { date: '15 Out 2025', badge: 'official', badgeText: 'Lançamento', title: 'World Liberty Financial lança token WLFI a $0.015', desc: 'O protocolo DeFi é oficialmente lançado. Venda inicial para investidores credenciados.' }
];

const WLFI_POSTS = [
  { name: 'Donald J. Trump', handle: '@realDonaldTrump', initials: 'T', avatarColor: '#1a1a4e', verified: true, time: '20 Jan', content: 'World Liberty Financial is going to change everything. Together, we\'re taking back financial control from the elites and building the future of <span class="tk">$WLFI</span> and <span class="ht">#DeFi</span>. 🇺🇸', likes: '45.2k', retweets: '8.3k', views: '2.1M', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'Eric Trump', handle: '@EricTrump', initials: 'ET', avatarColor: '#1a3a5e', verified: true, time: '15 Jan', content: '🚀 HUGE milestone! <span class="mn">@WorldLibertyFi</span> just crossed <span class="tk">$300M raised</span>! This is what DeFi can do when you believe in financial freedom. <span class="ht">#WLFI</span>', likes: '28.7k', retweets: '4.1k', views: '890k', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'Justin Sun', handle: '@justinsuntron', initials: 'JS', avatarColor: '#1a3a1a', verified: true, time: '20 Jan', content: 'Proud to announce my <span class="tk">$75M investment</span> in <span class="mn">@WorldLibertyFi</span>! DeFi is the future of global finance. <span class="ht">#WLFI</span>', likes: '22.4k', retweets: '3.7k', views: '650k', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'ZachXBT', handle: '@zachxbt', initials: 'Z', avatarColor: '#3a1a1a', verified: true, time: '16 Nov', content: 'Thread sobre <span class="tk">$WLFI</span>: 75% da receita da venda de tokens vai diretamente para entidades da família Trump. Tokenomics designed to extract maximum value.', likes: '31.2k', retweets: '9.8k', views: '1.4M', sentiment: 'bear', sentimentText: 'Crítico' },
  { name: 'Layah Heilpern', handle: '@LayahHeilpern', initials: 'LH', avatarColor: '#3a2a1a', verified: true, time: '18 Jan', content: 'A interseção entre política e cripto nunca foi tão explícita. <span class="tk">$WLFI</span> levantou $300M+ enquanto projetos tradicionais lutam para captar.', likes: '12.3k', retweets: '2.8k', views: '410k', sentiment: 'neut', sentimentText: 'Neutro' },
  { name: 'Altcoin Daily', handle: '@AltcoinDailyio', initials: 'AD', avatarColor: '#1a2a3a', verified: true, time: '12 Mar', content: 'Análise <span class="tk">$WLFI</span>: Protocolo baseado em Aave V3. Risco maior: concentração de tokens e unlock futuro. Suporte em $0.038, resistência em $0.075.', likes: '15.6k', retweets: '2.1k', views: '520k', sentiment: 'bull', sentimentText: 'Cauteloso' },
  { name: 'Coin Bureau', handle: '@coinbureau', initials: 'CB', avatarColor: '#2a1a3a', verified: true, time: '5 Mar', content: 'A correlação do token <span class="tk">$WLFI</span> com notícias políticas de Trump é altíssima. Qualquer declaração sobre cripto causa spike de preço. <span class="ht">#WLFI</span>', likes: '19.8k', retweets: '3.4k', views: '780k', sentiment: 'neut', sentimentText: 'Analítico' }
];

const WLFI_MARKETS = [
  { q: 'WLFI atingirá $0.10 antes de junho de 2026?', yes: 34, vol: '$2.1M' },
  { q: 'World Liberty Financial TVL excederá $1B em 2026?', yes: 28, vol: '$890k' },
  { q: 'Token WLFI se tornará livremente negociável em 2025/26?', yes: 71, vol: '$3.4M' },
  { q: 'Trump fará declaração pública sobre WLFI no 1T 2026?', yes: 83, vol: '$1.2M' },
  { q: 'WLFI lançará produto de staking antes de julho 2026?', yes: 47, vol: '$560k' }
];

const WLFI_CORRELATIONS = [
  { asset: 'BTC/USDT', corr: 0.83 },
  { asset: 'ETH/USDT', corr: 0.79 },
  { asset: 'Aprovação Trump', corr: 0.61 },
  { asset: 'DeFi TVL Total', corr: 0.55 },
  { asset: 'Notícias Crypto', corr: 0.91 }
];

const WLFI_ANALYSIS = [
  { icon: '⚡', text: '<strong>Alta sensibilidade política:</strong> O preço spike imediatamente com declarações de Trump sobre cripto.' },
  { icon: '🏗', text: '<strong>Infraestrutura sólida:</strong> Protocolo baseado em Aave V3 — um dos DeFi mais auditados do mercado.' },
  { icon: '💰', text: '<strong>Tokenomics controversos:</strong> 75% da receita vai para entidades da família Trump. Cria incentivo de curto prazo.' },
  { icon: '🔓', text: '<strong>Risco de unlock:</strong> Tokens comprados a $0.015 estão em vesting. Possível pressão de venda no futuro.' },
  { icon: '🌊', text: '<strong>TVL crescente:</strong> Total Value Locked crescendo. Adoção de lending em expansão.' },
  { icon: '🎯', text: '<strong>Perspectiva 2026:</strong> Range estimado $0.03-0.15. Pivô positivo: token livre + crescimento TVL.' }
];

// ================================================
// RENDER FUNCTIONS
// ================================================

function renderWLFI() {
  renderWLFIUpdates();
  renderWLFIPosts();
  renderWLFIMarkets();
  renderWLFICorrelations();
  renderWLFIAnalysis();
  fetchWLFIPrice();
}

function renderWLFIUpdates() {
  const el = document.getElementById('wlfi-updates');
  if (!el) return;
  el.innerHTML = WLFI_UPDATES.map(u => `
    <div class="upd-card">
      <div class="upd-meta">
        <span class="upd-date">${u.date}</span>
        <span class="upd-badge ${u.badge}">${u.badgeText}</span>
      </div>
      <div class="upd-title">${u.title}</div>
      <div class="upd-desc">${u.desc}</div>
    </div>
  `).join('');
}

function renderWLFIPosts() {
  const el = document.getElementById('wlfi-posts');
  if (!el) return;
  el.innerHTML = WLFI_POSTS.map(p => `
    <div class="xp">
      <div class="xp-hdr">
        <div class="xp-ava" style="background:${p.avatarColor};">${p.initials}</div>
        <div class="xp-user">
          <div class="xp-name">${p.name}${p.verified ? '<span class="xp-ck">✓</span>' : ''}</div>
          <div class="xp-handle">${p.handle}</div>
        </div>
        <div class="xp-time">${p.time}</div>
      </div>
      <div class="xp-body">${p.content}</div>
      <div class="xp-foot">
        <span class="xp-st">❤ ${p.likes}</span>
        <span class="xp-st">↻ ${p.retweets}</span>
        <span class="xp-st">👁 ${p.views}</span>
        <span class="xp-sent ${p.sentiment}">${p.sentimentText}</span>
      </div>
    </div>
  `).join('');
}

function renderWLFIMarkets() {
  const el = document.getElementById('wlfi-markets');
  if (!el) return;
  el.innerHTML = WLFI_MARKETS.map(m => `
    <div class="pm-card">
      <div class="pm-q">${m.q}</div>
      <div class="pm-bar">
        <div class="pm-yes-bar" style="width:${m.yes}%;"></div>
        <div class="pm-no-bar"></div>
      </div>
      <div class="pm-probs">
        <span class="pm-y">Sim: ${m.yes}%</span>
        <span class="pm-v">Vol: ${m.vol}</span>
        <span class="pm-n">Não: ${100-m.yes}%</span>
      </div>
    </div>
  `).join('');
}

function renderWLFICorrelations() {
  const el = document.getElementById('wlfi-correlations');
  if (!el) return;
  el.innerHTML = WLFI_CORRELATIONS.map(c => `
    <div class="corr-row">
      <div class="corr-asset">WLFI / ${c.asset}</div>
      <div class="corr-track"><div class="corr-fill" style="width:${c.corr*100}%;"></div></div>
      <div class="corr-num">${c.corr}</div>
    </div>
  `).join('');
}

function renderWLFIAnalysis() {
  const el = document.getElementById('wlfi-analysis');
  if (!el) return;
  el.innerHTML = WLFI_ANALYSIS.map(a => `
    <div class="anal-item">
      <div class="anal-icon">${a.icon}</div>
      <div class="anal-text">${a.text}</div>
    </div>
  `).join('');
}

async function fetchWLFIPrice() {
  try {
    const res = await fetch('/api/wlfi/price');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.data) {
        updateWLFIPrice(data.data.price, data.data.change24h);
      }
    }
  } catch (e) {
    console.log('WLFI price API unavailable');
  }
}

function updateWLFIPrice(price, change) {
  const priceEl = document.getElementById('wlfi-price');
  const chgEl = document.getElementById('wlfi-chg');
  const wsPriceEl = document.getElementById('ws-price');

  if (priceEl) priceEl.textContent = '$' + price.toFixed(4);
  if (wsPriceEl) wsPriceEl.textContent = '$' + price.toFixed(4);
  if (chgEl) {
    const isPos = change >= 0;
    chgEl.textContent = (isPos ? '▲ +' : '▼ ') + change.toFixed(1) + '% (24h)';
    chgEl.className = 'wlfi-chg ' + (isPos ? 'pos' : 'neg');
  }
}

function refreshWLFI() {
  fetchWLFIPrice();
  if (typeof showToast === 'function') showToast('WLFI atualizado', 'info');
}
