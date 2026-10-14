// Hourly "light" refresh: rebuild the pool list for the coins the last full scan already tracks, using DexScreener (free) instead of
// CoinGecko discovery pages. Only the candle fetch for these coins still uses the CoinGecko plan, which is what keeps hourly updates
// inside a 100k-calls-a-month allowance. A full discovery scan still runs every 4 hours, right after each 4h candle closes.
const CHAIN = { Solana: { net: 'solana', chain: 'solana', dex: 'solana' }, Ethereum: { net: 'eth', chain: 'ethereum', dex: 'ethereum' }, Robinhood: { net: 'robinhood', chain: 'robinhood', dex: 'robinhood' } };
const num = (v, d = 0) => { const x = Number(v); return isFinite(x) ? x : d; };

// which scan to run: 'full' (discovery + everything) or 'light' (tracked coins only)
export function pickMode({ env = {}, meta = null, trackedCount = 0, settings = {}, usage = null, now = Date.now() }) {
  const forced = String(env.SCAN_MODE || '').toLowerCase(); if (forced === 'full' || forced === 'light') return { mode: forced, why: 'forced by SCAN_MODE' };
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') return { mode: 'full', why: 'manual run' };
  if (settings.lightScans === false) return { mode: 'full', why: 'light scans switched off' };
  if (trackedCount < 3) return { mode: 'full', why: 'nothing tracked yet' };
  const fullAge = meta && meta.fullAt ? (now - Date.parse(meta.fullAt)) / 3600e3 : Infinity;
  const limit = settings.cgMonthlyLimit ?? 100000;
  if (usage && usage.calls > 0.97 * limit) return { mode: 'light', why: 'monthly data allowance nearly used' };
  if (fullAge > 4.5) return { mode: 'full', why: `last full scan was ${fullAge === Infinity ? 'never' : fullAge.toFixed(1) + ' h ago'}` };
  const hr = new Date(now).getUTCHours();
  if (hr % 4 === 0 && fullAge > 1) return { mode: 'full', why: '4h candle just closed' };
  return { mode: 'light', why: 'between 4h candle closes' };
}

export async function poolsFromTracked(rows, signals, getJson, cfg = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const items = new Map();
  for (const r of rows || []) if (r && r.pool && CHAIN[r.chain]) items.set(String(r.pool).toLowerCase(), { row: r, chain: r.chain, pool: r.pool });
  for (const s of signals || []) if (s && s.pool && CHAIN[s.chain] && (s.status === 'open' || s.status === 'waiting for entry') && !items.has(String(s.pool).toLowerCase())) items.set(String(s.pool).toLowerCase(), { row: null, sig: s, chain: s.chain, pool: s.pool });
  const by = {}; for (const it of items.values()) (by[it.chain] ||= []).push(it);
  const dex = {};
  for (const [chain, arr] of Object.entries(by)) for (let i = 0; i < arr.length; i += 30) {
    try { const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${CHAIN[chain].dex}/${arr.slice(i, i + 30).map((a) => a.pool).join(',')}`); for (const q of (j && j.pairs) || []) dex[String(q.pairAddress).toLowerCase()] = q; } catch { /* fall back to the saved row */ }
    await sleep(250);
  }
  const list = []; let fromDex = 0, fromRow = 0;
  for (const it of items.values()) {
    const C = CHAIN[it.chain], q = dex[String(it.pool).toLowerCase()], r = it.row;
    let p;
    if (q && num(q.priceUsd) > 0) {
      fromDex++;
      p = { net: C.net, chain: C.chain, sym: String(q.baseToken?.symbol || r?.coin || it.sig?.coin || '').toUpperCase(), name: q.baseToken?.name || r?.name || '', token: q.baseToken?.address || r?.token || null, pool: it.pool, price: num(q.priceUsd), liq: num(q.liquidity?.usd), fdv: q.fdv ?? q.marketCap ?? r?.fdv ?? null,
        v24: num(q.volume?.h24), v1: num(q.volume?.h1), ch24: num(q.priceChange?.h24), created: q.pairCreatedAt ? new Date(q.pairCreatedAt).toISOString() : (r && r.ageDays != null ? new Date(Date.now() - r.ageDays * 864e5).toISOString() : null),
        b1: num(q.txns?.h1?.buys), s1: num(q.txns?.h1?.sells), b24: num(q.txns?.h24?.buys), s24: num(q.txns?.h24?.sells), buyers24: num(r?.buyers24h, num(q.txns?.h24?.buys)), sellers24: num(r?.sellers24h, num(q.txns?.h24?.sells)) };
    } else if (r) {
      fromRow++;
      p = { net: C.net, chain: C.chain, sym: r.coin, name: r.name || r.coin, token: r.token || null, pool: it.pool, price: num(r.price), liq: num(r.liquidity), fdv: r.fdv ?? null, v24: num(r.vol24h), v1: num(r.vol1h), ch24: num(r.chg24h), created: r.ageDays != null ? new Date(Date.now() - r.ageDays * 864e5).toISOString() : null,
        b1: 0, s1: 0, b24: 0, s24: 0, buyers24: num(r.buyers24h), sellers24: num(r.sellers24h) };
    } else continue;
    if (r && r.mine) p.mine = true;
    if (!p.sym || !(p.price > 0)) continue;
    if (!p.mine && (p.liq < (cfg.minLiquidity ?? 0) || p.v24 < (cfg.minVolume ?? 0))) continue;
    list.push(p);
  }
  return { list: list.sort((a, b) => b.v24 - a.v24), fromDex, fromRow };
}
