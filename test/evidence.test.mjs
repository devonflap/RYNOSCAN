// Evidence: R multiples, bootstrap range, verdicts, market split and exit hints.
import { book } from '../docs/exits.mjs';
import { evidence, bootstrap, exitHint } from '../docs/evidence.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const mk = (i, exit, mkt, mfe, mae) => ({ key: 'k' + i, coin: 'C' + i, at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 6 * 3600e3).toISOString(), entryAt: new Date(Date.parse('2026-10-01T01:00:00Z') + i * 6 * 3600e3).toISOString(), closedAt: new Date(Date.parse('2026-10-01T04:00:00Z') + i * 6 * 3600e3).toISOString(),
  entryPx: 1, stop0: 0.8, fills: [{ t: new Date(Date.parse('2026-10-01T04:00:00Z') + i * 6 * 3600e3).toISOString(), px: exit, frac: 1 }], open: false, rem: 0, mkt, mfePct: mfe, maePct: mae });
// a stop-out is -1R: lose the 20% stop distance
{ const b = book([mk(0, 0.8, null)], { pct: 10 }); ok(Math.abs(b.trades[0].R + 1) < 1e-9, 'a full stop-out is -1R'); }
// winning book: +1R most of the time
{ const P = Array.from({ length: 40 }, (_, i) => mk(i, i % 4 === 0 ? 0.8 : 1.2, { sol: i % 2 ? 'Risk-on' : 'Risk-off', vol: 'Normal' }, i % 4 === 0 ? 12 : 30, i % 4 === 0 ? 20 : 5));
  const e = evidence(book(P, { pct: 5, slots: 99 }), { now: Date.parse('2026-10-12T00:00:00Z') });
  ok(e.n === 40 && Math.abs(e.avgR - 0.5) < 0.01 && e.lo > 0 && e.pPos > 0.95 && e.verdict === 'edge', 'consistent winners: edge candidate with a range above zero');
  ok(e.bySol.length === 2 && e.byVol.length === 1, 'results split by market at entry');
  ok(/losing trades were up a median 12%/.test(exitHint(e)) && /winners dipped a median 5%/.test(exitHint(e)), 'exit hint from run-ups and dips'); }
// coin flip: no edge proven
{ const P = Array.from({ length: 40 }, (_, i) => mk(i, i % 2 ? 0.8 : 1.2)); const e = evidence(book(P, { pct: 5 })); ok(e.verdict === 'not proven' && e.lo < 0 && e.hi > 0, 'coin flip: not proven'); }
// one moonshot does not make an edge
{ const P = Array.from({ length: 40 }, (_, i) => mk(i, i === 3 ? 9 : i % 2 ? 0.8 : 1.15)); const e = evidence(book(P, { pct: 5 })); ok(e.verdict !== 'edge' && e.exBestR < 0, 'a single moonshot is not an edge'); }
ok(evidence(book([mk(0, 1.2, null)], { pct: 5 })).verdict === 'collecting' && bootstrap([1]) === null, 'too few trades: collecting');
// luck correction: a modest edge that passes alone is not crowned when 15 books are compared
{ const P = Array.from({ length: 40 }, (_, i) => mk(i, [0.8, 1.2, 1.2, 0.8, 1.25][i % 5])); const one = evidence(book(P, { pct: 5 })), many = evidence(book(P, { pct: 5 }), { tests: 15 });
  ok(many.loAdj < one.loAdj && many.tests === 15, 'luck correction lowers the low end when many books are compared'); }
// consistency: winning only in the first half is not an edge
{ const P = Array.from({ length: 40 }, (_, i) => mk(i, i < 20 ? 1.6 : 0.85)); const e = evidence(book(P, { pct: 5 })); ok(e.half1 > 0 && e.half2 < 0 && e.verdict !== 'edge', 'an edge that faded in the second half is not an edge'); }
process.exit(f);
