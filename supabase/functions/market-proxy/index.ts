const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const symbols = url.searchParams.get('symbols') || ''
  if (!symbols) return json({})

  // Sanitize: only allow alphanumeric, comma, caret, equals, hyphen, dot
  const safe = symbols.replace(/[^A-Za-z0-9,\^=\-\.]/g, '').slice(0, 500)
  if (!safe) return json({})

  const yahooUrl =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${safe}&lang=en-US&region=US&corsDomain=finance.yahoo.com`

  try {
    const r = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!r.ok) return json({})

    const raw = await r.json()
    const results = raw?.quoteResponse?.result
    if (!Array.isArray(results)) return json({})

    const out: Record<string, unknown> = {}
    for (const q of results) {
      out[q.symbol] = {
        price:  q.regularMarketPrice           ?? null,
        chg:    q.regularMarketChange          ?? 0,
        chgp:   q.regularMarketChangePercent   ?? 0,
        high:   q.regularMarketDayHigh         ?? q.regularMarketPrice,
        low:    q.regularMarketDayLow          ?? q.regularMarketPrice,
        open:   q.regularMarketOpen            ?? q.regularMarketPrice,
        vol:    q.regularMarketVolume          ?? 0,
        prev:   q.regularMarketPreviousClose   ?? q.regularMarketPrice,
        name:   q.longName || q.shortName      || q.symbol,
      }
    }
    return json(out)
  } catch (e) {
    console.error('market-proxy error:', e)
    return json({})
  }
})
