// Execution layer: 5-minute trigger entries, ride free at 2x, giveback on closes, fixed fills, R-based targets, study exits.
import { runExit, PROFILES } from '../docs/exits.mjs';
import { execTrigger, BOOKS, DEGEN_COPIES, EXIT_SET } from '../docs/strategies.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-20T00:00:00Z') / 1000, H = 3600, iso = (s) => new Date(s * 1000).toISOString().slice(0, 19) + 'Z';
const hb = (i, o, h, l, c, v = 100) => [T0 + i * H, o, h, l, c, v], sig = iso(T0 - 60), late = iso(T0 + 400 * H);

// ride free at 2x and the giveback line (study exits)
{ const P = { ...PROFILES.study, slipPct: 0, barSec: 3600 };
  const bars = [hb(0, 1, 1.1, 0.95, 1.05), hb(1, 1.05, 1.6, 1.0, 1.5), hb(2, 1.5, 2.2, 1.45, 2.1), hb(3, 2.1, 4.2, 2.0, 4.1), hb(4, 4.1, 4.3, 3.0, 3.2), hb(5, 3.2, 3.3, 1.9, 2.0), hb(6, 2.0, 2.1, 1.8, 1.9)];
  const r = runExit({ signalAt: sig }, bars, late, P);
  ok(r.fills[0].why === 'ridefree' && r.fills[0].level === 2 && Math.abs(r.fills[0].frac - 0.5) < 1e-6, 'ride free: at 2x sell half, which is the whole stake back');
  ok(/^giveback/.test(r.status) && r.fills[1].px === 2 && r.free === true, 'giveback: a close 50% under the best close (4.1 -> 2.0) sells the rest at the next open');
  ok(Math.abs(r.retX - (0.5 * 2 + 0.5 * 2 - 1)) < 1e-9 && r.retX > 0, 'after riding free the trade cannot end in a loss');
  const dip = [hb(0, 1, 1.05, 0.7, 0.75), hb(1, 0.75, 0.8, 0.62, 0.65), hb(2, 0.65, 0.7, 0.55, 0.58)];
  const d = runExit({ signalAt: sig }, dip, late, P); ok(d.status === 'stopped out' && d.fills[0].px === 0.6, 'study exits: floor 40% under the first entry'); }

// execution stack: R targets, break-even, ride free, volume died, no follow-through
{ const P = { ...PROFILES.exec, slipPct: 0, exitSlipPct: 0, volDeath: null, barSec: 3600 };
  const up = [hb(0, 1, 1.05, 0.98, 1.04), hb(1, 1.04, 1.12, 1.03, 1.1), hb(2, 1.1, 2.1, 1.09, 2.05), hb(3, 2.05, 2.5, 2.0, 2.4)];
  const r = runExit({ signalAt: sig, stopPx: 0.9 }, up, late, P);
  ok(r.stop0 === 0.9 && r.fills[0].why === 'tp1' && Math.abs(r.fills[0].level - 1.1) < 1e-9 && Math.abs(r.fills[0].frac - 1 / 3) < 1e-4, 'a third sold at +1R (the stop is 10% away, so +1R = 1.10)');
  const rf = r.fills.find((x) => x.why === 'ridefree'); ok(rf && Math.abs(rf.frac - (1 - 1.1 / 3) / 2) < 1e-4 && r.free && r.status === 'open', 'ride free at 2x sells only what is still needed to get the stake back');
  const flat = Array.from({ length: 10 }, (_, i) => hb(i, 1, 1.04, 0.96, 0.99));
  const nf = runExit({ signalAt: sig, stopPx: 0.9 }, flat, late, P); ok(/no follow-through after 6 hours/.test(nf.status), 'out after 6 hours without reaching +1R'); }

// fixed fill (a trigger found on 5-minute candles), replayed on hourly candles
{ const P = { ...PROFILES.exec, slipPct: 0, exitSlipPct: 0, volDeath: null, barSec: 3600 }, bars = [hb(0, 1, 1.02, 0.92, 1.0), hb(1, 1.0, 1.3, 0.97, 1.25), hb(2, 1.25, 1.3, 1.2, 1.22)];
  const r = runExit({ signalAt: sig, fill: { px: 1.0, at: iso(T0 + 1800) }, stopPx: 0.9 }, bars, late, P);
  ok(r.entryPx === 1 && r.entryAt === iso(T0 + 1800).slice(0, 16) + 'Z' && r.status === 'open' && r.fills[0].why === 'tp1', 'fixed fill: the trade starts at the trigger price and time, then follows the hourly candles');
  const s2 = runExit({ signalAt: sig, fill: { px: 1.0, at: iso(T0 + 1800) }, stopPx: 0.9 }, [hb(0, 1, 1.02, 0.85, 1.0), ...bars.slice(1)], late, P); ok(s2.status === 'stopped out', 'if the fill hour traded under the stop it counts as stopped (we cannot tell the order inside the candle)'); }

// volume died on 5-minute candles
{ const P = { ...PROFILES.degen, slipPct: 0, barSec: 300, volDeath: { ratio: 0.2 } }, M = 300, b5 = [];
  for (let i = 0; i < 380; i++) b5.push([T0 - 288 * M + i * M, 1, 1.01, 0.99, 1, i < 288 ? 100 : 5]);
  const r = runExit({ signalAt: iso(T0 - 60) }, b5, iso(T0 + 400 * M), P); ok(/^volume died/.test(r.status), 'volume-died rule works on 5-minute candles too (72 vs 288 candles)'); }

// 5-minute trigger
{ const M = 300, mk = (i, o, h, l, c, v) => [T0 + i * M, o, h, l, c, v], base = Array.from({ length: 14 }, (_, i) => mk(i, 1.05, 1.06, 1.04, 1.05, 100));
  const setup = { zoneLow: 1.0, zoneHigh: 1.04, stop: 0.9 }, now = T0 + 40 * M;
  const flush = [...base, mk(14, 1.05, 1.05, 0.97, 0.98, 120), mk(15, 0.98, 1.03, 0.97, 1.02, 200), mk(16, 1.02, 1.05, 1.01, 1.04, 150)];
  const t = execTrigger(setup, flush, now, iso(T0 - 60)); ok(t && t.kind === 'flush and reclaim' && t.px === 1.02 && t.at === iso(T0 + 16 * M) && Math.abs(t.stop - 0.9603) < 1e-6 && t.stopPct > 5, 'flush below the zone, 5-minute close back above it on 2x volume: buy the next open, stop 1% under the flush low (5% minimum)');
  ok(execTrigger(setup, flush.slice(0, 16), now, iso(T0 - 60)).pending === true, 'triggered on the last closed candle: the fill is the next open');
  const weak = [...base, mk(14, 1.05, 1.05, 0.97, 0.98, 120), mk(15, 0.98, 1.03, 0.97, 1.02, 110), mk(16, 1.02, 1.05, 1.01, 1.04, 150)];
  ok(execTrigger(setup, weak, now, iso(T0 - 60)) === null, 'a reclaim on ordinary volume is not a trigger');
  const chase = [...base, mk(14, 1.05, 1.05, 0.97, 0.98, 120), mk(15, 0.98, 1.12, 0.97, 1.11, 300), mk(16, 1.11, 1.12, 1.1, 1.11, 150)];
  ok(execTrigger(setup, chase, now, iso(T0 - 60)) === null, 'no chasing: a reclaim candle closing 7% over the zone is skipped');
  const bounce = [...base, mk(14, 1.05, 1.05, 1.02, 1.03, 100), mk(15, 1.03, 1.05, 1.02, 1.045, 250), mk(16, 1.045, 1.05, 1.04, 1.05, 100)];
  const b = execTrigger(setup, bounce, now, iso(T0 - 60)); ok(b && b.kind === 'bounce in the zone' && Math.abs(b.stopPct - 5) < 0.01, 'bounce in the zone on 2.5x volume: buy, with the 5% minimum stop');
  const broke = [...base, mk(14, 1.0, 1.0, 0.85, 0.86, 300)]; ok(execTrigger(setup, broke, now, iso(T0 - 60)).dead === true, 'a close under the invalidation cancels the setup');
  ok(execTrigger(setup, base, T0 + 25 * H, iso(T0 - 60)).dead === true, 'no trigger in 24 hours: expired'); }

// 15-minute replay of the bot rules (exec profile): giveback on 15-minute closes after riding free
{ const Q = 900, q15 = (i, o, h, l, c) => [T0 + i * Q, o, h, l, c, 100], P = { ...PROFILES.exec, slipPct: 0, exitSlipPct: 0, volDeath: null };
  const bars = [q15(0, 1, 1.02, 0.97, 1.01), q15(1, 1.01, 1.15, 1.0, 1.12), q15(2, 1.12, 2.3, 1.1, 2.25), q15(3, 2.25, 3.1, 2.2, 3.0), q15(4, 3.0, 3.05, 1.4, 1.45), q15(5, 1.45, 1.5, 1.3, 1.35)];
  const r = runExit({ signalAt: sig, fill: { px: 1.0, at: iso(T0 + 60) }, stopPx: 0.92 }, bars, late, P);
  ok(P.barSec === 900 && r.fills.map((x) => x.why).join() === 'tp1,ridefree,giveback' && r.fills[2].px === 1.45 && r.retX > 0, 'bot rules on 15-minute candles: TP1, ride free, then out on the 15-minute close 50% under the best close'); }
ok(BOOKS.exec.trigger && BOOKS.exec.same === 'execZone' && BOOKS.execStudy.profile === 'study' && DEGEN_COPIES.includes('degenStudy') && EXIT_SET['study: stop 40%, ride free at 2x, 50% giveback on closes'], 'bot rules and study books registered');
process.exit(f);
