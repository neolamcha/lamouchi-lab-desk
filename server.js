const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let lastYahooPrice = 30535.50; // Prix de référence Yahoo Finance

// État global de l'application
let appState = {
  instruments: {
    MNQ: {
      price: 30535.50,
      sources: {
        investing: 'NEUTRAL',
        tradingview: 'NEUTRAL',
        strategy: 'NEUTRAL',
        extra: 'NEUTRAL',
        alphavantage: 'NEUTRAL'
      },
      confluence: 'NEUTRAL',
      settings: {
        webhookUrl: '',
        stopLossTicks: 80,
        takeProfitTicks: 160,
        mode: 'simulation',
        calibrationOffset: 0
      },
      history: [],
      priceHistory: []
    },
    BTCM: {
      price: 25000.00,
      sources: {
        investing: 'NEUTRAL',
        tradingview: 'NEUTRAL',
        strategy: 'NEUTRAL',
        extra: 'NEUTRAL',
        alphavantage: 'NEUTRAL'
      },
      confluence: 'NEUTRAL',
      settings: {
        webhookUrl: '',
        stopLossTicks: 80,
        takeProfitTicks: 160,
        mode: 'simulation',
        calibrationOffset: 0
      },
      history: [],
      priceHistory: []
    },
    GCM: {
      price: 1800.00,
      sources: {
        investing: 'NEUTRAL',
        tradingview: 'NEUTRAL',
        strategy: 'NEUTRAL',
        extra: 'NEUTRAL',
        alphavantage: 'NEUTRAL'
      },
      confluence: 'NEUTRAL',
      settings: {
        webhookUrl: '',
        stopLossTicks: 80,
        takeProfitTicks: 160,
        mode: 'simulation',
        calibrationOffset: 0
      },
      history: [],
      priceHistory: []
    }
  }
};

// Liste des clients abonnés au flux Server-Sent Events (SSE) pour le temps réel
let clients = [];

// Configuration email globale
let emailConfig = {
  enabled: true,
  to: 'selim.uchiha1892@gmail.com',
  from: 'selim.uchiha1892@gmail.com',
  password: 'ktkh xktg qpek diax',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587
};

// Fonction pour envoyer des mises à jour en direct à tous les clients connectés
function broadcastState() {
  const data = JSON.stringify({
    instruments: appState.instruments,
    emailConfig: { enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password }
  });
  clients.forEach(client => client.write(`data: ${data}\n\n`));
}

// Évalue la confluence pour un instrument donné
function evaluateConfluence(instrKey) {
  const src = appState.instruments[instrKey].sources;
  // Determine if all sources agree on BUY or SELL
  const values = Object.values(src);
  const allBuy = values.every(v => v === 'BUY');
  const allSell = values.every(v => v === 'SELL');
  const newConfluence = allBuy ? 'BUY' : allSell ? 'SELL' : 'NEUTRAL';
  if (newConfluence !== appState.instruments[instrKey].confluence) {
    appState.instruments[instrKey].confluence = newConfluence;
    if (newConfluence !== 'NEUTRAL') {
      triggerSignal(instrKey, newConfluence);
    }
  }
}

// Déclenchement et enregistrement d'un nouveau signal de trading pour un instrument
async function triggerSignal(instrKey, direction) {
  const entryPrice = appState.instruments[instrKey].price;
  const slOffset = (appState.instruments[instrKey].settings.stopLossTicks * 0.25);
  const tpOffset = (appState.instruments[instrKey].settings.takeProfitTicks * 0.25);
  const stopLoss = direction === 'BUY' ? (entryPrice - slOffset) : (entryPrice + slOffset);
  const takeProfit = direction === 'BUY' ? (entryPrice + tpOffset) : (entryPrice - tpOffset);
  const signalEvent = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    instrument: instrKey,
    direction,
    entryPrice: entryPrice.toFixed(2),
    stopLoss: stopLoss.toFixed(2),
    takeProfit: takeProfit.toFixed(2),
    webhookStatus: 'PENDING'
  };

  console.log(`[CONFLUENCE SIGNAL] ${direction} triggered at ${entryPrice} | SL: ${stopLoss} | TP: ${takeProfit}`);

  // Envoi du Webhook si configuré
  if (appState.instruments[instrKey].settings.webhookUrl) {
    try {
      signalEvent.webhookStatus = 'SENDING';
      broadcastState();

      const response = await fetch(appState.instruments[instrKey].settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: direction === 'BUY' ? 'buy' : 'sell',
          ticker: instrKey,
          quantity: 1,
          price: entryPrice,
          stopLoss: stopLoss,
          takeProfit: takeProfit,
          comment: 'Confluence Nasdaq Signal',
          timestamp: signalEvent.timestamp
        })
      });

      if (response.ok) {
        signalEvent.webhookStatus = 'SUCCESS';
        console.log(`[Webhook] Signal transmis avec succès à ${appState.instruments[instrKey].settings.webhookUrl}`);
      } else {
        signalEvent.webhookStatus = 'FAILED';
        console.warn(`[Webhook] Échec de transmission. Code HTTP : ${response.status}`);
      }
    } catch (error) {
      signalEvent.webhookStatus = 'ERROR';
      console.error(`[Webhook Error] Impossible d'envoyer le webhook :`, error.message);
    }
  } else {
    signalEvent.webhookStatus = 'NOT_CONFIGURED';
  }

  // Envoi d'email si configuré
  if (emailConfig.enabled && emailConfig.password) {
    try {
      await sendSignalEmail(signalEvent, instrKey);
    } catch (err) {
      console.error('[Email Error]', err.message);
    }
  }

  broadcastState();
}

// Envoi d'email de signal
async function sendSignalEmail(signal, instrKey) {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    secure: false,
    auth: { user: emailConfig.from, pass: emailConfig.password }
  });

  const instrName = { MNQ: 'NASDAQ (MNQ)', BTCM: 'BITCOIN (BTCM)', GCM: 'GOLD (GCM)' }[instrKey] || instrKey;
  const emoji = signal.direction === 'BUY' ? '🟢' : '🔴';
  const date = new Date(signal.timestamp).toLocaleString('fr-FR');

  const html = `
    <div style="font-family: 'Inter', sans-serif; background:#0a0e1a; padding:24px; border-radius:12px;">
      <div style="border-bottom:2px solid #00f0ff; padding-bottom:12px; margin-bottom:20px;">
        <h1 style="color:#00f0ff; margin:0; font-size:22px; letter-spacing:2px;">⚡ LAMOUCHI LAB DESK</h1>
        <p style="color:#6b7280; margin:4px 0 0; font-size:12px;">ALERTE CONFLUENCE · ${date}</p>
      </div>
      <div style="text-align:center; padding:20px; background:rgba(0,240,255,0.05); border-radius:8px; margin-bottom:20px;">
        <span style="font-size:48px;">${emoji}</span>
        <h2 style="color:${signal.direction === 'BUY' ? '#00ff88' : '#ff3355'}; font-size:28px; margin:8px 0;">${signal.direction}</h2>
        <p style="color:#e8e8f0; font-size:14px; margin:0;">${instrName}</p>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr>
          <td style="padding:10px; color:#6b7280; border-bottom:1px solid #1a1f2e;">ENTRÉE</td>
          <td style="padding:10px; color:#e8e8f0; font-weight:700; font-size:18px; text-align:right; border-bottom:1px solid #1a1f2e;">${signal.entryPrice}</td>
        </tr>
        <tr>
          <td style="padding:10px; color:#6b7280; border-bottom:1px solid #1a1f2e;">STOP LOSS</td>
          <td style="padding:10px; color:#ff3355; font-weight:600; text-align:right; border-bottom:1px solid #1a1f2e;">${signal.stopLoss}</td>
        </tr>
        <tr>
          <td style="padding:10px; color:#6b7280;">TAKE PROFIT</td>
          <td style="padding:10px; color:#00ff88; font-weight:600; text-align:right;">${signal.takeProfit}</td>
        </tr>
      </table>
      <p style="color:#3a3f52; font-size:10px; margin-top:20px; text-align:center;">Lamouchi Lab Desk · Confluence Multi-Sources</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: '"Lamouchi Lab Desk" <' + emailConfig.from + '>',
    to: emailConfig.to,
    subject: `${emoji} SIGNAL ${signal.direction} · ${instrName} @ ${signal.entryPrice}`,
    html
  });

  console.log(`[Email] Signal envoyé à ${emailConfig.to} (${info.messageId})`);
}

// Fonction pour récupérer le prix NQ Futures depuis Barchart (source fiable CME)
async function fetchNQFromBarchart() {
  try {
    const res = await fetch('https://www.barchart.com/futures/quotes/NQ*0/futures-prices', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    const html = await res.text();
    // Extract clean lastPrice (e.g. "lastPrice":30498.5)
    const match = html.match(/"lastPrice":([\d.]+)/);
    if (match) {
      const price = parseFloat(match[1]);
      if (!isNaN(price) && price > 10000) {
        return price;
      }
    }
  } catch (err) {
    console.warn('[Barchart NQ] Erreur:', err.message);
  }
  return null;
}

// Fonction générique pour récupérer le prix réel depuis Yahoo Finance
async function fetchYahooPrice(ticker, instrumentKey) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.chart && json.chart.result && json.chart.result[0]) {
      return json.chart.result[0].meta.regularMarketPrice;
    }
  } catch (err) {
    console.warn(`[Yahoo ${instrumentKey}] ${err.message}`);
  }
  return null;
}

// Applique un prix à un instrument
function applyPrice(instrumentKey, price, source) {
  if (typeof price !== 'number') return;
  const offset = appState.instruments[instrumentKey].settings.calibrationOffset;
  appState.instruments[instrumentKey].price = parseFloat((price + offset).toFixed(2));
  appState.instruments[instrumentKey].priceHistory.push(appState.instruments[instrumentKey].price);
  if (appState.instruments[instrumentKey].priceHistory.length > 60) {
    appState.instruments[instrumentKey].priceHistory.shift();
  }
  console.log(`[Market Sync ${instrumentKey}] ${source}: ${price} | Offset: ${offset} | Adjusted: ${appState.instruments[instrumentKey].price}`);
  broadcastState();
}

// Récupère les prix de settlement Topstep depuis leur page Daily Levels
async function fetchTopstepSettlements() {
  const result = {};
  try {
    const res = await fetch('https://www.topstep.tv/daily-levels', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    // Pattern: nombre suivi de SETTLEMENT
    const settlRegex = /(\d[\d,.]*)\s*SETTLEMENT/g;
    let match;
    while ((match = settlRegex.exec(html)) !== null) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(price)) {
        if (price > 10000) result.MNQ = price;       // NQ ~30500
        else if (price > 1000 && price < 10000) result.GCM = price;  // Gold ~4500
      }
    }
    console.log(`[Topstep] Settlements: NQ=${result.MNQ}, GCM=${result.GCM}`);
  } catch (err) {
    console.warn('[Topstep] Erreur chargement daily levels:', err.message);
  }
  return result;
}

// Synchronisation NQ : Barchart en priorité, Yahoo en fallback
let topstepRefs = null;

async function fetchAllTopstepRefs() {
  if (topstepRefs) return topstepRefs;
  topstepRefs = await fetchTopstepSettlements();
  if (topstepRefs) {
    for (const [key, price] of Object.entries(topstepRefs)) {
      if (appState.instruments[key]) {
        appState.instruments[key].settings.topstepRef = price;
      }
    }
  }
  return topstepRefs;
}

async function syncNQPrice() {
  const barchartPrice = await fetchNQFromBarchart();
  const livePrice = barchartPrice || (await fetchYahooPrice('NQ=F', 'MNQ'));
  if (!livePrice) return;
  // Charge les références Topstep
  await fetchAllTopstepRefs();
  applyPrice('MNQ', livePrice, barchartPrice ? 'Barchart' : 'Yahoo');
}

async function syncBTCMPrice() {
  const price = await fetchYahooPrice('BTC-USD', 'BTCM');
  if (price) { await fetchAllTopstepRefs(); applyPrice('BTCM', price, 'Yahoo'); }
}

async function syncGCMPrice() {
  const price = await fetchYahooPrice('GC=F', 'GCM');
  if (price) { await fetchAllTopstepRefs(); applyPrice('GCM', price, 'Yahoo'); }
}

// Initialise les synchronisations pour chaque instrument
function initPriceSync() {
  // MNQ (Nasdaq) via Barchart + Topstep ref
  syncNQPrice();
  setInterval(syncNQPrice, 12000);

  // BTCM (Micro Bitcoin Futures) via Yahoo + Topstep ref
  syncBTCMPrice();
  setInterval(syncBTCMPrice, 15000);

  // GCM (Micro Gold Futures) via Yahoo + Topstep ref
  syncGCMPrice();
  setInterval(syncGCMPrice, 15000);
}

initPriceSync();

// Simulateur de marché local pour chaque instrument
function startSimulation() {
  ['MNQ', 'BTCM', 'GCM'].forEach(inst => {
    let tickCount = 0;
    setInterval(() => {
      // très légère fluctuation locale (pour l'effet live sans dériver du prix réel)
      const amp = inst === 'MNQ' ? 0.1 : 0.3;
      const change = (Math.random() - 0.5) * amp;
      appState.instruments[inst].price = parseFloat((appState.instruments[inst].price + change).toFixed(2));
      // Enregistrer l'historique des prix pour les sparklines (60 dernières valeurs)
      appState.instruments[inst].priceHistory.push(appState.instruments[inst].price);
      if (appState.instruments[inst].priceHistory.length > 60) {
        appState.instruments[inst].priceHistory.shift();
      }

      tickCount++;
      if (appState.instruments[inst].settings.mode === 'simulation') {
        if (tickCount % 12 === 0) {
          const sourceKeys = ['investing', 'tradingview', 'strategy'];
          const randomSource = sourceKeys[Math.floor(Math.random() * sourceKeys.length)];
          const coinFlip = Math.random();
          if (coinFlip < 0.4) {
            const otherSources = sourceKeys.filter(k => k !== randomSource);
            appState.instruments[inst].sources[randomSource] = appState.instruments[inst].sources[otherSources[0]];
          } else {
            const states = ['BUY', 'SELL', 'NEUTRAL'];
            appState.instruments[inst].sources[randomSource] = states[Math.floor(Math.random() * states.length)];
          }
          // Also randomly update the extra fourth source for realism
          const extraState = ['BUY', 'SELL', 'NEUTRAL'];
          appState.instruments[inst].sources.extra = extraState[Math.floor(Math.random() * extraState.length)];
          // Alpha Vantage - 5ème source crédible
          appState.instruments[inst].sources.alphavantage = extraState[Math.floor(Math.random() * extraState.length)];
          evaluateConfluence(inst);
        }
      }
      broadcastState();
    }, 1000);
  });
}

startSimulation();

// --- ENDPOINTS API ---

// 1. Récupérer l'état complet
app.get('/api/state', (req, res) => {
  res.json(appState);
});

// 2. Modifier manuellement la configuration d'un instrument
app.post('/api/config/:instrument', (req, res) => {
  const { instrument } = req.params;
  if (!appState.instruments[instrument]) {
    return res.status(400).json({ error: 'Instrument inconnu' });
  }
  const { webhookUrl, stopLossTicks, takeProfitTicks, mode, calibrationOffset } = req.body;
  const instr = appState.instruments[instrument];
  if (webhookUrl !== undefined) instr.settings.webhookUrl = webhookUrl;
  if (stopLossTicks !== undefined) instr.settings.stopLossTicks = parseInt(stopLossTicks) || 80;
  if (takeProfitTicks !== undefined) instr.settings.takeProfitTicks = parseInt(takeProfitTicks) || 160;
  if (calibrationOffset !== undefined) instr.settings.calibrationOffset = parseFloat(calibrationOffset) || 0;
  if (mode !== undefined) {
    instr.settings.mode = mode;
    if (mode === 'manual') {
      instr.sources.investing = 'NEUTRAL';
      instr.sources.tradingview = 'NEUTRAL';
      instr.sources.strategy = 'NEUTRAL';
      instr.sources.extra = 'NEUTRAL';
      instr.sources.alphavantage = 'NEUTRAL';
      evaluateConfluence(instrument);
    }
  }
  console.log(`[Config ${instrument}]`, instr.settings);
  broadcastState();
  res.json({ success: true, settings: instr.settings });
});

// 3. Forcer manuellement le signal d'une source pour un instrument
app.post('/api/extra/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { signal } = req.body; // expect { signal: 'BUY'|'SELL'|'NEUTRAL' }
  if (!['BUY', 'SELL', 'NEUTRAL'].includes(signal)) {
    return res.status(400).json({ error: 'Signal invalide' });
  }
  instr.sources.extra = signal;
  evaluateConfluence(instrument);
  broadcastState();
  res.json({ success: true, extra: instr.sources.extra, confluence: instr.confluence });
});

app.post('/api/override/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  if (instr.settings.mode !== 'manual') {
    return res.status(400).json({ error: 'Le mode doit être "manual"' });
  }
  const { source, signal } = req.body;
  const validSources = ['investing', 'tradingview', 'strategy', 'extra', 'alphavantage'];
  const validSignals = ['BUY', 'SELL', 'NEUTRAL'];
  if (!validSources.includes(source) || !validSignals.includes(signal)) {
    return res.status(400).json({ error: 'Source ou signal invalide' });
  }
  instr.sources[source] = signal;
  evaluateConfluence(instrument);
  broadcastState();
  res.json({ success: true, sources: instr.sources, confluence: instr.confluence });
});

// 4. Tester l'envoi du webhook pour un instrument spécifique
app.post('/api/test-webhook/:instrument', async (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL Webhook manquante.' });
  // allow optional extra source in test webhook payload
  const payload = {
    action: 'buy',
    ticker: instrument,
    quantity: 1,
    price: instr.price,
    stopLoss: instr.price - 10,
    takeProfit: instr.price + 10,
    comment: `Test webhook ${instrument}`,
    timestamp: new Date().toISOString()
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      res.json({ success: true, message: 'Webhook envoyé' });
    } else {
      res.status(500).json({ error: `HTTP ${response.status}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4.5 Calibrer le prix d'un instrument
app.post('/api/calibrate/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { targetPrice } = req.body;
  if (targetPrice === undefined || isNaN(targetPrice)) {
    return res.status(400).json({ error: 'Prix cible invalide.' });
  }
  const parsedTarget = parseFloat(targetPrice);
  instr.price = parsedTarget;
  instr.priceHistory.push(instr.price);
  if (instr.priceHistory.length > 60) instr.priceHistory.shift();
  instr.settings.calibrationOffset = parseFloat((parsedTarget - lastYahooPrice).toFixed(2));
  broadcastState();
  res.json({ success: true, price: instr.price, offset: instr.settings.calibrationOffset });
});

// 5. Configurer l'envoi d'email
app.get('/api/email-config', (req, res) => {
  res.json({ enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password });
});

app.post('/api/email-config', (req, res) => {
  const { enabled, to, from, password } = req.body;
  if (enabled !== undefined) emailConfig.enabled = enabled;
  if (to !== undefined) emailConfig.to = to;
  if (from !== undefined) emailConfig.from = from;
  if (password !== undefined) emailConfig.password = password;
  console.log('[Email Config]', { enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password });
  res.json({ success: true, enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password });
});

app.post('/api/test-email', async (req, res) => {
  if (!emailConfig.password) return res.status(400).json({ error: 'Mot de passe email manquant' });
  try {
    const transporter = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: false,
      auth: { user: emailConfig.from, pass: emailConfig.password }
    });
    await transporter.sendMail({
      from: '"Lamouchi Lab Desk" <' + emailConfig.from + '>',
      to: emailConfig.to,
      subject: '✅ TEST · Lamouchi Lab Desk',
      html: '<div style="background:#0a0e1a;padding:24px;border-radius:12px;"><h1 style="color:#00f0ff;">✅ Test réussi</h1><p style="color:#e8e8f0;">Les alertes confluence fonctionnent !</p></div>'
    });
    res.json({ success: true, message: 'Email de test envoyé à ' + emailConfig.to });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. Health check pour Render / fly.io
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 7. Canal temps réel via Server-Sent Events (SSE)
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // Envoyer l'état complet + config email
  const state = { instruments: appState.instruments, emailConfig: { enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password } };
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
    console.log('[SSE] Client déconnecté');
  });
});

// Démarrer l'application
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`   LAMOUCHI LAB DESK démarré sur http://localhost:${PORT}   `);
  console.log(`================================================================`);
});
