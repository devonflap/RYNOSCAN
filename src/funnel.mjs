// Where do coins get stuck? For every scanned coin worth a look (opportunity 50+), count which gate fails. Also finds coins that are exactly
// one gate away from bid-ready, so you can set a limit order ahead of time. Pure functions; the scan stores the result and the dashboard draws it.
export const REV = { divergence: 'RSI divergence', rsiFlip: 'RSI flipping up', volume: 'volume', buyers: 'buyers leading', zone: 'price in the buy zone', structure: 'chart structure', safe: 'safety (liquidity, age, not extended)' };
export const BRK = { shape: 'pattern shape', brk: 'breakout trigger', volume: 'volume', buyers: 'buyers leading', room: 'room to run (RSI not stretched)', safe: 'safety (liquidity, age)', reward: 'reward vs risk' };
const MIN = 50;
export function funnel(pools, floors = {}) {
  const rev = Object.fromEntries(Object.keys(REV).map((k) => [k, 0])), brk = Object.fromEntries(Object.keys(BRK).map((k) => [k, 0])); let nr = 0, nb = 0, ready = 0, zoneOrder = 0, oneAway = 0, scanned = 0; const soleR = Object.fromEntries(Object.keys(REV).map((k) => [k, 0])), soleB = Object.fromEntries(Object.keys(BRK).map((k) => [k, 0]));
  for (const p of Array.isArray(pools) ? pools : []) {
    if (!p) continue; scanned++; if (p.opp == null || p.opp < MIN) continue;
    if (p.lead === 'pattern' && p.pat && p.pat.pg) { nb++; if (p.pat.ready) ready++; const m = Object.keys(BRK).filter((k) => !p.pat.pg[k]); if (p.pat.passed === 6) oneAway++; if (m.length === 1 && !p.pat.ready) soleB[m[0]]++; m.forEach((k) => brk[k]++); }
    else if (p.gates) { nr++; if (p.ready) ready++; if (p.zoneOrder) zoneOrder++; const m = Object.keys(REV).filter((k) => !p.gates[k]); if (p.gatesPassed === 6 && !p.ready) oneAway++; if (m.length === 1 && !p.ready) soleR[m[0]]++; m.forEach((k) => rev[k]++); }
  }
  const list = (o, L, so) => Object.entries(o).map(([k, fail]) => ({ gate: k, label: L[k], fail, sole: so[k] })).sort((a, b) => b.fail - a.fail);
  return { scanned, inPlay: nr + nb, reversal: { coins: nr, gates: list(rev, REV, soleR) }, breakout: { coins: nb, gates: list(brk, BRK, soleB) }, ready, zoneOrder, oneAway, floors: { minVolume: floors.minVolume ?? null, minLiquidity: floors.minLiquidity ?? null, maxPools: floors.maxPools ?? null } };
}
// coins exactly one gate from bid-ready (not already bid-ready), best opportunity first
export function oneAway(pools, { minOpp = 70, max = 3 } = {}) {
  const out = [];
  for (const p of Array.isArray(pools) ? pools : []) {
    if (!p || p.opp == null || p.opp < minOpp || p.signal === 'Entry signal') continue;
    if (p.lead === 'pattern' && p.pat && p.pat.pg) { if (p.pat.ready || p.pat.passed !== 6) continue; const k = Object.keys(BRK).find((x) => !p.pat.pg[x]); out.push({ p, gate: k, label: BRK[k], kind: 'breakout' }); }
    else if (p.gates) { if (p.ready || p.gatesPassed !== 6) continue; const k = Object.keys(REV).find((x) => !p.gates[x]); out.push({ p, gate: k, label: REV[k], kind: 'reversal' }); }
  }
  return out.sort((a, b) => b.p.opp - a.p.opp).slice(0, max);
}
// compact one-line record of a scan's funnel for the weekly gate report (kept for 14 days)
export function compact(f, at) {
  if (!f || !f.reversal) return null;
  const pick = (g) => Object.fromEntries(g.gates.map((x) => [x.gate, [x.fail, x.sole || 0]]));
  return { t: at, rn: f.reversal.coins, bn: f.breakout.coins, ready: f.ready, one: f.oneAway, r: pick(f.reversal), b: pick(f.breakout) };
}
export function appendHistory(hist, rec, now = Date.now(), keepDays = 14) {
  const out = (Array.isArray(hist) ? hist : []).filter((x) => x && x.t && now - Date.parse(x.t) <= keepDays * 86400e3);
  if (rec) out.push(rec); return out;
}
