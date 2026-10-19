// Early-move checker ("pulse"): runs inside the entry watcher every ~15 minutes, between the hourly scans, on the free DexScreener feed.
// It re-reads every coin the last full scan saw (docs/data/universe.json, ~250 pools, 30 per call) and flags coins where something is
// starting NOW: 5-minute volume running hot against the last hour, the last hour hot against the last 6 hours, price just turning up,
// buyers outnumbering sellers in the last 5 minutes. It skips coins already up a lot (never chase vertical candles) and coins with an
// active paid DexScreener boost (promotion, not organic demand). Paper only: hits become trades in the "Early pulse" book.
import { flowCutEvent, PROFILES } from '../docs/exits.mjs';
export const PULSE = { minLiq: 50000, minV24: 150000, acc5: 2.5, acc1: 1.5, m5Min: 1.5, h1Min: 3, h1Max: 60, h24Max: 300, minBuys: 8, buyLead: 1.3, coolH: 6, keepH: 20, maxItems: 15 };
const n = (v) => (v == null || v === '' || !isFinite(+v) ? 0 : +v);

// one DexScreener pair -> a hit or null
export function pulseScore(q, cfg = PULSE) {
  if (!q || !q.pairAddress) return null;
  const v = q.volume || {}, pc = q.priceChange || {}, t5 = (q.txns && q.txns.m5) || {}, liq = n(q.liquidity && q.liquidity.usd);
  if (liq < cfg.minLiq || n(v.h24) < cfg.minV24) return null;
  if (q.boosts && n(q.boosts.active) > 0) return null;
  const base5 = n(v.h1) / 12, base1 = n(v.h6) / 6, acc5 = base5 > 0 ? n(v.m5) / base5 : 0, acc1 = base1 > 0 ? n(v.h1) / base1 : 0;
  const m5 = n(pc.m5), h1 = n(pc.h1), h24 = n(pc.h24), b = n(t5.buys), s = n(t5.sells);
  if (acc5 < cfg.acc5 || acc1 < cfg.acc1 || m5 < cfg.m5Min || h1 < cfg.h1Min || h1 > cfg.h1Max || h24 > cfg.h24Max || b < cfg.minBuys || b < cfg.buyLead * s) return null;
  const score = Math.round(Math.min(acc5, 8) * 5 + Math.min(acc1, 5) * 6 + Math.min(b / Math.max(1, s), 4) * 5 + (h1 <= 25 ? 10 : 3) + Math.min(m5, 6));
  return { pool: String(q.pairAddress), price: n(q.priceUsd), liq: Math.round(liq), v24: Math.round(n(v.h24)), acc5: +acc5.toFixed(1), acc1: +acc1.toFixed(1), m5, h1, h24, buys5: b, sells5: s, score, url: q.url || null,
    why: [`5-minute volume ${acc5.toFixed(1)}x the last hour's pace`, `last hour ${acc1.toFixed(1)}x the 6-hour pace`, `+${m5}% in 5 min, +${h1}% in 1 h`, `${b} buys vs ${s} sells in 5 min`] };
}

// universe: [{ pool, net, chain, sym, id }] from the last full scan. Returns hits sorted by score.
export async function pulseScan(universe, getJson, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), cfg = PULSE) {
  const DS = { solana: 'solana', robinhood: 'robinhood', eth: 'ethereum' }, by = {}, meta = new Map(), hits = [];
  for (const u of universe || []) { if (!u || !u.pool || !u.net) continue; (by[u.net] ||= []).push(u); meta.set(String(u.pool).toLowerCase(), u); }
  for (const [net, arr] of Object.entries(by)) for (let i = 0; i < arr.length; i += 30) {
    try { const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${DS[net] || net}/${arr.slice(i, i + 30).map((p) => p.pool).join(',')}`);
      for (const q of (j && j.pairs) || []) { const h = pulseScore(q, cfg); if (!h) continue; const u = meta.get(h.pool.toLowerCase()); if (!u) continue; hits.push({ ...h, pool: u.pool, net: u.net, chain: u.chain, coin: u.sym, id: u.id }); } }
    catch { /* one batch failing must not stop the rest */ }
    await sleep(250);
  }
  return hits.sort((a, b) => b.score - a.score);
}

// keep a short history so the hourly scan can turn hits into paper trades; one signal per coin per coolH hours
export function updatePulse(prev, hits, now = Date.now(), cfg = PULSE) {
  const at = new Date(now).toISOString().slice(0, 19) + 'Z', recent = ((prev && prev.recent) || []).filter((r) => r && now - Date.parse(r.at) < cfg.keepH * 3600e3), fresh = [];
  for (const h of hits) { const last = recent.filter((r) => r.pool === h.pool).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]; if (last && now - Date.parse(last.at) < cfg.coolH * 3600e3) continue; const r = { ...h, at }; recent.push(r); fresh.push(r); }
  return { at, items: hits.slice(0, cfg.maxItems).map((h) => ({ ...h, at })), recent: recent.slice(-200), fresh, runs: [...(((prev && prev.runs) || []).slice(-95)), { at, n: hits.length }] };
}

// Cut-on-sellers check for open "Degen · cut on sellers" paper trades (every watcher run). Records a DexScreener read only when it
// would cut: the trade is 8%+ under its entry price and sellers lead (1.2x more sells than buys in the last hour, more sells than buys
// in the last 5 minutes). The hourly scan turns the first such read into the exit, at the price recorded here.
export async function flowScan(positions, getJson, nowIso, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const DSN = { solana: 'solana', robinhood: 'robinhood', eth: 'ethereum' }, by = {}, out = [];
  for (const x of positions || []) { if (!x || !x.pool || !x.net || !(+x.entryPx > 0) || !PROFILES[x.profile] || !PROFILES[x.profile].flowCut) continue; (by[x.net] ||= []).push(x); }
  for (const [net, arr] of Object.entries(by)) for (let i = 0; i < arr.length; i += 30) {
    try { const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${DSN[net] || net}/${arr.slice(i, i + 30).map((p) => p.pool).join(',')}`), q = new Map(((j && j.pairs) || []).map((p) => [String(p.pairAddress).toLowerCase(), p]));
      for (const x of arr.slice(i, i + 30)) { const p = q.get(String(x.pool).toLowerCase()); if (!p) continue; const t1 = (p.txns && p.txns.h1) || {}, t5 = (p.txns && p.txns.m5) || {};
        const ev = { lid: x.lid, pool: x.pool, coin: x.coin, t: nowIso, src: 'dex', b1: +t1.buys || 0, s1: +t1.sells || 0, b5: +t5.buys || 0, s5: +t5.sells || 0, px: +p.priceUsd || null };
        if (flowCutEvent([ev], [], x.entryPx, x.entryAt || x.signalAt, PROFILES[x.profile].flowCut)) out.push(ev); } }
    catch { /* next run */ }
    await sleep(250);
  }
  return out;
}
