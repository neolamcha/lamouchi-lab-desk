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

const sourceMeta = [
  { key: 'tradingview', label: 'TradingView' },
  { key: 'feargreed', label: 'Fear&Greed' },
  { key: 'dom', label: 'DOM' },
  { key: 'orderflow', label: 'OrderFlow' },
  { key: 'vwap', label: 'VWAP' }
];

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setColor(id, color) {
  const el = document.getElementById(id);
  if (el) el.style.color = color;
}

function buildPortfolio(data) {
  const p = data.portfolio;
  const total = p.winCount + p.lossCount;
  const wr = total > 0 ? ((p.winCount / total) * 100).toFixed(1) : 0;
  setText('pf-balance', '$' + p.balance.toFixed(2));
  setText('pf-pl', (p.totalPL >= 0 ? '+' : '') + '$' + p.totalPL.toFixed(2));
  setColor('pf-pl', p.totalPL >= 0 ? 'var(--green)' : 'var(--red)');
  setText('pf-wr', wr + '%');
  setText('pf-trades', p.tradeCount);
}

function buildCards(data) {
  const grid = document.getElementById('dashboard');
  if (!grid) return;
  grid.innerHTML = '';
  const coins = data.topCoins || [];
  coins.forEach(function(coin) {
    const inst = data.instruments[coin];
    if (!inst) return;
    const card = document.createElement('article');
    card.className = 'instrument-card';
    card.id = 'card-' + coin;

    const pos = inst.position;
    const posLabel = pos ? (pos.side === 'BUY' ? '✅ LONG' : '🔻 SHORT') : '—';
    const posColor = pos ? (pos.side === 'BUY' ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)';
    const confClass = inst.confluence === 'BUY' ? 'bullish' : inst.confluence === 'SELL' ? 'bearish' : 'neutral';
    const confLabel = inst.confluence === 'BUY' ? '🟢 BUY' : inst.confluence === 'SELL' ? '🔴 SELL' : '⚪ NEUTRAL';

    let sourcesHtml = '';
    sourceMeta.forEach(function(src) {
      const val = (inst.sources[src.key] || 'NEUTRAL').toUpperCase();
      const c = val === 'BUY' ? 'var(--green)' : val === 'SELL' ? 'var(--red)' : 'var(--text-muted)';
      sourcesHtml += `<div class="indicator-item"><span class="ind-label">${src.label}</span><span class="ind-value" style="color:${c}">${val}</span></div>`;
    });

    const history = inst.history || [];
    const recentTrades = history.slice(0, 3).map(function(t) {
      const e = t.status === 'WIN' ? '✅' : '❌';
      return `<span style="font-size:10px;color:${t.status === 'WIN' ? 'var(--green)' : 'var(--red)'}">${e} $${t.pl?.toFixed(2) || '0'}</span>`;
    }).join(' ');

    card.innerHTML = `
      <div class="card-header">
        <h2><span class="ticker">${coin}</span> <span class="inst-name">${inst.name || coin}</span></h2>
        <div class="header-badges">
          <span class="regime-badge ${confClass}">${confLabel}</span>
          <span class="card-badge" style="color:${posLabel === '—' ? 'var(--text-muted)' : posColor}">${posLabel}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="price-section">
          <div class="price-main">
            <span class="price-label">PRIX</span>
            <span class="price-value" id="price-${coin}">${inst.price > 0 ? '$' + inst.price.toFixed(inst.price > 100 ? 2 : inst.price > 1 ? 4 : 6) : '--'}</span>
          </div>
          <div class="confluence-section">
            <span class="price-label">SCORE</span>
            <span class="confluence-score" style="color:${inst.confluenceScore > 0 ? 'var(--green)' : inst.confluenceScore < 0 ? 'var(--red)' : 'var(--text-muted)'}">${inst.confluenceScore}</span>
          </div>
        </div>
        <div class="indicators-row">${sourcesHtml}</div>
        <div class="levels-row" style="margin-top:6px;">
          ${pos ? `<div class="level-item sl-level"><span class="level-label">ENTRÉE</span><span class="level-value">$${pos.entryPrice?.toFixed(2)}</span></div>
          <div class="level-item sl-level"><span class="level-label">SL</span><span class="level-value">$${pos.sl?.toFixed(2)}</span></div>
          <div class="level-item tp-level"><span class="level-label">TP</span><span class="level-value">$${pos.tp?.toFixed(2)}</span></div>
          <div class="level-item atr-level"><span class="level-label">QTÉ</span><span class="level-value">${pos.qty}</span></div>` : '<div class="level-item" style="grid-column:span 4;text-align:center;color:var(--text-muted);font-size:11px">Aucune position ouverte</div>'}
        </div>
        ${recentTrades ? `<div class="indicators-row" style="margin-top:4px;justify-content:center;gap:8px">${recentTrades}</div>` : ''}
      </div>`;
    grid.appendChild(card);
  });
}

function updateState(data) {
  buildPortfolio(data);
  buildCards(data);
}

// ===== SSE =====
function connectSSE() {
  const evtSource = new EventSource('/api/events');
  evtSource.onmessage = function(e) {
    try {
      updateState(JSON.parse(e.data));
    } catch (err) { console.warn('SSE parse error', err); }
  };
  evtSource.onerror = function() {
    setTimeout(connectSSE, 3000);
  };
}
connectSSE();

// ===== TELEGRAM =====
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

// ===== RESET =====
document.getElementById('reset-btn')?.addEventListener('click', function() {
  fetch('/api/reset', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.success) { const s = document.getElementById('reset-status'); if (s) { s.textContent = '✅ Portfolio réinitialisé'; s.className = 'telegram-status success'; } }
  });
});
