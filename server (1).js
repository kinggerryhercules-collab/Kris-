'use strict';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cron = require('node-cron');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── ENV KEYS (set these in your environment) ───────────────────────────────
const TWELVE_DATA_KEY  = process.env.TWELVE_DATA_KEY  || '';
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY || '';
const FSC_KEY           = process.env.FSC_KEY           || '';
const GEMINI_KEY        = process.env.GEMINI_KEY        || '';

// ─── INSTRUMENTS ────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  // Crypto
  { symbol: 'BTCUSDT',  display: 'BTC/USD',  type: 'crypto',  binance: 'BTCUSDT',  av: 'BTC',    yahoo: null         },
  { symbol: 'ETHUSDT',  display: 'ETH/USD',  type: 'crypto',  binance: 'ETHUSDT',  av: 'ETH',    yahoo: null         },
  { symbol: 'SOLUSDT',  display: 'SOL/USD',  type: 'crypto',  binance: 'SOLUSDT',  av: 'SOL',    yahoo: null         },
  { symbol: 'BNBUSDT',  display: 'BNB/USD',  type: 'crypto',  binance: 'BNBUSDT',  av: 'BNB',    yahoo: null         },
  { symbol: 'XRPUSDT',  display: 'XRP/USD',  type: 'crypto',  binance: 'XRPUSDT',  av: 'XRP',    yahoo: null         },
  // Forex
  { symbol: 'EURUSD',   display: 'EUR/USD',  type: 'forex',   binance: null,        av: 'EURUSD', yahoo: 'EURUSD=X'  },
  { symbol: 'GBPUSD',   display: 'GBP/USD',  type: 'forex',   binance: null,        av: 'GBPUSD', yahoo: 'GBPUSD=X'  },
  { symbol: 'USDJPY',   display: 'USD/JPY',  type: 'forex',   binance: null,        av: 'USDJPY', yahoo: 'USDJPY=X'  },
  { symbol: 'AUDUSD',   display: 'AUD/USD',  type: 'forex',   binance: null,        av: 'AUDUSD', yahoo: 'AUDUSD=X'  },
  { symbol: 'USDCAD',   display: 'USD/CAD',  type: 'forex',   binance: null,        av: 'USDCAD', yahoo: 'USDCAD=X'  },
  // Indices
  { symbol: 'SPX',      display: 'S&P 500',  type: 'index',   binance: null,        av: 'SPX',    yahoo: '^GSPC'     },
  { symbol: 'NAS100',   display: 'NASDAQ',   type: 'index',   binance: null,        av: 'NDX',    yahoo: '^NDX'      },
  { symbol: 'US30',     display: 'DOW 30',   type: 'index',   binance: null,        av: 'DJI',    yahoo: '^DJI'      },
  { symbol: 'GER40',    display: 'DAX 40',   type: 'index',   binance: null,        av: 'DAX',    yahoo: '^GDAXI'    },
  { symbol: 'XAUUSD',   display: 'GOLD',     type: 'commodity',binance: null,       av: 'XAUUSD', yahoo: 'GC=F'      },
];

// ─── IN-MEMORY STORES ────────────────────────────────────────────────────────
let signalHistory = [];
let currentSignals = {};
let marketPrices = {};

// ─── INTERVAL MAPPERS ────────────────────────────────────────────────────────
const BINANCE_INTERVAL = { '4h': '4h', '15min': '15m', '5min': '5m' };
const YAHOO_RANGE = { '4h': '60d', '15min': '5d', '5min': '1d' };
const YAHOO_INTERVAL = { '4h': '1h', '15min': '15m', '5min': '5m' };

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA FETCHERS — FALLBACK CHAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchTwelveData(instrument, interval, outputSize = 200) {
  if (!TWELVE_DATA_KEY) throw new Error('No Twelve Data key');
  const sym = instrument.type === 'crypto'
    ? `${instrument.symbol.replace('USDT','')}/USD`
    : instrument.symbol;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${interval}&outputsize=${outputSize}&apikey=${TWELVE_DATA_KEY}`;
  const res = await fetch(url, { timeout: 8000 });
  const data = await res.json();
  if (!data.values || data.status === 'error') throw new Error(data.message || 'Twelve Data error');
  return data.values.reverse().map(c => ({
    time: new Date(c.datetime).getTime(),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low:  parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume || 0),
  }));
}

async function fetchAlphaVantage(instrument, interval) {
  if (!ALPHA_VANTAGE_KEY) throw new Error('No Alpha Vantage key');
  const funcMap = { '4h': 'TIME_SERIES_INTRADAY', '15min': 'TIME_SERIES_INTRADAY', '5min': 'TIME_SERIES_INTRADAY' };
  const avInterval = interval === '4h' ? '60min' : interval;
  let url;
  if (instrument.type === 'crypto') {
    url = `https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=${instrument.av}&market=USD&interval=${avInterval}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
  } else if (instrument.type === 'forex') {
    url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${instrument.av.slice(0,3)}&to_symbol=${instrument.av.slice(3)}&interval=${avInterval}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
  } else {
    url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${instrument.av}&interval=${avInterval}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
  }
  const res = await fetch(url, { timeout: 8000 });
  const data = await res.json();
  const key = Object.keys(data).find(k => k.includes('Time Series'));
  if (!key) throw new Error('Alpha Vantage error or rate limit');
  const series = data[key];
  return Object.entries(series).reverse().slice(0, 200).map(([dt, v]) => ({
    time: new Date(dt).getTime(),
    open:  parseFloat(v['1. open']  || v['1a. open (USD)']),
    high:  parseFloat(v['2. high']  || v['2a. high (USD)']),
    low:   parseFloat(v['3. low']   || v['3a. low (USD)']),
    close: parseFloat(v['4. close'] || v['4a. close (USD)']),
    volume: 0,
  }));
}

async function fetchFSC(instrument, interval) {
  if (!FSC_KEY) throw new Error('No FSC key');
  const sym = instrument.type === 'crypto' ? instrument.symbol : instrument.symbol;
  const url = `https://financials.fcsapi.com/api-v3/time_series?symbol=${sym}&period=${interval}&apikey=${FSC_KEY}&level=1`;
  const res = await fetch(url, { timeout: 8000 });
  const data = await res.json();
  if (!data.response || !Array.isArray(data.response)) throw new Error('FSC error');
  return data.response.reverse().map(c => ({
    time: new Date(c.tm).getTime(),
    open: parseFloat(c.o), high: parseFloat(c.h),
    low: parseFloat(c.l), close: parseFloat(c.c), volume: 0,
  }));
}

async function fetchBinance(instrument, interval) {
  if (!instrument.binance) throw new Error('Not a Binance symbol');
  const bInterval = BINANCE_INTERVAL[interval] || '15m';
  const url = `https://api.binance.com/api/v3/klines?symbol=${instrument.binance}&interval=${bInterval}&limit=500`;
  const res = await fetch(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Binance bad response');
  return data.map(k => ({
    time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}

async function fetchYahoo(instrument, interval) {
  if (!instrument.yahoo) throw new Error('No Yahoo symbol');
  const range = YAHOO_RANGE[interval] || '5d';
  const yInterval = YAHOO_INTERVAL[interval] || '15m';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${instrument.yahoo}?interval=${yInterval}&range=${range}`;
  const res = await fetch(url, {
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo no data');
  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];
  return timestamps.map((t, i) => ({
    time: t * 1000,
    open: q.open[i], high: q.high[i],
    low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0,
  })).filter(c => c.open && c.high && c.low && c.close);
}

async function fetchCandles(instrument, interval) {
  const errors = [];
  // Priority 1: Twelve Data
  try { return await fetchTwelveData(instrument, interval); } catch(e) { errors.push(`TwelveData: ${e.message}`); }
  // Priority 2: Alpha Vantage
  try { return await fetchAlphaVantage(instrument, interval); } catch(e) { errors.push(`AlphaVantage: ${e.message}`); }
  // Priority 3: FSC
  try { return await fetchFSC(instrument, interval); } catch(e) { errors.push(`FSC: ${e.message}`); }
  // Priority 4: Binance (crypto) / Yahoo (forex+indices)
  if (instrument.type === 'crypto') {
    try { return await fetchBinance(instrument, interval); } catch(e) { errors.push(`Binance: ${e.message}`); }
  } else {
    try { return await fetchYahoo(instrument, interval); } catch(e) { errors.push(`Yahoo: ${e.message}`); }
  }
  throw new Error(`All sources failed: ${errors.join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TECHNICAL INDICATOR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(...Array(period - 1).fill(null));
  result.push(emaPrev);
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    result.push(emaPrev);
  }
  return result;
}

function calcFibLevels(candles) {
  const subset = candles.slice(-200);
  const high = Math.max(...subset.map(c => c.high));
  const low  = Math.min(...subset.map(c => c.low));
  const range = high - low;
  return {
    high, low, range,
    fib786: high - range * 0.214,
    fib618: high - range * 0.382,
    fib500: high - range * 0.500,
    fib382: high - range * 0.618,
    fib214: high - range * 0.786,
  };
}

function detectSwings(candles, lookback = 5) {
  const swingHighs = [], swingLows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;
    const isHigh = candles.slice(i - lookback, i).every(c => c.high <= hi)
                && candles.slice(i + 1, i + lookback + 1).every(c => c.high <= hi);
    const isLow  = candles.slice(i - lookback, i).every(c => c.low >= lo)
                && candles.slice(i + 1, i + lookback + 1).every(c => c.low >= lo);
    if (isHigh) swingHighs.push({ index: i, price: hi, time: candles[i].time });
    if (isLow)  swingLows.push({ index: i, price: lo, time: candles[i].time });
  }
  return { swingHighs, swingLows };
}

function detectOrderBlocks(candles) {
  const bullishOBs = [], bearishOBs = [];
  for (let i = 1; i < candles.length - 3; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    if (c.close < c.open && next.close > next.open && next.close > c.high) {
      bullishOBs.push({ high: c.high, low: c.low, index: i, time: c.time });
    }
    if (c.close > c.open && next.close < next.open && next.close < c.low) {
      bearishOBs.push({ high: c.high, low: c.low, index: i, time: c.time });
    }
  }
  return { bullishOBs: bullishOBs.slice(-5), bearishOBs: bearishOBs.slice(-5) };
}

function detectFVG(candles) {
  const bullishFVGs = [], bearishFVGs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], curr = candles[i], next = candles[i + 1];
    if (next.low > prev.high) bullishFVGs.push({ low: prev.high, high: next.low, index: i });
    if (next.high < prev.low) bearishFVGs.push({ low: next.high, high: prev.low, index: i });
  }
  return { bullishFVGs: bullishFVGs.slice(-5), bearishFVGs: bearishFVGs.slice(-5) };
}

function detectLiquiditySweep(candles) {
  const last = candles.slice(-20);
  let sslSwept = false, bslSwept = false, sslLevel = null, bslLevel = null;
  const lows = last.map(c => c.low);
  const highs = last.map(c => c.high);
  const avgLow = lows.slice(0, -1).reduce((a, b) => a + b, 0) / (lows.length - 1);
  const avgHigh = highs.slice(0, -1).reduce((a, b) => a + b, 0) / (highs.length - 1);
  const lastC = last[last.length - 1];
  const prevC = last[last.length - 2];

  // SSL: swept below equal lows then reversed up
  const equalLows = lows.slice(0, -2).filter(l => Math.abs(l - lows[lows.length - 3]) / lows[lows.length - 3] < 0.002);
  if (equalLows.length >= 1) {
    const clusterLow = Math.min(...equalLows);
    if (lastC.low < clusterLow && lastC.close > prevC.close) {
      sslSwept = true; sslLevel = clusterLow;
    }
  }
  // BSL: swept above equal highs then reversed down
  const equalHighs = highs.slice(0, -2).filter(h => Math.abs(h - highs[highs.length - 3]) / highs[highs.length - 3] < 0.002);
  if (equalHighs.length >= 1) {
    const clusterHigh = Math.max(...equalHighs);
    if (lastC.high > clusterHigh && lastC.close < prevC.close) {
      bslSwept = true; bslLevel = clusterHigh;
    }
  }
  return { sslSwept, bslSwept, sslLevel, bslLevel };
}

function detectCRT(candles) {
  if (candles.length < 3) return { crtForming: false, crtConfirmed: false, direction: null };
  const ref = candles[candles.length - 3];
  const manip = candles[candles.length - 2];
  const confirm = candles[candles.length - 1];

  // Bullish CRT: manip sweeps below ref low, confirm breaks above ref high
  if (manip.low < ref.low && manip.close > ref.low) {
    if (confirm.close > ref.high) return { crtForming: false, crtConfirmed: true, direction: 'bullish', refHigh: ref.high, refLow: ref.low, manipLow: manip.low };
    return { crtForming: true, crtConfirmed: false, direction: 'bullish' };
  }
  // Bearish CRT: manip sweeps above ref high, confirm breaks below ref low
  if (manip.high > ref.high && manip.close < ref.high) {
    if (confirm.close < ref.low) return { crtForming: false, crtConfirmed: true, direction: 'bearish', refHigh: ref.high, refLow: ref.low, manipHigh: manip.high };
    return { crtForming: true, crtConfirmed: false, direction: 'bearish' };
  }
  return { crtForming: false, crtConfirmed: false, direction: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GEMINI AI ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

async function analyzeWithGemini(instrument, candles4h, candles15m, candles5m) {
  if (!GEMINI_KEY) return generateFallbackAnalysis(instrument, candles4h, candles15m, candles5m);

  // Pre-compute indicators to send to Gemini
  const closes4h = candles4h.map(c => c.close);
  const closes15m = candles15m.map(c => c.close);
  const ema5_4h  = ema(closes4h, 5);
  const ema13_4h = ema(closes4h, 13);
  const ema89_4h = ema(closes4h, 89);
  const ema5_15m = ema(closes15m, 5);
  const ema13_15m = ema(closes15m, 13);
  const fib = calcFibLevels(candles4h);
  const { swingHighs, swingLows } = detectSwings(candles5m);
  const { bullishOBs, bearishOBs } = detectOrderBlocks(candles15m);
  const { bullishFVGs, bearishFVGs } = detectFVG(candles15m);
  const liqData = detectLiquiditySweep(candles15m);
  const crtData = detectCRT(candles15m);

  const currentPrice = candles4h[candles4h.length - 1].close;
  const lastEMA5_4h  = ema5_4h[ema5_4h.length - 1];
  const lastEMA13_4h = ema13_4h[ema13_4h.length - 1];
  const lastEMA89_4h = ema89_4h[ema89_4h.length - 1];
  const lastEMA5_15m  = ema5_15m[ema5_15m.length - 1];
  const lastEMA13_15m = ema13_15m[ema13_15m.length - 1];

  const last5mCandles = candles5m.slice(-10).map(c =>
    `O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)}`
  ).join(' | ');

  const prompt = `You are an expert ICT/SMC trading analyst. Analyze ${instrument.display} and return a STRICT JSON object only. No markdown, no explanation outside JSON.

CURRENT DATA:
Symbol: ${instrument.display}
Current Price: ${currentPrice.toFixed(4)}
Asset Type: ${instrument.type}

4H TIMEFRAME (HTF Macro):
EMA5: ${lastEMA5_4h?.toFixed(4) || 'N/A'}
EMA13: ${lastEMA13_4h?.toFixed(4) || 'N/A'}
EMA89: ${lastEMA89_4h?.toFixed(4) || 'N/A'}

15M TIMEFRAME (Momentum):
EMA5: ${lastEMA5_15m?.toFixed(4) || 'N/A'}
EMA13: ${lastEMA13_15m?.toFixed(4) || 'N/A'}

5M LAST 10 CANDLES (Entry Structure):
${last5mCandles}

Last 5M Swing Highs: ${swingHighs.slice(-3).map(s => s.price.toFixed(4)).join(', ') || 'none'}
Last 5M Swing Lows: ${swingLows.slice(-3).map(s => s.price.toFixed(4)).join(', ') || 'none'}

FIBONACCI (200 candles):
Range High: ${fib.high.toFixed(4)}, Range Low: ${fib.low.toFixed(4)}
78.6%: ${fib.fib786.toFixed(4)}, 61.8%: ${fib.fib618.toFixed(4)}, 50%: ${fib.fib500.toFixed(4)}, 38.2%: ${fib.fib382.toFixed(4)}, 21.4%: ${fib.fib214.toFixed(4)}

ORDER BLOCKS (15m):
Bullish OBs: ${bullishOBs.slice(-2).map(o => `${o.low.toFixed(4)}-${o.high.toFixed(4)}`).join(', ') || 'none'}
Bearish OBs: ${bearishOBs.slice(-2).map(o => `${o.low.toFixed(4)}-${o.high.toFixed(4)}`).join(', ') || 'none'}

FAIR VALUE GAPS (15m):
Bullish FVGs: ${bullishFVGs.slice(-2).map(f => `${f.low.toFixed(4)}-${f.high.toFixed(4)}`).join(', ') || 'none'}
Bearish FVGs: ${bearishFVGs.slice(-2).map(f => `${f.low.toFixed(4)}-${f.high.toFixed(4)}`).join(', ') || 'none'}

LIQUIDITY (15m):
SSL Swept: ${liqData.sslSwept}, SSL Level: ${liqData.sslLevel?.toFixed(4) || 'N/A'}
BSL Swept: ${liqData.bslSwept}, BSL Level: ${liqData.bslLevel?.toFixed(4) || 'N/A'}
CRT Forming: ${crtData.crtForming}, CRT Confirmed: ${crtData.crtConfirmed}, Direction: ${crtData.direction || 'none'}

RULES — YOU MUST FOLLOW EXACTLY:
P1 (4H EMA Stack): BULLISH if EMA5>EMA13>EMA89 AND price>EMA89. BEARISH if EMA5<EMA13<EMA89 AND price<EMA89. Else NEUTRAL.
P2 (15m Momentum): BULLISH if EMA5>EMA13 AND price>EMA5. BEARISH if EMA5<EMA13 AND price<EMA5. Else NEUTRAL.
P3 (5m Structure): Check for BOS (broke swing high/low), CHoCH (reversal of structure), MSS (sweep then break). PASS if any detected, else FAIL.
P4 (PD Array): Score 0-7. +4 if price within 0.5% of fresh OB, +3 if price inside FVG, +7 if both.
P5 (Value Zone): Score 0-3. +3 if for BUY signal and price below 50% fib (discount). +3 if for SELL signal and price above 50% fib (premium).
P6 (Liquidity): Score 0-4. +4 if SSL or BSL swept. +4 if CRT confirmed. +2 if CRT forming.

SIGNAL LOGIC:
- All 3 gates (P1, P2, P3) must pass AND align directionally for any trade
- If gates pass: total_upgrade = P4score + P5score + P6score (max 14)
- If total_upgrade >= 8: STRONG BUY or STRONG SELL
- If total_upgrade >= 1 and < 8: BUY or SELL
- If total_upgrade == 0: BUY or SELL (standard)
- If any gate fails or misaligns: NEUTRAL

SL/TP CALCULATION:
For BUY: SL = below nearest support/OB/sweep low. TP = nearest resistance/equal highs/BSL.
For SELL: SL = above nearest resistance/OB/sweep high. TP = nearest support/equal lows/SSL.

Return ONLY this JSON with no markdown:
{
  "currentPrice": ${currentPrice.toFixed(4)},
  "signal": "STRONG BUY|BUY|NEUTRAL|SELL|STRONG SELL",
  "direction": "bullish|bearish|neutral",
  "upgradeScore": 0,
  "maxScore": 14,
  "entryPrice": 0,
  "stopLoss": 0,
  "takeProfit": 0,
  "riskReward": "1:X.X",
  "p1": {
    "passed": true,
    "direction": "bullish|bearish|neutral",
    "ema5": 0, "ema13": 0, "ema89": 0,
    "explanation": "Detailed explanation with specific EMA values and what they mean"
  },
  "p2": {
    "passed": true,
    "direction": "bullish|bearish|neutral",
    "ema5": 0, "ema13": 0,
    "explanation": "Detailed explanation with specific values"
  },
  "p3": {
    "passed": true,
    "patternDetected": "BOS|CHoCH|MSS|none",
    "direction": "bullish|bearish|neutral",
    "explanation": "Detailed explanation of what structure was detected and at what levels"
  },
  "p4": {
    "score": 0,
    "obTouch": false,
    "fvgInside": false,
    "obZone": "low-high or none",
    "explanation": "Detailed explanation of OB/FVG analysis with specific price levels"
  },
  "p5": {
    "score": 0,
    "zone": "discount|premium|neutral",
    "fibLevel": "38.2%|50%|61.8%|etc",
    "explanation": "Detailed Fibonacci analysis with specific levels"
  },
  "p6": {
    "score": 0,
    "eventType": "SSL|BSL|CRT|none",
    "sweepLevel": 0,
    "explanation": "Detailed liquidity analysis explaining the sweep or CRT"
  },
  "dataSource": "gemini-ai",
  "analyzedAt": "${new Date().toISOString()}"
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
        }),
        timeout: 25000
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(text);
    analysis.dataSource = 'gemini-ai';
    return analysis;
  } catch (e) {
    console.error('Gemini error, using fallback:', e.message);
    return generateFallbackAnalysis(instrument, candles4h, candles15m, candles5m);
  }
}

function generateFallbackAnalysis(instrument, candles4h, candles15m, candles5m) {
  const closes4h  = candles4h.map(c => c.close);
  const closes15m = candles15m.map(c => c.close);
  const ema5_4h   = ema(closes4h, 5);
  const ema13_4h  = ema(closes4h, 13);
  const ema89_4h  = ema(closes4h, 89);
  const ema5_15m  = ema(closes15m, 5);
  const ema13_15m = ema(closes15m, 13);

  const price    = candles4h[candles4h.length - 1].close;
  const e5_4h    = ema5_4h[ema5_4h.length - 1];
  const e13_4h   = ema13_4h[ema13_4h.length - 1];
  const e89_4h   = ema89_4h[ema89_4h.length - 1];
  const e5_15m   = ema5_15m[ema5_15m.length - 1];
  const e13_15m  = ema13_15m[ema13_15m.length - 1];

  // P1
  let p1Dir = 'neutral', p1Pass = false;
  if (e5_4h > e13_4h && e13_4h > e89_4h && price > e89_4h) { p1Dir = 'bullish'; p1Pass = true; }
  else if (e5_4h < e13_4h && e13_4h < e89_4h && price < e89_4h) { p1Dir = 'bearish'; p1Pass = true; }

  // P2
  const p2_price = candles15m[candles15m.length - 1].close;
  let p2Dir = 'neutral', p2Pass = false;
  if (e5_15m > e13_15m && p2_price > e5_15m) { p2Dir = 'bullish'; p2Pass = true; }
  else if (e5_15m < e13_15m && p2_price < e5_15m) { p2Dir = 'bearish'; p2Pass = true; }

  // P3 — basic BOS detection
  const { swingHighs, swingLows } = detectSwings(candles5m);
  const lastC5 = candles5m[candles5m.length - 1];
  let p3Pass = false, p3Pattern = 'none', p3Dir = 'neutral';
  if (swingHighs.length > 0 && lastC5.close > swingHighs[swingHighs.length - 1].price) {
    p3Pass = true; p3Pattern = 'BOS'; p3Dir = 'bullish';
  } else if (swingLows.length > 0 && lastC5.close < swingLows[swingLows.length - 1].price) {
    p3Pass = true; p3Pattern = 'BOS'; p3Dir = 'bearish';
  }

  // Determine gate
  const gatePass = p1Pass && p2Pass && p3Pass && p1Dir === p2Dir && p2Dir === p3Dir;
  const tradeDir = gatePass ? p1Dir : 'neutral';

  // P4
  const { bullishOBs, bearishOBs } = detectOrderBlocks(candles15m);
  const { bullishFVGs, bearishFVGs } = detectFVG(candles15m);
  let p4Score = 0, p4OBTouch = false, p4FVGInside = false, p4OBZone = 'none';
  if (tradeDir === 'bullish') {
    const nearOB = bullishOBs.find(o => price >= o.low * 0.995 && price <= o.high * 1.005);
    const inFVG  = bullishFVGs.find(f => price >= f.low && price <= f.high);
    if (nearOB) { p4Score += 4; p4OBTouch = true; p4OBZone = `${nearOB.low.toFixed(4)}-${nearOB.high.toFixed(4)}`; }
    if (inFVG)  { p4Score += 3; p4FVGInside = true; }
  } else if (tradeDir === 'bearish') {
    const nearOB = bearishOBs.find(o => price >= o.low * 0.995 && price <= o.high * 1.005);
    const inFVG  = bearishFVGs.find(f => price >= f.low && price <= f.high);
    if (nearOB) { p4Score += 4; p4OBTouch = true; p4OBZone = `${nearOB.low.toFixed(4)}-${nearOB.high.toFixed(4)}`; }
    if (inFVG)  { p4Score += 3; p4FVGInside = true; }
  }

  // P5
  const fib = calcFibLevels(candles4h);
  let p5Score = 0, p5Zone = 'neutral', p5FibLevel = '50%';
  if (tradeDir === 'bullish' && price < fib.fib500) {
    p5Score = 3; p5Zone = 'discount';
    p5FibLevel = price < fib.fib214 ? '21.4%' : price < fib.fib382 ? '38.2%' : '50%';
  } else if (tradeDir === 'bearish' && price > fib.fib500) {
    p5Score = 3; p5Zone = 'premium';
    p5FibLevel = price > fib.fib786 ? '78.6%' : price > fib.fib618 ? '61.8%' : '50%';
  }

  // P6
  const liq = detectLiquiditySweep(candles15m);
  const crt = detectCRT(candles15m);
  let p6Score = 0, p6Event = 'none', p6SweepLevel = 0;
  if ((liq.sslSwept && tradeDir === 'bullish') || (liq.bslSwept && tradeDir === 'bearish')) {
    p6Score = 4; p6Event = liq.sslSwept ? 'SSL' : 'BSL';
    p6SweepLevel = liq.sslLevel || liq.bslLevel || 0;
  } else if (crt.crtConfirmed && (crt.direction === tradeDir || tradeDir === 'neutral')) {
    p6Score = 4; p6Event = 'CRT';
  } else if (crt.crtForming) {
    p6Score = 2; p6Event = 'CRT_forming';
  }

  const upgradeScore = gatePass ? p4Score + p5Score + p6Score : 0;
  let signal = 'NEUTRAL';
  if (gatePass) {
    if (upgradeScore >= 8) signal = tradeDir === 'bullish' ? 'STRONG BUY' : 'STRONG SELL';
    else signal = tradeDir === 'bullish' ? 'BUY' : 'SELL';
  }

  // SL/TP
  let entryPrice = price, stopLoss = price, takeProfit = price;
  if (tradeDir === 'bullish') {
    stopLoss = p6SweepLevel > 0 ? Math.min(p6SweepLevel, price * 0.995) : price * 0.995;
    takeProfit = fib.high;
  } else if (tradeDir === 'bearish') {
    stopLoss = p6SweepLevel > 0 ? Math.max(p6SweepLevel, price * 1.005) : price * 1.005;
    takeProfit = fib.low;
  }
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  const rr = risk > 0 ? (reward / risk).toFixed(1) : '0';

  const fmt = v => typeof v === 'number' ? v.toFixed(4) : 'N/A';

  return {
    currentPrice: price,
    signal, direction: tradeDir,
    upgradeScore, maxScore: 14,
    entryPrice, stopLoss, takeProfit, riskReward: `1:${rr}`,
    p1: {
      passed: p1Pass, direction: p1Dir,
      ema5: e5_4h, ema13: e13_4h, ema89: e89_4h,
      explanation: p1Pass
        ? `On the 4H timeframe, EMA5 is at ${fmt(e5_4h)}, EMA13 at ${fmt(e13_4h)}, EMA89 at ${fmt(e89_4h)}. The EMAs form a complete ${p1Dir} stack. Price at ${fmt(price)} is ${p1Dir === 'bullish' ? 'above' : 'below'} all EMAs. Smart money is positioned ${p1Dir}.`
        : `On the 4H timeframe, EMA5 at ${fmt(e5_4h)}, EMA13 at ${fmt(e13_4h)}, EMA89 at ${fmt(e89_4h)}. The EMAs are tangled with no clear stack. No macro bias — institutions are waiting for direction.`
    },
    p2: {
      passed: p2Pass, direction: p2Dir,
      ema5: e5_15m, ema13: e13_15m,
      explanation: p2Pass
        ? `On the 15m timeframe, EMA5 at ${fmt(e5_15m)}, EMA13 at ${fmt(e13_15m)}. EMA5 is ${p2Dir === 'bullish' ? 'above' : 'below'} EMA13 confirming ${p2Dir} momentum. Price at ${fmt(p2_price)} is ${p2Dir === 'bullish' ? 'above EMA5 — strongest momentum signal' : 'below EMA5 — sellers in control'}.`
        : `On the 15m timeframe, EMA5 at ${fmt(e5_15m)}, EMA13 at ${fmt(e13_15m)}. EMAs are nearly crossed with no clear separation. Momentum is confused — wait for a clear EMA cross.`
    },
    p3: {
      passed: p3Pass, patternDetected: p3Pattern, direction: p3Dir,
      explanation: p3Pass
        ? `On the 5m timeframe, a ${p3Pattern} was detected to the ${p3Dir === 'bullish' ? 'upside' : 'downside'}. Price has broken ${p3Dir === 'bullish' ? 'above the last swing high' : 'below the last swing low'}, confirming the structural ${p3Dir === 'bullish' ? 'continuation' : 'breakdown'}.`
        : 'On the 5m timeframe, no clear BOS, CHoCH, or MSS was detected. Price is ranging with no structural break. Wait for a clean trigger.'
    },
    p4: {
      score: p4Score, obTouch: p4OBTouch, fvgInside: p4FVGInside, obZone: p4OBZone,
      explanation: p4Score > 0
        ? `${p4OBTouch ? `Price is touching a fresh ${tradeDir} Order Block at ${p4OBZone} (+4 pts).` : ''} ${p4FVGInside ? `Price is inside a Fair Value Gap (+3 pts).` : ''} Institutional entry zone confirmed.`
        : 'No Order Blocks or Fair Value Gaps are near current price. No upgrade points from P4.'
    },
    p5: {
      score: p5Score, zone: p5Zone, fibLevel: p5FibLevel,
      explanation: p5Score > 0
        ? `Price at ${fmt(price)} is in the ${p5Zone} zone (${p5FibLevel} Fibonacci level). Range: ${fmt(fib.low)}-${fmt(fib.high)}, equilibrium at ${fmt(fib.fib500)}. Institutions ${p5Zone === 'discount' ? 'buy wholesale in discount' : 'sell retail in premium'} zones. +3 pts.`
        : `Price at ${fmt(price)} is near the 50% equilibrium (${fmt(fib.fib500)}). Neither discount nor premium — neutral Fibonacci zone. No upgrade from P5.`
    },
    p6: {
      score: p6Score, eventType: p6Event, sweepLevel: p6SweepLevel,
      explanation: p6Score >= 4
        ? `${p6Event === 'SSL' ? `Sell-Side Liquidity (SSL) sweep detected at ${fmt(p6SweepLevel)}. Institutions hunted sell stops then reversed higher.` : p6Event === 'BSL' ? `Buy-Side Liquidity (BSL) sweep detected at ${fmt(p6SweepLevel)}. Institutions hunted buy stops then reversed lower.` : 'CRT pattern confirmed — 3-candle institutional manipulation and reversal setup.'} +4 pts.`
        : p6Score === 2
          ? 'CRT pattern is forming but not yet confirmed. +2 pts. Watch for confirmation.'
          : 'No liquidity sweep or CRT pattern detected near current price. No upgrade from P6.'
    },
    dataSource: 'fallback-local',
    analyzedAt: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MARKET PRICE FETCHER (lightweight, for market tab)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCurrentPrice(instrument) {
  try {
    if (instrument.binance) {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${instrument.binance}`, { timeout: 5000 });
      const d = await res.json();
      return { price: parseFloat(d.lastPrice), change24h: parseFloat(d.priceChangePercent), source: 'binance' };
    }
    if (instrument.yahoo) {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${instrument.yahoo}?interval=1m&range=2d`,
        { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      if (meta) {
        const price = meta.regularMarketPrice || meta.previousClose;
        const prev = meta.chartPreviousClose || meta.previousClose;
        const change = prev ? ((price - prev) / prev * 100) : 0;
        return { price, change24h: change, source: 'yahoo' };
      }
    }
  } catch (e) {}
  return { price: null, change24h: null, source: 'none' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/trading/instruments', (req, res) => {
  res.json(INSTRUMENTS.map(i => ({
    symbol: i.symbol, display: i.display, type: i.type,
    hasFreeData: !!(i.binance || i.yahoo)
  })));
});

app.get('/api/trading/markets', async (req, res) => {
  try {
    const results = await Promise.allSettled(INSTRUMENTS.map(async inst => {
      const data = await fetchCurrentPrice(inst);
      return { symbol: inst.symbol, display: inst.display, type: inst.type, ...data };
    }));
    const markets = results.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { symbol: INSTRUMENTS[i].symbol, display: INSTRUMENTS[i].display, type: INSTRUMENTS[i].type, price: null, change24h: null }
    );
    marketPrices = Object.fromEntries(markets.map(m => [m.symbol, m]));
    res.json(markets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trading/analyze', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const instrument = INSTRUMENTS.find(i => i.symbol === symbol);
  if (!instrument) return res.status(404).json({ error: 'Unknown symbol' });

  try {
    const [candles4h, candles15m, candles5m] = await Promise.all([
      fetchCandles(instrument, '4h'),
      fetchCandles(instrument, '15min'),
      fetchCandles(instrument, '5min'),
    ]);

    if (!candles5m || candles5m.length < 20) {
      return res.json({ signal: 'NEUTRAL', reason: 'P3 requires 5m data — unavailable', symbol });
    }

    const analysis = await analyzeWithGemini(instrument, candles4h, candles15m, candles5m);
    analysis.symbol = symbol;
    analysis.display = instrument.display;
    analysis.type = instrument.type;

    // Save to history
    const historyEntry = {
      id: Date.now(),
      symbol, display: instrument.display, type: instrument.type,
      signal: analysis.signal, upgradeScore: analysis.upgradeScore,
      entryPrice: analysis.currentPrice,
      stopLoss: analysis.stopLoss, takeProfit: analysis.takeProfit,
      riskReward: analysis.riskReward, direction: analysis.direction,
      analyzedAt: analysis.analyzedAt, outcome: 'pending'
    };
    signalHistory.unshift(historyEntry);
    if (signalHistory.length > 200) signalHistory = signalHistory.slice(0, 200);
    currentSignals[symbol] = analysis;

    res.json(analysis);
  } catch (e) {
    console.error(`Analysis error for ${symbol}:`, e.message);
    res.status(500).json({ error: e.message, signal: 'NEUTRAL' });
  }
});

app.get('/api/trading/signals', (req, res) => {
  res.json(Object.values(currentSignals));
});

app.get('/api/trading/history', (req, res) => {
  res.json(signalHistory);
});

app.post('/api/trading/history', (req, res) => {
  const { id, outcome } = req.body;
  const entry = signalHistory.find(h => h.id === id);
  if (entry) {
    entry.outcome = outcome;
    res.json({ success: true, entry });
  } else {
    res.status(404).json({ error: 'Signal not found' });
  }
});

app.get('/api/trading/auto-analysis', (req, res) => {
  res.json(Object.values(currentSignals));
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-REFRESH CRON (every 15 minutes)
// ═══════════════════════════════════════════════════════════════════════════════

async function runAutoAnalysis() {
  console.log('[AUTO] Running scheduled analysis at', new Date().toISOString());
  const priority = ['BTCUSDT', 'ETHUSDT', 'EURUSD', 'GBPUSD', 'SPX'];
  for (const sym of priority) {
    const instrument = INSTRUMENTS.find(i => i.symbol === sym);
    if (!instrument) continue;
    try {
      const [c4h, c15m, c5m] = await Promise.all([
        fetchCandles(instrument, '4h'),
        fetchCandles(instrument, '15min'),
        fetchCandles(instrument, '5min'),
      ]);
      if (!c5m || c5m.length < 20) continue;
      const analysis = await analyzeWithGemini(instrument, c4h, c15m, c5m);
      analysis.symbol = sym;
      analysis.display = instrument.display;
      analysis.type = instrument.type;
      currentSignals[sym] = analysis;
      signalHistory.unshift({
        id: Date.now(),
        symbol: sym, display: instrument.display, type: instrument.type,
        signal: analysis.signal, upgradeScore: analysis.upgradeScore,
        entryPrice: analysis.currentPrice,
        stopLoss: analysis.stopLoss, takeProfit: analysis.takeProfit,
        riskReward: analysis.riskReward, direction: analysis.direction,
        analyzedAt: analysis.analyzedAt, outcome: 'pending'
      });
      await new Promise(r => setTimeout(r, 2000)); // rate limit guard
    } catch (e) {
      console.error(`[AUTO] Failed ${sym}:`, e.message);
    }
  }
  if (signalHistory.length > 200) signalHistory = signalHistory.slice(0, 200);
}

cron.schedule('*/15 * * * *', runAutoAnalysis);

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n⚡ SMC ICT Pro Trading Platform`);
  console.log(`   Server running on http://localhost:${PORT}`);
  console.log(`   Gemini AI: ${GEMINI_KEY ? '✅ configured' : '⚠️  not set (fallback mode)'}`);
  console.log(`   Twelve Data: ${TWELVE_DATA_KEY ? '✅' : '⚠️  not set'}`);
  console.log(`   Alpha Vantage: ${ALPHA_VANTAGE_KEY ? '✅' : '⚠️  not set'}`);
  console.log(`   FSC: ${FSC_KEY ? '✅' : '⚠️  not set'}`);
  console.log(`   Binance FREE: ✅ always available (crypto)`);
  console.log(`   Yahoo FREE: ✅ always available (forex/indices)\n`);
});
