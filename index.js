// index.js completo con endpoints funcionales y lógica original restaurada
// Contiene /explosions, /new-listings, /analysis/:symbol y /recommendation/:symbol
// Clave protegida, lógica respetada, sin cortar nada

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

const cache = new NodeCache({ stdTTL: 180 });
const longCache = new NodeCache({ stdTTL: 3600 });

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

const binanceHeaders = {
  'X-MBX-APIKEY': BINANCE_API_KEY,
  'Content-Type': 'application/json'
};

const POPULAR_TOKENS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT',
  'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'MATICUSDT',
  'AVAXUSDT', 'ATOMUSDT', 'FTMUSDT', 'NEARUSDT', 'ALGOUSDT', 'XLMUSDT',
  'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT', 'THETAUSDT'
];

async function fetchBinanceData(endpoint) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/${endpoint}`, {
      headers: binanceHeaders,
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message);
    throw error;
  }
}

async function get24hrVolume(symbol) {
  try {
    const data = await fetchBinanceData(`ticker/24hr?symbol=${symbol}`);
    return {
      volume: parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume),
      count: parseInt(data.count)
    };
  } catch {
    return { volume: 0, quoteVolume: 0, count: 0 };
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.max(0, Math.min(100, 100 - 100 / (1 + rs))).toFixed(2);
}

function calculateExplosionScore(ticker, volumeData, prices) {
  const priceChange = parseFloat(ticker.priceChangePercent);
  const volume24h = volumeData.quoteVolume;
  const trades = volumeData.count;
  const rsi = parseFloat(calculateRSI(prices));

  let score = 0;
  if (priceChange > 25) score += 40;
  else if (priceChange > 20) score += 35;
  else if (priceChange > 15) score += 30;
  else if (priceChange > 10) score += 20;
  else if (priceChange > 5) score += 10;

  if (volume24h > 5000000) score += 25;
  else if (volume24h > 2000000) score += 20;
  else if (volume24h > 1000000) score += 15;
  else if (volume24h > 500000) score += 10;
  else if (volume24h > 100000) score += 5;

  if (trades > 50000) score += 10;
  else if (trades > 20000) score += 8;
  else if (trades > 10000) score += 6;
  else if (trades > 5000) score += 4;
  else if (trades > 1000) score += 2;

  if (rsi > 30 && rsi < 70) score += 10;
  else if (rsi > 70) score += 5;

  return Math.min(score, 100);
}

async function getHistoricalPrices(symbol, interval = '1h', limit = 50) {
  const cacheKey = `prices_${symbol}_${interval}_${limit}`;
  const cached = longCache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchBinanceData(`klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const prices = data.map(c => parseFloat(c[4]));
  longCache.set(cacheKey, prices);
  return prices;
}

async function detectNewListings(tickers) {
  const candidates = [];
  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith('USDT')) continue;
    if (POPULAR_TOKENS.includes(ticker.symbol)) continue;

    const volume24h = parseFloat(ticker.quoteVolume);
    const priceChange = parseFloat(ticker.priceChangePercent);
    const trades = parseInt(ticker.count);

    if (volume24h > 50000 && volume24h < 10000000 &&
        trades > 500 && trades < 100000 &&
        priceChange > -50 && priceChange < 200 &&
        parseFloat(ticker.lastPrice) > 0) {
      candidates.push({
        symbol: ticker.symbol,
        price: ticker.lastPrice,
        volume: volume24h,
        trades,
        priceChange,
        score: Math.min(
          (trades / 1000) * 20 +
          (volume24h / 100000) * 15 +
          (priceChange > 0 ? priceChange * 2 : 0) +
          (priceChange > 10 ? 20 : 0), 
          100
        )
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

// --- ENDPOINTS ---

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/explosions', async (req, res) => {
  try {
    const tickers = await fetchBinanceData('ticker/24hr');
    const results = [];

    for (const ticker of tickers) {
      if (!ticker.symbol.endsWith('USDT') || POPULAR_TOKENS.includes(ticker.symbol)) continue;

      const volumeData = await get24hrVolume(ticker.symbol);
      const prices = await getHistoricalPrices(ticker.symbol);
      const score = calculateExplosionScore(ticker, volumeData, prices);

      if (score >= 70) {
        results.push({
          symbol: ticker.symbol,
          score,
          priceChange: ticker.priceChangePercent,
          lastPrice: ticker.lastPrice
        });
      }
    }

    res.json(results.sort((a, b) => b.score - a.score));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/new-listings', async (req, res) => {
  try {
    const tickers = await fetchBinanceData('ticker/24hr');
    const listings = await detectNewListings(tickers);
    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const prices = await getHistoricalPrices(symbol);
    const rsi = calculateRSI(prices);
    res.json({ symbol, rsi });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/recommendation/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const ticker = await fetchBinanceData(`ticker/24hr?symbol=${symbol}`);
    const volumeData = await get24hrVolume(symbol);
    const prices = await getHistoricalPrices(symbol);
    const score = calculateExplosionScore(ticker, volumeData, prices);

    let recommendation = '❌ EVITAR';
    if (score >= 85) recommendation = '🚀 COMPRA INMEDIATA';
    else if (score >= 70) recommendation = '🔥 COMPRA FUERTE';
    else if (score >= 50) recommendation = '⚡ OBSERVAR';
    else if (score >= 35) recommendation = '👀 MONITOREAR';

    res.json({ symbol, score, recommendation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BoostIQ API corriendo en el puerto ${PORT}`);
});
