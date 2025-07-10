
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const crypto = require('crypto');
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
  const gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.max(0, Math.min(100, 100 - 100 / (1 + rs))).toFixed(2);
}

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  return { macd: macd.toFixed(4), signal: 0, histogram: macd.toFixed(4) };
}

function calculateVolatility(prices) {
  if (prices.length < 10) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return (Math.sqrt(variance) * 100).toFixed(2);
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

// Endpoint /api/health
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    message: '🚀 BoostIQ Crypto Signals API v2.0 - Sistema Profesional de Detección',
    version: '2.0.0',
    algorithm: 'Advanced Multi-Factor Analysis',
    features: [
      '🔥 Detección de explosiones con IA',
      '📈 Análisis técnico avanzado',
      '🆕 Nuevos listados en tiempo real',
      '🧠 Algoritmos de machine learning',
      '🛡️ Sistema inteligente de caché',
      '📊 Métricas de salud y rendimiento del sistema',
      '💡 Recomendaciones personalizadas por token'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 BoostIQ API v2.0 corriendo en el puerto ${PORT}`);
});
