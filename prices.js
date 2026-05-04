// prices.js — Live price fetcher for Xantex Global Markets
//
// Crypto   : Binance (5s) → CoinGecko fallback
// Forex    : Frankfurter → open.er-api.com fallback (60s)
// Metals + Energy (all =F futures): Yahoo /v7/finance/spark batch (30s)
//            → per-symbol /v8/finance/chart fallback
//            → per-symbol /v10/finance/quoteSummary last resort
// Stocks / Indices / ETFs: same per-symbol chart → quoteSummary (30s)

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
        const res = await fetch(mk(url), { signal: AbortSignal.timeout(10000) });
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
    BTCUSDT: 'BTC/USD', ETHUSDT:  'ETH/USD', SOLUSDT:  'SOL/USD',
    XRPUSDT: 'XRP/USD', BNBUSDT:  'BNB/USD', ADAUSDT:  'ADA/USD',
    DOTUSDT: 'DOT/USD', DOGEUSDT: 'DOGE/USD',AVAXUSDT: 'AVAX/USD',
    LINKUSDT:'LINK/USD',
  };
  const CG_IDS = 'bitcoin,ethereum,solana,ripple,binancecoin,cardano,polkadot,dogecoin,avalanche-2,chainlink';
  const CG_MAP = {
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
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) throw new Error('Binance ' + res.status);
        const list = await res.json();
        if (!list?.length) throw new Error('empty');
        list.forEach(t => {
          const sym = BINANCE_MAP[t.symbol]; if (!sym) return;
          const price = parseFloat(t.lastPrice), sp = price * 0.0003;
          LIVE[sym] = {
            price, chg: parseFloat(t.priceChange), chgp: parseFloat(t.priceChangePercent),
            high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice),
            vol: parseFloat(t.quoteVolume),
            bid: +(price - sp / 2).toPrecision(8), ask: +(price + sp / 2).toPrecision(8),
          };
        });
        dispatch(); return;
      } catch (_) { _binanceDead = true; }
    }
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${CG_IDS}&per_page=10&page=1&sparkline=false`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) return;
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

  // ── Forex: Frankfurter → open.er-api.com ────────────────────
  function lastTradingDay() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    if (d.getDay() === 0) d.setDate(d.getDate() - 2);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  function fxPairs(rates) {
    if (!rates?.EUR) return null;
    return {
      'EUR/USD': +(1 / rates.EUR).toFixed(5), 'GBP/USD': +(1 / rates.GBP).toFixed(5),
      'USD/JPY': +rates.JPY.toFixed(3),        'USD/CAD': +rates.CAD.toFixed(5),
      'USD/CHF': +rates.CHF.toFixed(5),        'AUD/USD': +(1 / rates.AUD).toFixed(5),
      'NZD/USD': +(1 / rates.NZD).toFixed(5),  'EUR/GBP': +(rates.GBP / rates.EUR).toFixed(5),
      'EUR/JPY': +(rates.JPY / rates.EUR).toFixed(3), 'GBP/JPY': +(rates.JPY / rates.GBP).toFixed(3),
    };
  }
  function applyFx(today, prev) {
    if (!today) return;
    Object.entries(today).forEach(([sym, price]) => {
      const sp = sym.includes('JPY') ? 0.025 : 0.00014;
      const cl = prev?.[sym] ?? price;
      LIVE[sym] = {
        price, chg: +(price - cl).toPrecision(6), chgp: +((price - cl) / cl * 100).toFixed(4),
        high: null, low: null,
        bid: +(price - sp / 2).toPrecision(7), ask: +(price + sp / 2).toPrecision(7),
      };
    });
  }
  async function fetchForex() {
    try {
      const SYM = 'EUR,GBP,JPY,CAD,CHF,AUD,NZD', B = 'https://api.frankfurter.app';
      const [tR, pR] = await Promise.allSettled([
        fetch(`${B}/latest?base=USD&symbols=${SYM}`,             { signal: AbortSignal.timeout(8000) }),
        fetch(`${B}/${lastTradingDay()}?base=USD&symbols=${SYM}`, { signal: AbortSignal.timeout(8000) }),
      ]);
      if (tR.status === 'fulfilled' && tR.value.ok) {
        const today = fxPairs((await tR.value.json()).rates);
        const prev  = (pR.status === 'fulfilled' && pR.value.ok)
                    ? fxPairs((await pR.value.json()).rates) : null;
        if (today) { applyFx(today, prev); dispatch(); return; }
      }
    } catch (_) {}
    // Fallback
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      const today = fxPairs(data.rates);
      if (today) { applyFx(today, null); dispatch(); }
    } catch (e) { console.warn('[prices] Forex:', e.message); }
  }

  // ── Commodities (Metals + Energy): Yahoo spark batch ─────────
  // /v7/finance/spark is a different endpoint that handles futures
  // and does NOT require the crumb token that blocks /v7/finance/quote.
  const COMMODITY_MAP = {
    // Precious metals
    'GC=F':'XAU/USD', 'SI=F':'XAG/USD', 'PL=F':'XPT/USD', 'PA=F':'XPD/USD',
    // Base metal
    'HG=F':'HG/USD',
    // Energy
    'CL=F':'WTI/USD', 'BZ=F':'BRT/USD', 'NG=F':'NGAS',
    'RB=F':'RBOB',    'HO=F':'HEAT',
  };

  function liveCommodity(sym, price, prev, high, low, vol) {
    const sp = price * 0.0002;
    LIVE[sym] = {
      price,
      chg:  +(price - (prev || price)).toFixed(4),
      chgp: +((price - (prev || price)) / (prev || price) * 100).toFixed(4),
      high: high || null, low: low || null, vol: vol || 0,
      bid: +(price - sp / 2).toFixed(4),
      ask: +(price + sp / 2).toFixed(4),
    };
  }

  async function fetchCommoditiesSpark() {
    // Build batch symbol string: GC%3DF%2CSI%3DF%2C...
    const syms = Object.keys(COMMODITY_MAP)
      .map(s => encodeURIComponent(s)).join('%2C');

    const urls = [
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=1d&interval=1d`,
      `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=1d&interval=1d`,
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=5d&interval=1d`,
      `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=5d&interval=1d`,
    ];

    for (const url of urls) {
      const data = await viaProxy(url);
      const results = data?.spark?.result;
      if (!results?.length) continue;
      let count = 0;
      results.forEach(item => {
        const sym = COMMODITY_MAP[item.symbol]; if (!sym) return;
        const meta = item.response?.[0]?.meta; if (!meta?.regularMarketPrice) return;
        const price = meta.regularMarketPrice;
        liveCommodity(sym, price, meta.chartPreviousClose || meta.previousClose,
          meta.regularMarketDayHigh, meta.regularMarketDayLow, meta.regularMarketVolume);
        count++;
      });
      if (count > 0) return count;
    }
    return 0;
  }

  async function fetchCommodityChart(ticker, sym) {
    const enc = encodeURIComponent(ticker);
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d`,
    ];
    for (const url of urls) {
      const data = await viaProxy(url);
      const meta = data?.chart?.result?.[0]?.meta; if (!meta?.regularMarketPrice) continue;
      const price = meta.regularMarketPrice;
      liveCommodity(sym, price, meta.chartPreviousClose || meta.previousClose,
        meta.regularMarketDayHigh, meta.regularMarketDayLow, meta.regularMarketVolume);
      return true;
    }
    return false;
  }

  async function fetchCommodityQS(ticker, sym) {
    const enc = encodeURIComponent(ticker);
    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${enc}?modules=price`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${enc}?modules=price`,
    ];
    for (const url of urls) {
      const data = await viaProxy(url);
      const pr = data?.quoteSummary?.result?.[0]?.price; if (!pr) continue;
      const raw = v => (typeof v === 'object' ? v?.raw : v) ?? null;
      const price = raw(pr.regularMarketPrice); if (!price) continue;
      liveCommodity(sym, price,
        raw(pr.regularMarketPreviousClose) || raw(pr.regularMarketOpen),
        raw(pr.regularMarketDayHigh), raw(pr.regularMarketDayLow),
        raw(pr.regularMarketVolume));
      return true;
    }
    return false;
  }

  async function fetchCommodities() {
    // Stage 1: spark batch (fastest — one request for all)
    const sparkCount = await fetchCommoditiesSpark();

    // Stage 2: chart + quoteSummary for any that spark missed
    const missing = Object.entries(COMMODITY_MAP).filter(([, sym]) => !LIVE[sym]);
    if (missing.length) {
      await Promise.allSettled(missing.map(async ([ticker, sym]) => {
        const ok = await fetchCommodityChart(ticker, sym);
        if (!ok) await fetchCommodityQS(ticker, sym);
      }));
    }

    const loaded = Object.values(COMMODITY_MAP).filter(sym => LIVE[sym]).length;
    if (loaded > 0) dispatch();
    else console.warn('[prices] Commodities: 0/' + Object.keys(COMMODITY_MAP).length + ' loaded');
  }

  // ── Stocks / Indices / ETFs: Yahoo chart → quoteSummary ──────
  const EQUITY_MAP = {
    '^DJI':'US30',  '^GSPC':'SPX500', '^IXIC':'NAS100',
    '^FTSE':'UK100','^GDAXI':'GER40', '^FCHI':'FRA40',
    '^N225':'JPN225','^HSI':'HK50',   '^AXJO':'AUS200',
    'AAPL':'AAPL','MSFT':'MSFT','GOOGL':'GOOGL','AMZN':'AMZN',
    'TSLA':'TSLA','NVDA':'NVDA','META':'META','JPM':'JPM','V':'V','WMT':'WMT',
    'SPY':'SPY','QQQ':'QQQ','GLD':'GLD','SLV':'SLV',
    'VTI':'VTI','XLE':'XLE','ARKK':'ARKK','XLK':'XLK',
  };

  async function fetchOneEquity(ticker, sym) {
    const enc = encodeURIComponent(ticker);
    // Chart
    for (const host of ['query1', 'query2']) {
      const data = await viaProxy(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=5d`);
      const meta = data?.chart?.result?.[0]?.meta; if (!meta?.regularMarketPrice) continue;
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || meta.previousClose || price;
      LIVE[sym] = {
        price, chg: +(price-prev).toFixed(4), chgp: +((price-prev)/prev*100).toFixed(4),
        high: meta.regularMarketDayHigh || null, low: meta.regularMarketDayLow || null,
        vol: meta.regularMarketVolume || 0, bid: price, ask: price,
      };
      return;
    }
    // quoteSummary fallback
    for (const host of ['query1', 'query2']) {
      const data = await viaProxy(
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${enc}?modules=price`);
      const pr = data?.quoteSummary?.result?.[0]?.price; if (!pr) continue;
      const raw = v => (typeof v === 'object' ? v?.raw : v) ?? null;
      const price = raw(pr.regularMarketPrice); if (!price) continue;
      const prev  = raw(pr.regularMarketPreviousClose) || price;
      LIVE[sym] = {
        price, chg: +(price-prev).toFixed(4), chgp: +((price-prev)/prev*100).toFixed(4),
        high: raw(pr.regularMarketDayHigh), low: raw(pr.regularMarketDayLow),
        vol: raw(pr.regularMarketVolume) || 0, bid: price, ask: price,
      };
      return;
    }
  }

  async function fetchEquities() {
    await Promise.allSettled(
      Object.entries(EQUITY_MAP).map(([ticker, sym]) => fetchOneEquity(ticker, sym))
    );
    const loaded = Object.values(EQUITY_MAP).filter(sym => LIVE[sym]).length;
    if (loaded > 0) dispatch();
  }

  // ── Format helper (global) ───────────────────────────────────
  window.fmtPrice = function (sym, val) {
    if (val == null) return '—';
    const n = parseFloat(val); if (isNaN(n)) return '—';
    if (sym?.includes('JPY') || n > 1000)
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n < 1)  return n.toFixed(6);
    if (n < 10) return n.toFixed(4);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  // ── Boot ─────────────────────────────────────────────────────
  async function refreshAll() {
    await Promise.allSettled([fetchCrypto(), fetchForex(), fetchCommodities(), fetchEquities()]);
  }

  refreshAll();
  setInterval(fetchCrypto,     5000);
  setInterval(fetchForex,     60000);
  setInterval(fetchCommodities,30000);
  setInterval(fetchEquities,  30000);
})();
