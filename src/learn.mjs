// RynoScan learning loop. Takes every closed signal (the weekly backtest replay plus the live signal log), measures each setup
// and feature bucket honestly (sample size, average R, 90% confidence interval) and decides:
//   promote: a candidate pattern whose lower 90% bound is above zero with enough trades -> goes live
//   demote : a live setup whose upper 90% bound is below zero with enough trades -> switched off
// Everything else stays as it is. Small samples never change anything, which is the point: at 20 trades a streak is noise.
import { edge } from './edge.mjs';
import { analysts } from './analyst.mjs';
import { gateReport } from './gates.mjs';
import { FEATS } from '../docs/features.mjs';
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
  const closedAll = signals.filter(s => s.resultR != null && s.status !== 'expired (no fill)' && isFinite(+s.resultR)), closed = closedAll.filter(s => !String(s.setup || '').startsWith('Near-miss'));
  const by = (key, src = closed) => { const m = new Map(); for (const s of src) { const k = key(s); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(+s.resultR); } return m; };
  const notLive = new Set([...(defaults.off || []), ...(defaults.shadow || [])]);
  const setups = [...by(s => s.setup || 'Unknown', closedAll)].map(([name, R]) => { const st = stat(R), v = verdict(st), live = !notLive.has(name);
    return { setup: name, ...st, verdict: v, live, need: v === 'unproven' ? MIN_DEMOTE - st.n : st.n < MIN_PROMOTE && !live ? MIN_PROMOTE - st.n : 0 }; }).sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9));
  const NM = (n) => String(n).startsWith('Near-miss'); // near-miss rows are evidence about the cut-off, never switched on or off
  const promote = setups.filter(s => !s.live && !NM(s.setup) && s.verdict === 'proven').map(s => s.setup);
  const demote = setups.filter(s => s.live && !NM(s.setup) && s.verdict === 'failing').map(s => s.setup);
  const feat = [];
  const add = (label, map) => { for (const [k, R] of map) { const st = stat(R); if (st.n >= 8) feat.push({ feature: label, bucket: k, ...st }); } };
  for (const [label, fn] of FEATS) add(label, by(fn));
  const insights = [];
  for (const f of feat) { if (f.hi90 != null && f.hi90 < 0) insights.push(`${f.feature} ${f.bucket}: ${f.avgR}R average over ${f.n} trades is reliably negative.`); else if (f.lo90 != null && f.lo90 > 0) insights.push(`${f.feature} ${f.bucket}: ${f.avgR}R average over ${f.n} trades is reliably positive.`); }
  const all = stat(closed.map(s => +s.resultR));
  const pool = closedAll.map(s => NM(s.setup) ? { ...s, setup: s.setupBase || String(s.setup).replace(/^Near-miss: /, ''), tier: 'near-miss' } : s), edgeReport = edge(closed, FEATS, setups, all, pool);
  return { at: now.toISOString().slice(0, 19) + 'Z', total: all, setups, promote, demote, features: feat, insights, edge: edgeReport, filters: edgeReport.filters || [], analysts: analysts(pool, FEATS, notLive), gates: gateReport(pool, extra.funnelHistory || [], now),
    best: closed.slice().sort((a, b) => b.resultR - a.resultR).slice(0, 5).map(s => ({ coin: s.coin, setup: s.setup, resultR: s.resultR, at: s.at || s.signalAt })),
    rules: { minDemote: MIN_DEMOTE, minPromote: MIN_PROMOTE, confidence: '90%' },
    notes: ['Learned from the replay of recent hourly candles plus the live signal log. The replay covers a couple of weeks of one market regime, so treat even a "proven" setup as provisional.', 'A pattern is only promoted or flagged as failing when the 90% confidence interval clears zero with at least ' + MIN_PROMOTE + ' (promote) or ' + MIN_DEMOTE + ' (flag) closed trades. Flagged patterns keep running and alerting: nothing is switched off automatically.'] };
}
