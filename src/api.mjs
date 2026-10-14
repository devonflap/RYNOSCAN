// Market-data client with pacing, retry and backoff.
//   CG_API_KEY + CG_PLAN=pro   -> https://pro-api.coingecko.com/api/v3/onchain  (paid plans: Basic and up)
//   CG_API_KEY + CG_PLAN=demo  -> https://api.coingecko.com/api/v3/onchain      (free Demo key)
//   no key                     -> https://api.geckoterminal.com/api/v2          (free, slow: ~4 calls/min)
// The key is only ever read from the environment (a GitHub secret). It is never written to a file or logged.
export function makeApi(env = process.env, fetchImpl = globalThis.fetch) {
  const key = (env.CG_API_KEY || '').trim();
  const plan = (env.CG_PLAN || 'pro').trim().toLowerCase();
  let base, headers = { accept: 'application/json' };
  if (key && plan === 'demo') { base = 'https://api.coingecko.com/api/v3/onchain'; headers['x-cg-demo-api-key'] = key; }
  else if (key) { base = 'https://pro-api.coingecko.com/api/v3/onchain'; headers['x-cg-pro-api-key'] = key; }
  else base = 'https://api.geckoterminal.com/api/v2';
  const keyed = !!key;
  const paceMs = Number(env.PACE_MS) || (keyed ? 250 : 4000);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let last = 0, n429 = 0, nErr = 0, calls = 0;
  const log = [];
  // base2 = CoinGecko main API (not on-chain): used for SOL/ETH price history
  const base2 = key && plan !== 'demo' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
  async function get(path, b = base, h = headers) {
    for (let a = 0; a < 6; a++) {
      const w = Math.max(0, paceMs - (Date.now() - last)); if (w) await sleep(w); last = Date.now();
      let r; calls++;
      try { r = await fetchImpl(b + path, { headers: h, signal: AbortSignal.timeout(30000) }); }
      catch (e) { nErr++; log.push('net'); await sleep(keyed ? 3000 : 15000); continue; }
      if (r.status === 429) {
        n429++; log.push('429');
        const ra = Number(r.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 + 500 : (keyed ? 5000 : 20000) * (a + 1)); continue;
      }
      if (r.status >= 500) { nErr++; log.push(String(r.status)); await sleep(3000 * (a + 1)); continue; }
      if (!r.ok) { log.push(r.status + ' ' + path.split('?')[0]); return null; }
      return r.json();
    }
    return null;
  }
  const getCG = path => get(path, base2, headers);
  // Plain GET for the second-opinion feed (no key needed).
  async function getJson(url) {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  return { get, getCG, getJson, sleep, keyed, plan: keyed ? plan : 'free', paceMs, base, log, stats: () => ({ calls, n429, nErr }) };
}
