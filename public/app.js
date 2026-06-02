// ========== PARTICLE BACKGROUND ==========
(function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COUNT = 80;
  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.3 + 0.1
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${p.a})`;
      ctx.fill();
      // connections
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0, 240, 255, ${0.06 * (1 - dist / 140)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ========== CLOCK ==========
function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

// ========== UPDATE SOURCE ==========
function updateSource(instKey, srcKey, value) {
  const el = document.getElementById('src-' + srcKey + '-' + instKey);
  if (!el) return;
  const indicator = el.querySelector('.src-indicator');
  const valSpan = el.querySelector('.src-value');
  const cls = String(value).toLowerCase();
  el.className = 'source-item';
  if (cls === 'buy') el.classList.add('buy-active');
  if (cls === 'sell') el.classList.add('sell-active');
  indicator.className = 'src-indicator ' + cls;
  valSpan.className = 'src-value ' + cls;
  valSpan.textContent = value;
}

// ========== UPDATE SOURCES COUNT ==========
function updateSourcesCount(instKey, sources) {
  const el = document.getElementById('count-' + instKey);
  if (!el) return;
  const buyCount = Object.values(sources).filter(v => v === 'BUY').length;
  el.textContent = buyCount + '/5 BUY';
}

// ========== RENDER SPARKLINE ==========
function renderSparkline(instKey, priceHistory) {
  const canvas = document.getElementById('spark-' + instKey);
  if (!canvas || !priceHistory || priceHistory.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...priceHistory);
  const max = Math.max(...priceHistory);
  const range = max - min || 1;
  const len = priceHistory.length;
  const pad = 2;

  // Grid lines
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.03)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) {
    const y = pad + (i / 3) * (h - pad * 2);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  const isUp = priceHistory[len - 1] >= priceHistory[0];
  if (isUp) {
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0.0)');
  } else {
    gradient.addColorStop(0, 'rgba(255, 51, 85, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 51, 85, 0.0)');
  }

  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  for (let i = 0; i < len; i++) {
    const x = pad + (i / (len - 1)) * (w - pad * 2);
    const y = pad + ((max - priceHistory[i]) / range) * (h - pad * 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(pad + (w - pad * 2), h - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = pad + (i / (len - 1)) * (w - pad * 2);
    const y = pad + ((max - priceHistory[i]) / range) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = isUp ? '#00ff88' : '#ff3355';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = isUp ? '#00ff88' : '#ff3355';
  ctx.shadowBlur = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dot at end
  const lastX = pad + ((len - 1) / (len - 1)) * (w - pad * 2);
  const lastY = pad + ((max - priceHistory[len - 1]) / range) * (h - pad * 2);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = isUp ? '#00ff88' : '#ff3355';
  ctx.shadowColor = isUp ? '#00ff88' : '#ff3355';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ========== UPDATE PRICE ==========
function updatePrice(instKey, newPrice, oldText) {
  const el = document.getElementById('price-' + instKey);
  if (!el) return;
  const oldVal = parseFloat(oldText);
  const newVal = parseFloat(newPrice);
  if (!isNaN(oldVal) && !isNaN(newVal) && oldVal !== newVal) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(newVal > oldVal ? 'flash-up' : 'flash-down');
  }
  el.textContent = typeof newPrice === 'number' ? newPrice.toFixed(2) : newPrice;
}

// ========== UPDATE CONFLUENCE ==========
function updateConfluence(instKey, value, inst) {
  const el = document.getElementById('confluence-' + instKey);
  if (!el) return;
  const prev = prevConfluences[instKey];
  prevConfluences[instKey] = value;
  el.textContent = value;
  el.className = 'confluence-badge ' + value.toLowerCase();
  // Card border
  const card = document.getElementById('card-' + instKey);
  if (card) {
    card.className = 'instrument-card';
    if (value === 'BUY') card.classList.add('buy-confluence');
    else if (value === 'SELL') card.classList.add('sell-confluence');
  }
  // Détection de nouveau signal
  if (value !== 'NEUTRAL' && prev === 'NEUTRAL' && inst) {
    const slOff = (inst.settings?.stopLossTicks || 80) * 0.25;
    const tpOff = (inst.settings?.takeProfitTicks || 160) * 0.25;
    const sl = value === 'BUY' ? (inst.price - slOff) : (inst.price + slOff);
    const tp = value === 'BUY' ? (inst.price + tpOff) : (inst.price - tpOff);
    showSignalNotification(instKey, value, inst.price.toFixed(2), sl.toFixed(2), tp.toFixed(2));
  }
}

// ========== SIGNAL NOTIFICATION ==========
var prevConfluences = {};

function showSignalNotification(instKey, direction, price, sl, tp) {
  var el = document.getElementById('signal-notification');
  if (!el) return;
  var instName = { MNQ: 'NASDAQ', BTCM: 'BITCOIN', GCM: 'GOLD' }[instKey] || instKey;
  var icon = direction === 'BUY' ? '🟢' : '🔴';
  var cls = direction === 'BUY' ? 'buy' : 'sell';
  el.innerHTML =
    '<div class="notif-card ' + cls + '-notif">' +
      '<button class="notif-close" onclick="this.parentElement.parentElement.classList.remove(\'show\')">✕</button>' +
      '<div class="notif-header">' +
        '<span class="notif-icon">' + icon + '</span>' +
        '<span class="notif-title">' + instName + ' · CONFLUENCE</span>' +
      '</div>' +
      '<div class="notif-direction ' + cls + '">' + direction + '</div>' +
      '<div class="notif-details">' +
        '<div class="notif-item"><span class="label">ENTRÉE</span><span class="value entry">' + price + '</span></div>' +
        '<div class="notif-item"><span class="label">STOP LOSS</span><span class="value sl">' + sl + '</span></div>' +
        '<div class="notif-item"><span class="label">TAKE PROFIT</span><span class="value tp">' + tp + '</span></div>' +
      '</div>' +
    '</div>';
  el.className = 'signal-notification show';
  setTimeout(function() { el.classList.remove('show'); }, 5000);
}

// ========== SSE CONNECTION ==========
const eventSource = new EventSource('/api/events');

eventSource.onopen = function() {
  const dot = document.getElementById('connection-status');
  if (dot) { dot.className = 'status-dot live'; }
};

eventSource.onerror = function() {
  const dot = document.getElementById('connection-status');
  if (dot) { dot.className = 'status-dot disconnected'; }
};

eventSource.onmessage = function(e) {
  try {
    const data = JSON.parse(e.data);
    const instruments = data.instruments;
    if (!instruments) return;

    // Email config status
    if (data.emailConfig && data.emailConfig.enabled) {
      const emailToggleBtn = document.getElementById('email-toggle-btn');
      if (emailToggleBtn) emailToggleBtn.textContent = '✅ EMAIL';
    }

    Object.entries(instruments).forEach(function([key, inst]) {
      // Price with flash
      const oldPriceEl = document.getElementById('price-' + key);
      updatePrice(key, inst.price, oldPriceEl ? oldPriceEl.textContent : '--');

      // Topstep reference price
      const refEl = document.getElementById('topstep-ref-' + key);
      if (refEl && inst.settings && inst.settings.topstepRef) {
        refEl.textContent = 'TOPSTEP REF ' + inst.settings.topstepRef.toFixed(2);
      }

      // Confluence
      updateConfluence(key, inst.confluence, inst);

      // Sources
      updateSource(key, 'investing', inst.sources.investing);
      updateSource(key, 'tradingview', inst.sources.tradingview);
      updateSource(key, 'strategy', inst.sources.strategy);
      updateSource(key, 'extra', inst.sources.extra);
      updateSource(key, 'alphavantage', inst.sources.alphavantage);

      // Sources count
      updateSourcesCount(key, inst.sources);

      // Sparkline
      renderSparkline(key, inst.priceHistory);

      // History table
      const tableEl = document.getElementById('history-' + key);
      if (tableEl) {
        const tbody = tableEl.querySelector('tbody');
        if (tbody && inst.history) {
          tbody.innerHTML = '';
          inst.history.forEach(function(sig) {
            const tr = document.createElement('tr');
            tr.innerHTML =
              '<td>' + new Date(sig.timestamp).toLocaleTimeString('fr-FR', { hour12: false }) + '</td>' +
              '<td style="color:' + (sig.direction === 'BUY' ? '#00ff88' : '#ff3355') + ';font-weight:600">' + sig.direction + '</td>' +
              '<td>' + sig.entryPrice + '</td>' +
              '<td>' + sig.stopLoss + '</td>' +
              '<td>' + sig.takeProfit + '</td>' +
              '<td style="font-size:0.55rem">' + sig.webhookStatus + '</td>';
            tbody.appendChild(tr);
          });
        }
      }
    });
  } catch (err) {
    console.error('[SSE] Parse error:', err);
  }
};

// ========== INSTRUMENT SELECTOR ==========
const instrumentSelect = document.getElementById('instrument-select');
if (instrumentSelect) {
  instrumentSelect.addEventListener('change', function() {
    const form = document.getElementById('config-form');
    if (form) form.dataset.instrument = this.value;
  });
}

// ========== CONFIG FORM ==========
const configForm = document.getElementById('config-form');
if (configForm) {
  configForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const form = e.target;
    const instrument = form.dataset.instrument || 'MNQ';
    const payload = {
      webhookUrl: form.webhookUrl.value,
      stopLossTicks: form.stopLossTicks.value,
      takeProfitTicks: form.takeProfitTicks.value,
      mode: form.mode.value,
      calibrationOffset: form.calibrationOffset ? form.calibrationOffset.value : 0
    };
    fetch('/api/config/' + instrument, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res) {
      if (!res.ok) alert('Erreur lors de la sauvegarde');
    }).catch(function(err) {
      alert('Erreur réseau: ' + err.message);
    });
  });
}

// ========== EMAIL PANEL TOGGLE ==========
const emailToggleBtn = document.getElementById('email-toggle-btn');
const emailPanel = document.getElementById('email-panel');
if (emailToggleBtn && emailPanel) {
  emailToggleBtn.addEventListener('click', function() {
    const isHidden = emailPanel.style.display === 'none';
    emailPanel.style.display = isHidden ? 'block' : 'none';
  });
}

// ========== EMAIL FORM ==========
const emailForm = document.getElementById('email-form');
if (emailForm) {
  emailForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const payload = {
      enabled: emailForm.emailEnabled.value === 'true',
      to: emailForm.emailTo.value,
      from: emailForm.emailFrom.value,
      password: emailForm.emailPassword.value
    };
    fetch('/api/email-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res) {
      return res.json();
    }).then(function(data) {
      const status = document.getElementById('email-status');
      if (status) {
        status.textContent = '✅ Configuration sauvegardée' + (payload.enabled ? ' — Alertes actives' : '');
        status.className = 'email-status success';
        emailForm.emailPassword.value = '';
      }
    }).catch(function(err) {
      const status = document.getElementById('email-status');
      if (status) { status.textContent = '❌ ' + err.message; status.className = 'email-status error'; }
    });
  });
}

// ========== TEST EMAIL ==========
const testEmailBtn = document.getElementById('test-email-btn');
if (testEmailBtn) {
  testEmailBtn.addEventListener('click', function() {
    const status = document.getElementById('email-status');
    if (status) { status.textContent = '📨 Envoi en cours...'; status.className = 'email-status'; }
    fetch('/api/test-email', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          if (status) { status.textContent = '✅ ' + d.message; status.className = 'email-status success'; }
        } else {
          if (status) { status.textContent = '❌ ' + d.error; status.className = 'email-status error'; }
        }
      })
      .catch(function(err) {
        if (status) { status.textContent = '❌ ' + err.message; status.className = 'email-status error'; }
      });
  });
}

// ========== UPDATE EMAIL CONFIG FROM SSE ==========
// (handled in the SSE onmessage already - emailConfig is in the state data)

// ========== RESIZE SPARKLINES ==========
window.addEventListener('resize', function() {
  // Will be redrawn on next SSE tick
});