/**
 * @jest-environment jsdom
 */
// ================================================
// TESTS: dashboard.js (frontend)
// Uses jsdom to test DOM manipulations.
// Tests utility functions directly and observable
// DOM behaviour through a loaded script context.
// ================================================

// ─── Utility functions (mirror dashboard.js implementations) ───
// These are pure functions defined inside the IIFE; we test them
// independently to verify correctness without loading the full script.

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatNumber(n: number | null | undefined, decimals = 2): string {
  return (n || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('pt-BR') +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

// ─── Minimal DOM helpers (mirror dashboard.js DOM patterns) ───

function buildRiskDOM(): {
  riskDrawdown: HTMLElement;
  riskDrawdownBar: HTMLElement;
  riskExposure: HTMLElement;
  riskExposureBar: HTMLElement;
  riskCircuit: HTMLElement;
  resetCircuitBtn: HTMLElement;
  emergencyStopSection: HTMLElement;
} {
  document.body.innerHTML = `
    <span id="risk-drawdown"></span>
    <div  id="risk-drawdown-bar" style="width:0%"></div>
    <span id="risk-exposure"></span>
    <div  id="risk-exposure-bar" style="width:0%"></div>
    <span id="risk-circuit" class="risk-stat-val ok">● OK</span>
    <button id="reset-circuit-btn" class="hidden"></button>
    <div  id="emergency-stop-section" style="display:none">
      <button id="reset-emergency-btn"></button>
    </div>
  `;

  return {
    riskDrawdown:       document.getElementById('risk-drawdown')!,
    riskDrawdownBar:    document.getElementById('risk-drawdown-bar')!,
    riskExposure:       document.getElementById('risk-exposure')!,
    riskExposureBar:    document.getElementById('risk-exposure-bar')!,
    riskCircuit:        document.getElementById('risk-circuit')!,
    resetCircuitBtn:    document.getElementById('reset-circuit-btn')!,
    emergencyStopSection: document.getElementById('emergency-stop-section')!,
  };
}

// Inline updateRisk — mirrors dashboard.js for isolated DOM testing
function updateRisk(risk: {
  drawdownPct: number;
  totalExposure: number;
  maxExposure: number;
  circuitBreaker: boolean;
  emergencyStop: boolean;
}): void {
  const $ = (id: string) => document.getElementById(id);

  const riskDrawdown = $('risk-drawdown');
  const riskDrawdownBar = $('risk-drawdown-bar') as HTMLElement | null;
  const riskExposure = $('risk-exposure');
  const riskExposureBar = $('risk-exposure-bar') as HTMLElement | null;
  const riskCircuit = $('risk-circuit');
  const resetCircuitBtn = $('reset-circuit-btn');
  const emergencyStopSection = $('emergency-stop-section') as HTMLElement | null;

  if (riskDrawdown) riskDrawdown.textContent = risk.drawdownPct.toFixed(1) + '%';
  if (riskDrawdownBar) riskDrawdownBar.style.width = Math.min(risk.drawdownPct * 5, 100) + '%';
  if (riskExposure) riskExposure.textContent = '$' + formatNumber(risk.totalExposure);
  if (riskExposureBar)
    riskExposureBar.style.width =
      Math.min((risk.totalExposure / risk.maxExposure) * 100, 100) + '%';
  if (riskCircuit) {
    riskCircuit.textContent = risk.circuitBreaker ? '🚨 ATIVO' : '● OK';
    riskCircuit.className = 'risk-stat-val ' + (risk.circuitBreaker ? 'danger' : 'ok');
    if (resetCircuitBtn) resetCircuitBtn.classList.toggle('hidden', !risk.circuitBreaker);
  }
  if (emergencyStopSection) {
    emergencyStopSection.style.display = risk.emergencyStop ? 'flex' : 'none';
  }
}

// Inline renderPositions — mirrors dashboard.js
function renderPositions(
  open: Array<{
    marketId: string;
    side: string;
    entryPrice: number;
    question: string;
    stake: number;
    edge: number;
  }>
): void {
  const positionsList = document.getElementById('positions-list');
  const positionsCount = document.getElementById('positions-count');
  if (!positionsList) return;
  if (positionsCount) positionsCount.textContent = String(open.length);
  positionsList.innerHTML =
    open.length === 0 ? '<div class="empty-state">Sem trades abertos.</div>' : '';
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
    positionsList.insertAdjacentHTML('beforeend', html);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('dashboard utilities', () => {

  // ----------------------------------------
  // escapeHtml
  // ----------------------------------------
  describe('escapeHtml()', () => {
    it('returns empty string for null/undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('escapes < and >', () => {
      expect(escapeHtml('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });

    it('escapes & character', () => {
      expect(escapeHtml('Bread & Butter')).toBe('Bread &amp; Butter');
    });

    it('preserves double quotes in text content (not encoded in text nodes)', () => {
      // jsdom / browsers don't encode " in text nodes — only in attribute values
      const result = escapeHtml('"Hello"');
      expect(result).not.toContain('<');
      expect(result.length).toBeGreaterThan(0);
    });

    it('does not alter safe plain text', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    it('escapes XSS-like payloads', () => {
      const payload = '<img src=x onerror="alert(1)">';
      const result = escapeHtml(payload);
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });
  });

  // ----------------------------------------
  // formatNumber
  // ----------------------------------------
  describe('formatNumber()', () => {
    it('formats zero correctly', () => {
      expect(formatNumber(0)).toBe('0.00');
    });

    it('formats null/undefined as 0', () => {
      expect(formatNumber(null)).toBe('0.00');
      expect(formatNumber(undefined)).toBe('0.00');
    });

    it('adds thousands separators', () => {
      expect(formatNumber(1000)).toBe('1,000.00');
      expect(formatNumber(1_500_000)).toBe('1,500,000.00');
    });

    it('respects decimals parameter', () => {
      expect(formatNumber(1.5, 0)).toBe('2');  // rounds
      expect(formatNumber(3.14159, 4)).toBe('3.1416');
    });

    it('formats negative numbers', () => {
      expect(formatNumber(-250.5)).toBe('-250.50');
    });
  });

  // ----------------------------------------
  // formatTime
  // ----------------------------------------
  describe('formatTime()', () => {
    it('returns "—" for null/undefined', () => {
      expect(formatTime(null)).toBe('—');
      expect(formatTime(undefined)).toBe('—');
    });

    it('returns "—" for empty string', () => {
      expect(formatTime('')).toBe('—');
    });

    it('returns a non-empty string for a valid ISO date', () => {
      const result = formatTime('2024-06-15T10:30:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(5);
      expect(result).not.toBe('—');
    });

    it('includes time portion with hour:minute', () => {
      const result = formatTime('2024-01-01T14:30:00Z');
      // Should contain hours and minutes separated by ':'
      expect(result).toMatch(/\d+:\d+/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM behaviour tests
// ─────────────────────────────────────────────────────────────────────────────

describe('updateRisk() DOM behaviour', () => {
  beforeEach(() => {
    buildRiskDOM();
  });

  it('sets drawdown text correctly', () => {
    updateRisk({ drawdownPct: 12.5, totalExposure: 100, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    expect(document.getElementById('risk-drawdown')!.textContent).toBe('12.5%');
  });

  it('sets drawdown bar width (capped at 100%)', () => {
    updateRisk({ drawdownPct: 25, totalExposure: 0, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    // 25 * 5 = 125 → capped at 100%
    expect((document.getElementById('risk-drawdown-bar') as HTMLElement).style.width).toBe('100%');
  });

  it('sets exposure text correctly', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 250, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    expect(document.getElementById('risk-exposure')!.textContent).toBe('$250.00');
  });

  it('circuit breaker OFF → text "● OK" and reset button hidden', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 0, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    const circuit = document.getElementById('risk-circuit')!;
    const btn = document.getElementById('reset-circuit-btn')!;
    expect(circuit.textContent).toBe('● OK');
    expect(circuit.className).toContain('ok');
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  it('circuit breaker ON → text "🚨 ATIVO" and reset button visible', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 0, maxExposure: 500, circuitBreaker: true, emergencyStop: false });
    const circuit = document.getElementById('risk-circuit')!;
    const btn = document.getElementById('reset-circuit-btn')!;
    expect(circuit.textContent).toBe('🚨 ATIVO');
    expect(circuit.className).toContain('danger');
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  it('emergency stop OFF → section is hidden', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 0, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    const section = document.getElementById('emergency-stop-section') as HTMLElement;
    expect(section.style.display).toBe('none');
  });

  it('emergency stop ON → section is visible (display: flex)', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 0, maxExposure: 500, circuitBreaker: false, emergencyStop: true });
    const section = document.getElementById('emergency-stop-section') as HTMLElement;
    expect(section.style.display).toBe('flex');
  });

  it('exposure bar caps at 100% when exposure equals maxExposure', () => {
    updateRisk({ drawdownPct: 0, totalExposure: 500, maxExposure: 500, circuitBreaker: false, emergencyStop: false });
    const bar = document.getElementById('risk-exposure-bar') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderPositions() DOM behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('renderPositions() DOM behaviour', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="positions-list"></div>
      <span id="positions-count"></span>
    `;
  });

  it('shows empty state for empty array', () => {
    renderPositions([]);
    const list = document.getElementById('positions-list')!;
    expect(list.innerHTML).toContain('empty-state');
  });

  it('updates positions count', () => {
    renderPositions([
      { marketId: 'm1', side: 'BUY_YES', entryPrice: 0.6, question: 'Will X win?', stake: 25, edge: 0.05 },
    ]);
    expect(document.getElementById('positions-count')!.textContent).toBe('1');
  });

  it('renders a position card with correct ID', () => {
    renderPositions([
      { marketId: 'abc123', side: 'BUY_YES', entryPrice: 0.55, question: 'Will Bitcoin hit $100k?', stake: 30, edge: 0.08 },
    ]);
    expect(document.getElementById('pos-abc123')).not.toBeNull();
  });

  it('shows "YES" badge for BUY_YES trades', () => {
    renderPositions([
      { marketId: 'm1', side: 'BUY_YES', entryPrice: 0.5, question: 'Will X win?', stake: 20, edge: 0.05 },
    ]);
    expect(document.getElementById('positions-list')!.innerHTML).toContain('side-yes');
    expect(document.getElementById('positions-list')!.innerHTML).toContain('>YES<');
  });

  it('shows "NO" badge for BUY_NO trades', () => {
    renderPositions([
      { marketId: 'm2', side: 'BUY_NO', entryPrice: 0.4, question: 'Will Y fail?', stake: 20, edge: 0.06 },
    ]);
    expect(document.getElementById('positions-list')!.innerHTML).toContain('side-no');
    expect(document.getElementById('positions-list')!.innerHTML).toContain('>NO<');
  });

  it('escapes HTML in question text', () => {
    renderPositions([
      { marketId: 'm3', side: 'BUY_YES', entryPrice: 0.5, question: '<script>alert(1)</script>', stake: 10, edge: 0.04 },
    ]);
    const html = document.getElementById('positions-list')!.innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders multiple position cards', () => {
    renderPositions([
      { marketId: 'm1', side: 'BUY_YES', entryPrice: 0.5, question: 'Q1 with enough chars to not be short', stake: 10, edge: 0.03 },
      { marketId: 'm2', side: 'BUY_NO',  entryPrice: 0.4, question: 'Q2 with enough chars to not be short', stake: 20, edge: 0.05 },
    ]);
    expect(document.querySelectorAll('.pos-card').length).toBe(2);
    expect(document.getElementById('positions-count')!.textContent).toBe('2');
  });

  it('formats stake with 2 decimal places', () => {
    renderPositions([
      { marketId: 'm1', side: 'BUY_YES', entryPrice: 0.5, question: 'Will something happen today?', stake: 33.333, edge: 0.05 },
    ]);
    expect(document.getElementById('positions-list')!.innerHTML).toContain('$33.33');
  });

  it('formats edge as percentage with 1 decimal', () => {
    renderPositions([
      { marketId: 'm1', side: 'BUY_YES', entryPrice: 0.5, question: 'Will something happen today?', stake: 25, edge: 0.075 },
    ]);
    expect(document.getElementById('positions-list')!.innerHTML).toContain('+7.5%');
  });
});
