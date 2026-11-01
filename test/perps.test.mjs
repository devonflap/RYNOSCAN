// the perps planner (1 Nov): limit entries at real levels, stops past them, TPs at the next levels, and the leverage maths
import { planTrade, sizeTrade, ticket, outcomes, pnlAt, pivots, zones, atr, ema, PERP } from '../docs/perps.mjs';
import fs from 'node:fs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
// an uptrend that keeps turning at 10 and stalls at 12 and 13.5, now at 11
const D = []; let t = 0; const seq = []; for (let k = 0; k < 4; k++) seq.push(...[8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 11.5, 11, 10.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 13, 12.5, 12, 11.5, 11].map((x) => x + k * 0.02));
for (const c of seq) { D.push([t, c - 0.1, c + 0.15, c - 0.15, c, 1e6]); t += 86400; }
const tail = [10.2, 10.1, 10, 10.1, 10.4, 10.8, 11.1]; for (const c of tail) { D.push([t, c - 0.1, c + 0.15, c - 0.15, c, 1e6]); t += 86400; }
const p = planTrade({ daily: D, h4: [], price: 11.1 });
ok(!p.none && p.entry < 11.1 && p.entry > 9.5 && p.stop < p.entry && p.tps.length === 3 && p.tps[0].px > p.entry && p.tps[0].r >= 1 && p.tps[1].px > p.tps[0].px, `long: limit at support ${p.entry && p.entry.toFixed(2)} (below the 11.1 price), stop ${p.stop && p.stop.toFixed(2)}, TPs ${p.tps && p.tps.map((x) => x.px.toFixed(2) + ' (' + x.r + 'R)').join(', ')}`);
ok(['A', 'B', 'C'].includes(p.grade) && /support/.test(p.why[0]), 'graded, with the reasons: ' + p.verdict);
const s = sizeTrade(p, { margin: 100, lev: 5 });
ok(Math.abs(s.notional - 500) < 1e-9 && Math.abs(s.liq - p.entry * (1 - 0.2 + 0.005)) < 1e-9 && s.lossAtStop > 500 * p.stopPct / 100 && s.lossAtStop < 500 * p.stopPct / 100 + 1, `$100 at 5x = a $500 position; liquidation ${s.liq.toFixed(2)} (20% less the maintenance margin under the entry); the stop costs $${s.lossAtStop.toFixed(2)} with fees`);
ok(s.tps.length === 3 && s.tps.reduce((a, x) => a + x.share, 0) === 100 && s.tps[2].total > s.tps[0].total, `TP sells 40/30/30: +$${s.tps.map((x) => x.usd.toFixed(0)).join(', +$')} (total +$${s.tps[2].total.toFixed(0)}, ${s.tps[2].roe}% on the margin)`);
{ const O = outcomes(p, s); ok(O.length === 4 && O[0].usd === -s.lossAtStop && O[1].usd > 0 && O[1].usd < O[2].usd && O[2].usd < O[3].usd && Math.abs(O[3].usd - s.tps[2].total) < 1e-6, `what you'll make: stopped −$${-O[0].usd}, TP1 then back to entry +$${O[1].usd}, TP2 then entry +$${O[2].usd}, all TPs +$${O[3].usd} (${O[3].pctMargin}% on the margin)`);
  const a = pnlAt(p, s, p.entry * 1.1), b = pnlAt(p, s, p.entry * 0.97), c = pnlAt(p, s, s.liq * 0.99); ok(a.usd > 0 && Math.abs(a.usd - (s.qty * p.entry * 0.1 - s.notional * PERP.makerFee - s.qty * p.entry * 1.1 * PERP.takerFee)) < 0.01 && b.usd < 0 && c.liquidated && c.usd === -100, `any price: +10% = +$${a.usd} (${a.pctMargin}% on $100 at 5x), −3% = −$${-b.usd}, past the liquidation = the whole $100`); }
// leverage too high for the stop: liquidated before the stop
const wide = { ...p, stopPct: 12, stop: p.entry * 0.88 }, s10 = sizeTrade(wide, { margin: 100, lev: 10 });
ok(s10.liq > wide.stop && /BEFORE the stop/.test(s10.warn[0]) && s10.maxLev <= 5, `a 12% stop at 10x: liquidated at ${s10.liq.toFixed(2)} before the stop: warned, ${s10.maxLev}x at most`);
const s20 = sizeTrade(p, { margin: 100, lev: 10, maxLoss: 20 }); ok(s20.fitMargin <= 100 && (s20.lossAtStop <= 20 || /over your \$20 limit/.test(s20.warn.join(' '))), `a $20 loss limit: margin to use at 10x $${s20.fitMargin}`);
// short side mirrors
const ps = planTrade({ daily: D, h4: [], price: 11.1, side: 'short' }); ok(ps.none || (ps.entry > 11.1 && ps.stop > ps.entry && ps.tps[0].px < ps.entry), 'short: limit at resistance above, stop above it, TPs below' + (ps.none ? ' (none here: ' + ps.none + ')' : ` (entry ${ps.entry.toFixed(2)}, stop ${ps.stop.toFixed(2)})`));
const ss = ps.none ? null : sizeTrade(ps, { margin: 100, lev: 5 }); ok(!ss || ss.liq > ps.entry, 'short liquidation sits above the entry');
// no level near: says wait, never chases
const flat = D.map((b, i) => [b[0], 5 + i * 0.05, 5 + i * 0.05 + 0.01, 5 + i * 0.05 - 0.01, 5 + i * 0.05, 1]); const pf = planTrade({ daily: flat, h4: [], price: flat[flat.length - 1][4] });
ok(pf.none && /do not chase/.test(pf.none), 'a straight line with no turns: no plan, "wait, do not chase"');
ok(/^LONG UNISDT|^LONG UNI/.test(ticket('UNI', p, s)) && /Stop loss/.test(ticket('UNI', p, s)) && /move the stop to the entry/.test(ticket('UNI', p, s)), 'the order ticket to copy: side, leverage, limit, stop, TPs, break-even rule, liquidation');
// the building blocks
ok(Math.abs(ema([1, 2, 3, 4, 5, 6], 3) - 5) < 1e-9 && atr([[0, 1, 2, 0, 1], [0, 1, 3, 1, 2]], 1) === 2 && pivots([[0, 0, 1, 0, 0], [0, 0, 3, 0, 0], [0, 0, 1, 0, 0]], 1).hi.length === 1 && zones([{ px: 10, w: 1, tf: '1d' }, { px: 10.1, w: 1, tf: '4h' }, { px: 12, w: 1, tf: '1d' }], 1.5).length === 2, 'averages, ATR, swing points and level merging');
// real data: every alt on the desk gets a plan or a reason, never an error
try { const j = JSON.parse(fs.readFileSync('docs/data/alts.json', 'utf8')); let n = 0, plans = 0, bad = 0; for (const r of j.results) { const daily = (r.candles || []).map((c, i) => [i * 86400, +c[1], +c[2], +c[3], +c[4], 0]); if (daily.length < 30) continue; n++; const q = planTrade({ daily, h4: [], price: r.lastClose }); if (!q.none) { plans++; const z = sizeTrade(q, { margin: 100, lev: 5 }); if (!(q.stop < q.entry && q.entry < r.lastClose && q.tps.every((x) => x.px > q.entry) && z.liq < q.entry)) bad++; } }
  ok(n > 50 && bad === 0, `the desk's ${n} alts, real candles: ${plans} with a long plan, the rest told to wait; every plan the right way round`); } catch (e) { ok(false, 'real data: ' + e.message); }
process.exit(f);
