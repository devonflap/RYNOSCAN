// THE VOLUME LIST (1 Nov: the bots wound down; Ryan trades by hand off the scanner). The Volume rider's rules (bot/volrider.mjs), run on
// GitHub every 15 minutes with the entry watcher instead of on a server: the day's biggest-volume coins on Solana and Robinhood, each
// watched for 48 hours after it was last on the list (a coin cools into its base after its volume has dropped it off the list), and
// each one's 15-minute chart read for Ryan's setup: a run, the first dip into 0.5-0.786, a base with volume cooled but alive. The page
// shows the coins basing now with the plan (bid, stop, sells, moonbag), and the rest with where each one is up to. Writes
// docs/data/volume.json. Free data only (GeckoTerminal), about 70 calls a run.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { VOLR, volCandidates, volSetup } from '../bot/volrider.mjs';
export const VOLLIST = { watchH: 48, maxScan: 60, paceMs: 5000, budgetMs: 8 * 60e3, everyMin: 28, nets: ['solana', 'robinhood'] };
/* 2 Nov: the free feed rate-limited a 2.2s pace into 15-minute runs that hit the watcher's time limit and cancelled it, live prices and all.
   Now: one call every 5 seconds, an 8-minute budget (coins not reached keep their last reading), and a run every half hour at most. */
const GT = 'https://api.geckoterminal.com/api/v2';
export function stageOf(why) { const w = String(why || ''); return /no real run/.test(w) ? 'no run yet' : /still running|too fresh/.test(w) ? 'running' : /only \d+% back/.test(w) ? 'first dip, shallow' : /gave back|broke down|volume dead/.test(w) ? 'broken' : /not a base|not cooled|already left|too wide|too close/.test(w) ? 'dip, no base yet' : 'too new'; }
export async function volumeList({ fetchJson, now = Date.now(), prev = null, cfg = VOLR, L = VOLLIST, log = () => {}, clock = () => Date.now() } = {}) { const t0 = clock();
  const pages = []; for (const net of L.nets) for (const p of ['trending_pools?page=1&duration=1h', 'trending_pools?page=1&duration=6h', 'pools?sort=h24_volume_usd_desc&page=1']) { const j = await fetchJson(`${GT}/networks/${net}/${p}&include=base_token`); if (j && j.data) pages.push({ net, data: j.data, included: j.included }); else log('no data: ' + net + ' ' + p); }
  const list = pages.length ? volCandidates(pages, cfg) : [], iso = new Date(now).toISOString().slice(0, 19) + 'Z', seen = { ...((prev && prev.seen) || {}) };
  for (const c of list) { const o = seen[c.pool] || { coin: c.coin, chain: c.chain, token: c.token, pair: c.pair, first: iso, h6max: 0 }; seen[c.pool] = { ...o, last: iso, h6max: Math.max(o.h6max || 0, Math.round(c.h6)) }; }
  for (const [k, o] of Object.entries(seen)) if (now - Date.parse(o.last) > L.watchH * 3600e3) delete seen[k];
  const onList = new Set(list.map((c) => c.pool)), watched = Object.entries(seen).filter(([p]) => !onList.has(p)).sort((a, b) => Date.parse(b[1].last) - Date.parse(a[1].last)).map(([pool, o]) => ({ pool, chain: o.chain, coin: o.coin, token: o.token, pair: o.pair, h6: o.h6max, watched: true }));
  const items = [], nowSec = now / 1000;
  const prevItems = new Map((((prev && prev.items) || [])).map((x) => [x.pool, x])); let skipped = 0;
  /* the watched coins read longest ago go first, so a coin skipped for time one run is read the next */
  watched.sort((a, b) => (Date.parse((prevItems.get(a.pool) || {}).readAt || 0) || 0) - (Date.parse((prevItems.get(b.pool) || {}).readAt || 0) || 0));
  for (const c of [...list, ...watched].slice(0, L.maxScan)) { if (clock() - t0 > L.budgetMs) { const old = prevItems.get(c.pool); if (old) items.push({ ...old, stale: true }); skipped++; continue; } const j = await fetchJson(`${GT}/networks/${c.chain}/pools/${c.pool}/ohlcv/minute?aggregate=15&limit=400&currency=usd&token=base`), raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list;
    const B = Array.isArray(raw) ? raw.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]) : null, o = seen[c.pool] || {};
    const base = { readAt: iso, coin: c.coin, chain: c.chain, pool: c.pool, token: c.token || null, pair: c.pair || null, h6: Math.round(c.h6 || 0), onList: !c.watched, firstSeen: o.first || null, lastOnList: o.last || null };
    if (!B || !B.length) { items.push({ ...base, status: 'waiting', stage: 'no chart', why: 'no chart from GeckoTerminal' }); continue; }
    const px = B[B.length - 1][4], r = volSetup(B, px, nowSec, cfg, { entryN: 1 }), again = r && r.none && /only \d+% back/.test(r.none) && Date.parse(o.first || iso) < now - 6 * 3600e3 ? volSetup(B, px, nowSec, cfg, { entryN: 2 }) : null, R = again && !again.none ? again : r;
    if (R && !R.none) { const sells = R.mults.map((m, i) => ({ px: +(px * m).toPrecision(5), pct: Math.round((m - 1) * 100), share: Math.round((R.shares[i] || 0) * 100) }));
      items.push({ ...base, status: 'setup', stage: R === again ? 'second base (handle)' : 'basing after the first dip', price: px, plan: { entry: px, stop: R.stop, stopPct: R.stopPct, sells, moonbag: 30, trailPct: Math.round(cfg.moonTrail * 100) }, runX: +(R.hi / R.lo).toFixed(2), retr: R.retr, rangePct: R.rangePct, basePaceH: R.basePaceH, why: R.why }); }
    else items.push({ ...base, status: 'waiting', price: px, stage: r ? stageOf(r.none) : 'too new', why: r ? r.none : 'under 5 hours of chart yet' }); }
  // the holder count and the top 10's share for the coins basing now (GeckoTerminal), so they can be checked before a bid
  for (const it of items.filter((x) => x.status === 'setup' && x.token && !x.stale)) { if (clock() - t0 > L.budgetMs + 60e3) break; const j = await fetchJson(`${GT}/networks/${it.chain}/tokens/${it.token}/info`), a = (j && j.data && j.data.attributes) || {}, h = a.holders || {};
    it.holders = h.count != null ? +h.count : null; it.top10 = h.distribution_percentage && h.distribution_percentage.top_10 != null ? +h.distribution_percentage.top_10 : null;
    const pts = [...(((prev && prev.holders) || {})[it.pool] || []), ...(it.holders ? [[now, it.holders]] : [])].filter((p) => now - p[0] < 6 * 3600e3), old = pts.find((p) => now - p[0] >= 90 * 60e3); if (old && it.holders) it.holderGrowthPct = +((it.holders / old[1] - 1) * 100).toFixed(1); it._pts = pts; }
  const holders = {}; for (const it of items) if (it._pts) { holders[it.pool] = it._pts; delete it._pts; }
  for (const [k, v] of Object.entries((prev && prev.holders) || {})) if (!holders[k] && seen[k]) holders[k] = v.filter((p) => now - p[0] < 6 * 3600e3);
  const order = { setup: 0, waiting: 1 }; items.sort((a, b) => order[a.status] - order[b.status] || b.onList - a.onList || b.h6 - a.h6);
  return { at: iso, rules: { runX: cfg.minPumpX, zone: [cfg.zoneLo, 0.786], baseH: cfg.baseBars / 4, baseRangePct: cfg.baseRangePct, watchH: L.watchH }, listN: list.length, watchedN: watched.length, skipped, items, seen, holders }; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const OUT = process.env.OUT_DIR || 'docs/data', f = OUT + '/volume.json'; let prev = null; try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first run */ }
  if (prev && prev.at && Date.now() - Date.parse(prev.at) < VOLLIST.everyMin * 60e3 && !process.env.VOL_FORCE) { console.log('volume list: updated ' + Math.round((Date.now() - Date.parse(prev.at)) / 60e3) + ' minutes ago, next run in half an hour'); process.exit(0); }
  let last = 0; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fetchJson = async (u) => { for (let a = 0; a < 4; a++) { const w = VOLLIST.paceMs - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
    try { const r = await fetch(u, { headers: { accept: 'application/json;version=20230302', 'user-agent': 'RynoScan volume list' }, signal: AbortSignal.timeout(30000) }); if (r.status === 429) { await sleep(15000 * (a + 1)); continue; } if (!r.ok) return null; return await r.json(); } catch { await sleep(5000); } } return null; };
  const out = await volumeList({ fetchJson, prev, log: (m) => console.log(m) });
  if (!out.listN && prev) { console.log('no volume list this run (feed down?): keeping the last one'); process.exit(0); }
  fs.writeFileSync(f, JSON.stringify(out)); console.log(`volume list: ${out.listN} on the list, ${out.watchedN} watched, ${out.items.filter((x) => x.status === 'setup').length} basing now${out.skipped ? `, ${out.skipped} not reached in the time budget (last reading kept)` : ''}`); }
