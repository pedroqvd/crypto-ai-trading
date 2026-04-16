// ================================================
// DASHBOARD CLIENT — Real-time UI Updates (Authenticated)
// ================================================

(function() {
  'use strict';

  // ========================================
  // AUTH — Get token from localStorage
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
    botStatus: $('bot-status'),
    statusDot: null,
    statusText: null,
    bankroll: $('header-bankroll'),
    pnl: $('header-pnl'),
    uptime: $('header-uptime'),
    statMarkets: $('stat-markets'),
    statOpportunities: $('stat-opportunities'),
    statTrades: $('stat-trades'),
    statWinrate: $('stat-winrate'),
    statCycle: $('stat-cycle'),
    positionsList: $('positions-list'),
    positionsCount: $('positions-count'),
    riskDrawdown: $('risk-drawdown'),
    riskDrawdownBar: $('risk-drawdown-bar'),
    riskExposure: $('risk-exposure'),
    riskExposureBar: $('risk-exposure-bar'),
    riskPositions: $('risk-positions'),
    riskDailyLoss: $('risk-daily-loss'),
    riskCircuit: $('risk-circuit'),
    resetCircuitBtn: $('reset-circuit-btn'),
    decisionsFeed: $('decisions-feed'),
    journalBody: $('journal-body'),
    notificationsFeed: $('notifications-feed'),
    footerMode: $('footer-mode'),
  };

  let currentFilter = 'all';

  // ========================================
  // BOOTSTRAP — Load backend URL then connect
  // ========================================
  async function init() {
    // Fetch config from the host serving this page.
    // When frontend is on Vercel and bot is on Oracle Cloud,
    // Vercel sets ORACLE_BACKEND_URL → backendUrl points to Oracle.
    // When running directly on Oracle Cloud, backendUrl is '' and
    // all connections stay relative (same origin).
    let backendUrl = '';
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      backendUrl = (cfg.backendUrl || '').replace(/\/$/, '');
    } catch (_) {
      // Config fetch failed — assume same-origin (Oracle direct access)
    }

    // ========================================
    // AUTH FETCH — Adds JWT token to all API calls
    // Prepends backendUrl when connecting cross-origin (Vercel → Oracle)
    // ========================================
    function authFetch(path, options = {}) {
      const headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + authToken,
      });
      const url = backendUrl ? backendUrl + path : path;
      return fetch(url, Object.assign({}, options, { headers }));
    }

    // ========================================
    // SOCKET CONNECTION (with JWT auth)
    // ========================================
    const socketOpts = {
      auth: { token: authToken },
      query: { token: authToken },
    };
    const socket = backendUrl ? io(backendUrl, socketOpts) : io(socketOpts);

    // ========================================
    // SOCKET EVENTS
    // ========================================
    socket.on('connect', () => {
      console.log('🟢 Connected (authenticated)');
      setStatus('connecting', 'Conectado');
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'Autenticação necessária') {
        console.log('🔴 Auth failed — redirecting to login');
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
        return;
      }
      console.log('🔴 Connection error:', err.message);
      setStatus('stopped', 'Erro');
    });

    socket.on('disconnect', () => {
      console.log('🔴 Disconnected');
      setStatus('stopped', 'Desconectado');
    });

    // Initial state from server
    socket.on('init', (data) => {
      console.log('📦 Received initial state:', data);
      if (data.status) updateStatus(data.status);
      if (data.decisions) renderDecisions(data.decisions);
      if (data.trades) {
        updateTradeStats(data.trades.stats);
        renderPositions(data.trades.open);
        renderJournal(data.trades.recent);
      }
      if (data.risk) updateRisk(data.risk);
      if (data.notifications) renderNotifications(data.notifications);
    });

    // Real-time updates
    socket.on('statusUpdate', (status) => updateStatus(status));
    socket.on('decision', (decision) => addDecision(decision));
    socket.on('tradeExecuted', (trade) => {
      addPosition(trade);
      addJournalRow(trade);
      flashElement(els.statTrades);
    });
    socket.on('tradeResolved', (data) => {
      removePosition(data.trade.marketId);
      updateJournalRow(data.trade.id, data.won, data.pnl);
    });
    socket.on('notification', (notification) => addNotification(notification));
    socket.on('scanComplete', () => flashElement(els.statMarkets));

    // ========================================
    // JOURNAL FILTERS
    // ========================================
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        authFetch('/api/trades')
          .then(r => r.json())
          .then(data => renderJournal(data.recent));
      });
    });

    // ========================================
    // LOGOUT
    // ========================================
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('auth_token');
        socket.disconnect();
        window.location.href = '/login';
      });
    }

    // ========================================
    // RESET CIRCUIT BREAKER
    // ========================================
    if (els.resetCircuitBtn) {
      els.resetCircuitBtn.addEventListener('click', async () => {
        if (!confirm('Resetar o circuit breaker e retomar operações? Certifique-se de que as condições de mercado são favoráveis.')) {
          return;
        }

        els.resetCircuitBtn.disabled = true;
        els.resetCircuitBtn.textContent = '⏳ Resetando...';

        try {
          const res = await authFetch('/api/risk/reset', { method: 'POST' });
          if (res.ok) {
            els.riskCircuit.textContent = '✅ OK';
            els.riskCircuit.className = 'risk-value-large risk-ok';
            els.resetCircuitBtn.classList.add('hidden');
            addNotification({
              type: 'system',
              title: '🔄 Circuit Breaker Resetado',
              message: 'O circuit breaker foi desativado manualmente. Bot retomará operações no próximo ciclo.',
              timestamp: new Date().toISOString(),
            });
          } else {
            const data = await res.json().catch(() => ({}));
            alert('Erro ao resetar circuit breaker: ' + (data.error || res.statusText));
          }
        } catch (err) {
          alert('Erro de rede ao resetar circuit breaker.');
          console.error(err);
        } finally {
          els.resetCircuitBtn.disabled = false;
          els.resetCircuitBtn.textContent = '🔄 Resetar';
        }
      });
    }
  }

  // ========================================
  // STATUS UPDATES
  // ========================================
  function updateStatus(status) {
    // Mode
    if (status.dryRun) {
      setStatus('dryrun', 'Dry-Run');
      els.footerMode.textContent = 'DRY-RUN';
      els.footerMode.className = 'mode-badge dryrun';
    } else if (status.running) {
      setStatus('running', 'Operando');
      els.footerMode.textContent = 'LIVE';
      els.footerMode.className = 'mode-badge live';
    } else {
      setStatus('stopped', 'Parado');
    }

    // Stats
    els.bankroll.textContent = formatMoney(status.bankroll);

    const pnlVal = status.totalPnl || 0;
    els.pnl.textContent = (pnlVal >= 0 ? '+' : '') + formatMoney(pnlVal);
    els.pnl.className = 'header-stat-value ' + (pnlVal > 0 ? 'pnl-positive' : pnlVal < 0 ? 'pnl-negative' : 'pnl-neutral');

    els.uptime.textContent = formatUptime(status.uptime);
    els.statMarkets.textContent = formatNumber(status.marketsScanned);
    els.statOpportunities.textContent = formatNumber(status.opportunitiesFound);
    els.statTrades.textContent = formatNumber(status.tradesExecuted);
    els.statCycle.textContent = '#' + status.cycleCount;
  }

  function setStatus(type, text) {
    els.botStatus.className = 'status-badge status-' + type;
    const txt = els.botStatus.querySelector('.status-text');
    if (txt) txt.textContent = text;
  }

  // ========================================
  // TRADE STATS
  // ========================================
  function updateTradeStats(stats) {
    if (!stats) return;
    els.statTrades.textContent = formatNumber(stats.totalTrades);
    els.statWinrate.textContent = stats.winRate.toFixed(0) + '%';
  }

  // ========================================
  // POSITIONS
  // ========================================
  function renderPositions(positions) {
    if (!positions || positions.length === 0) {
      els.positionsList.innerHTML = '<div class="empty-state">Nenhuma posição aberta ainda.</div>';
      els.positionsCount.textContent = '0';
      return;
    }

    els.positionsCount.textContent = positions.length;
    els.positionsList.innerHTML = positions.map(p => createPositionHTML(p)).join('');
  }

  function addPosition(trade) {
    const emptyState = els.positionsList.querySelector('.empty-state');
    if (emptyState) els.positionsList.innerHTML = '';

    els.positionsList.insertAdjacentHTML('afterbegin', createPositionHTML(trade));
    const count = els.positionsList.querySelectorAll('.position-item').length;
    els.positionsCount.textContent = count;
  }

  function removePosition(marketId) {
    const item = els.positionsList.querySelector(`[data-market-id="${marketId}"]`);
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      setTimeout(() => item.remove(), 300);
    }
    setTimeout(() => {
      const count = els.positionsList.querySelectorAll('.position-item').length;
      els.positionsCount.textContent = count;
      if (count === 0) {
        els.positionsList.innerHTML = '<div class="empty-state">Nenhuma posição aberta.</div>';
      }
    }, 350);
  }

  function createPositionHTML(trade) {
    const sideClass = trade.side === 'BUY_YES' ? 'side-yes' : 'side-no';
    const sideLabel = trade.side === 'BUY_YES' ? 'YES' : 'NO';
    return `
      <div class="position-item" data-market-id="${trade.marketId}">
        <span class="position-question" title="${escapeHtml(trade.question)}">${escapeHtml(trade.question)}</span>
        <span class="position-side ${sideClass}">${sideLabel}</span>
        <span class="position-stake">$${trade.stake.toFixed(2)}</span>
        <span class="position-edge pnl-positive">+${(trade.edge * 100).toFixed(1)}%</span>
      </div>
    `;
  }

  // ========================================
  // RISK
  // ========================================
  function updateRisk(risk) {
    if (!risk) return;

    // Drawdown
    els.riskDrawdown.textContent = risk.drawdownPct.toFixed(1) + '%';
    els.riskDrawdownBar.style.width = Math.min(risk.drawdownPct / 15 * 100, 100) + '%';

    // Exposure
    els.riskExposure.textContent = `$${formatNumber(risk.totalExposure)} / $${formatNumber(risk.maxExposure)}`;
    const exposurePct = risk.maxExposure > 0 ? (risk.totalExposure / risk.maxExposure * 100) : 0;
    els.riskExposureBar.style.width = Math.min(exposurePct, 100) + '%';

    // Positions
    els.riskPositions.textContent = risk.positionCount;

    // Daily loss
    els.riskDailyLoss.textContent = '$' + formatNumber(risk.dailyLoss);
    els.riskDailyLoss.className = 'risk-value-large ' + (risk.dailyLoss > 0 ? 'risk-danger' : '');

    // Circuit breaker — show/hide reset button based on state
    if (risk.circuitBreaker) {
      els.riskCircuit.textContent = '🚨 ATIVO';
      els.riskCircuit.className = 'risk-value-large risk-danger';
      if (els.resetCircuitBtn) els.resetCircuitBtn.classList.remove('hidden');
    } else {
      els.riskCircuit.textContent = '✅ OK';
      els.riskCircuit.className = 'risk-value-large risk-ok';
      if (els.resetCircuitBtn) els.resetCircuitBtn.classList.add('hidden');
    }
  }

  // ========================================
  // DECISIONS FEED
  // ========================================
  function renderDecisions(decisions) {
    if (!decisions || decisions.length === 0) {
      els.decisionsFeed.innerHTML = '<div class="empty-state">Aguardando primeiro ciclo...</div>';
      return;
    }
    els.decisionsFeed.innerHTML = '';
    decisions.forEach(d => addDecision(d, false));
  }

  function addDecision(decision, prepend = true) {
    const emptyState = els.decisionsFeed.querySelector('.empty-state');
    if (emptyState) els.decisionsFeed.innerHTML = '';

    const iconMap = {
      scan: '🔍', opportunity: '🎯', trade: '✅',
      reject: '⛔', risk: '🚨', monitor: '📡', system: '⚙️',
    };

    const html = `
      <div class="decision-item type-${decision.type}">
        <span class="decision-time">${formatTime(decision.timestamp)}</span>
        <span class="decision-icon">${iconMap[decision.type] || '📋'}</span>
        <span class="decision-message">${escapeHtml(decision.message)}</span>
      </div>
    `;

    if (prepend) {
      els.decisionsFeed.insertAdjacentHTML('afterbegin', html);
      // Keep max 50 items
      while (els.decisionsFeed.children.length > 50) {
        els.decisionsFeed.removeChild(els.decisionsFeed.lastChild);
      }
    } else {
      els.decisionsFeed.insertAdjacentHTML('beforeend', html);
    }
  }

  // ========================================
  // JOURNAL TABLE
  // ========================================
  function renderJournal(trades) {
    if (!trades || trades.length === 0) {
      els.journalBody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhum trade registrado.</td></tr>';
      return;
    }
    els.journalBody.innerHTML = '';
    trades.reverse().forEach(t => addJournalRow(t, false));
  }

  function addJournalRow(trade, prepend = true) {
    const emptyRow = els.journalBody.querySelector('.empty-state');
    if (emptyRow) els.journalBody.innerHTML = '';

    const statusClass = 'status-' + trade.status;
    const statusLabel = { open: '⏳ Aberto', won: '✅ Ganhou', lost: '❌ Perdeu', cancelled: '🚫 Cancelado', exited: '💰 Saída' };
    const pnlText = trade.pnl !== undefined && trade.pnl !== null
      ? (trade.pnl >= 0 ? '+' : '') + '$' + trade.pnl.toFixed(2)
      : '—';
    const pnlClass = trade.pnl > 0 ? 'pnl-positive' : trade.pnl < 0 ? 'pnl-negative' : '';

    // Apply filter
    if (currentFilter !== 'all' && trade.status !== currentFilter) return;

    const html = `
      <tr data-trade-id="${trade.id}" class="${trade.dryRun ? 'dryrun-row' : ''}">
        <td>${formatTime(trade.timestamp)}</td>
        <td title="${escapeHtml(trade.question)}">${escapeHtml(trade.question.substring(0, 40))}${trade.question.length > 40 ? '...' : ''}</td>
        <td><span class="position-side ${trade.side === 'BUY_YES' ? 'side-yes' : 'side-no'}">${trade.side === 'BUY_YES' ? 'YES' : 'NO'}</span></td>
        <td>$${trade.entryPrice.toFixed(4)}</td>
        <td>$${trade.stake.toFixed(2)}</td>
        <td class="pnl-positive">+${(trade.edge * 100).toFixed(1)}%</td>
        <td>+${(trade.ev * 100).toFixed(1)}%</td>
        <td class="${statusClass}">${statusLabel[trade.status] || trade.status}</td>
        <td class="${pnlClass}">${pnlText}</td>
      </tr>
    `;

    if (prepend) {
      els.journalBody.insertAdjacentHTML('afterbegin', html);
    } else {
      els.journalBody.insertAdjacentHTML('beforeend', html);
    }
  }

  function updateJournalRow(tradeId, won, pnl) {
    const row = els.journalBody.querySelector(`[data-trade-id="${tradeId}"]`);
    if (!row) return;

    const cells = row.querySelectorAll('td');
    const statusCell = cells[7];
    const pnlCell = cells[8];

    if (statusCell) {
      statusCell.textContent = won ? '✅ Ganhou' : '❌ Perdeu';
      statusCell.className = won ? 'status-won' : 'status-lost';
    }
    if (pnlCell) {
      pnlCell.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
      pnlCell.className = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    }

    row.classList.add(won ? 'flash-green' : 'flash-red');
  }

  // ========================================
  // NOTIFICATIONS
  // ========================================
  function renderNotifications(notifications) {
    if (!notifications || notifications.length === 0) return;
    els.notificationsFeed.innerHTML = '';
    notifications.forEach(n => addNotification(n, false));
  }

  function addNotification(notification, prepend = true) {
    const emptyState = els.notificationsFeed.querySelector('.empty-state');
    if (emptyState) els.notificationsFeed.innerHTML = '';

    const html = `
      <div class="notification-item type-${notification.type}">
        <span class="notification-time">${formatTime(notification.timestamp)}</span>
        <span class="notification-title">${escapeHtml(notification.title)}</span>
        <span class="notification-message">${escapeHtml(notification.message)}</span>
      </div>
    `;

    if (prepend) {
      els.notificationsFeed.insertAdjacentHTML('afterbegin', html);
      while (els.notificationsFeed.children.length > 30) {
        els.notificationsFeed.removeChild(els.notificationsFeed.lastChild);
      }
    } else {
      els.notificationsFeed.insertAdjacentHTML('beforeend', html);
    }

    // Browser notification
    if (prepend && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '🤖',
      });
    }
  }

  // ========================================
  // REQUEST NOTIFICATION PERMISSION
  // ========================================
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // ========================================
  // UPTIME TIMER
  // ========================================
  let engineStartTime = 0;
  setInterval(() => {
    if (engineStartTime > 0) {
      els.uptime.textContent = formatUptime(Date.now() - engineStartTime);
    }
  }, 1000);

  // ========================================
  // HELPERS
  // ========================================
  function formatMoney(val) {
    return '$' + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(val) {
    if (typeof val !== 'number') return '0';
    return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatUptime(ms) {
    if (!ms || ms <= 0) return '00:00:00';
    const secs = Math.floor(ms / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function flashElement(el) {
    if (!el) return;
    el.classList.add('flash-green');
    setTimeout(() => el.classList.remove('flash-green'), 500);
  }

  // Kick off
  init().catch(err => {
    console.error('Dashboard init error:', err);
    setStatus('stopped', 'Erro');
  });

})();
