// ================================================
// WLFI - WORLD LIBERTY FINANCIAL DASHBOARD
// Comprehensive Token Dashboard
// ================================================


// ================================================
// 1. TOKEN INFO
// ================================================

const WLFI_TOKEN_INFO = {
  name: 'World Liberty Financial',
  symbol: 'WLFI',
  network: 'Ethereum (ERC-20)',
  launchDate: '15 Out 2025',
  launchPrice: '$0.015',
  currentPrice: '$0.0482',  // placeholder updated by API
  ath: '$0.098',
  atl: '$0.012',
  totalSupply: '100,000,000,000',
  circulatingSupply: '22,500,000,000',
  marketCap: '$261M',
  fdv: '$4.82B',
  protocol: 'Aave V3 (Lending/Borrowing)',
  chain: 'Ethereum Mainnet',
  governance: 'On-chain Snapshot + Multisig',
  website: 'worldlibertyfinancial.com',
  twitter: '@WorldLibertyFi'
};


// ================================================
// 2. TOKENOMICS
// ================================================

const WLFI_TOKENOMICS = [
  { label: 'Team & Family Trump', pct: 22.5, color: '#ff4757' },
  { label: 'Public Sale', pct: 20, color: '#00d4ff' },
  { label: 'Tesouro do Protocolo', pct: 25, color: '#00ff88' },
  { label: 'Investidores Iniciais', pct: 17.5, color: '#ffa500' },
  { label: 'Advisors & Parceiros', pct: 7.5, color: '#9b59b6' },
  { label: 'Comunidade & Airdrops', pct: 7.5, color: '#3498db' }
];


// ================================================
// 3. KEY PEOPLE
// ================================================

const WLFI_KEY_PEOPLE = [
  { name: 'Donald J. Trump', role: 'Chief Crypto Advocate', avatar: 'T', color: '#1a1a4e' },
  { name: 'Eric Trump', role: 'Web3 Ambassador', avatar: 'ET', color: '#1a3a5e' },
  { name: 'Donald Trump Jr.', role: 'DeFi Visionary', avatar: 'DJ', color: '#2a2a4e' },
  { name: 'Zak Folkman', role: 'Co-Founder', avatar: 'ZF', color: '#1a4a3e' },
  { name: 'Chase Herro', role: 'Co-Founder', avatar: 'CH', color: '#3a2a1e' },
  { name: 'Luke Pearson', role: 'Head of Engineering', avatar: 'LP', color: '#1a3a3a' }
];


// ================================================
// 4. X/TWITTER ACCOUNTS
// ================================================

const WLFI_X_ACCOUNTS = [
  { name: 'World Liberty Fi', handle: '@WorldLibertyFi', followers: '1.2M', category: 'official', desc: 'Official project account' },
  { name: 'Donald J. Trump', handle: '@realDonaldTrump', followers: '92M', category: 'official', desc: 'Chief Crypto Advocate' },
  { name: 'Eric Trump', handle: '@EricTrump', followers: '6.1M', category: 'official', desc: 'Web3 Ambassador' },
  { name: 'ZachXBT', handle: '@zachxbt', followers: '1.5M', category: 'analyst', desc: 'On-chain investigator' },
  { name: 'Coin Bureau', handle: '@coinbureau', followers: '2.4M', category: 'analyst', desc: 'Deep crypto analysis' },
  { name: 'The DeFi Edge', handle: '@thedefiedge', followers: '580k', category: 'analyst', desc: 'DeFi strategies & analysis' },
  { name: 'Altcoin Daily', handle: '@AltcoinDailyio', followers: '1.8M', category: 'media', desc: 'Daily crypto news' },
  { name: 'Layah Heilpern', handle: '@LayahHeilpern', followers: '420k', category: 'media', desc: 'Crypto journalist' },
  { name: 'Polymarket', handle: '@Polymarket', followers: '890k', category: 'markets', desc: 'Prediction markets' }
];


// ================================================
// 5. NEWS (formerly WLFI_UPDATES, expanded to 12)
// ================================================

const WLFI_NEWS = [
  { date: '27 Mar 2026', badge: 'official', badgeText: 'Oficial', title: 'WLFI Protocol TVL atinge $450M', desc: 'O valor total travado no protocolo cresceu 80% no último trimestre.' },
  { date: '22 Mar 2026', badge: 'market', badgeText: 'Mercado', title: 'WLFI listado na Binance como token negociável', desc: 'Após meses de restrições, <span class="hi">Binance anuncia listagem</span> do token WLFI.' },
  { date: '20 Mar 2026', badge: 'governance', badgeText: 'Governança', title: 'Votação #04: Expansão para Arbitrum aprovada', desc: 'Comunidade aprova deploy do protocolo na Arbitrum com 91% de votos favoráveis.' },
  { date: '18 Mar 2026', badge: 'market', badgeText: 'Parceria', title: 'Parceria estratégica com Chainlink anunciada', desc: 'WLFI integrará <span class="hi">Chainlink oracles</span> para price feeds e CCIP.' },
  { date: '14 Mar 2026', badge: 'official', badgeText: 'Oficial', title: 'WLFI anuncia programa "Gold Card" para holders', desc: 'Holders com mais de 100k WLFI e lock de 12 meses terão acesso a benefícios exclusivos.' },
  { date: '28 Fev 2026', badge: 'market', badgeText: 'Compra', title: 'World Liberty Financial adquire 10,000 ETH (~$25M)', desc: 'O protocolo utilizou <span class="hi">$25M do tesouro</span> para comprar Ethereum.' },
  { date: '17 Fev 2026', badge: 'governance', badgeText: 'Governança', title: 'Votação #03: Adição de cbBTC como colateral aprovada', desc: 'A comunidade aprovou por 87% a adição do Coinbase Wrapped Bitcoin como ativo de colateral.' },
  { date: '20 Jan 2026', badge: 'market', badgeText: 'Investimento', title: 'Justin Sun investe $75M em tokens WLFI', desc: 'O fundador da TRON adquiriu <span class="hi">$75 milhões em tokens WLFI</span>.' },
  { date: '14 Jan 2026', badge: 'official', badgeText: 'Oficial', title: 'WLFI ultrapassa meta de $300M na captação', desc: 'World Liberty Financial confirmou ter levantado mais de <span class="hi">$300M</span> em tokens.' },
  { date: '31 Dez 2025', badge: 'governance', badgeText: 'Governança', title: 'Sistema de governança on-chain vai ao ar', desc: 'O módulo de votação do protocolo foi lançado na mainnet do Ethereum.' },
  { date: '14 Nov 2025', badge: 'market', badgeText: 'Captação', title: 'WLFI levanta $135M adicionais após vitória eleitoral de Trump', desc: 'Em uma semana após a reeleição, o projeto recebeu <span class="hi">$135M</span> em novos aportes.' },
  { date: '15 Out 2025', badge: 'official', badgeText: 'Lançamento', title: 'World Liberty Financial lança token WLFI a $0.015', desc: 'O protocolo DeFi é oficialmente lançado. Venda inicial para investidores credenciados.' }
];


// ================================================
// 6. POSTS (unchanged)
// ================================================

const WLFI_POSTS = [
  { name: 'Donald J. Trump', handle: '@realDonaldTrump', initials: 'T', avatarColor: '#1a1a4e', verified: true, time: '20 Jan', content: 'World Liberty Financial is going to change everything. Together, we\'re taking back financial control from the elites and building the future of <span class="tk">$WLFI</span> and <span class="ht">#DeFi</span>. \u{1f1fa}\u{1f1f8}', likes: '45.2k', retweets: '8.3k', views: '2.1M', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'Eric Trump', handle: '@EricTrump', initials: 'ET', avatarColor: '#1a3a5e', verified: true, time: '15 Jan', content: '\u{1f680} HUGE milestone! <span class="mn">@WorldLibertyFi</span> just crossed <span class="tk">$300M raised</span>! This is what DeFi can do when you believe in financial freedom. <span class="ht">#WLFI</span>', likes: '28.7k', retweets: '4.1k', views: '890k', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'Justin Sun', handle: '@justinsuntron', initials: 'JS', avatarColor: '#1a3a1a', verified: true, time: '20 Jan', content: 'Proud to announce my <span class="tk">$75M investment</span> in <span class="mn">@WorldLibertyFi</span>! DeFi is the future of global finance. <span class="ht">#WLFI</span>', likes: '22.4k', retweets: '3.7k', views: '650k', sentiment: 'bull', sentimentText: 'Bullish' },
  { name: 'ZachXBT', handle: '@zachxbt', initials: 'Z', avatarColor: '#3a1a1a', verified: true, time: '16 Nov', content: 'Thread sobre <span class="tk">$WLFI</span>: 75% da receita da venda de tokens vai diretamente para entidades da família Trump. Tokenomics designed to extract maximum value.', likes: '31.2k', retweets: '9.8k', views: '1.4M', sentiment: 'bear', sentimentText: 'Cr\u00edtico' },
  { name: 'Layah Heilpern', handle: '@LayahHeilpern', initials: 'LH', avatarColor: '#3a2a1a', verified: true, time: '18 Jan', content: 'A interse\u00e7\u00e3o entre pol\u00edtica e cripto nunca foi t\u00e3o expl\u00edcita. <span class="tk">$WLFI</span> levantou $300M+ enquanto projetos tradicionais lutam para captar.', likes: '12.3k', retweets: '2.8k', views: '410k', sentiment: 'neut', sentimentText: 'Neutro' },
  { name: 'Altcoin Daily', handle: '@AltcoinDailyio', initials: 'AD', avatarColor: '#1a2a3a', verified: true, time: '12 Mar', content: 'An\u00e1lise <span class="tk">$WLFI</span>: Protocolo baseado em Aave V3. Risco maior: concentra\u00e7\u00e3o de tokens e unlock futuro. Suporte em $0.038, resist\u00eancia em $0.075.', likes: '15.6k', retweets: '2.1k', views: '520k', sentiment: 'bull', sentimentText: 'Cauteloso' },
  { name: 'Coin Bureau', handle: '@coinbureau', initials: 'CB', avatarColor: '#2a1a3a', verified: true, time: '5 Mar', content: 'A correla\u00e7\u00e3o do token <span class="tk">$WLFI</span> com not\u00edcias pol\u00edticas de Trump \u00e9 alt\u00edssima. Qualquer declara\u00e7\u00e3o sobre cripto causa spike de pre\u00e7o. <span class="ht">#WLFI</span>', likes: '19.8k', retweets: '3.4k', views: '780k', sentiment: 'neut', sentimentText: 'Anal\u00edtico' }
];


// ================================================
// 7. PREDICTION MARKETS (unchanged)
// ================================================

const WLFI_MARKETS = [
  { q: 'WLFI atingir\u00e1 $0.10 antes de junho de 2026?', yes: 34, vol: '$2.1M' },
  { q: 'World Liberty Financial TVL exceder\u00e1 $1B em 2026?', yes: 28, vol: '$890k' },
  { q: 'Token WLFI se tornar\u00e1 livremente negoci\u00e1vel em 2025/26?', yes: 71, vol: '$3.4M' },
  { q: 'Trump far\u00e1 declara\u00e7\u00e3o p\u00fablica sobre WLFI no 1T 2026?', yes: 83, vol: '$1.2M' },
  { q: 'WLFI lan\u00e7ar\u00e1 produto de staking antes de julho 2026?', yes: 47, vol: '$560k' }
];


// ================================================
// 8. CORRELATIONS (unchanged)
// ================================================

const WLFI_CORRELATIONS = [
  { asset: 'BTC/USDT', corr: 0.83 },
  { asset: 'ETH/USDT', corr: 0.79 },
  { asset: 'Aprova\u00e7\u00e3o Trump', corr: 0.61 },
  { asset: 'DeFi TVL Total', corr: 0.55 },
  { asset: 'Not\u00edcias Crypto', corr: 0.91 }
];


// ================================================
// 9. ANALYSIS (unchanged)
// ================================================

const WLFI_ANALYSIS = [
  { icon: '\u26a1', text: '<strong>Alta sensibilidade pol\u00edtica:</strong> O pre\u00e7o spike imediatamente com declara\u00e7\u00f5es de Trump sobre cripto.' },
  { icon: '\u{1f3d7}', text: '<strong>Infraestrutura s\u00f3lida:</strong> Protocolo baseado em Aave V3 \u2014 um dos DeFi mais auditados do mercado.' },
  { icon: '\u{1f4b0}', text: '<strong>Tokenomics controversos:</strong> 75% da receita vai para entidades da fam\u00edlia Trump. Cria incentivo de curto prazo.' },
  { icon: '\u{1f513}', text: '<strong>Risco de unlock:</strong> Tokens comprados a $0.015 est\u00e3o em vesting. Poss\u00edvel press\u00e3o de venda no futuro.' },
  { icon: '\u{1f30a}', text: '<strong>TVL crescente:</strong> Total Value Locked crescendo. Ado\u00e7\u00e3o de lending em expans\u00e3o.' },
  { icon: '\u{1f3af}', text: '<strong>Perspectiva 2026:</strong> Range estimado $0.03-0.15. Piv\u00f4 positivo: token livre + crescimento TVL.' }
];


// ================================================
// 10. RISKS
// ================================================

const WLFI_RISKS = [
  { level: 'high', title: 'Concentra\u00e7\u00e3o de Tokens', desc: '22.5% alocado para Team/Trump. Potencial conflito de interesses.' },
  { level: 'high', title: 'Risco Regulat\u00f3rio', desc: 'Projeto vinculado a figura pol\u00edtica. SEC pode classificar como security.' },
  { level: 'medium', title: 'Unlock Schedule', desc: 'Tokens de investidores iniciais come\u00e7am unlock em Q3 2026. Press\u00e3o de venda esperada.' },
  { level: 'medium', title: 'Depend\u00eancia Pol\u00edtica', desc: 'Pre\u00e7o altamente correlacionado com aprova\u00e7\u00e3o Trump (r=0.61).' },
  { level: 'low', title: 'Smart Contract Risk', desc: 'Baseado em Aave V3 \u2014 um dos protocolos mais auditados do mercado.' },
  { level: 'low', title: 'Liquidez', desc: 'Volume 24h de $12.4M. Spread baixo nas principais DEXs.' }
];


// ================================================
// RENDER FUNCTIONS
// ================================================


// ------------------------------------------------
// 1. Token Info
// ------------------------------------------------

function renderWLFITokenInfo() {
  const el = document.getElementById('wlfi-token-info');
  if (!el) return;

  const fields = [
    { label: 'Nome', value: WLFI_TOKEN_INFO.name },
    { label: 'S\u00edmbolo', value: WLFI_TOKEN_INFO.symbol },
    { label: 'Rede', value: WLFI_TOKEN_INFO.network },
    { label: 'Protocolo', value: WLFI_TOKEN_INFO.protocol },
    { label: 'Chain', value: WLFI_TOKEN_INFO.chain },
    { label: 'Lan\u00e7amento', value: WLFI_TOKEN_INFO.launchDate },
    { label: 'Pre\u00e7o Lan\u00e7amento', value: WLFI_TOKEN_INFO.launchPrice },
    { label: 'Pre\u00e7o Atual', value: `<span id="wlfi-info-price">${WLFI_TOKEN_INFO.currentPrice}</span>` },
    { label: 'ATH', value: WLFI_TOKEN_INFO.ath },
    { label: 'ATL', value: WLFI_TOKEN_INFO.atl },
    { label: 'Total Supply', value: WLFI_TOKEN_INFO.totalSupply },
    { label: 'Circulating Supply', value: WLFI_TOKEN_INFO.circulatingSupply },
    { label: 'Market Cap', value: WLFI_TOKEN_INFO.marketCap },
    { label: 'FDV', value: WLFI_TOKEN_INFO.fdv },
    { label: 'Governan\u00e7a', value: WLFI_TOKEN_INFO.governance },
    { label: 'Website', value: `<a href="https://${WLFI_TOKEN_INFO.website}" target="_blank" rel="noopener" style="color:#00d4ff;">${WLFI_TOKEN_INFO.website}</a>` },
    { label: 'Twitter', value: `<span style="color:#1da1f2;">${WLFI_TOKEN_INFO.twitter}</span>` }
  ];

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${fields.map(f => `
        <div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:6px;">
          <span style="color:#888;font-size:0.85em;">${f.label}</span>
          <span style="color:#e0e0e0;font-size:0.85em;text-align:right;">${f.value}</span>
        </div>
      `).join('')}
    </div>
  `;
}


// ------------------------------------------------
// 2. Tokenomics (Donut Chart)
// ------------------------------------------------

function renderWLFITokenomics() {
  const el = document.getElementById('wlfi-tokenomics');
  if (!el) return;

  const gradientParts = [];
  let cumulative = 0;
  WLFI_TOKENOMICS.forEach(t => {
    gradientParts.push(`${t.color} ${cumulative}% ${cumulative + t.pct}%`);
    cumulative += t.pct;
  });

  const donutSize = 200;
  const legend = WLFI_TOKENOMICS.map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${t.color};flex-shrink:0;"></span>
      <span style="color:#ccc;font-size:0.85em;">${t.label}</span>
      <span style="color:#fff;font-weight:600;margin-left:auto;font-size:0.85em;">${t.pct}%</span>
    </div>
  `).join('');

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:20px;">
      <div style="position:relative;width:${donutSize}px;height:${donutSize}px;">
        <div style="width:100%;height:100%;border-radius:50%;background:conic-gradient(${gradientParts.join(', ')});"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${donutSize * 0.55}px;height:${donutSize * 0.55}px;border-radius:50%;background:#0d1117;display:flex;align-items:center;justify-content:center;flex-direction:column;">
          <span style="color:#fff;font-size:1.1em;font-weight:700;">100B</span>
          <span style="color:#888;font-size:0.75em;">Total Supply</span>
        </div>
      </div>
      <div style="width:100%;max-width:320px;">
        ${legend}
      </div>
    </div>
  `;
}


// ------------------------------------------------
// 3. Key People
// ------------------------------------------------

function renderWLFIKeyPeople() {
  const el = document.getElementById('wlfi-key-people');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;">
      ${WLFI_KEY_PEOPLE.map(p => `
        <div style="flex-shrink:0;width:130px;text-align:center;padding:16px 10px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
          <div style="width:52px;height:52px;border-radius:50%;background:${p.color};display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:1em;font-weight:700;color:#fff;">${p.avatar}</div>
          <div style="color:#e0e0e0;font-size:0.85em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
          <div style="color:#888;font-size:0.75em;margin-top:4px;">${p.role}</div>
        </div>
      `).join('')}
    </div>
  `;
}


// ------------------------------------------------
// 4. X/Twitter Accounts
// ------------------------------------------------

function renderWLFIXAccounts() {
  const el = document.getElementById('wlfi-x-accounts');
  if (!el) return;

  const categoryColors = {
    official: { bg: 'rgba(0,212,255,0.12)', color: '#00d4ff', text: 'Oficial' },
    analyst: { bg: 'rgba(255,165,0,0.12)', color: '#ffa500', text: 'Analista' },
    media: { bg: 'rgba(155,89,182,0.12)', color: '#9b59b6', text: 'M\u00eddia' },
    markets: { bg: 'rgba(0,255,136,0.12)', color: '#00ff88', text: 'Mercado' }
  };

  el.innerHTML = WLFI_X_ACCOUNTS.map(a => {
    const cat = categoryColors[a.category] || categoryColors.official;
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:6px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:#e0e0e0;font-weight:600;font-size:0.9em;">${a.name}</span>
            <span style="background:${cat.bg};color:${cat.color};font-size:0.7em;padding:2px 7px;border-radius:4px;">${cat.text}</span>
          </div>
          <div style="color:#888;font-size:0.8em;margin-top:2px;">${a.handle} &middot; ${a.desc}</div>
        </div>
        <div style="color:#00d4ff;font-size:0.85em;font-weight:600;white-space:nowrap;">${a.followers}</div>
      </div>
    `;
  }).join('');
}


// ------------------------------------------------
// 5. News (renders into #wlfi-updates)
// ------------------------------------------------

function renderWLFINews() {
  const el = document.getElementById('wlfi-updates');
  if (!el) return;
  el.innerHTML = WLFI_NEWS.map(u => `
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


// ------------------------------------------------
// 6. Posts (unchanged)
// ------------------------------------------------

function renderWLFIPosts() {
  const el = document.getElementById('wlfi-posts');
  if (!el) return;
  el.innerHTML = WLFI_POSTS.map(p => `
    <div class="xp">
      <div class="xp-hdr">
        <div class="xp-ava" style="background:${p.avatarColor};">${p.initials}</div>
        <div class="xp-user">
          <div class="xp-name">${p.name}${p.verified ? '<span class="xp-ck">\u2713</span>' : ''}</div>
          <div class="xp-handle">${p.handle}</div>
        </div>
        <div class="xp-time">${p.time}</div>
      </div>
      <div class="xp-body">${p.content}</div>
      <div class="xp-foot">
        <span class="xp-st">\u2764 ${p.likes}</span>
        <span class="xp-st">\u21bb ${p.retweets}</span>
        <span class="xp-st">\u{1f441} ${p.views}</span>
        <span class="xp-sent ${p.sentiment}">${p.sentimentText}</span>
      </div>
    </div>
  `).join('');
}


// ------------------------------------------------
// 7. Prediction Markets (unchanged)
// ------------------------------------------------

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
        <span class="pm-n">N\u00e3o: ${100-m.yes}%</span>
      </div>
    </div>
  `).join('');
}


// ------------------------------------------------
// 8. Correlations (unchanged)
// ------------------------------------------------

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


// ------------------------------------------------
// 9. Analysis (unchanged)
// ------------------------------------------------

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


// ------------------------------------------------
// 10. Risks
// ------------------------------------------------

function renderWLFIRisks() {
  const el = document.getElementById('wlfi-risks');
  if (!el) return;

  const levelConfig = {
    high:   { color: '#ff4757', bg: 'rgba(255,71,87,0.10)', label: 'ALTO' },
    medium: { color: '#ffa500', bg: 'rgba(255,165,0,0.10)', label: 'M\u00c9DIO' },
    low:    { color: '#00ff88', bg: 'rgba(0,255,136,0.10)', label: 'BAIXO' }
  };

  el.innerHTML = WLFI_RISKS.map(r => {
    const cfg = levelConfig[r.level] || levelConfig.medium;
    return `
      <div style="padding:12px 14px;background:${cfg.bg};border-left:3px solid ${cfg.color};border-radius:6px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="background:${cfg.color};color:#000;font-size:0.7em;font-weight:700;padding:2px 8px;border-radius:3px;">${cfg.label}</span>
          <span style="color:#e0e0e0;font-weight:600;font-size:0.9em;">${r.title}</span>
        </div>
        <div style="color:#aaa;font-size:0.83em;line-height:1.4;">${r.desc}</div>
      </div>
    `;
  }).join('');
}


// ================================================
// MASTER RENDER + PRICE FUNCTIONS
// ================================================

function renderWLFI() {
  renderWLFITokenInfo();
  renderWLFITokenomics();
  renderWLFIKeyPeople();
  renderWLFIXAccounts();
  renderWLFINews();
  renderWLFIPosts();
  renderWLFIMarkets();
  renderWLFICorrelations();
  renderWLFIAnalysis();
  renderWLFIRisks();
  fetchWLFIPrice();
  fetchWLFIOverview();
  fetchWLFIInfluencers();
  fetchWLFIAgents();
  initWLFIWebSocket();
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
    chgEl.textContent = (isPos ? '\u25b2 +' : '\u25bc ') + change.toFixed(1) + '% (24h)';
    chgEl.className = 'wlfi-chg ' + (isPos ? 'pos' : 'neg');
  }
}

function refreshWLFI() {
  fetchWLFIPrice();
  fetchWLFIOverview();
  if (typeof showToast === 'function') showToast('WLFI atualizado', 'info');
}


// ================================================
// LIVE API FETCHERS
// ================================================

async function fetchWLFIOverview() {
  try {
    const res = await fetch('/api/wlfi/overview');
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data) return;
    const d = json.data;

    // Update price from overview
    if (d.price) {
      updateWLFIPrice(d.price.current, d.price.change24h);
      // Update token info card with live data
      const mcEl = document.querySelector('#wlfi-token-info');
      if (mcEl) {
        const infoPrice = mcEl.querySelector('#wlfi-info-price');
        if (infoPrice) infoPrice.textContent = '$' + d.price.current.toFixed(4);
      }
    }

    // Render alerts panel
    if (d.alerts && d.alerts.length > 0) {
      renderWLFIAlerts(d.alerts);
    }

    // Render whale activity
    if (d.whaleActivity) {
      renderWLFIWhales(d.whaleActivity);
    }

    // Update sentiment in analysis panel
    if (d.sentiment) {
      renderWLFISentimentBar(d.sentiment);
    }
  } catch (e) {
    console.log('WLFI overview unavailable');
  }
}

async function fetchWLFIInfluencers() {
  try {
    const res = await fetch('/api/wlfi/influencers?limit=25');
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data) return;

    renderWLFIInfluencersLive(json.data);
  } catch (e) {
    console.log('WLFI influencers unavailable');
  }
}

async function fetchWLFIAgents() {
  try {
    const res = await fetch('/api/wlfi/agents');
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !json.data) return;

    renderWLFIAgentPanel(json.data);
  } catch (e) {
    console.log('WLFI agents unavailable');
  }
}


// ================================================
// LIVE RENDERERS (append to existing panels)
// ================================================

function renderWLFIAlerts(alerts) {
  const el = document.getElementById('wlfi-analysis');
  if (!el) return;

  const severityColors = { high: '#ff4757', medium: '#ffa500', low: '#00ff88' };
  const typeIcons = { price: '📈', news: '📰', whale: '🐋', sentiment: '💭', governance: '🏛️' };

  const alertsHtml = alerts.slice(0, 5).map(a => `
    <div style="padding:10px 12px;background:rgba(${a.severity === 'high' ? '255,71,87' : a.severity === 'medium' ? '255,165,0' : '0,255,136'},0.08);border-left:3px solid ${severityColors[a.severity]};border-radius:4px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
        <span>${typeIcons[a.type] || '⚡'}</span>
        <span style="font-size:0.82em;font-weight:600;color:#e0e0e0;">${a.title}</span>
        <span style="margin-left:auto;font-size:0.65em;color:#666;">${a.source}</span>
      </div>
      <div style="font-size:0.75em;color:#999;line-height:1.3;">${a.description}</div>
    </div>
  `).join('');

  // Prepend alerts before existing analysis content
  const existing = el.innerHTML;
  el.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;margin-bottom:8px;">🔔 Alertas em Tempo Real</div>
      ${alertsHtml}
    </div>
  ` + existing;
}

function renderWLFIWhales(whaleData) {
  const el = document.getElementById('wlfi-correlations');
  if (!el) return;

  const txns = whaleData.recentTransactions || [];
  const typeColors = { buy: '#00ff88', sell: '#ff4757', transfer: '#00d4ff' };
  const typeLabels = { buy: 'COMPRA', sell: 'VENDA', transfer: 'TRANSFER' };

  const whaleHtml = txns.slice(0, 5).map(t => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:4px;">
      <span style="font-size:0.65em;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(${t.type === 'buy' ? '0,255,136' : t.type === 'sell' ? '255,71,87' : '0,212,255'},0.15);color:${typeColors[t.type]};">${typeLabels[t.type] || t.type.toUpperCase()}</span>
      <span style="font-size:0.85em;font-weight:600;color:#e0e0e0;">${t.amount}</span>
      <span style="font-size:0.75em;color:#666;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.wallet}</span>
      <span style="font-size:0.7em;color:#555;">${t.time}</span>
    </div>
  `).join('');

  const existing = el.innerHTML;
  el.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;margin-bottom:8px;">🐋 Whale Activity <span style="color:#00ff88;font-size:0.9em;">(Net: ${whaleData.netFlow24h})</span></div>
      ${whaleHtml}
    </div>
  ` + existing;
}

function renderWLFISentimentBar(sentiment) {
  const container = document.getElementById('wlfi-risks');
  if (!container) return;

  const scoreColor = sentiment.score > 60 ? '#00ff88' : sentiment.score > 40 ? '#ffa500' : '#ff4757';

  const barHtml = `
    <div style="padding:12px 14px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.12);border-radius:8px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:0.75em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;">📊 Sentiment Score</span>
        <span style="font-size:1.2em;font-weight:700;color:${scoreColor};">${sentiment.score}/100</span>
      </div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px;">
        <div style="width:${sentiment.bullish}%;background:#00ff88;border-radius:4px 0 0 4px;" title="Bullish ${sentiment.bullish}%"></div>
        <div style="width:${sentiment.neutral}%;background:#ffa500;" title="Neutral ${sentiment.neutral}%"></div>
        <div style="width:${sentiment.bearish}%;background:#ff4757;border-radius:0 4px 4px 0;" title="Bearish ${sentiment.bearish}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:0.7em;">
        <span style="color:#00ff88;">🟢 Bull ${sentiment.bullish}%</span>
        <span style="color:#ffa500;">🟡 Neutro ${sentiment.neutral}%</span>
        <span style="color:#ff4757;">🔴 Bear ${sentiment.bearish}%</span>
      </div>
    </div>
  `;

  // Prepend before existing risk cards
  const existing = container.innerHTML;
  container.innerHTML = barHtml + existing;
}

function renderWLFIInfluencersLive(report) {
  const el = document.getElementById('wlfi-x-accounts');
  if (!el) return;

  const catColors = {
    official: { bg: 'rgba(0,212,255,0.15)', color: '#00d4ff' },
    whale: { bg: 'rgba(255,165,0,0.15)', color: '#ffa500' },
    analyst: { bg: 'rgba(255,193,7,0.15)', color: '#ffc107' },
    media: { bg: 'rgba(0,255,136,0.15)', color: '#00ff88' },
    community: { bg: 'rgba(155,89,182,0.15)', color: '#9b59b6' },
    politics: { bg: 'rgba(30,64,175,0.15)', color: '#3b82f6' },
    defi_expert: { bg: 'rgba(14,165,233,0.15)', color: '#0ea5e9' },
  };

  const influencers = report.topInfluencers || [];

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;">Top ${influencers.length} Influencers</span>
      <span style="font-size:0.7em;color:#666;">Reach: ${report.totalReach || '132M'}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${influencers.map((i, idx) => {
        const cat = catColors[i.category] || catColors.community;
        const sentColor = i.sentiment === 'bullish' ? '#00ff88' : i.sentiment === 'bearish' ? '#ff4757' : '#888';
        return `
          <div class="x-account" style="display:flex;align-items:center;gap:8px;padding:8px 10px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${i.avatarColor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.65em;font-weight:700;flex-shrink:0;">${i.avatarInitials}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="font-size:0.8em;font-weight:600;color:#e1e1e1;">${i.name}</span>
                ${i.verified ? '<span style="color:#1da1f2;font-size:0.7em;">✓</span>' : ''}
              </div>
              <div style="font-size:0.7em;color:#666;">${i.handle} · ${i.followers}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <span style="font-size:0.6em;text-transform:uppercase;letter-spacing:0.3px;padding:2px 6px;border-radius:3px;background:${cat.bg};color:${cat.color};font-weight:600;">${i.category}</span>
              <div style="font-size:0.65em;color:${sentColor};margin-top:2px;">${i.recentPosts} posts</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderWLFIAgentPanel(data) {
  const el = document.getElementById('wlfi-analysis');
  if (!el) return;

  const agents = data.agents || [];
  const messages = data.messages || [];
  const insights = data.insights || [];

  const statusColors = { active: '#00ff88', idle: '#ffa500', error: '#ff4757' };
  const statusLabels = { active: '🟢 Ativo', idle: '🟡 Idle', error: '🔴 Erro' };

  const agentCards = agents.map(a => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">
      <span style="width:6px;height:6px;border-radius:50%;background:${statusColors[a.status]};flex-shrink:0;"></span>
      <span style="font-size:0.78em;font-weight:600;color:#e0e0e0;flex:1;">${a.name}</span>
      <span style="font-size:0.65em;color:#666;">${a.dataPoints} pts</span>
      <span style="font-size:0.6em;color:#555;">${(a.interval / 1000)}s</span>
    </div>
  `).join('');

  const msgLog = messages.slice(-5).reverse().map(m => `
    <div style="font-size:0.7em;color:#666;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
      <span style="color:#00d4ff;">${m.from}</span> → <span style="color:#888;">${m.to}</span>
      <span style="color:#555;margin-left:4px;">[${m.type}]</span>
    </div>
  `).join('');

  const insightsList = insights.map(i => `
    <div style="font-size:0.78em;color:#ccc;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);line-height:1.4;">${i}</div>
  `).join('');

  // Replace analysis content with agent system view
  el.innerHTML = `
    <div style="margin-bottom:14px;">
      <div style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;margin-bottom:8px;">🤖 Agentes Ativos</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${agentCards}</div>
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;margin-bottom:8px;">💬 Message Log</div>
      ${msgLog}
    </div>
    <div>
      <div style="font-size:0.7em;text-transform:uppercase;letter-spacing:0.5px;color:#00d4ff;font-weight:600;margin-bottom:8px;">💡 Insights</div>
      ${insightsList}
    </div>
  `;
}


// ================================================
// WEBSOCKET REAL-TIME UPDATES
// ================================================

var _wlfiSocket = null;

function initWLFIWebSocket() {
  if (_wlfiSocket) return;
  if (typeof io === 'undefined') return;

  try {
    _wlfiSocket = io();

    _wlfiSocket.on('wlfiUpdate', function(data) {
      if (!data || !data.price) return;

      // Update price
      updateWLFIPrice(data.price.current, data.price.change24h);

      // Update agent statuses if visible
      if (data.agents) {
        var agentEl = document.getElementById('wlfi-analysis');
        if (agentEl && agentEl.querySelector('[class*="agent"]')) {
          fetchWLFIAgents();
        }
      }
    });

    _wlfiSocket.emit('subscribeWLFI');
  } catch (e) {
    console.log('WLFI WebSocket unavailable');
  }
}

// Auto-refresh every 60 seconds when on WLFI tab
setInterval(function() {
  var wlfiSection = document.getElementById('wlfi-section');
  if (wlfiSection && wlfiSection.classList.contains('active')) {
    fetchWLFIOverview();
  }
}, 60000);
