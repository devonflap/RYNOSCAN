// Holder data from the same free on-chain feed the scanner already uses (token info: holder count and top-holder shares).
// Holder growth is measured by RynoScan itself: every lookup is saved, and growth is the change since the oldest reading that is at least a day old.
// Record-only: shown on the card and tested by the learning loop; it never changes a score.
import { parseInfo, growth } from '../docs/holders.mjs';
export { parseInfo, growth };
export const DEFAULTS = { maxPerScan: 40, ttlH: 6, keepDays: 14 };
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);

// pools: scored rows. get(path) -> parsed JSON or null. cache: { token: { at, hist, hs } } (mutated).
export async function enrich(pools, { get, netOf, cache = {}, cfg = {}, now = Date.now(), fetchNew = true, sleep = async () => {} }) {
  const c = { ...DEFAULTS, ...cfg }; let looked = 0, applied = 0, fails = 0, status = 'ok'; const notes = [];
  const want = pools.filter((p) => p && p.token && netOf(p.chain)).sort((a, b) => (b.signal === 'Entry signal') - (a.signal === 'Entry signal') || (b.opp ?? 0) - (a.opp ?? 0));
  for (const p of want) {
    const k = p.chain + ':' + p.token, hit = cache[k], fresh = hit && now - hit.at < c.ttlH * 3600e3;
    if (hit && hit.hs && (fresh || !fetchNew)) { p.hs = { ...hit.hs, ...growth(hit.hist, hit.hs.holders, now) }; applied++; continue; }
    if (!fetchNew || looked >= c.maxPerScan || status !== 'ok') continue;
    looked++; let info = null; try { info = parseInfo(await get(`/networks/${netOf(p.chain)}/tokens/${p.token}/info`)); } catch { info = null; }
    if (!info) { fails++; if (fails >= 6 && applied === 0 && looked === fails) { status = 'unavailable'; notes.push('holder data not available from the feed (6 misses in a row)'); } cache[k] = { at: now, hist: (hit && hit.hist) || [], hs: null }; continue; }
    fails = 0; const hist = ((hit && hit.hist) || []).filter((x) => Array.isArray(x) && now - x[0] <= c.keepDays * 86400e3); hist.push([now, info.holders]);
    cache[k] = { at: now, hist: hist.slice(-60), hs: info }; p.hs = { ...info, ...growth(hist.slice(0, -1), info.holders, now) }; applied++;
    await sleep(100);
  }
  return { status, looked, applied, notes };
}
