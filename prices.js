// prices.js — Live price fetcher for Xantex Global Markets
// Sources: Binance (crypto), Frankfurter.app (forex), Yahoo Finance via CORS proxy (stocks/metals/indices/ETFs)
// No API key required.  Fires window event "prices:update" with window.LIVE_PRICES payload.

(function () {
  'use strict';

  const LIVE = {};
  window.LIVE_PRICES = LIVE;

  // ── Crypto via Binance ───────────────────────────────────────
  const BINANCE_MAP = {
    BTCUSDT:  'BTC/USD', ETHUSDT:  'ETH/USD', SOLUSDT:  'SOL/USD',
    XRPUSDT:  'XRP/USD', BNBUSDT:  'BNB/USD', ADAUSDT:  'ADA/USD',
    DOTUSDT:  'DOT/USD', DOGEUSDT: 'DOGE/USD', AVAXUSDT: 'AVAX/USD',
    LINKUSDT: 'LINK/USD',
  };

  async function fetchCrypto() {
    try {
      const syms = JSON.stringify(Object.keys(BINANCE_MAP));
      const res  = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`);
      if (!res.ok) return;
      const list = await res.json();
      list.forEach(t => {
        const sym = BINANCE_MAP[t.symbol];
        if (!sym) return;
        const price = parseFloat(t.lastPrice);
        const spread = price * 0.0003;
        LIVE[sym] = {
          price, chg: parseFloat(t.priceChange), chgp: parseFloat(t.priceChangePercent),
          high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice),
          vol: parseFloat(t.quoteVolume),
          bid: +(price - spread / 2).toPrecision(8),
          ask: +(price + spread / 2).toPrecision(8),
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Binance:', e.message); }
  }

  // ── Forex via Frankfurter.app ────────────────────────────────
  async function fetchForex() {
    try {
      const res = await fetch('https://api.frankfurter.app/latest?base=USD&symbols=EUR,GBP,JPY,CAD,CHF,AUD,NZD');
      if (!res.ok) return;
      const { rates } = await res.json();

      const pairs = {
        'EUR/USD': +(1 / rates.EUR).toFixed(5),
        'GBP/USD': +(1 / rates.GBP).toFixed(5),
        'USD/JPY': +rates.JPY.toFixed(3),
        'USD/CAD': +rates.CAD.toFixed(5),
        'USD/CHF': +rates.CHF.toFixed(5),
        'AUD/USD': +(1 / rates.AUD).toFixed(5),
        'NZD/USD': +(1 / rates.NZD).toFixed(5),
        'EUR/GBP': +(rates.GBP / rates.EUR).toFixed(5),
        'EUR/JPY': +(rates.JPY / rates.EUR).toFixed(3),
        'GBP/JPY': +(rates.JPY / rates.GBP).toFixed(3),
      };

      Object.entries(pairs).forEach(([sym, price]) => {
        const spread = sym.includes('JPY') ? 0.025 : 0.00014;
        LIVE[sym] = {
          price, chg: 0, chgp: 0,
          bid: +(price - spread / 2).toPrecision(7),
          ask: +(price + spread / 2).toPrecision(7),
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Frankfurter:', e.message); }
  }

  // ── Stocks / Metals / Energy / Indices / ETFs via Yahoo Finance ──
  const YAHOO_MAP = {
    // metals
    'GC=F': 'XAU/USD', 'SI=F': 'XAG/USD', 'PL=F': 'XPT/USD',
    'PA=F': 'XPD/USD', 'HG=F': 'HG/USD',
    // energy
    'CL=F': 'WTI/USD', 'BZ=F': 'BRT/USD', 'NG=F': 'NGAS',
    'RB=F': 'RBOB',    'HO=F': 'HEAT',
    // indices
    '^DJI':     'US30',    '^GSPC':    'SPX500',  '^IXIC':    'NAS100',
    '^FTSE':    'UK100',   '^GDAXI':   'GER40',   '^FCHI':    'FRA40',
    '^N225':    'JPN225',  '^HSI':     'HK50',    '^AXJO':    'AUS200',
    // stocks (use symbol as-is)
    'AAPL': 'AAPL', 'MSFT': 'MSFT', 'GOOGL': 'GOOGL', 'AMZN': 'AMZN',
    'TSLA': 'TSLA', 'NVDA': 'NVDA', 'META':  'META',  'JPM':  'JPM',
    'V':    'V',    'WMT':  'WMT',
    // ETFs
    'SPY': 'SPY', 'QQQ': 'QQQ', 'GLD': 'GLD', 'SLV': 'SLV',
    'VTI': 'VTI', 'XLE': 'XLE', 'ARKK': 'ARKK', 'XLK': 'XLK',
  };

  async function fetchYahoo() {
    try {
      const symbols = Object.keys(YAHOO_MAP).join(',');
      const yUrl    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
      const proxy   = `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`;
      const res     = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data    = await res.json();
      const results = data?.quoteResponse?.result || [];
      results.forEach(q => {
        const sym = YAHOO_MAP[q.symbol] || q.symbol;
        LIVE[sym] = {
          price: q.regularMarketPrice,
          chg:   q.regularMarketChange,
          chgp:  q.regularMarketChangePercent,
          high:  q.regularMarketDayHigh,
          low:   q.regularMarketDayLow,
          vol:   q.regularMarketVolume,
          bid:   q.bid || q.regularMarketPrice,
          ask:   q.ask || q.regularMarketPrice,
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Yahoo Finance:', e.message); }
  }

  function dispatch() {
    window.dispatchEvent(new CustomEvent('prices:update', { detail: LIVE }));
  }

  // Format price nicely
  window.fmtPrice = function (sym, val) {
    if (val == null) return '—';
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    if (sym?.includes('JPY') || n > 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n < 1) return n.toFixed(6);
    if (n < 10) return n.toFixed(4);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  async function refreshAll() {
    await Promise.allSettled([fetchCrypto(), fetchForex(), fetchYahoo()]);
  }

  // Initial load + schedule
  refreshAll();
  setInterval(fetchCrypto, 5000);   // crypto every 5 s
  setInterval(fetchForex,  60000);  // forex every 60 s
  setInterval(fetchYahoo,  30000);  // yahoo every 30 s
})();
