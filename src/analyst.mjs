// One analyst per chart pattern. Each reads every tracked trade for its pattern (live, backtest, background and the near-misses that carried
// that pattern's name) and writes a dossier: its record, how it tends to lose, the conditions it does best and worst in, whether its own
// quality score means anything, its best exit, and a plain recommendation. Slices inside one pattern are small, so each is run through the
// same permutation test and multiple-testing correction as the portfolio-wide rules, and only called "reliable" when it passes. Everything
// else is labelled a hint. Read-only: dossiers never change a rule by themselves.
import { stat, verdict } from './learn.mjs';
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const r2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(2));
const sgn = (x) => (x > 0 ? '+' : '') + r2(x) + 'R';
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function perm(all, k, obs, side, iters = 500) { const rnd = rng(all.length * 17 + k), a = all.slice(); let hit = 0; for (let t = 0; t < iters; t++) { let sum = 0; for (let i = 0; i < k; i++) { const j = i + Math.floor(rnd() * (a.length - i)); const x = a[i]; a[i] = a[j]; a[j] = x; sum += a[i]; } const m = sum / k; if (side === 'low' ? m <= obs + 1e-12 : m >= obs - 1e-12) hit++; } return (hit + 1) / (iters + 1); }
function bh(ps) { const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), q = Array(m); let prev = 1; for (let r = m; r >= 1; r--) { const [p, i] = idx[r - 1]; prev = Math.min(prev, p * m / r); q[i] = prev; } return q; }
const MIN_SLICE = 6;

// trades: tracked trades for ONE pattern (resultR set). FEATS: [[label, fn]]. live: is the pattern live now?
export function dossier(setup, trades, FEATS, live = true) {
  const T = trades.filter((s) => s.resultR != null && isFinite(+s.resultR) && s.status !== 'expired (no fill)'), n = T.length, R = T.map((s) => +s.resultR), st = stat(R), v = verdict(st);
  const d = { setup, live, n, avgR: st.avgR, winRate: st.winRate, pf: st.pf, lo90: st.lo90, hi90: st.hi90, verdict: v, headline: '', loses: null, conditions: { best: [], avoid: [] }, quality: null, exit: null, recent: null, recommendation: '', sources: {} };
  for (const s of T) { const k = s.source || 'live'; d.sources[k] = (d.sources[k] || 0) + 1; }
  { const bt = T.filter((s) => String(s.source || '').startsWith('backtest')), tr = T.filter((s) => !String(s.source || '').startsWith('backtest')), a = stat(bt.map((s) => +s.resultR)), b = stat(tr.map((s) => +s.resultR));
    d.split = { backtest: { n: a.n, avgR: a.avgR }, tracked: { n: b.n, avgR: b.avgR } };
    d.split.comment = !a.n ? `All ${b.n} trades were tracked as they happened.` : !b.n ? `All ${a.n} trades are backtest replays: hindsight on coins that are still active today, which flatters patterns like breakouts. No live-tracked trades yet.`
      : `Backtest replays ${sgn(a.avgR)} over ${a.n}; tracked as it happened ${sgn(b.avgR)} over ${b.n}.${b.n >= 5 && a.avgR > 0 && b.avgR < a.avgR - 0.5 ? ' The live record is well below the replays so far: the replays flatter it (hindsight, and only coins still active today).' : ''}`; }
  if (n === 0) { d.headline = 'No closed trades yet.'; d.recommendation = 'Keep collecting. Nothing can be said until trades have finished.'; return d; }
  d.headline = `${n} closed trades, ${sgn(st.avgR)} average, ${Math.round(st.winRate * 100)}% win rate${st.pf != null ? `, profit factor ${st.pf}` : ''}. ${v === 'proven' ? 'Reliably positive.' : v === 'failing' ? 'Reliably negative.' : v === 'unproven' ? 'Too few trades to judge.' : st.avgR > 0 ? 'Positive but not yet reliable.' : 'Leaning negative but not yet reliable.'}`;

  // how it loses
  const L = T.filter((s) => +s.resultR <= 0), W = T.filter((s) => +s.resultR > 0);
  if (L.length >= 5) { const withM = L.filter((s) => s.mfeR != null), never = withM.filter((s) => +s.mfeR < 0.5), gave = withM.filter((s) => +s.mfeR >= 1);
    d.loses = { losses: L.length, avgLossR: r2(mean(L.map((s) => +s.resultR))), measured: withM.length, neverWorkedPct: withM.length >= 5 ? Math.round(never.length / withM.length * 100) : null, gaveBackPct: withM.length >= 5 ? Math.round(gave.length / withM.length * 100) : null };
    d.loses.comment = withM.length >= 5 ? (d.loses.gaveBackPct >= 35 ? `${d.loses.gaveBackPct}% of its losers were up 1R or more first, so profit is being given back: an earlier exit or a break-even stop is the first thing to test.` : d.loses.neverWorkedPct >= 60 ? `${d.loses.neverWorkedPct}% of its losers never got to +0.5R, so the entries are bad rather than the exits: tighten the entry conditions.` : 'Losers are a mix of entries that never worked and trades that ran then reversed.') : 'Not enough trades with excursion data yet to say how it loses.'; }

  // conditions it does best / worst in (within this pattern only)
  const tests = [];
  for (const [label, fn] of FEATS) {
    const keys = [...new Set(T.map(fn).filter((x) => x != null))];
    const known = T.filter((s) => fn(s) != null), Rk = known.map((s) => +s.resultR); // compare only with trades where this feature is known
    for (const k of keys) { const inB = known.filter((s) => fn(s) === k), rest = known.filter((s) => fn(s) !== k); if (inB.length < MIN_SLICE || rest.length < MIN_SLICE) continue;
      const m = mean(inB.map((s) => +s.resultR)); tests.push({ label, k, n: inB.length, m, rest: mean(rest.map((s) => +s.resultR)), pLow: perm(Rk, inB.length, m, 'low'), pHigh: perm(Rk, inB.length, m, 'high') }); }
  }
  const qLow = bh(tests.map((t) => t.pLow)), qHigh = bh(tests.map((t) => t.pHigh));
  tests.forEach((t, i) => { t.qLow = qLow[i]; t.qHigh = qHigh[i]; });
  const fmt = (t, good) => ({ text: `${t.label}: ${t.k}`, feat: t.label, bucket: t.k, side: good ? 'only' : 'skip', n: t.n, avgR: r2(t.m), restAvgR: r2(t.rest), reliable: (good ? t.qHigh : t.qLow) <= 0.25 && t.n >= 10 });
  d.conditions.best = tests.filter((t) => t.m > t.rest + 0.3 && t.m > 0).sort((a, b) => (b.m - b.rest) - (a.m - a.rest)).slice(0, 3).map((t) => fmt(t, true));
  d.conditions.avoid = tests.filter((t) => t.m < t.rest - 0.3 && t.m < 0).sort((a, b) => (a.m - a.rest) - (b.m - b.rest)).slice(0, 3).map((t) => fmt(t, false));

  // does this pattern's own quality score predict results?
  const q = T.filter((s) => s.pq != null);
  if (q.length >= 12) { const hi = q.filter((s) => +s.pq >= 80), lo = q.filter((s) => +s.pq < 80);
    if (hi.length >= 5 && lo.length >= 5) { const a = mean(hi.map((s) => +s.resultR)), b = mean(lo.map((s) => +s.resultR)); d.quality = { hi: { n: hi.length, avgR: r2(a) }, lo: { n: lo.length, avgR: r2(b) }, comment: a > b + 0.3 ? `Clean versions (quality 80+) do better (${sgn(a)} against ${sgn(b)}), so the quality score is useful: consider only taking the clean ones.` : a < b - 0.3 ? `Clean versions do worse (${sgn(a)} against ${sgn(b)}): the quality score is not helping for this pattern.` : 'Pattern quality makes no clear difference yet.' }; } }

  // best exit for this pattern
  const ex = T.filter((s) => s.mfeR != null);
  if (ex.length >= 15) { const actual = mean(ex.map((s) => +s.resultR)), rows = [0.5, 1, 1.5, 2, 3].map((x) => ({ target: x, avgR: r2(mean(ex.map((s) => (+s.mfeR >= x ? x : +s.resultR)))) })), best = rows.slice().sort((a, b) => b.avgR - a.avgR)[0];
    d.exit = { n: ex.length, actualAvgR: r2(actual), best, comment: best.avgR - actual >= 0.15 ? `Taking all profit at ${best.target}R would have averaged ${sgn(best.avgR)} against ${sgn(actual)} with the current exits (estimate before exit slippage).` : 'No fixed profit target clearly beats the current exits for this pattern.' }; }

  // recent form
  if (n >= 20) { const by = T.slice().sort((a, b) => String(a.at || a.signalAt || '').localeCompare(String(b.at || b.signalAt || ''))), last = mean(by.slice(-10).map((s) => +s.resultR)); d.recent = { last10: r2(last), comment: last < st.avgR - 0.5 ? 'Fading: the last 10 trades are well below its average.' : last > st.avgR + 0.5 ? 'Improving: the last 10 trades are well above its average.' : 'Steady.' }; }

  // recommendation
  const relBest = d.conditions.best.filter((c) => c.reliable), relAvoid = d.conditions.avoid.filter((c) => c.reliable);
  if (v === 'failing') d.recommendation = 'Reliably negative so far. It keeps running and alerting as you asked, but treat its calls with extra caution and size down.';
  else if (v === 'proven') d.recommendation = (live ? 'Keep on.' : 'Eligible to go live.') + (relAvoid.length ? ` Avoid: ${relAvoid.map((c) => c.text.toLowerCase()).join('; ')}.` : '') + (d.split.tracked.n >= 5 && d.split.tracked.avgR != null && d.split.tracked.avgR <= 0 ? ` But the ${d.split.tracked.n} trades tracked as they happened average ${sgn(d.split.tracked.avgR)}: the edge is not confirmed live yet, so trade it small or on paper.` : '');
  else if (v === 'unproven') d.recommendation = `Keep collecting: about ${Math.max(0, 12 - n)} more closed trades before a first verdict.`;
  else if (relBest.length && st.avgR <= 0) d.recommendation = `Weak overall, but reliably better when ${relBest.map((c) => c.text.toLowerCase()).join('; ')}. A narrower version of this pattern may be worth testing.`;
  else d.recommendation = st.avgR > 0 ? 'Promising but not proven: keep tracking, no change.' : 'Not working so far. If it stays negative at 12+ trades it is flagged as failing, but it keeps running.';
  return d;
}

// all patterns: pool = every tracked trade (near-misses already renamed to their real pattern), notLive = Set of pattern names not live
export function analysts(pool, FEATS, notLive = new Set()) {
  const by = new Map(); for (const s of pool) { const k = s.setup; if (!k || String(k).startsWith('Near-miss')) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  return [...by].map(([k, list]) => dossier(k, list, FEATS, !notLive.has(k))).sort((a, b) => b.n - a.n);
}
