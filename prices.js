// prices.js — Live price fetcher for Xantex Global Markets
// Sources: Binance (crypto 5s), Frankfurter (forex 60s + yesterday for real daily chg),
//          Yahoo Finance via proxy cascade (stocks/metals/indices/ETFs 30s)

(function () {
  'use strict';

  const LIVE = {};
  window.LIVE_PRICES = LIVE;

  // ── Proxy cascade for Yahoo Finance ─────────────────────────
  // Tries each proxy in order; moves on if one times out or errors.
  const PROXY_FNS = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  async function fetchViaProxy(url) {
    for (const mkProxy of PROXY_FNS) {
      try {
        const res = await fetch(mkProxy(url), { signal: AbortSignal.timeout(9000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text[0] !== '{') continue; // not JSON
        return JSON.parse(text);
      } catch (_) { /* try next */ }
    }
    throw new Error('All proxies exhausted for ' + url);
  }

  // ── Crypto via Binance REST ──────────────────────────────────
  const BINANCE_MAP = {
    BTCUSDT:  'BTC/USD',  ETHUSDT:  'ETH/USD',  SOLUSDT:  'SOL/USD',
    XRPUSDT:  'XRP/USD',  BNBUSDT:  'BNB/USD',  ADAUSDT:  'ADA/USD',
    DOTUSDT:  'DOT/USD',  DOGEUSDT: 'DOGE/USD', AVAXUSDT: 'AVAX/USD',
    LINKUSDT: 'LINK/USD',
  };

  async function fetchCrypto() {
    try {
      const syms = JSON.stringify(Object.keys(BINANCE_MAP));
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return;
      const list = await res.json();
      list.forEach(t => {
        const sym = BINANCE_MAP[t.symbol];
        if (!sym) return;
        const price  = parseFloat(t.lastPrice);
        const spread = price * 0.0003;
        LIVE[sym] = {
          price,
          chg:  parseFloat(t.priceChange),
          chgp: parseFloat(t.priceChangePercent),
          high: parseFloat(t.highPrice),
          low:  parseFloat(t.lowPrice),
          vol:  parseFloat(t.quoteVolume),
          bid:  +(price - spread / 2).toPrecision(8),
          ask:  +(price + spread / 2).toPrecision(8),
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Binance:', e.message); }
  }

  // ── Forex via Frankfurter.app ────────────────────────────────
  // Fetches today + last trading day to compute real daily chg/chgp.
  function lastTradingDay() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2); // Sun → Fri
    if (d.getDay() === 6) d.setDate(d.getDate() - 1); // Sat → Fri
    return d.toISOString().slice(0, 10);
  }

  function deriveForexPairs(rates) {
    return {
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
  }

  async function fetchForex() {
    try {
      const SYM = 'EUR,GBP,JPY,CAD,CHF,AUD,NZD';
      const BASE = 'https://api.frankfurter.app';
      const [todayRes, prevRes] = await Promise.allSettled([
        fetch(`${BASE}/latest?base=USD&symbols=${SYM}`,       { signal: AbortSignal.timeout(8000) }),
        fetch(`${BASE}/${lastTradingDay()}?base=USD&symbols=${SYM}`, { signal: AbortSignal.timeout(8000) }),
      ]);

      if (todayRes.status !== 'fulfilled' || !todayRes.value.ok) return;
      const { rates }     = await todayRes.value.json();
      const today         = deriveForexPairs(rates);

      let prev = null;
      if (prevRes.status === 'fulfilled' && prevRes.value.ok) {
        const pd = await prevRes.value.json();
        prev = deriveForexPairs(pd.rates);
      }

      Object.entries(today).forEach(([sym, price]) => {
        const spread = sym.includes('JPY') ? 0.025 : 0.00014;
        const close  = prev?.[sym] ?? price;
        const chg    = +(price - close).toPrecision(6);
        const chgp   = +((price - close) / close * 100).toFixed(4);
        LIVE[sym] = {
          price, chg, chgp,
          high: null, low: null,
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
    '^DJI':   'US30',   '^GSPC':  'SPX500', '^IXIC':  'NAS100',
    '^FTSE':  'UK100',  '^GDAXI': 'GER40',  '^FCHI':  'FRA40',
    '^N225':  'JPN225', '^HSI':   'HK50',   '^AXJO':  'AUS200',
    // stocks
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
      const yUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
      const data = await fetchViaProxy(yUrl);
      const results = data?.quoteResponse?.result;
      if (!results?.length) throw new Error('empty result');
      results.forEach(q => {
        const sym = YAHOO_MAP[q.symbol] || q.symbol;
        const price = q.regularMarketPrice;
        LIVE[sym] = {
          price,
          chg:  q.regularMarketChange,
          chgp: q.regularMarketChangePercent,
          high: q.regularMarketDayHigh,
          low:  q.regularMarketDayLow,
          vol:  q.regularMarketVolume,
          bid:  q.bid  || price,
          ask:  q.ask  || price,
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Yahoo Finance:', e.message); }
  }

  function dispatch() {
    window.dispatchEvent(new CustomEvent('prices:update', { detail: LIVE }));
  }

  // Format price nicely (exposed globally for other scripts)
  window.fmtPrice = function (sym, val) {
    if (val == null) return '—';
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    if (sym?.includes('JPY') || n > 1000)
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n < 1)  return n.toFixed(6);
    if (n < 10) return n.toFixed(4);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  async function refreshAll() {
    await Promise.allSettled([fetchCrypto(), fetchForex(), fetchYahoo()]);
  }

  refreshAll();
  setInterval(fetchCrypto, 5000);   // crypto  every 5 s
  setInterval(fetchForex,  60000);  // forex   every 60 s
  setInterval(fetchYahoo,  30000);  // yahoo   every 30 s
})();
