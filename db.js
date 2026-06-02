const { Pool } = require('pg');

let pool = null;

function initDB() {
  if (!process.env.DATABASE_URL) return false;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  return true;
}

async function setup() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'
      )
    `);
    console.log('[DB] Initialized');
  } catch (e) { console.warn('[DB] Setup error:', e.message); }
}

async function saveState(key, data) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO state (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
      [key, JSON.stringify(data)]
    );
  } catch (e) { console.warn('[DB] Save error:', e.message); }
}

async function loadState(key) {
  if (!pool) return null;
  try {
    const res = await pool.query('SELECT value FROM state WHERE key = $1', [key]);
    if (res.rows.length > 0) return res.rows[0].value;
    return null;
  } catch (e) { console.warn('[DB] Load error:', e.message); return null; }
}

async function savePortfolio(portfolio) {
  await saveState('portfolio', {
    balance: portfolio.balance, initialBalance: portfolio.initialBalance,
    totalPL: portfolio.totalPL, winCount: portfolio.winCount,
    lossCount: portfolio.lossCount, tradeCount: portfolio.tradeCount
  });
}

async function loadPortfolio() {
  return await loadState('portfolio');
}

async function saveInstruments(instruments) {
  const data = {};
  for (const [coin, inst] of Object.entries(instruments)) {
    data[coin] = {
      price: inst.price,
      position: inst.position,
      history: inst.history ? inst.history.slice(0, 20) : [],
      analytics: inst.analytics
    };
  }
  await saveState('instruments', data);
}

async function loadInstruments() {
  return await loadState('instruments');
}

async function saveTelegram(config) {
  await saveState('telegram', { enabled: config.enabled, botToken: config.botToken, chatId: config.chatId });
}

async function loadTelegram() {
  return await loadState('telegram');
}

async function saveDemoKeys(apiKey, apiSecret) {
  await saveState('demo_keys', { apiKey, apiSecret });
}

async function loadDemoKeys() {
  return await loadState('demo_keys');
}

module.exports = { initDB, setup, savePortfolio, loadPortfolio, saveInstruments, loadInstruments, saveTelegram, loadTelegram, saveDemoKeys, loadDemoKeys, saveState, loadState };
