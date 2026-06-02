const express = require('express');
const path = require('path');
const ccxt = require('ccxt');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const INITIAL_BALANCE = 200;
const RISK_PER_TRADE = 15;
const SIGNAL_POLL_MS = 300000;
const PRICE_POLL_MS = 10000;

// ===== SIGNAL SOURCES =====
// 1. Fear & Greed Index (global)
let lastFearGreed = null;
let lastFearGreedTime = 0;

async function fetchFearGreed() {
  if (Date.now() - lastFearGreedTime < 3600000 && lastFearGreed) return lastFearGreed;
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const json = await res.json();
    const value = parseInt(json?.data?.[0]?.value);
    if (isNaN(value)) return 'NEUTRAL';
    let s = 'NEUTRAL';
    if (value <= 25) s = 'BUY';
    else if (value >= 75) s = 'SELL';
    lastFearGreed = s;
    lastFearGreedTime = Date.now();
    return s;
  } catch { return 'NEUTRAL'; }
}

// 2. TradingView Technical Summary
const TV_SYMBOLS = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'bnb', 'XRP': 'ripple',
  'SOL': 'solana', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'AVAX': 'avalanche',
  'DOT': 'polkadot', 'LINK': 'chainlink', 'PAXG': 'gold'
};

async function fetchTradingView(coin) {
  const symbol = TV_SYMBOLS[coin];
  if (!symbol) return 'NEUTRAL';
  try {
    const res = await fetch(`https://www.tradingview.com/symbols/${symbol}/technicals/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const m = html.match(/"RECOMMENDATION":"(BUY|SELL|NEUTRAL)"/);
    if (m) return m[1];
    const b = html.match(/strong.?buy/i);
    const s = html.match(/strong.?sell/i);
    if (b && !s) return 'BUY';
    if (s && !b) return 'SELL';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// 3. Internal RSI
function calcRSI(data, period = 14) {
  if (data.length < period + 1) return 50;
  const closes = data.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function rsiSignal(rsi) {
  if (rsi <= 35) return 'BUY';
  if (rsi >= 65) return 'SELL';
  return 'NEUTRAL';
}

// 4. Internal EMA trend
function calcEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function trendSignal(price, ema) {
  if (ema == null) return 'NEUTRAL';
  const pct = (price - ema) / ema;
  if (pct > 0.01) return 'BUY';
  if (pct < -0.01) return 'SELL';
  return 'NEUTRAL';
}

// ===== TOP 10 FETCHER ====
const COIN_MAP = {
  'bitcoin': 'BTC', 'ethereum': 'ETH', 'binancecoin': 'BNB', 'ripple': 'XRP',
  'solana': 'SOL', 'cardano': 'ADA', 'dogecoin': 'DOGE',
  'avalanche-2': 'AVAX', 'polkadot': 'DOT', 'chainlink': 'LINK',
  'tron': 'TRX', 'shiba-inu': 'SHIB', 'the-open-network': 'TON',
  'polygon': 'MATIC', 'pol': 'POL', 'stellar': 'XLM', 'hyperliquid': 'HYPE',
  'near': 'NEAR', 'aptos': 'APT', 'arbitrum': 'ARB', 'internet-computer': 'ICP',
  'hedera': 'HBAR', 'render': 'RENDER', 'ethereum-classic': 'ETC',
  'vechain': 'VET', 'filecoin': 'FIL', 'maker': 'MKR', 'aave': 'AAVE',
  'cosmos': 'ATOM', 'uniswap': 'UNI', 'litecoin': 'LTC', 'bitcoinCash': 'BCH',
  'fetch': 'FET', 'fetch-ai': 'FET'
};

let topCoins = [];

async function refreshTop10() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25');
    const data = await res.json();
    const mapped = [];
    for (const c of data) {
      const ticker = COIN_MAP[c.id];
      if (ticker && !mapped.includes(ticker)) mapped.push(ticker);
    }
    topCoins = mapped.slice(0, 10);
    if (!topCoins.includes('PAXG')) topCoins.push('PAXG');
    console.log('[TopCoins]', topCoins.join(', '));
  } catch (e) {
    console.warn('[TopCoins]', e.message);
    if (!topCoins.length) topCoins = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'PAXG'];
  }
}

// ===== BINANCE TESTNET =====
let binance = null;
let binanceReady = false;

function initBinance(apiKey, apiSecret) {
  try {
    binance = new ccxt.binance({
      apiKey: apiKey || '',
      secret: apiSecret || '',
      options: { defaultType: 'spot' }
    });
    binance.setSandboxMode(true);
    binanceReady = true;
    return true;
  } catch (e) { return false; }
}

async function fetchPrice(coin) {
  if (binanceReady && binance) {
    try {
      const ticker = await binance.fetchTicker(`${coin}/USDT`);
      return ticker.last;
    } catch {}
  }
  try {
    const res = await fetch(`https://testnet.binance.vision/api/v3/ticker/price?symbol=${coin}USDT`);
    if (res.status !== 200) return null;
    const json = await res.json();
    return parseFloat(json.price);
  } catch { return null; }
}

// ===== STATE =====
let clients = [];
let totalPL = 0;

let portfolio = {
  balance: INITIAL_BALANCE,
  totalPL: 0,
  winCount: 0,
  lossCount: 0,
  tradeCount: 0
};

let instruments = {};

function createInst(coin) {
  const nameMap = {
    BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', XRP: 'XRP',
    SOL: 'Solana', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche',
    DOT: 'Polkadot', LINK: 'Chainlink', PAXG: 'Pax Gold'
  };
  return {
    coin, name: nameMap[coin] || coin,
    price: 0, priceHistory: [],
    sources: { tradingview: 'NEUTRAL', feargreed: 'NEUTRAL', rsi: 'NEUTRAL', trend: 'NEUTRAL' },
    confluence: 'NEUTRAL', confluenceScore: 0,
    position: null,
    history: [],
    analytics: { wins: 0, losses: 0, pl: 0, totalPL: 0 }
  };
}

function calcConfluence(inst) {
  const weights = { tradingview: 1.2, feargreed: 1.0, rsi: 1.0, trend: 1.0 };
  let score = 0, maxP = 0;
  for (const [k, w] of Object.entries(weights)) {
    maxP += w;
    if (inst.sources[k] === 'BUY') score += w;
    else if (inst.sources[k] === 'SELL') score -= w;
  }
  inst.confluenceScore = parseFloat(score.toFixed(2));
  const threshold = maxP * 0.35;
  let conf = 'NEUTRAL';
  if (score >= threshold) conf = 'BUY';
  else if (score <= -threshold) conf = 'SELL';
  const prev = inst.confluence;
  inst.confluence = conf;
  if (conf !== 'NEUTRAL' && prev === 'NEUTRAL') return conf;
  return null;
}

// ===== SIGNAL POLLING =====
async function pollSignals(coin) {
  const inst = instruments[coin];
  if (!inst || inst.price <= 0) return;

  const [tvSig, fgSig] = await Promise.all([
    fetchTradingView(coin),
    fetchFearGreed()
  ]);

  const rsiVal = calcRSI(inst.priceHistory);
  const ema20 = calcEMA(inst.priceHistory, 20);

  inst.sources = {
    tradingview: tvSig,
    feargreed: fgSig,
    rsi: rsiSignal(rsiVal),
    trend: trendSignal(inst.price, ema20)
  };

  const signal = calcConfluence(inst);
  if (signal) await executeTrade(coin, signal);
}

// ===== POSITION SIZING =====
function computeSLTP(price, side, atr) {
  const slMult = 1.5, tpMult = 3.0;
  const slDist = Math.max(atr * slMult, price * 0.005);
  const tpDist = Math.max(atr * tpMult, price * 0.015);
  if (side === 'BUY') {
    return { sl: price - slDist, tp: price + tpDist };
  }
  return { sl: price + slDist, tp: price - tpDist };
}

function calcSize(price, sl, side) {
  const riskPerUnit = Math.abs(price - sl);
  if (riskPerUnit < 0.01) return 0;
  let qty = RISK_PER_TRADE / riskPerUnit;
  const prec = price > 100 ? 3 : price > 1 ? 2 : 1;
  qty = Math.floor(qty * (10 ** prec)) / (10 ** prec);
  return Math.max(qty, 0.001);
}

// ===== TRADE EXECUTION =====
async function executeTrade(coin, side) {
  const inst = instruments[coin];
  if (inst.position) return;

  const price = inst.price;
  const atr = inst.priceHistory.length > 14 ? calcRSI(inst.priceHistory) * price * 0.002 : price * 0.01;
  const { sl, tp } = computeSLTP(price, side, atr);
  const qty = calcSize(price, sl, side);
  if (qty <= 0) return;

  const pos = {
    id: Date.now().toString(),
    coin, side, entryPrice: price, qty, sl, tp,
    status: 'ACTIVE', exitPrice: null, pl: null,
    openedAt: new Date().toISOString()
  };

  console.log(`[TRADE] ${side} ${coin} @ ${price} x${qty} | SL: ${sl.toFixed(2)} TP: ${tp.toFixed(2)}`);

  if (telegramConfig.enabled) {
    sendTelegramNotif(`🟢 *${side} ${coin}* @ $${price.toFixed(2)} x${qty}\nSL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)}`);
  }

  inst.position = pos;
  portfolio.tradeCount++;
  broadcastState();
}

async function closePosition(coin, reason) {
  const inst = instruments[coin];
  if (!inst.position) return;

  const pos = inst.position;
  const exitPrice = inst.price;
  const isLong = pos.side === 'BUY';
  const plPct = isLong ? ((exitPrice - pos.entryPrice) / pos.entryPrice) : ((pos.entryPrice - exitPrice) / pos.entryPrice);
  const plDollars = plPct * pos.qty * pos.entryPrice;

  pos.status = reason === 'TP' ? 'WIN' : 'LOSS';
  pos.exitPrice = exitPrice;
  pos.pl = parseFloat(plDollars.toFixed(2));
  pos.closedAt = new Date().toISOString();

  portfolio.totalPL = parseFloat((portfolio.totalPL + plDollars).toFixed(2));
  portfolio.balance = parseFloat((INITIAL_BALANCE + portfolio.totalPL).toFixed(2));
  if (pos.status === 'WIN') portfolio.winCount++;
  else portfolio.lossCount++;

  inst.analytics.wins += pos.status === 'WIN' ? 1 : 0;
  inst.analytics.losses += pos.status === 'LOSS' ? 1 : 0;
  inst.analytics.pl += plDollars;

  inst.history.unshift(pos);
  inst.position = null;

  console.log(`[CLOSE] ${coin} ${pos.side} @ ${exitPrice.toFixed(2)} | PnL: $${plDollars.toFixed(2)} | ${reason}`);

  if (telegramConfig.enabled) {
    const emoji = pos.status === 'WIN' ? '✅' : '❌';
    sendTelegramNotif(`${emoji} *${pos.status} ${coin}* | PnL: $${plDollars.toFixed(2)}\nEntrée: $${pos.entryPrice.toFixed(2)} → Sortie: $${exitPrice.toFixed(2)} | Balance: $${portfolio.balance}`);
  }

  broadcastState();
}

// ===== PORTFOLIO MONITOR =====
function checkPositions() {
  for (const coin of topCoins) {
    const inst = instruments[coin];
    if (!inst || !inst.position || inst.position.status !== 'ACTIVE') continue;
    const pos = inst.position;
    const price = inst.price;

    if (pos.side === 'BUY') {
      if (price >= pos.tp) closePosition(coin, 'TP');
      else if (price <= pos.sl) closePosition(coin, 'SL');
    } else {
      if (price <= pos.tp) closePosition(coin, 'TP');
      else if (price >= pos.sl) closePosition(coin, 'SL');
    }
  }
}

// ===== BROADCAST =====
function broadcastState() {
  const data = JSON.stringify({
    portfolio, topCoins, instruments,
    telegramConfig: { enabled: telegramConfig.enabled, hasBotToken: !!telegramConfig.botToken, hasChatId: !!telegramConfig.chatId }
  });
  clients.forEach(c => c.write(`data: ${data}\n\n`));
}

// ===== TELEGRAM =====
let telegramConfig = {
  enabled: !!process.env.TELEGRAM_BOT_TOKEN,
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || ''
};

async function sendTelegramNotif(text) {
  if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramConfig.chatId, text, parse_mode: 'Markdown' })
    });
  } catch {}
}

// ===== INIT =====
async function init() {
  await refreshTop10();
  for (const coin of topCoins) {
    instruments[coin] = createInst(coin);
  }
  initBinance();

  // Price loop
  setInterval(async () => {
    for (const coin of topCoins) {
      const price = await fetchPrice(coin);
      if (price) {
        const inst = instruments[coin];
        inst.price = price;
        inst.priceHistory.push(price);
        if (inst.priceHistory.length > 100) inst.priceHistory.shift();
      }
    }
    checkPositions();
    broadcastState();
  }, PRICE_POLL_MS);

  // Signal loop
  setInterval(async () => {
    for (const coin of topCoins) {
      await pollSignals(coin);
    }
    broadcastState();
    console.log('[Signals] All instruments polled');
  }, SIGNAL_POLL_MS);

  // Initial signal poll
  setTimeout(async () => {
    for (const coin of topCoins) {
      await pollSignals(coin);
    }
    broadcastState();
    console.log('[Init] First signal poll complete');
  }, 10000);

  // Refresh top 10 every 6 hours
  setInterval(refreshTop10, 21600000);
}

init();

// ===== API =====
app.get('/api/state', (req, res) => {
  res.json({ portfolio, topCoins, instruments, telegramConfig: { enabled: telegramConfig.enabled, hasBotToken: !!telegramConfig.botToken, hasChatId: !!telegramConfig.chatId } });
});

app.post('/api/binance-config', (req, res) => {
  const { apiKey, apiSecret } = req.body;
  if (!apiKey || !apiSecret) return res.status(400).json({ error: 'API key et secret requis' });
  const ok = initBinance(apiKey, apiSecret);
  res.json({ success: ok, message: ok ? 'Connecté au testnet Binance' : 'Échec connexion' });
});

app.post('/api/reset', (req, res) => {
  portfolio = { balance: INITIAL_BALANCE, totalPL: 0, winCount: 0, lossCount: 0, tradeCount: 0 };
  for (const coin of topCoins) {
    instruments[coin] = createInst(coin);
  }
  broadcastState();
  res.json({ success: true });
});

app.get('/api/telegram-config', (req, res) => {
  res.json({
    enabled: telegramConfig.enabled, hasBotToken: !!telegramConfig.botToken, hasChatId: !!telegramConfig.chatId
  });
});

app.post('/api/telegram-config', (req, res) => {
  const { enabled, botToken, chatId } = req.body;
  if (enabled !== undefined) telegramConfig.enabled = enabled;
  if (botToken !== undefined) telegramConfig.botToken = botToken;
  if (chatId !== undefined) telegramConfig.chatId = chatId;
  res.json({ success: true, enabled: telegramConfig.enabled, hasBotToken: !!telegramConfig.botToken, hasChatId: !!telegramConfig.chatId });
});

app.post('/api/test-telegram', async (req, res) => {
  if (!telegramConfig.botToken || !telegramConfig.chatId) return res.status(400).json({ error: 'Config Telegram manquante' });
  try {
    await sendTelegramNotif('✅ *Lamouchi Lab Desk* — Bot quant connecté !');
    res.json({ success: true, message: 'Message envoyé' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok', coins: topCoins.length, time: new Date().toISOString() }));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ portfolio, topCoins, instruments, telegramConfig: { enabled: telegramConfig.enabled, hasBotToken: !!telegramConfig.botToken, hasChatId: !!telegramConfig.chatId } })}\n\n`);
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`   LAMOUCHI LAB DESK v2 — Quant Bot`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Balance: $${INITIAL_BALANCE} | Risque: $${RISK_PER_TRADE}/trade | Top 10 + PAXG`);
  console.log(`   Signaux: TradingView + Fear&Greed + RSI + EMA`);
  console.log(`   Notifications: Telegram`);
  console.log(`================================================================`);
});
