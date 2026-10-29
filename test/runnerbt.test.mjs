// the runner backtest's maths: entries (listing, base breakout, retest) and exits on hourly candles
import { boxBreak, retest, exit, simulate, record, EXITS, RBT } from '../src/runnerbt.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const H = 3600, T0 = 1800000000, bar = (i, o, h, l, c, v = 100) => [T0 + i * H, o, h, l, c, v];
// 30 quiet hours between 1.00 and 1.10, then a breakout close at 1.2 on 3x volume, then a run to 3.0, then a fall
const B = []; for (let i = 0; i < 30; i++) B.push(bar(i, 1.05, 1.1, 1.0, 1.05)); B.push(bar(30, 1.05, 1.22, 1.04, 1.2, 300)); for (let i = 31; i < 60; i++) { const p = 1.2 + (i - 30) * 0.06; B.push(bar(i, p, p * 1.02, p * 0.98, p)); } for (let i = 60; i < 90; i++) B.push(bar(i, 2.9 - (i - 60) * 0.08, 2.92 - (i - 60) * 0.08, 2.85 - (i - 60) * 0.08, 2.88 - (i - 60) * 0.08));
const e = boxBreak(B, 24, 24); ok(e && e.i === 31 && Math.abs(e.px - B[31][1]) < 1e-9 && Math.abs(e.stop - 0.98) < 1e-9, 'a 24h base (1.00-1.10) broken on a close of 1.20 on 3x volume: bought at the next open, stop just under the base');
ok(boxBreak(B.map((b, i) => (i === 30 ? [...b.slice(0, 5), 120] : b)), 24, 24) === null, 'the same close on ordinary volume: no breakout');
const h = exit(B, e, EXITS.half2_t30); ok(h.ret > 50 && /trail 30%/.test(h.why), 'half at 2x, the rest trailed 30% off the best close: ' + h.ret.toFixed(0) + '%');
const s = exit(B, { i: 31, px: 1.25, stop: 1.2 }, EXITS.hold7); ok(s.why === 'stop' || s.ret > 0, 'hold with a stop runs');
const R = [...B.slice(0, 31), bar(31, 1.2, 1.25, 1.12, 1.15), bar(32, 1.15, 1.2, 1.11, 1.18), ...B.slice(33)]; const rt = retest(R, 24, 24); ok(rt && rt.i === 32, 'the first hour back at the base top that closes above it: the retest entry');
const sim = simulate(B, T0 + 24 * H); ok(Object.keys(sim).length === 5 * Object.keys(EXITS).length && sim['listing / hold7'] && sim['box24 / half2_t30'], 'every entry is run with every exit');
const rec = record([{ ret: 10, peakX: 2.1, heldH: 5 }, { ret: -20, peakX: 1, heldH: 2 }, null]); ok(rec.n === 2 && rec.avg === -5 && rec.win === 50 && rec.x2 === 1, 'a combination\'s record (missed entries are not trades)');
// 30 Oct: the paper books' own exits
{ const { exit, EXITS } = await import('../src/runnerbt.mjs'); const H = 3600, bar = (i, o, h, l, c) => [1800000000 + i * H, o, h, l, c, 100];
  const B = [bar(0, 1, 1.05, 0.95, 1), bar(1, 1, 1.45, 1, 1.42), bar(2, 1.42, 1.5, 1.3, 1.45), bar(3, 1.45, 1.46, 0.98, 0.99)];
  const r = exit(B, { i: 0, px: 1, stop: 0.5 }, EXITS.claude, { inPct: 0, outPct: 0, maxHoldH: 999 });
  ok(Math.abs(r.ret - (0.25 * 1.4 + 0.75 * 1) * 100 + 100) < 0.01 && /break-even|trail/.test(r.why), 'Claude\'s exits: a quarter at +40%, then the stop at break-even catches the rest (its own 18% stop, not the entry\'s)');
  const r2 = exit([bar(0, 1, 1.02, 0.8, 0.85)], { i: 0, px: 1, stop: 0.5 }, EXITS.ryan, { inPct: 0, outPct: 0, maxHoldH: 999 }); ok(Math.abs(r2.ret + 20) < 0.01, 'Ryan\'s exits: his own 20% stop'); }
process.exit(f);
