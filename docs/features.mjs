// The features the learning loop slices trades by. Shared by the weekly learning loop (src/learn.mjs) and the browser/scan panel, so a rule
// learned from past trades can be matched against a live coin the same way. A signal (or a dashboard row converted by rowToSig) goes in; a
// bucket label comes out, or null when the value is unknown (unknown never matches a rule).
const bucket = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; };
// reversal setups fade a fall and need confirmation; breakout/continuation setups ride a move that has already started
export const REVERSAL = ['Bottom reversal', 'Double bottom', 'Inverse H&S', 'Falling wedge', 'Liquidity sweep reclaim'];
export const familyOf = (setup) => (!setup ? null : REVERSAL.includes(setup) ? 'Reversal' : 'Breakout / continuation');
export const FEATS = [
  ['Stop distance', (s) => (s.riskPct == null ? null : bucket(+s.riskPct, [5, 10, 20], ['under 5%', '5-10%', '10-20%', 'over 20%']))],
  ['Opportunity score', (s) => (s.opp == null ? null : bucket(+s.opp, [50, 65, 75, 85], ['under 50', '50-65 (below cut-off)', '65-75', '75-85', '85+']))],
  ['Pattern family', (s) => familyOf(s.setup)],
  ['Gates passed (of 7)', (s) => (s.gp == null ? null : bucket(+s.gp, [5, 6, 7], ['4 or fewer', '5', '6', '7']))],
  ['Entry timing', (s) => (s.conf === 'confirmed' ? 'confirmed (every gate and a 4h close)' : s.conf === 'early' ? 'early (before confirmation)' : null)],
  ['Gate missed', (s) => (s.miss == null ? null : s.miss === '' ? 'none' : s.miss.includes(',') ? 'two or more' : s.miss)],
  ['Zone call', (s) => (s.zr === 'order' ? 'resting order (price above the zone)' : s.zr === 'zone' ? 'price inside the zone' : null)],
  ['Liquidity', (s) => (s.liq == null ? null : bucket(+s.liq, [150e3, 400e3, 1e6], ['under $150k', '$150k-400k', '$400k-1M', '$1M+']))],
  ['Token age', (s) => (s.age == null ? null : bucket(+s.age, [7, 30, 90], ['under 7 days', '7-30 days', '30-90 days', '90+ days']))],
  ['4h volume surge', (s) => (s.rvol == null ? null : bucket(+s.rvol, [1, 1.5, 2.5], ['below normal', '1-1.5x', '1.5-2.5x', '2.5x+']))],
  ['Buyers vs sellers (24h)', (s) => (s.bs == null ? null : bucket(+s.bs, [0.9, 1.1], ['sellers lead', 'balanced', 'buyers lead']))],
  ['Reward to risk (TP2)', (s) => (s.rr2 == null ? null : bucket(+s.rr2, [2, 3], ['under 2R', '2-3R', '3R+']))],
  ['Room to the real target', (s) => (s.room == null ? null : bucket(+s.room, [1, 2], ['under 1R', '1-2R', '2R+']))], // TP2 above is stretched to at least 2R; this is the honest distance to the prior high or measured move
  ['Pattern quality', (s) => (s.pq == null ? null : bucket(+s.pq, [70, 85], ['under 70', '70-85', '85+']))],
  ['Chain', (s) => s.chain || null],
  ['Panel verdict', (s) => s.verdict || null],
  ['Market regime', (s) => s.regime || null],
  ['Social links', (s) => (s.soc == null ? null : ({ none: 'no links on listing', some: 'some links (1-2)', full: 'full links (3+)' })[s.soc] || null)],
  ['Holder growth (3+ days)', (s) => (s.hsD7 == null ? null : bucket(+s.hsD7, [0, 5, 20], ['shrinking', 'flat (0-5%)', 'growing (5-20%)', 'surging (20%+)']))],
  ['Volume day', (s) => s.volDay || null],
  ['Hour of day (UTC)', (s) => (s.at ? bucket(new Date(s.at).getUTCHours(), [6, 12, 18], ['00-06', '06-12', '12-18', '18-24']) : null)],
];
// dashboard/scan row -> the same shape a logged signal has
export function rowToSig(r, now = new Date()) {
  if (!r || typeof r !== 'object') return {};
  const hi = +r.entryHigh, st = +r.stop, mid = +r.entryMid || hi;
  return { riskPct: r.riskPct != null && isFinite(+r.riskPct) ? +r.riskPct : isFinite(mid) && isFinite(st) && mid > 0 && st > 0 ? +(((mid - st) / mid) * 100).toFixed(1) : null, opp: r.opp ?? null, chain: r.chain || null, regime: r.regime || null,
    gp: (r.lead === 'pattern' ? r.patPassed : r.gatesPassed) ?? null, conf: r.signal === 'Entry signal' || r._ready ? 'confirmed' : r.signal ? 'early' : null, setup: r.setupType || r.patName || r.setup || null,
    liq: r.liquidity ?? null, age: r.ageDays ?? null, rvol: r.rvol4h ?? null, bs: r.buySell24h ?? null, rr2: r.rr2 ?? null, pq: r.patQ ?? null,
    soc: r.soc && r.soc.level ? r.soc.level : null, hsD7: r.hs && r.hs.growPct != null && r.hs.growDays >= 3 ? r.hs.growPct : null, volDay: r.volDay || null, at: now.toISOString() };
}
// filters: [{ feature, bucket, setup? }] from the learning loop. Returns the ones this coin matches.
export function matchFilters(r, filters, now) {
  if (!Array.isArray(filters) || !filters.length || !r) return [];
  const sig = rowToSig(r, now), setup = r.setupType || r.patName || r.setup || null, out = [];
  for (const f of filters.slice(0, 5)) {
    if (!f || typeof f !== 'object') continue;
    if (f.setup && f.setup !== setup) continue;
    const def = FEATS.find((x) => x[0] === f.feature); if (!def) continue;
    let b = null; try { b = def[1](sig); } catch { b = null; }
    if (b != null && b === f.bucket) out.push(f);
  }
  return out;
}
