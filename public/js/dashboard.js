// ================================================
// DASHBOARD CLIENT — Real-time UI Updates
// ================================================

(function() {
  'use strict';

  // ========================================
  // AUTH
  // ========================================
  const authToken = localStorage.getItem('auth_token');
  if (!authToken) {
    window.location.href = '/login';
    return;
  }

  // ========================================
  // DOM ELEMENTS
  // ========================================
  const $ = (id) => document.getElementById(id);

  const els = {
    botStatus:         $('bot-status'),
    bankroll:          $('header-bankroll'),
    pnl:               $('header-pnl'),
    uptime:            $('header-uptime'),
    statMarkets:       $('stat-markets'),
    statOpportunities: $('stat-opportunities'),
    statTrades:        $('stat-trades'),
    statWinrate:       $('stat-winrate'),
    statCycle:         $('stat-cycle'),
    statAvgEdge:       $('stat-avg-edge'),
    statOpenPositions: $('stat-open-positions'),
    footerMode:        $('footer-mode'),
    positionsList:     $('positions-list'),
    positionsCount:    $('positions-count'),
    riskDrawdown:      $('risk-drawdown'),
    riskDrawdownBar:   $('risk-drawdown-bar'),
    riskExposure:      $('risk-exposure'),
    riskExposureBar:   $('risk-exposure-bar'),
    riskPositions:     $('risk-positions'),
    riskDailyLoss:     $('risk-daily-loss'),
    riskCircuit:       $('risk-circuit'),
    resetCircuitBtn:   $('reset-circuit-btn'),
    decisionsFeed:     $('decisions-feed'),
    notificationsFeed: $('notifications-feed'),
    notifCount:        $('notif-count'),
    // Calibration
    calBrier:          $('cal-brier'),
    calBrierQual:      $('cal-brier-qual'),
    toggleMmMode:      $('toggle-mm-mode'),
    modeBadge:         $('mode-badge'),
    lastScan:          $('header-last-scan'),
    liveWarningBox:    $('live-warning-box'),
    // History
    historyBody:       $('history-body'),
    hTotalTrades:      $('h-total-trades'),
    hWinRate:          $('h-win-rate'),
    hTotalPnl:         $('h-total-pnl'),
    hProfitFactor:     $('h-profit-factor'),
    activePositionsList: $('active-positions-list'),
    activePosCount:    $('active-pos-count'),
  };

  let notifTotal = 0;

  // ========================================
  // UTILS
  // ========================================
  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatNumber(n, decimals = 2) {
    return (n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str ? str.replace(/"/g, '&quot;') : '';
  }

  function flashElement(el) {
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1000);
  }

  function setStatus(code, label) {
    if (!els.botStatus) return;
    els.botStatus.className = 'status-badge ' + code;
    els.botStatus.querySelector('.status-lbl').textContent = label;
  }

  // ========================================
  // BOOTSTRAP
  // ========================================
  async function init() {
    let backendUrl = '';
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      backendUrl = (cfg.backendUrl || '').replace(/\/$/, '');
    } catch (e) {
      console.warn('[Dashboard] Config fetch failed, using same-origin.');
    }

    function authFetch(path, options = {}) {
      const headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + authToken,
      });
      const url = backendUrl ? backendUrl + path : path;
      return fetch(url, Object.assign({}, options, { headers }));
    }

    // ========================================
    // SOCKET
    // ========================================
    const socketOpts = { auth: { token: authToken }, query: { token: authToken } };
    const socket = backendUrl ? io(backendUrl, socketOpts) : io(socketOpts);

    socket.on('connect', () => setStatus('connecting', 'Conectado'));
    socket.on('connect_error', (err) => {
      if (err.message === 'Autenticação necessária') {
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
        return;
      }
      setStatus('stopped', 'Erro de Conexão');
    });
    socket.on('disconnect', () => setStatus('stopped', 'Desconectado'));

    socket.on('init', (data) => {
      if (data.status)        updateStatus(data.status);
      if (data.decisions)     renderDecisions(data.decisions);
      if (data.trades) {
        updateTradeStats(data.trades.stats);
        renderPositions(data.trades.open);
        renderActivePositions(data.trades.open);
      }
      if (data.risk)          updateRisk(data.risk);
      if (data.notifications) renderNotifications(data.notifications);
      fetchPerformance();
      loadHistory();
    });

    socket.on('statusUpdate',   (status) => updateStatus(status));
    socket.on('decision',       (decision) => addDecision(decision));
    socket.on('tradeExecuted',  (trade) => {
      addPosition(trade);
      renderActivePositions();
      flashElement(els.statTrades);
    });
    socket.on('tradeResolved',  (data) => {
      removePosition(data.trade.marketId);
      renderActivePositions();
      loadHistory();
      fetchPerformance();
    });
    socket.on('notification',   (n) => addNotification(n));
    socket.on('scanComplete',   () => {
      flashElement(els.statMarkets);
      if (els.lastScan) els.lastScan.textContent = new Date().toLocaleTimeString('pt-BR');
    });

    // ========================================
    // NAVIGATION
    // ========================================
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = $(tabId);
        if (target) {
          target.classList.add('active');
          if (tabId === 'tab-dashboard') fetchPerformance();
          if (tabId === 'tab-history') loadHistory();
        }
      });
    });

    window.switchTab = (tabId) => {
      document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.tab === tabId) btn.click();
      });
    };

    // ========================================
    // HISTORY LOGIC
    // ========================================
    const applyFiltersBtn = $('apply-filters-btn');
    if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', loadHistory);

    async function loadHistory() {
      const filters = {
        mode:   $('f-mode').value,
        days:   $('f-days').value,
        status: $('f-status').value,
        search: $('f-search').value.trim()
      };
      try {
        const query = new URLSearchParams();
        if (filters.mode !== 'all') query.append('dryRun', filters.mode);
        if (filters.status !== 'all') query.append('status', filters.status);
        if (filters.days !== '0') query.append('days', filters.days);
        if (filters.search) query.append('search', filters.search);

        const res = await authFetch(`/api/trades/history?${query.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        renderHistoryTable(data.trades);
        updateHistoryStats(data.trades);
      } catch (err) {
        console.error('History load failed', err);
      }
    }

    function renderHistoryTable(trades) {
      if (!trades || trades.length === 0) {
        els.historyBody.innerHTML = '<tr><td colspan="9" class="empty-state">Sem registros para estes filtros.</td></tr>';
        return;
      }
      els.historyBody.innerHTML = trades.map(t => {
        const pnl = t.pnl || 0;
        const pnlClass = pnl > 0 ? 'text-emerald' : pnl < 0 ? 'text-rose' : '';
        const outcome = t.status === 'won' ? '🎯 GANHOU' : t.status === 'lost' ? '💀 PERDEU' : t.status === 'open' ? '⏳ ABERTO' : '💰 SAIU';
        const outcomeClass = t.status === 'won' ? 'status-won' : t.status === 'lost' ? 'status-lost' : 'status-open';
        return `
          <tr>
            <td><small>${formatTime(t.timestamp)}</small><br><span class="badge ${t.dryRun?'sim':'real'}">${t.dryRun?'SIM':'REAL'}</span></td>
            <td><strong>${escapeHtml(t.question.substring(0,60))}...</strong></td>
            <td><span class="position-side ${t.side === 'BUY_YES' ? 'side-yes' : 'side-no'}">${t.side === 'BUY_YES' ? 'YES' : 'NO'}</span></td>
            <td>$${t.entryPrice.toFixed(3)}</td>
            <td>$${t.stake.toFixed(2)}</td>
            <td><span class="text-emerald">+${(t.edge*100).toFixed(1)}%</span></td>
            <td class="${outcomeClass}">${outcome}</td>
            <td>${t.resolvedAt ? formatTime(t.resolvedAt) : '—'}</td>
            <td class="m-pnl ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}">$${pnl.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    }

    function updateHistoryStats(trades) {
      const closed = trades.filter(t => t.status !== 'open');
      const wins = closed.filter(t => t.status === 'won').length;
      const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
      els.hTotalTrades.textContent = trades.length;
      els.hWinRate.textContent = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) + '%' : '0%';
      els.hTotalPnl.textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
      els.hTotalPnl.className = 'h-stat-val ' + (totalPnl >= 0 ? 'text-emerald' : 'text-rose');
    }

    // ========================================
    // MONITOR LOGIC (Active Positions)
    // ========================================
    async function renderActivePositions(trades) {
      if (!trades) {
        const res = await authFetch('/api/trades');
        const data = await res.json();
        trades = data.open;
      }
      if (els.activePosCount) els.activePosCount.textContent = trades.length;
      if (trades.length === 0) {
        els.activePositionsList.innerHTML = '<div class="empty-state">Sem posições abertas.</div>';
        return;
      }
      els.activePositionsList.innerHTML = trades.map(t => {
        const varPct = t.currentPrice ? ((t.currentPrice / t.entryPrice) - 1) * 100 : 0;
        return `
          <div class="mini-pos-card">
            <div class="mini-pos-header">
              <span class="mini-pos-q">${escapeHtml(t.question.substring(0,50))}...</span>
              <span class="position-side ${t.side === 'BUY_YES' ? 'side-yes' : 'side-no'}">${t.side === 'BUY_YES' ? 'YES' : 'NO'}</span>
            </div>
            <div class="mini-pos-body">
              <span>Stake: $${t.stake.toFixed(2)}</span>
              <span class="m-pnl ${varPct>=0?'pos':'neg'}">${varPct>=0?'+':''}${varPct.toFixed(1)}%</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // ========================================
    // PERFORMANCE & CHARTS
    // ========================================
    async function fetchPerformance() {
      try {
        const res = await authFetch('/api/performance');
        if (!res.ok) return;
        const data = await res.json();
        updatePerformanceUI(data);
      } catch (err) {
        console.error('Perf fetch failed');
      }
    }

    function updatePerformanceUI(p) {
      const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
      set('perf-winrate', (p.winRate * 100).toFixed(1) + '%');
      set('perf-maxdd', p.maxDrawdownPct.toFixed(1) + '%');
      set('perf-sharpe', p.sharpeRatio.toFixed(2));
      set('perf-pf', p.profitFactor.toFixed(2));
      // ... more metrics if needed
    }

    // ========================================
    // SETTINGS & ACTIONS
    // ========================================
    if (els.resetCircuitBtn) {
      els.resetCircuitBtn.addEventListener('click', async () => {
        const res = await authFetch('/api/risk/reset', { method: 'POST' });
        if (res.ok) loadHistory();
      });
    }

    if (els.toggleMmMode) {
      els.toggleMmMode.addEventListener('change', async (e) => {
        const mode = e.target.checked ? 'MARKET_MAKER' : 'DIRECTIONAL';
        const res = await authFetch('/api/settings/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode })
        });
        if (!res.ok) e.target.checked = !e.target.checked;
      });
    }

    // ========================================
    // INTERNAL HELPERS
    // ========================================
    function updateStatus(s) {
      if (els.botStatus) setStatus(s.active ? 'running' : 'stopped', s.active ? 'Operando' : 'Pausado');
      if (els.bankroll) els.bankroll.textContent = '$' + formatNumber(s.bankroll);
      if (els.pnl) {
        els.pnl.textContent = (s.totalPnl >= 0 ? '+' : '') + '$' + formatNumber(s.totalPnl);
        els.pnl.className = 'header-val ' + (s.totalPnl >= 0 ? 'pos' : 'neg');
      }
      if (els.uptime) els.uptime.textContent = s.uptime;
      if (els.statCycle) els.statCycle.textContent = s.cycleCount;
      if (els.modeBadge) {
        els.modeBadge.textContent = s.mode === 'MARKET_MAKER' ? 'MARKET MAKER' : 'DIRECIONAL';
        els.modeBadge.className = 'mode-badge ' + s.mode.toLowerCase();
      }
    }

    function renderDecisions(decisions) {
      if (!els.decisionsFeed) return;
      els.decisionsFeed.innerHTML = decisions.length === 0 ? '<div class="empty-state">IA em standby.</div>' : '';
      decisions.forEach(d => addDecision(d, false));
    }

    function addDecision(decision, prepend = true) {
      const iconMap = { scan: '🔍', opportunity: '🎯', trade: '✅', reject: '⛔', risk: '🚨', monitor: '📡', system: '⚙️' };
      const html = `<div class="dec-line type-${decision.type || 'system'}">
        <span class="dec-ts">${formatTime(decision.timestamp).split(' ')[1]}</span>
        <span class="dec-icon">${iconMap[decision.type] || '📋'}</span>
        <span class="dec-msg">${escapeHtml(decision.message)}</span>
      </div>`;
      if (prepend) {
        els.decisionsFeed.insertAdjacentHTML('afterbegin', html);
        if (els.decisionsFeed.children.length > 100) els.decisionsFeed.removeChild(els.decisionsFeed.lastChild);
      } else {
        els.decisionsFeed.insertAdjacentHTML('beforeend', html);
      }
    }

    function updateRisk(risk) {
      if (els.riskDrawdown) els.riskDrawdown.textContent = risk.drawdownPct.toFixed(1) + '%';
      if (els.riskDrawdownBar) els.riskDrawdownBar.style.width = Math.min(risk.drawdownPct * 5, 100) + '%';
      if (els.riskExposure) els.riskExposure.textContent = '$' + formatNumber(risk.totalExposure);
      if (els.riskExposureBar) els.riskExposureBar.style.width = Math.min((risk.totalExposure / risk.maxExposure) * 100, 100) + '%';
      if (els.riskCircuit) {
        els.riskCircuit.textContent = risk.circuitBreaker ? '🚨 ATIVO' : '● OK';
        els.riskCircuit.className = 'risk-stat-val ' + (risk.circuitBreaker ? 'danger' : 'ok');
        if (els.resetCircuitBtn) els.resetCircuitBtn.classList.toggle('hidden', !risk.circuitBreaker);
      }
    }

    function renderNotifications(notifs) {
      if (!els.notificationsFeed) return;
      els.notificationsFeed.innerHTML = notifs.length === 0 ? '<div class="empty-state">Sem alertas.</div>' : '';
      notifs.forEach(n => addNotification(n, false));
    }

    function addNotification(n, prepend = true) {
      const html = `<div class="notif-card ${n.level || 'info'}">
        <div class="notif-header">
          <span class="notif-type">${n.type}</span>
          <span class="notif-ts">${formatTime(n.timestamp)}</span>
        </div>
        <div class="notif-msg">${escapeHtml(n.message)}</div>
      </div>`;
      if (prepend) {
        els.notificationsFeed.insertAdjacentHTML('afterbegin', html);
        notifTotal++;
        if (els.notifCount) { els.notifCount.textContent = notifTotal; els.notifCount.classList.remove('hidden'); }
      } else {
        els.notificationsFeed.insertAdjacentHTML('beforeend', html);
      }
    }

    function updateTradeStats(stats) {
      if (els.statTrades) els.statTrades.textContent = stats.count;
      if (els.statWinrate) els.statWinrate.textContent = (stats.winRate * 100).toFixed(1) + '%';
      if (els.statAvgEdge) els.statAvgEdge.textContent = (stats.avgEdge * 100).toFixed(1) + '%';
    }

    function renderPositions(open) {
      if (!els.positionsList) return;
      if (els.positionsCount) els.positionsCount.textContent = open.length;
      els.positionsList.innerHTML = open.length === 0 ? '<div class="empty-state">Sem trades abertos.</div>' : '';
      open.forEach(t => {
        const html = `<div class="pos-card" id="pos-${t.marketId}">
          <div class="pos-top">
            <span class="pos-side ${t.side === 'BUY_YES' ? 'side-yes' : 'side-no'}">${t.side === 'BUY_YES' ? 'YES' : 'NO'}</span>
            <span class="pos-price">$${t.entryPrice.toFixed(3)}</span>
          </div>
          <div class="pos-q">${escapeHtml(t.question.substring(0, 50))}...</div>
          <div class="pos-bottom">
            <span>Stake: $${t.stake.toFixed(2)}</span>
            <span class="pos-edge">+${(t.edge * 100).toFixed(1)}%</span>
          </div>
        </div>`;
        els.positionsList.insertAdjacentHTML('beforeend', html);
      });
    }

    function addPosition(t) {
      if (!els.positionsList) return;
      const empty = els.positionsList.querySelector('.empty-state');
      if (empty) els.positionsList.innerHTML = '';
      // ... same logic as renderPositions loop
      renderPositions([t]); // Simplistic add
    }

    function removePosition(marketId) {
      const el = $(`pos-${marketId}`);
      if (el) el.remove();
      if (els.positionsList && els.positionsList.children.length === 0) {
        els.positionsList.innerHTML = '<div class="empty-state">Sem trades abertos.</div>';
      }
    }

  } // End Init

  init().catch(console.error);

})();
