const express = require('express');
const path = require('path');
const ccxt = require('ccxt');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const INITIAL_BALANCE = 5000;
const RISK_PER_TRADE = 15;
const SIGNAL_POLL_MS = 60000;
const PRICE_POLL_MS = 5000;
const SCALP_SL_ATR = 0.8;
const SCALP_TP_ATR = 1.5;

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

// 3. DOM — Order Book Depth Imbalance
async function fetchDOMSignal(coin) {
  try {
    const res = await fetch(`${DEMO_API}/api/v3/depth?symbol=${coin}USDT&limit=20`);
    const d = await res.json();
    if (!d.bids || !d.asks) return 'NEUTRAL';
    const bidVol = d.bids.reduce((a, b) => a + parseFloat(b[0]) * parseFloat(b[1]), 0);
    const askVol = d.asks.reduce((a, b) => a + parseFloat(b[0]) * parseFloat(b[1]), 0);
    if (bidVol === 0 || askVol === 0) return 'NEUTRAL';
    const ratio = bidVol / askVol;
    if (ratio > 1.3) return 'BUY';
    if (ratio < 0.7) return 'SELL';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// 4. Order Flow — Trade aggressor analysis
async function fetchOrderFlowSignal(coin) {
  try {
    const res = await fetch(`${DEMO_API}/api/v3/trades?symbol=${coin}USDT&limit=100`);
    const trades = await res.json();
    if (!trades.length) return 'NEUTRAL';
    const buyVol = trades.filter(t => !t.isBuyerMaker).reduce((a, t) => a + parseFloat(t.qty), 0);
    const sellVol = trades.filter(t => t.isBuyerMaker).reduce((a, t) => a + parseFloat(t.qty), 0);
    if (sellVol === 0) return buyVol > 0 ? 'BUY' : 'NEUTRAL';
    const ratio = buyVol / sellVol;
    if (ratio > 1.2) return 'BUY';
    if (ratio < 0.8) return 'SELL';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
}

// 5. VWAP
async function fetchVWAPSignal(coin) {
  try {
    const res = await fetch(`${DEMO_API}/api/v3/klines?symbol=${coin}USDT&interval=1h&limit=24`);
    const klines = await res.json();
    if (!klines.length) return 'NEUTRAL';
    let volSum = 0, pvSum = 0;
    for (const k of klines) {
      const high = parseFloat(k[2]), low = parseFloat(k[3]), close = parseFloat(k[4]), vol = parseFloat(k[5]);
      const typPrice = (high + low + close) / 3;
      volSum += vol;
      pvSum += typPrice * vol;
    }
    const vwap = pvSum / volSum;
    const priceRes = await fetch(`${DEMO_API}/api/v3/ticker/price?symbol=${coin}USDT`);
    const priceJson = await priceRes.json();
    const price = parseFloat(priceJson.price);
    if (!price || !vwap) return 'NEUTRAL';
    const dev = (price - vwap) / vwap;
    if (dev > 0.005) return 'BUY';
    if (dev < -0.005) return 'SELL';
    return 'NEUTRAL';
  } catch { return 'NEUTRAL'; }
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

// ===== BINANCE DEMO API =====
const fs = require('fs');
const DEMO_API = 'https://demo-api.binance.com';
const KEY_FILE = path.join(__dirname, '.demo-keys.json');
let demoApiKey = '';
let demoApiSecret = '';

function loadKeys() {
  try {
    const data = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    demoApiKey = data.apiKey || '';
    demoApiSecret = data.apiSecret || '';
    if (demoApiKey) console.log('[Demo] Clés chargées depuis fichier');
  } catch {}
}

function saveKeys(apiKey, apiSecret) {
  try {
    fs.writeFileSync(KEY_FILE, JSON.stringify({ apiKey, apiSecret }));
  } catch (e) { console.warn('[Demo] Erreur sauvegarde clés:', e.message); }
}

function initDemoAPI(apiKey, apiSecret) {
  demoApiKey = apiKey || '';
  demoApiSecret = apiSecret || '';
  if (apiKey && apiSecret) saveKeys(apiKey, apiSecret);
  return true;
}

async function binanceRequest(endpoint, params = {}, baseUrl = DEMO_API) {
  const ts = Date.now();
  const allParams = { ...params, timestamp: ts, recvWindow: 10000 };
  const qs = Object.entries(allParams).map(([k, v]) => `${k}=${v}`).join('&');
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', demoApiSecret).update(qs).digest('hex');
  const url = `${baseUrl}${endpoint}?${qs}&signature=${sig}`;
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': demoApiKey } });
  const txt = await res.text();
  return JSON.parse(txt);
}

  const CG_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', XRP: 'ripple',
    SOL: 'solana', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2',
    DOT: 'polkadot', LINK: 'chainlink', PAXG: 'pax-gold'
  };
  const CG_NAMES = Object.values(CG_IDS).join(',');

  async function fetchAllPrices() {
    const prices = {};
    // CoinGecko batch (1 call for all coins)
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CG_NAMES}&vs_currencies=usd`);
      if (res.status === 200) {
        const json = await res.json();
        for (const [sym, id] of Object.entries(CG_IDS)) {
          const p = parseFloat(json[id]?.usd);
          if (!isNaN(p) && p > 0) prices[sym] = p;
        }
      }
    } catch {}
    // Fallback for missing coins: try Binance individually
    for (const [sym, id] of Object.entries(CG_IDS)) {
      if (prices[sym]) continue;
      for (const base of ['https://api.binance.com', DEMO_API]) {
        try {
          const res = await fetch(`${base}/api/v3/ticker/price?symbol=${sym}USDT`);
          if (res.status !== 200) continue;
          const json = await res.json();
          const p = parseFloat(json.price);
          if (!isNaN(p) && p > 0) { prices[sym] = p; break; }
        } catch {}
      }
    }
    return prices;
  }

async function demoBalance() {
  if (!demoApiKey || !demoApiSecret) return null;
  for (const base of ['https://api.binance.com', DEMO_API]) {
    try {
      const data = await binanceRequest('/api/v3/account', {}, base);
      const usdt = data.balances?.find(b => b.asset === 'USDT');
      if (usdt && parseFloat(usdt.free) > 0) return parseFloat(usdt.free);
    } catch {}
  }
  return null;
}

// ===== STATE =====
let clients = [];
let totalPL = 0;

let portfolio = {
  balance: INITIAL_BALANCE,
  initialBalance: INITIAL_BALANCE,
  totalPL: 0,
  unrealizedPL: 0,
  totalEquity: INITIAL_BALANCE,
  winCount: 0,
  lossCount: 0,
  tradeCount: 0
};

let instruments = {};

function defaultSources() {
  return { tradingview: 'NEUTRAL', feargreed: 'NEUTRAL', dom: 'NEUTRAL', orderflow: 'NEUTRAL', vwap: 'NEUTRAL' };
}

function createInst(coin) {
  const nameMap = {
    BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', XRP: 'XRP',
    SOL: 'Solana', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche',
    DOT: 'Polkadot', LINK: 'Chainlink', PAXG: 'Pax Gold'
  };
  return {
    coin, name: nameMap[coin] || coin,
    price: 0, priceHistory: [],
    sources: defaultSources(),
    confluence: 'NEUTRAL', confluenceScore: 0,
    position: null,
    history: [],
    analytics: { wins: 0, losses: 0, pl: 0, totalPL: 0 }
  };
}

function calcConfluence(inst) {
  const weights = { tradingview: 1.2, feargreed: 1.0, dom: 1.0, orderflow: 1.0, vwap: 1.0 };
  let score = 0, maxP = 0;
  for (const [k, w] of Object.entries(weights)) {
    maxP += w;
    if (inst.sources[k] === 'BUY') score += w;
    else if (inst.sources[k] === 'SELL') score -= w;
  }

  // Momentum boost: price moved >0.15% = extra conviction
  const ph = inst.priceHistory;
  if (ph.length >= 6) {
    const pNow = ph[ph.length - 1];
    const pPrev = ph[Math.max(0, ph.length - 12)];
    if (pNow && pPrev) {
      const chg = Math.abs((pNow - pPrev) / pPrev);
      if (chg > 0.0015) {
        const boost = chg > 0.003 ? 0.8 : 0.4;
        if (score > 0) score += boost;
        else if (score < 0) score -= boost;
      }
    }
  }

  inst.confluenceScore = parseFloat(score.toFixed(2));
  const threshold = maxP * 0.15;
  let conf = 'NEUTRAL';
  if (score >= threshold) conf = 'BUY';
  else if (score <= -threshold) conf = 'SELL';
  const prev = inst.confluence;
  inst.confluence = conf;

  // Aggressive: trigger on any new signal, flip on opposite
  if (conf === 'NEUTRAL') return null;
  if (prev === 'NEUTRAL') return conf;
  if (prev !== conf) return conf;
  return null;
}

// ===== SIGNAL POLLING =====
async function pollSignals(coin) {
  const inst = instruments[coin];
  if (!inst || inst.price <= 0) return;

  const [tvSig, fgSig, domSig, ofSig, vwapSig] = await Promise.all([
    fetchTradingView(coin),
    fetchFearGreed(),
    fetchDOMSignal(coin),
    fetchOrderFlowSignal(coin),
    fetchVWAPSignal(coin)
  ]);

  inst.sources = {
    tradingview: tvSig,
    feargreed: fgSig,
    dom: domSig,
    orderflow: ofSig,
    vwap: vwapSig
  };

  const signal = calcConfluence(inst);
  if (signal) await executeTrade(coin, signal);
}

// ===== POSITION SIZING =====
function computeSLTP(price, side, atr) {
  const slDist = Math.max(atr * SCALP_SL_ATR, price * 0.002);
  const tpDist = Math.max(atr * SCALP_TP_ATR, price * 0.006);
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
async function binanceOrder(coin, side, qty) {
  if (!demoApiKey || !demoApiSecret) return null;
  for (const base of ['https://api.binance.com', DEMO_API]) {
    try {
      const data = await binanceRequest('/api/v3/order', {
        symbol: `${coin}USDT`, side, type: 'MARKET', quantity: qty
      }, base);
      if (data && data.orderId) return data;
    } catch {}
  }
  return null;
}

async function executeTrade(coin, side) {
  const inst = instruments[coin];
  if (inst.position) return;

  const price = inst.price;
  const atr = inst.priceHistory.length > 14 ? calcRSI(inst.priceHistory) * price * 0.002 : price * 0.01;
  const { sl, tp } = computeSLTP(price, side, atr);
  const qty = calcSize(price, sl, side);
  if (qty <= 0) return;

  // Place real market order on Binance
  const binanceSide = side === 'BUY' ? 'BUY' : 'SELL';
  const order = await binanceOrder(coin, binanceSide, qty);
  if (!order) {
    console.warn(`[TRADE] ${side} ${coin} @ ${price} - FAILED (Binance API unreachable) - PAPER MODE`);
    // Fall back to paper mode if API unreachable
  } else {
    console.log(`[TRADE] ${side} ${coin} @ ${price} x${qty} | Binance order #${order.orderId}`);
  }

  const pos = {
    id: (order?.orderId || Date.now()).toString(),
    coin, side, entryPrice: price, qty, sl, tp,
    status: 'ACTIVE', exitPrice: null, pl: null,
    openedAt: new Date().toISOString()
  };

  console.log(`[TRADE] ${side} ${coin} @ ${price} x${qty} | SL: ${sl.toFixed(2)} TP: ${tp.toFixed(2)}`);
  db.saveInstruments(instruments);

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

  // Close real position on Binance
  const binanceSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
  const order = await binanceOrder(coin, binanceSide, pos.qty);
  if (order) {
    console.log(`[CLOSE] ${coin} ${pos.side} close order #${order.orderId}`);
  }

  const exitPrice = inst.price;
  const isLong = pos.side === 'BUY';
  const plPct = isLong ? ((exitPrice - pos.entryPrice) / pos.entryPrice) : ((pos.entryPrice - exitPrice) / pos.entryPrice);
  const plDollars = plPct * pos.qty * pos.entryPrice;

  pos.status = reason === 'TP' ? 'WIN' : 'LOSS';
  pos.exitPrice = exitPrice;
  pos.pl = parseFloat(plDollars.toFixed(2));
  pos.closedAt = new Date().toISOString();

  portfolio.totalPL = parseFloat((portfolio.totalPL + plDollars).toFixed(2));
  portfolio.balance = parseFloat((portfolio.initialBalance + portfolio.totalPL).toFixed(2));
  if (pos.status === 'WIN') portfolio.winCount++;
  else portfolio.lossCount++;

  inst.analytics.wins += pos.status === 'WIN' ? 1 : 0;
  inst.analytics.losses += pos.status === 'LOSS' ? 1 : 0;
  inst.analytics.pl += plDollars;

  inst.history.unshift(pos);
  inst.position = null;

  db.savePortfolio(portfolio);
  db.saveInstruments(instruments);

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
function calcUnrealizedPL() {
  let pl = 0;
  for (const coin of topCoins) {
    const pos = instruments[coin]?.position;
    if (!pos) continue;
    const price = instruments[coin].price;
    if (!price) continue;
    if (pos.side === 'BUY') pl += (price - pos.entryPrice) * pos.qty;
    else pl += (pos.entryPrice - price) * pos.qty;
  }
  return parseFloat(pl.toFixed(2));
}

function broadcastState() {
  portfolio.unrealizedPL = calcUnrealizedPL();
  portfolio.totalEquity = parseFloat((portfolio.initialBalance + portfolio.totalPL + portfolio.unrealizedPL).toFixed(2));
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
  const hasDB = db.initDB();
  if (hasDB) await db.setup();

  // Load persisted state from DB
  if (hasDB) {
    const savedPortfolio = await db.loadPortfolio();
    if (savedPortfolio) {
      portfolio.balance = savedPortfolio.balance;
      portfolio.initialBalance = savedPortfolio.initialBalance;
      portfolio.totalPL = savedPortfolio.totalPL;
      portfolio.winCount = savedPortfolio.winCount;
      portfolio.lossCount = savedPortfolio.lossCount;
      portfolio.tradeCount = savedPortfolio.tradeCount;
      console.log('[DB] Portfolio restored');
    }
    const savedTelegram = await db.loadTelegram();
    if (savedTelegram) {
      telegramConfig.enabled = savedTelegram.enabled;
      telegramConfig.botToken = savedTelegram.botToken || '';
      telegramConfig.chatId = savedTelegram.chatId || '';
      console.log('[DB] Telegram config restored');
    }
    const savedKeys = await db.loadDemoKeys();
    if (savedKeys) {
      demoApiKey = savedKeys.apiKey || '';
      demoApiSecret = savedKeys.apiSecret || '';
      console.log('[DB] Demo keys restored');
    }
  }

  await refreshTop10();
  for (const coin of topCoins) {
    instruments[coin] = createInst(coin);
  }
  loadKeys();

  // Restore open positions from DB
  if (hasDB) {
    const savedInsts = await db.loadInstruments();
    if (savedInsts) {
      for (const [coin, data] of Object.entries(savedInsts)) {
        if (instruments[coin]) {
          if (data.position) instruments[coin].position = data.position;
          if (data.history) instruments[coin].history = data.history;
          if (data.analytics) instruments[coin].analytics = data.analytics;
        }
      }
      console.log('[DB] Positions restored');
    }
  }

  // Snapshot initial demo balance
  setTimeout(async () => {
    const bal = await demoBalance();
    if (bal != null && !portfolio.initialBalance) {
      portfolio.initialBalance = parseFloat(bal.toFixed(2));
      portfolio.balance = portfolio.initialBalance;
      if (hasDB) db.savePortfolio(portfolio);
    }
  }, 5000);

  // Price loop
  setInterval(async () => {
    const prices = await fetchAllPrices();
    for (const coin of topCoins) {
      const price = prices[coin];
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
    console.log('[Scalp] All instruments polled (60s)');
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
  const ok = initDemoAPI(apiKey, apiSecret);
  db.saveDemoKeys(apiKey, apiSecret);
  res.json({ success: ok, message: ok ? 'Connecté au Binance Demo' : 'Échec connexion' });
});

app.post('/api/reset', (req, res) => {
  portfolio = { balance: INITIAL_BALANCE, totalPL: 0, unrealizedPL: 0, totalEquity: INITIAL_BALANCE, winCount: 0, lossCount: 0, tradeCount: 0 };
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
  db.saveTelegram(telegramConfig);
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
   console.log(`   Balance: $${INITIAL_BALANCE} | Risque: $${RISK_PER_TRADE}/trade | Top 10 + PAXG | SCALP 0.8/1.5 ATR`);
   console.log(`   Signaux: TradingView + Fear&Greed + DOM + OrderFlow + VWAP`);
  console.log(`   Notifications: Telegram`);
  console.log(`================================================================`);
});
