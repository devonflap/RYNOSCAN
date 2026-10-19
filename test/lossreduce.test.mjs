// Loss reducers: cut on sellers (wallet reads and 15-minute DexScreener checks), heavy selling candle, no follow-through.
import { runExit, PROFILES, flowCutEvent, deadExit, missStep, book, fromRun } from '../docs/exits.mjs';
import { evidence } from '../docs/evidence.mjs';
import { flowScan } from '../src/pulse.mjs';
import { BOOKS, DEGEN_COPIES, EXIT_SET } from '../docs/strategies.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-18T00:00:00Z') / 1000, H = 3600, iso = (i) => new Date((T0 + i * H) * 1000).toISOString().slice(0, 19) + 'Z';
const hb = (i, o, h, l, c, v = 100) => [T0 + i * H, o, h, l, c, v], sig = '2026-10-17T23:59:00Z', now = iso(40);
const P = { ...PROFILES.degenFlow, slipPct: 0 };

// a slow bleed: 1.0 -> 0.88 -> 0.84 -> 0.79 (stop at 0.80)
const bleed = [hb(0, 1, 1.02, 0.97, 0.98), hb(1, 0.98, 0.99, 0.9, 0.91), hb(2, 0.91, 0.92, 0.87, 0.88), hb(3, 0.88, 0.89, 0.83, 0.84), hb(4, 0.84, 0.85, 0.78, 0.79), hb(5, 0.79, 0.8, 0.75, 0.76)];
{ const base = runExit({ signalAt: sig }, bleed, now, P); ok(base.status === 'stopped out' && Math.round(base.retX * 100) === -20, 'without a cut the bleed runs to the 20% stop');
  const c1 = runExit({ signalAt: sig, cut: { at: iso(2) + '', px: 0.89, why: 'x' } }, bleed, now, P);
  ok(c1.status === 'cut early: sellers took over' && Math.abs(c1.retX + 0.11) < 1e-6 && c1.fills[0].why === 'cut', 'a cut with a price sells there, on the candle it happened in');
  const c2 = runExit({ signalAt: sig, cut: { at: new Date((T0 + 2 * H + 600) * 1000).toISOString(), why: 'x' } }, bleed, now, P);
  ok(c2.status === 'cut early: sellers took over' && c2.fills[0].px === 0.88, 'a cut without a price sells at the next candle open (no peeking)');
  const late = runExit({ signalAt: sig, cut: { at: iso(5), px: 0.76, why: 'x' } }, bleed, now, P); ok(late.status === 'stopped out', 'the stop still wins when it came first');
  const open = runExit({ signalAt: sig, cut: { at: iso(9), why: 'x' } }, bleed.slice(0, 3), iso(9), P); ok(open.status === 'open', 'a cut after the last candle waits for the next candle'); }

// deciding the cut from flow reads
{ const E = 1, at = iso(0);
  ok(flowCutEvent([{ t: iso(1), b: 80, s: 120, n: -5000, p: 1.05 }], [], E, at) === null, 'sellers leading while the trade is up: no cut (let the trail handle profits)');
  ok(flowCutEvent([{ t: iso(2), b: 108, s: 109, n: -4399, p: 0.9 }], [], E, at) === null, 'sellers barely ahead: no cut (needs 1.2x)');
  ok(flowCutEvent([{ t: iso(2), b: 90, s: 144, n: 3000, p: 0.9 }], [], E, at) === null, 'more sellers but money still flowing in: no cut');
  const c = flowCutEvent([{ t: iso(1), b: 90, s: 100, n: -1, p: 0.95 }, { t: iso(3), b: 90, s: 144, n: -5623, p: 0.88 }], [], E, at);
  ok(c && c.at === iso(3) && c.px === 0.88 && /144 wallets selling vs 90 buying/.test(c.why) && /12% under entry/.test(c.why), 'first read that is 8%+ under and sellers 1.2x ahead with money out');
  const nb = flowCutEvent([{ t: iso(3), b: 90, s: 144, n: -1 }], bleed, E, at); ok(nb && nb.px === null, 'a read with no price uses the last closed candle to judge, and leaves the fill to the next open');
  const nb2 = flowCutEvent([{ t: new Date((T0 + 2 * H + 1800) * 1000).toISOString(), b: 90, s: 144, n: -1 }], bleed, E, at); ok(nb2 && /9% under/.test(nb2.why), 'judged on the candle that had closed before the read (0.91), not the one still forming');
  ok(flowCutEvent([{ t: iso(2), src: 'dex', b1: 10, s1: 30, b5: 2, s5: 5, px: 0.9 }], [], E, at) !== null && flowCutEvent([{ t: iso(2), src: 'dex', b1: 10, s1: 30, b5: 6, s5: 5, px: 0.9 }], [], E, at) === null, 'DexScreener read: needs sellers ahead over the hour AND the last 5 minutes'); }

// 15-minute watcher check
{ const pos = [{ lid: 'degenFlow|A', book: 'degenFlow', profile: 'degenFlow', pool: 'P1', net: 'solana', coin: 'AAA', entryPx: 1, entryAt: '2026-10-18T00:00Z', status: 'open' }, { lid: 'degenFlow|B', book: 'degenFlow', profile: 'degenFlow', pool: 'P2', net: 'solana', coin: 'BBB', entryPx: 1, entryAt: '2026-10-18T00:00Z', status: 'open' }];
  const pair = (a, px) => ({ pairAddress: a, priceUsd: String(px), txns: { h1: { buys: 10, sells: 30 }, m5: { buys: 2, sells: 5 } } }); const calls = [];
  const ev = await flowScan(pos, async (u) => { calls.push(u); return { pairs: [pair('P1', 0.9), pair('P2', 0.97)] }; }, '2026-10-18T05:00:00Z', async () => {});
  ok(calls.length === 1 && ev.length === 1 && ev[0].lid === 'degenFlow|A' && ev[0].px === 0.9, 'watcher records a read only for the position that would cut'); }

// heavy selling candle and no follow-through (runner study variants)
{ const D = { ...PROFILES.degen, slipPct: 0 }, flat = Array.from({ length: 12 }, (_, i) => [T0 - (12 - i) * H, 1, 1.01, 0.99, 1, 100]);
  const dump = [...flat, hb(0, 1, 1.02, 0.98, 1), hb(1, 1, 1.0, 0.86, 0.87, 400), hb(2, 0.86, 0.88, 0.84, 0.85), hb(3, 0.85, 0.86, 0.7, 0.72)];
  const sc = runExit({ signalAt: sig }, dump, now, EXIT_SET['cut on a heavy selling candle (8%+ down)']); ok(sc.status === 'cut early: heavy selling candle' && sc.fills[0].px === 0.86, 'heavy red candle on 4x volume closing near its low while 13% down: out at the next open');
  ok(runExit({ signalAt: sig }, dump, now, D).status === 'stopped out', 'plain degen rides it to the stop');
  const quiet = [...flat, hb(0, 1, 1.02, 0.98, 1), hb(1, 1, 1.0, 0.86, 0.87, 120), hb(2, 0.86, 0.88, 0.84, 0.85), hb(3, 0.85, 0.86, 0.7, 0.72)];
  ok(runExit({ signalAt: sig }, quiet, now, EXIT_SET['cut on a heavy selling candle (8%+ down)']).status === 'stopped out', 'a drop on ordinary volume is not called a selling climax');
  ok(runExit({ signalAt: sig }, dump.slice(0, 14), new Date((T0 + 1 * H + 1200) * 1000).toISOString(), EXIT_SET['cut on a heavy selling candle (8%+ down)']).status === 'open', 'a candle still forming never triggers the cut');
  const drift = Array.from({ length: 12 }, (_, i) => hb(i, 0.99, 1.03, 0.95, 0.97)); const nf = runExit({ signalAt: sig }, drift, now, EXIT_SET['cut if no follow-through in 8 hours']);
  ok(nf.status === 'cut early: no follow-through after 8 hours' && nf.fills[0].t === new Date((T0 + 8 * H) * 1000).toISOString().slice(0, 16) + 'Z', 'never got going in 8 hours and under entry: out at the next open');
  const runUp = drift.map((b, i) => i === 3 ? hb(3, 0.99, 1.15, 0.97, 0.98) : b); ok(runExit({ signalAt: sig }, runUp, now, EXIT_SET['cut if no follow-through in 8 hours']).status === 'open', 'a trade that got 10%+ above entry is left to the normal exits'); }

ok(BOOKS.degenFlow && BOOKS.degenFlow.same === 'degen' && DEGEN_COPIES.includes('degenFlow') && PROFILES.degenFlow.flowCut.lossPct === 0.08, 'cut-on-sellers book registered as a copy of the degen desk');
// dead pools: counted as losses instead of staying open forever or vanishing
{ const x = { lid: 'degen|z', book: 'degen', profile: 'degen', status: 'open', signalAt: iso(0), entryAt: iso(0), entryPx: 1, stop0: 0.8, fills: [{ t: iso(2), level: 2, px: 2, frac: 0.5, why: 'tp1' }], rem: 0.5, lastPx: 1.2, tpHit: 1 };
  const d = deadExit(x, iso(30)); ok(d.status.startsWith('closed: price data stopped') && d.fills[1].px === 0.6 && d.fills[1].frac === 0.5 && Math.abs(d.retX - 0.3) < 1e-9, 'dead pool: what is left is closed at half the last price (half sold at 2x, rest at 0.6: +30%)');
  let y = { ...x }; for (let k = 1; k < 6; k++) y = missStep(y, iso(30 + k), { now: Date.parse(iso(30 + k)) }); ok(y.status === 'open' && y.miss === 5, 'five misses: still open, misses counted');
  ok(missStep(y, iso(40), { feedOk: false }).miss === 5, 'misses are not counted while the data feed itself is failing');
  ok(missStep(y, iso(40)).status.startsWith('closed: price data stopped'), 'sixth miss in a row: closed as a dead pool');
  ok(missStep({ status: 'waiting for entry', signalAt: iso(0) }, iso(60), { now: Date.parse(iso(60)) }).status === 'no data', 'never entered: just "no data" after 48 hours');
  ok(fromRun(missStep(y, iso(40))) && fromRun(missStep(y, iso(40))).open === false, 'a dead pool stays in the book results as a closed trade'); }

// the thread's exit: close when volume dies (last 6 hours under 20% of the 24-hour pace)
{ const pre = Array.from({ length: 24 }, (_, i) => [T0 - (24 - i) * H, 1, 1.02, 0.98, 1, 1000]);
  const after = Array.from({ length: 10 }, (_, i) => hb(i, 1, 1.03, 0.97, 1.01, i < 2 ? 1000 : 10));
  const vd = runExit({ signalAt: sig }, [...pre, ...after], now, EXIT_SET['out when volume dies (6h under 20% of the 24h pace)']);
  ok(/^volume died/.test(vd.status) && vd.fills[0].why === 'volume', 'volume died: out at the next open');
  ok(runExit({ signalAt: sig }, [...pre, ...Array.from({ length: 10 }, (_, i) => hb(i, 1, 1.03, 0.97, 1.01, 900))], now, EXIT_SET['out when volume dies (6h under 20% of the 24h pace)']).status === 'open', 'steady volume: stays in');
  const dip = [...pre, hb(0, 1, 1.02, 0.98, 1, 900), hb(1, 1, 1, 0.7, 0.72, 2000), hb(2, 0.72, 0.9, 0.7, 0.88, 1500), hb(3, 0.88, 1.6, 0.86, 1.55, 3000)];
  const th = runExit({ signalAt: sig }, dip, now, EXIT_SET["thread's rule: no price stop, hold until volume dies (7 days max)"]), dg = runExit({ signalAt: sig }, dip, now, { ...PROFILES.degen, slipPct: 3 });
  ok(th.status === 'open' && dg.status === 'stopped out', "the thread's rule rides a 30% dip that stops the degen exits out (the runner study will show which pays)"); }

// stop fills 5% worse: DEXes have no resting stop orders
{ const rows = Array.from({ length: 12 }, (_, i) => ({ lid: 'risky|' + i, book: 'risky', profile: 'consRisky', coin: 'C' + i, chain: 'Solana', signalAt: iso(i * 5), entryAt: iso(i * 5), entryPx: 1, stop0: 0.9, fills: [{ t: iso(i * 5 + 2), level: i % 2 ? 1.3 : 0.9, px: i % 2 ? 1.3 : 0.9, frac: 1, why: i % 2 ? 'tp1' : 'stop' }], rem: 0, status: i % 2 ? 'all targets hit' : 'stopped out', closedAt: iso(i * 5 + 2) }));
  const e = evidence(book(rows.map((r) => fromRun(r)), { pct: 5, slots: 20, now: Date.parse(iso(200)) })); ok(e.slipR != null && e.slipR < e.avgR && Math.abs(e.avgR - e.slipR - 0.225) < 0.02, 'stop-fill stress: each stop costs an extra 5% of the price (0.45R here, half the trades)'); }
process.exit(f);
