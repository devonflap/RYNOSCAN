// One bot per track (25 Oct): base breakout + proven-wallet copies, the bottomed-out (Chill) bot and the best-of bot.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynofive-');
import { cycle, newState, loadConfig, BOTS } from '../bot/run.mjs';
import { buildRulebook, activeRulebook, rulebookLines } from '../docs/bestrules.mjs';
import { freshLevels } from '../src/bottoms.mjs';
import { regimeMap } from '../src/bottombt.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = 1800000000, iso = (t) => new Date(t * 1000).toISOString(), log0 = console.log, quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = log0; } };
const pairOf = ({ chain = 'solana', pool, token, sym, px, liq = 300000, quote = 'USDC' }) => ({ chainId: chain, dexId: 'raydium', pairAddress: pool, baseToken: { address: token, symbol: sym }, quoteToken: { symbol: quote }, priceUsd: String(px), liquidity: { usd: liq }, marketCap: 5e6, txns: { m5: { buys: 10, sells: 8 }, h1: { buys: 80, sells: 70 } }, volume: { h1: 50000, h24: 900000 }, pairCreatedAt: (T0 - 200 * 86400) * 1000, url: 'u' });

// 1. the runners track: one bot, two signals, each traded its own three ways
{ const c0 = loadConfig('basebreak'); ok(!c0.copy && c0.variants.map((v) => v.key).join() === 'H-hold,G-giveback,R-ride', 'base breakout trades base breakouts only (29 Oct: the copy signal retired; its machinery is still tested below, switched on by hand)');
  const { COPY } = await import('../bot/copy.mjs'), c = { ...c0, copy: COPY, variants: [...c0.variants, { key: 'CM-mirror', kinds: ['copy'], mirror: true, mults: [], shares: [] }, { key: 'CT-24h', kinds: ['copy'], mults: [], shares: [], fixedStopPct: 30, maxHoldH: 24 }, { key: 'CL-ladder', kinds: ['copy'], mults: [2], shares: [0.5], freeRide: true }] };
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

// 3. the best-of bot: its own rulebook, from everything found so far
{ const c = loadConfig('bestof'); ok(BOTS.bestof && c.labOnly && c.source === 'bestof', 'the best-of bot: paper only, trades its own rulebook');
  const combo = (n, avg, older, newer, exBest = avg - 3, oldX = older - 3, newX = newer - 3, med = -12) => ({ n, avg, exBest, med, olderAvg: older, newerAvg: newer, olderExBest: oldX, newerExBest: newX, holds: older > 0 && newer > 0, holdsTrim: oldX > 0 && newX > 0 });
  const fwdCombos = { 'box24 ≤60% vol1.5x / hold7': combo(428, 16.8, 5.6, 28.5), 'box24 ≤60% vol2.5x / giveback': combo(370, 22.8, -2.7, 45.2), 'box12 ≤60% vol2.5x / hold7': combo(557, 16.4, 4.5, 29.3), 'box12 ≤30% vol1.5x / trail20': combo(300, 30, 10, 12), 'box12 ≤60% vol2.5x / giveback': combo(572, 17.1, 4.2, 31.3), 'box48 ≤60% vol1.5x / hold7': combo(200, 9, 8, 7, 8.5, 7.5, 6.5), 'random / hold7': combo(400, 8, 8, 8, 7.9), 'random / giveback': combo(400, 1, 1, 1, 0.8) };
  const runnerBt = { at: '2026-10-25T00:00:00Z', universe: { combos: { 'box24 ≤60% vol1.5x / hold7': combo(428, 60, 50, 70) }, best: [{ combo: 'box24 ≤60% vol1.5x / hold7', ...combo(428, 60, 50, 70) }], forward: { pools: 40, combos: fwdCombos, best: [] } } };
  const bottomBt = { at: '2026-10-25T00:00:00Z', combos: { 'dca / riskoff': combo(300, 8.5, 16.6, -7.1) }, best: [{ combo: 'dca / riskoff', avg: 8.5, olderAvg: 16.6, newerAvg: -7.1 }] };
  const council = { books: [{ key: 'randomCtl', short: 'Random', n: 26, avgR: -0.04 }, { key: 'zone', short: 'Zone limit', n: 55, avgR: -0.16, lo: -0.22 }] };
  const B = buildRulebook({ council, runnerBt, bottomBt, now: Date.parse('2026-10-25T06:00:00Z') });
  ok(B.entries.length === 1 && B.entries[0].combo === 'box48 ≤60% vol1.5x / hold7' && B.entries[0].boxH === 48 && B.entries[0].volX === 1.5 && B.entries[0].exit.maxHoldH === 168, 'the rulebook takes, from the FORWARD book only, the combination with the best worse half once each half\'s best trade is taken out (a steady +7% beats a +28% half that one coin carried; the lookback +60% is ignored; the giveback with a losing half and the untradeable trail20 are out)');
  ok(!B.entries.some((e) => e.type === 'dca') && B.looked.some((l) => /None beats random/.test(l)) && B.looked.some((l) => /survivorship/.test(l)), 'nothing that failed a half gets in (the DCA), no scanner book that loses to random, and the lookback book is named as survivorship');
  const noFwd = buildRulebook({ runnerBt: { at: runnerBt.at, universe: { combos: runnerBt.universe.combos, best: runnerBt.universe.best } } }); ok(!noFwd.entries.length && noFwd.looked.some((l) => /no forward book yet/.test(l)), 'a backtest without a forward book puts nothing in the rulebook');
  const veto = buildRulebook({ runnerBt, botRecs: { basebreak: { closed: Array.from({ length: 30 }, (_, d) => ({ variant: 'H-hold', costUsd: 100, pnl: -10, closedAt: iso(T0 + d * 3600) })) } } });
  ok(veto.entries[0].combo === 'box12 ≤60% vol2.5x / giveback', 'a way losing on both halves over 30+ live trades (the hold) is kept out, whatever its backtest said: the next best exit takes its place');
  const first = activeRulebook(null, B, null, { bootstrap: true }), waiting = activeRulebook(null, B), changed = activeRulebook({ active: first.active }, noFwd), stale = activeRulebook({ active: { ...first.active, since: '2026-10-25T06:00:00Z' } }, noFwd, { version: noFwd.version, at: '2026-10-25T05:00:00Z' }), approved = activeRulebook({ active: { ...first.active, since: '2026-10-25T06:00:00Z' } }, noFwd, { version: noFwd.version, at: '2026-10-26T05:00:00Z' });
  ok(first.active.version === B.version && !waiting.active.entries.length && waiting.differs && changed.active.version === B.version && changed.differs && stale.active.version === B.version && approved.active.version === noFwd.version && !approved.differs, 'with no earlier rulebook the bot waits for a yes (only the very first build went straight in); a change waits as a proposal; a yes dated before the active one took force does not count; a later yes does');
  ok(rulebookLines(changed).lines.some((l) => /needs Ryan's yes/.test(l)), 'the Councils tab shows the waiting change');
  // the bot trades it: a base breakout under the rulebook's settings, opened with the rulebook's exits
  const POOL = 'BasePool11111111111111111111111111111111111', TOK = 'BaseMint1111111111111111111111111111111pump', now0 = T0 + 3600 * 5 + 200, hr = Math.floor(now0 / 3600) * 3600;
  const bars = [...Array.from({ length: 26 }, (_, k) => [hr - (27 - k) * 3600, 1, 1.05, 0.95, 1, 100]), [hr - 3600, 1, 1.22, 1, 1.2, 400]];
  const file = { active: { ...first.active, entries: [{ ...first.active.entries[0], boxH: 24, exit: { mults: [2, 4], shares: [1 / 3, 1 / 3], moonTrail: 0.5, maxHoldH: 168 } }] } };
  const G = async (u) => (u.includes('bestof-rules.json') ? file : u.includes('universe.json') ? [{ pool: POOL, chain: 'solana', sym: 'BASE' }] : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pairOf({ pool: POOL, token: TOK, sym: 'BASE', px: 1.21 })])), candlesH: async () => bars, candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, secondOpinion: false });
  const cfg = { ...c, slipPct: 0 }, st = newState(cfg); for (const t of [now0, now0 + 60, now0 + 120]) await quiet(() => cycle(st, cfg, deps(t)));
  const p = st.positions[0]; ok(p && p.pool === POOL && p.vcfg && p.vcfg.moonTrail === 0.5 && p.targets.length === 2 && p.meta.rule === first.active.version && Math.abs(p.costUsd - 100) < 1, 'a breakout under the rulebook: bought $100, with that rulebook\'s exits (kept even if the rulebook later changes)'); }
process.exit(f);
