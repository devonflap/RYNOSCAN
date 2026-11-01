// Market-data client with pacing, retry and backoff.
//   CG_API_KEY + CG_PLAN=pro   -> https://pro-api.coingecko.com/api/v3/onchain  (paid plans: Basic and up)
//   CG_API_KEY + CG_PLAN=demo  -> https://api.coingecko.com/api/v3/onchain      (free Demo key)
//   no key                     -> https://api.geckoterminal.com/api/v2          (free: about 30 calls a minute)
// The key is only ever read from the environment (a GitHub secret). It is never written to a file or logged.
export function makeApi(env = process.env, fetchImpl = globalThis.fetch) {
  const key = (env.CG_API_KEY || '').trim();
  const plan = (env.CG_PLAN || 'pro').trim().toLowerCase();
  let base, headers = { accept: 'application/json' };
  /* 1 Nov (the bots wound down, the paid plan cancelled): with the free Demo key, the on-chain calls (about 200 a scan, every scan) go to
     GeckoTerminal's free feed, which has no monthly cap, and the Demo key is kept for CoinGecko's main API only (the daily Chill list:
     well inside the Demo key's 10,000 calls a month) */
  if (key && plan === 'demo') base = 'https://api.geckoterminal.com/api/v2';
  else if (key) { base = 'https://pro-api.coingecko.com/api/v3/onchain'; headers['x-cg-pro-api-key'] = key; }
  else base = 'https://api.geckoterminal.com/api/v2';
  const keyed = !!key && plan !== 'demo';
  const paceMs = Number(env.PACE_MS) || (keyed ? 250 : 2200) /* GeckoTerminal's free feed takes about 30 calls a minute */; /* GeckoTerminal's free feed: about 30 calls a minute */
  const sleep = ms => new Promise(r => setTimeout(r, ms)), wait = ms => sleep(ms * (Number(env.RETRY_SCALE) >= 0 && env.RETRY_SCALE !== undefined ? Number(env.RETRY_SCALE) : 1)); // RETRY_SCALE shrinks retry delays in tests
  let last = 0, n429 = 0, nErr = 0, calls = 0, failStreak = 0; // failStreak: requests in a row that failed after every retry (feed down)
  const log = [];
  // base2 = CoinGecko main API (not on-chain): used for SOL/ETH price history
  const base2 = key && plan !== 'demo' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  async function get(path, b = base, h = headers) {
    for (let a = 0; a < 6; a++) {
      const w = Math.max(0, paceMs - (Date.now() - last)); if (w) await sleep(w); last = Date.now();
      let r; calls++;
      try { r = await fetchImpl(b + path, { headers: h, signal: AbortSignal.timeout(30000) }); }
      catch (e) { nErr++; log.push('net'); await wait(keyed ? 3000 : 15000); continue; }
      if (r.status === 429) {
        n429++; log.push('429');
        const ra = Number(r.headers.get('retry-after'));
        await wait(ra > 0 ? ra * 1000 + 500 : (keyed ? 5000 : 20000) * (a + 1)); continue;
      }
      if (r.status >= 500) { nErr++; log.push(String(r.status)); await wait(3000 * (a + 1)); continue; }
      if (!r.ok) { failStreak = 0; log.push(r.status + ' ' + path.split('?')[0]); return null; }
      try { const j = await r.json(); failStreak = 0; return j; } catch (e) { nErr++; log.push('badjson ' + path.split('?')[0]); await wait(keyed ? 1500 : 5000); continue; }
    }
    if (++failStreak >= 4) throw new Error('data feed unreachable: 4 requests in a row failed after retries. Stopping early; the dashboard keeps the last good data.');
    return null;
  }
  const cgHeaders = key && plan === 'demo' ? { accept: 'application/json', 'x-cg-demo-api-key': key } : headers;
  const getCG = path => get(path, base2, cgHeaders);
  // Plain GET for the second-opinion feed (no key needed).
  async function getJson(url) {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  return { get, getCG, getJson, sleep, keyed, plan: keyed ? plan : key ? 'demo (on-chain on the free feed)' : 'free', paceMs, base, log, stats: () => ({ calls, n429, nErr }) };
}
