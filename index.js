'const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

// Configuración optimizada para señales de trading
const CONFIG = {
  MIN_VOLUME_EXPLOSION: 100000,
  MIN_VOLUME_REGULAR: 50000,
  MIN_GAIN_EXPLOSION: 8,
  MIN_GAIN_REGULAR: 5,
  TOP_COUNT: 5,
  BINANCE_API_URL: "https://api.binance.com/api/v3/ticker/24hr",
  BINANCE_KLINES_URL: "https://api.binance.com/api/v3/klines",
  CACHE_DURATION: 30000,
  REQUEST_TIMEOUT: 10000,
  PORT: process.env.PORT || 8080
};

let explosionCache = null;
let regularCache = null;
let newListingsCache = null;
let lastExplosionFetch = 0;
let lastRegularFetch = 0;
let lastNewListingsFetch = 0;

app.use(cors({ origin: '*' }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  message: { error: "Rate limit exceeded" }
});
app.use("/api/", limiter);

const calculateSimpleRSI = (prices) => {
  if (prices.length < 14) return 50;
  const gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

const calculateEMA = (prices, period) => {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  return ema;
};

const calculateMACD = (prices) => {
  if (prices.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calculateEMA([macdLine], 9);
  const histogram = macdLine - signalLine;
  return {
    macd: macdLine.toFixed(4),
    signal: signalLine.toFixed(4),
    histogram: histogram.toFixed(4)
  };
};

const calculateVolatility = (prices) => {
  if (prices.length < 10) return 0;
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
};

const getKlineData = async (symbol, interval = '1h', limit = 50) => {
  try {
    const response = await axios.get(CONFIG.BINANCE_KLINES_URL, {
      params: { symbol, interval, limit },
      timeout: CONFIG.REQUEST_TIMEOUT
    });
    return response.data.map(k => parseFloat(k[4]));
  } catch {
    return [];
  }
};

app.get("/api/analysis/:symbol", async (req, res) => {
  const symbol = req.params.symbol;
  try {
    const prices = await getKlineData(symbol);
    const rsi = calculateSimpleRSI(prices);
    const macd = calculateMACD(prices);
    const volatility = calculateVolatility(prices).toFixed(2);
    res.json({
      symbol,
      rsi: rsi.toFixed(2),
      macd,
      volatility,
      trend: rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral"
    });
  } catch (e) {
    res.status(500).json({ error: "Error in technical analysis", message: e.message });
  }
});

app.get("/api/recommendation/:symbol", async (req, res) => {
  const symbol = req.params.symbol;
  try {
    const prices = await getKlineData(symbol);
    const rsi = calculateSimpleRSI(prices);
    const lastPrice = prices[prices.length - 1];
    const target = lastPrice * 1.08;
    const stop = lastPrice * 0.95;
    res.json({
      symbol,
      buyPrice: lastPrice.toFixed(6),
      sellTarget: target.toFixed(6),
      stopLoss: stop.toFixed(6),
      confidence: (rsi >= 30 && rsi <= 70) ? 0.8 : 0.5,
      timeframe: "1h",
      emoji: rsi > 70 ? "⚠️" : rsi < 30 ? "🔥" : "🚀"
    });
  } catch (e) {
    res.status(500).json({ error: "Recommendation failed", message: e.message });
  }
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 BoostIQ API corriendo en el puerto ${CONFIG.PORT}`);
});
