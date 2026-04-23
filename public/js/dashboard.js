// ================================================
// DASHBOARD CLIENT — Real-time UI Updates
// ================================================

(function() {
  'use strict';

  // ========================================
  // AUTH
  // ========================================
  let authToken = localStorage.getItem('auth_token');
  let refreshToken = localStorage.getItem('refresh_token');
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
    statTrades:        $('stat-trades'),
    statWinrate:       $('stat-winrate'),
    positionsList:     $('positions-list'),
    positionsCount:    $('positions-count'),
    riskDrawdown:      $('risk-drawdown'),
    riskDrawdownBar:   $('risk-drawdown-bar'),
    riskExposure:      $('risk-exposure'),
    riskExposureBar:   $('risk-exposure-bar'),
    riskCircuit:       $('risk-circuit'),
    resetCircuitBtn:   $('reset-circuit-btn'),
    resetEmergencyBtn: $('reset-emergency-btn'),
    emergencyStopSection: $('emergency-stop-section'),
    decisionsFeed:     $('decisions-feed'),
    notificationsFeed: $('notifications-feed'),
    notifCount:        $('notif-count'),
    toggleMmMode:      $('toggle-mm-mode'),
    modeBadge:         $('mode-badge'),
    lastScan:          $('header-last-scan'),
    liveWarningBox:    $('live-warning-box'),
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

  function formatUptime(ms) {
    if (!ms || ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
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
    const lbl = els.botStatus.querySelector('.status-lbl') || els.botStatus.querySelector('.status-text');
    if (lbl) lbl.textContent = label;
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

    async function authFetch(path, options = {}) {
      const headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + authToken,
      });
      const url = backendUrl ? backendUrl + path : path;
      let response = await fetch(url, Object.assign({}, options, { headers }));

      // Handle token expiration: try to refresh if we get a 401
      if (response.status === 401 && refreshToken) {
        try {
          const refreshRes = await fetch(backendUrl ? backendUrl + '/api/auth/refresh' : '/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            authToken = refreshData.token;
            localStorage.setItem('auth_token', authToken);

            // Retry original request with new token
            const retryHeaders = Object.assign({}, options.headers, {
              'Authorization': 'Bearer ' + authToken,
            });
            response = await fetch(url, Object.assign({}, options, { headers: retryHeaders }));
          } else {
            // Refresh failed - redirect to login
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            window.location.href = '/login';
          }
        } catch (err) {
          console.error('[Dashboard] Token refresh error', err);
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }

      return response;
    }

    // ========================================
    // SOCKET
    // ========================================
    const socketOpts = { auth: { token: authToken }, query: { token: authToken } };
    const socket = backendUrl ? io(backendUrl, socketOpts) : io(socketOpts);

    socket.on('connect', () => {
      setStatus('connecting', 'Conectado');
      // Refresh stale data after a reconnect (events missed while offline)
      authFetch('/api/status').then(r => r.ok && r.json()).then(s => s && updateStatus(s)).catch(() => {});
      authFetch('/api/trades').then(r => r.ok && r.json()).then(d => {
        if (!d) return;
        if (d.stats) updateTradeStats(d.stats);
        if (d.open) { renderPositions(d.open); renderActivePositions(d.open); }
        if (d.risk) updateRisk(d.risk);
      }).catch(() => {});
      fetchPerformance();
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'Autenticação necessária') {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return;
      }
      setStatus('stopped', 'Reconectando...');
    });
    socket.on('disconnect', (reason) => {
      setStatus('stopped', reason === 'io server disconnect' ? 'Desconectado' : 'Reconectando...');
    });

    // Periodic heartbeat refresh every 30 s — guards against missed WebSocket events
    setInterval(() => {
      if (!socket.connected) return;
      authFetch('/api/status').then(r => r.ok && r.json()).then(s => s && updateStatus(s)).catch(() => {});
      fetchPerformance();
    }, 30_000);

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
    socket.on('riskUpdate',     (risk) => updateRisk(risk));
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
    // BOT CONTROL (Start/Stop)
    // ========================================
    const botToggleBtn = $('bot-toggle-btn');
    if (botToggleBtn) {
      botToggleBtn.addEventListener('click', async () => {
        const isRunning = botToggleBtn.classList.contains('bot-stop');
        const action = isRunning ? 'stop' : 'start';
        const originalText = botToggleBtn.querySelector('.btn-text').textContent;
        
        botToggleBtn.disabled = true;
        botToggleBtn.querySelector('.btn-text').textContent = isRunning ? 'Parando...' : 'Ligando...';

        try {
          const res = await authFetch(`/api/bot/${action}`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Erro ao alterar estado do bot.');
            botToggleBtn.querySelector('.btn-text').textContent = originalText;
          }
        } catch (err) {
          console.error('Failed to toggle bot:', err);
          botToggleBtn.querySelector('.btn-text').textContent = originalText;
        } finally {
          botToggleBtn.disabled = false;
        }
      });
    }

    // ========================================
    // LOGOUT
    // ========================================
    const logoutBtn = $('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
      });
    }

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
      const grossProfit = closed.filter(t => (t.pnl || 0) > 0).reduce((s, t) => s + t.pnl, 0);
      const grossLoss = Math.abs(closed.filter(t => (t.pnl || 0) < 0).reduce((s, t) => s + t.pnl, 0));
      const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 999 : 0);

      if (els.hTotalTrades) els.hTotalTrades.textContent = trades.length;
      if (els.hWinRate) els.hWinRate.textContent = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) + '%' : '0%';
      if (els.hTotalPnl) {
        els.hTotalPnl.textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
        els.hTotalPnl.className = 'h-stat-val ' + (totalPnl >= 0 ? 'text-emerald' : 'text-rose');
      }
      if (els.hProfitFactor) els.hProfitFactor.textContent = profitFactor >= 999 ? '∞' : profitFactor.toFixed(2);
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

    if (els.resetEmergencyBtn) {
      els.resetEmergencyBtn.addEventListener('click', async () => {
        if (!confirm('Tem certeza? O emergency stop protege contra drawdown severo. Só resete se entender os riscos.')) return;
        const res = await authFetch('/api/risk/emergency-reset', { method: 'POST' });
        if (res.ok) {
          alert('Emergency stop resetado. Monitore o bot com atenção.');
        } else {
          const err = await res.json();
          alert('Erro: ' + (err.error || 'Falha ao resetar.'));
        }
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
    // SETTINGS FORM
    // ========================================
    const settingsForm = $('settings-form');
    if (settingsForm) {
      // Load current settings
      (async function fetchSettings() {
        try {
          const res = await authFetch('/api/settings');
          if (!res.ok) return;
          const cfg = await res.json();
          
          // Populate fields
          for (const key in cfg) {
            const input = settingsForm.querySelector(`[name="${key}"]`);
            if (input) {
              if (input.type === 'checkbox') {
                input.checked = cfg[key];
              } else {
                const isSensitive = ['privateKey', 'claudeApiKey', 'newsApiKey'].includes(key);
                const isSet = isSensitive && cfg[key] && cfg[key].length > 0;
                if (isSet) {
                  // Show placeholder indicating key is configured, not the masked value
                  input.value = '';
                  input.placeholder = '● Configurada — deixe em branco para manter';
                  input.dataset.isSet = 'true';
                } else {
                  input.value = cfg[key] || '';
                }
              }
            }
          }
        } catch (err) { console.error('Failed to load settings', err); }
      })();

      // ========================================
    // CONNECTION TESTS
    // ========================================
    const testBtn = $('test-connections-btn');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const testItems = document.querySelectorAll('.test-item');
        const summaryMsg = $('test-summary-msg');
        
        testBtn.disabled = true;
        testBtn.textContent = '🔄 Testando...';
        summaryMsg.textContent = '';
        
        // Reset indicators
        testItems.forEach(item => {
          const indicator = item.querySelector('.test-indicator');
          indicator.textContent = 'Testando...';
          indicator.className = 'test-indicator indicator-loading';
        });

        try {
          const res = await authFetch('/api/config/test', { method: 'POST' });
          if (!res.ok) throw new Error('Falha na resposta do servidor');
          
          const data = await res.json();
          const results = data.results;
          
          let successCount = 0;
          let totalCount = 0;

          Object.keys(results).forEach(key => {
            const item = document.querySelector(`.test-item[data-test="${key}"]`);
            if (item) {
              totalCount++;
              const indicator = item.querySelector('.test-indicator');
              const success = results[key];
              if (success) successCount++;
              
              indicator.textContent = success ? 'Sucesso' : 'Falhou';
              indicator.className = 'test-indicator ' + (success ? 'indicator-success' : 'indicator-failed');
            }
          });

          if (successCount === totalCount) {
            summaryMsg.textContent = '✅ Todas as conexões estão operacionais!';
            summaryMsg.className = 'msg-success';
          } else if (successCount === 0) {
            summaryMsg.textContent = '❌ Todas as conexões falharam. Verifique suas chaves.';
            summaryMsg.className = 'msg-failed';
          } else {
            summaryMsg.textContent = `⚠️ ${successCount}/${totalCount} conexões bem-sucedidas.`;
            summaryMsg.className = 'msg-partial';
          }

        } catch (err) {
          console.error('Test connections failed:', err);
          summaryMsg.textContent = '❌ Erro ao executar testes.';
          summaryMsg.className = 'msg-failed';
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = '🔍 Testar Todas as Conexões';
        }
      });
    }

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        const data = {};
        
        formData.forEach((value, key) => {
          const input = settingsForm.querySelector(`[name="${key}"]`);
          // Skip masked values to avoid overwriting secret keys with bullets
          if (value === '••••••••••••') return;
          
          if (input && input.type === 'checkbox') {
            data[key] = true;
          } else if (input && input.type === 'number') {
            data[key] = parseFloat(value);
          } else {
            data[key] = value;
          }
        });

        // Ensure checkboxes that are UNCHECKED are sent as false (FormData skips unchecked)
        settingsForm.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (cb.name) data[cb.name] = !!cb.checked;
        });

        const btn = settingsForm.querySelector('button[type="submit"]') || $('settings-save');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Salvando...';
        }

        try {
          const res = await authFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          if (res.ok) {
            alert('Configurações salvas com sucesso!');
            if (window.location.reload) window.location.reload();
          } else {
            const err = await res.json();
            alert('Erro: ' + (err.error || 'Falha ao salvar.'));
          }
        } catch (err) {
          alert('Erro na rede ao salvar.');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Salvar Alterações';
        }
      });
    }

    // ========================================
    // INTERNAL HELPERS
    // ========================================
    function updateStatus(s) {
      try {
        if (els.botStatus) setStatus(s.running ? 'running' : 'stopped', s.running ? 'Operando' : 'Pausado');
        if (els.bankroll) els.bankroll.textContent = '$' + formatNumber(s.bankroll || 0);
        if (els.statMarkets) els.statMarkets.textContent = s.marketsScanned || 0;
        if (els.statTrades) els.statTrades.textContent = s.tradesExecuted || 0;
        
        const bToggle = $('bot-toggle-btn');
        if (bToggle) {
          const txt = bToggle.querySelector('.btn-text');
          if (s.running) {
            bToggle.classList.remove('bot-start');
            bToggle.classList.add('bot-stop');
            if (txt) txt.textContent = 'Desligar IA';
          } else {
            bToggle.classList.remove('bot-stop');
            bToggle.classList.add('bot-start');
            if (txt) txt.textContent = 'Ligar IA';
          }
        }

        if (els.pnl) {
          els.pnl.textContent = (s.totalPnl >= 0 ? '+' : '') + '$' + formatNumber(s.totalPnl);
          els.pnl.className = 'header-val ' + (s.totalPnl >= 0 ? 'pos' : 'neg');
        }
        if (els.uptime) els.uptime.textContent = formatUptime(s.uptime);
        if (els.modeBadge) {
          els.modeBadge.textContent = s.dryRun ? '🧪 SIMULAÇÃO' : '🔴 AO VIVO';
          els.modeBadge.className = 'mode-badge ' + (s.dryRun ? 'mode-sim' : 'mode-live');
        }
      } catch (err) {
        console.error('UpdateStatus error:', err);
      }
    }

    // Feed filter state — default 'all' so every scan/reject/monitor message is visible
    let feedFilter = 'all'; // 'all' | 'important'
    const IMPORTANT_TYPES = ['opportunity', 'trade', 'risk'];

    // Dedup map: msgKey → {el, count, ts} — collapses identical messages within DEDUP_WINDOW_MS
    const decisionDedupMap = new Map();
    const DEDUP_WINDOW_MS = 10 * 60 * 1000;

    function setupFeedFilter() {
      if (!els.decisionsFeed || !els.decisionsFeed.parentElement) return;
      if (document.getElementById('feed-filter-bar')) return;

      const bar = document.createElement('div');
      bar.id = 'feed-filter-bar';
      bar.style.cssText = 'display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);';
      // 'Todos' is the active default, matching feedFilter = 'all'
      bar.innerHTML = `
        <button id="ff-all" class="feed-filter-btn" style="font-size:11px;padding:3px 10px;border-radius:20px;border:none;cursor:pointer;background:rgba(139,92,246,0.25);color:#a78bfa;font-weight:700;">Todos</button>
        <button id="ff-important" class="feed-filter-btn" style="font-size:11px;padding:3px 10px;border-radius:20px;border:none;cursor:pointer;background:transparent;color:var(--text3);font-weight:600;">Importantes</button>
      `;
      els.decisionsFeed.before(bar);

      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('.feed-filter-btn');
        if (!btn) return;
        feedFilter = btn.id === 'ff-important' ? 'important' : 'all';
        bar.querySelectorAll('.feed-filter-btn').forEach(b => {
          b.style.background = b === btn ? 'rgba(139,92,246,0.25)' : 'transparent';
          b.style.color = b === btn ? '#a78bfa' : 'var(--text3)';
        });
        if (els.decisionsFeed) {
          els.decisionsFeed.querySelectorAll('.dec-line').forEach(item => {
            const type = (item.className.match(/type-(\w+)/) || [])[1];
            const show = feedFilter === 'all' || IMPORTANT_TYPES.includes(type);
            if (show) {
              item.style.animation = 'none'; // suppress slideIn re-trigger on un-hide
              item.style.display = '';
            } else {
              item.style.display = 'none';
            }
          });
        }
      });
    }

    function renderDecisions(decisions) {
      if (!els.decisionsFeed) return;
      setupFeedFilter();
      decisionDedupMap.clear();
      els.decisionsFeed.innerHTML = '';
      if (decisions.length === 0) {
        els.decisionsFeed.innerHTML = '<div class="empty-state">Aguardando oportunidades...</div>';
        return;
      }
      // Prepend in chronological order → newest lands at top, matching live-event behavior.
      // animate=false suppresses slideIn on bulk load so 30 items don't all fade in at once.
      decisions.forEach(d => addDecision(d, true, false));
    }

    // animate=false on initial bulk load; true (default) on live socket events
    function addDecision(decision, prepend = true, animate = true) {
      if (!els.decisionsFeed) return;
      setupFeedFilter();
      const iconMap = { scan: '🔍', opportunity: '🎯', trade: '✅', reject: '⛔', risk: '🚨', monitor: '📡', system: '⚙️' };
      const type = decision.type || 'system';

      // Deduplication: collapse repeated messages into a counter badge
      if (prepend) {
        const msgKey = type + '|' + (decision.message || '').trim().substring(0, 120);
        const existing = decisionDedupMap.get(msgKey);
        if (existing && existing.el.parentElement && (Date.now() - existing.ts) < DEDUP_WINDOW_MS) {
          existing.count++;
          existing.ts = Date.now();
          let badge = existing.el.querySelector('.dec-repeat-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dec-repeat-badge';
            existing.el.appendChild(badge);
          }
          badge.textContent = '×' + existing.count;
          const tsEl = existing.el.querySelector('.dec-ts');
          if (tsEl) tsEl.textContent = formatTime(decision.timestamp).split(' ')[1] || '—';
          // Suppress slideIn re-trigger: insertBefore on an existing node detaches+reattaches it
          existing.el.style.animation = 'none';
          els.decisionsFeed.insertBefore(existing.el, els.decisionsFeed.firstChild);
          return;
        }
        if (decisionDedupMap.size > 200) {
          const cutoff = Date.now() - DEDUP_WINDOW_MS;
          for (const [k, v] of decisionDedupMap) { if (v.ts < cutoff) decisionDedupMap.delete(k); }
        }
      }

      // Always remove the empty-state placeholder when real data arrives
      const emptyEl = els.decisionsFeed.querySelector('.empty-state');
      if (emptyEl) emptyEl.remove();

      const hidden = feedFilter === 'important' && !IMPORTANT_TYPES.includes(type);
      const el = document.createElement('div');
      el.className = `dec-line type-${type}`;
      if (!animate) el.style.animation = 'none'; // no fade-in during bulk load
      if (hidden) el.style.display = 'none';
      const timeStr = decision.timestamp ? (formatTime(decision.timestamp).split(' ')[1] || '—') : '—';
      el.innerHTML = `<span class="dec-ts">${timeStr}</span><span class="dec-icon">${iconMap[type] || '📋'}</span><span class="dec-msg">${escapeHtml(decision.message)}</span>`;

      if (prepend) {
        els.decisionsFeed.insertBefore(el, els.decisionsFeed.firstChild);
        const msgKey = type + '|' + (decision.message || '').trim().substring(0, 120);
        decisionDedupMap.set(msgKey, { el, count: 1, ts: Date.now() });
        while (els.decisionsFeed.children.length > 200) els.decisionsFeed.removeChild(els.decisionsFeed.lastChild);
      } else {
        els.decisionsFeed.appendChild(el);
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
      if (els.emergencyStopSection) {
        els.emergencyStopSection.style.display = risk.emergencyStop ? 'flex' : 'none';
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
      // Note: statTrades and statMarkets are also kept in sync via updateStatus (from engine status).
      // Here we only update winRate since winRate doesn't come from the status object.
      // stats.winRate is already 0–100 from TradeJournal.getStats()
      if (els.statWinrate) els.statWinrate.textContent = (stats.winRate || 0).toFixed(1) + '%';
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
      if (els.positionsCount) els.positionsCount.textContent = els.positionsList.querySelectorAll('.pos-card').length;
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
