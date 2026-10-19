// Strategy lab: exit engine, paper account and scalp rules.
import { runExit, PROFILES, book, fromSignal, fromRun } from '../docs/exits.mjs';
import { scalpSignals, scalpCandidates, labRow, BOOKS, DEGEN_COPIES, EXIT_SET, EXIT_SET_HOURS } from '../docs/strategies.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-18T00:00:00Z') / 1000, H = 3600, sig = { signalAt: '2026-10-17T23:59:00Z', liq: null };
const hb = (i, o, h, l, c) => [T0 + i * H, o, h, l, c, 100];

// ladder: 1.5x, 2x, 3x then a fall; trail 35% below the high, never below entry
{ const P = { ...PROFILES.ladder, slipPct: 0 }, bars = [hb(0, 1, 1.1, 0.95, 1.05), hb(1, 1.05, 1.6, 1.0, 1.55), hb(2, 1.55, 2.1, 1.5, 2.05), hb(3, 2.05, 3.2, 2.1, 3.1), hb(4, 3.1, 3.2, 1.9, 2.0)];
  const r = runExit(sig, bars, 'now', P);
  ok(r.fills.length === 4 && r.fills.map((x) => x.why).join() === 'tp1,tp2,tp3,trail', 'ladder sells at 1.5x, 2x, 3x, then the trail takes the rest');
  ok(Math.abs(r.fills[3].level - 3.2 * 0.65) < 1e-6 && r.status === 'trailed out after 3x', 'trail sits 35% under the highest high');
  const want = 0.25 * 1.5 + 0.25 * 2 + 0.25 * 3 + 0.25 * 3.2 * 0.65 - 1; ok(Math.abs(r.retPct - want * 100) < 0.11, 'return adds up from the sales'); }
// break-even after the first take-profit, no trail
{ const P = { stopPct: 0.1, ladder: [[1.2, 0.5]], trailPct: null, trailFrom: null, beAfterFirst: true, maxHours: 48, slipPct: 0 }, bars = [hb(0, 1, 1.25, 0.95, 1.1), hb(1, 1.1, 1.12, 0.98, 1)];
  const r = runExit(sig, bars, 'now', P); ok(r.status === 'stopped at break-even after 1.2x' && r.fills[1].level === 1 && Math.abs(r.retPct - 10) < 0.01, 'stop moves to break-even after the first take-profit'); }
// a candle touching the stop and the target counts as the stop
{ const r = runExit(sig, [hb(0, 1, 2.5, 0.7, 2)], 'now', { ...PROFILES.degen, slipPct: 0 }); ok(r.status === 'stopped out' && r.tpHit === 0, 'stop is assumed before the target inside one candle'); }
// time exit and open trades
{ const bars = Array.from({ length: 80 }, (_, i) => hb(i, 1, 1.05, 0.97, 1.01)); const r = runExit(sig, bars, 'now', { ...PROFILES.degen, slipPct: 0 }); ok(r.status === 'time exit (72 hours)' && r.rem === 0, 'time limit sells what is left');
  const o = runExit(sig, bars.slice(0, 5), 'now', { ...PROFILES.degen, slipPct: 0 }); ok(o.status === 'open' && o.openRet != null && o.rem === 1 && o.stopNow === 0.8, 'open trade reports stop, size left and open return'); }
// candles that start after the signal cannot be replayed
{ const r = runExit({ signalAt: '2026-10-17T00:00:00Z' }, [hb(0, 1, 1.1, 0.9, 1)], 'now', PROFILES.degen); ok(r.status === 'waiting for entry' && r.gap, 'a gap in the candles leaves the trade waiting'); }
// price impact on a thin pool costs more
{ const bars = [hb(0, 1, 1.1, 0.95, 1.05)]; const a = runExit({ ...sig, liq: 1e9 }, bars, 'n', PROFILES.degen), b = runExit({ ...sig, liq: 20000 }, bars, 'n', PROFILES.degen); ok(b.entryPx > a.entryPx && b.markPx < b.lastPx, 'thin pool: dearer entry and a haircut on the exit value'); }

// paper account
{ const mk = (i, fills, open, mark) => ({ key: 'k' + i, coin: 'C' + i, at: `2026-10-1${i}T00:00:00Z`, entryAt: `2026-10-1${i}T01:00:00Z`, entryPx: 1, fills, open, rem: open ? 1 - fills.reduce((a, x) => a + x.frac, 0) : 0, markPx: mark, lastPx: mark, stopNet: 1, closedAt: open ? null : `2026-10-1${i}T05:00:00Z` });
  const P = [mk(1, [{ t: '2026-10-11T03:00:00Z', px: 2, frac: 0.5 }, { t: '2026-10-11T05:00:00Z', px: 1.5, frac: 0.5 }], false), mk(2, [{ t: '2026-10-12T05:00:00Z', px: 0.8, frac: 1 }], false), mk(3, [{ t: '2026-10-13T03:00:00Z', px: 1.5, frac: 0.25 }], true, 1.2)];
  const b = book(P, { pct: 10 }); ok(b.check && b.closedN === 2 && b.openN === 1, 'account adds up: cash plus open value equals the total');
  const t3 = b.trades.find((t) => t.coin === 'C3'); ok(Math.abs(t3.banked - t3.qty * 0.25 * 1.5) < 1e-9 && Math.abs(t3.value - t3.qty * 0.75 * 1.2) < 1e-9 && Math.abs(t3.riskNow - t3.qty * 0.75 * 0.2) < 1e-9 && t3.locked > 0, 'open position: banked, value, current risk and locked profit');
  const t1 = b.trades.find((t) => t.coin === 'C1'); ok(Math.abs(t1.pnl - t1.size * 0.75) < 1e-9 && Math.abs(t1.exitAvg - 1.75) < 1e-9, 'closed position: P&L and average exit');
  const b20 = book(P, { pct: 20 }); ok(b20.trades[0].size > b.trades[0].size && book(P, { pct: 10 }).equity === b.equity, 'booking again at another size does not change the first result');
  const slot = book(P, { pct: 10, slots: 1 }); ok(slot.skipped === 0 && book([...P, { ...mk(4, [], true, 1), entryAt: '2026-10-13T02:00:00Z', at: '2026-10-13T02:00:00Z' }], { pct: 10, slots: 1 }).skipped === 1, 'a trade arriving when every slot is full is skipped'); }
// bid-ready log rows keep their R result in dollars
{ const s = { signalId: 'a', coin: 'A', signalAt: '2026-10-11T00:00:00Z', closedAt: '2026-10-11T09:00:00Z', entryMid: 1, stop: 0.9, tp1: 1.2, tp2: 1.4, tp3: 1.6, tpHit: 1, status: 'stopped after TP1', resultR: 0.6 };
  const p = fromSignal(s), b = book([p], { pct: 10 }); ok(Math.abs(b.trades[0].pnl - b.trades[0].size * 0.6 * 0.1) < 1e-9 && b.check, 'bid-ready trade: dollars match the log R');
  ok(fromSignal({ ...s, status: 'waiting for entry', resultR: null }).waiting === true && fromSignal({ ...s, status: 'expired (no fill)', resultR: null }) === null, 'waiting and expired signals'); }
ok(fromRun({ status: 'no data', lid: 'x' }) === null, 'rows without candle data are left out');

// scalp rules on 5-minute candles
{ const now = T0 + 60 * 300 + 300 + 60, base = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const up = base(60, (i) => { const p = 1 + i * 0.002; return [T0 + i * 300, p, p * 1.004, p * 0.996, p * 1.001, 100]; }); const last = up[59][4]; up.push([T0 + 60 * 300, last, last * 1.05, last * 0.999, last * 1.045, 400]);
  const s1 = scalpSignals(up, now, { ch24: 20 }); ok(s1.some((x) => x.book === 'scalpBreak'), 'breakout on volume triggers the breakout scalper');
  ok(scalpSignals(up, now + 3600, { ch24: 20 }).length === 0, 'a trigger older than 10 minutes is ignored');
  const dn = base(60, (i) => { const p = 1 + i * 0.001; return [T0 + i * 300, p, p * 1.003, p * 0.997, p * 1.0005, 100]; }); for (let i = 0; i < 6; i++) { const p = dn[dn.length - 1][4]; dn.push([T0 + (60 + i) * 300, p, p * 1.001, p * 0.985, p * 0.986, 110]); }
  const q = dn[dn.length - 1][4]; dn.push([T0 + 66 * 300, q, q * 1.0, q * 0.9, q * 0.97, 500]);
  const s2 = scalpSignals(dn, T0 + 67 * 300 + 60, { ch24: 12 }); ok(s2.some((x) => x.book === 'scalpDip'), 'flush below the average with low RSI triggers the dip-buyer');
  ok(!scalpSignals(dn, T0 + 67 * 300 + 60, { ch24: -5 }).some((x) => x.book === 'scalpDip'), 'no dip-buy when the coin is down on the day');
  const c = scalpCandidates([{ pool: 'a', price: 1, liq: 200000, v24: 900000, vacc: 3 }, { pool: 'b', price: 1, liq: 50000, v24: 900000, vacc: 9 }, { pool: 'c', price: 1, liq: 300000, v24: 2e6, vacc: 5, rug: 'danger' }, { pool: 'd', price: 1, liq: 300000, v24: 2e6, vacc: 4 }]);
  ok(c.map((x) => x.pool).join() === 'd,a', 'scalp candidates: liquid, safe, ranked by volume surge'); }
// registry
{ const r = labRow('degenLadder', { signalId: 'SOL:X@2026-10-18T01', id: 'SOL:X', coin: 'X', chain: 'Solana', pool: 'p', net: 'solana', signalAt: '2026-10-18T01:00:00Z', liq: 90000, priceAtSignal: 2 }, 'now');
  ok(r.lid === 'degenLadder|SOL:X@2026-10-18T01' && r.profile === 'ladder' && r.status === 'waiting for entry' && r.liq === 90000, 'lab row keeps the source entry');
  ok(DEGEN_COPIES.every((k) => BOOKS[k].same === 'degen') && Object.values(BOOKS).every((b) => b.exits && b.entry), 'every book states its entry and exit rules');
  ok(EXIT_SET_HOURS === 168 && Object.keys(EXIT_SET).length >= 10, 'exit comparison covers ladder, moonbag, tight and careful rules'); }
// degen rows written before the exit engine still show up with the right result
{ const old = { signalId: 'o', coin: 'O', signalAt: '2026-10-18T07:00:00Z', entryMid: 2, stop: 1.6, tp1: 4, status: 'trailed out after 2x', tpHit: 1, retPct: 55, closedAt: '2026-10-19T00:00Z' };
  const p = fromRun(old, 'degen'), b = book([p], { pct: 10 }); ok(p && !p.waiting && Math.abs(b.trades[0].pnlPct - 55) < 1e-6, 'old closed degen row keeps its return');
  const o2 = fromRun({ ...old, status: 'open', retPct: null, openRet: 20, closedAt: null }, 'degen'), b2 = book([o2], { pct: 10 }); ok(Math.abs(b2.trades[0].pnlPct - 20) < 1e-6 && b2.trades[0].banked > 0, 'old open degen row: half banked and the open return kept'); }
process.exit(f);
