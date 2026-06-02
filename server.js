const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let lastYahooPrice = 30535.50;

// ===== HELPER FUNCTIONS (for regime detection and ATR SL/TP) =====
function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(data.length - period).reduce((a, b) => a + b, 0) / period;
}

function calcATR(data, period = 14) {
  if (data.length < period + 1) return null;
  const trs = [];
  for (let i = data.length - period; i < data.length; i++) {
    const high = Math.max(data[i], data[i - 1] || data[i]);
    const low = Math.min(data[i], data[i - 1] || data[i]);
    const prevClose = data[i - 1] || data[i];
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs.reduce((a, b) => a + b, 0) / period;
}

function calcADX(data, period = 14) {
  if (data.length < period * 2) return 20;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const up = data[i] - data[i - 1];
    const down = data[i - 1] - data[i];
    plusDM += (up > down && up > 0) ? up : 0;
    minusDM += (down > up && down > 0) ? down : 0;
    tr += Math.abs(data[i] - data[i - 1]);
  }
  const avgTR = tr / period;
  if (avgTR === 0) return 20;
  const plusDI = (plusDM / period / avgTR) * 100;
  const minusDI = (minusDM / period / avgTR) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  return isNaN(dx) ? 20 : dx;
}

// ===== MARKET REGIME =====
function detectRegime(data, adx) {
  if (data.length < 52) return { regime: 'INITIALIZING', direction: 'NEUTRAL', adx: adx || 20 };
  const price = data[data.length - 1];
  const sma20 = calcSMA(data, 20);
  const sma50 = calcSMA(data, 50);
  const sma200 = calcSMA(data, 200) || calcSMA(data, 100) || sma50;
  const atr = calcATR(data) || 0;
  const atrPercent = (atr / price) * 100;

  let regime = 'RANGING';
  if (adx > 25) regime = 'TRENDING';
  if (adx > 40) regime = 'STRONG_TREND';
  if (atrPercent > 2) regime += '_VOLATILE';

  let direction = 'NEUTRAL';
  const trendUp = price > sma20 && sma20 > sma50 && price > sma200;
  const trendDn = price < sma20 && sma20 < sma50 && price < sma200;
  if (trendUp) direction = 'BULLISH';
  else if (trendDn) direction = 'BEARISH';
  else if (price > sma50) direction = 'BULLISH';
  else if (price < sma50) direction = 'BEARISH';

  const bbWidth = atrPercent > 1.5 ? 'WIDE' : 'NARROW';
  const regimeDetail = regime + (bbWidth === 'WIDE' ? ' + BREAKOUT' : ' + CONTRACTION');

  return { regime: regimeDetail, direction, adx, atrPercent: atrPercent.toFixed(2) };
}

// ===== REAL SIGNAL PROVIDERS =====

// 1. Investing.com Technical Summary (MNQ, GCM)
const INVESTING_PAIRS = {
  MNQ: { path: '/indices/nq-100-technical', pairId: 20 },
  BTCM: null,
  GCM: { path: '/commodities/gold-technical', pairId: 8830 }
};

async function fetchInvestingSignal(instrument) {
  const cfg = INVESTING_PAIRS[instrument];
  if (!cfg) return 'NEUTRAL';
  try {
    const res = await fetch('https://www.investing.com' + cfg.path, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (res.status !== 200) return 'NEUTRAL';
    const html = await res.text();
    const scriptMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!scriptMatch) return 'NEUTRAL';
    const json = JSON.parse(scriptMatch[1]);
    const stateStr = JSON.stringify(json.props.pageProps.state);
    const regex = /"Name":"([^"]+)","TechSummary":"([^"]+)","pair":(\d+)/g;
    let m;
    while ((m = regex.exec(stateStr)) !== null) {
      if (parseInt(m[3]) === cfg.pairId) {
        const summary = m[2].toLowerCase();
        if (summary === 'strong_buy' || summary === 'buy') return 'BUY';
        if (summary === 'strong_sell' || summary === 'sell') return 'SELL';
        return 'NEUTRAL';
      }
    }
    return 'NEUTRAL';
  } catch (err) {
    console.warn(`[Investing ${instrument}]`, err.message);
    return 'NEUTRAL';
  }
}

// 2. Topstep Settlement Mean Reversion (MNQ, GCM)
function fetchTopstepSignal(instrument, price, settlementRef) {
  if (!settlementRef || !price) return 'NEUTRAL';
  const thresholds = { MNQ: 0.003, BTCM: 0.008, GCM: 0.004 };
  const threshold = thresholds[instrument] || 0.005;
  const deviation = (price - settlementRef) / settlementRef;
  if (deviation > threshold) return 'SELL';
  if (deviation < -threshold) return 'BUY';
  return 'NEUTRAL';
}

// 3. Fear & Greed Index (market sentiment)
let lastFearGreed = null;
let lastFearGreedTime = 0;

async function fetchFearGreedSignal() {
  if (Date.now() - lastFearGreedTime < 3600000 && lastFearGreed) return lastFearGreed;
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const json = await res.json();
    const value = parseInt(json?.data?.[0]?.value);
    if (isNaN(value)) return 'NEUTRAL';
    let signal = 'NEUTRAL';
    if (value <= 25) signal = 'BUY';
    else if (value >= 75) signal = 'SELL';
    lastFearGreed = signal;
    lastFearGreedTime = Date.now();
    return signal;
  } catch (err) {
    console.warn('[FearGreed]', err.message);
    return 'NEUTRAL';
  }
}

// 4. CoinGecko Community Sentiment (BTC)
let lastCoinGeckoSignal = null;
let lastCoinGeckoTime = 0;

async function fetchCoinGeckoSignal(instrument) {
  if (instrument !== 'BTCM') return 'NEUTRAL';
  if (Date.now() - lastCoinGeckoTime < 1800000 && lastCoinGeckoSignal) return lastCoinGeckoSignal;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=true&developer_data=false&sparkline=false');
    const json = await res.json();
    const up = json?.sentiment_votes_up_percentage;
    const down = json?.sentiment_votes_down_percentage;
    if (up == null || down == null) return 'NEUTRAL';
    let signal = 'NEUTRAL';
    if (up > 65) signal = 'BUY';
    else if (down > 65) signal = 'SELL';
    lastCoinGeckoSignal = signal;
    lastCoinGeckoTime = Date.now();
    return signal;
  } catch (err) {
    console.warn('[CoinGecko]', err.message);
    return 'NEUTRAL';
  }
}

// ===== SOURCE DEFINITIONS =====
const sourceWeights = {
  investing: { weight: 1.2, label: 'Investing.com' },
  topstep: { weight: 1.0, label: 'Topstep' },
  feargreed: { weight: 1.1, label: 'Fear & Greed' },
  coingecko: { weight: 1.0, label: 'CoinGecko' }
};

const sourceIndicators = Object.keys(sourceWeights);

let totalPL = 0;
let winningTrades = 0;
let losingTrades = 0;

// ===== APP STATE =====
const defaultSources = () => ({ investing: 'NEUTRAL', topstep: 'NEUTRAL', feargreed: 'NEUTRAL', coingecko: 'NEUTRAL' });
const defaultSettings = () => ({
  webhookUrl: '', stopLossTicks: 80, takeProfitTicks: 160, mode: 'simulation', calibrationOffset: 0,
  atrMultiplierSL: 1.5, atrMultiplierTP: 3.0, accountBalance: 100000, riskPercent: 1.0, topstepRef: null
});
const defaultAnalytics = () => ({ totalSignals: 0, wins: 0, losses: 0, winRate: 0, totalPL: 0, avgReturn: 0, maxDrawdown: 0 });
const defaultRegime = () => ({ regime: 'INITIALIZING', direction: 'NEUTRAL', adx: 20, atrPercent: '0.00' });

function createInstrument(price) {
  return {
    price,
    sources: defaultSources(),
    sourceSignals: {},
    confluence: 'NEUTRAL',
    confluenceScore: 0,
    settings: defaultSettings(),
    history: [],
    priceHistory: [],
    indicators: { atr: 0, adx: 20 },
    regime: defaultRegime(),
    analytics: defaultAnalytics()
  };
}

let appState = {
  instruments: {
    MNQ: createInstrument(30535.50),
    BTCM: createInstrument(25000.00),
    GCM: createInstrument(1800.00)
  }
};

let clients = [];

let emailConfig = {
  enabled: process.env.EMAIL_ENABLED === 'true' || true,
  to: process.env.EMAIL_TO || 'selim.uchiha1892@gmail.com',
  from: process.env.EMAIL_FROM || 'selim.uchiha1892@gmail.com',
  password: process.env.EMAIL_PASS || '',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587')
};

// ===== REAL SOURCE POLLING =====
async function pollRealSources(instKey) {
  const inst = appState.instruments[instKey];
  const price = inst.price;
  const data = inst.priceHistory;

  inst.indicators = {
    atr: calcATR(data) || 0,
    adx: calcADX(data) || 20
  };
  inst.regime = detectRegime(data, inst.indicators.adx);

  // Fetch from all 4 real sources in parallel
  const [investingSig, feargreedSig, coingeckoSig] = await Promise.all([
    fetchInvestingSignal(instKey),
    fetchFearGreedSignal(),
    fetchCoinGeckoSignal(instKey)
  ]);
  const topstepSig = fetchTopstepSignal(instKey, price, inst.settings.topstepRef);

  const signals = {
    investing: investingSig,
    topstep: topstepSig,
    feargreed: feargreedSig,
    coingecko: coingeckoSig
  };

  inst.sourceSignals = signals;
  for (const key of sourceIndicators) {
    inst.sources[key] = signals[key];
  }
}

function weightedConfluenceScore(inst) {
  let score = 0;
  let maxPossible = 0;
  for (const key of sourceIndicators) {
    const w = sourceWeights[key].weight;
    maxPossible += w;
    if (inst.sources[key] === 'BUY') score += w;
    else if (inst.sources[key] === 'SELL') score -= w;
  }
  inst.confluenceScore = parseFloat(score.toFixed(2));
  const threshold = maxPossible * 0.6;
  let newConfluence = 'NEUTRAL';
  if (score >= threshold) newConfluence = 'BUY';
  else if (score <= -threshold) newConfluence = 'SELL';

  return { confluence: newConfluence, score, maxPossible };
}

// ===== ATR-BASED SL/TP =====
const minAtrFloor = { MNQ: 30, BTCM: 800, GCM: 15 };
function calcDynamicLevels(instKey, inst, direction) {
  const atr = Math.max(inst.indicators.atr || 1, (minAtrFloor[instKey] || 1) * 0.5);
  const price = inst.price;
  const slMult = inst.settings.atrMultiplierSL;
  const tpMult = inst.settings.atrMultiplierTP;
  const slDist = atr * slMult;
  const tpDist = atr * tpMult;
  let stopLoss, takeProfit;
  if (direction === 'BUY') {
    stopLoss = price - slDist;
    takeProfit = price + tpDist;
  } else {
    stopLoss = price + slDist;
    takeProfit = price - tpDist;
  }
  return { stopLoss: parseFloat(stopLoss.toFixed(2)), takeProfit: parseFloat(takeProfit.toFixed(2)) };
}

// ===== POSITION SIZING =====
function calcPositionSize(inst, entryPrice, stopLoss) {
  const riskPerTrade = inst.settings.accountBalance * (inst.settings.riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit === 0) return 1;
  return Math.max(1, Math.floor(riskPerTrade / riskPerUnit));
}

// ===== BROADCAST =====
function broadcastState() {
  const data = JSON.stringify({
    instruments: appState.instruments,
    emailConfig: { enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password }
  });
  clients.forEach(client => client.write(`data: ${data}\n\n`));
}

// ===== EVALUATE CONFLUENCE =====
function evaluateConfluence(instrKey) {
  const inst = appState.instruments[instrKey];
  if (inst.settings.mode === 'manual') return;
  const { confluence, score } = weightedConfluenceScore(inst);
  const prev = inst.confluence;
  inst.confluence = confluence;
  if (confluence !== 'NEUTRAL' && prev === 'NEUTRAL') {
    triggerSignal(instrKey, confluence);
  }
}

// ===== P&L TRACKING =====
function updateActiveSignals(instrKey) {
  const inst = appState.instruments[instrKey];
  if (!inst.history.length) return;
  const activeSignals = inst.history.filter(s => s.status === 'ACTIVE');
  const price = inst.price;
  for (const sig of activeSignals) {
    const sl = parseFloat(sig.stopLoss);
    const tp = parseFloat(sig.takeProfit);
    const entry = parseFloat(sig.entryPrice);
    if (sig.direction === 'BUY') {
      if (price >= tp) {
        sig.status = 'WIN';
        sig.exitPrice = price;
        sig.exitTime = new Date().toISOString();
        sig.pl = ((price - entry) / entry) * 100;
        inst.analytics.wins++;
      } else if (price <= sl) {
        sig.status = 'LOSS';
        sig.exitPrice = price;
        sig.exitTime = new Date().toISOString();
        sig.pl = ((price - entry) / entry) * 100;
        inst.analytics.losses++;
      }
    } else {
      if (price <= tp) {
        sig.status = 'WIN';
        sig.exitPrice = price;
        sig.exitTime = new Date().toISOString();
        sig.pl = ((entry - price) / entry) * 100;
        inst.analytics.wins++;
      } else if (price >= sl) {
        sig.status = 'LOSS';
        sig.exitPrice = price;
        sig.exitTime = new Date().toISOString();
        sig.pl = ((entry - price) / entry) * 100;
        inst.analytics.losses++;
      }
    }
    if (sig.status !== 'ACTIVE') {
      inst.analytics.totalSignals++;
      const plVal = sig.pl || 0;
      inst.analytics.totalPL = parseFloat((inst.analytics.totalPL + plVal).toFixed(2));
      const total = inst.analytics.wins + inst.analytics.losses;
      inst.analytics.winRate = total > 0 ? parseFloat(((inst.analytics.wins / total) * 100).toFixed(1)) : 0;
      inst.analytics.avgReturn = inst.analytics.totalSignals > 0
        ? parseFloat((inst.analytics.totalPL / inst.analytics.totalSignals).toFixed(2)) : 0;
      if (inst.analytics.totalPL < inst.analytics.maxDrawdown) {
        inst.analytics.maxDrawdown = inst.analytics.totalPL;
      }
    }
  }
}

// ===== TRIGGER SIGNAL =====
async function triggerSignal(instrKey, direction) {
  const inst = appState.instruments[instrKey];
  const entryPrice = inst.price;

  // ATR-based SL/TP
  const levels = calcDynamicLevels(instrKey, inst, direction);
  const stopLoss = levels.stopLoss;
  const takeProfit = levels.takeProfit;

  // Position sizing
  const quantity = calcPositionSize(inst, entryPrice, stopLoss);

  const signalEvent = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    instrument: instrKey,
    direction,
    entryPrice: entryPrice.toFixed(2),
    stopLoss: stopLoss.toFixed(2),
    takeProfit: takeProfit.toFixed(2),
    quantity,
    status: 'ACTIVE',
    exitPrice: null,
    exitTime: null,
    pl: null,
    regime: inst.regime.regime,
    regimeDirection: inst.regime.direction,
    confluenceScore: inst.confluenceScore,
    webhookStatus: 'PENDING'
  };

  console.log(`[CONFLUENCE SIGNAL] ${direction} ${instrKey} @ ${entryPrice.toFixed(2)} | SL: ${stopLoss} | TP: ${takeProfit} | Qty: ${quantity} | Score: ${inst.confluenceScore}`);

  // Webhook
  if (inst.settings.webhookUrl) {
    try {
      signalEvent.webhookStatus = 'SENDING';
      broadcastState();
      const response = await fetch(inst.settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: direction === 'BUY' ? 'buy' : 'sell',
          ticker: instrKey,
          quantity,
          price: entryPrice,
          stopLoss,
          takeProfit,
          regime: inst.regime,
          confluenceScore: inst.confluenceScore,
          comment: `Lamouchi Lab Desk - ${inst.regime.regime} / ${inst.regime.direction}`,
          timestamp: signalEvent.timestamp
        })
      });
      signalEvent.webhookStatus = response.ok ? 'SUCCESS' : 'FAILED';
    } catch (error) {
      signalEvent.webhookStatus = 'ERROR';
      console.error('[Webhook Error]', error.message);
    }
  } else {
    signalEvent.webhookStatus = 'NOT_CONFIGURED';
  }

  inst.history.unshift(signalEvent);
  if (inst.history.length > 200) inst.history.pop();

  // Email
  if (emailConfig.enabled && emailConfig.password) {
    try {
      await sendSignalEmail(signalEvent, instrKey, inst);
    } catch (err) {
      console.error('[Email Error]', err.message);
    }
  }

  broadcastState();
}

// ===== EMAIL =====
async function sendSignalEmail(signal, instrKey, inst) {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    secure: false,
    auth: { user: emailConfig.from, pass: emailConfig.password }
  });

  const instrName = { MNQ: 'NASDAQ (MNQ)', BTCM: 'BITCOIN (BTCM)', GCM: 'GOLD (GCM)' }[instrKey] || instrKey;
  const emoji = signal.direction === 'BUY' ? '🟢' : '🔴';
  const date = new Date(signal.timestamp).toLocaleString('fr-FR');
  const riskAmt = (inst.settings.accountBalance * inst.settings.riskPercent / 100).toFixed(2);

  const html = `
    <div style="font-family:'Inter',sans-serif;background:#0a0e1a;padding:24px;border-radius:12px;">
      <div style="border-bottom:2px solid #00f0ff;padding-bottom:12px;margin-bottom:20px;">
        <h1 style="color:#00f0ff;margin:0;font-size:22px;letter-spacing:2px;">⚡ LAMOUCHI LAB DESK</h1>
        <p style="color:#6b7280;margin:4px 0 0;font-size:12px;">ALERTE CONFLUENCE · ${date}</p>
      </div>
      <div style="text-align:center;padding:20px;background:rgba(0,240,255,0.05);border-radius:8px;margin-bottom:20px;">
        <span style="font-size:48px;">${emoji}</span>
        <h2 style="color:${signal.direction === 'BUY' ? '#00ff88' : '#ff3355'};font-size:28px;margin:8px 0;">${signal.direction}</h2>
        <p style="color:#e8e8f0;font-size:14px;margin:0;">${instrName}</p>
        <p style="color:#6b7280;font-size:12px;margin:4px 0 0;">${inst.regime.regime} · ${inst.regime.direction} · Score: ${signal.confluenceScore}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:10px;color:#6b7280;border-bottom:1px solid #1a1f2e;">ENTRÉE</td><td style="padding:10px;color:#e8e8f0;font-weight:700;font-size:18px;text-align:right;border-bottom:1px solid #1a1f2e;">${signal.entryPrice}</td></tr>
        <tr><td style="padding:10px;color:#6b7280;border-bottom:1px solid #1a1f2e;">STOP LOSS</td><td style="padding:10px;color:#ff3355;font-weight:600;text-align:right;border-bottom:1px solid #1a1f2e;">${signal.stopLoss}</td></tr>
        <tr><td style="padding:10px;color:#6b7280;border-bottom:1px solid #1a1f2e;">TAKE PROFIT</td><td style="padding:10px;color:#00ff88;font-weight:600;text-align:right;border-bottom:1px solid #1a1f2e;">${signal.takeProfit}</td></tr>
        <tr><td style="padding:10px;color:#6b7280;border-bottom:1px solid #1a1f2e;">QUANTITÉ</td><td style="padding:10px;color:#e8e8f0;font-weight:600;text-align:right;border-bottom:1px solid #1a1f2e;">${signal.quantity}</td></tr>
        <tr><td style="padding:10px;color:#6b7280;">RISQUE</td><td style="padding:10px;color:#ffd700;font-weight:600;text-align:right;">$${riskAmt} (${inst.settings.riskPercent}%)</td></tr>
      </table>
      <p style="color:#3a3f52;font-size:10px;margin-top:20px;text-align:center;">Lamouchi Lab Desk · Investing.com+Topstep+Fear&amp;Greed+CoinGecko · ATR SL/TP · Risk</p>
    </div>`;

  const info = await transporter.sendMail({
    from: '"Lamouchi Lab Desk" <' + emailConfig.from + '>',
    to: emailConfig.to,
    subject: `${emoji} SIGNAL ${signal.direction} · ${instrName} @ ${signal.entryPrice}`,
    html
  });
  console.log(`[Email] Signal envoyé (${info.messageId})`);
}

// ===== PRICE FETCHING =====
async function fetchNQFromBarchart() {
  try {
    const res = await fetch('https://www.barchart.com/futures/quotes/NQ*0/futures-prices', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html,application/xhtml+xml' }
    });
    const html = await res.text();
    const match = html.match(/"lastPrice":([\d.]+)/);
    if (match) {
      const price = parseFloat(match[1]);
      if (!isNaN(price) && price > 10000) return price;
    }
  } catch (err) {
    console.warn('[Barchart NQ]', err.message);
  }
  return null;
}

async function fetchYahooPrice(ticker, instrumentKey) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.chart && json.chart.result && json.chart.result[0]) {
      return json.chart.result[0].meta.regularMarketPrice;
    }
  } catch (err) {
    console.warn(`[Yahoo ${instrumentKey}]`, err.message);
  }
  return null;
}

function applyPrice(instrumentKey, price, source) {
  if (typeof price !== 'number') return;
  const offset = appState.instruments[instrumentKey].settings.calibrationOffset;
  appState.instruments[instrumentKey].price = parseFloat((price + offset).toFixed(2));
  appState.instruments[instrumentKey].priceHistory.push(appState.instruments[instrumentKey].price);
  if (appState.instruments[instrumentKey].priceHistory.length > 200) {
    appState.instruments[instrumentKey].priceHistory.shift();
  }
}

async function fetchTopstepSettlements() {
  const result = {};
  try {
    const res = await fetch('https://www.topstep.tv/daily-levels', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const settlRegex = /(\d[\d,.]*)\s*SETTLEMENT/g;
    let match;
    while ((match = settlRegex.exec(html)) !== null) {
      const p = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(p)) {
        if (p > 10000) result.MNQ = p;
        else if (p > 1000 && p < 10000) result.GCM = p;
      }
    }
    console.log(`[Topstep] NQ=${result.MNQ} GCM=${result.GCM}`);
  } catch (err) {
    console.warn('[Topstep]', err.message);
  }
  return result;
}

let topstepRefs = null;

async function fetchAllTopstepRefs() {
  if (topstepRefs) return topstepRefs;
  topstepRefs = await fetchTopstepSettlements();
  if (topstepRefs) {
    for (const [key, price] of Object.entries(topstepRefs)) {
      if (appState.instruments[key]) appState.instruments[key].settings.topstepRef = price;
    }
  }
  return topstepRefs;
}

async function syncNQPrice() {
  const barchartPrice = await fetchNQFromBarchart();
  const livePrice = barchartPrice || (await fetchYahooPrice('NQ=F', 'MNQ'));
  if (!livePrice) return;
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

function initPriceSync() {
  syncNQPrice();
  setInterval(syncNQPrice, 12000);
  syncBTCMPrice();
  setInterval(syncBTCMPrice, 15000);
  syncGCMPrice();
  setInterval(syncGCMPrice, 15000);
}

initPriceSync();

// ===== MAIN LOOPS =====
function startSimulation() {
  // Price simulation (same as before, updates every second)
  ['MNQ', 'BTCM', 'GCM'].forEach(instKey => {
    const inst = appState.instruments[instKey];
    setInterval(() => {
      if (inst.priceHistory.length > 0) {
        const amp = instKey === 'MNQ' ? 0.5 : instKey === 'GCM' ? 0.3 : 2.0;
        const drift = (inst.price - (inst.priceHistory[inst.priceHistory.length - 1] || inst.price)) * 0.1;
        const change = (Math.random() - 0.5) * amp + drift;
        inst.price = parseFloat((inst.price + change).toFixed(2));
        inst.priceHistory.push(inst.price);
        if (inst.priceHistory.length > 200) inst.priceHistory.shift();
        updateActiveSignals(instKey);
        broadcastState();
      }
    }, 1000);
  });

  // Poll real sources every 5 minutes (300s)
  setInterval(async () => {
    for (const instKey of ['MNQ', 'BTCM', 'GCM']) {
      await pollRealSources(instKey);
      if (appState.instruments[instKey].settings.mode === 'simulation') {
        evaluateConfluence(instKey);
      }
    }
    broadcastState();
    console.log('[Sources] All 4 real signal providers polled');
  }, 300000);

  // Initial poll after 5s startup delay
  setTimeout(async () => {
    for (const instKey of ['MNQ', 'BTCM', 'GCM']) {
      await pollRealSources(instKey);
      if (appState.instruments[instKey].settings.mode === 'simulation') {
        evaluateConfluence(instKey);
      }
    }
    broadcastState();
  }, 5000);
}

startSimulation();

// ===== API ENDPOINTS =====

app.get('/api/state', (req, res) => res.json(appState));

app.post('/api/config/:instrument', (req, res) => {
  const { instrument } = req.params;
  if (!appState.instruments[instrument]) return res.status(400).json({ error: 'Instrument inconnu' });
  const { webhookUrl, stopLossTicks, takeProfitTicks, mode, calibrationOffset, atrMultiplierSL, atrMultiplierTP, accountBalance, riskPercent } = req.body;
  const instr = appState.instruments[instrument];
  if (webhookUrl !== undefined) instr.settings.webhookUrl = webhookUrl;
  if (stopLossTicks !== undefined) instr.settings.stopLossTicks = parseInt(stopLossTicks) || 80;
  if (takeProfitTicks !== undefined) instr.settings.takeProfitTicks = parseInt(takeProfitTicks) || 160;
  if (calibrationOffset !== undefined) instr.settings.calibrationOffset = parseFloat(calibrationOffset) || 0;
  if (atrMultiplierSL !== undefined) instr.settings.atrMultiplierSL = parseFloat(atrMultiplierSL);
  if (atrMultiplierTP !== undefined) instr.settings.atrMultiplierTP = parseFloat(atrMultiplierTP);
  if (accountBalance !== undefined) instr.settings.accountBalance = parseFloat(accountBalance) || 100000;
  if (riskPercent !== undefined) instr.settings.riskPercent = parseFloat(riskPercent) || 1.0;
  if (mode !== undefined) {
    instr.settings.mode = mode;
    if (mode === 'manual') {
      for (const key of sourceIndicators) instr.sources[key] = 'NEUTRAL';
      evaluateConfluence(instrument);
    }
  }
  console.log(`[Config ${instrument}]`, instr.settings);
  broadcastState();
  res.json({ success: true, settings: instr.settings });
});

app.post('/api/source/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { source, signal } = req.body;
  if (!sourceIndicators.includes(source) || !['BUY', 'SELL', 'NEUTRAL'].includes(signal)) {
    return res.status(400).json({ error: 'Source ou signal invalide. Sources: ' + sourceIndicators.join(', ') });
  }
  instr.sources[source] = signal;
  evaluateConfluence(instrument);
  broadcastState();
  res.json({ success: true, sources: instr.sources, confluence: instr.confluence });
});

app.post('/api/test-webhook/:instrument', async (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante.' });
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'buy', ticker: instrument, quantity: 1, price: instr.price, comment: 'Test', timestamp: new Date().toISOString() })
    });
    res.json({ success: r.ok, message: r.ok ? 'Webhook envoyé' : `HTTP ${r.status}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/calibrate/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  const { targetPrice } = req.body;
  if (targetPrice === undefined || isNaN(targetPrice)) return res.status(400).json({ error: 'Prix cible invalide.' });
  const parsedTarget = parseFloat(targetPrice);
  instr.price = parsedTarget;
  instr.priceHistory.push(instr.price);
  if (instr.priceHistory.length > 200) instr.priceHistory.shift();
  instr.settings.calibrationOffset = parseFloat((parsedTarget - lastYahooPrice).toFixed(2));
  broadcastState();
  res.json({ success: true, price: instr.price, offset: instr.settings.calibrationOffset });
});

app.post('/api/reset-analytics/:instrument', (req, res) => {
  const { instrument } = req.params;
  const instr = appState.instruments[instrument];
  if (!instr) return res.status(400).json({ error: 'Instrument inconnu' });
  instr.analytics = { totalSignals: 0, wins: 0, losses: 0, winRate: 0, totalPL: 0, avgReturn: 0, maxDrawdown: 0 };
  instr.history = [];
  broadcastState();
  res.json({ success: true });
});

// Manual source override webhook
app.post('/api/webhook/source', (req, res) => {
  const { instrument, source, action, price } = req.body;
  if (!instrument || !source || !action) return res.status(400).json({ error: 'Missing fields' });
  const instKey = instrument.toUpperCase();
  if (!appState.instruments[instKey]) return res.status(400).json({ error: 'Unknown instrument' });
  if (!sourceIndicators.includes(source)) return res.status(400).json({ error: 'Unknown source: ' + source });
  const signal = action.toUpperCase() === 'BUY' ? 'BUY' : action.toUpperCase() === 'SELL' ? 'SELL' : 'NEUTRAL';
  appState.instruments[instKey].sources[source] = signal;
  if (price) appState.instruments[instKey].price = parseFloat(price);
  evaluateConfluence(instKey);
  broadcastState();
  res.json({ success: true, source, signal, confluence: appState.instruments[instKey].confluence });
});

app.get('/api/email-config', (req, res) => {
  res.json({ enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password });
});

app.post('/api/email-config', (req, res) => {
  const { enabled, to, from, password } = req.body;
  if (enabled !== undefined) emailConfig.enabled = enabled;
  if (to !== undefined) emailConfig.to = to;
  if (from !== undefined) emailConfig.from = from;
  if (password !== undefined) emailConfig.password = password;
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

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const state = { instruments: appState.instruments, emailConfig: { enabled: emailConfig.enabled, to: emailConfig.to, from: emailConfig.from, hasPassword: !!emailConfig.password } };
  res.write(`data: ${JSON.stringify(state)}\n\n`);
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`   LAMOUCHI LAB DESK - Chef-d'oeuvre`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Signaux: Investing.com + Topstep + Fear & Greed + CoinGecko`);
  console.log(`   SL/TP: ATR dynamique | Divergence: Auto | P&L: Auto`);
  console.log(`================================================================`);
});
