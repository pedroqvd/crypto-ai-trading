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
    catGeneralN:       $('cat-general-n'),
    catGeneralB:       $('cat-general-b'),
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
    } catch (_) {}

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

    // Second statusUpdate listener — update bot toggle button
    socket.on('statusUpdate', (status) => {
      if (botToggleBtn) {
        if (status.running) {
          botToggleBtn.textContent = '■ Parar';
          botToggleBtn.className = 'btn-danger bot-stop';
        } else {
          botToggleBtn.textContent = '▶ Iniciar';
          botToggleBtn.className = 'btn-danger bot-start';
        }
      }
    });

    // ========================================
    // SETTINGS DRAWER
    // ========================================
    const settingsBtn     = $('settings-btn');
    const settingsDrawer  = $('settings-drawer');
    const settingsOverlay = $('settings-overlay');
    const settingsClose   = $('settings-close');
    const settingsCancel  = $('settings-cancel');
    const settingsSave    = $('settings-save');

    function openSettings() {
      settingsDrawer.classList.remove('hidden');
      settingsOverlay.classList.remove('hidden');
      loadSettingsValues();
    }
    function closeSettings() {
      settingsDrawer.classList.add('hidden');
      settingsOverlay.classList.add('hidden');
    }

    async function loadSettingsValues() {
      try {
        const res = await authFetch('/api/settings');
        const cfg = await res.json();
        $('s-dry-run').checked              = cfg.dryRun;
        $('dry-run-label').textContent      = cfg.dryRun ? 'Simulação' : 'Real';
        $('s-bankroll').value               = cfg.bankroll;
        $('s-scan-interval').value          = cfg.scanIntervalMs / 1000;
        $('s-min-edge').value               = +(cfg.minEdge * 100).toFixed(1);
        $('s-kelly').value                  = +(cfg.kellyFraction * 100).toFixed(0);
        $('s-max-pos').value                = +(cfg.maxPositionPct * 100).toFixed(1);
        $('s-exit-target').value            = +(cfg.exitPriceTarget * 100).toFixed(0);
        $('s-stop-loss').value              = +(cfg.stopLossPct * 100).toFixed(0);
        $('s-trailing-activation').value    = +(cfg.trailingStopActivation * 100).toFixed(0);
        $('s-trailing-distance').value      = +(cfg.trailingStopDistance * 100).toFixed(0);
        $('s-time-decay').value             = cfg.timeDecayHours;
        $('s-edge-reversal').checked        = cfg.edgeReversalEnabled;
        $('s-momentum-cycles').value        = cfg.momentumExitCycles;
        $('s-max-exposure').value           = +(cfg.maxTotalExposurePct * 100).toFixed(0);
        $('s-correlation').checked          = cfg.correlationEnabled;
        $('s-claude-enabled').checked       = cfg.claudeEnabled;
        $('claude-enabled-label').textContent = cfg.claudeEnabled ? 'Ativado' : 'Desativado';
        $('s-discord').value                = cfg.discordWebhookUrl || '';
        $('pk-status').textContent          = cfg.hasPrivateKey   ? '✅ Configurada' : '❌ Não configurada';
        $('claude-key-status').textContent  = cfg.hasClaudeApiKey ? '✅ Configurada' : '❌ Não configurada';
        $('news-key-status').textContent    = cfg.hasNewsApiKey   ? '✅ Configurada' : '❌ Não configurada';
      } catch (e) {
        console.error('Erro ao carregar settings:', e);
      }
    }

    if (settingsBtn)     settingsBtn.addEventListener('click', openSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', closeSettings);
    if (settingsClose)   settingsClose.addEventListener('click', closeSettings);
    if (settingsCancel)  settingsCancel.addEventListener('click', closeSettings);

    const dryRunToggle = $('s-dry-run');
    if (dryRunToggle) {
      dryRunToggle.addEventListener('change', () => {
        $('dry-run-label').textContent = dryRunToggle.checked ? 'Simulação' : 'Real';
      });
    }

    const claudeToggle = $('s-claude-enabled');
    if (claudeToggle) {
      claudeToggle.addEventListener('change', () => {
        $('claude-enabled-label').textContent = claudeToggle.checked ? 'Ativado' : 'Desativado';
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
            closeSettings();
            addNotification({
              type: 'system',
              title: '⚙️ Configurações salvas',
              message: 'Aplicadas imediatamente.',
              timestamp: new Date().toISOString(),
            });
          } else {
            const d = await res.json().catch(() => ({}));
            alert('Erro ao salvar: ' + (d.error || res.statusText));
          }
        } catch (e) {
          alert('Erro de conexão ao salvar configurações.');
        } finally {
          settingsSave.disabled = false;
          settingsSave.textContent = 'Salvar Configurações';
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

  function renderEquityCurve(curve) {
    const svg = $('equity-curve-svg');
    if (!svg) return;

    const W = 600, H = 80, pad = 6;
    const values = curve.map(p => p.bankroll);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    const points = curve.map((p, i) => {
      const x = pad + (i / (curve.length - 1)) * (W - pad * 2);
      const y = H - pad - ((p.bankroll - minV) / range) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = points.join(' ');
    const areaPath = `M${points[0]} L${points.join(' L')} L${(W - pad)},${H - pad} L${pad},${H - pad} Z`;
    const isProfit = values[values.length - 1] >= values[0];
    const lineColor = isProfit ? 'var(--emerald)' : 'var(--rose)';

    svg.innerHTML = `
      <defs>
        <linearGradient id="equity-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${isProfit ? 'var(--emerald)' : 'var(--rose)'}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${isProfit ? 'var(--emerald)' : 'var(--rose)'}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#equity-gradient)"/>
      <polyline points="${polyline}" fill="none" stroke="${lineColor}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    `;
  }

  function renderCategoryBreakdown(cats) {
    const container = $('perf-categories');
    if (!container) return;

    let html = '<div class="perf-cat-title">P&L por Categoria</div>';
    html += '<div class="perf-cat-head">';
    html += '<span>Categoria</span><span style="text-align:right">Trades</span><span style="text-align:right">Wins</span>';
    html += '<span style="text-align:right">Win Rate</span><span style="text-align:right">P&L Total</span><span style="text-align:right">Avg Edge</span>';
    html += '</div>';

    for (const cat of cats) {
      const pnlClass = cat.totalPnl >= 0 ? 'pos' : 'neg';
      const pnlText  = (cat.totalPnl >= 0 ? '+' : '') + '$' + Math.abs(cat.totalPnl).toFixed(2);
      html += `<div class="perf-cat-row">
        <span class="perf-cat-name">${escapeHtml(cat.category)}</span>
        <span class="perf-cat-num">${cat.trades}</span>
        <span class="perf-cat-num">${cat.wins}</span>
        <span class="perf-cat-num">${((cat.winRate || 0) * 100).toFixed(0)}%</span>
        <span class="perf-cat-pnl ${pnlClass}">${pnlText}</span>
        <span class="perf-cat-num">${((cat.avgEdge || 0) * 100).toFixed(1)}%</span>
      </div>`;
    }

    container.innerHTML = html;
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
    if (status.dryRun) {
      setStatus('dryrun', 'Dry-Run');
      if (els.footerMode) {
        els.footerMode.textContent = 'DRY-RUN';
        els.footerMode.className = 'kpi-val mode-badge dryrun';
      }
    } else if (status.running) {
      setStatus('running', 'Operando');
      if (els.footerMode) {
        els.footerMode.textContent = 'LIVE';
        els.footerMode.className = 'kpi-val mode-badge live';
      }
    } else {
      setStatus('stopped', 'Parado');
      if (els.footerMode) {
        els.footerMode.textContent = 'PARADO';
        els.footerMode.className = 'kpi-val mode-badge';
      }
    }

    els.bankroll.textContent = formatMoney(status.bankroll);

    const pnlVal = status.totalPnl || 0;
    els.pnl.textContent = (pnlVal >= 0 ? '+' : '') + formatMoney(pnlVal);
    els.pnl.className = 'tm-value ' + (pnlVal > 0 ? 'pnl-positive' : pnlVal < 0 ? 'pnl-negative' : 'pnl-neutral');

    // Sync local uptime counter with server's reported start time
    if (status.startTime > 0) engineStartTime = status.startTime;

    els.statMarkets.textContent       = formatNumber(status.marketsScanned);
    els.statOpportunities.textContent = formatNumber(status.opportunitiesFound);
    els.statTrades.textContent        = formatNumber(status.tradesExecuted);
    els.statCycle.textContent         = '#' + (status.cycleCount || 0);
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
    els.statTrades.textContent   = formatNumber(stats.totalTrades);
    els.statWinrate.textContent  = stats.winRate.toFixed(0) + '%';
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
    if (!positions || positions.length === 0) {
      els.positionsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><span>Nenhuma posição aberta</span></div>';
      els.positionsCount.textContent = '0';
      if (els.statOpenPositions) els.statOpenPositions.textContent = '0';
      return;
    }
    els.positionsCount.textContent = positions.length;
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
        els.positionsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><span>Nenhuma posição aberta</span></div>';
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

    els.riskDrawdown.textContent = risk.drawdownPct.toFixed(1) + '%';
    els.riskDrawdownBar.style.width = Math.min(risk.drawdownPct / 15 * 100, 100) + '%';

    els.riskExposure.textContent = `$${formatNumber(risk.totalExposure)} / $${formatNumber(risk.maxExposure)}`;
    const expPct = risk.maxExposure > 0 ? (risk.totalExposure / risk.maxExposure * 100) : 0;
    els.riskExposureBar.style.width = Math.min(expPct, 100) + '%';

    els.riskPositions.textContent = risk.positionCount;
    if (els.statOpenPositions && risk.positionCount !== undefined) {
      els.statOpenPositions.textContent = risk.positionCount;
    }

    els.riskDailyLoss.textContent = '$' + formatNumber(risk.dailyLoss);
    els.riskDailyLoss.className = 'risk-stat-val' + (risk.dailyLoss > 0 ? ' danger' : '');

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

  // ========================================
  // DECISIONS FEED
  // ========================================
  function renderDecisions(decisions) {
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

  // Kick off
  init().catch(err => {
    console.error('Dashboard init error:', err);
    setStatus('stopped', 'Erro');
  });

})();
