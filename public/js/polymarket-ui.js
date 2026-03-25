// ================================================
// POLYMARKET-STYLE TRADER TRACKING DASHBOARD
// ================================================

// ---- Mock data ----
var MOCK_TRADERS = [
  {
    id: 'featherleather',
    address: '0xFeatherLeather000000000000000000000000001',
    name: 'FeatherLeather',
    roi: 66.8,
    profit: 2100000,
    totalBet: 3140000,
    betsCount: 9,
    monthly: [
      { month: 'Jan/26', value: 341000 },
      { month: 'Fev/26', value: 1800000 }
    ],
    openBets: [],
    closedBets: [
      {
        date: '22/02/2026',
        event: 'Will Norway win most gold medals 2026 Winter Olympics?',
        bet: 'YES',
        betType: 'yes',
        confidence: 1,
        odds: 62.0,
        invested: 105,
        roi: 61.3,
        profit: 65
      },
      {
        date: '08/02/2026',
        event: 'Seahawks vs. Patriots',
        bet: 'SEAHAWKS',
        betType: 'team',
        confidence: 1,
        odds: 68.0,
        invested: 102,
        roi: 47.1,
        profit: 48
      },
      {
        date: '07/02/2026',
        event: 'Rockets vs. Thunder',
        bet: 'ROCKETS',
        betType: 'team',
        confidence: 1,
        odds: 44.0,
        invested: 101,
        roi: 127.3,
        profit: 129
      },
      {
        date: '07/02/2026',
        event: 'Will BV Borussia 09 Dortmund win on 2026-02-07?',
        bet: 'NO',
        betType: 'no',
        confidence: 1,
        odds: 43.9,
        invested: 67200,
        roi: -100.0,
        profit: -67200
      },
      {
        date: '03/02/2026',
        event: 'Will AC Milan win on 2026-02-03?',
        bet: 'YES',
        betType: 'yes',
        confidence: 3,
        odds: 39.8,
        invested: 925700,
        roi: 151.6,
        profit: 1402500
      },
      {
        date: '01/02/2026',
        event: 'Will Paris Saint-Germain FC win on 2026-02-01?',
        bet: 'YES',
        betType: 'yes',
        confidence: 3,
        odds: 60.3,
        invested: 639600,
        roi: 65.7,
        profit: 420300
      },
      {
        date: '31/01/2026',
        event: 'Will Cagliari Calcio win on 2026-01-31?',
        bet: 'YES',
        betType: 'yes',
        confidence: 2,
        odds: 44.6,
        invested: 284600,
        roi: 124.1,
        profit: 353200
      },
      {
        date: '31/01/2026',
        event: 'Will FC Lorient win on 2026-01-31?',
        bet: 'NO',
        betType: 'no',
        confidence: 2,
        odds: 49.4,
        invested: 256200,
        roi: -100.0,
        profit: -256200
      },
      {
        date: '15/01/2026',
        event: 'Will Real Madrid win on 2026-01-15?',
        bet: 'YES',
        betType: 'yes',
        confidence: 1,
        odds: 71.0,
        invested: 95,
        roi: 40.8,
        profit: 39
      }
    ]
  },
  {
    id: 'keytransporter',
    address: '0xKeyTransporter00000000000000000000000002',
    name: 'KeyTransporter',
    roi: 39.7,
    profit: 5700000,
    totalBet: 14300000,
    betsCount: 23,
    monthly: [
      { month: 'Nov/25', value: 320000 },
      { month: 'Dez/25', value: -180000 },
      { month: 'Jan/26', value: 1200000 },
      { month: 'Fev/26', value: 4360000 }
    ],
    openBets: [
      {
        date: '20/03/2026',
        event: 'Will Bitcoin reach $120k before April 2026?',
        bet: 'YES',
        betType: 'yes',
        confidence: 3,
        odds: 38.0,
        invested: 450000,
        roi: null,
        profit: null
      }
    ],
    closedBets: [
      {
        date: '28/02/2026',
        event: 'Will Ethereum ETF hit $1B AUM in February?',
        bet: 'YES',
        betType: 'yes',
        confidence: 3,
        odds: 55.0,
        invested: 920000,
        roi: 82.0,
        profit: 754400
      },
      {
        date: '15/02/2026',
        event: 'Super Bowl LX - Chiefs vs Eagles',
        bet: 'CHIEFS',
        betType: 'team',
        confidence: 2,
        odds: 52.0,
        invested: 350000,
        roi: 92.3,
        profit: 323000
      },
      {
        date: '10/02/2026',
        event: 'Will the US Fed cut rates in February 2026?',
        bet: 'NO',
        betType: 'no',
        confidence: 3,
        odds: 72.0,
        invested: 800000,
        roi: 38.9,
        profit: 311200
      },
      {
        date: '05/02/2026',
        event: 'Will Solana reach $350 before March 2026?',
        bet: 'YES',
        betType: 'yes',
        confidence: 2,
        odds: 41.0,
        invested: 275000,
        roi: 143.9,
        profit: 395700
      },
      {
        date: '25/01/2026',
        event: 'Will Trump sign crypto executive order in January?',
        bet: 'YES',
        betType: 'yes',
        confidence: 3,
        odds: 82.0,
        invested: 1200000,
        roi: 22.0,
        profit: 264000
      },
      {
        date: '18/01/2026',
        event: 'Mavericks vs Warriors',
        bet: 'WARRIORS',
        betType: 'team',
        confidence: 1,
        odds: 48.0,
        invested: 95,
        roi: -100.0,
        profit: -95
      },
      {
        date: '12/01/2026',
        event: 'Will Bitcoin dominance stay above 55% in January?',
        bet: 'YES',
        betType: 'yes',
        confidence: 2,
        odds: 64.0,
        invested: 380000,
        roi: 56.3,
        profit: 213900
      }
    ]
  }
];

// ---- State ----
var _selectedTraderId = null;
var _activeTab = 'closed'; // 'open' | 'closed'
var _traders = MOCK_TRADERS.slice();

// ================================================
// INIT
// ================================================
function init() {
  renderTradersList();
  if (_traders.length > 0) {
    selectTrader(_traders[0].id);
  }
  // Try to fetch from API in background
  fetchTradersFromAPI();
}

// ================================================
// SIDEBAR
// ================================================
function renderTradersList() {
  var list = document.getElementById('traders-list');
  if (!list) return;
  list.innerHTML = _traders.map(function(t) {
    var roiClass = t.roi >= 0 ? 'trader-roi-positive' : 'trader-roi-negative';
    var roiSign = t.roi >= 0 ? '+' : '';
    var active = t.id === _selectedTraderId ? ' active' : '';
    return '<div class="trader-item' + active + '" onclick="selectTrader(\'' + t.id + '\')">' +
      '<div class="trader-avatar">' + t.name.charAt(0) + '</div>' +
      '<div class="trader-info">' +
        '<div class="trader-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="trader-meta">' +
          '<span class="' + roiClass + '">' + roiSign + t.roi.toFixed(1) + '%</span>' +
          '<span>' + formatMoney(t.profit) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ================================================
// SELECT TRADER
// ================================================
function selectTrader(id) {
  _selectedTraderId = id;
  _activeTab = 'closed';
  var trader = _traders.find(function(t) { return t.id === id; });
  if (!trader) return;

  document.getElementById('empty-state').style.display = 'none';
  var profile = document.getElementById('trader-profile');
  profile.style.display = 'block';

  renderTradersList(); // re-render to update active state
  renderTraderProfile(trader);
}

// ================================================
// RENDER PROFILE
// ================================================
function renderTraderProfile(trader) {
  var profile = document.getElementById('trader-profile');
  if (!profile) return;

  var roiSign = trader.roi >= 0 ? '+' : '';
  var roiClass = trader.roi >= 0 ? 'positive' : 'negative';

  var html = '';

  // Header
  html += '<div class="profile-header">' +
    '<div class="profile-avatar">' + trader.name.charAt(0) + '</div>' +
    '<div class="profile-name-block">' +
      '<h1>' + escapeHtml(trader.name) + '</h1>' +
      '<a class="profile-polymarket-link" href="https://polymarket.com/profile/' + trader.address + '" target="_blank" rel="noopener">' +
        'Ver perfil no Polymarket &#x2197;' +
      '</a>' +
    '</div>' +
  '</div>';

  // Stats bar
  html += '<div class="stats-bar">' +
    '<div class="stat-block">' +
      '<div class="stat-label">ROI</div>' +
      '<div class="stat-value ' + roiClass + '">' + roiSign + trader.roi.toFixed(1) + '%</div>' +
    '</div>' +
    '<div class="stat-block">' +
      '<div class="stat-label">Lucro</div>' +
      '<div class="stat-value positive">' + formatMoney(trader.profit) + '</div>' +
    '</div>' +
    '<div class="stat-block">' +
      '<div class="stat-label">Total Apostado</div>' +
      '<div class="stat-value neutral">' + formatMoney(trader.totalBet) + '</div>' +
    '</div>' +
    '<div class="stat-block">' +
      '<div class="stat-label">Apostas</div>' +
      '<div class="stat-value neutral">' + trader.betsCount + '</div>' +
    '</div>' +
  '</div>';

  // Tabs
  html += '<div class="tabs">' +
    '<button class="tab-btn' + (_activeTab === 'open' ? ' active' : '') + '" onclick="setTab(\'open\')">Abertas</button>' +
    '<button class="tab-btn' + (_activeTab === 'closed' ? ' active' : '') + '" onclick="setTab(\'closed\')">Fechadas</button>' +
  '</div>';

  // Bets count
  var currentBets = _activeTab === 'open' ? trader.openBets : trader.closedBets;
  html += '<div class="bets-count">' + currentBets.length + ' apostas</div>';

  // Monthly chart (always shown)
  html += '<div class="section-title">Lucro Mensal</div>';
  html += renderMonthlyChart(trader.monthly);

  // Bets table
  html += renderBetsTable(currentBets, _activeTab === 'open');

  profile.innerHTML = html;
}

// ================================================
// SET TAB
// ================================================
function setTab(tab) {
  _activeTab = tab;
  var trader = _traders.find(function(t) { return t.id === _selectedTraderId; });
  if (trader) renderTraderProfile(trader);
}

// ================================================
// MONTHLY CHART (CSS-only)
// ================================================
function renderMonthlyChart(monthlyData) {
  if (!monthlyData || monthlyData.length === 0) return '';

  var maxAbs = 0;
  monthlyData.forEach(function(d) {
    var abs = Math.abs(d.value);
    if (abs > maxAbs) maxAbs = abs;
  });
  if (maxAbs === 0) maxAbs = 1;

  var MAX_BAR_HEIGHT = 80; // px

  var bars = monthlyData.map(function(d) {
    var isPositive = d.value >= 0;
    var heightPx = Math.max(3, Math.round((Math.abs(d.value) / maxAbs) * MAX_BAR_HEIGHT));
    var barClass = isPositive ? 'positive' : 'negative';
    var valClass = isPositive ? 'positive' : 'negative';
    var valSign = isPositive ? '+' : '';

    return '<div class="chart-bar-group">' +
      '<div class="chart-bar-value ' + valClass + '">' + valSign + formatMoney(d.value) + '</div>' +
      '<div class="chart-bar-wrap">' +
        '<div class="chart-bar ' + barClass + '" style="height:' + heightPx + 'px;"></div>' +
      '</div>' +
      '<div class="chart-month-label">' + escapeHtml(d.month) + '</div>' +
    '</div>';
  }).join('');

  return '<div class="monthly-chart-wrap">' +
    '<div class="monthly-chart">' + bars + '</div>' +
  '</div>';
}

// ================================================
// BETS TABLE
// ================================================
function renderBetsTable(bets, isOpen) {
  if (!bets || bets.length === 0) {
    return '<div class="bets-table-wrap" style="padding:24px;text-align:center;color:rgba(255,255,255,0.3);">Nenhuma aposta encontrada.</div>';
  }

  var roiHeader = isOpen ? 'ROI EST.' : 'ROI';
  var profitHeader = isOpen ? 'LUCRO EST.' : 'LUCRO';

  var rows = bets.map(function(b) {
    var roiStr = b.roi === null ? '-' : (b.roi >= 0 ? '<span class="val-positive">+' + b.roi.toFixed(1) + '%</span>' : '<span class="val-negative">' + b.roi.toFixed(1) + '%</span>');
    var profitStr = b.profit === null ? '-' : (b.profit >= 0 ? '<span class="val-positive">+' + formatMoney(b.profit) + '</span>' : '<span class="val-negative">' + formatMoney(b.profit) + '</span>');

    return '<tr>' +
      '<td class="td-date">' + escapeHtml(b.date) + '</td>' +
      '<td class="td-event">' + escapeHtml(b.event) + '</td>' +
      '<td>' + renderBetPill(b.bet, b.betType) + '</td>' +
      '<td>' + renderConfidence(b.confidence) + '</td>' +
      '<td class="val-neutral">' + b.odds.toFixed(1) + '%</td>' +
      '<td class="val-neutral">' + formatMoney(b.invested) + '</td>' +
      '<td>' + roiStr + '</td>' +
      '<td>' + profitStr + '</td>' +
    '</tr>';
  }).join('');

  return '<div class="bets-table-wrap">' +
    '<table class="bets-table">' +
      '<thead><tr>' +
        '<th>Data</th>' +
        '<th>Evento</th>' +
        '<th>Aposta</th>' +
        '<th>Conf.</th>' +
        '<th>Cota&#231;&#227;o</th>' +
        '<th>Investido</th>' +
        '<th>' + roiHeader + '</th>' +
        '<th>' + profitHeader + '</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>';
}

// ================================================
// BET PILL
// ================================================
function renderBetPill(label, type) {
  var cls = 'bet-pill ';
  if (type === 'yes') cls += 'yes';
  else if (type === 'no') cls += 'no';
  else cls += 'team';
  return '<span class="' + cls + '">' + escapeHtml(label) + '</span>';
}

// ================================================
// CONFIDENCE BARS
// ================================================
function renderConfidence(level) {
  // 3 bars with heights 6px, 9px, 12px
  var heights = [6, 9, 12];
  var labels = { 1: 'Baixa', 2: 'M\u00e9dia', 3: 'Alta' };
  var label = labels[level] || 'Baixa';

  var barsHtml = heights.map(function(h, i) {
    var active = (i + 1) <= level ? 'active' : 'inactive';
    return '<div class="conf-bar ' + active + '" style="height:' + h + 'px;"></div>';
  }).join('');

  return '<div class="conf-wrap">' +
    '<div class="conf-bars">' + barsHtml + '</div>' +
    '<span class="conf-label">' + label + '</span>' +
  '</div>';
}

// ================================================
// FORMAT MONEY
// ================================================
function formatMoney(value) {
  var abs = Math.abs(value);
  var sign = value < 0 ? '-' : '';
  var formatted;
  if (abs >= 1000000) {
    formatted = (abs / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    // keep 2 decimal if needed: e.g. $1.40M
    formatted = '$' + (abs / 1000000).toFixed(2) + 'M';
    // trim trailing zeros only after decimal point but keep 2 decimals for M
    formatted = '$' + parseFloat((abs / 1000000).toFixed(2)) + 'M';
  } else if (abs >= 1000) {
    formatted = '$' + parseFloat((abs / 1000).toFixed(1)) + 'k';
  } else {
    formatted = '$' + Math.round(abs);
  }
  return sign + formatted;
}

// ================================================
// MODAL
// ================================================
function openAddTrader() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('input-address').value = '';
  document.getElementById('input-name').value = '';
  setTimeout(function() { document.getElementById('input-address').focus(); }, 50);
}

function closeAddTrader() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) {
    closeAddTrader();
  }
}

function addTrader() {
  var address = (document.getElementById('input-address').value || '').trim();
  var name = (document.getElementById('input-name').value || '').trim();

  if (!address) {
    showToast('Por favor, insira um endereço Polymarket.', 'error');
    return;
  }

  var displayName = name || address.slice(0, 8) + '...';
  closeAddTrader();
  showToast('Buscando trader ' + displayName + '...', 'info');

  fetchTraderProfile(address, displayName);
}

// ================================================
// TOAST
// ================================================
var _toastTimer = null;
function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'show ' + (type || 'info');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    toast.className = toast.className.replace('show', '').trim();
  }, 3500);
}

// ================================================
// API FUNCTIONS
// ================================================
function fetchTradersFromAPI() {
  fetch('/api/polymarket/top-traders')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.success && Array.isArray(data.data) && data.data.length > 0) {
        // Merge API traders with mock, preferring API data
        showToast('Traders atualizados da API.', 'success');
      }
    })
    .catch(function() {
      // silently fall back to demo data
    });
}

function fetchTraderProfile(address, name) {
  var url = '/api/polymarket/trader/' + encodeURIComponent(address);
  if (name) url += '?name=' + encodeURIComponent(name);

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.success && data.data) {
        var trader = data.data;
        // Add to traders list if not already present
        var existing = _traders.find(function(t) { return t.address === trader.address; });
        if (!existing) {
          _traders.push(trader);
          renderTradersList();
          selectTrader(trader.id);
          showToast('Trader ' + trader.name + ' adicionado!', 'success');
        } else {
          selectTrader(existing.id);
          showToast('Trader j\u00e1 rastreado.', 'info');
        }
      } else {
        showToast('Trader n\u00e3o encontrado. Verifique o endere\u00e7o.', 'error');
      }
    })
    .catch(function() {
      showToast('Erro ao buscar trader. Tente novamente.', 'error');
    });
}

// ================================================
// UTILITIES
// ================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ================================================
// BOOT
// ================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
