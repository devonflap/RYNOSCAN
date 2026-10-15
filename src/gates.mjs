// Gate report. Two questions per gate:
//  1. Does it earn its place? Compare trades that passed every gate with trades that missed ONLY this gate (a clean comparison: nothing else differs).
//     If those early trades do as well as the fully confirmed ones, the gate is just making you late. If they do clearly worse, keep it.
//  2. Is it a bottleneck? From the scan history: how many coins fail this gate, and how many are blocked by it and nothing else.
// A gate is only called "keep" or "relax" with enough trades (8+ on each side) and a permutation test; otherwise the answer is "unclear".
// Reports only: nothing here changes a rule.
import { REV, BRK } from './funnel.mjs';
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const r2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(2));
const sgn = (x) => (x > 0 ? '+' : '') + r2(x) + 'R';
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// how often does a random split of the same sizes give a difference at least this large (in either direction)?
function permDiff(all, nA, obs, iters = 600) { const rnd = rng(all.length * 13 + nA), a = all.slice(); let hit = 0; for (let t = 0; t < iters; t++) { let sa = 0; for (let i = 0; i < nA; i++) { const j = i + Math.floor(rnd() * (a.length - i)); const x = a[i]; a[i] = a[j]; a[j] = x; sa += a[i]; } const d = sa / nA - (a.reduce((x, y) => x + y, 0) - sa) / (a.length - nA); if (Math.abs(d) >= Math.abs(obs) - 1e-12) hit++; } return (hit + 1) / (iters + 1); }
const REVERSAL = ['Bottom reversal', 'Double bottom', 'Inverse H&S', 'Falling wedge', 'Liquidity sweep reclaim'];
const famOf = (st) => (REVERSAL.includes(st) ? 'reversal' : 'breakout');

// trades: tracked trades (resultR set, miss recorded). hist: funnel history records from src/funnel.mjs compact().
export function gateReport(trades, hist = [], now = new Date()) {
  const out = { at: now.toISOString().slice(0, 19) + 'Z', scans: Array.isArray(hist) ? hist.length : 0, reversal: [], breakout: [], summary: [], notes: [] };
  const T = (Array.isArray(trades) ? trades : []).filter((s) => s && s.resultR != null && isFinite(+s.resultR) && s.status !== 'expired (no fill)' && s.miss != null && s.setup);
  // history -> per-gate bottleneck numbers
  const bott = (key, labels) => { const h = (hist || []).filter((x) => x && x[key]); const n = h.length; const res = {};
    for (const g of Object.keys(labels)) { let coins = 0, fail = 0, sole = 0; for (const x of h) { const c = key === 'r' ? x.rn : x.bn; coins += c; const v = x[key][g]; if (v) { fail += v[0]; sole += v[1]; } } res[g] = { failPct: coins ? Math.round(fail / coins * 100) : null, solePerScan: n ? +(sole / n).toFixed(1) : null }; }
    return res; };
  const bR = bott('r', REV), bB = bott('b', BRK);
  for (const [fam, labels, bt] of [['reversal', REV, bR], ['breakout', BRK, bB]]) {
    const F = T.filter((s) => famOf(s.setup) === fam), full = F.filter((s) => s.miss === ''), fullR = full.map((s) => +s.resultR);
    for (const g of Object.keys(labels)) {
      const only = F.filter((s) => s.miss === g), onlyR = only.map((s) => +s.resultR), row = { gate: g, label: labels[g], fullN: full.length, fullAvgR: full.length ? r2(mean(fullR)) : null, onlyN: only.length, onlyAvgR: only.length ? r2(mean(onlyR)) : null, failPct: bt[g].failPct, solePerScan: bt[g].solePerScan, verdict: 'unclear', comment: '' };
      if (full.length >= 8 && only.length >= 8) { const d = mean(fullR) - mean(onlyR), p = permDiff([...fullR, ...onlyR], fullR.length, d); row.p = +p.toFixed(3);
        if (d >= 0.3 && p <= 0.1) { row.verdict = 'keep'; row.comment = `Earns its place: trades that missed only this gate averaged ${sgn(onlyR.length ? mean(onlyR) : 0)} against ${sgn(mean(fullR))} for fully confirmed ones.`; }
        else if (d <= -0.3 && p <= 0.1) { row.verdict = 'relax'; row.comment = `Costing you trades: ones that missed only this gate averaged ${sgn(mean(onlyR))}, better than the ${sgn(mean(fullR))} of fully confirmed ones.${row.solePerScan ? ` It is the only blocker for about ${row.solePerScan} coins per scan.` : ''} Consider treating it as a warning instead of a requirement.`; }
        else row.comment = `No clear difference yet (${sgn(mean(onlyR))} without it against ${sgn(mean(fullR))} with everything). Keep it for now.`; }
      else row.comment = `Not enough data to judge: needs 8 fully confirmed and 8 early trades that missed only this gate (has ${full.length} and ${only.length}).`;
      out[fam].push(row);
    }
    out[fam].sort((a, b) => (b.solePerScan || 0) - (a.solePerScan || 0) || (b.failPct || 0) - (a.failPct || 0));
  }
  // summary sentences for the weekly report
  const nm = (r) => `${r.label}`;
  for (const [fam, title] of [['reversal', 'Reversal setups'], ['breakout', 'Breakout setups']]) {
    const rows = out[fam]; const keep = rows.filter((r) => r.verdict === 'keep'), relax = rows.filter((r) => r.verdict === 'relax');
    const top = rows.filter((r) => r.failPct != null).sort((a, b) => (b.solePerScan || 0) - (a.solePerScan || 0) || b.failPct - a.failPct)[0];
    if (top && out.scans) out.summary.push(`${title}: the biggest bottleneck is ${nm(top)} (fails for ${top.failPct}% of coins${top.solePerScan ? `, sole blocker for about ${top.solePerScan} coins per scan` : ''}).`);
    if (keep.length) out.summary.push(`${title}: keep ${keep.map(nm).join(', ')}.`);
    if (relax.length) out.summary.push(`${title}: consider relaxing ${relax.map(nm).join(', ')}.`);
    if (!keep.length && !relax.length) out.summary.push(`${title}: not enough early-versus-confirmed trades yet to say which gates should be used.`);
  }
  if (!out.scans) out.notes.push('No scan history yet: bottleneck numbers appear after a few days of scans.');
  return out;
}
