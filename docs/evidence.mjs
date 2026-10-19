// Evidence: is a paper book showing a real edge, or just luck so far? Shared by the dashboard and the weekly report.
// Every closed trade is measured in R: profit or loss divided by what it would have lost at its first stop. That puts a 4% scalp
// and a 25% degen stop on the same scale. The average R per trade (expectancy) gets a 90% range by resampling the trades
// (bootstrap), so a few lucky winners cannot pass for an edge.
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export function bootstrap(xs, iters = 2000, seed = 7) {
  const n = xs.length; if (n < 2) return null; const r = rng(seed + n * 31), ms = new Float64Array(iters);
  for (let k = 0; k < iters; k++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(r() * n)]; ms[k] = s / n; }
  const a = Array.from(ms).sort((x, y) => x - y); return { lo: a[Math.floor(iters * 0.05)], hi: a[Math.floor(iters * 0.95)], pPos: a.filter((m) => m > 0).length / iters };
}
const r2 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(2));
// p: a book() result. Returns the verdict and the numbers behind it.
export function evidence(p, { now = Date.now(), recentDays = 14, minN = 30 } = {}) {
  const done = (p && p.trades ? p.trades : []).filter((t) => !t.open && t.R != null && isFinite(t.R)), R = done.map((t) => t.R), n = R.length;
  const out = { n, open: p ? p.openN : 0, avgR: n ? r2(mean(R)) : null, medR: n ? r2(med(R)) : null, win: n ? +(R.filter((x) => x > 0).length / n).toFixed(2) : null };
  const b = n >= 5 ? bootstrap(R) : null; if (b) { out.lo = r2(b.lo); out.hi = r2(b.hi); out.pPos = +b.pPos.toFixed(2); }
  const recent = done.filter((t) => now - Date.parse(t.closedAt || t.at) < recentDays * 864e5).map((t) => t.R); out.recentN = recent.length; out.recentR = recent.length ? r2(mean(recent)) : null;
  // without the single best trade: does the result depend on one moonshot?
  if (n >= 5) { const k = R.indexOf(Math.max(...R)); out.exBestR = r2(mean(R.filter((_, i) => i !== k))); }
  // cost stress: the same trades if every buy and sell had cost 0.5% more (1% round trip) than the paper fill
  { const st = done.filter((t) => t.risk0 > 0 && t.size > 0).map((t) => (t.pnl - 0.01 * t.size) / t.risk0); out.stressR = st.length ? r2(mean(st)) : null; }
  // how long until 30 closed trades at the pace so far
  { const ts = done.map((t) => Date.parse(t.closedAt || t.at)).filter((x) => isFinite(x)); if (n && n < minN && ts.length) { const first = Math.min(...done.map((t) => Date.parse(t.at)).filter((x) => isFinite(x))), days = Math.max(1, (now - first) / 864e5), rate = n / days; out.etaDays = rate > 0 ? Math.ceil((minN - n) / rate) : null; } }
  out.verdict = n < 10 ? 'collecting' : n < minN ? (b && b.lo > 0 ? 'promising' : b && b.hi < 0 ? 'losing' : 'unclear') : (b.lo > 0 && out.exBestR > 0 && (out.stressR == null || out.stressR > 0) ? 'edge' : b.hi < 0 ? 'no edge' : 'not proven');
  out.label = { collecting: `collecting ${n}/${minN}`, promising: `promising ${n}/${minN}`, losing: `losing ${n}/${minN}`, unclear: `unclear ${n}/${minN}`, edge: 'edge candidate', 'no edge': 'no edge', 'not proven': 'not proven' }[out.verdict];
  // market at entry: SOL trend and on-chain volume
  const split = (key) => { const g = new Map(); for (const t of done) { const v = t.mkt && t.mkt[key]; if (!v) continue; if (!g.has(v)) g.set(v, []); g.get(v).push(t.R); } return [...g].filter(([, a]) => a.length >= 5).map(([k, a]) => ({ k, n: a.length, avgR: r2(mean(a)) })).sort((x, y) => y.avgR - x.avgR); };
  out.bySol = split('sol'); out.byVol = split('vol');
  // exit tuning from the excursions: how far winners dipped before working, how far losers ran before failing
  const W = done.filter((t) => t.R > 0), Lz = done.filter((t) => t.R <= 0), pk = (a, f) => a.map(f).filter((x) => x != null && isFinite(x));
  out.exits = { wDip: r2(med(pk(W, (t) => t.maePct))), lPeak: r2(med(pk(Lz, (t) => t.mfePct))), lRan10: Lz.length ? +(pk(Lz, (t) => t.mfePct).filter((x) => x >= 10).length / Lz.length).toFixed(2) : null, wN: W.length, lN: Lz.length };
  return out;
}
// one plain-English line about the exits, or null when there is too little data
export function exitHint(ev) {
  const e = ev && ev.exits; if (!e || ev.n < 10) return null; const bits = [];
  if (e.lPeak != null && e.lN >= 5) bits.push(`losing trades were up a median ${e.lPeak.toFixed(0)}% at their best${e.lRan10 != null ? ` (${Math.round(e.lRan10 * 100)}% of them ran 10%+ first)` : ''}${e.lRan10 >= 0.4 ? ', so an earlier first sale would have saved many of them' : ''}`);
  if (e.wDip != null && e.wN >= 5) bits.push(`winners dipped a median ${e.wDip.toFixed(0)}% before working, so a stop tighter than that would have cut them`);
  return bits.length ? bits.join('; ') + '.' : null;
}
