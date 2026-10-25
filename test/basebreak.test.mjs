// the base-breakout bot (25 Oct): the detector on hourly candles, and three ways on a breakout through the real cycle
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynobase-');
import { baseBreakSetup, BASE } from '../bot/setups.mjs';
import { cycle, newState, loadConfig } from '../bot/run.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const H = 3600, T0 = 1800000000, bar = (i, o, h, l, c, v = 100) => [T0 + i * H, o, h, l, c, v];
const base = () => { const B = []; for (let i = 0; i < 30; i++) B.push(bar(i, 1.05, 1.1, 1.0, 1.05)); return B; }, now = T0 + 31 * H + 120;
const B = [...base(), bar(30, 1.05, 1.22, 1.04, 1.2, 300)];
const r = baseBreakSetup(B, { priceUsd: '1.21' }, now); ok(r && r.price === 1.21 && Math.abs(r.stop - 0.98) < 1e-9 && r.rangePct === 10 && r.volX === 3, 'a 24h base (1.00-1.10) broken on a close of 1.20 on 3x volume: bought at 1.21, stop under the base at 0.98');
ok(baseBreakSetup([...base(), bar(30, 1.05, 1.22, 1.04, 1.2, 120)], { priceUsd: '1.21' }, now) === null, 'the same close on ordinary volume: no breakout');
ok(baseBreakSetup([...base(), bar(30, 1.05, 1.12, 1.04, 1.08, 300)], { priceUsd: '1.08' }, now) === null, 'a big-volume hour that does not close above the base: nothing');
ok(/no chasing/.test(baseBreakSetup(B, { priceUsd: '1.4' }, now).dead), 'already 17% past the breakout close: not chased');
const tall = []; for (let i = 0; i < 30; i++) tall.push(bar(i, 1, i % 2 ? 2 : 1.1, 0.9, 1)); ok(baseBreakSetup([...tall, bar(30, 1, 2.2, 1, 2.1, 300)], { priceUsd: '2.1' }, now) === null, 'a "base" 120% tall is not a base');
ok(baseBreakSetup([...B, bar(31, 1.2, 1.25, 1.15, 1.22)], { priceUsd: '1.21' }, now) && baseBreakSetup(B, { priceUsd: '1.21' }, T0 + 30 * H + 600) === null, 'the breakout candle must have closed: still forming, nothing yet');
// through the bot
{ const cfg = { ...loadConfig('basebreak'), slipPct: 0 }, pool = '0xPOOL'; let px = 1.21;
  const pair = () => ({ chainId: 'robinhood', dexId: 'uniswap', pairAddress: pool, baseToken: { address: '0xTOKEN', symbol: 'BTC' }, quoteToken: { symbol: 'WETH' }, priceUsd: String(px), liquidity: { usd: 300000 }, marketCap: 3e6, txns: { m5: { buys: 30, sells: 20 }, h1: { buys: 200, sells: 150 } }, volume: { h1: 80000 }, pairCreatedAt: (T0 - 20 * 86400) * 1000 });
  const G = async (u) => (u.includes('runners.json') ? { items: [{ pool, chain: 'Robinhood', coin: 'BTC', tier: 'Runner', passed: 3, vetoed: [] }] } : u.includes('universe.json') ? [] : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pair()])), candlesH: async () => B, candles5: async () => null, secondOpinion: false, notify: async () => {}, journal: () => {}, heartbeat: async () => {} }), log0 = console.log;
  const st = newState(cfg); console.log = () => {}; await cycle(st, cfg, deps(now)); await cycle(st, cfg, deps(now + 60)); console.log = log0;
  ok(st.positions.map((p) => p.variant).sort().join() === 'G-giveback,H-hold,R-ride' && st.positions.every((p) => Math.abs(p.costUsd - 100) < 1 && Math.abs(p.stop - 0.98) < 0.01), 'BTC breaks its base: bought three ways, $100 each, the stop under the base');
  px = 2.5; console.log = () => {}; await cycle(st, cfg, deps(now + 3600)); console.log = log0; const R = st.positions.find((p) => p.variant === 'R-ride'); ok(R && R.hits === 1 && R.free && st.positions.find((p) => p.variant === 'H-hold').hits === 0, 'at 2x the ride sells half and rides free; the hold keeps holding'); }
// every coin on the list is read once per closed hour, in turn (25 Oct review: a cleanup line wiped the hour stamps every cycle, so the
// same 12 coins were re-read every minute and the rest never)
{ const cfg = { ...loadConfig('basebreak'), slipPct: 0, scanPerCycle: 12 }, pools = Array.from({ length: 30 }, (_, i) => 'P' + i), reads = {}, flat = base();
  const pair = (p) => ({ chainId: 'solana', pairAddress: p, baseToken: { address: 'T' + p, symbol: p }, quoteToken: { symbol: 'SOL' }, priceUsd: '1.05', priceNative: '0.01', liquidity: { usd: 300000 }, marketCap: 3e6, txns: { m5: { buys: 30, sells: 20 }, h1: { buys: 200, sells: 150 } }, volume: { h1: 80000 }, pairCreatedAt: (T0 - 20 * 86400) * 1000 });
  const G = async (u) => (u.includes('runners.json') ? { items: [] } : u.includes('universe.json') ? pools.map((p) => ({ pool: p, chain: 'solana', sym: p })) : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pair(i.pool)])), candlesH: async (c, p) => { reads[p] = (reads[p] || 0) + 1; return p === 'P0' ? null : flat; }, candles5: async () => null, secondOpinion: false, notify: async () => {}, journal: () => {}, heartbeat: async () => {} }), log0 = console.log;
  const st = newState(cfg); console.log = () => {}; for (let k = 0; k < 5; k++) await cycle(st, cfg, deps(now + k * 60)); console.log = log0;
  const n = Object.values(reads); ok(n.length === 30 && n.every((x) => x === 1), `30 coins, 12 a minute: all 30 read within the hour, each once (${n.length} read, max ${Math.max(...n)} times)`);
  console.log = () => {}; await cycle(st, cfg, deps(now + 3600 + 60)); console.log = log0; ok(reads.P0 === 2 && reads.P1 === 2 && reads.P29 === 1, 'the next hour: read again, the coin with no candles first (one try an hour), the least recently read next'); }
process.exit(f);
