import { classify, candidates, fetchPrices, windowLeftH } from '../src/watch.mjs';
import * as C from '../docs/core.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const it = { entryLow: 0.9, entryHigh: 1, stop: 0.8, tp1: 1.2 };
ok(classify(it, 0.95) === 'in-zone', 'price inside zone');
ok(classify(it, 0.85) === 'in-zone', 'price below zone but above stop is still fillable');
ok(classify(it, 0.79) === 'invalid', 'through stop');
ok(classify(it, 1.01) === 'near' && classify(it, 1.05) === 'far' && classify(it, 1.25) === 'ran', 'near / far / ran');
ok(classify(it, null) === 'unknown', 'no price');
const setups = [{ id: 'SOL:A', coin: 'A', chain: 'Solana', pool: 'p1', signal: 'Entry signal', lead: 'pattern', patName: 'Bull flag', patEntryLow: 1, patEntryHigh: 2, patStop: .5, patTp1: 3, entryLow: 9, entryHigh: 9, stop: 1, opp: 80 },
  { id: 'SOL:B', coin: 'B', chain: 'Solana', pool: 'p2', signal: 'Watch', opp: 60, entryLow: 1, entryHigh: 2, stop: 1, tp1: 3 }, { id: 'SOL:C', pool: 'p3', signal: 'Watch', opp: 72, entryLow: 1, entryHigh: 2, stop: 1, tp1: 3 }];
const c = candidates(setups, [{ id: 'SOL:D', pool: 'p4', status: 'waiting for entry', entryLow: 1, entryHigh: 2, stop: 1, tp1: 3, signalAt: '2026-01-01T00:00:00Z' }]);
ok(c.length === 3 && c.find(x => x.pool === 'p1').entryHigh === 2 && !c.find(x => x.pool === 'p2'), 'candidates use pattern plan, skip weak watch, include waiting signals');
const px = await fetchPrices([{ chain: 'Solana', pool: 'P1' }], async u => ({ pairs: [{ pairAddress: 'P1', priceUsd: '0.5', liquidity: { usd: 90 }, txns: { h1: { buys: 5, sells: 2 }, m5: { buys: 1, sells: 0 } } }] }), async () => {});
ok(px.p1.price === 0.5, 'prices keyed by lower-case pool');
ok(Math.abs(windowLeftH(new Date(Date.now() - 12 * 3600e3).toISOString()) - 36) < 0.1, 'window left');
// realistic fills: filling at the top of the zone with slippage lowers R
const h1 = [[1000, 1, 1, 1, 1, 1], [1000 + 3600, 1, 1.1, 0.99, 1.05, 1], [1000 + 7200, 1.05, 1.31, 1.05, 1.3, 1]];
const sg = { signalAt: new Date(1000e3).toISOString(), entryLow: 0.98, entryHigh: 1, entryMid: 0.99, stop: 0.9, tp1: 1.1, tp2: 1.2, tp3: 1.3 };
const a = C.evaluate(sg, h1, 'x', {}), b = C.evaluate(sg, h1, 'x', { fillAt: 'high', slipPct: 1.5 });
ok(a.resultR != null && b.resultR != null && b.resultR < a.resultR, `realistic fill lowers R (${a.resultR} -> ${b.resultR})`);
ok(px.p1.liq === 90 && px.p1.h1b === 5 && px.p1.h1s === 2, 'flow and liquidity captured from DexScreener');
