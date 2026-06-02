// ========== PARTICLE BACKGROUND ==========
(function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];
  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  const COUNT = 80;
  for (let i = 0; i < COUNT; i++) {
    particles.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, r: Math.random() * 1.2 + 0.3, a: Math.random() * 0.3 + 0.1 });
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0; if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${p.a})`; ctx.fill();
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j], dx = p.x - q.x, dy = p.y - q.y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = `rgba(0, 240, 255, ${0.06 * (1 - dist / 140)})`; ctx.lineWidth = 0.5; ctx.stroke(); }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ========== CLOCK ==========
function updateClock() { const el = document.getElementById('clock'); if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour12: false }); }
updateClock();
setInterval(updateClock, 1000);

// ========== INSTRUMENT DEFINITIONS ==========
const instruments = [
  { key: 'MNQ', name: 'NASDAQ', ticker: 'MNQ' },
  { key: 'BTCM', name: 'BITCOIN', ticker: 'BTCM' },
  { key: 'GCM', name: 'GOLD', ticker: 'GCM' }
];

const sourceMeta = [
  { key: 'investing', label: 'Investing' },
  { key: 'tradingview', label: 'TradingView' },
  { key: 'topstep', label: 'Topstep' },
  { key: 'feargreed', label: 'Fear&Greed' },
  { key: 'coingecko', label: 'CoinGecko' },
  { key: 'btcls', label: 'Binance L/S' }
];

// ========== BUILD CARDS ==========
function buildCards() {
  const grid = document.getElementById('dashboard');
  if (!grid) return;
  grid.innerHTML = '';
  instruments.forEach(inst => {
    const card = document.createElement('article');
    card.className = 'instrument-card';
    card.id = 'card-' + inst.key;
    card.innerHTML = `
      <div class="card-header">
        <h2><span class="ticker">${inst.ticker}</span> <span class="inst-name">${inst.name}</span></h2>
        <div class="header-badges">
          <span id="regime-${inst.key}" class="regime-badge initializing">INIT</span>
          <span class="card-badge">FUTURES</span>
        </div>
      </div>
      <div class="card-body">
        <div class="price-section">
          <div class="price-main">
            <span class="price-label">PRIX LIVE</span>
            <span id="price-${inst.key}" class="price-value">--</span>
            <span id="topstep-ref-${inst.key}" class="topstep-ref"></span>
          </div>
          <div class="confluence-section">
            <span class="price-label">CONFLUENCE</span>
            <span id="confluence-${inst.key}" class="confluence-badge neutral">NEUTRAL</span>
            <span id="score-${inst.key}" class="confluence-score">0.0</span>
          </div>
        </div>
        <div class="levels-row">
          <div class="level-item sl-level"><span class="level-label">SL (ATR×<span id="sl-mult-${inst.key}">1.5</span>)</span><span id="sl-${inst.key}" class="level-value">--</span></div>
          <div class="level-item tp-level"><span class="level-label">TP (ATR×<span id="tp-mult-${inst.key}">3.0</span>)</span><span id="tp-${inst.key}" class="level-value">--</span></div>
          <div class="level-item atr-level"><span class="level-label">ATR</span><span id="atr-${inst.key}" class="level-value">--</span></div>
        </div>
          <div class="indicators-row">
          <div class="indicator-item"><span class="ind-label">Investing</span><span id="sig-investing-${inst.key}" class="ind-value">--</span></div>
          <div class="indicator-item"><span class="ind-label">TradingView</span><span id="sig-tradingview-${inst.key}" class="ind-value">--</span></div>
          <div class="indicator-item"><span class="ind-label">Topstep</span><span id="sig-topstep-${inst.key}" class="ind-value">--</span></div>
          <div class="indicator-item"><span class="ind-label">Fear&Greed</span><span id="sig-feargreed-${inst.key}" class="ind-value">--</span></div>
        </div>
        <div class="indicators-row" style="margin-top:4px;">
          <div class="indicator-item"><span class="ind-label">CoinGecko</span><span id="sig-coingecko-${inst.key}" class="ind-value">--</span></div>
          <div class="indicator-item"><span class="ind-label">Binance L/S</span><span id="sig-btcls-${inst.key}" class="ind-value">--</span></div>
        </div>
        <div class="indicators-row" style="margin-top:4px;">
          <div class="indicator-item"><span class="ind-label">ADX</span><span id="adx-${inst.key}" class="ind-value">--</span></div>
          <div class="indicator-item"><span class="ind-label">ATR</span><span id="atr-${inst.key}" class="ind-value">--</span></div>
        </div>
        <div class="sparkline-container">
          <canvas id="spark-${inst.key}" class="sparkline-canvas"></canvas>
        </div>
        <div class="sources-section">
          <div class="sources-header">
            <span class="price-label">SOURCES TECHNIQUES</span>
            <span class="sources-count" id="count-${inst.key}">0/5</span>
          </div>
          <div class="sources-grid" id="src-grid-${inst.key}"></div>
        </div>
        <div class="analytics-section">
          <div class="analytics-header">
            <span class="price-label">PERFORMANCE</span>
            <button class="analytics-reset-btn" onclick="resetAnalytics('${inst.key}')">✕</button>
          </div>
          <div class="analytics-grid">
            <div class="analytics-item"><span class="a-label">SIGNAUX</span><span id="sig-count-${inst.key}" class="a-value">0</span></div>
            <div class="analytics-item"><span class="a-label">WIN</span><span id="sig-wins-${inst.key}" class="a-value win">0</span></div>
            <div class="analytics-item"><span class="a-label">LOSS</span><span id="sig-losses-${inst.key}" class="a-value loss">0</span></div>
            <div class="analytics-item"><span class="a-label">WIN%</span><span id="sig-wr-${inst.key}" class="a-value">0%</span></div>
            <div class="analytics-item"><span class="a-label">P&L</span><span id="sig-pl-${inst.key}" class="a-value">0</span></div>
            <div class="analytics-item"><span class="a-label">AVG</span><span id="sig-avg-${inst.key}" class="a-value">0</span></div>
          </div>
        </div>
        <div class="risk-config">
          <div class="risk-header">
            <span class="price-label">RISK MANAGEMENT</span>
          </div>
          <div class="risk-grid">
            <div class="risk-item"><span class="r-label">BALANCE</span><span id="balance-${inst.key}" class="r-value">$100K</span></div>
            <div class="risk-item"><span class="r-label">RISK/TRADE</span><span id="risk-pct-${inst.key}" class="r-value">1.0%</span></div>
            <div class="risk-item"><span class="r-label">POSITION</span><span id="position-${inst.key}" class="r-value">--</span></div>
            <div class="risk-item"><span class="r-label">RISK $</span><span id="risk-usd-${inst.key}" class="r-value">$0</span></div>
          </div>
        </div>
        <div class="history-section">
          <div class="history-header">
            <span class="price-label">HISTORIQUE</span>
          </div>
          <div class="history-scroll">
            <table class="history-table" id="history-${inst.key}">
              <thead><tr><th>HEURE</th><th>DIR</th><th>ENTRÉE</th><th>SL</th><th>TP</th><th>STATUS</th><th>P&L%</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);

    // Build source grid
    const srcGrid = document.getElementById('src-grid-' + inst.key);
    sourceMeta.forEach(src => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.id = 'src-' + src.key + '-' + inst.key;
      item.innerHTML = `<span class="src-name">${src.label}</span><span class="src-indicator neutral"></span><span class="src-value neutral">NEUTRAL</span>`;
      srcGrid.appendChild(item);
    });
  });
}

buildCards();

// ========== SSE CONNECTION ==========
var prevConfluences = {};
const eventSource = new EventSource('/api/events');

eventSource.onopen = function() {
  const dot = document.getElementById('connection-status');
  if (dot) dot.className = 'status-dot live';
};

eventSource.onerror = function() {
  const dot = document.getElementById('connection-status');
  if (dot) dot.className = 'status-dot disconnected';
};

eventSource.onmessage = function(e) {
  try {
    const data = JSON.parse(e.data);
    const insts = data.instruments;
    if (!insts) return;

    if (data.telegramConfig && data.telegramConfig.enabled) {
      const btn = document.getElementById('telegram-toggle-btn');
      if (btn) btn.textContent = '✅ TELEGRAM';
    }

    Object.entries(insts).forEach(function([key, inst]) {
      updatePrice(key, inst.price);
      updateRegime(key, inst.regime);
      updateIndicators(key, inst.indicators);
      updateSourceIndicatorRow(key, inst.sources);
      updateLevels(key, inst);
      updateSourceAll(key, inst.sources);
      updateSourcesCount(key, inst.sources);
      updateConfluence(key, inst.confluence, inst);
      updateScore(key, inst.confluenceScore);
      updateSparkline(key, inst.priceHistory);
      updateAnalytics(key, inst.analytics);
      updateRisk(key, inst.settings, inst.price);
      updateHistory(key, inst.history);

      const refEl = document.getElementById('topstep-ref-' + key);
      if (refEl && inst.settings && inst.settings.topstepRef) {
        refEl.textContent = 'TOPSTEP REF ' + inst.settings.topstepRef.toFixed(2);
      }
    });
  } catch (err) {
    console.error('[SSE]', err);
  }
};

// ========== UPDATE FUNCTIONS ==========
function updatePrice(key, newPrice) {
  const el = document.getElementById('price-' + key);
  if (!el) return;
  const oldVal = parseFloat(el.textContent);
  const newVal = typeof newPrice === 'number' ? newPrice : parseFloat(newPrice);
  if (!isNaN(oldVal) && !isNaN(newVal) && oldVal !== newVal) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(newVal > oldVal ? 'flash-up' : 'flash-down');
  }
  el.textContent = typeof newPrice === 'number' ? newPrice.toFixed(2) : newPrice;
}

function updateRegime(key, regime) {
  const el = document.getElementById('regime-' + key);
  if (!el || !regime) return;
  const dir = regime.direction || 'NEUTRAL';
  const reg = regime.regime || 'INIT';
  let cls = 'initializing';
  if (reg.includes('TRENDING') && dir === 'BULLISH') cls = 'bullish';
  else if (reg.includes('TRENDING') && dir === 'BEARISH') cls = 'bearish';
  else if (reg.includes('VOLATILE')) cls = 'volatile';
  else if (reg === 'RANGING') cls = 'ranging';
  el.className = 'regime-badge ' + cls;
  el.textContent = reg + ' ' + (dir !== 'NEUTRAL' ? dir : '');
}

function updateIndicators(key, ind) {
  setText('adx-' + key, ind && ind.adx !== undefined ? ind.adx.toFixed(1) : '--');
  setText('atr-' + key, ind && ind.atr ? ind.atr.toFixed(2) : '--');
}

function updateLevels(key, inst) {
  if (!inst.settings || typeof inst.price !== 'number') return;
  var minAtr = { MNQ: 15, BTCM: 400, GCM: 8 }[key] || 1;
  var rawAtr = (inst.indicators && inst.indicators.atr) || 1;
  var atrUsed = Math.max(rawAtr, minAtr);
  var slOff = atrUsed * (inst.settings.atrMultiplierSL || 1.5);
  var tpOff = atrUsed * (inst.settings.atrMultiplierTP || 3.0);
  setText('sl-' + key, (inst.price - slOff).toFixed(2));
  setText('tp-' + key, (inst.price + tpOff).toFixed(2));
  setText('sl-mult-' + key, inst.settings.atrMultiplierSL || 1.5);
  setText('tp-mult-' + key, inst.settings.atrMultiplierTP || 3.0);
}

function updateSourceIndicatorRow(key, sources) {
  sourceMeta.forEach(function(src) {
    const el = document.getElementById('sig-' + src.key + '-' + key);
    if (!el) return;
    const val = (sources[src.key] || 'NEUTRAL').toLowerCase();
    const isBuy = val === 'buy';
    const isSell = val === 'sell';
    el.textContent = val.toUpperCase();
    el.style.color = isBuy ? 'var(--green)' : isSell ? 'var(--red)' : 'var(--text-muted)';
  });
}

function updateSourceAll(key, sources) {
  sourceMeta.forEach(src => {
    const el = document.getElementById('src-' + src.key + '-' + key);
    if (!el) return;
    const val = (sources[src.key] || 'NEUTRAL').toLowerCase();
    el.className = 'source-item';
    if (val === 'buy') el.classList.add('buy-active');
    if (val === 'sell') el.classList.add('sell-active');
    const indicator = el.querySelector('.src-indicator');
    const valueSpan = el.querySelector('.src-value');
    if (indicator) { indicator.className = 'src-indicator ' + val; }
    if (valueSpan) { valueSpan.className = 'src-value ' + val; valueSpan.textContent = val.toUpperCase(); }
  });
}

function updateSourcesCount(key, sources) {
  const el = document.getElementById('count-' + key);
  if (!el) return;
  const buyCount = Object.values(sources).filter(v => v === 'BUY').length;
  const sellCount = Object.values(sources).filter(v => v === 'SELL').length;
  el.textContent = buyCount + 'B · ' + sellCount + 'S';
  el.style.color = buyCount >= 3 ? 'var(--green)' : sellCount >= 3 ? 'var(--red)' : 'var(--text-muted)';
}

function updateConfluence(key, value, inst) {
  const el = document.getElementById('confluence-' + key);
  if (!el) return;
  const prev = prevConfluences[key];
  prevConfluences[key] = value;
  el.textContent = value;
  el.className = 'confluence-badge ' + value.toLowerCase();
  const card = document.getElementById('card-' + key);
  if (card) {
    card.className = 'instrument-card';
    if (value === 'BUY') card.classList.add('buy-confluence');
    else if (value === 'SELL') card.classList.add('sell-confluence');
  }
  if (value !== 'NEUTRAL' && prev === 'NEUTRAL' && inst) {
    showSignalNotification(key, value, inst);
  }
}

function updateScore(key, score) {
  const el = document.getElementById('score-' + key);
  if (!el) return;
  el.textContent = score !== undefined ? score.toFixed(1) : '0.0';
  el.style.color = score >= 3 ? 'var(--green)' : score <= -3 ? 'var(--red)' : 'var(--text-muted)';
}

function updateSparkline(key, priceHistory) {
  const canvas = document.getElementById('spark-' + key);
  if (!canvas || !priceHistory || priceHistory.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...priceHistory), max = Math.max(...priceHistory), range = max - min || 1, len = priceHistory.length, pad = 2;
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.03)'; ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) { const y = pad + (i / 3) * (h - pad * 2); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke(); }
  const isUp = priceHistory[len - 1] >= priceHistory[0];
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, isUp ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 51, 85, 0.2)');
  gradient.addColorStop(1, isUp ? 'rgba(0, 255, 136, 0.0)' : 'rgba(255, 51, 85, 0.0)');
  ctx.beginPath(); ctx.moveTo(pad, h - pad);
  for (let i = 0; i < len; i++) { const x = pad + (i / (len - 1)) * (w - pad * 2), y = pad + ((max - priceHistory[i]) / range) * (h - pad * 2); ctx.lineTo(x, y); }
  ctx.lineTo(pad + (w - pad * 2), h - pad); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < len; i++) { const x = pad + (i / (len - 1)) * (w - pad * 2), y = pad + ((max - priceHistory[i]) / range) * (h - pad * 2); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.strokeStyle = isUp ? '#00ff88' : '#ff3355'; ctx.lineWidth = 1.5; ctx.shadowColor = isUp ? '#00ff88' : '#ff3355'; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0;
  const lastX = pad + ((len - 1) / (len - 1)) * (w - pad * 2), lastY = pad + ((max - priceHistory[len - 1]) / range) * (h - pad * 2);
  ctx.beginPath(); ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2); ctx.fillStyle = isUp ? '#00ff88' : '#ff3355'; ctx.shadowColor = isUp ? '#00ff88' : '#ff3355'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
}

function updateAnalytics(key, analytics) {
  if (!analytics) return;
  setText('sig-count-' + key, analytics.totalSignals || 0);
  setText('sig-wins-' + key, analytics.wins || 0);
  setText('sig-losses-' + key, analytics.losses || 0);
  setText('sig-wr-' + key, (analytics.winRate || 0) + '%');
  const pl = analytics.totalPL || 0;
  const plEl = document.getElementById('sig-pl-' + key);
  if (plEl) { plEl.textContent = pl.toFixed(1) + '%'; plEl.style.color = pl >= 0 ? 'var(--green)' : 'var(--red)'; }
  setText('sig-avg-' + key, (analytics.avgReturn || 0) + '%');
}

function updateRisk(key, settings, price) {
  if (!settings) return;
  const balance = settings.accountBalance || 100000;
  const riskPct = settings.riskPercent || 1.0;
  setText('balance-' + key, '$' + (balance >= 1000 ? Math.round(balance / 1000) + 'K' : balance));
  setText('risk-pct-' + key, riskPct + '%');
  if (price) {
    const atrEl = document.getElementById('atr-' + key);
    const atr = parseFloat(atrEl ? atrEl.textContent : 0) || 1;
    const slDist = atr * (settings.atrMultiplierSL || 1.5);
    const riskPerUnit = slDist;
    const maxRisk = balance * (riskPct / 100);
    const qty = riskPerUnit > 0 ? Math.max(1, Math.floor(maxRisk / riskPerUnit)) : 1;
    setText('position-' + key, qty);
    setText('risk-usd-' + key, '$' + Math.round(maxRisk));
  }
}

function updateHistory(key, history) {
  const table = document.getElementById('history-' + key);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody || !history) return;
  tbody.innerHTML = '';
  history.slice(0, 50).forEach(function(sig) {
    const tr = document.createElement('tr');
    const dirColor = sig.direction === 'BUY' ? '#00ff88' : '#ff3355';
    let statusColor = '#6b7280';
    if (sig.status === 'WIN') statusColor = '#00ff88';
    else if (sig.status === 'LOSS') statusColor = '#ff3355';
    else if (sig.status === 'ACTIVE') statusColor = '#00f0ff';
    tr.innerHTML =
      '<td>' + new Date(sig.timestamp).toLocaleTimeString('fr-FR', { hour12: false }) + '</td>' +
      '<td style="color:' + dirColor + ';font-weight:600">' + sig.direction + '</td>' +
      '<td>' + (sig.entryPrice || '--') + '</td>' +
      '<td>' + (sig.stopLoss || '--') + '</td>' +
      '<td>' + (sig.takeProfit || '--') + '</td>' +
      '<td style="color:' + statusColor + '">' + (sig.status || 'PENDING') + '</td>' +
      '<td style="color:' + ((sig.pl || 0) >= 0 ? '#00ff88' : '#ff3355') + '">' + (sig.pl !== null ? sig.pl.toFixed(2) + '%' : '--') + '</td>';
    tbody.appendChild(tr);
  });
}

// ========== SIGNAL NOTIFICATION ==========
function showSignalNotification(instKey, direction, inst) {
  var el = document.getElementById('signal-notification');
  if (!el) return;
  var instName = { MNQ: 'NASDAQ', BTCM: 'BITCOIN', GCM: 'GOLD' }[instKey] || instKey;
  var icon = direction === 'BUY' ? '🟢' : '🔴';
  var cls = direction === 'BUY' ? 'buy' : 'sell';
  var minAtr = { MNQ: 15, BTCM: 400, GCM: 8 }[instKey] || 1;
  var rawAtr = (inst.indicators && inst.indicators.atr) || 1;
  var atrUsed = Math.max(rawAtr, minAtr);
  var slOff = atrUsed * (inst.settings.atrMultiplierSL || 1.5);
  var tpOff = atrUsed * (inst.settings.atrMultiplierTP || 3.0);
  var sl = direction === 'BUY' ? (inst.price - slOff) : (inst.price + slOff);
  var tp = direction === 'BUY' ? (inst.price + tpOff) : (inst.price - tpOff);
  var score = inst.confluenceScore || 0;
  var regime = inst.regime ? (inst.regime.regime + ' ' + (inst.regime.direction || '')) : '';
  el.innerHTML =
    '<div class="notif-card ' + cls + '-notif">' +
      '<button class="notif-close" onclick="this.parentElement.parentElement.classList.remove(\'show\')">✕</button>' +
      '<div class="notif-header">' +
        '<span class="notif-icon">' + icon + '</span>' +
        '<span class="notif-title">' + instName + ' · CONFLUENCE</span>' +
      '</div>' +
      '<div class="notif-direction ' + cls + '">' + direction + '</div>' +
      '<div class="notif-score" style="font-size:0.65rem;color:#6b7280;font-family:var(--font-mono);margin-top:0.25rem;">Score: ' + score + ' · ' + regime + '</div>' +
      '<div class="notif-details">' +
        '<div class="notif-item"><span class="label">ENTRÉE</span><span class="value entry">' + inst.price.toFixed(2) + '</span></div>' +
        '<div class="notif-item"><span class="label">STOP LOSS</span><span class="value sl">' + sl.toFixed(2) + '</span></div>' +
        '<div class="notif-item"><span class="label">TAKE PROFIT</span><span class="value tp">' + tp.toFixed(2) + '</span></div>' +
      '</div>' +
    '</div>';
  el.className = 'signal-notification show';
  setTimeout(function() { el.classList.remove('show'); }, 6000);
}

// ========== HELPERS ==========
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ========== CONFIG FORM ==========
const configForm = document.getElementById('config-form');
if (configForm) {
  const instrumentSelect = document.getElementById('instrument-select');
  if (instrumentSelect) {
    instrumentSelect.addEventListener('change', function() {
      configForm.dataset.instrument = this.value;
    });
  }
  configForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const form = e.target;
    const instrument = form.dataset.instrument || 'MNQ';
    const payload = {
      webhookUrl: form.webhookUrl.value,
      atrMultiplierSL: form.atrMultiplierSL ? form.atrMultiplierSL.value : 1.5,
      atrMultiplierTP: form.atrMultiplierTP ? form.atrMultiplierTP.value : 3.0,
      mode: form.mode.value,
      calibrationOffset: form.calibrationOffset ? form.calibrationOffset.value : 0
    };
    fetch('/api/config/' + instrument, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function(res) { if (!res.ok) alert('Erreur'); }).catch(function(err) { alert('Erreur réseau: ' + err.message); });
  });
}

// ========== TELEGRAM ==========
const telegramToggleBtn = document.getElementById('telegram-toggle-btn');
const telegramPanel = document.getElementById('telegram-panel');
if (telegramToggleBtn && telegramPanel) {
  telegramToggleBtn.addEventListener('click', function() {
    telegramPanel.style.display = telegramPanel.style.display === 'none' ? 'block' : 'none';
  });
}

const telegramForm = document.getElementById('telegram-form');
if (telegramForm) {
  telegramForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const payload = { botToken: telegramForm.botToken.value, chatId: telegramForm.chatId.value, enabled: telegramForm.telegramEnabled.value === 'true' };
    fetch('/api/telegram-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        const status = document.getElementById('telegram-status');
        if (status) { status.textContent = payload.enabled ? '✅ Sauvegardé — Alertes actives' : 'ℹ️ Sauvegardé — Désactivé'; status.className = 'telegram-status success'; }
        telegramForm.botToken.value = '';
      }).catch(function(err) {
        const status = document.getElementById('telegram-status');
        if (status) { status.textContent = '❌ ' + err.message; status.className = 'telegram-status error'; }
      });
  });
}

const testTelegramBtn = document.getElementById('test-telegram-btn');
if (testTelegramBtn) {
  testTelegramBtn.addEventListener('click', function() {
    const status = document.getElementById('telegram-status');
    if (status) { status.textContent = '📨 Envoi...'; status.className = 'telegram-status'; }
    fetch('/api/test-telegram', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (status) { status.textContent = d.success ? '✅ ' + d.message : '❌ ' + d.error; status.className = d.success ? 'telegram-status success' : 'telegram-status error'; }
      }).catch(function(err) {
        if (status) { status.textContent = '❌ ' + err.message; status.className = 'telegram-status error'; }
      });
  });
}

// Load Telegram config on startup
fetch('/api/telegram-config').then(function(r) { return r.json(); }).then(function(d) {
  if (d.hasBotToken && d.hasChatId) {
    const btn = document.getElementById('telegram-toggle-btn');
    if (btn) btn.textContent = d.enabled ? '✅ TELEGRAM' : '⚙ TELEGRAM';
  }
});

// ========== RESET ANALYTICS ==========
function resetAnalytics(key) {
  if (!confirm('Réinitialiser les stats P&L pour ' + key + ' ?')) return;
  fetch('/api/reset-analytics/' + key, { method: 'POST' }).catch(function(err) { console.error(err); });
}
