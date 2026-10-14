import * as C from '../docs/core.mjs';
let bad = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
const s = { signalAt: '2026-01-01T00:00:00Z', entryHigh: 100, entryMid: 100, stop: 90, tp1: 110, tp2: 120, tp3: 130 };
const t0 = Date.parse(s.signalAt) / 1000, bar = (i, lo, hi, cl) => [t0 + i * 3600, cl, hi, lo, cl, 1];
// fills, hits TP1, pulls back to entry (breakeven stop), then would have hit TP2
const h1 = [bar(0, 99, 101, 100), bar(1, 100, 111, 110), bar(2, 99.5, 108, 100), bar(3, 100, 121, 120), bar(4, 100, 131, 130)];
const be = C.evaluate(s, h1, 'x'), keep = C.evaluate(s, h1, 'x', { tp1Stop: 1 });
ok('breakeven stop is hit on the pullback (stopped after TP1)', be.status === 'stopped after TP1' && be.resultR > 0 && be.resultR < 0.5);
ok('keeping the original stop rides through to TP3', keep.status === 'hit TP3' && keep.resultR > be.resultR);
// ladder: after TP2 the stop moves to TP1
const h2 = [bar(0, 99, 101, 100), bar(1, 100, 111, 110), bar(2, 105, 121, 120), bar(3, 109, 112, 111)];
const lad = C.evaluate(s, h2, 'x', { ladder: true }), noLad = C.evaluate(s, h2, 'x');
ok('ladder stop at TP1 locks more profit after TP2', lad.status === 'stopped after TP2' && lad.resultR >= noLad.resultR - 1e-9);
ok('default call is unchanged by the new options', C.evaluate(s, h1, 'x', {}).resultR === be.resultR);
process.exit(bad ? 1 : 0);
