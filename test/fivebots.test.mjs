// One bot per track (25 Oct): base breakout + proven-wallet copies, the bottomed-out (Chill) bot and the best-of bot.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynofive-');
import { cycle, newState, loadConfig, BOTS } from '../bot/run.mjs';
import { rankWays, mirrorExit } from '../bot/bestof.mjs';
import { freshLevels } from '../src/bottoms.mjs';
import { regimeMap } from '../src/bottombt.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = 1800000000, iso = (t) => new Date(t * 1000).toISOString(), log0 = console.log, quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = log0; } };
const pairOf = ({ chain = 'solana', pool, token, sym, px, liq = 300000, quote = 'USDC' }) => ({ chainId: chain, dexId: 'raydium', pairAddress: pool, baseToken: { address: token, symbol: sym }, quoteToken: { symbol: quote }, priceUsd: String(px), liquidity: { usd: liq }, marketCap: 5e6, txns: { m5: { buys: 10, sells: 8 }, h1: { buys: 80, sells: 70 } }, volume: { h1: 50000, h24: 900000 }, pairCreatedAt: (T0 - 200 * 86400) * 1000, url: 'u' });

// 1. the runners track: one bot, two signals, each traded its own three ways
{ const c = loadConfig('basebreak'); ok(c.copy && c.variants.filter((v) => v.kinds[0] === 'base').map((v) => v.key).join() === 'H-hold,G-giveback,R-ride' && c.variants.filter((v) => v.kinds[0] === 'copy').map((v) => v.key).join() === 'CM-mirror,CT-24h,CL-ladder', 'base breakout + copies: base ways H/G/R, copy ways CM/CT/CL');
  const W = '0xf42b73d2e4d3912eade2a5f7ab39b54064c2acec', TK = '0x1111111111111111111111111111111111111111'; let items = [], px = 1;
  const tr = (side, t, tx) => ({ token: { address_hash: TK, symbol: 'GLOAM', type: 'ERC-20' }, from: { hash: side === 'buy' ? '0xpool' : W }, to: { hash: side === 'buy' ? W : '0xpool' }, timestamp: iso(t), transaction_hash: tx });
  const pair = () => pairOf({ chain: 'robinhood', pool: '0xPOOL', token: TK, sym: 'GLOAM', px, quote: 'WETH' });
  const G = async (u) => (u.includes('walletscore') ? { proven: [{ w: W, n: 11, wins: 6, copyPct: 18.5 }] } : u.includes('blockscout') ? { items } : u.includes('/tokens/') ? { pairs: [pair()] } : u.includes('runners.json') ? { items: [] } : u.includes('universe.json') ? [] : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pair()])), candles5: async () => null, candlesH: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, secondOpinion: false });
  const cfg = { ...c, slipPct: 0 }, st = newState(cfg); await quiet(() => cycle(st, cfg, deps(T0)));
  items = [tr('buy', T0 + 50, 'b1')]; await quiet(() => cycle(st, cfg, deps(T0 + 60))); await quiet(() => cycle(st, cfg, deps(T0 + 120)));
  ok(st.positions.map((p) => p.variant).sort().join() === 'CL-ladder,CM-mirror,CT-24h' && st.positions.every((p) => Math.abs(p.costUsd - 100) < 1), 'a proven wallet\'s fresh buy: three copy ways at $100 each, never the base-breakout ways');
  items = [tr('sell', T0 + 170, 's1'), ...items]; px = 1.1; await quiet(() => cycle(st, cfg, deps(T0 + 180))); await quiet(() => cycle(st, cfg, deps(T0 + 240)));
  ok(st.closed.some((p) => p.variant === 'CM-mirror' && /the wallet sold/.test(p.sells.at(-1).why)) && st.positions.length === 2, 'the wallet sells: the mirror copy is out with it, the other two stay'); }

// 2. the bottomed-out bot
{ const c = loadConfig('bottoms'); ok(BOTS.bottoms && c.labOnly && c.fixedStopPct === 40 && c.maxHoldH === 180 * 24 && c.regimeOut, 'the Chill bot: paper only, 40% stop, 180 days, sold on risk-off');
  const TOK = 'BoTTomMint1111111111111111111111111111111pump', POOL = 'BoTTomPool111111111111111111111111111111111'; let file = { at: iso(T0), riskOn: false, coins: [{ id: 'x', symbol: 'DIP', token: TOK, dd: 0.72, fresh: [0.7], mcap: 3e6, vol30: 80000 }] }, px = 0.01;
  const G = async (u) => (u.includes('bottoms.json') ? file : u.includes('/tokens/') ? { pairs: [pairOf({ pool: POOL, token: TOK, sym: 'DIP', px })] } : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pairOf({ pool: POOL, token: TOK, sym: 'DIP', px })])), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, secondOpinion: false });
  const cfg = { ...c, slipPct: 0 }, st = newState(cfg); await quiet(() => cycle(st, cfg, deps(T0 + 60))); await quiet(() => cycle(st, cfg, deps(T0 + 120)));
  ok(st.positions.length === 1 && Math.abs(st.positions[0].costUsd - 100) < 1 && Math.abs(st.positions[0].stop / st.positions[0].entry - 0.6) < 0.01, 'a coin newly 70% under its high: a $100 clip, stop 40% under');
  file = { ...file, at: iso(T0 + 86400), coins: [{ ...file.coins[0], dd: 0.81, fresh: [0.8] }] }; px = 0.0068; await quiet(() => cycle(st, cfg, deps(T0 + 86400 + 2000))); await quiet(() => cycle(st, cfg, deps(T0 + 86400 + 2100)));
  ok(st.positions.length === 2 && st.positions.every((p) => p.pool === POOL), 'it falls to -80%: a second clip on the same coin (the DCA adds, it is not "already held")');
  await quiet(() => cycle(st, cfg, deps(T0 + 86400 + 4000))); ok(st.positions.length === 2, 'risk-off from the start: the clips are held (they have not seen risk-on yet)');
  file = { ...file, at: iso(T0 + 3 * 86400), riskOn: true, coins: [] }; px = 0.009; await quiet(() => cycle(st, cfg, deps(T0 + 3 * 86400 + 2000))); ok(st.positions.length === 2, 'risk-on: still held');
  file = { ...file, at: iso(T0 + 9 * 86400), riskOn: false }; await quiet(() => cycle(st, cfg, deps(T0 + 9 * 86400 + 2000)));
  ok(!st.positions.length && st.closed.length === 2 && st.closed.every((p) => /risk-off/.test(p.sells.at(-1).why)), 'back to risk-off after a risk-on spell: both clips sold');
  file = { ...file, at: iso(T0), coins: [{ id: 'y', symbol: 'OLD', token: 'Old1111111111111111111111111111111111111pump', dd: 0.9, fresh: [0.9] }] }; const st2 = newState(cfg); await quiet(() => cycle(st2, cfg, deps(T0 + 5 * 86400))); ok(!Object.keys(st2.setups).length, 'a list more than 3 days old: no buys (the daily job did not run)');
  // the daily list: a level counts the day it is first reached, with the backtest's own filters
  const D = 86400, sol = Array.from({ length: 400 }, (_, i) => [T0 - (400 - i) * D, 100 + i * 0.1]), reg = regimeMap(sol), mk = (fn) => Array.from({ length: 300 }, (_, i) => [T0 - (300 - i) * D, fn(i), 100000, 5e6]);
  const fresh = freshLevels(mk((i) => (i < 200 ? 1 : i < 297 ? 0.5 : 0.28)), reg), old = freshLevels(mk((i) => (i < 200 ? 1 : 0.28)), reg), small = freshLevels(mk((i) => (i < 200 ? 1 : i < 297 ? 0.5 : 0.28)).map((r) => [r[0], r[1], r[2], 5e5]), reg);
  ok(fresh && fresh.fresh.join() === '0.7' && !old && !small, 'the daily list: -70% reached in the last 3 days counts; reached months ago does not; under $1m market cap never'); }

// 3. the best-of bot
{ const c = loadConfig('bestof'); ok(BOTS.bestof && c.labOnly && c.best.minN === 15, 'the best-of bot: paper only, a way must earn it over 15+ trades');
  const tr = (variant, pnl, d) => ({ id: variant + d, variant, costUsd: 100, pnl, closedAt: iso(T0 - (40 - d) * 3600) });
  const R = rankWays({ basebreak: { closed: [] }, trench: { closed: [...Array.from({ length: 16 }, (_, d) => tr('-', d < 8 ? 10 : 5, d))] }, trenchbonus: { closed: Array.from({ length: 16 }, (_, d) => tr('-', d < 8 ? 30 : -10, d)) } });
  const get = (b, v) => R.find((x) => x.bot === b && x.variant === v);
  ok(get('trench', '-').ok && !get('trenchbonus', '-').ok && get('basebreak', 'H-hold').ok, 'earned on both halves: in; up overall but losing in the newer half: out; the base breakout held a week stands in on the backtest\'s word');
  const TOK = 'BestMint11111111111111111111111111111111pump', POOL = 'BestPool1111111111111111111111111111111111'; let px = 1;
  const src = { trench: { positions: [], closed: Array.from({ length: 16 }, (_, d) => tr('-', 10, d)) }, trenchbonus: { positions: [], closed: [] }, basebreak: { positions: [], closed: [] }, breakout: null, bottoms: null };
  const deps = (sec) => ({ now: sec * 1000, getJson: async () => [], readState: (b) => (src[b] ? JSON.parse(JSON.stringify(src[b])) : null), quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pairOf({ pool: POOL, token: TOK, sym: 'BEST', px })])), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, secondOpinion: false });
  const cfg = { ...c, slipPct: 0 }, st = newState(cfg);
  src.trench.positions = [{ id: 'old1', pool: 'OldPool', coin: 'OLD', chain: 'solana', entry: 1, stop: 0.75, units: 100, remUnits: 100, openedAt: iso(T0 - 30) }];
  await quiet(() => cycle(st, cfg, deps(T0))); ok(!st.positions.length && !Object.keys(st.setups).length, 'first look: what the other bots already held is not copied');
  src.trench.positions.push({ id: 'p1', pool: POOL, coin: 'BEST', chain: 'solana', token: TOK, entry: 1, stop: 0.75, units: 100, remUnits: 100, openedAt: iso(T0 + 50) });
  src.trenchbonus.positions = [{ id: 'q1', pool: 'Other111', coin: 'NOPE', chain: 'solana', entry: 1, stop: 0.75, units: 100, remUnits: 100, openedAt: iso(T0 + 50) }];
  await quiet(() => cycle(st, cfg, deps(T0 + 60))); await quiet(() => cycle(st, cfg, deps(T0 + 75)));
  ok(st.positions.length === 1 && st.positions[0].pool === POOL && st.positions[0].meta.mirrorOf.bot === 'trench' && Math.abs(st.positions[0].costUsd - 100) < 1, 'an earned way buys: copied at $100; a way that has not earned it: not copied');
  src.trench.positions[1].remUnits = 50; px = 1.5; await quiet(() => cycle(st, cfg, deps(T0 + 90)));
  ok(Math.abs(st.positions[0].remUnits / st.positions[0].units - 0.5) < 0.01, 'the copied bot sells half: the copy sells the same share');
  src.trench.closed.push({ ...src.trench.positions[1], sells: [{ why: 'TP2' }] }); src.trench.positions.splice(1, 1); await quiet(() => cycle(st, cfg, deps(T0 + 105)));
  ok(!st.positions.length && st.closed.length === 1 && /trench - sold BEST \(TP2\)/.test(st.closed[0].sells.at(-1).why) && st.closed[0].pnl > 0, 'the copied bot sells the rest: the copy is out too');
  ok(mirrorExit({ meta: {} }, {}) === null, 'a position that copies nobody is left alone'); }
process.exit(f);
