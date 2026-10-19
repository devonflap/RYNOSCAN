// Wallet scorecard: learns which wallets keep buying coins BEFORE they run, from the scanner's own data (no X, no paid feed).
// Each time the scanner reads a coin's recent trades it records the wallets that were net buyers (an "episode": one coin, one day).
// Three days later it checks what the coin did from the price at that moment: did it run +50% before it fell 30%?
// A wallet that shows up in several episodes and was right much more often than the average is "proven". Bots and routers that appear
// in a large share of all coins are left out. This needs weeks of data before any wallet has enough episodes to be judged.
export const SC = { runPct: 50, dumpPct: 30, horizonH: 72, minN: 3, minWins: 2, prior: 4, lift: 0.15, botShare: 0.30, botMinEp: 50, keepDays: 45, maxEp: 3000, maxB: 20 };
const day = (iso) => String(iso).slice(0, 10);

// add or merge an episode: { pool, net, coin, chain, px, t, buyers: [[wallet, usd]], sellers: [[wallet, usd]] }
export function record(eps, e, cfg = SC) {
  if (!e || !e.pool || !(+e.px > 0) || !e.t) return eps; const id = e.pool + '@' + day(e.t), b = (e.buyers || []).map((x) => x[0]).slice(0, cfg.maxB), s = (e.sellers || []).map((x) => x[0]).slice(0, cfg.maxB);
  const old = eps.find((x) => x.id === id);
  if (old) { old.b = [...new Set([...old.b, ...b])].slice(0, cfg.maxB * 2); old.s = [...new Set([...(old.s || []), ...s])].slice(0, cfg.maxB * 2); return eps; }
  eps.push({ id, pool: e.pool, net: e.net, coin: e.coin, chain: e.chain, t: e.t, px: +e.px, b, s, out: null }); return eps;
}
// what the coin did over the next 72 hours from the recorded price, on hourly candles [t,o,h,l,c] ascending. null until 72 hours have passed.
export function resolve(ep, bars, cfg = SC) {
  const t0 = Date.parse(ep.t) / 1000, end = t0 + cfg.horizonH * 3600, B = (bars || []).filter((b) => +b[0] >= t0 && +b[0] < end);
  if (!B.length || !(bars || []).some((b) => +b[0] >= end - 3600)) return null;
  let peak = 0, ran = false, dumped = false; for (const b of B) { const up = +b[2] / ep.px - 1, dn = 1 - +b[3] / ep.px; if (!ran && dn >= cfg.dumpPct / 100) dumped = true; if (up >= cfg.runPct / 100 && !dumped) ran = true; peak = Math.max(peak, up); }
  const b24 = B.find((b) => +b[0] >= t0 + 23 * 3600); return { peak: +(peak * 100).toFixed(0), ret24: b24 ? +((+b24[4] / ep.px - 1) * 100).toFixed(1) : null, ran, dumped };
}
// score every wallet seen in resolved episodes
export function score(eps, cfg = SC) {
  const all = (eps || []).filter((e) => !(e.out && e.out.na)), res = all.filter((e) => e.out), base = res.length ? res.filter((e) => e.out.ran).length / res.length : null, seen = new Map();
  for (const e of all) for (const w of new Set(e.b)) seen.set(w, (seen.get(w) || 0) + 1);
  const bots = new Set(all.length >= cfg.botMinEp ? [...seen].filter(([, k]) => k / all.length > cfg.botShare).map(([w]) => w) : []), st = new Map();
  for (const e of res) for (const w of new Set(e.b)) { if (bots.has(w)) continue; const x = st.get(w) || { n: 0, wins: 0, dumps: 0, peak: 0 }; x.n++; if (e.out.ran) x.wins++; if (e.out.dumped) x.dumps++; x.peak += e.out.peak; st.set(w, x); }
  const b0 = base ?? 0, rows = [...st].map(([w, x]) => ({ w, n: x.n, wins: x.wins, dumps: x.dumps, avgPeak: Math.round(x.peak / x.n), est: +((x.wins + cfg.prior * b0) / (x.n + cfg.prior)).toFixed(3) }));
  const proven = rows.filter((r) => base != null && r.n >= cfg.minN && r.wins >= cfg.minWins && r.est >= b0 + cfg.lift).sort((a, b) => b.est - a.est || b.n - a.n);
  return { base: base == null ? null : +base.toFixed(3), episodes: all.length, resolved: res.length, wallets: st.size, bots: bots.size, proven, provenSet: new Set(proven.map((r) => r.w)), botSet: bots,
    candidates: rows.filter((r) => r.n >= 2 && r.wins >= 1).sort((a, b) => b.est - a.est).slice(0, 20) };
}
export function trim(eps, now = Date.now(), cfg = SC) { return (eps || []).filter((e) => now - Date.parse(e.t) < cfg.keepDays * 864e5).slice(-cfg.maxEp); }
// how many proven wallets are in this coin's buyers / sellers right now
export function provenIn(w, sc) { if (!w || !sc) return { in: 0, out: 0 }; const b = (w.netBuyers || []).filter(([a]) => sc.provenSet.has(a)).length, s = (w.netSellers || []).filter(([a]) => sc.provenSet.has(a)).length; return { in: b, out: s }; }
// compact, public summary for the dashboard (addresses are public on-chain data)
export function summary(sc, early = [], at) {
  return { at, base: sc.base, episodes: sc.episodes, resolved: sc.resolved, wallets: sc.wallets, bots: sc.bots, proven: sc.proven.slice(0, 25), candidates: sc.candidates.slice(0, 10), early,
    rule: `A wallet is proven after ${SC.minN}+ coins and ${SC.minWins}+ wins, with a run rate at least ${Math.round(SC.lift * 100)} points above average. A run = +${SC.runPct}% within ${SC.horizonH} hours before a ${SC.dumpPct}% drop.` };
}
