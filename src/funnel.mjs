// Where do coins get stuck? For every scanned coin worth a look (opportunity 50+), count which gate fails. Also finds coins that are exactly
// one gate away from bid-ready, so you can set a limit order ahead of time. Pure functions; the scan stores the result and the dashboard draws it.
export const REV = { divergence: 'RSI divergence', rsiFlip: 'RSI flipping up', volume: 'volume', buyers: 'buyers leading', zone: 'price in the buy zone', structure: 'chart structure', safe: 'safety (liquidity, age, not extended)' };
export const BRK = { shape: 'pattern shape', brk: 'breakout trigger', volume: 'volume', buyers: 'buyers leading', room: 'room to run (RSI not stretched)', safe: 'safety (liquidity, age)', reward: 'reward vs risk' };
const MIN = 50;
export function funnel(pools, floors = {}) {
  const rev = Object.fromEntries(Object.keys(REV).map((k) => [k, 0])), brk = Object.fromEntries(Object.keys(BRK).map((k) => [k, 0])); let nr = 0, nb = 0, ready = 0, zoneOrder = 0, oneAway = 0, scanned = 0;
  for (const p of Array.isArray(pools) ? pools : []) {
    if (!p) continue; scanned++; if (p.opp == null || p.opp < MIN) continue;
    if (p.lead === 'pattern' && p.pat && p.pat.pg) { nb++; if (p.pat.ready) ready++; if (p.pat.passed === 6) oneAway++; for (const k of Object.keys(BRK)) if (!p.pat.pg[k]) brk[k]++; }
    else if (p.gates) { nr++; if (p.ready) ready++; if (p.zoneOrder) zoneOrder++; if (p.gatesPassed === 6 && !p.ready) oneAway++; for (const k of Object.keys(REV)) if (!p.gates[k]) rev[k]++; }
  }
  const list = (o, L) => Object.entries(o).map(([k, fail]) => ({ gate: k, label: L[k], fail })).sort((a, b) => b.fail - a.fail);
  return { scanned, inPlay: nr + nb, reversal: { coins: nr, gates: list(rev, REV) }, breakout: { coins: nb, gates: list(brk, BRK) }, ready, zoneOrder, oneAway, floors: { minVolume: floors.minVolume ?? null, minLiquidity: floors.minLiquidity ?? null, maxPools: floors.maxPools ?? null } };
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
