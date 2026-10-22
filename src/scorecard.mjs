// Wallet scorecard: learns which wallets keep buying coins BEFORE they run, from the scanner's own data (no X, no paid feed).
// Each time the scanner reads a coin's recent trades it records the wallets that were net buyers (an "episode": one coin, one day).
// Three days later it checks what the coin did from the price at that moment: did it run +50% before it fell 30%?
// A wallet that shows up in several episodes and was right much more often than the average is "proven". Bots and routers that appear
// in a large share of all coins are left out. This needs weeks of data before any wallet has enough episodes to be judged.
// Copyable PnL (edge report, Oct 2026): a wallet's own result is not yours. The scorecard also measures what YOU would have made entering
// after a realistic delay (the first hourly open after the scanner saw the wallet, plus 3% slippage) and out at the 24-hour close less 1%,
// and purges wallets that look like insiders or bots: first seen buying a pool under an hour old (sniper), over 100 swaps in one read (bot),
// profit that comes from one trade (cherry), or a run rate that has decayed (last 10 against the 20 before).
export const SC = { runPct: 50, dumpPct: 30, horizonH: 72, minN: 3, minWins: 2, prior: 4, lift: 0.15, botShare: 0.30, botMinEp: 50, keepDays: 45, maxEp: 3000, maxB: 20, slipIn: 3, slipOut: 1, sniperAgeH: 1, botSwaps: 100, cherryShare: 0.7, decayDrop: 0.2 };
const day = (iso) => String(iso).slice(0, 10);

// add or merge an episode: { pool, net, coin, chain, px, t, buyers: [[wallet, usd]], sellers: [[wallet, usd]] }
export function record(eps, e, cfg = SC) {
  if (!e || !e.pool || !(+e.px > 0) || !e.t) return eps; const id = e.pool + '@' + day(e.t), b = (e.buyers || []).map((x) => x[0]).slice(0, cfg.maxB), s = (e.sellers || []).map((x) => x[0]).slice(0, cfg.maxB);
  const old = eps.find((x) => x.id === id);
  if (old) { old.b = [...new Set([...old.b, ...b])].slice(0, cfg.maxB * 2); old.s = [...new Set([...(old.s || []), ...s])].slice(0, cfg.maxB * 2); return eps; }
  const kmax = Math.max(0, ...(e.buyers || []).map((x) => +x[2] || 0)); eps.push({ id, pool: e.pool, net: e.net, coin: e.coin, chain: e.chain, t: e.t, px: +e.px, b, s, out: null, ageH: e.ageH ?? null, kmax, bots: (e.buyers || []).filter((x) => (+x[2] || 0) > cfg.botSwaps).map((x) => x[0]) }); return eps;
}
// what the coin did over the next 72 hours from the recorded price, on hourly candles [t,o,h,l,c] ascending. null until 72 hours have passed.
export function resolve(ep, bars, cfg = SC) {
  const t0 = Date.parse(ep.t) / 1000, end = t0 + cfg.horizonH * 3600, B = (bars || []).filter((b) => +b[0] >= t0 && +b[0] < end);
  if (!B.length || !(bars || []).some((b) => +b[0] >= end - 3600)) return null;
  let peak = 0, ran = false, dumped = false; for (const b of B) { const up = +b[2] / ep.px - 1, dn = 1 - +b[3] / ep.px; if (!ran && dn >= cfg.dumpPct / 100) dumped = true; if (up >= cfg.runPct / 100 && !dumped) ran = true; peak = Math.max(peak, up); }
  const b24 = B.find((b) => +b[0] >= t0 + 23 * 3600), first = B[0], copy = b24 && first && +first[1] > 0 ? +(((+b24[4] * (1 - cfg.slipOut / 100)) / (+first[1] * (1 + cfg.slipIn / 100)) - 1) * 100).toFixed(1) : null;
  return { peak: +(peak * 100).toFixed(0), ret24: b24 ? +((+b24[4] / ep.px - 1) * 100).toFixed(1) : null, copy, ran, dumped };
}
// score every wallet seen in resolved episodes
export function score(eps, cfg = SC) {
  const all = (eps || []).filter((e) => !(e.out && e.out.na)), res = all.filter((e) => e.out), base = res.length ? res.filter((e) => e.out.ran).length / res.length : null, seen = new Map();
  for (const e of all) for (const w of new Set(e.b)) seen.set(w, (seen.get(w) || 0) + 1);
  const bots = new Set(all.length >= cfg.botMinEp ? [...seen].filter(([, k]) => k / all.length > cfg.botShare).map(([w]) => w) : []), st = new Map(), snipers = new Set(), swapBots = new Set();
  for (const e of all) { for (const w of e.bots || []) swapBots.add(w); if (e.ageH != null && e.ageH < cfg.sniperAgeH) for (const w of new Set(e.b)) snipers.add(w); }
  for (const e of res.slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) for (const w of new Set(e.b)) { if (bots.has(w) || snipers.has(w) || swapBots.has(w)) continue; const x = st.get(w) || { n: 0, wins: 0, dumps: 0, peak: 0, copy: [], runs: [] }; x.n++; if (e.out.ran) x.wins++; if (e.out.dumped) x.dumps++; x.peak += e.out.peak; if (e.out.copy != null) x.copy.push(e.out.copy); x.runs.push(e.out.ran ? 1 : 0); st.set(w, x); }
  const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null), b0 = base ?? 0;
  const rows = [...st].map(([w, x]) => { const pos = x.copy.filter((c) => c > 0), tot = pos.reduce((p, q) => p + q, 0), cherry = pos.length >= 2 && tot > 0 && Math.max(...pos) / tot > cfg.cherryShare, last = x.runs.slice(-10), prior = x.runs.slice(-30, -10), decayed = last.length >= 5 && prior.length >= 10 && mean(last) < mean(prior) - cfg.decayDrop;
    return { w, n: x.n, wins: x.wins, dumps: x.dumps, avgPeak: Math.round(x.peak / x.n), copyPct: mean(x.copy) == null ? null : +mean(x.copy).toFixed(1), cherry, decayed, est: +((x.wins + cfg.prior * b0) / (x.n + cfg.prior)).toFixed(3) }; });
  const proven = rows.filter((r) => base != null && r.n >= cfg.minN && r.wins >= cfg.minWins && r.est >= b0 + cfg.lift && !r.cherry && !r.decayed && (r.copyPct == null || r.copyPct > 0)).sort((a, b) => b.est - a.est || b.n - a.n);
  return { base: base == null ? null : +base.toFixed(3), episodes: all.length, resolved: res.length, wallets: st.size, bots: bots.size + swapBots.size, snipers: snipers.size, purged: rows.filter((r) => r.cherry || r.decayed || (r.copyPct != null && r.copyPct <= 0)).length, proven, provenSet: new Set(proven.map((r) => r.w)), botSet: new Set([...bots, ...swapBots, ...snipers]),
    candidates: rows.filter((r) => r.n >= 2 && r.wins >= 1).sort((a, b) => b.est - a.est).slice(0, 20) };
}
export function trim(eps, now = Date.now(), cfg = SC) { return (eps || []).filter((e) => now - Date.parse(e.t) < cfg.keepDays * 864e5).slice(-cfg.maxEp); }
// how many proven wallets are in this coin's buyers / sellers right now
export function provenIn(w, sc) { if (!w || !sc) return { in: 0, out: 0 }; const b = (w.netBuyers || []).filter(([a]) => sc.provenSet.has(a)).length, s = (w.netSellers || []).filter(([a]) => sc.provenSet.has(a)).length; return { in: b, out: s }; }
// compact, public summary for the dashboard (addresses are public on-chain data)
export function summary(sc, early = [], at) {
  return { at, base: sc.base, episodes: sc.episodes, resolved: sc.resolved, wallets: sc.wallets, bots: sc.bots, proven: sc.proven.slice(0, 25), candidates: sc.candidates.slice(0, 10), early,
    snipers: sc.snipers, purged: sc.purged, rule: `A wallet is proven after ${SC.minN}+ coins and ${SC.minWins}+ wins, with a run rate at least ${Math.round(SC.lift * 100)} points above average, a positive copyable return (in at the next hourly open plus ${SC.slipIn}%, out at the 24-hour close less ${SC.slipOut}%), no single trade making most of its profit, and no decay in its last 10. Snipers (first seen buying a pool under ${SC.sniperAgeH} hour old), bots (over ${SC.botSwaps} swaps in a read) and routers are left out. A run = +${SC.runPct}% within ${SC.horizonH} hours before a ${SC.dumpPct}% drop.` };
}
