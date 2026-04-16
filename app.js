'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_BASE = '';  // Same origin
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ─── STATE ───────────────────────────────────────────────────────────────────
let selectedSymbol = null;
let selectedShortName = null;
let currentCategory = 'forex';
let lastAnalysis = null;
let autoRefreshTimer = null;
let autoRefreshCountdown = null;
let countdownSeconds = REFRESH_INTERVAL_MS / 1000;

// ─── INSTRUMENT DEFINITIONS ──────────────────────────────────────────────────
const INSTRUMENTS = {
  forex: [
    { symbol: 'EURUSD=X', name: 'EUR/USD' },
    { symbol: 'GBPUSD=X', name: 'GBP/USD' },
    { symbol: 'USDJPY=X', name: 'USD/JPY' },
    { symbol: 'AUDUSD=X', name: 'AUD/USD' },
    { symbol: 'USDCHF=X', name: 'USD/CHF' },
    { symbol: 'USDCAD=X', name: 'USD/CAD' },
    { symbol: 'NZDUSD=X', name: 'NZD/USD' },
    { symbol: 'EURGBP=X', name: 'EUR/GBP' },
    { symbol: 'EURJPY=X', name: 'EUR/JPY' },
    { symbol: 'GBPJPY=X', name: 'GBP/JPY' },
    { symbol: 'XAUUSD=X', name: 'XAU/USD' },
    { symbol: 'XAGUSD=X', name: 'XAG/USD' },
  ],
  crypto: [
    { symbol: 'BTCUSDT', name: 'BTC/USDT' },
    { symbol: 'ETHUSDT', name: 'ETH/USDT' },
    { symbol: 'SOLUSDT', name: 'SOL/USDT' },
    { symbol: 'BNBUSDT', name: 'BNB/USDT' },
    { symbol: 'XRPUSDT', name: 'XRP/USDT' },
    { symbol: 'ADAUSDT', name: 'ADA/USDT' },
    { symbol: 'DOGEUSDT', name: 'DOGE/USDT' },
    { symbol: 'DOTUSDT', name: 'DOT/USDT' },
  ],
  indices: [
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: '^IXIC', name: 'NASDAQ' },
    { symbol: '^DJI',  name: 'Dow Jones' },
    { symbol: '^GDAXI', name: 'DAX 40' },
    { symbol: '^FTSE', name: 'FTSE 100' },
    { symbol: '^N225', name: 'Nikkei 225' },
  ],
  custom: [],
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCategoryTabs();
  renderInstrumentGrid('forex');
  startClock();
  fetchSessions();
  fetchMarkets();
  loadStats();
  startAutoRefresh();
  checkHealth();

  // Category tab listeners
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.cat;
      renderInstrumentGrid(currentCategory);
      const customWrap = document.getElementById('customSymbolWrap');
      customWrap.classList.toggle('hidden', currentCategory !== 'custom');
    });
  });

  // Analyze button
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

  // Auto-refresh toggle
  document.getElementById('autoRefreshToggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
});

// ─── CATEGORY & INSTRUMENT GRID ──────────────────────────────────────────────
function initCategoryTabs() {
  // already in HTML
}

function renderInstrumentGrid(cat) {
  const grid = document.getElementById('instrumentGrid');
  const instruments = INSTRUMENTS[cat] || [];
  grid.innerHTML = '';
  instruments.forEach(inst => {
    const btn = document.createElement('button');
    btn.className = 'inst-btn' + (selectedSymbol === inst.symbol ? ' selected' : '');
    btn.textContent = inst.name;
    btn.dataset.symbol = inst.symbol;
    btn.dataset.name = inst.name;
    btn.addEventListener('click', () => selectInstrument(inst.symbol, inst.name));
    grid.appendChild(btn);
  });
}

function selectInstrument(symbol, name) {
  selectedSymbol = symbol;
  selectedShortName = name;
  document.querySelectorAll('.inst-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll(`.inst-btn[data-symbol="${symbol}"]`).forEach(b => b.classList.add('selected'));
  document.getElementById('selectedName').textContent = name;
}

// ─── CLOCK & SESSIONS ────────────────────────────────────────────────────────
function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const h = String(now.getUTCHours()).padStart(2, '0');
  const m = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  document.getElementById('utcClock').textContent = `${h}:${m}:${s} UTC`;
}

async function fetchSessions() {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`);
    const data = await res.json();
    renderSessions(data);
    setTimeout(fetchSessions, 60000);
  } catch (e) {
    console.warn('Sessions fetch failed:', e);
    setTimeout(fetchSessions, 60000);
  }
}

function renderSessions(data) {
  const wrap = document.getElementById('sessionsBadges');
  wrap.innerHTML = '';
  const allSessions = [
    { key: 'sydney',   label: 'SYDNEY',   color: '#a78bfa' },
    { key: 'tokyo',    label: 'TOKYO',    color: '#f59e0b' },
    { key: 'london',   label: 'LONDON',   color: '#3b82f6' },
    { key: 'new_york', label: 'NEW YORK', color: '#10b981' },
  ];

  const activeKeys = (data.active || []).map(s => s.key);
  const hasOverlap = activeKeys.includes('overlap_lo_ny');

  allSessions.forEach(s => {
    const isActive = activeKeys.includes(s.key);
    const badge = document.createElement('span');
    if (isActive) {
      badge.className = 'session-badge';
      badge.style.color = s.color;
      badge.style.borderColor = s.color;
      badge.textContent = s.label;
    } else {
      badge.className = 'session-inactive';
      badge.textContent = s.label;
    }
    wrap.appendChild(badge);
  });

  if (hasOverlap) {
    const badge = document.createElement('span');
    badge.className = 'session-badge';
    badge.style.color = '#f43f5e';
    badge.style.borderColor = '#f43f5e';
    badge.textContent = 'LDN/NY OVERLAP ◉';
    wrap.appendChild(badge);
  }
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    const dotGemini = document.getElementById('dotGemini');
    const dotData   = document.getElementById('dotData');
    dotGemini.className = 'status-dot' + (data.keys?.gemini ? ' online' : ' offline');
    dotData.className   = 'status-dot ml' + ((data.keys?.twelveData || data.keys?.binance) ? ' online' : ' offline');
  } catch (e) {
    document.getElementById('dotGemini').className = 'status-dot offline';
    document.getElementById('dotData').className   = 'status-dot ml offline';
  }
  setTimeout(checkHealth, 30000);
}

// ─── MARKET TICKER ───────────────────────────────────────────────────────────
async function fetchMarkets() {
  try {
    const res = await fetch(`${API_BASE}/api/trading/markets`);
    const data = await res.json();
    renderTicker(data);
  } catch (e) { console.warn('Markets fetch failed:', e); }
  setTimeout(fetchMarkets, 60000);
}

function renderTicker(data) {
  const track = document.getElementById('tickerTrack');
  const items = [];

  // Crypto
  (data.crypto || []).forEach(d => {
    items.push({ sym: d.symbol, price: d.price, change: d.change });
  });
  // Forex
  (data.forex || []).forEach(d => {
    const name = d.symbol.replace('=X', '').replace(/(...)(...)/,'$1/$2');
    items.push({ sym: name, price: d.price, change: d.change || 0 });
  });
  // Indices
  (data.indices || []).forEach(d => {
    const map = { '^GSPC': 'SPX', '^IXIC': 'NDX', '^DJI': 'DOW', '^GDAXI': 'DAX', '^FTSE': 'FTSE', '^N225': 'N225' };
    items.push({ sym: map[d.symbol] || d.symbol, price: d.price, change: d.change || 0 });
  });

  if (items.length === 0) return;

  // Duplicate for seamless scroll
  const html = [...items, ...items].map(d => {
    const changeClass = d.change >= 0 ? 'up' : 'down';
    const changeSign  = d.change >= 0 ? '+' : '';
    const price = formatPrice(d.price, d.sym);
    return `<span class="ticker-item">
      <span class="ticker-sym">${d.sym}</span>
      <span class="ticker-price">${price}</span>
      <span class="ticker-change ${changeClass}">${changeSign}${(+d.change).toFixed(2)}%</span>
    </span>`;
  }).join('');

  track.innerHTML = html;
}

// ─── ANALYSIS ────────────────────────────────────────────────────────────────
async function runAnalysis() {
  let symbol = selectedSymbol;
  let shortName = selectedShortName;

  // Custom symbol
  if (currentCategory === 'custom') {
    symbol    = document.getElementById('customSymbolInput').value.trim().toUpperCase();
    shortName = document.getElementById('customNameInput').value.trim() || symbol;
    if (!symbol) { alert('Enter a custom symbol first.'); return; }
    selectedSymbol = symbol;
    selectedShortName = shortName;
  }

  if (!symbol) { alert('Please select an instrument first.'); return; }

  showLoading();

  // Animated loading steps
  animateLoadingSteps();

  try {
    const res = await fetch(`${API_BASE}/api/trading/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, shortName }),
    });

    let data = await res.json();

    if (data.error && !data.signal) {
      showError(data.error, data.recommendation);
      return;
    }

    // Override SL/TP with 15-min ATR-based levels
    data = await applyAtrLevels(data);

    lastAnalysis = { symbol, shortName };
    renderResults(data);
    loadStats();

    // Reset countdown
    countdownSeconds = REFRESH_INTERVAL_MS / 1000;
  } catch (e) {
    showError(`Network error: ${e.message}`, 'Check your internet connection and try again.');
  }
}

function retryAnalysis() {
  runAnalysis();
}

let loadingStepTimer = null;
function animateLoadingSteps() {
  const steps = ['ls1', 'ls2', 'ls3', 'ls4', 'ls5'];
  steps.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.className = 'lstep'; }
  });
  let i = 0;
  clearInterval(loadingStepTimer);
  loadingStepTimer = setInterval(() => {
    if (i > 0) {
      const prev = document.getElementById(steps[i-1]);
      if (prev) prev.className = 'lstep done';
    }
    if (i < steps.length) {
      const cur = document.getElementById(steps[i]);
      if (cur) cur.className = 'lstep active';
      i++;
    } else {
      clearInterval(loadingStepTimer);
    }
  }, 3000);
}

// ─── UI STATE MANAGERS ───────────────────────────────────────────────────────
function showLoading() {
  document.getElementById('welcomeState').classList.add('hidden');
  document.getElementById('resultsPanel').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('analyzeBtn').classList.add('loading');
}

function showError(msg, recommendation) {
  clearInterval(loadingStepTimer);
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('analyzeBtn').classList.remove('loading');
  document.getElementById('errorTitle').textContent = 'Analysis Error';
  document.getElementById('errorMsg').textContent = msg + (recommendation ? '\n\n' + recommendation : '');
  document.getElementById('errorState').classList.remove('hidden');
}

function showResults() {
  clearInterval(loadingStepTimer);
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('welcomeState').classList.add('hidden');
  document.getElementById('analyzeBtn').classList.remove('loading');
  document.getElementById('resultsPanel').classList.remove('hidden');
}

// ─── RENDER RESULTS ───────────────────────────────────────────────────────────
function renderResults(data) {
  showResults();

  const signal = data.signal || 'NEUTRAL';
  const p1 = data.p1 || {};
  const p2 = data.p2 || {};
  const p3 = data.p3 || {};
  const p4 = data.p4 || {};
  const p5 = data.p5 || {};
  const p6 = data.p6 || {};

  // ── Signal Banner ──
  const banner = document.getElementById('signalBanner');
  banner.className = `signal-banner banner-${signal}`;
  document.getElementById('rInstrument').textContent = data.shortName || data.symbol;
  document.getElementById('rPrice').textContent = `Current: ${formatPrice(data.currentPrice, data.symbol)}`;
  document.getElementById('rTime').textContent = new Date(data.timestamp || Date.now()).toLocaleString();

  const badge = document.getElementById('signalBadge');
  badge.textContent = signal.replace('_', ' ');
  badge.className = `signal-badge badge-${signal}`;

  const upgradeScore = data.upgradeScore || ((p4.score || 0) + (p5.score || 0) + (p6.score || 0));
  const gatesPassed  = data.gatesPassed || (p1.passed && p2.passed && p3.passed);
  document.getElementById('signalScore').textContent =
    `Gates: ${gatesPassed ? '✓ ALL PASSED' : '✗ FAILED'} | Upgrade Score: ${upgradeScore}/24`;

  document.getElementById('signalContext').innerHTML =
    (data.marketContext || '').replace(/\n/g, '<br>');

  // ── Trade Levels ──
  document.getElementById('lvlEntry').textContent  = formatPrice(data.entry, data.symbol);
  document.getElementById('lvlSL').textContent     = formatPrice(data.stopLoss, data.symbol);
  document.getElementById('lvlTP').textContent     = formatPrice(data.takeProfit, data.symbol);
  document.getElementById('lvlRR').textContent     = data.riskReward ? `1 : ${(+data.riskReward).toFixed(2)}` : '—';
  document.getElementById('lvlSLReason').textContent = data.slReason || '';
  document.getElementById('lvlTPReason').textContent = data.tpReason || '';

  // Show ATR badge if available
  const atrBadgeEl = document.getElementById('lvlATR');
  if (atrBadgeEl) {
    atrBadgeEl.textContent = data.atr15m
      ? `15m ATR(14): ${formatPrice(data.atr15m, data.symbol)}`
      : '';
    atrBadgeEl.style.display = data.atr15m ? '' : 'none';
  }

  // ── Pillar Cards ──
  const pillarsGrid = document.getElementById('pillarsGrid');
  pillarsGrid.innerHTML = '';

  const pillarsConfig = [
    {
      id: 'p1', num: 'P1', name: 'HTF Macro Bias', tf: '4H TIMEFRAME', role: 'GATE', colorClass: 'p1-color',
      data: p1,
      values: () => [
        { k: 'EMA5',  v: formatPrice(p1.ema5,  data.symbol) },
        { k: 'EMA13', v: formatPrice(p1.ema13, data.symbol) },
        { k: 'EMA89', v: formatPrice(p1.ema89, data.symbol) },
        { k: 'Bias',  v: (p1.bias || '—').toUpperCase() },
      ],
    },
    {
      id: 'p2', num: 'P2', name: 'Momentum', tf: '15MIN TIMEFRAME', role: 'GATE', colorClass: 'p2-color',
      data: p2,
      values: () => [
        { k: 'EMA5',  v: formatPrice(p2.ema5,  data.symbol) },
        { k: 'EMA13', v: formatPrice(p2.ema13, data.symbol) },
        { k: 'Bias',  v: (p2.bias || '—').toUpperCase() },
      ],
    },
    {
      id: 'p3', num: 'P3', name: 'Entry Structure', tf: '5MIN TIMEFRAME', role: 'GATE', colorClass: 'p3-color',
      data: p3,
      values: () => [
        { k: 'BOS',   v: p3.bos   ? '✓' : '✗' },
        { k: 'CHoCH', v: p3.choch ? '✓' : '✗' },
        { k: 'MSS',   v: p3.mss   ? '✓' : '✗' },
        { k: 'Dir',   v: (p3.direction || '—').toUpperCase() },
      ],
    },
    {
      id: 'p4', num: 'P4', name: 'PD Array (OB/FVG)', tf: '15MIN TIMEFRAME', role: 'UPGRADE', colorClass: 'p4-color',
      data: p4,
      values: () => [
        { k: 'OB Touch', v: p4.touchingOB ? '✓' : '✗' },
        { k: 'In FVG',   v: p4.insideFVG  ? '✓' : '✗' },
        { k: 'Score',    v: `+${p4.score || 0} pts` },
      ],
    },
    {
      id: 'p5', num: 'P5', name: 'Value Zone', tf: '15MIN TIMEFRAME', role: 'UPGRADE', colorClass: 'p5-color',
      data: p5,
      values: () => [
        { k: 'Zone',    v: (p5.zone || '—').replace('_',' ').toUpperCase() },
        { k: 'Equil.',  v: formatPrice(p5.equilibrium, data.symbol) },
        { k: 'Score',   v: `+${p5.score || 0} pts` },
      ],
    },
    {
      id: 'p6', num: 'P6', name: 'Liquidity (CRT)', tf: '15MIN TIMEFRAME', role: 'UPGRADE', colorClass: 'p6-color',
      data: p6,
      values: () => [
        { k: 'SSL Swept', v: p6.sslSwept    ? '✓' : '✗' },
        { k: 'BSL Swept', v: p6.bslSwept    ? '✓' : '✗' },
        { k: 'CRT',       v: p6.crtConfirmed ? '✓ CONFIRMED' : (p6.crtForming ? '◉ FORMING' : '✗') },
        { k: 'Score',     v: `+${p6.score || 0} pts` },
      ],
    },
  ];

  pillarsConfig.forEach(pc => {
    const pd = pc.data;
    const passed = pd.passed;
    const bias = pd.bias || pd.direction || '';
    const isBull = bias === 'bullish';
    const isBear = bias === 'bearish';
    let cardClass = 'pillar-card';
    if (passed) cardClass += isBull ? ' passed-bullish' : (isBear ? ' passed-bearish' : ' passed-bullish');
    else cardClass += ' failed';

    let statusIcon, statusClass, statusText;
    if (passed) {
      if (isBull) { statusIcon = '▲'; statusClass = 'pass-bull'; statusText = 'BULLISH'; }
      else if (isBear) { statusIcon = '▼'; statusClass = 'pass-bear'; statusText = 'BEARISH'; }
      else { statusIcon = '✓'; statusClass = 'pass-bull'; statusText = 'PASSED'; }
    } else {
      statusIcon = '✗'; statusClass = 'fail'; statusText = 'FAILED';
    }

    const valuesHTML = pc.values().map(v =>
      `<span class="pv-item">${v.k}<span>${v.v}</span></span>`
    ).join('');

    const scoreHTML = pc.role === 'UPGRADE' && pd.score
      ? `<div class="pillar-score">Score: +${pd.score} points</div>`
      : '';

    const card = document.createElement('div');
    card.className = cardClass;
    card.dataset.pillarId = pc.id;
    card.innerHTML = `
      <div class="pillar-top">
        <span class="pillar-num ${pc.colorClass}">${pc.num}</span>
        <div class="pillar-meta">
          <div class="pillar-name">${pc.name}</div>
          <div class="pillar-tf">${pc.tf}</div>
        </div>
        <span class="pillar-role-badge ${pc.role === 'GATE' ? 'role-gate' : 'role-upgrade'}">${pc.role}</span>
      </div>
      <div class="pillar-status">
        <span class="status-icon ${statusClass}">${statusIcon}</span>
        <span class="status-text" style="color:${statusClass === 'pass-bull' ? 'var(--green)' : (statusClass === 'pass-bear' ? 'var(--red)' : 'var(--muted)') }">${statusText}</span>
      </div>
      <div class="pillar-values">${valuesHTML}</div>
      ${scoreHTML}
      <div class="pillar-explanation">${pd.explanation || 'No explanation provided.'}</div>
      <div class="pillar-expand-hint">CLICK FOR DETAILS →</div>
    `;
    card.addEventListener('click', () => openPillarModal(pc, pd, data));
    pillarsGrid.appendChild(card);
  });

  // ── Data Sources ──
  const ds = data.dataSources || {};
  document.getElementById('dataSources').innerHTML = `
    <span class="ds-item">Data Sources:</span>
    <span class="ds-item">4H:<span class="ds-source">${ds['4h'] || '—'}</span></span>
    <span class="ds-item">15min:<span class="ds-source">${ds['15m'] || '—'}</span></span>
    <span class="ds-item">5min:<span class="ds-source">${ds['5m'] || '—'}</span></span>
    ${data.cached ? '<span class="ds-item" style="color:var(--yellow)">● CACHED (60s)</span>' : ''}
  `;

  // ── History ──
  renderHistoryItem(data);
}

// ─── PILLAR MODAL ─────────────────────────────────────────────────────────────
function openPillarModal(pc, pd, mainData) {
  const modal = document.getElementById('pillarModal');

  document.getElementById('modalPillarId').textContent = pc.num;
  document.getElementById('modalPillarName').textContent = pc.name;
  const badge = document.getElementById('modalPillarBadge');
  badge.className = `modal-pillar-badge pillar-role-badge ${pc.role === 'GATE' ? 'role-gate' : 'role-upgrade'}`;
  badge.textContent = pc.role;

  // Colorize pillar id
  const numEl = document.getElementById('modalPillarId');
  numEl.className = `modal-pillar-id ${pc.colorClass}`;

  let bodyHTML = '';

  // Status section
  const passed = pd.passed;
  const statusColor = passed ? 'var(--green)' : 'var(--muted)';
  const statusText  = passed ? '✓ PASSED' : '✗ FAILED';
  bodyHTML += `
    <div class="modal-section">
      <div class="modal-section-title">Status</div>
      <div style="font-size:16px;font-weight:700;color:${statusColor};font-family:var(--font-head);letter-spacing:2px;">${statusText}</div>
    </div>
  `;

  // Values section
  const valRows = pc.values().map(v =>
    `<div class="modal-kv-item"><span class="modal-kv-key">${v.k}</span><span class="modal-kv-val">${v.v}</span></div>`
  ).join('');
  bodyHTML += `
    <div class="modal-section">
      <div class="modal-section-title">Computed Values</div>
      <div class="modal-kv">${valRows}</div>
    </div>
  `;

  // Extra P5 Fibonacci levels
  if (pc.id === 'p5' && pd.rangeHigh) {
    bodyHTML += `
      <div class="modal-section">
        <div class="modal-section-title">Fibonacci Levels</div>
        <div class="modal-kv">
          <div class="modal-kv-item"><span class="modal-kv-key">Range High (100%)</span><span class="modal-kv-val">${formatPrice(pd.rangeHigh, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Deep Premium (78.6%)</span><span class="modal-kv-val red">${formatPrice(pd.deepPremium786, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Premium (61.8%)</span><span class="modal-kv-val red">${formatPrice(pd.premium618, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Equilibrium (50%)</span><span class="modal-kv-val yellow">${formatPrice(pd.equilibrium, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Discount (38.2%)</span><span class="modal-kv-val green">${formatPrice(pd.discount382, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Deep Discount (21.4%)</span><span class="modal-kv-val green">${formatPrice(pd.deepDiscount214, mainData.symbol)}</span></div>
          <div class="modal-kv-item"><span class="modal-kv-key">Range Low (0%)</span><span class="modal-kv-val">${formatPrice(pd.rangeLow, mainData.symbol)}</span></div>
        </div>
      </div>
    `;
  }

  // Extra P4 levels
  if (pc.id === 'p4') {
    bodyHTML += `
      <div class="modal-section">
        <div class="modal-section-title">Key Levels</div>
        <div class="modal-kv">
          ${pd.obLevel ? `<div class="modal-kv-item"><span class="modal-kv-key">Order Block Level</span><span class="modal-kv-val yellow">${formatPrice(pd.obLevel, mainData.symbol)}</span></div>` : ''}
          ${pd.fvgHigh ? `<div class="modal-kv-item"><span class="modal-kv-key">FVG High</span><span class="modal-kv-val">${formatPrice(pd.fvgHigh, mainData.symbol)}</span></div>` : ''}
          ${pd.fvgLow  ? `<div class="modal-kv-item"><span class="modal-kv-key">FVG Low</span><span class="modal-kv-val">${formatPrice(pd.fvgLow, mainData.symbol)}</span></div>` : ''}
        </div>
      </div>
    `;
  }

  // Extra P6 levels
  if (pc.id === 'p6') {
    bodyHTML += `
      <div class="modal-section">
        <div class="modal-section-title">Liquidity Pools</div>
        <div class="modal-kv">
          ${pd.sslLevel ? `<div class="modal-kv-item"><span class="modal-kv-key">SSL Level</span><span class="modal-kv-val red">${formatPrice(pd.sslLevel, mainData.symbol)}</span></div>` : ''}
          ${pd.bslLevel ? `<div class="modal-kv-item"><span class="modal-kv-key">BSL Level</span><span class="modal-kv-val green">${formatPrice(pd.bslLevel, mainData.symbol)}</span></div>` : ''}
        </div>
      </div>
    `;
  }

  // Score (upgrades only)
  if (pc.role === 'UPGRADE') {
    bodyHTML += `
      <div class="modal-section">
        <div class="modal-section-title">Upgrade Score</div>
        <div style="font-family:var(--font-mono);font-size:20px;color:var(--yellow);font-weight:700;">+${pd.score || 0} / ${pc.id === 'p4' ? 7 : pc.id === 'p5' ? 9 : 8} max points</div>
      </div>
    `;
  }

  // Explanation
  bodyHTML += `
    <div class="modal-section">
      <div class="modal-section-title">AI Explanation</div>
      <div class="modal-explanation">${pd.explanation || 'No explanation provided.'}</div>
    </div>
  `;

  // Why this pillar matters
  const pillarWhys = {
    p1: 'P1 is the macro compass. It ensures you only trade in the direction of the dominant 4-hour trend. Trading against the HTF bias is one of the most common institutional-trap strategies. EMA stack alignment confirms institutional positioning.',
    p2: 'P2 confirms momentum is aligned on the 15-minute chart. This is the "confirmation" of the macro bias at a lower timeframe, ensuring you\'re entering with momentum, not against it. EMA5 above EMA13 shows active buying pressure.',
    p3: 'P3 is the entry trigger. It uses 5-minute structural analysis (BOS/CHoCH/MSS) to pinpoint the exact moment market structure shifts in your favour. This is the final gate before a trade signal is issued — no structure break, no trade.',
    p4: 'P4 identifies institutional price delivery mechanisms. Order Blocks are areas where institutional orders were placed causing large moves. Fair Value Gaps are imbalances that price seeks to fill. Trading at these levels offers high-probability setups.',
    p5: 'P5 ensures you\'re buying at discount or selling at premium relative to the current range. Institutions accumulate in the discount zone (below 50% equilibrium) and distribute in the premium zone (above 50%). This is core to smart money concepts.',
    p6: 'P6 detects liquidity grabs and CRT patterns — the final confirmation that smart money has engineered a move to grab stop losses before reversing. A confirmed CRT means institutions have finished their manipulation and the true move is beginning.',
  };
  bodyHTML += `
    <div class="modal-section">
      <div class="modal-section-title">Why This Pillar Matters</div>
      <div class="modal-explanation" style="color:var(--muted)">${pillarWhys[pc.id] || ''}</div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = bodyHTML;
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('pillarModal').classList.add('hidden');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('pillarModal').addEventListener('click', e => {
  if (e.target.id === 'pillarModal') closeModal();
});

// ─── HISTORY ─────────────────────────────────────────────────────────────────
function renderHistoryItem(data) {
  const list = document.getElementById('historyList');
  const noHistory = list.querySelector('.no-history');
  if (noHistory) noHistory.remove();

  const item = document.createElement('div');
  item.className = 'history-item';
  item.dataset.id = data.timestamp;

  const signalColor = {
    STRONG_BUY: 'var(--green)', BUY: 'var(--green-bright)',
    NEUTRAL: 'var(--muted)',
    SELL: 'var(--red-bright)', STRONG_SELL: 'var(--red)',
  }[data.signal] || 'var(--muted)';

  const signal = data.signal || 'NEUTRAL';
  const histSignal = signalHistory_local.find(s => s.timestamp === data.timestamp);

  item.innerHTML = `
    <div class="hi-top">
      <span class="hi-sym">${data.shortName || data.symbol}</span>
      <span class="hi-signal ${signal}">${signal.replace('_',' ')}</span>
    </div>
    <div class="hi-levels">
      ${data.entry    ? `<span>E: <span class="hi-entry">${formatPrice(data.entry, data.symbol)}</span></span>` : ''}
      ${data.stopLoss ? `<span>SL: <span class="hi-sl">${formatPrice(data.stopLoss, data.symbol)}</span></span>` : ''}
      ${data.takeProfit ? `<span>TP: <span class="hi-tp">${formatPrice(data.takeProfit, data.symbol)}</span></span>` : ''}
      ${data.riskReward ? `<span style="color:var(--yellow)">RR: 1:${(+data.riskReward).toFixed(2)}</span>` : ''}
    </div>
    <div class="hi-time">${new Date(data.timestamp).toLocaleString()}</div>
    ${signal !== 'NEUTRAL' ? `
    <div class="outcome-buttons" data-ts="${data.timestamp}">
      <button class="ob-btn ob-win"  onclick="markOutcome(${data.timestamp},'win')">✓ WIN</button>
      <button class="ob-btn ob-loss" onclick="markOutcome(${data.timestamp},'loss')">✗ LOSS</button>
    </div>` : ''}
  `;

  list.insertBefore(item, list.firstChild);
  updateHistoryCount();
}

// Local cache of signal history for win/loss tracking
const signalHistory_local = [];

async function markOutcome(ts, outcome) {
  // Find item in DOM
  const items = document.querySelectorAll(`.history-item[data-id="${ts}"]`);
  items.forEach(item => {
    // Remove outcome buttons
    const btns = item.querySelector('.outcome-buttons');
    if (btns) btns.remove();
    // Add outcome badge
    const badge = document.createElement('span');
    badge.className = `hi-outcome ${outcome}`;
    badge.textContent = outcome.toUpperCase();
    item.appendChild(badge);
  });

  // Update server
  try {
    await fetch(`${API_BASE}/api/trading/signals`, {
      method: 'GET', // just refresh stats
    });
  } catch (_) {}

  loadStats();
}

async function loadStats() {
  try {
    const res  = await fetch(`${API_BASE}/api/trading/signals`);
    const data = await res.json();
    const stats = data.stats || {};
    renderStats(stats);
    updateHistoryCount(stats.totalSignals || 0);
  } catch (e) { console.warn('Stats load failed:', e); }
}

function renderStats(stats) {
  document.getElementById('statWinRate').textContent = stats.winRate ? `${stats.winRate}%` : '—';
  document.getElementById('statTotal').textContent   = stats.total   || 0;
  document.getElementById('statWins').textContent    = stats.wins    || 0;
  document.getElementById('statLosses').textContent  = stats.losses  || 0;

  const winRate = parseFloat(stats.winRate) || 0;
  document.getElementById('winBarFill').style.width = `${winRate}%`;

  // Signal breakdown
  const bd = stats.signalBreakdown || {};
  const breakdownEl = document.getElementById('signalBreakdown');
  const items = [
    { key: 'STRONG_BUY',  label: 'SB',  color: 'var(--green)' },
    { key: 'BUY',          label: 'B',   color: 'var(--green-bright)' },
    { key: 'NEUTRAL',      label: 'N',   color: 'var(--muted)' },
    { key: 'SELL',         label: 'S',   color: 'var(--red-bright)' },
    { key: 'STRONG_SELL',  label: 'SS',  color: 'var(--red)' },
  ];
  breakdownEl.innerHTML = items.map(it =>
    `<span class="breakdown-item" style="color:${it.color};border-color:${it.color}">${it.label}: ${bd[it.key] || 0}</span>`
  ).join('');
}

function updateHistoryCount(count) {
  const el = document.getElementById('historyCount');
  const allItems = document.querySelectorAll('.history-item').length;
  el.textContent = count !== undefined ? count : allItems;
}

async function clearHistory() {
  if (!confirm('Clear all signal history?')) return;
  try {
    await fetch(`${API_BASE}/api/trading/signals`, { method: 'DELETE' });
  } catch (_) {}
  document.getElementById('historyList').innerHTML = '<div class="no-history">No signals yet. Run your first analysis.</div>';
  renderStats({});
  updateHistoryCount(0);
}

// ─── AUTO-REFRESH ─────────────────────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  countdownSeconds = REFRESH_INTERVAL_MS / 1000;

  autoRefreshCountdown = setInterval(() => {
    countdownSeconds--;
    const m = String(Math.floor(countdownSeconds / 60)).padStart(2,'0');
    const s = String(countdownSeconds % 60).padStart(2,'0');
    document.getElementById('refreshCountdown').textContent = `${m}:${s}`;

    if (countdownSeconds <= 0) {
      if (lastAnalysis && document.getElementById('autoRefreshToggle').checked) {
        selectedSymbol = lastAnalysis.symbol;
        selectedShortName = lastAnalysis.shortName;
        runAnalysis();
      }
      countdownSeconds = REFRESH_INTERVAL_MS / 1000;
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (autoRefreshCountdown) clearInterval(autoRefreshCountdown);
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  document.getElementById('refreshCountdown').textContent = 'PAUSED';
}

// ─── ATR-BASED SL/TP ─────────────────────────────────────────────────────────
/**
 * Fetch 15-min OHLC candles for a symbol using Yahoo Finance's public chart API.
 * Returns an array of { high, low, close } objects (most recent last).
 */
async function fetch15mCandles(symbol) {
  // Map internal symbols to Yahoo Finance format
  let yfSym = symbol;
  if (symbol.endsWith('USDT')) {
    // Binance crypto → Yahoo Finance crypto ticker
    yfSym = symbol.replace('USDT', '-USD');
  }
  // Yahoo Finance chart endpoint: 1-day range, 15m interval gives ~32 candles
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=15m&range=2d&includePrePost=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo candle fetch failed: ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No candle data returned');
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const highs = q.high || [];
  const lows  = q.low  || [];
  const closes = q.close || [];
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (highs[i] != null && lows[i] != null && closes[i] != null) {
      candles.push({ high: highs[i], low: lows[i], close: closes[i] });
    }
  }
  return candles;
}

/**
 * Calculate ATR(period) from an array of { high, low, close } candles.
 */
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  // Compute True Range for each candle
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose)
    );
    trs.push(tr);
  }
  // Simple average for first ATR value
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Wilder smoothing for remaining values
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * Apply 15-min ATR-based SL/TP to an analysis result object.
 * SL = entry ± 1.0× ATR14
 * TP = entry ∓ 2.0× ATR14  (default 2:1 RR)
 * Attaches atr15m, slReason, tpReason, and recalculated riskReward.
 */
async function applyAtrLevels(data) {
  try {
    const candles = await fetch15mCandles(data.symbol);
    const atr = calcATR(candles, 14);
    if (!atr || !data.entry) return data; // fallback: keep original levels

    const entry = parseFloat(data.entry);
    const signal = (data.signal || '').toUpperCase();
    const isBull = signal.includes('BUY');
    const isBear = signal.includes('SELL');
    if (!isBull && !isBear) return data; // NEUTRAL — no trade levels needed

    const SL_MULT = 1.0;
    const TP_MULT = 2.0;

    const stopLoss   = isBull ? entry - atr * SL_MULT : entry + atr * SL_MULT;
    const takeProfit = isBull ? entry + atr * TP_MULT : entry - atr * TP_MULT;
    const risk       = Math.abs(entry - stopLoss);
    const reward     = Math.abs(takeProfit - entry);
    const riskReward = risk > 0 ? (reward / risk).toFixed(2) : '—';

    return {
      ...data,
      stopLoss,
      takeProfit,
      riskReward,
      atr15m: atr,
      slReason: `15m ATR(14) × ${SL_MULT} = ${formatPrice(atr, data.symbol)}`,
      tpReason: `15m ATR(14) × ${TP_MULT} = ${formatPrice(atr * TP_MULT, data.symbol)} (2:1 RR)`,
    };
  } catch (e) {
    console.warn('ATR calculation failed, keeping original levels:', e.message);
    return data;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatPrice(price, symbol) {
  if (price === null || price === undefined || isNaN(price) || price === 0) return '—';
  const p = parseFloat(price);

  // Forex: 5 decimal places
  if (symbol && (symbol.endsWith('=X') || symbol.includes('/'))) {
    if (p > 100) return p.toFixed(2);  // JPY pairs
    return p.toFixed(5);
  }
  // Crypto
  if (symbol && (symbol.endsWith('USDT') || symbol.endsWith('BTC'))) {
    if (p > 1000) return p.toFixed(2);
    if (p > 1)    return p.toFixed(4);
    return p.toFixed(6);
  }
  // Indices / stocks
  if (p > 10000) return p.toFixed(0);
  if (p > 100)   return p.toFixed(2);
  return p.toFixed(4);
}
