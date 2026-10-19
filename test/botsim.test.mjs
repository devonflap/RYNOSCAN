// Bot simulator: risk sizing, per-coin / liquidity / total-risk / daily-loss limits, walk-forward book selection.
import { botBook, unitR, BOT_RULES } from '../docs/botsim.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T = (h) => new Date(Date.parse('2026-10-10T00:00:00Z') + h * 3600e3).toISOString();
const pos = (o) => ({ key: o.key, src: o.src || 'degen', coin: o.coin || o.key, pool: o.pool || o.key, liq: o.liq ?? 1e7, at: T(o.h), entryAt: T(o.h), entryPx: 1, stop0: 1 - (o.stopPct ?? 0.2), open: !!o.open, rem: o.open ? 1 : 0, markPx: o.mark ?? 1, lastPx: o.mark ?? 1, stopNet: 1 - (o.stopPct ?? 0.2),
  fills: o.open ? [] : [{ t: T(o.h + (o.dur ?? 2)), px: o.exit, frac: 1 }], closedAt: o.open ? null : T(o.h + (o.dur ?? 2)) });
// 1% risk with a 20% stop buys 5% of the account; with a 4% stop it buys 25%, then the 10% coin cap trims it
{ const b = botBook([pos({ key: 'a', h: 0, exit: 1.1 }), pos({ key: 'b', h: 10, exit: 1.1, stopPct: 0.04 })]);
  const a = b.trades.find((t) => t.key === 'a'), s = b.trades.find((t) => t.key === 'b'); ok(Math.abs(a.size - 500) < 1e-6, 'risk sizing: 1% at a 20% stop is a $500 position');
  ok(s.size < 0.11 * 10050 && b.cutWhy['coin value cap'] === 1, 'a tight stop is capped at 10% of the account per coin'); }
// two books in the same coin at once: the second is limited by the per-coin caps
{ const b = botBook([pos({ key: 'a', h: 0, open: true, pool: 'X' }), pos({ key: 'b', h: 1, open: true, pool: 'X', src: 'fibPull' }), pos({ key: 'c', h: 2, open: true, pool: 'X', src: 'risky' })]);
  const risk = b.trades.reduce((a, t) => a + t.risk0, 0); ok(risk <= 0.02 * 10000 + 1e-6 && b.trades.length === 2 && ((b.skipWhy['coin risk cap'] || 0) + (b.skipWhy['coin value cap'] || 0)) === 1, 'same coin across books: total risk held to 2%, third entry skipped');
  ok(b.stacked.length === 1 && b.stacked[0].books.length === 2, 'reports coins held by more than one book'); }
// thin pool: position limited to 2% of liquidity
{ const b = botBook([pos({ key: 'a', h: 0, exit: 1.1, liq: 10000 })]); ok(Math.abs(b.trades[0].size - 200) < 1e-6 && b.cutWhy['liquidity cap'] === 1, 'liquidity cap: 2% of the pool'); }
// daily loss limit: after 3 full losses in a day, no new trades that day
{ const P = [0, 1, 2, 3, 4].map((i) => pos({ key: 'l' + i, h: i * 2, exit: 0.8, dur: 1 })); const b = botBook(P);
  ok(b.closedN === 3 && b.skipWhy['daily loss limit hit'] === 2, 'daily loss limit stops new trades after -3%'); }
// adaptive: a book is only traded once its PAST closed trades are positive
{ const P = []; for (let i = 0; i < 12; i++) P.push(pos({ key: 'w' + i, src: 'good', h: i * 30, exit: 1.3, dur: 5 })); for (let i = 0; i < 12; i++) P.push(pos({ key: 'x' + i, src: 'bad', h: i * 30 + 1, exit: 0.8, dur: 5 }));
  const b = botBook(P, { adaptive: true }), took = (src) => b.trades.filter((t) => t.src === src).length;
  ok(took('good') === 12 - BOT_RULES.adaptMin && took('bad') === 0, 'adaptive: trades a working book after 8 closed trades, never a losing one');
  ok(b.skipWhy['book not proven yet'] === 2 * BOT_RULES.adaptMin && b.skipWhy['book not working lately'] === 12 - BOT_RULES.adaptMin, 'adaptive: skip reasons recorded');
  const early = botBook(P.filter((p) => p.src === 'good').slice(0, 9), { adaptive: true }); ok(early.trades.length === 1, 'walk-forward: only trades closed before a signal count'); }
ok(Math.abs(unitR(pos({ key: 'z', h: 0, exit: 0.8 })) + 1) < 1e-9 && unitR(pos({ key: 'o', h: 0, open: true })) === null, 'R of a stop-out is -1, open trades have none');
process.exit(f);
