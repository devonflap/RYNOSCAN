// Evidence: is a paper book showing a real edge, or just luck so far? Shared by the dashboard and the weekly report.
// Every closed trade is measured in R: profit or loss divided by what it would have lost at its first stop. That puts a 4% scalp
// and a 25% degen stop on the same scale. The average R per trade (expectancy) gets a 90% range by resampling the trades
// (bootstrap), so a few lucky winners cannot pass for an edge.
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export function bootstrap(xs, iters = 4000, seed = 7, tail = 0.05) {
  const n = xs.length; if (n < 2) return null; const r = rng(seed + n * 31), ms = new Float64Array(iters);
  for (let k = 0; k < iters; k++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(r() * n)]; ms[k] = s / n; }
  const a = Array.from(ms).sort((x, y) => x - y); return { lo: a[Math.floor(iters * 0.05)], hi: a[Math.floor(iters * 0.95)], loAdj: a[Math.max(0, Math.floor(iters * tail))], pPos: a.filter((m) => m > 0).length / iters };
}
const r2 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(2));
// p: a book() result. Returns the verdict and the numbers behind it.
// tests: how many books are being compared at once. The edge verdict uses a stricter low end (5% / tests, a Bonferroni-style luck correction),
// so the best of 15 books is not called an edge just for being the luckiest.
export function evidence(p, { now = Date.now(), recentDays = 14, minN = 30, tests = 1 } = {}) {
  const done = (p && p.trades ? p.trades : []).filter((t) => !t.open && t.R != null && isFinite(t.R)), R = done.map((t) => t.R), n = R.length;
  const out = { n, open: p ? p.openN : 0, avgR: n ? r2(mean(R)) : null, medR: n ? r2(med(R)) : null, win: n ? +(R.filter((x) => x > 0).length / n).toFixed(2) : null };
  const b = n >= 5 ? bootstrap(R, 4000, 7, 0.05 / Math.max(1, tests)) : null; if (b) { out.lo = r2(b.lo); out.hi = r2(b.hi); out.loAdj = r2(b.loAdj); out.pPos = +b.pPos.toFixed(2); } out.tests = tests; if (n >= 2) { const m = mean(R); out.sd = r2(Math.sqrt(R.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1))); }
  // consistency: the first and second half of the closed trades (in time order) should both be positive for a real edge
  { const byT = done.slice().sort((x, y) => Date.parse(x.closedAt || x.at) - Date.parse(y.closedAt || y.at)).map((t) => t.R), h = Math.floor(byT.length / 2); if (byT.length >= 10) { out.half1 = r2(mean(byT.slice(0, h))); out.half2 = r2(mean(byT.slice(h))); } }
  const recent = done.filter((t) => now - Date.parse(t.closedAt || t.at) < recentDays * 864e5).map((t) => t.R); out.recentN = recent.length; out.recentR = recent.length ? r2(mean(recent)) : null;
  // without the single best trade: does the result depend on one moonshot?
  if (n >= 5) { const k = R.indexOf(Math.max(...R)); out.exBestR = r2(mean(R.filter((_, i) => i !== k))); }
  // cost stress: the same trades if every buy and sell had cost 0.5% more (1% round trip) than the paper fill
  { const st = done.filter((t) => t.risk0 > 0 && t.size > 0).map((t) => (t.pnl - 0.01 * t.size) / t.risk0); out.stressR = st.length ? r2(mean(st)) : null; }
  // stop-fill stress: DEXes have no resting stop orders, so a bot sells after it sees the stop hit. Every stop, trail, break-even and cut
  // sale filled 5% lower than the paper price.
  { const SW = new Set(['stop', 'trail', 'breakeven', 'cut', 'sellers']), st = done.filter((t) => t.risk0 > 0 && t.qty > 0).map((t) => (t.pnl - (t.fills || []).filter((f) => SW.has(f.why)).reduce((a, f) => a + t.qty * f.frac * f.px * 0.05, 0)) / t.risk0); out.slipR = st.length ? r2(mean(st)) : null; }
  // how long until 30 closed trades at the pace so far
  { const ts = done.map((t) => Date.parse(t.closedAt || t.at)).filter((x) => isFinite(x)); if (n && n < minN && ts.length) { const first = Math.min(...done.map((t) => Date.parse(t.at)).filter((x) => isFinite(x))), days = Math.max(1, (now - first) / 864e5), rate = n / days; out.etaDays = rate > 0 ? Math.ceil((minN - n) / rate) : null; } }
  out.verdict = n < 10 ? 'collecting' : n < minN ? (b && b.lo > 0 ? 'promising' : b && b.hi < 0 ? 'losing' : 'unclear') : (b.loAdj > 0 && out.exBestR > 0 && out.half1 > 0 && out.half2 > 0 && (out.stressR == null || out.stressR > 0) ? 'edge' : b.hi < 0 ? 'no edge' : 'not proven');
  out.label = { collecting: `collecting ${n}/${minN}`, promising: `promising ${n}/${minN}`, losing: `losing ${n}/${minN}`, unclear: `unclear ${n}/${minN}`, edge: 'edge candidate', 'no edge': 'no edge', 'not proven': 'not proven' }[out.verdict];
  // market at entry: SOL trend and on-chain volume
  const split = (key) => { const g = new Map(); for (const t of done) { const v = t.mkt && t.mkt[key]; if (!v) continue; if (!g.has(v)) g.set(v, []); g.get(v).push(t.R); } return [...g].filter(([, a]) => a.length >= 5).map(([k, a]) => ({ k, n: a.length, avgR: r2(mean(a)) })).sort((x, y) => y.avgR - x.avgR); };
  out.bySol = split('sol'); out.byVol = split('vol');
  // exit tuning from the excursions: how far winners dipped before working, how far losers ran before failing
  const W = done.filter((t) => t.R > 0), Lz = done.filter((t) => t.R <= 0), pk = (a, f) => a.map(f).filter((x) => x != null && isFinite(x));
  out.exits = { wDip: r2(med(pk(W, (t) => t.maePct))), lPeak: r2(med(pk(Lz, (t) => t.mfePct))), lRan10: Lz.length ? +(pk(Lz, (t) => t.mfePct).filter((x) => x >= 10).length / Lz.length).toFixed(2) : null, wN: W.length, lN: Lz.length };
  return out;
}
// luck check for many slices at once: two-sided p from the t-statistic (normal approximation), then Benjamini-Hochberg q-values.
// With ~100 feature slices tested, about 10 would clear a plain 90% range by chance; a slice is only called reliable when q <= 0.1.
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
export const pTwo = (R) => { const n = R.length; if (n < 3) return 1; const m = R.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(R.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); if (!(sd > 0)) return m === 0 ? 1 : 0; const z = Math.abs(m / (sd / Math.sqrt(n))); return Math.max(0, Math.min(1, 1 - erf(z / Math.SQRT2))); };
// slice against the rest (Welch, normal approximation). When the whole system loses, every slice looks "reliably negative" against zero;
// what matters is whether a slice is worse or better than the other trades.
export const pDiff = (A, B) => { const n = A.length, m = B.length; if (n < 3 || m < 3) return 1; const ma = A.reduce((x, y) => x + y, 0) / n, mb = B.reduce((x, y) => x + y, 0) / m, va = A.reduce((x, y) => x + (y - ma) ** 2, 0) / (n - 1), vb = B.reduce((x, y) => x + (y - mb) ** 2, 0) / (m - 1), se = Math.sqrt(va / n + vb / m); if (!(se > 0)) return ma === mb ? 1 : 0; return Math.max(0, Math.min(1, 1 - erf(Math.abs(ma - mb) / se / Math.SQRT2))); };
export function bhQ(ps) { const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), q = new Array(m); let run = 1; for (let k = m - 1; k >= 0; k--) { run = Math.min(run, idx[k][0] * m / (k + 1)); q[idx[k][1]] = run; } return q; }
// rank correlation (Spearman): +1 when a higher score always meant a better result, 0 when the score does not rank results at all
export function spearman(xs, ys) {
  const n = Math.min(xs.length, ys.length); if (n < 5) return null; const rk = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rk(xs.slice(0, n)), b = rk(ys.slice(0, n)), ma = mean(a), mb = mean(b); let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? +(num / Math.sqrt(da * db)).toFixed(3) : null;
}
// one plain-English line about the exits, or null when there is too little data
export function exitHint(ev) {
  const e = ev && ev.exits; if (!e || ev.n < 10) return null; const bits = [];
  if (e.lPeak != null && e.lN >= 5) bits.push(`losing trades were up a median ${e.lPeak.toFixed(0)}% at their best${e.lRan10 != null ? ` (${Math.round(e.lRan10 * 100)}% of them ran 10%+ first)` : ''}${e.lRan10 >= 0.4 ? ', so an earlier first sale would have saved many of them' : ''}`);
  if (e.wDip != null && e.wN >= 5) bits.push(`winners dipped a median ${e.wDip.toFixed(0)}% before working, so a stop tighter than that would have cut them`);
  return bits.length ? bits.join('; ') + '.' : null;
}
