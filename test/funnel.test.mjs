import { funnel, oneAway } from '../src/funnel.mjs';
import * as C from '../docs/core.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const G = (o) => ({ divergence: true, rsiFlip: true, volume: true, buyers: true, zone: true, structure: true, safe: true, ...o });
const rev = (sym, opp, gates, extra = {}) => { const g = G(gates); const n = Object.values(g).filter(Boolean).length; return { sym, chain: 'solana', opp, lead: 'reversal', gates: g, gatesPassed: n, ready: n === 7, signal: 'Watch', setupType: 'Bottom reversal', sp: { entryLow: 1, entryHigh: 1.1, stop: 0.9 }, ...extra }; };
const brk = (sym, opp, pg) => { const g = { shape: true, brk: true, volume: true, buyers: true, room: true, safe: true, reward: true, ...pg }, n = Object.values(g).filter(Boolean).length; return { sym, chain: 'solana', opp, lead: 'pattern', pat: { pg: g, passed: n, ready: n === 7 }, signal: 'Watch', setupType: 'Falling wedge', sp: { entryLow: 1, entryHigh: 1.1, stop: 0.9 } }; };
const pools = [rev('A', 80, { volume: false, zone: false }), rev('B', 75, { volume: false }), rev('C', 60, { zone: false }), rev('D', 30, { volume: false }), brk('E', 73, { brk: false }), rev('F', 90, {}), null];
const f = funnel(pools, { minVolume: 1e5, minLiquidity: 1e5, maxPools: 200 });
ok(f.inPlay === 5 && f.reversal.coins === 4 && f.breakout.coins === 1, 'funnel: counts coins worth a look (opp 50+) and ignores junk rows');
ok(f.reversal.gates[0].gate === 'volume' && f.reversal.gates[0].fail === 2 && f.breakout.gates[0].gate === 'brk', 'funnel: ranks the gate that blocks the most coins');
ok(f.ready === 1 && f.oneAway === 3, 'funnel: one bid-ready, three one gate away: ' + f.ready + '/' + f.oneAway);
ok(f.floors.minVolume === 1e5 && funnel(null).inPlay === 0, 'funnel: floors recorded, junk input safe');
const o = oneAway(pools, { minOpp: 70, max: 3 });
ok(o.map((x) => x.p.sym).join() === 'B,E' && o[0].gate === 'volume' && o[1].gate === 'brk', 'one gate away: best opportunity first, names the missing gate: ' + o.map((x) => x.p.sym + ':' + x.gate));
ok(oneAway([rev('Z', 99, { volume: false }, { signal: 'Entry signal' })]).length === 0 && oneAway([rev('Y', 60, { volume: false })], { minOpp: 70 }).length === 0, 'one gate away: skips bid-ready and low-opportunity coins');
// zone-as-order lives in core.mjs: RULES flag exists and defaults on
ok(C.RULES.zoneAsOrder === true && C.RULES.neverOff === true, 'rules: zone-as-order is on, nothing is switched off');
// zone-as-order inside the real scoring: six quality gates pass, price is just above the zone -> bid-ready as a resting-limit call
{ const mkp = (price) => ({ sym: 'Z', chain: 'solana', liq: 500000, v24: 900000, fdv: 3e6, created: new Date(Date.now() - 20 * 864e5).toISOString(), s24: 100, b24: 140, buyers24: 90, sellers24: 60, b1: 20, s1: 10, v1: 60000, price, lastClose: price, ch7d: 5,
    bs1: 2, plan: { valid: true, entryLow: 0.95, entryHigh: 1, entryMid: 0.975, stop: 0.88, tp1: 1.2, tp2: 1.35, tp3: 1.6, rr1: 1.5, rr2: 2.6, rr3: 4, upside3: 0.6, why: '' }, pats: [],
    tf: { '1h': { score: 70, state: 'Flipping up', rsi: 52, rsiPrev: 45, lastGreen: true, rvol: 2, upDown: 1.5, div: true, divFresh: true }, '4h': { score: 70, state: 'Setting up', rsi: 48, rsiPrev: 44, rvol: 1.6, upDown: 1.4, div: true, divFresh: true, higherLow: true, offLow: 20 }, '1d': null }, checks: {} });
  const near = mkp(1.04), far = mkp(1.30), inz = mkp(0.99);
  C.scoreList([near, far, inz], Date.now());
  ok(inz.ready && !inz.zoneOrder, 'zone-as-order: price inside the zone is bid-ready the normal way (gates ' + inz.gatesPassed + ')');
  ok(near.gatesPassed === 6 && near.ready && near.zoneOrder, 'zone-as-order: 4% above the zone is bid-ready as a resting-limit call (gates ' + near.gatesPassed + ', ready ' + near.ready + ')');
  ok(far.ready === false && !far.zoneOrder, 'zone-as-order: 30% above the zone is not bid-ready');
  C.RULES.zoneAsOrder = false; const off = mkp(1.04); C.scoreList([off], Date.now()); C.RULES.zoneAsOrder = true; ok(off.ready === false, 'zone-as-order: switch it off and the old seven-gate rule returns'); }
