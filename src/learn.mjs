// RynoScan learning loop. Takes every closed signal (the weekly backtest replay plus the live signal log), measures each setup
// and feature bucket honestly (sample size, average R, 90% confidence interval) and decides:
//   promote: a candidate pattern whose lower 90% bound is above zero with enough trades -> goes live
//   demote : a live setup whose upper 90% bound is below zero with enough trades -> switched off
// Everything else stays as it is. Small samples never change anything, which is the point: at 20 trades a streak is noise.
import { edge } from './edge.mjs';
import { analysts } from './analyst.mjs';
import { gateReport } from './gates.mjs';
import { FEATS } from '../docs/features.mjs';
import { pTwo, pDiff, bhQ, spearman } from '../docs/evidence.mjs';
import { SCORE_V2_FROM, scoreV2 } from '../docs/features.mjs';
export { pTwo, pDiff, bhQ };
export const MIN_DEMOTE = 12, MIN_PROMOTE = 20, Z90 = 1.645;

export function stat(R) {
  const n = R.length; if (!n) return { n: 0, avgR: null, winRate: null, pf: null, lo90: null, hi90: null };
  const mean = R.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(R.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0, se = n > 1 ? sd / Math.sqrt(n) : Infinity;
  const gain = R.filter(x => x > 0).reduce((a, b) => a + b, 0), loss = -R.filter(x => x <= 0).reduce((a, b) => a + b, 0);
  return { n, avgR: +mean.toFixed(2), winRate: +(R.filter(x => x > 0).length / n).toFixed(3), pf: loss > 0 ? +(gain / loss).toFixed(2) : gain > 0 ? 99 : null, lo90: isFinite(se) ? +(mean - Z90 * se).toFixed(2) : null, hi90: isFinite(se) ? +(mean + Z90 * se).toFixed(2) : null };
}
export function verdict(s) {
  if (s.n < MIN_DEMOTE) return 'unproven';
  if (s.hi90 != null && s.hi90 < 0) return 'failing';
  if (s.n >= MIN_PROMOTE && s.lo90 != null && s.lo90 > 0 && s.pf > 1.3) return 'proven';
  return s.avgR > 0 ? 'promising' : 'weak';
}
const bucket = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; };

// signals: [{setup, chain, at, resultR, riskPct, opp, status, source}], defaults: {off:[], shadow:[]} (what is not live by default)
export function learn(signals, defaults = { off: [], shadow: [] }, now = new Date(), extra = {}) {
  const earlyAll = signals.filter(s => s && s.early1h && s.resultR != null && s.status !== 'expired (no fill)' && isFinite(+s.resultR)); signals = signals.filter(s => !(s && s.early1h)); // early-1h trades are an experiment: compared in the gate report, never mixed into setup stats
  const closedAll = signals.filter(s => s.resultR != null && s.status !== 'expired (no fill)' && isFinite(+s.resultR)), closed = closedAll.filter(s => !String(s.setup || '').startsWith('Near-miss'));
  const by = (key, src = closed) => { const m = new Map(); for (const s of src) { const k = key(s); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(+s.resultR); } return m; };
  const notLive = new Set([...(defaults.off || []), ...(defaults.shadow || [])]);
  const setups = [...by(s => s.setup || 'Unknown', closedAll)].map(([name, R]) => { const st = stat(R), v = verdict(st), live = !notLive.has(name);
    return { setup: name, ...st, verdict: v, live, need: v === 'unproven' ? MIN_DEMOTE - st.n : st.n < MIN_PROMOTE && !live ? MIN_PROMOTE - st.n : 0 }; }).sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9));
  const NM = (n) => String(n).startsWith('Near-miss'); // near-miss rows are evidence about the cut-off, never switched on or off
  const promote = setups.filter(s => !s.live && !NM(s.setup) && s.verdict === 'proven').map(s => s.setup);
  const demote = setups.filter(s => s.live && !NM(s.setup) && s.verdict === 'failing').map(s => s.setup);
  const feat = [];
  const add = (label, map) => { const allR = [...map.values()]; for (const [k, R] of map) { const st = stat(R), rest = allR.filter((x) => x !== R).flat(); if (st.n >= 8) feat.push({ feature: label, bucket: k, ...st, p: +pTwo(R).toFixed(4), restN: rest.length, restAvgR: rest.length ? +(rest.reduce((a, b) => a + b, 0) / rest.length).toFixed(2) : null, diff: rest.length ? +(st.avgR - rest.reduce((a, b) => a + b, 0) / rest.length).toFixed(2) : null, pd: +pDiff(R, rest).toFixed(4) }); } };
  for (const [label, fn] of FEATS) add(label, by(fn));
  const insights = [];
  // luck check: each slice is compared with the REST of the trades, and the q-value corrects for how many slices were tested
  { const q = bhQ(feat.map((f) => (f.restN >= 8 ? f.pd : 1))); feat.forEach((f, i) => { f.q = +q[i].toFixed(3); f.reliable = f.restN >= 8 && f.q <= 0.1 && Math.abs(f.diff) >= 0.3; }); }
  { const allR = closed.map((s) => +s.resultR), base = allR.length ? allR.reduce((a, b) => a + b, 0) / allR.length : null, negAll = feat.filter((f) => f.hi90 != null && f.hi90 < 0).length;
    if (base != null && base < 0 && negAll >= 3) insights.push(`Most slices look negative because the trades as a whole average ${base.toFixed(2)}R. The lines below compare each slice with the rest of the trades, which is what shows where it is worse or better.`); }
  for (const f of feat.filter((f) => f.reliable).sort((a, b) => a.q - b.q)) insights.push(`${f.feature} ${f.bucket}: ${f.avgR}R over ${f.n} trades against ${f.restAvgR}R for the rest (${f.diff > 0 ? 'better' : 'worse'} by ${Math.abs(f.diff)}R; passes the luck check across ${feat.length} slices).`);
  for (const f of feat.filter((f) => !f.reliable && f.restN >= 8 && f.pd <= 0.05 && Math.abs(f.diff) >= 0.3)) insights.push(`${f.feature} ${f.bucket}: ${f.avgR}R against ${f.restAvgR}R for the rest, but with ${feat.length} slices tested this could be luck.`);
  // does the score rank the results? (rank correlation; the shadow score v2 is judged only on trades from SCORE_V2_FROM on)
  const calibration = (() => { const corr = (rows, f) => { const g = rows.filter((s) => f(s) != null && isFinite(+f(s))); return { n: g.length, rho: spearman(g.map((s) => +f(s)), g.map((s) => +s.resultR)) }; };
    const after = closed.filter((s) => String(s.signalAt || s.at || '') >= SCORE_V2_FROM), v2 = (s) => s.opp2 ?? scoreV2(s);
    return { since: SCORE_V2_FROM, opp: corr(closed, (s) => s.opp), parts: { 'pattern quality': corr(closed, (s) => s.pq), 'gates passed': corr(closed, (s) => s.gp), '4h volume surge': corr(closed, (s) => s.rvol), 'reward to risk': corr(closed, (s) => s.rr2), 'room to target': corr(closed, (s) => s.room) },
      oppNew: corr(after, (s) => s.opp), v2New: corr(after, v2) }; })();
  if (calibration.opp.rho != null && calibration.opp.n >= 30) insights.unshift(`Score check: the opportunity score ${Math.abs(calibration.opp.rho) < 0.15 ? 'barely ranks' : calibration.opp.rho > 0 ? 'ranks' : 'ranks BACKWARDS'} the results (rank correlation ${calibration.opp.rho} over ${calibration.opp.n} trades).${calibration.v2New.n >= 20 ? ` On trades since ${SCORE_V2_FROM.slice(0, 10)}: current score ${calibration.oppNew.rho}, shadow score v2 ${calibration.v2New.rho} (${calibration.v2New.n} trades).` : ` The shadow score v2 is being judged on new trades from ${SCORE_V2_FROM.slice(0, 10)} (${calibration.v2New.n} so far, needs 20).`}`);
  const all = stat(closed.map(s => +s.resultR));
  const pool = closedAll.map(s => NM(s.setup) ? { ...s, setup: s.setupBase || String(s.setup).replace(/^Near-miss: /, ''), tier: 'near-miss' } : s), edgeReport = edge(closed, FEATS, setups, all, pool);
  return { at: now.toISOString().slice(0, 19) + 'Z', total: all, calibration, setups, promote, demote, features: feat, insights, edge: edgeReport, filters: edgeReport.filters || [], analysts: analysts(pool, FEATS, notLive), gates: gateReport(pool, extra.funnelHistory || [], now, earlyAll),
    best: closed.slice().sort((a, b) => b.resultR - a.resultR).slice(0, 5).map(s => ({ coin: s.coin, setup: s.setup, resultR: s.resultR, at: s.at || s.signalAt })),
    rules: { minDemote: MIN_DEMOTE, minPromote: MIN_PROMOTE, confidence: '90%' },
    notes: ['Learned from the replay of recent hourly candles plus the live signal log. The replay covers a couple of weeks of one market regime, so treat even a "proven" setup as provisional.', 'A pattern is only promoted or flagged as failing when the 90% confidence interval clears zero with at least ' + MIN_PROMOTE + ' (promote) or ' + MIN_DEMOTE + ' (flag) closed trades. Flagged patterns keep running and alerting: nothing is switched off automatically.'] };
}
