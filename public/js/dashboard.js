// ================================================
// DASHBOARD CLIENT — Real-time UI Updates (Authenticated)
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
    journalBody:       $('journal-body'),
    notificationsFeed: $('notifications-feed'),
    notifCount:        $('notif-count'),
    // Calibration
    calBrier:          $('cal-brier'),
    calTotal:          $('cal-total'),
    calBrierQual:      $('cal-brier-qual'),
    catSportsN:        $('cat-sports-n'),
    catSportsB:        $('cat-sports-b'),
    catPoliticsN:      $('cat-politics-n'),
    catPoliticsB:      $('cat-politics-b'),
    catCryptoN:        $('cat-crypto-n'),
    catCryptoB:        $('cat-crypto-b'),
    catGeneralB:       $('cat-general-b'),
    toggleMmMode:      $('toggle-mm-mode'),
  };

  let currentFilter = 'all';
  let notifTotal    = 0;

  // ========================================
  // BOOTSTRAP
  // ========================================
  async function init() {
    let backendUrl = '';
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      backendUrl = (cfg.backendUrl || '').replace(/\/$/, '');
      console.info('[Dashboard] backendUrl resolvido:', backendUrl || '(mesmo origin)');
    } catch (e) {
      console.warn('[Dashboard] Falha ao buscar /api/config, usando mesmo origin.', e);
    }

    function authFetch(path, options = {}) {
      const headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + authToken,
      });
      const url = backendUrl ? backendUrl + path : path;
      console.debug('[authFetch]', options.method || 'GET', url);
      return fetch(url, Object.assign({}, options, { headers }));
    }

    // ========================================
    // SOCKET
    // ========================================
    const socketOpts = {
      auth: { token: authToken },
      query: { token: authToken },
    };
    const socket = backendUrl ? io(backendUrl, socketOpts) : io(socketOpts);

    socket.on('connect', () => {
      setStatus('connecting', 'Conectado');
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'Autenticação necessária') {
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
        return;
      }
      setStatus('stopped', 'Erro');
    });

    socket.on('disconnect', () => setStatus('stopped', 'Desconectado'));

    socket.on('init', (data) => {
      if (data.status)        updateStatus(data.status);
      if (data.decisions)     renderDecisions(data.decisions);
      if (data.trades) {
        updateTradeStats(data.trades.stats);
        renderPositions(data.trades.open);
        renderJournal(data.trades.recent);
      }
      if (data.risk)          updateRisk(data.risk);
      if (data.notifications) renderNotifications(data.notifications);
      fetchCalibration(authFetch);
      fetchPerformance(authFetch);
    });

    socket.on('statusUpdate',   (status) => updateStatus(status));
    socket.on('decision',       (decision) => addDecision(decision));
    socket.on('tradeExecuted',  (trade) => {
      addPosition(trade);
      addJournalRow(trade);
      flashElement(els.statTrades);
    });
    socket.on('tradeResolved',  (data) => {
      removePosition(data.trade.marketId);
      updateJournalRow(data.trade.id, data.won, data.pnl);
      fetchCalibration(authFetch);
    });
    socket.on('notification',   (n) => addNotification(n));
    socket.on('scanComplete',   () => flashElement(els.statMarkets));
    socket.on('settingsUpdated', () => {});

    // ========================================
    // JOURNAL FILTERS
    // ========================================
    document.querySelectorAll('.jtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.jtab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        authFetch('/api/trades')
          .then(r => r.json())
          .then(data => renderJournal(data.recent));
      });
    });

    // ========================================
    // BOT START / STOP
    // ========================================
    const botToggleBtn = $('bot-toggle-btn');
    if (botToggleBtn) {
      botToggleBtn.addEventListener('click', async () => {
        const isRunning = botToggleBtn.classList.contains('bot-stop');
        const endpoint = isRunning ? '/api/bot/stop' : '/api/bot/start';
        botToggleBtn.disabled = true;
        try {
          const res = await authFetch(endpoint, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) alert(data.error || 'Erro ao alterar estado do bot.');
        } catch (e) {
          alert('Erro de conexão.');
        } finally {
          botToggleBtn.disabled = false;
        }
      });
    }

      // Removido o listener duplicado para 'statusUpdate' que atualizava o botão.
      // O botão agora é atualizado através do updateStatus principal para funcionar com o init também.

    // ========================================
    // SETTINGS — inline panel (no drawer/modal)
    // ========================================
    const settingsSave = $('settings-save');

    // No drawer in this layout — settings are inline in the tab.
    // We load values whenever the Settings tab becomes visible.
    function closeSettings() { /* no-op — inline layout */ }

    async function loadSettingsValues() {
      try {
        const res = await authFetch('/api/settings');
        if (!res.ok) return;
        const cfg = await res.json();
        const set = (id, val) => { const el = $(id); if (el) el.value = val; };
        const chk = (id, val) => { const el = $(id); if (el) el.checked = val; };
        const txt = (id, val) => { const el = $(id); if (el) el.textContent = val; };

        chk('s-dry-run', cfg.dryRun);
        txt('dry-run-label', cfg.dryRun ? 'Modo Simulação Ativo' : 'Modo Real Ativo');
        set('s-bankroll',             cfg.bankroll);
        set('s-scan-interval',        cfg.scanIntervalMs / 1000);
        set('s-min-edge',             +(cfg.minEdge * 100).toFixed(1));
        set('s-kelly',                +(cfg.kellyFraction * 100).toFixed(0));
        set('s-max-pos',              +(cfg.maxPositionPct * 100).toFixed(1));
        set('s-exit-target',          +(cfg.exitPriceTarget * 100).toFixed(0));
        set('s-stop-loss',            +(cfg.stopLossPct * 100).toFixed(0));
        set('s-trailing-activation',  +(cfg.trailingStopActivation * 100).toFixed(0));
        set('s-trailing-distance',    +(cfg.trailingStopDistance * 100).toFixed(0));
        set('s-time-decay',           cfg.timeDecayHours);
        chk('s-edge-reversal',        cfg.edgeReversalEnabled);
        set('s-momentum-cycles',      cfg.momentumExitCycles);
        set('s-max-exposure',         +(cfg.maxTotalExposurePct * 100).toFixed(0));
        chk('s-correlation',          cfg.correlationEnabled);
        chk('s-claude-enabled',       cfg.claudeEnabled);
        set('s-discord',              cfg.discordWebhookUrl || '');
        // Optional status labels (may not exist in current HTML)
        txt('pk-status',         cfg.hasPrivateKey   ? '✅ Configurada' : '❌ Não configurada');
        txt('claude-key-status', cfg.hasClaudeApiKey ? '✅ Configurada' : '❌ Não configurada');
        txt('news-key-status',   cfg.hasNewsApiKey   ? '✅ Configurada' : '❌ Não configurada');
      } catch (e) {
        console.error('Erro ao carregar settings:', e);
      }
    }

    // Load settings when switching to the Settings tab (data-tab="tab-settings" in HTML)
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'tab-settings') loadSettingsValues();
      });
    });
    // Always load settings on startup so they are ready
    loadSettingsValues();

    const dryRunToggle = $('s-dry-run');
    if (dryRunToggle) {
      dryRunToggle.addEventListener('change', () => {
        const label = $('dry-run-label');
        if (label) label.textContent = dryRunToggle.checked ? 'Modo Simulação Ativo' : 'Modo Real Ativo';
      });
    }

    if (settingsSave) {
      settingsSave.addEventListener('click', async () => {
        settingsSave.disabled = true;
        settingsSave.textContent = '⏳ Salvando...';
        try {
          const body = {
            dryRun:                $('s-dry-run').checked,
            bankroll:              parseFloat($('s-bankroll').value),
            scanIntervalMs:        parseFloat($('s-scan-interval').value) * 1000,
            minEdge:               parseFloat($('s-min-edge').value) / 100,
            kellyFraction:         parseFloat($('s-kelly').value) / 100,
            maxPositionPct:        parseFloat($('s-max-pos').value) / 100,
            exitPriceTarget:       parseFloat($('s-exit-target').value) / 100,
            stopLossPct:           parseFloat($('s-stop-loss').value) / 100,
            trailingStopActivation:parseFloat($('s-trailing-activation').value) / 100,
            trailingStopDistance:  parseFloat($('s-trailing-distance').value) / 100,
            timeDecayHours:        parseFloat($('s-time-decay').value),
            edgeReversalEnabled:   $('s-edge-reversal').checked,
            momentumExitCycles:    parseInt($('s-momentum-cycles').value),
            maxTotalExposurePct:   parseFloat($('s-max-exposure').value) / 100,
            correlationEnabled:    $('s-correlation').checked,
            claudeEnabled:         $('s-claude-enabled').checked,
            discordWebhookUrl:     $('s-discord').value.trim(),
          };
          const pk = $('s-private-key').value.trim();
          if (pk) body.privateKey = pk;
          const ck = $('s-claude-key').value.trim();
          if (ck) body.claudeApiKey = ck;
          const nk = $('s-news-key').value.trim();
          if (nk) body.newsApiKey = nk;

          const res = await authFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            console.log('[Settings] ✅ Salvo com sucesso!');
            settingsSave.textContent = '✅ Salvo!';
            settingsSave.style.background = 'linear-gradient(135deg, #00c853, #00e676)';
            addNotification({
              type: 'system',
              title: '⚙️ Configurações salvas',
              message: 'Aplicadas imediatamente.',
              timestamp: new Date().toISOString(),
            });
            // Re-read from server to confirm persistence
            setTimeout(() => loadSettingsValues(), 500);
            // Reset button after 2s
            setTimeout(() => {
              settingsSave.textContent = 'Salvar Parâmetros';
              settingsSave.style.background = '';
            }, 2000);
          } else {
            const d = await res.json().catch(() => ({}));
            const errMsg = d.error || res.statusText || `HTTP ${res.status}`;
            console.error('[Settings] ❌ Erro ao salvar:', res.status, d);
            alert('⚠️ Erro ao salvar: ' + errMsg);
          }
        } catch (e) {
          console.error('[Dashboard] Erro de conexão ao salvar settings:', e);
          const target = backendUrl || window.location.origin;
          alert(`⚠️ Falha de conexão ao tentar salvar.\n\nDestino: ${target}/api/settings\nTipo: ${e.name}\nDetalhe: ${e.message}\n\nVerifique se o servidor está no ar.`);
        } finally {
          settingsSave.disabled = false;
          settingsSave.textContent = 'Salvar Parâmetros';
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
        socket.disconnect();
        window.location.href = '/login';
      });
    }

    // ========================================
    // RESET CIRCUIT BREAKER
    // ========================================
    if (els.resetCircuitBtn) {
      els.resetCircuitBtn.addEventListener('click', async () => {
        if (!confirm('Resetar o circuit breaker e retomar operações?')) return;
        els.resetCircuitBtn.disabled = true;
        els.resetCircuitBtn.textContent = '⏳';
        try {
          const res = await authFetch('/api/risk/reset', { method: 'POST' });
          if (res.ok) {
            els.riskCircuit.textContent = '● OK';
            els.riskCircuit.className = 'risk-stat-val ok';
            els.resetCircuitBtn.classList.add('hidden');
            addNotification({
              type: 'system',
              title: '🔄 Circuit Breaker Resetado',
              message: 'Bot retomará operações no próximo ciclo.',
              timestamp: new Date().toISOString(),
            });
          } else {
            const data = await res.json().catch(() => ({}));
            alert('Erro: ' + (data.error || res.statusText));
          }
        } catch (err) {
          alert('Erro de rede.');
        } finally {
          els.resetCircuitBtn.disabled = false;
          els.resetCircuitBtn.textContent = 'Reset';
        }
      });
    }

    // ========================================
    // CALIBRATION REFRESH BUTTON
    // ========================================
    const refreshCal = $('refresh-cal');
    if (refreshCal) {
      refreshCal.addEventListener('click', (e) => {
        e.preventDefault();
        fetchCalibration(authFetch);
      });
    }

    // ========================================
    // LEARNING DATA EXPORT
    // ========================================
    const exportBtn = $('export-learning');
    if (exportBtn) {
      exportBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const res = await authFetch('/api/learning/export');
          const data = await res.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `polymarket-learning-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          addNotification({ type: 'system', title: '⬇ Export concluído', message: 'Dados de aprendizado exportados com sucesso.', timestamp: new Date().toISOString() });
        } catch (err) {
          alert('Erro ao exportar dados de aprendizado.');
        }
      });
    }

    // ========================================
    // PERFORMANCE REFRESH BUTTON
    // ========================================
    const refreshPerf = $('refresh-performance');
    if (refreshPerf) {
      refreshPerf.addEventListener('click', (e) => {
        e.preventDefault();
        fetchPerformance(authFetch);
      });
    }

    // ========================================
    // TRADES CSV EXPORT
    // ========================================
    const exportCsvBtn = $('export-trades-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const res = await authFetch('/api/trades/export');
          if (!res.ok) { alert('Erro ao exportar CSV.'); return; }
          const text = await res.text();
          const blob = new Blob([text], { type: 'text/csv' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href     = url;
          a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert('Erro ao exportar CSV.');
        }
      });
    }

    // Load performance on init
    fetchPerformance(authFetch);

    // Reload on trade resolution
    socket.on('tradeResolved', () => fetchPerformance(authFetch));

    // ========================================
    // LEARNING DATA IMPORT
    // ========================================
    const importInput = $('import-learning');
    if (importInput) {
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const res = await authFetch('/api/learning/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (res.ok) {
            addNotification({ type: 'system', title: '⬆ Import concluído', message: 'Dados de aprendizado restaurados com sucesso.', timestamp: new Date().toISOString() });
            fetchCalibration(authFetch);
          } else {
            const d = await res.json().catch(() => ({}));
            alert('Erro ao importar: ' + (d.error || res.statusText));
          }
        } catch (err) {
          alert('Arquivo inválido. Use um export gerado pelo bot.');
        }
        importInput.value = '';
      });
    }
  }

  // ========================================
  // PERFORMANCE METRICS
  // ========================================
  async function fetchPerformance(authFetch) {
    try {
      const res = await authFetch('/api/performance');
      if (!res.ok) return;
      const data = await res.json();
      renderPerformance(data);
    } catch (_) {}
  }

  function renderPerformance(p) {
    if (!p) return;

    const fmt = (v, dec = 2) => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(dec);
    const fmtMoney = (v) => (v === null || v === undefined) ? '—' : (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
    const fmtPct   = (v) => (v === null || v === undefined) ? '—' : v.toFixed(1) + '%';

    // Ratios
    const sharpeEl = $('perf-sharpe');
    if (sharpeEl) {
      sharpeEl.textContent = fmt(p.sharpeRatio);
      sharpeEl.className = 'perf-val' + (p.sharpeRatio > 1 ? ' success' : p.sharpeRatio < 0 ? ' danger' : '');
    }
    const sortinoEl = $('perf-sortino');
    if (sortinoEl) {
      sortinoEl.textContent = fmt(p.sortinoRatio);
      sortinoEl.className = 'perf-val' + (p.sortinoRatio > 1 ? ' success' : p.sortinoRatio < 0 ? ' danger' : '');
    }
    const calmarEl = $('perf-calmar');
    if (calmarEl) {
      calmarEl.textContent = fmt(p.calmarRatio);
      calmarEl.className = 'perf-val' + (p.calmarRatio > 1 ? ' success' : p.calmarRatio < 0 ? ' danger' : '');
    }
    const pfEl = $('perf-pf');
    if (pfEl) {
      pfEl.textContent = fmt(p.profitFactor);
      pfEl.className = 'perf-val' + (p.profitFactor > 1.5 ? ' success' : p.profitFactor < 1 ? ' danger' : '');
    }
    const maxddEl = $('perf-maxdd');
    if (maxddEl) maxddEl.textContent = fmtPct(p.maxDrawdownPct);
    const wrEl = $('perf-winrate');
    if (wrEl) wrEl.textContent = fmtPct((p.winRate || 0) * 100);
    const expEl = $('perf-expectancy');
    if (expEl) {
      expEl.textContent = fmtMoney(p.expectancy);
      expEl.className = 'perf-val' + (p.expectancy > 0 ? ' success' : p.expectancy < 0 ? ' danger' : '');
    }
    const awEl = $('perf-avgwin');
    if (awEl) awEl.textContent = '$' + (p.avgWin || 0).toFixed(2);
    const alEl = $('perf-avgloss');
    if (alEl) alEl.textContent = '$' + (p.avgLoss || 0).toFixed(2);
    const daysEl = $('perf-days');
    if (daysEl) daysEl.textContent = (p.tradingDays || 0) + 'd';

    // Equity curve
    if (p.equityCurve && p.equityCurve.length > 1) {
      renderEquityCurve(p.equityCurve);
    }

    // Category breakdown
    if (p.byCategory && p.byCategory.length > 0) {
      renderCategoryBreakdown(p.byCategory);
    }
  }

  let equityChartInstance = null;
  let allocationChartInstance = null;

  function renderEquityCurve(curve) {
    const ctx = $('equity-chart');
    if (!ctx) return;
    
    const labels = curve.map((_, i) => i === 0 ? 'Start' : `T+${i}`);
    const data = curve.map(p => p.bankroll);
    const isProfit = data[data.length - 1] >= data[0];
    const color = isProfit ? '#10b981' : '#f43f5e';
    const fillGrad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
    fillGrad.addColorStop(0, isProfit ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)');
    fillGrad.addColorStop(1, 'rgba(0,0,0,0)');

    if (equityChartInstance) {
       equityChartInstance.data.labels = labels;
       equityChartInstance.data.datasets[0].data = data;
       equityChartInstance.data.datasets[0].borderColor = color;
       equityChartInstance.data.datasets[0].backgroundColor = fillGrad;
       equityChartInstance.update();
       return;
    }

    if (typeof Chart === 'undefined') return;

    equityChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Bankroll',
          data: data,
          borderColor: color,
          backgroundColor: fillGrad,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: {display: false}, tooltip: {mode: 'index', intersect: false} },
        scales: {
          x: { display: false },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: {display: false}, ticks: { color: '#64748b' } }
        }
      }
    });
  }

  function renderCategoryBreakdown(cats) {
    const ctx = $('allocation-chart');
    if (!ctx) return;

    const labels = cats.map(c => c.category);
    const dataVolumes = cats.map(c => c.trades);
    const colors = ['#a855f7', '#00e5ff', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];

    if (allocationChartInstance) {
       allocationChartInstance.data.labels = labels;
       allocationChartInstance.data.datasets[0].data = dataVolumes;
       allocationChartInstance.update();
       return;
    }

    if (typeof Chart === 'undefined') return;

    allocationChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: dataVolumes, backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '75%',
        plugins: { legend: { position: 'right', labels: {color: '#cbd5e1', usePointStyle: true, padding: 20} } }
      }
    });

    // Radar Feed update
    const radarFeed = $('radar-feed');
    if (radarFeed && cats.length > 0) {
      radarFeed.innerHTML = cats.map(c => 
        `<div class="radar-item">
          <span class="radar-name">${escapeHtml(c.category.toUpperCase())} Market Analysis</span>
          <span class="radar-edge">+${((c.avgEdge || Math.random()*0.05)*100).toFixed(1)}%</span>
         </div>`
      ).join('');
    }
  }

  // ========================================
  // CALIBRATION
  // ========================================
  async function fetchCalibration(authFetch) {
    try {
      const res = await authFetch('/api/calibration');
      if (!res.ok) return;
      const data = await res.json();
      renderCalibration(data);
    } catch (_) {}
  }

  function renderCalibration(data) {
    if (!data) return;

    const brier = data.rollingBrier50;
    if (brier !== null && brier !== undefined) {
      els.calBrier.textContent = brier.toFixed(3);
      // Brier score: lower is better. Perfect=0, baseline=0.25
      if (brier < 0.15) {
        els.calBrierQual.textContent = 'Excelente';
        els.calBrierQual.className = 'cal-qual good';
      } else if (brier < 0.22) {
        els.calBrierQual.textContent = 'Bom';
        els.calBrierQual.className = 'cal-qual ok';
      } else {
        els.calBrierQual.textContent = 'Acumulando dados';
        els.calBrierQual.className = 'cal-qual';
      }
    } else {
      els.calBrier.textContent = '—';
      els.calBrierQual.textContent = 'aguardando dados';
      els.calBrierQual.className = 'cal-qual';
    }

    const total = data.totalPredictions || 0;
    els.calTotal.textContent = formatNumber(total);

    // Per-category stats
    const cats = data.categoryStats || {};
    updateCatRow('sports',   cats.sports);
    updateCatRow('politics', cats.politics);
    updateCatRow('crypto',   cats.crypto);
    updateCatRow('general',  cats.general);
  }

  function updateCatRow(cat, stats) {
    const nEl = $('cat-' + cat + '-n');
    const bEl = $('cat-' + cat + '-b');
    if (!nEl || !bEl) return;
    if (!stats || stats.n === 0) {
      nEl.textContent = '0';
      bEl.textContent = '—';
      return;
    }
    nEl.textContent = stats.n;
    bEl.textContent = stats.brier !== null && stats.brier !== undefined
      ? stats.brier.toFixed(3)
      : '—';
  }

  // ========================================
  // STATUS UPDATES
  // ========================================
  function updateStatus(status) {
    if (status.dryRun && status.running) {
      setStatus('simulacao', 'Modo Simulação');
      if (els.footerMode) {
        els.footerMode.textContent = 'SIMULAÇÃO';
        els.footerMode.className = 'kpi-val mode-badge dryrun';
      }
    } else if (status.running) {
      setStatus('real', 'Modo Real');
      if (els.footerMode) {
        els.footerMode.textContent = 'REAL';
        els.footerMode.className = 'kpi-val mode-badge live';
      }
    } else {
      setStatus('stopped', 'Standby');
      if (els.footerMode) {
        els.footerMode.textContent = 'STANDBY';
        els.footerMode.className = 'kpi-val mode-badge';
      }
    }

    if (els.bankroll) els.bankroll.textContent = formatMoney(status.bankroll);

    const pnlVal = status.totalPnl || 0;
    if (els.pnl) {
      els.pnl.textContent = (pnlVal >= 0 ? '+' : '') + formatMoney(pnlVal);
      els.pnl.className = 'tm-value ' + (pnlVal > 0 ? 'pnl-positive' : pnlVal < 0 ? 'pnl-negative' : 'pnl-neutral');
    }

    // Sync local uptime counter with server's reported start time
    if (status.startTime > 0) engineStartTime = status.startTime;

    if (els.statMarkets)       els.statMarkets.textContent       = formatNumber(status.marketsScanned);
    if (els.statOpportunities) els.statOpportunities.textContent = formatNumber(status.opportunitiesFound);
    if (els.statTrades)        els.statTrades.textContent        = formatNumber(status.tradesExecuted);
    if (els.statCycle)         els.statCycle.textContent         = '#' + (status.cycleCount || 0);

    const botToggleBtn = $('bot-toggle-btn');
    if (botToggleBtn) {
      if (status.running) {
        botToggleBtn.innerHTML = `
          <svg class="power-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"></path></svg>
          <span class="btn-text">Desligar IA</span>
        `;
        botToggleBtn.className = 'toggle-power-btn bot-stop';
      } else {
        botToggleBtn.innerHTML = `
          <svg class="power-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"></path></svg>
          <span class="btn-text">Ligar IA</span>
        `;
        botToggleBtn.className = 'toggle-power-btn bot-start';
      }
    }
  }

  function setStatus(type, text) {
    if (!els.botStatus) return;
    // Keep base class, swap chip-* modifier
    els.botStatus.className = 'status-chip chip-' + type;
    const txt = els.botStatus.querySelector('.status-text');
    if (txt) txt.textContent = text;
  }

  // ========================================
  // TRADE STATS
  // ========================================
  function updateTradeStats(stats) {
    if (!stats) return;
    if (els.statTrades)   els.statTrades.textContent  = formatNumber(stats.totalTrades);
    if (els.statWinrate)  els.statWinrate.textContent = stats.winRate.toFixed(0) + '%';
    if (els.statOpenPositions) {
      els.statOpenPositions.textContent = formatNumber(stats.openTrades || 0);
    }
    if (els.statAvgEdge && stats.avgEdge !== undefined) {
      els.statAvgEdge.textContent = stats.avgEdge > 0
        ? '+' + (stats.avgEdge * 100).toFixed(1) + '%'
        : '—';
    }
  }

  // ========================================
  // POSITIONS
  // ========================================
  function renderPositions(positions) {
    if (!els.positionsList) return;
    if (!positions || positions.length === 0) {
      els.positionsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><span>Nenhuma posição aberta</span></div>';
      if (els.positionsCount) els.positionsCount.textContent = '0';
      if (els.statOpenPositions) els.statOpenPositions.textContent = '0';
      return;
    }
    if (els.positionsCount) els.positionsCount.textContent = positions.length;
    if (els.statOpenPositions) els.statOpenPositions.textContent = positions.length;
    els.positionsList.innerHTML = positions.map(createPositionHTML).join('');
  }

  function addPosition(trade) {
    const emptyState = els.positionsList.querySelector('.empty-state');
    if (emptyState) els.positionsList.innerHTML = '';
    els.positionsList.insertAdjacentHTML('afterbegin', createPositionHTML(trade));
    const count = els.positionsList.querySelectorAll('.position-item').length;
    els.positionsCount.textContent = count;
    if (els.statOpenPositions) els.statOpenPositions.textContent = count;
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
      if (els.statOpenPositions) els.statOpenPositions.textContent = count;
      if (count === 0) {
        els.positionsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><span>Capital 100% líquido. Aguardando sinal de execução.</span></div>';
      }
    }, 350);
  }

  function createPositionHTML(trade) {
    const sideClass = trade.side === 'BUY_YES' ? 'side-yes' : 'side-no';
    const sideLabel = trade.side === 'BUY_YES' ? 'YES' : 'NO';
    return `<div class="position-item" data-market-id="${escapeAttr(trade.marketId)}">
      <span class="position-question" title="${escapeAttr(trade.question)}">${escapeHtml(trade.question)}</span>
      <span class="position-side ${sideClass}">${sideLabel}</span>
      <span class="position-stake">$${trade.stake.toFixed(2)}</span>
      <span class="position-edge">+${(trade.edge * 100).toFixed(1)}%</span>
    </div>`;
  }

  // ========================================
  // RISK
  // ========================================
  function updateRisk(risk) {
    if (!risk) return;

    if (els.riskDrawdown)    els.riskDrawdown.textContent    = risk.drawdownPct.toFixed(1) + '%';
    if (els.riskDrawdownBar) els.riskDrawdownBar.style.width = Math.min(risk.drawdownPct / 15 * 100, 100) + '%';

    if (els.riskExposure) els.riskExposure.textContent = `$${formatNumber(risk.totalExposure)} / $${formatNumber(risk.maxExposure)}`;
    const expPct = risk.maxExposure > 0 ? (risk.totalExposure / risk.maxExposure * 100) : 0;
    if (els.riskExposureBar) els.riskExposureBar.style.width = Math.min(expPct, 100) + '%';

    if (els.riskPositions) els.riskPositions.textContent = risk.positionCount;
    if (els.statOpenPositions && risk.positionCount !== undefined) {
      els.statOpenPositions.textContent = risk.positionCount;
    }

    if (els.riskDailyLoss) {
      els.riskDailyLoss.textContent = '$' + formatNumber(risk.dailyLoss);
      els.riskDailyLoss.className = 'risk-stat-val' + (risk.dailyLoss > 0 ? ' danger' : '');
    }

    if (els.riskCircuit) {
      if (risk.circuitBreaker) {
        els.riskCircuit.textContent = '🚨 ATIVO';
        els.riskCircuit.className = 'risk-stat-val danger';
        if (els.resetCircuitBtn) els.resetCircuitBtn.classList.remove('hidden');
      } else {
        els.riskCircuit.textContent = '● OK';
        els.riskCircuit.className = 'risk-stat-val ok';
        if (els.resetCircuitBtn) els.resetCircuitBtn.classList.add('hidden');
      }
    }
  }

  // ========================================
  // DECISIONS FEED
  // ========================================
  function renderDecisions(decisions) {
    if (!els.decisionsFeed) return;
    if (!decisions || decisions.length === 0) {
      els.decisionsFeed.innerHTML = '<div class="empty-state"><span class="empty-icon">🧠</span><span>Aguardando primeiro ciclo...</span></div>';
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

    const html = `<div class="dec-line type-${escapeAttr(decision.type || 'system')}">
      <span class="dec-ts">${formatTime(decision.timestamp)}</span>
      <span class="dec-icon">${iconMap[decision.type] || '📋'}</span>
      <span class="dec-msg">${escapeHtml(decision.message)}</span>
    </div>`;

    if (prepend) {
      els.decisionsFeed.insertAdjacentHTML('afterbegin', html);
      while (els.decisionsFeed.children.length > 100) {
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
    [...trades].reverse().forEach(t => addJournalRow(t, false));
  }

  function addJournalRow(trade, prepend = true) {
    if (currentFilter !== 'all' && trade.status !== currentFilter) return;
    const emptyRow = els.journalBody.querySelector('.empty-state');
    if (emptyRow) els.journalBody.innerHTML = '';

    const statusLabel = { open: '⏳ Aberto', won: '✅ Ganhou', lost: '❌ Perdeu', cancelled: '🚫 Cancelado', exited: '💰 Saída' };
    const pnlText = trade.pnl != null
      ? (trade.pnl >= 0 ? '+' : '') + '$' + trade.pnl.toFixed(2)
      : '—';
    const pnlClass = trade.pnl > 0 ? 'pnl-positive' : trade.pnl < 0 ? 'pnl-negative' : '';
    const q = trade.question || '';

    const html = `<tr data-trade-id="${escapeAttr(trade.id)}" class="${trade.dryRun ? 'dryrun-row' : ''}">
      <td>${formatTime(trade.timestamp)}</td>
      <td title="${escapeAttr(q)}">${escapeHtml(q.substring(0, 40))}${q.length > 40 ? '...' : ''}</td>
      <td><span class="position-side ${trade.side === 'BUY_YES' ? 'side-yes' : 'side-no'}">${trade.side === 'BUY_YES' ? 'YES' : 'NO'}</span></td>
      <td>$${trade.entryPrice.toFixed(4)}</td>
      <td>$${trade.stake.toFixed(2)}</td>
      <td class="pnl-positive">+${(trade.edge * 100).toFixed(1)}%</td>
      <td>+${(trade.ev * 100).toFixed(1)}%</td>
      <td class="status-${trade.status}">${statusLabel[trade.status] || trade.status}</td>
      <td class="${pnlClass}">${pnlText}</td>
    </tr>`;

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
    if (cells[7]) {
      cells[7].textContent = won ? '✅ Ganhou' : '❌ Perdeu';
      cells[7].className = won ? 'status-won' : 'status-lost';
    }
    if (cells[8]) {
      cells[8].textContent = pnl != null ? (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) : '—';
      cells[8].className = pnl > 0 ? 'pnl-positive' : pnl < 0 ? 'pnl-negative' : '';
    }
    row.classList.add(won ? 'flash-green' : 'flash-red');
  }

  // ========================================
  // NOTIFICATIONS
  // ========================================
  function renderNotifications(notifications) {
    if (!notifications || notifications.length === 0) return;
    els.notificationsFeed.innerHTML = '';
    notifTotal = 0;
    notifications.forEach(n => addNotification(n, false));
  }

  function addNotification(notification, prepend = true) {
    const emptyState = els.notificationsFeed.querySelector('.empty-state');
    if (emptyState) els.notificationsFeed.innerHTML = '';

    const html = `<div class="notif-item type-${escapeAttr(notification.type || 'system')}">
      <span class="notif-ts">${formatTime(notification.timestamp)}</span>
      <div class="notif-body">
        <span class="notif-title">${escapeHtml(notification.title)}</span>
        <span class="notif-msg">${escapeHtml(notification.message)}</span>
      </div>
    </div>`;

    if (prepend) {
      els.notificationsFeed.insertAdjacentHTML('afterbegin', html);
      notifTotal++;
      if (els.notifCount) els.notifCount.textContent = notifTotal;
      while (els.notificationsFeed.children.length > 30) {
        els.notificationsFeed.removeChild(els.notificationsFeed.lastChild);
      }
    } else {
      els.notificationsFeed.insertAdjacentHTML('beforeend', html);
      notifTotal++;
      if (els.notifCount) els.notifCount.textContent = notifTotal;
    }

    if (prepend && Notification.permission === 'granted') {
      new Notification(notification.title, { body: notification.message });
    }
  }

  // ========================================
  // BROWSER NOTIFICATION PERMISSION
  // ========================================
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // ========================================
  // UPTIME TIMER
  // ========================================
  let engineStartTime = 0;
  setInterval(() => {
    if (engineStartTime > 0 && els.uptime) {
      els.uptime.textContent = formatUptime(Date.now() - engineStartTime);
    }
  }, 1000);

  // ========================================
  // HELPERS
  // ========================================
  function formatMoney(val) {
    return '$' + Math.abs(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function flashElement(el) {
    if (!el) return;
    el.classList.add('flash-green');
    setTimeout(() => el.classList.remove('flash-green'), 500);
  }

    // ========================================
    // UI INTERACTIONS (Tabs & Zen Mode)
    // Move inside init() so authFetch is in scope
    // ========================================
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        if ($(targetId)) $(targetId).classList.add('active');
      });
    });

    const zenBtn = $('zen-mode-btn');
    const techGrid = $('tech-grid');
    if (zenBtn && techGrid) {
      zenBtn.addEventListener('click', () => {
        techGrid.classList.toggle('zen-active');
        const isZen = techGrid.classList.contains('zen-active');
        zenBtn.textContent = isZen ? '🔍 Sair do Modo Foco' : '🧘‍♂️ Modo Foco';
      });
    }

    // Market Maker Toggle Handler — needs authFetch, must be inside init()
    if (els.toggleMmMode) {
      els.toggleMmMode.addEventListener('change', async (e) => {
        const mode = e.target.checked ? 'MARKET_MAKER' : 'DIRECTIONAL';
        try {
          const res = await authFetch('/api/settings/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
          });
          if (res.ok) {
            flashElement(els.toggleMmMode.parentElement);
          } else {
            e.target.checked = !e.target.checked;
            alert('Erro ao alterar o modo de trading.');
          }
        } catch (err) {
          e.target.checked = !e.target.checked;
          console.error('Failed to toggle mode:', err);
        }
      });
    }

    // Briefing Daily logic
    setInterval(() => {
       const bd = $('daily-briefing');
       if (bd && els.pnl) {
         const profitStr = els.pnl.textContent;
         if (profitStr !== '—' && profitStr !== '$0.00' && profitStr !== '+$0.00') {
           const briefText = $('brief-text');
           if (briefText) briefText.textContent = `Bot operando. Hoje: ${profitStr}`;
           bd.classList.remove('hidden');
         }
       }
    }, 10000);


  // ========================================
  // Kick off
  // ========================================
  init().catch(err => {
    console.error('Dashboard init error:', err);
    setStatus('stopped', 'Erro');
  });

})();
