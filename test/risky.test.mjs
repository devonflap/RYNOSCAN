// the risky bots (30 Oct): the scanner's two best paper books as bots, and the head council's ranking of the best setups found
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynorisky-');
import { cycle, newState, loadConfig, BOTS } from '../bot/run.mjs';
import { PROFILES } from '../docs/exits.mjs';
import { bestSetups, headCouncil } from '../docs/trackcouncil.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = 1800000000, iso = (t) => new Date(t * 1000).toISOString().slice(0, 19) + 'Z', log0 = console.log, quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = log0; } };
// the bots' exits are their paper books' exits, exactly
for (const [bot, book] of [['riskyclaude', 'riskyPick'], ['riskyryan', 'riskyRyan']]) { const c = loadConfig(bot), P = PROFILES[book];
  ok(BOTS[bot] && c.labOnly && c.realityBook === book && c.fixedStopPct === Math.round(P.stopPct * 100) && c.mults.join() === P.ladder.map((x) => x[0]).join() && c.shares.join() === P.ladder.map((x) => x[1]).join() && c.maxHoldH === P.maxHours && c.beAfterFirst === !!P.beAfterFirst && (P.trailPct ? c.moonTrail === P.trailPct : true) && !c.flowCut && !c.dumpCut && !c.peakGiveback && !c.noFollowH, `${bot}: the same stop, sales, trail, break-even rule and time limit as the ${book} paper book, and nothing else`); }
// through the bot: a runner list coin with 3 checks is bought once, $100, with its book's stop and targets
{ const cfg = { ...loadConfig('riskyclaude'), slipPct: 0 }, POOL = 'RiskyPool1111111111111111111111111111111111', TOK = 'RiskyMint111111111111111111111111111111pump'; let at = iso(T0), px = 1;
  const item = (passed, vetoed = []) => ({ pool: POOL, coin: 'RISK', chain: 'solana', token: TOK, tier: 'Runner', passed, vetoed, price: px, score: 70, m: { liq: 300000 }, checks: [{ k: 'Volume', ok: true, note: '5x' }] });
  let items = [item(3)]; const G = async (u) => (u.includes('runners.json') ? { at, items } : []);
  const pair = () => ({ chainId: 'solana', dexId: 'raydium', pairAddress: POOL, baseToken: { address: TOK, symbol: 'RISK' }, quoteToken: { symbol: 'USDC' }, priceUsd: String(px), liquidity: { usd: 300000 }, marketCap: 3e6, txns: { m5: { buys: 30, sells: 20 }, h1: { buys: 200, sells: 150 } }, volume: { h1: 80000 }, pairCreatedAt: (T0 - 20 * 86400) * 1000 });
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pair()])), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, secondOpinion: false });
  const st = newState(cfg); await quiet(() => cycle(st, cfg, deps(T0 + 60))); await quiet(() => cycle(st, cfg, deps(T0 + 120)));
  const p = st.positions[0]; ok(st.positions.length === 1 && Math.abs(p.costUsd - 100) < 1 && Math.abs(p.stop / p.entry - 0.82) < 0.01 && p.targets.length === 3 && Math.abs(p.targets[0] / p.entry - 1.4) < 0.01, 'a runner with 3 of 4 checks: bought once, $100, stop 18% under, sells at +40%, 2x and 3x');
  at = iso(T0 + 3600); await quiet(() => cycle(st, cfg, deps(T0 + 3700))); ok(st.positions.length === 1, 'the next scan names it again: not bought twice (one per coin a day)');
  const st2 = newState(cfg); items = [item(2)]; at = iso(T0 + 7200); await quiet(() => cycle(st2, cfg, deps(T0 + 7300))); await quiet(() => cycle(st2, cfg, deps(T0 + 7360))); items = [item(4, ['dev holds 30%'])]; at = iso(T0 + 10800); await quiet(() => cycle(st2, cfg, deps(T0 + 10900))); await quiet(() => cycle(st2, cfg, deps(T0 + 10960)));
  ok(!st2.positions.length, 'only 2 checks, or a risk rule: not bought');
  px = 1.45; await quiet(() => cycle(st, cfg, deps(T0 + 3800))); ok(st.positions[0].hits === 1 && st.positions[0].stop >= st.positions[0].entry, 'up 45%: a quarter sold and the stop moves to break-even (its book\'s rule)'); }
// the head council ranks the best paper setups and proposes a proven one with no bot
{ const books = [{ key: 'randomCtl', short: 'Random', n: 50, avgR: -0.2, lo: -0.5, hi: 0.1 }, { key: 'riskyPick', short: 'Risky · Claude', n: 21, avgR: 0.86, lo: -0.28, hi: 2.11 }, { key: 'riskyFront', short: 'Risky · front', n: 40, avgR: 0.5, lo: 0.1, hi: 0.9 }, { key: 'zone', short: 'Zone limit', n: 86, avgR: -0.3, lo: -0.4, hi: -0.2 }, { key: 'tiny', short: 'Tiny', n: 5, avgR: 3 }];
  const B = bestSetups(books, ['riskyclaude', 'riskyryan']); ok(B.map((b) => b.key).join() === 'riskyPick,riskyFront' && B[0].bot === 'riskyclaude' && !B[0].proven && B[1].proven && !B[1].bot, 'best setups: beating random only, 15+ trades, best first; Risky · Claude has a bot, Risky · front is proven (range clear of random over 30+) with none');
  const h = headCouncil({}, Date.now(), books); ok(h.proposals.some((p) => p.kind === 'bot candidate' && /Risky · front/.test(p.text)) && !h.proposals.some((p) => /Risky · Claude/.test(p.text)) && /Best setups found/.test(h.points[0]), 'the head council proposes the proven one as a bot, not the one a bot already trades, and lists them all'); }
process.exit(f);
