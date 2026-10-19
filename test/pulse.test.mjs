// Early-move checker on DexScreener pair data.
import { pulseScore, pulseScan, updatePulse } from '../src/pulse.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const pair = (o = {}) => ({ pairAddress: o.addr || 'P1', priceUsd: '0.01', url: 'https://dexscreener.com/solana/p1', liquidity: { usd: o.liq ?? 120000 }, volume: { m5: o.m5v ?? 12000, h1: o.h1v ?? 40000, h6: o.h6v ?? 90000, h24: o.h24v ?? 400000 },
  priceChange: { m5: o.m5 ?? 3, h1: o.h1 ?? 12, h24: o.h24 ?? 40 }, txns: { m5: { buys: o.b ?? 30, sells: o.s ?? 10 } }, ...(o.boost ? { boosts: { active: 5 } } : {}) });
ok(pulseScore(pair()) && pulseScore(pair()).acc5 >= 3, 'volume running hot, price turning up, buyers leading: a hit');
ok(pulseScore(pair({ m5v: 3000 })) === null, '5-minute volume not hot: no hit');
ok(pulseScore(pair({ h1: 120 })) === null, 'already vertical in the hour: never chase');
ok(pulseScore(pair({ b: 10, s: 12 })) === null, 'sellers leading: no hit');
ok(pulseScore(pair({ boost: true })) === null, 'paid boost: skipped');
ok(pulseScore(pair({ liq: 20000 })) === null, 'thin liquidity: skipped');
{ const calls = []; const hits = await pulseScan([{ pool: 'P1', net: 'solana', chain: 'solana', sym: 'AAA', id: 'SOL:AAA' }, { pool: 'P2', net: 'solana', chain: 'solana', sym: 'BBB', id: 'SOL:BBB' }],
    async (u) => { calls.push(u); return { pairs: [pair(), pair({ addr: 'P2', m5v: 100 })] }; }, async () => {});
  ok(calls.length === 1 && calls[0].includes('/pairs/solana/P1,P2') && hits.length === 1 && hits[0].coin === 'AAA', 'one batched call per 30 coins, hits keep the coin name'); }
{ const now = Date.parse('2026-10-19T10:00:00Z'), h = [{ pool: 'P1', coin: 'AAA', score: 50, why: [] }];
  const a = updatePulse(null, h, now), b = updatePulse(a, h, now + 30 * 60e3), c = updatePulse(b, h, now + 7 * 3600e3);
  ok(a.fresh.length === 1 && b.fresh.length === 0 && c.fresh.length === 1, 'one signal per coin per 6 hours'); ok(c.recent.length === 2 && a.items.length === 1, 'recent hits kept for the scan to turn into paper trades'); }
// hourly decisions: DexScreener readings recorded on the coin and the signal, and sliced by the learning loop
{ const C = await import('../docs/core.mjs'), { FEATS, rowToSig } = await import('../docs/features.mjs');
  const row = { net: 'solana', pool: 'P1', opp: 70, v24: 400000 };
  await C.crossCheck([row], { getJson: async () => ({ pairs: [{ ...pair(), txns: { h1: { buys: 60, sells: 30 }, m5: { buys: 30, sells: 10 } }, volume: { m5: 12000, h1: 40000, h6: 90000, h24: 400000 } }] }), sleep: async () => {} });
  ok(row.dsx && row.dsx.acc1 === 2.67 && row.dsx.br1 === 2 && row.dsx.ch5 === 3, 'hourly cross-check records the last-hour pace and buyer lead');
  const F = (name) => FEATS.find((x) => x[0] === name)[1];
  ok(F('Last-hour volume pace (DexScreener)')({ acc1: 2.67 }) === 'picking up (1.5-3x)' && F('Buyers vs sellers (last hour)')({ br1: 2 }) === 'buyers lead' && F('Early pulse before the call')({ pulse: true }) === 'flagged in the 6 hours before' && F('Early pulse before the call')({}) === null, 'learning loop buckets for the new readings (unknown stays unknown)');
  const sg = rowToSig({ dsx: row.dsx, pulse: false }); ok(sg.acc1 === 2.67 && sg.br1 === 2 && sg.pulse === false, 'live rows map to the same features'); }
process.exit(f);
