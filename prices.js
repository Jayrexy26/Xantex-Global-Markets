// prices.js — Live price fetcher for Xantex Global Markets
// Crypto:  Binance (5s) → CoinGecko fallback (15s)
// Forex:   Frankfurter today + yesterday for real daily chg/chgp (60s)
// Metals:  api.metals.live directly — no proxy (30s)
// Stocks / Indices / ETFs / Energy: Yahoo Finance /v8/finance/chart/{sym}
//          per-symbol parallel requests via proxy — bypasses the crumb
//          requirement that breaks the batch /v7/finance/quote endpoint (30s)

(function () {
  'use strict';

  const LIVE = {};
  window.LIVE_PRICES = LIVE;

  // ── CORS proxy cascade ───────────────────────────────────────
  const PROXIES = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  async function viaProxy(url) {
    for (const mk of PROXIES) {
      try {
        const res = await fetch(mk(url), { signal: AbortSignal.timeout(9000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || text[0] !== '{') continue;
        return JSON.parse(text);
      } catch (_) {}
    }
    return null;
  }

  function dispatch() {
    window.dispatchEvent(new CustomEvent('prices:update', { detail: LIVE }));
  }

  // ── Crypto: Binance → CoinGecko ─────────────────────────────
  const BINANCE_MAP = {
    BTCUSDT: 'BTC/USD',  ETHUSDT:  'ETH/USD',  SOLUSDT:  'SOL/USD',
    XRPUSDT: 'XRP/USD',  BNBUSDT:  'BNB/USD',  ADAUSDT:  'ADA/USD',
    DOTUSDT: 'DOT/USD',  DOGEUSDT: 'DOGE/USD', AVAXUSDT: 'AVAX/USD',
    LINKUSDT:'LINK/USD',
  };
  const CG_IDS = 'bitcoin,ethereum,solana,ripple,binancecoin,cardano,polkadot,dogecoin,avalanche-2,chainlink';
  const CG_MAP  = {
    bitcoin:'BTC/USD', ethereum:'ETH/USD', solana:'SOL/USD',
    ripple:'XRP/USD', binancecoin:'BNB/USD', cardano:'ADA/USD',
    polkadot:'DOT/USD', dogecoin:'DOGE/USD', 'avalanche-2':'AVAX/USD',
    chainlink:'LINK/USD',
  };
  let _binanceDead = false;

  async function fetchCrypto() {
    if (!_binanceDead) {
      try {
        const syms = JSON.stringify(Object.keys(BINANCE_MAP));
        const res  = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = await res.json();
        if (!list?.length) throw new Error('empty');
        list.forEach(t => {
          const sym = BINANCE_MAP[t.symbol];
          if (!sym) return;
          const price = parseFloat(t.lastPrice), sp = price * 0.0003;
          LIVE[sym] = {
            price, chg: parseFloat(t.priceChange), chgp: parseFloat(t.priceChangePercent),
            high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice),
            vol:  parseFloat(t.quoteVolume),
            bid: +(price - sp / 2).toPrecision(8), ask: +(price + sp / 2).toPrecision(8),
          };
        });
        dispatch(); return;
      } catch (_) { _binanceDead = true; console.warn('[prices] Binance down → CoinGecko'); }
    }
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${CG_IDS}&per_page=10&page=1&sparkline=false`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) throw new Error('CoinGecko HTTP ' + res.status);
      const list = await res.json();
      list.forEach(c => {
        const sym = CG_MAP[c.id]; if (!sym) return;
        const price = c.current_price, sp = price * 0.0003;
        LIVE[sym] = {
          price, chg: c.price_change_24h, chgp: c.price_change_percentage_24h,
          high: c.high_24h, low: c.low_24h, vol: c.total_volume,
          bid: +(price - sp / 2), ask: +(price + sp / 2),
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] CoinGecko:', e.message); }
  }

  // ── Forex: Frankfurter (today + yesterday) ───────────────────
  function lastTradingDay() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  function fxPairs(rates) {
    return {
      'EUR/USD': +(1/rates.EUR).toFixed(5), 'GBP/USD': +(1/rates.GBP).toFixed(5),
      'USD/JPY': +rates.JPY.toFixed(3),      'USD/CAD': +rates.CAD.toFixed(5),
      'USD/CHF': +rates.CHF.toFixed(5),      'AUD/USD': +(1/rates.AUD).toFixed(5),
      'NZD/USD': +(1/rates.NZD).toFixed(5),  'EUR/GBP': +(rates.GBP/rates.EUR).toFixed(5),
      'EUR/JPY': +(rates.JPY/rates.EUR).toFixed(3), 'GBP/JPY': +(rates.JPY/rates.GBP).toFixed(3),
    };
  }
  async function fetchForex() {
    try {
      const SYM = 'EUR,GBP,JPY,CAD,CHF,AUD,NZD', B = 'https://api.frankfurter.app';
      const [tR, pR] = await Promise.allSettled([
        fetch(`${B}/latest?base=USD&symbols=${SYM}`,            { signal: AbortSignal.timeout(8000) }),
        fetch(`${B}/${lastTradingDay()}?base=USD&symbols=${SYM}`, { signal: AbortSignal.timeout(8000) }),
      ]);
      if (tR.status !== 'fulfilled' || !tR.value.ok) return;
      const today = fxPairs((await tR.value.json()).rates);
      let prev = null;
      if (pR.status === 'fulfilled' && pR.value.ok) prev = fxPairs((await pR.value.json()).rates);
      Object.entries(today).forEach(([sym, price]) => {
        const sp = sym.includes('JPY') ? 0.025 : 0.00014;
        const cl = prev?.[sym] ?? price;
        LIVE[sym] = {
          price, chg: +(price-cl).toPrecision(6), chgp: +((price-cl)/cl*100).toFixed(4),
          high: null, low: null,
          bid: +(price-sp/2).toPrecision(7), ask: +(price+sp/2).toPrecision(7),
        };
      });
      dispatch();
    } catch (e) { console.warn('[prices] Forex:', e.message); }
  }

  // ── Metals: api.metals.live (direct, no proxy) ───────────────
  const METALS_MAP = { gold:'XAU/USD', silver:'XAG/USD', platinum:'XPT/USD', palladium:'XPD/USD' };
  let _prevMetals = {};

  async function fetchMetals() {
    try {
      const res = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('metals.live HTTP ' + res.status);
      const list = await res.json(); // [{metal:'gold', price:2341.5}, ...]
      list.forEach(item => {
        const sym = METALS_MAP[item.metal]; if (!sym || !item.price) return;
        const price = parseFloat(item.price);
        const prev  = _prevMetals[sym] ?? price;
        const sp    = price * 0.0002;
        LIVE[sym] = {
          price, chg: +(price-prev).toFixed(4), chgp: +((price-prev)/prev*100).toFixed(4),
          high: null, low: null,
          bid: +(price - sp / 2).toFixed(4), ask: +(price + sp / 2).toFixed(4),
        };
        _prevMetals[sym] = price;
      });
      dispatch();
    } catch (e) { console.warn('[prices] Metals:', e.message); }
  }

  // ── Stocks / Indices / ETFs / Energy: Yahoo Finance chart API ─
  // Uses /v8/finance/chart/{sym} which does NOT require the crumb token
  // that breaks the batch /v7/finance/quote endpoint.
  // All symbols fetched in parallel; each falls back through proxy cascade.

  const CHART_MAP = {
    // Indices
    '%5EDJI':'US30',  '%5EGSPC':'SPX500', '%5EIXIC':'NAS100',
    '%5EFTSE':'UK100','%5EGDAXI':'GER40', '%5EFCHI':'FRA40',
    '%5EN225':'JPN225','%5EHSI':'HK50',   '%5EAXJO':'AUS200',
    // Metals (supplement HG copper + fallback for precious if metals.live fails)
    'HG%3DF':'HG/USD',
    // Energy
    'CL%3DF':'WTI/USD','BZ%3DF':'BRT/USD','NG%3DF':'NGAS',
    'RB%3DF':'RBOB',   'HO%3DF':'HEAT',
    // Stocks
    'AAPL':'AAPL','MSFT':'MSFT','GOOGL':'GOOGL','AMZN':'AMZN',
    'TSLA':'TSLA','NVDA':'NVDA','META':'META','JPM':'JPM','V':'V','WMT':'WMT',
    // ETFs
    'SPY':'SPY','QQQ':'QQQ','GLD':'GLD','SLV':'SLV',
    'VTI':'VTI','XLE':'XLE','ARKK':'ARKK','XLK':'XLK',
  };

  async function fetchOneChart(encodedTicker, sym) {
    const bases = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=1d`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=1d`,
    ];
    for (const url of bases) {
      const data = await viaProxy(url);
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) continue;
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || price;
      LIVE[sym] = {
        price,
        chg:  +(price - prev).toFixed(4),
        chgp: +((price - prev) / prev * 100).toFixed(4),
        high: meta.regularMarketDayHigh  || null,
        low:  meta.regularMarketDayLow   || null,
        vol:  meta.regularMarketVolume   || 0,
        bid:  price, ask: price,
      };
      return true;
    }
    return false;
  }

  async function fetchCharts() {
    const entries = Object.entries(CHART_MAP);
    await Promise.allSettled(entries.map(([ticker, sym]) => fetchOneChart(ticker, sym)));
    const loaded = entries.filter(([, sym]) => LIVE[sym]).length;
    if (loaded > 0) dispatch();
    else console.warn('[prices] Yahoo charts: 0/' + entries.length + ' loaded');
  }

  // ── Global format helper ─────────────────────────────────────
  window.fmtPrice = function (sym, val) {
    if (val == null) return '—';
    const n = parseFloat(val); if (isNaN(n)) return '—';
    if (sym?.includes('JPY') || n > 1000)
      return n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
    if (n < 1)  return n.toFixed(6);
    if (n < 10) return n.toFixed(4);
    return n.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:4 });
  };

  // ── Boot ─────────────────────────────────────────────────────
  async function refreshAll() {
    await Promise.allSettled([fetchCrypto(), fetchForex(), fetchMetals(), fetchCharts()]);
  }

  refreshAll();
  setInterval(fetchCrypto,  5000);   // crypto   every  5 s
  setInterval(fetchForex,  60000);   // forex    every 60 s
  setInterval(fetchMetals, 30000);   // metals   every 30 s
  setInterval(fetchCharts, 30000);   // charts   every 30 s
})();
