// The three new bots: Runner (Ryan's ladder + seller cut on the scanner's runners), Range (the Monday-range trade on yesterday's range)
// and Ignition (the Ignition Rider on meme coins with momentum exits and a moonbag). Candles are made up; nothing touches the network.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynobots4-');
import { rangeSetup, ignitionSetup, runnerSetups, swings, runnerWhyNot, riderSetup, RUN, RIDER } from '../bot/setups.mjs';
import { trenchFeed, trenchSetup, quoteFor, trenchSetupsIn, TRENCH } from '../bot/trench.mjs';
import { missedSummary } from '../bot/desk.mjs';
import { missedReview, labVariants, council } from '../docs/council.mjs';
import { studyChart, summarise } from '../src/giants.mjs';
import { manageMomentum, openMomentum, manageLadder, openLadder, structureStop, decidePullback, decideMinute, manageMinute, BOT } from '../bot/manage.mjs';
import { cycle, newState, loadConfig, BOTS, RETIRED } from '../bot/run.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const DAY = Date.parse('2026-10-22T00:00:00Z') / 1000, H = 3600, iso = (s) => new Date(s * 1000).toISOString().slice(0, 19) + 'Z';
const bar = (t, o, h, l, c, v = 100) => [t, o, h, l, c, v];

// ---- range: yesterday 1.00-1.20, today sweeps to 0.97, closes back at 1.03, 15m structure break, order block 1.00-1.02, target 1.20
{ const y = []; for (let i = 0; i < 24; i++) y.push(bar(DAY - 86400 + i * H, 1.05, i === 10 ? 1.2 : 1.1, i === 4 ? 1.0 : 1.02, 1.08));
  const today = [bar(DAY, 1.05, 1.06, 0.97, 0.99), bar(DAY + H, 0.99, 1.04, 0.98, 1.03), bar(DAY + 2 * H, 1.03, 1.05, 1.0, 1.04)];
  const b1h = [...y, ...today], now = DAY + 3 * H + 600;
  // 15-minute bars after the sweep: drift down (swing high 1.01 on the way), the low 0.95, a red candle 1.00->0.96 (the order block), then a break above 1.01
  const t15 = DAY + 900, m = [bar(t15, 1.0, 1.005, 0.99, 1.0), bar(t15 + 900, 1.0, 1.01, 0.995, 1.005), bar(t15 + 1800, 1.005, 1.0, 0.985, 0.99), bar(t15 + 2700, 0.99, 0.995, 0.95, 0.96), bar(t15 + 3600, 0.96, 0.99, 0.958, 0.985), bar(t15 + 4500, 1.0, 1.0, 0.955, 0.96), bar(t15 + 5400, 0.96, 1.02, 0.958, 1.015), bar(t15 + 6300, 1.015, 1.03, 1.01, 1.025), bar(t15 + 7200, 1.025, 1.04, 1.02, 1.03)];
  const pre = rangeSetup(b1h, null, now); ok(pre && pre.need15 && pre.rangeLo === 1.0 && pre.rangeHi === 1.2, 'hourly part: yesterday\'s range, a sweep of its low and a close back inside: asks for 15-minute candles');
  const r = rangeSetup(b1h, m, now); ok(r && !r.dead && r.zoneHigh === 1.0 && r.zoneLow === 0.96 && r.tp1 === 1.2 && r.rr > 3 && r.rr < 8, `order block 0.96-1.00, stop under its body, target the range high, ${r && r.rr}R`);
  ok(r.discount === false && /not in discount/.test(rangeSetup(b1h, m, now, { rrMin: 3, rrMax: 8, discount: true }).dead), 'this order block sits above the midpoint of the low-to-break range: taken by default, refused when the discount rule is on');
  const noSweep = [...y, bar(DAY, 1.05, 1.06, 1.01, 1.03)]; ok(rangeSetup(noSweep, m, DAY + H + 600) === null, 'no sweep of the low: no setup');
  const noBack = [...y, bar(DAY, 1.05, 1.06, 0.97, 0.98)]; ok(rangeSetup(noBack, m, DAY + H + 600) === null, 'swept but not closed back inside: no setup');
  const far = rangeSetup(b1h.map((b) => b[0] >= DAY - 86400 && b[0] < DAY ? [b[0], b[1], Math.max(b[2], 1.6), b[3], b[4], b[5]] : b), m, now); ok(far && /over 8R/.test(far.dead), 'a range high too far away (over 8R): refused');
  const near = rangeSetup(b1h.map((b) => b[0] >= DAY - 86400 && b[0] < DAY ? [b[0], b[1], Math.min(b[2], 1.03), b[3], b[4], b[5]] : b), m, now); ok(near && /under 3R/.test(near.dead), 'a range high too close (under 3R): refused');
  ok(swings([bar(0, 1, 1, 1, 1), bar(1, 1, 2, 0.5, 1), bar(2, 1, 1, 1, 1)]).hi[0] === 1 && swings([bar(0, 1, 1, 1, 1), bar(1, 1, 2, 0.5, 1), bar(2, 1, 1, 1, 1)]).lo[0] === 1, '3-bar swings');
  // one-target ladder: everything out at the range high; cancelled below the stop before the fill (decideLimit, tested in breakout.test)
  const pos = openLadder({ pool: 'p', coin: 'X', chain: 'Solana', tp1: 1.2 }, { price: 1.0, stop: 0.985 }, 300, iso(now), { slipPct: 0 }, 0); ok(pos.targets.length === 1, 'one target');
  const a = manageLadder(pos, { priceUsd: '1.21' }, now + H, { slipPct: 0, maxHoldH: 48 }); ok(a.actions.length === 1 && a.actions[0].all && /TP1: the rest/.test(a.actions[0].why), 'at the range high: everything out'); }

// ---- ignition: 49 quiet hours then an hourly close +8% on 15x the median volume, buyers leading
{ const bars = []; for (let i = 0; i < 49; i++) bars.push(bar(DAY + i * H, 1.0, 1.01, 0.99, 1.0, 100 + (i % 5))); bars.push(bar(DAY + 49 * H, 1.0, 1.1, 0.995, 1.08, 1500)); const now = DAY + 50 * H + 30;
  const q = { priceUsd: '1.08', txns: { h1: { buys: 60, sells: 30 } }, priceChange: { h24: 12 }, liquidity: { usd: 200000 } };
  const r = ignitionSetup(bars, q, now); ok(r && !r.dead && r.zoneHigh === 1.08 && r.stop === 0.995 && r.volX > 14 && r.retPct === 8, 'ignition candle found: buy at the close, stop at the candle\'s low');
  ok(ignitionSetup(bars, { ...q, txns: { h1: { buys: 20, sells: 30 } } }, now).dead, 'sellers leading the hour: refused');
  ok(/too late/.test(ignitionSetup(bars, { ...q, priceChange: { h24: 400 } }, now).dead), 'already up 400% in a day: too late to be early');
  ok(ignitionSetup(bars.map((b, i) => (i === 49 ? [b[0], b[1], b[2], b[3], b[4], 400] : b)), q, now) === null, 'only 4x the usual volume: no ignition');
  ok(ignitionSetup(bars, q, DAY + 49 * H + 600) === null, 'the candle is still forming: wait for the close');
  ok(ignitionSetup(bars.slice(30), q, now) === null, 'under 48 hours of history: no read on the usual volume');
  // momentum exits
  const cfg = { slipPct: 0 }, pos0 = openMomentum({ pool: 'p', coin: 'X', chain: 'Solana', trigVol: 1500 }, { price: 1.08, stop: 0.995 }, 500, iso(now), cfg, 0);
  ok(pos0.mode === 'momentum' && !pos0.cashed && pos0.stop === 0.995, 'opened with the trigger low as the stop');
  let r1 = manageMomentum(pos0, { priceUsd: '0.99' }, null, now + H, cfg); ok(r1.actions.length === 1 && r1.actions[0].all && /trigger candle/.test(r1.actions[0].why), 'under the trigger low: all out');
  let p = pos0; r1 = manageMomentum(p, { priceUsd: '1.2' }, null, now + H, cfg); p = r1.pos; ok(r1.actions.length === 0 && p.stop === 0.995, 'up 11%: not armed yet, stop stays at the trigger low');
  r1 = manageMomentum(p, { priceUsd: '1.5' }, null, now + 2 * H, cfg); p = r1.pos; ok(r1.actions.length === 0 && Math.abs(p.stop - 1.125) < 1e-6, 'up 39%: armed, the trail sits 25% under the high');
  r1 = manageMomentum(p, { priceUsd: '2.0' }, null, now + 3 * H, cfg); p = r1.pos; ok(Math.abs(p.stop - 1.5) < 1e-6, 'the trail follows the high');
  r1 = manageMomentum(p, { priceUsd: '1.49' }, null, now + 4 * H, cfg); p = r1.pos; ok(r1.actions.length === 1 && !r1.actions[0].all && Math.abs(r1.actions[0].units - pos0.units * 0.9) < 1e-9 && /90% out/.test(r1.actions[0].why) && p.cashed && p.stop === 0, 'trail hit: 90% out, the moonbag stays with no stop');
  r1 = manageMomentum(p, { priceUsd: '3.0' }, null, now + 5 * H, cfg); p = r1.pos; r1 = manageMomentum(p, { priceUsd: '1.6' }, null, now + 6 * H, cfg); p = r1.pos; ok(r1.actions.length === 1 && r1.actions[0].all && /moonbag trail/.test(r1.actions[0].why), 'moonbag: 45% off its high and it is sold');
  // the faded-hour exit while in profit (red hour on a third of the ignition volume), and the no-run time limit
  let p2 = manageMomentum(pos0, { priceUsd: '1.15' }, null, now + H, cfg).pos; const fade = manageMomentum(p2, { priceUsd: '1.15' }, [bar(now + 2 * H - 3600, 1.17, 1.18, 1.14, 1.15, 400)], now + 2 * H + 10, cfg);
  ok(fade.actions.length === 1 && /volume faded/.test(fade.actions[0].why) && fade.pos.cashed, 'a red hour on 27% of the ignition volume while in profit: 90% out');
  const flat = manageMomentum(pos0, { priceUsd: '1.09' }, null, now + 49 * H, cfg); ok(flat.actions.length === 1 && flat.actions[0].all && /48 hours/.test(flat.actions[0].why), 'nothing happened in 48 hours: out'); }

// ---- runner: the scanner's runners list, 3 of 4 checks, no risk rule, two a scan; Ryan's ladder with the seller cut
{ const items = [{ coin: 'A', chain: 'Solana', pool: 'a', price: 1, passed: 4, vetoed: [], score: 80, m: { liq: 300000 }, checks: [{ k: 'Volume surge', ok: true, note: '3x' }] }, { coin: 'B', chain: 'Solana', pool: 'b', price: 2, passed: 3, vetoed: [], score: 70, m: { liq: 150000 }, checks: [] }, { coin: 'C', chain: 'Solana', pool: 'c', price: 3, passed: 3, vetoed: [], score: 60, m: { liq: 150000 }, checks: [] }, { coin: 'D', chain: 'Solana', pool: 'd', price: 1, passed: 4, vetoed: ['wallets selling'], score: 90, m: { liq: 300000 }, checks: [] }, { coin: 'E', chain: 'Solana', pool: 'e', price: 1, passed: 2, vetoed: [], score: 95, m: { liq: 300000 }, checks: [] }];
  const r = runnerSetups(items); ok(r.length === 2 && r[0].coin === 'A' && r[1].coin === 'B', 'top two by score among 3-of-4 passers with no risk rule; vetoed and 2-of-4 left out');
  const cfg = { ...loadConfig('lab'), peakGiveback: null, dumpCut: null, variants: null }; ok(cfg.fixedStopPct === 20 && cfg.mults.join() === '1.5,2,2.5,3,4' && cfg.shares.join() === '0.2,0.2,0.2,0.2,0.1' && cfg.flowCut && cfg.beAfterFirst === false && cfg.moonTrail === 0.45, "Ryan's clips (the lab's base case): stop 20%, 20% out at +50/+100/+150/+200%, 10% at +300%, a 10% moonbag trailing 45%, no break-even move, seller cut on");
  const pos = openLadder({ pool: 'a', coin: 'A', chain: 'Solana', mults: cfg.mults, shares: cfg.shares }, { price: 1, stop: 0.8 }, 300, iso(DAY), { slipPct: 0 }, 0);
  ok(pos.targets.join() === '1.5,2,2.5,3,4' && pos.shares.join() === '0.2,0.2,0.2,0.2,0.1', 'targets from the fill');
  const t1 = manageLadder(pos, { priceUsd: '1.5', txns: {} }, DAY + H, { ...cfg, slipPct: 0 }); ok(t1.actions.length === 1 && Math.abs(t1.actions[0].units - 60) < 1e-9 && t1.pos.stop === 0.8, 'first clip at +50%: 20% out, stop stays at 20% under (no break-even move, as Ryan trades it)');
  let pm = pos; for (const px of ['1.5', '2', '2.5', '3', '4']) pm = manageLadder(pm, { priceUsd: px, txns: {} }, DAY + H, { ...cfg, slipPct: 0 }).pos; ok(pm.hits === 5 && Math.abs(pm.remUnits - 30) < 1e-9 && pm.free && pm.stop === 0, 'all five clips taken on the way to 4x: 10% moonbag left, no stop');
  pm = manageLadder(pm, { priceUsd: '6', txns: {} }, DAY + 2 * H, { ...cfg, slipPct: 0 }).pos; const mb = manageLadder(pm, { priceUsd: '3.2', txns: {} }, DAY + 3 * H, { ...cfg, slipPct: 0 }); ok(mb.actions.length === 1 && mb.actions[0].all && /moonbag trail/.test(mb.actions[0].why) && Math.abs(mb.pos.bankedUsd - (60 * 1.5 + 60 * 2 + 60 * 2.5 + 60 * 3 + 30 * 4 + 30 * 3.2)) < 0.01, 'the moonbag rode to 6x and was sold 45% off that high: the whole trade banked');
  const cut = manageLadder(pos, { priceUsd: '0.9', txns: { h1: { buys: 10, sells: 30 }, m5: { buys: 1, sells: 5 } } }, DAY + H, { ...cfg, slipPct: 0 }); ok(cut.actions.length === 1 && cut.actions[0].all && /sellers took over/.test(cut.actions[0].why), 'down 10% with sellers in control: the seller cut takes it out before the 20% stop');
  const hold = manageLadder(pos, { priceUsd: '0.9', txns: { h1: { buys: 30, sells: 10 }, m5: { buys: 5, sells: 1 } } }, DAY + H, { ...cfg, slipPct: 0 }); ok(hold.actions.length === 0, 'down 10% with buyers still leading: held');
  // the bot end to end: the list arrives, two setups, bought on sight, the third coin waits for the next scan
  const st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};   // the four-hourly list as a source (kept for a bot that wants it; the runner bot now uses the minute scan only)
  const deps = (ms) => ({ now: ms, getJson: async (u) => (u.endsWith('runners.json') ? { at: iso(DAY), items } : []), quotes: async () => ({ a: { priceUsd: '1.01', liquidity: { usd: 300000 }, txns: {} }, b: { priceUsd: '2.02', liquidity: { usd: 150000 }, txns: {} } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, { ...cfg, source: 'runners', liveScan: false, minLiqUsd: 100000, setupsEveryMin: 0, slipPct: 0 }, deps(DAY * 1000 + 60e3)); console.log = log0;
  ok(st.positions.length === 2 && st.positions.every((p) => p.mode === 'ladder' && p.targets.length === 5 && Math.abs(p.stop / p.entry - 0.8) < 0.01) && jr.filter((j) => j.type === 'buy').length === 2, 'two runners bought on sight with 20% stops and the five clips (the list source, on the lab\'s ladder)'); }

// ---- end to end: the ignition bot scans the universe from hourly candles, buys at the next check, rides; the range bot rests a limit at the order block
{ const bars = []; for (let i = 0; i < 49; i++) bars.push(bar(DAY + i * H, 1.0, 1.01, 0.99, 1.0, 100 + (i % 5))); bars.push(bar(DAY + 49 * H, 1.0, 1.1, 0.995, 1.08, 1500)); const now = (DAY + 50 * H + 30) * 1000;
  const P = 'P'.repeat(44), q = { priceUsd: '1.09', txns: { h1: { buys: 60, sells: 30 } }, priceChange: { h24: 12 }, liquidity: { usd: 200000 }, baseToken: { address: 'T'.repeat(44) } };
  const cfg = { ...loadConfig('ignition'), exit: 'momentum', setupsEveryMin: 0, slipPct: 0 }, st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};   // the optional momentum exit, end to end
  const deps = (ms, px) => ({ now: ms, getJson: async (u) => (u.endsWith('universe.json') ? [{ pool: P, chain: 'Solana', sym: 'IGN', net: 'solana' }] : []), quotes: async () => ({ [P.toLowerCase()]: { ...q, priceUsd: String(px) } }), candlesH: async () => bars, candles15: async () => null, candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, cfg, deps(now, 1.09)); console.log = log0;
  const p = st.positions[0]; ok(p && p.mode === 'momentum' && p.stop === 0.995 && p.trigVol === 1500 && jr.some((j) => j.type === 'setup' && j.kind === 'ignition') && jr.some((j) => j.type === 'buy'), 'ignition: the candle is found in the universe scan and bought at the next check, stop at its low');
  ok(p && Math.abs(p.costUsd - 100) < 0.01, 'ignition stakes 1% of the pot ($100): small money, big upside');
  console.log = () => {}; await cycle(st, cfg, deps(now + 3600e3, 1.6)); await cycle(st, cfg, deps(now + 7200e3, 1.15)); console.log = log0;
  ok(st.positions.length === 1 && st.positions[0].cashed && Math.abs(st.positions[0].remUnits / p.units - 0.1) < 1e-9, 'rode to +48%, the trail took 90% out on the way back, the 10% moonbag is still held');
  ok(st.scanAt[P] > 0 && Object.keys(st.setups).length === 0, 'the coin is marked scanned (about once an hour) and the setup is spent');
  // range
  const y = []; for (let i = 0; i < 24; i++) y.push(bar(DAY - 86400 + i * H, 1.05, i === 10 ? 1.2 : 1.1, i === 4 ? 1.0 : 1.02, 1.08));
  const b1h = [...y, bar(DAY, 1.05, 1.06, 0.97, 0.99), bar(DAY + H, 0.99, 1.04, 0.98, 1.03), bar(DAY + 2 * H, 1.03, 1.05, 1.0, 1.04)], t15 = DAY + 900;
  const m = [bar(t15, 1.0, 1.005, 0.99, 1.0), bar(t15 + 900, 1.0, 1.01, 0.995, 1.005), bar(t15 + 1800, 1.005, 1.0, 0.985, 0.99), bar(t15 + 2700, 0.99, 0.995, 0.95, 0.96), bar(t15 + 3600, 0.96, 0.99, 0.958, 0.985), bar(t15 + 4500, 1.0, 1.0, 0.955, 0.96), bar(t15 + 5400, 0.96, 1.02, 0.958, 1.015), bar(t15 + 6300, 1.015, 1.03, 1.01, 1.025), bar(t15 + 7200, 1.025, 1.04, 1.02, 1.03)];
  const cfgR = { ...loadConfig('range'), setupsEveryMin: 0, slipPct: 0 }, sr = newState(cfgR), jr2 = [], nowR = (DAY + 3 * H + 600) * 1000;
  const depsR = (ms, px) => ({ now: ms, getJson: async (u) => (u.endsWith('universe.json') ? [{ pool: P, chain: 'Solana', sym: 'RNG', net: 'solana' }] : []), quotes: async () => ({ [P.toLowerCase()]: { priceUsd: String(px), liquidity: { usd: 300000 }, txns: {} } }), candlesH: async () => b1h, candles15: async () => m, candles5: async () => null, notify: async () => {}, journal: (o) => jr2.push(o), heartbeat: async () => {} });
  console.log = () => {}; await cycle(sr, cfgR, depsR(nowR, 1.03)); console.log = log0;
  const su = sr.setups[P]; ok(su && su.kind === 'range' && su.zoneHigh === 1.0 && su.tp1 === 1.2 && sr.positions.length === 0, 'range: setup found, the limit rests at the top of the order block while price is above it');
  console.log = () => {}; await cycle(sr, cfgR, depsR(nowR + 1800e3, 0.995)); console.log = log0;
  const pr = sr.positions[0]; ok(pr && pr.mode === 'ladder' && pr.targets.length === 1 && pr.targets[0] === 1.2 && pr.entry > 0.995 && pr.entry < 1.01 && pr.stop === 0.9552, 'price comes back into the order block: filled at the price plus costs, stop under the block, one target at the range high');
  console.log = () => {}; await cycle(sr, cfgR, depsR(nowR + 3 * 3600e3, 1.21)); console.log = log0;
  ok(sr.positions.length === 0 && sr.closed[0].pnl > 0 && /TP1: the rest/.test(sr.closed[0].sells[0].why), 'at the range high: everything out, trade closed in profit'); }

// ---- gates from the edge report: no follow-through time stop, a paid boost tightens the stop, too-young pools are not traded
{ const cfg = { ...loadConfig('runner'), slipPct: 0 }, pos = openLadder({ pool: 'a', coin: 'A', chain: 'Solana', mults: cfg.mults, shares: cfg.shares }, { price: 1, stop: 0.8 }, 300, iso(DAY), { slipPct: 0 }, 0);
  const nf = manageLadder(pos, { priceUsd: '0.95', txns: {} }, DAY + 25 * H, cfg); ok(nf.actions.length === 1 && nf.actions[0].all && /no follow-through after 24 hours/.test(nf.actions[0].why), 'under the entry with no clip hit after a day: out');
  ok(manageLadder(pos, { priceUsd: '1.2', txns: {} }, DAY + 25 * H, cfg).actions.length === 0, 'above the entry after a day: held');
  const bo = manageLadder(pos, { priceUsd: '1.3', txns: {}, boosts: { active: 2 } }, DAY + H, cfg); ok(bo.actions.length === 0 && Math.abs(bo.pos.stop - 1.105) < 1e-6 && /paid boost/.test(bo.pos.moves[0].why), 'a paid boost on a held coin: stop tightened to 15% under the price, nothing sold');
  const st = newState(cfg), jr = [], log0 = console.log; console.log = () => {}; const items = [{ coin: 'NEW', chain: 'Solana', pool: 'n', price: 1, passed: 4, vetoed: [], score: 80, m: { liq: 300000 }, checks: [] }];
  await cycle(st, { ...cfg, source: 'runners', liveScan: false, minAgeH: 24, setupsEveryMin: 0 }, { now: DAY * 1000 + 60e3, getJson: async (u) => (u.endsWith('runners.json') ? { at: iso(DAY), items } : []), quotes: async () => ({ n: { priceUsd: '1.01', liquidity: { usd: 300000 }, txns: {}, pairCreatedAt: DAY * 1000 - 5 * 3600e3 } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} }); console.log = log0;
  ok(st.positions.length === 0 && jr.some((j) => j.type === 'drop' && /5\.0 hours old/.test(j.why)), 'a 5-hour-old pool is not traded (24-hour survivor gate)'); }

// ---- the council argues over a bot's own gates from its closed trades
{ const { botSlices } = await import('../docs/council.mjs'); const closed = []; for (let i = 0; i < 16; i++) closed.push({ R: i < 8 ? 1 : -0.5, chain: 'Solana', openedAt: '2026-10-20T03:00:00Z', meta: { volX: i < 8 ? 50 : 15, stopPct: 8 } });
  const sl = botSlices({ closed }); ok(sl.length === 1 && sl[0].feat === 'ignition volume' && /40x\+ averages \+1.00R \(8\) against 12-20x at -0.50R \(8\)/.test(sl[0].text), 'a bot feature that splits winners from losers is put to the council');
  ok(botSlices({ closed: closed.slice(0, 6) }).length === 0, 'too few trades: nothing is argued'); }
{ const { council } = await import('../docs/council.mjs'); const mk = (R) => ({ R, chain: 'Solana', openedAt: '2026-10-20T03:00:00Z', closedAt: '2026-10-21T03:00:00Z', meta: {} }); const closed = []; for (let i = 0; i < 32; i++) closed.push(mk(i % 4 === 0 ? 0.2 : -0.6));
  const c = council({ botRecs: { ignition: { bot: 'ignition', execMode: 'dry', stats: { closed: 32, avgR: -0.4 }, account: { pnlPct: -3 }, closed } } }); const live = c.hats.find((h) => h.key === 'live') || c.H && c.H.live; const txt = JSON.stringify(c);
  ok(/KILL RULE/.test(txt) && /ignition: KILL RULE\. 32 closed/.test(txt), 'a bot with 30+ closed trades whose lucky end is still under zero is told to retire'); }

// ---- the variants bar (Deflated Sharpe idea): with many rules tried, the best lucky one must clear a higher bar
{ const { deflatedBar } = await import('../docs/council.mjs'); const b1 = deflatedBar({ n: 30, sd: 1, tests: 1 }), b20 = deflatedBar({ n: 30, sd: 1, tests: 20 });
  ok(b1 && b1.need === 0 && b20 && b20.trials === 20 && b20.need > 0.4 && b20.need < 0.5, 'one variant: no bar; twenty variants tried: the bar is about 0.45R on 30 trades with 1R spread');
  ok(deflatedBar({ n: 5, sd: 1, tests: 20 }) === null, 'too few trades: no bar'); }

// ---- study-exit variants on the paper engine: break-even once +30% has shown; the 35% giveback
{ const { runExit, PROFILES } = await import('../docs/exits.mjs'); const T0 = DAY * 1000, hb = (i, o, h, l, c) => [DAY + i * 900, o, h, l, c, 100], P = { ...PROFILES.studyBE, slipPct: 0, exitSlipPct: 0 }, s = { signalAt: iso(DAY - 60), fill: { px: 1.0, at: iso(DAY + 900) } };
  const bars = [hb(0, 1, 1.01, 0.99, 1), hb(1, 1, 1.02, 0.99, 1.0), hb(2, 1.0, 1.4, 0.99, 1.35), hb(3, 1.35, 1.36, 1.1, 1.12), hb(4, 1.12, 1.13, 0.95, 0.96), hb(5, 0.96, 0.97, 0.7, 0.72), hb(6, 0.72, 0.73, 0.55, 0.58)];
  const r = runExit(s, bars, iso(DAY + 40 * 3600), P), r0 = runExit(s, bars, iso(DAY + 40 * 3600), { ...PROFILES.study, slipPct: 0, exitSlipPct: 0 });
  ok(/break-even/.test(r.status) && r.retPct > -1 && r.retPct < 1 && /stopped out/.test(r0.status) && r0.retPct < -35, 'protected study: a trade that showed +40% and then fell is out at break-even, where the plain study exits take the full -40%');
  ok(PROFILES.studyTrail.giveback === 0.35 && PROFILES.study.giveback === 0.5 && PROFILES.studyBE.flowCut, 'the two variants: 35% giveback; break-even after +30% plus the seller cut'); }

// ---- the size study: the same trades at several risk levels, return against the deepest drop, with the order reshuffled
{ const { sizeStudy } = await import('../docs/evidence.mjs'); const Rs = []; for (let i = 0; i < 40; i++) Rs.push(i % 3 === 0 ? 3 : -1);   // a third of trades win 3R
  const ss = sizeStudy(Rs); ok(ss.n === 40 && ss.rows.length === 5 && ss.rows.every((r) => r.retPct > 0) && ss.rows[4].ddPct > ss.rows[0].ddPct, 'five risk levels, all profitable on a winning book, bigger size means deeper drops');
  ok(ss.best && ss.best.dd95Pct <= 30, 'the best level is the highest return-to-drop whose unlucky-order drop stays under 30%');
  const lose = sizeStudy(Rs.map((x) => -Math.abs(x))); ok(lose.rows.length === 5 && lose.best === null, 'a losing book: no level is recommended');
  ok(sizeStudy(Rs.slice(0, 20)).rows.length === 0, 'under 30 trades: collecting'); }

// ---- the runner's minute-level scan: DexScreener volume surge, buyers leading, moving but not vertical, not already up too much
{ const { runnerLive } = await import('../bot/setups.mjs'); const q = (o = {}) => ({ priceUsd: '1', volume: { h1: 60000, h24: 240000 }, txns: { h1: { buys: 120, sells: 80 } }, priceChange: { m5: 1, h1: 12, h24: 40 }, liquidity: { usd: 300000 }, ...o });
  const r = runnerLive(q()); ok(r && !r.dead && r.surge === 6 && r.buyRatio === 1.5 && /volume 6.0x/.test(r.why[0]), 'volume 6x the 24-hour pace, buyers 1.5x sellers, +12% in the hour: a runner');
  ok(runnerLive(q({ volume: { h1: 15000, h24: 240000 } })) === null, 'only 1.5x the pace: not a surge');
  ok(runnerLive(q({ txns: { h1: { buys: 80, sells: 100 } } })) === null, 'sellers leading: no');
  ok(runnerLive(q({ priceChange: { m5: 1, h1: 1, h24: 5 } })) === null, 'flat: no');
  ok(/vertical/.test(runnerLive(q({ priceChange: { m5: 1, h1: 90, h24: 95 } })).dead) && /too late/.test(runnerLive(q({ priceChange: { m5: 1, h1: 12, h24: 400 } })).dead), 'up 90% in an hour or 400% in a day: refused, not chased');
  // end to end: the universe is quoted every minute and a runner is bought on sight with the clips
  const P = 'R'.repeat(44), cfg = { ...loadConfig('runner'), setupsEveryMin: 1e9, slipPct: 0 }, st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};
  await cycle(st, cfg, { now: DAY * 1000, getJson: async (u) => (u.endsWith('universe.json') ? [{ pool: P, chain: 'Solana', sym: 'RUNX', net: 'solana' }] : []), quotes: async () => ({ [P.toLowerCase()]: { ...q(), pairCreatedAt: DAY * 1000 - 5 * 86400e3, baseToken: { address: 'T'.repeat(44) } } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} }); console.log = log0;
  const p = st.positions[0]; ok(p && p.mode === 'ladder' && p.targets.length === 4 && p.targets[0] / p.entry > 1.99 && Math.abs(p.stop / p.entry - 0.8) < 0.01 && jr.some((j) => j.type === 'setup' && /live scan|volume/.test(JSON.stringify(j))), 'found in the minute scan and bought on sight: first clip at +100%, stop 20% (no candles in the test)');
  console.log = () => {}; await cycle(st, cfg, { now: DAY * 1000 + 60e3, getJson: async () => [], quotes: async () => ({ [P.toLowerCase()]: q() }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} }); console.log = log0;
  ok(st.positions.length === 1 && Object.keys(st.setups).length === 0, 'the same coin is not taken again (72-hour cooldown)'); }

// ---- the six bots are what the services run; lab, minute and trench are research only (never live)
{ ok(Object.keys(BOTS).join() === 'runner,breakout,lab,minute,trench,rider,ignition', 'seven bots: runner, breakout, lab, minute, trench, rider, ignition');
  ok(BOTS.runner.realityBook === null && BOTS.breakout.realityBook === 'brkBot' && BOTS.lab.realityBook === null && BOTS.ignition.realityBook === null && BOTS.runner.source === 'live' && BOTS.runner.minLiqUsd === 50000 && BOTS.runner.minAgeH === 2, 'breakout has a paper twin; runner (pure minute scan, $50k liquidity, 2-hour age), lab and ignition are judged on their own record');
  ok(BOTS.runner.mults.join() === '2,3,4,5' && BOTS.runner.shares.join() === '0.2,0.2,0.2,0.2' && BOTS.runner.moonTrail === 0.35 && BOTS.runner.stopMode === 'structure' && BOTS.runner.dumpCut && BOTS.runner.peakGiveback, 'runner: 20% clips at +100/+200/+300/+400, the last 20% trails 35%, structure stop, dump cut and giveback');
  ok(BOTS.lab.labOnly && BOTS.minute.labOnly && BOTS.trench.labOnly && BOTS.lab.variants.length === 7 && BOTS.lab.variants.map((v) => v.key[0]).join('') === 'ABCDEFG', 'lab (7 variants), minute and trench are research bots that can never go live');
  ok(loadConfig('ignition').exit === 'ladder' && loadConfig('range').entry === 'limit' && RETIRED.range && loadConfig('trench').engine === 'trench' && loadConfig('minute').entry === 'minute', 'range is retired but still loads; trench and minute load with their engines'); }

// ---- the structure stop, the giveback rule, the dump cut and the dead-chart rule (the HOOKR fix)
{ const H = (lo) => [1000 - 3600, 1, 1.1, lo, 1.05, 100]; const ss = structureStop(1, [H(0.9), [1000 - 7200, 1, 1, 0.85, 1, 100]], 2000); ok(ss.stopPct >= 12 && ss.stopPct <= 30 && ss.stop < 1, 'structure stop: under the last two hourly lows, between 12% and 30%: ' + ss.stopPct);
  ok(structureStop(1, [[1000 - 3600, 1, 1, 0.99, 1, 100]], 2000).stopPct === 12 && structureStop(1, [[1000 - 3600, 1, 1, 0.5, 1, 100]], 2000).stopPct === 30 && structureStop(1, [], 2000).stopPct === 20, 'widened to 12% when the low is too close, capped at 30%, 20% with no candles');
  const cfg = { ...BOT, peakGiveback: { armPct: 0.3, keep: 0.5 }, dumpCut: { min5: 8, sellX5: 1.5, sellX1: 1.2, offHighPct: 0.15 }, flowCut: false, slipPct: 0 };
  let p = openLadder({ pool: 'P', coin: 'H', chain: 'solana', mults: [2, 3], shares: [0.2, 0.2] }, { price: 1, stop: 0.8 }, 100, '2026-10-22T00:00:00Z', cfg, 1e6);
  p = manageLadder(p, { priceUsd: '1.6', txns: { m5: { buys: 10, sells: 2 }, h1: { buys: 50, sells: 20 } } }, Date.parse('2026-10-22T01:00:00Z') / 1000, cfg).pos; ok(p.remUnits > 0 && p.peak >= 1.6, 'up 60%: still in');
  let r = manageLadder(p, { priceUsd: '1.25', txns: { m5: { buys: 10, sells: 2 }, h1: { buys: 50, sells: 20 } } }, Date.parse('2026-10-22T02:00:00Z') / 1000, cfg); ok(r.actions.length === 1 && /gave back/.test(r.actions[0].why) && r.pos.remUnits === 0, 'giveback: half of a +60% gain given back (price 1.25, below entry + 30%): everything out at +25%, not back at the entry');
  r = manageLadder(p, { priceUsd: '1.3', txns: { m5: { buys: 4, sells: 12 }, h1: { buys: 30, sells: 40 } } }, Date.parse('2026-10-22T02:00:00Z') / 1000, cfg); ok(r.actions.length === 1 && /sellers dumping/.test(r.actions[0].why), 'dump cut: sellers 1.5x buys in 5 minutes and 1.2x in the hour, 15%+ off the high: out');
  r = manageLadder(p, { priceUsd: '1.5', txns: { m5: { buys: 4, sells: 12 }, h1: { buys: 30, sells: 40 } } }, Date.parse('2026-10-22T02:00:00Z') / 1000, cfg); ok(r.actions.length === 0, 'sellers lead but the price is only 6% off the high: a shake-out, still in');
  r = manageLadder(p, { priceUsd: '1.5', lastTradeSec: 100, txns: { m5: { buys: 1, sells: 0 }, h1: { buys: 1, sells: 0 } } }, 100 + 5 * 60, { ...cfg, deadMin: 4 }); ok(r.actions.length === 1 && /dead chart/.test(r.actions[0].why), 'dead chart (trencher): no trades for 4 minutes: out'); }

// ---- the pullback entry and the minute entry and exit
{ const at = '2026-10-22T00:00:00Z', t0 = Date.parse(at) / 1000, s = { at, zoneHigh: 1, zoneLow: 1, why: [] }, cfg = { ...BOT, pbDipPct: 12, pbWaitH: 3, pbFailPct: 15 };
  const b5 = (closes) => closes.map((c, i) => [t0 + i * 300, closes[i - 1] ?? c, Math.max(c, closes[i - 1] ?? c) * 1.01, Math.min(c, closes[i - 1] ?? c) * 0.99, c, 100]);
  ok(decidePullback(s, b5([1, 1.1, 1.2]), 1.2, t0 + 20 * 60, cfg) == null, 'pullback: no dip yet, no entry');
  const d = decidePullback(s, b5([1, 1.2, 1.05, 1.02, 1.06]), 1.06, t0 + 30 * 60, cfg); ok(d && d.act === 'buy' && d.stop < 1.02, 'pullback: a 15% dip from the post-signal high, the first 5-minute close back up: buy, stop under the dip');
  ok(decidePullback(s, b5([1, 1.2, 0.8]), 0.8, t0 + 20 * 60, cfg).act === 'drop', 'pullback: the dip broke 15% under the signal price: dropped');
  ok(decidePullback(s, b5([1, 1.01]), 1.01, t0 + 4 * 3600, cfg).act === 'drop', 'pullback: nothing in 3 hours: dropped');
  const b1 = (rows) => rows.map(([o, c, v], i) => [t0 + i * 60, o, Math.max(o, c), Math.min(o, c), c, v]), mc = { ...BOT, fixedStopPct: 15, minWaitMin: 15, minFailPct: 10, chaseLimitPct: 10 };
  ok(decideMinute(s, b1([[1, 0.99, 10], [0.99, 0.98, 10]]), 0.98, t0 + 180, mc) == null, 'minute entry: red minutes, waits');
  const m = decideMinute(s, b1([[1, 0.99, 10], [0.99, 1.02, 12]]), 1.02, t0 + 180, mc); ok(m && m.act === 'buy' && m.stopPct === 15, 'minute entry: the first closed green minute above the previous close: buy, stop 15%');
  ok(decideMinute(s, b1([[1, 0.99, 10], [0.99, 1.02, 12]]), 1.02, t0 + 16 * 60, mc).act === 'drop', 'minute entry: 15 minutes gone: dropped');
  const xc = { ...BOT, armPct: 0.2, trailBars: 3, dumpBarPct: 8, dumpVolX: 2, flowCut: false, slipPct: 0, mults: [1.5, 2, 3], shares: [0.3, 0.3, 0.2] };
  let p = openLadder({ pool: 'P', coin: 'M', chain: 'solana', mults: xc.mults, shares: xc.shares }, { price: 1, stop: 0.85 }, 100, at, xc, 1e6); p.mode = 'minute';
  const flat = (n, c, v = 10) => Array.from({ length: n }, (_, i) => [t0 + i * 60, c, c * 1.005, c * 0.995, c, v]);
  let r = manageMinute(p, { priceUsd: '1.3' }, flat(25, 1.3), t0 + 26 * 60, xc); ok(r.pos.stop > 0.85 && r.pos.stop >= 1.3 * 0.995 * 0.98 - 1e-9 && r.actions.length === 0, 'minute exit: up 30%, the stop trails 2% under the last three minutes\' low: ' + r.pos.stop);
  r = manageMinute(r.pos, { priceUsd: '1.18' }, [...flat(24, 1.3), [t0 + 24 * 60, 1.3, 1.3, 1.17, 1.18, 40]], t0 + 26 * 60, xc); ok(r.actions.length === 1 && /dump candle/.test(r.actions[0].why), 'minute exit: a -9% minute on 4x volume: out'); }

// ---- the trencher: feed events in, setups and quotes out; the gates are loose but real
{ const f = trenchFeed({ WS: null }), t0 = 1000; f.push({ txType: 'create', mint: 'M1', name: 'Pepe Ten', symbol: 'PEPE10', traderPublicKey: 'dev', initialBuy: 30e6, vSolInBondingCurve: 31, vTokensInBondingCurve: 1.05e9, marketCapSol: 29.5 }, t0);
  for (let i = 0; i < 14; i++) f.push({ txType: 'buy', mint: 'M1', traderPublicKey: 'w' + i, solAmount: 0.4, vSolInBondingCurve: 31 + 0.4 * (i + 1), vTokensInBondingCurve: 1.05e9 - 12e6 * (i + 1), marketCapSol: 32 + i }, t0 + 20 + i * 5);
  f.push({ txType: 'sell', mint: 'M1', traderPublicKey: 'w1', solAmount: 0.3, vSolInBondingCurve: 36.3, vTokensInBondingCurve: 0.89e9, marketCapSol: 44 }, t0 + 95);
  const tok = f.tokens.get('M1'); ok(tok && Object.keys(tok.buyers).length === 14 && tok.trades.length === 15, 'the feed keeps a tally per launch: 14 buyers, 15 trades');
  ok(trenchSetup(tok, t0 + 20, TRENCH) == null, 'under 30 seconds old: not yet');
  const r = trenchSetup(tok, t0 + 100, TRENCH); ok(r && !r.dead && r.buyers === 14 && r.mcapSol === 44 && r.devPct === 3, 'a minute and a half in, 14 buyers, buys 14 to 1, 44 SOL, dev 3%: a setup');
  const q = quoteFor(tok, t0 + 100, 200); ok(+q.priceUsd > 0 && q.txns.m5.buys === 14 && q.txns.m5.sells === 1 && q.lastTradeSec === t0 + 95 && /pump\.fun/.test(q.url), 'the quote looks like DexScreener\'s: price in USD, buys and sells, last trade time');
  ok(trenchSetup(tok, t0 + 13 * 60, TRENCH).dead && /past the window/.test(trenchSetup(tok, t0 + 13 * 60, TRENCH).dead), '13 minutes old: past the window');
  f.push({ txType: 'create', mint: 'M2', symbol: 'RUG', traderPublicKey: 'dev2', initialBuy: 120e6, vSolInBondingCurve: 35, vTokensInBondingCurve: 0.95e9, marketCapSol: 37 }, t0); for (let i = 0; i < 14; i++) f.push({ txType: 'buy', mint: 'M2', traderPublicKey: 'x' + i, solAmount: 0.5, vSolInBondingCurve: 36 + i, vTokensInBondingCurve: 0.9e9, marketCapSol: 40 + i }, t0 + 30 + i * 4);
  ok(/dev bought 12%/.test(trenchSetup(f.tokens.get('M2'), t0 + 100, TRENCH).dead), 'the dev bought 12% at launch: dead');
  const st = { positions: [], setups: {}, seen: {} }, jr = []; trenchSetupsIn(st, loadConfig('trench'), f, { J: (o) => jr.push(o), now: (t0 + 100) * 1000, nowIso: '2026-10-22T00:01:40Z', solUsd: 200 });
  ok(st.setups.M1 && st.setups.M1.kind === 'trench' && st.setups.M1.chain === 'solana' && Math.abs(st.setups.M1.stop / st.setups.M1.zoneHigh - 0.65) < 0.01 && !st.setups.M2 && jr.some((j) => j.type === 'skip' && j.pool === 'M2'), 'setups from the feed: PEPE10 in with a 35% stop, RUG skipped with the reason in the journal');
  ok(loadConfig('trench').maxPosPct === 1 && loadConfig('trench').maxHoldH === 1 && loadConfig('trench').deadMin === 4, 'trencher: $100 flat, an hour at most, dead after 4 quiet minutes'); }

// ---- the missed-runner review: which gate stood in the way of the coin that ran
{ const q = (o) => ({ priceUsd: '1', volume: { h1: 30000, h24: 240000 }, txns: { h1: { buys: 120, sells: 90 } }, priceChange: { h1: 10, m5: 1, h24: 50 }, ...o });
  ok(runnerWhyNot(q({ volume: { h1: 30000, h24: 24 * 30000 } }), RUN).gate === 'volume surge' && runnerWhyNot(q({ txns: { h1: { buys: 50, sells: 60 } } }), RUN).gate === 'buyers leading' && runnerWhyNot(q({ priceChange: { h1: 90, m5: 1, h24: 50 } }), RUN).gate === 'too vertical' && runnerWhyNot(q({ volume: { h1: 5000, h24: 1000 } }), RUN).gate === 'hourly volume' && runnerWhyNot(q({}), RUN).gate === 'none', 'the first gate tripped is named: volume surge, buyers leading, too vertical, hourly volume, or none');
  const ms = missedSummary([{ at: new Date().toISOString(), gate: 'volume surge', coin: 'A', c24: 150, peakC24: 200 }, { at: new Date().toISOString(), gate: 'volume surge', coin: 'B', c24: 120 }, { at: new Date().toISOString(), gate: 'liquidity', coin: 'C', c24: 300 }, { at: new Date().toISOString(), gate: 'exit', coin: 'D', c24: 90 }, { at: new Date().toISOString(), gate: 'entry', coin: 'E', c24: 95 }]);
  ok(ms.n === 5 && ms.gates[0].gate === 'volume surge' && ms.gates[0].n === 2 && ms.gated === 3 && /mostly the gates/.test(ms.verdict), 'missed summary: grouped by gate, verdict says the gates were in the way: ' + ms.verdict);
  const rv = missedReview({ missedSummary: { ...ms, n: 9, gates: [{ gate: 'volume surge', n: 5, avgPeak24: 180, coins: ['A', 'B'] }, { gate: 'exit', n: 4, avgPeak24: 100, coins: ['D'] }], entry: 0, exit: 4, gated: 5, verdict: 'a mix of gates and the trade itself' } });
  ok(rv.length >= 3 && /MISSED RUNNERS: 9/.test(rv[0]) && rv.some((x) => /volume-surge rule/.test(x)) && rv.some((x) => /Question for the exit/.test(x)), 'the council asks the questions: too many gates (which one), or the exit that let go');
  const lv = labVariants({ closed: [...Array(6)].flatMap((_, i) => [{ R: 1 + i * 0.1, meta: { variant: 'A-base' } }, { R: -0.5, meta: { variant: 'C-control' } }, { R: 2, meta: { variant: 'G-giveback' } }]) });
  ok(lv.length >= 2 && /LAB, variant by variant/.test(lv[0]) && /beats the random control/.test(lv[1]), 'the council reads the lab variant by variant and checks the real entry against the random control'); }

// ---- the giants study: a chart that runs 10x with dips on the way, tops, then bleeds; what each exit would have kept
{ const bars = []; let p = 1; for (let i = 0; i < 200; i++) { const ph = i % 12, m = i < 90 ? (ph < 8 ? 1.09 : 0.9) : 0.975, o = p; p *= m; bars.push([1700000000 + i * 86400, o, Math.max(o, p) * 1.05, Math.min(o, p) * 0.95, p, 1000]); }
  const s = studyChart(bars); ok(s && s.peakDay === 89 && s.x > 10 && s.dipCount[30] >= 5 && s.dipCount[50] === 0 && s.afterPeak.nowPct < -90, 'launch to top in 89 days, 10x, seven 30% dips on the way and none of 50%, now 94% under the top');
  ok(s.sims.hold.out < 600 && s.sims.trail50.out > s.sims.trail35.out && s.sims.clipsTrail50.out > s.sims.giveback.out && s.sims.peakSold.out > s.sims.trail50.out, 'holding rode it back to nothing; a 50% trail kept more than a 35% one on a chart with 41% dips; the clips plus trail beat the giveback rule');
  ok(s.pullback && s.pullback.toPeak > 5 && s.entries[0].day === 0 && s.entries.find((e) => e.day === 7).toPeak < s.entries[0].toPeak, 'the first 30% pullback after a 2x still gave 6x to the top; later entry days gave less');
  const sum = summarise([{ study: s }, { study: s }, { study: null }]); ok(sum.n === 2 && sum.best === 'trail50' && sum.lines.length === 5 && /worst dip before the top: 41%/.test(sum.lines[0]), 'the summary names the rule that kept the most and the dips a moonbag must survive');
  const c = council({ giants: { summary: sum } }); ok(c.hats.some((h) => (h.points || []).some((x) => /GIANTS \(2 charts/.test(x))), 'the council\'s scout hat reads the giants study'); }

// ---- the rider: day 2-7, proven mover, the first real pullback turning, the giant ticket trailing the giants' width
{ const T = 1800000000, day = (i, c, h, v) => [T - (6 - i) * 86400, c * 0.9, h, c * 0.85, c, v]; // 7 daily bars, the last one still forming
  const daily = [day(0, 1, 1.2, 100000), day(1, 2, 2.3, 400000), day(2, 3, 3.4, 500000), day(3, 2.4, 3.1, 450000), day(4, 2.2, 2.5, 420000), day(5, 2.1, 2.3, 400000), day(6, 2.3, 2.4, 380000)];
  const hours = (turn) => [[T - 7200, 2.1, 2.15, 2.05, 2.1, 10], [T - 3600, 2.1, 2.35, 2.08, turn ? 2.3 : 2.05, 12], [T, 2.3, 2.3, 2.3, 2.3, 1]];
  const q = (o = {}) => ({ priceUsd: '2.3', pairCreatedAt: (T - 6 * 86400) * 1000, liquidity: { usd: 400000 }, volume: { h24: 900000 }, txns: { h1: { buys: 40, sells: 30 } }, ...o });
  const r = riderSetup(q(), daily, hours(true), T, RIDER); ok(r && !r.dead && r.x === 2.3 && r.offHighPct === 32 && r.ageD === 6 && r.stopPct >= 15 && r.stopPct <= 35, 'day 6, 2.3x its first close, 32% off the high, turning on the hour: a rider setup, stop ' + (r && r.stopPct) + '%');
  ok(riderSetup(q(), daily, hours(false), T, RIDER) == null, 'the hour has not turned green: waits');
  ok(/collapse/.test(riderSetup(q({ priceUsd: '1.5' }), daily, hours(true), T, RIDER).dead), '56% off the high: a collapse, not a pullback');
  ok(/interest fading/.test(riderSetup(q({ volume: { h24: 300000 } }), daily, hours(true), T, RIDER).dead), '24h volume under 1.5x the liquidity: interest fading');
  ok(/past the window/.test(riderSetup(q({ pairCreatedAt: (T - 9 * 86400) * 1000 }), daily, hours(true), T, RIDER).dead) && riderSetup(q({ pairCreatedAt: (T - 86400) * 1000 }), daily, hours(true), T, RIDER) == null, 'day 9 is past the window; day 1 is too early');
  const cfg = loadConfig('rider'); ok(cfg.shares.reduce((a, b) => a + b, 0) === 0.6 && cfg.moonTrail === 0.55 && cfg.giantsTrail && !cfg.peakGiveback && !cfg.dumpCut && cfg.maxEntriesPerCoin === 3 && cfg.noFollowH === 72 && !cfg.labOnly, 'rider: 40% giant ticket trailing 55% (the giants study replaces the width), no giveback or dump cut, 3 entries a coin, can go live one day');
  // end to end: trending pools join the universe, the setup is found and bought, the moonbag trails the giants' width
  const st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};
  const deps = (now, px) => ({ now, getJson: async (u) => (u.includes('trending_pools') ? { data: [{ id: 'solana_POOLX', attributes: { name: 'GIANT / SOL', address: 'POOLX' } }] } : u.endsWith('universe.json') ? [] : u.endsWith('giants.json') ? { summary: { worstDip: 52 } } : u.endsWith('setups.json') ? [{ id: 'X:INDEX', coin: 'INDEX', chain: 'Robinhood', pool: '0xindex', signal: 'Watch', opp: 73, setupType: 'Volume breakout', entryLow: 1, entryHigh: 1.01, stop: 0.8, liquidity: 500000, rug: 'ok', at: new Date(now).toISOString() }] : []), quotes: async (items) => Object.fromEntries(items.map((i) => [String(i.pool).toLowerCase(), { ...q({ priceUsd: String(px) }), baseToken: { address: 'TOK', symbol: 'GIANT' }, url: 'x' }])), candlesD: async () => daily, candlesH: async () => hours(true), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, { ...cfg, setupsEveryMin: 0, slipPct: 0 }, deps(T * 1000, 2.3)); console.log = log0;
  ok(!jr.some((j) => j.type === 'setup' && j.kind !== 'rider'), 'the rider never takes the scanner\'s own setups (bug seen on 22 Oct: it bought a Volume breakout on the watch signal)');
  ok(st.trending && st.trending[0].pool === 'POOLX' && st.positions.length === 1 && st.positions[0].coin === 'GIANT' && st.positions[0].targets.length === 4 && st.giantsTrail === 0.62, 'the trending pool was scanned and bought: four clips, the giants study set the moonbag trail to 62% (worst dip 52% + 10)');
  console.log = () => {}; for (const px of [4.7, 7, 9.3, 11.6]) await cycle(st, { ...cfg, setupsEveryMin: 0, slipPct: 0 }, deps(T * 1000 + 3600e3, px)); console.log = log0;
  const p = st.positions[0]; ok(p && p.hits === 4 && p.free && p.stop === 0 && Math.abs(p.remUnits / p.units - 0.4) < 1e-6, 'all four clips taken by 5x: the 40% giant ticket rides with no stop');
  console.log = () => {}; await cycle(st, { ...cfg, setupsEveryMin: 0, slipPct: 0 }, deps(T * 1000 + 7200e3, 11.6 * 0.5)); const held = st.positions.length; await cycle(st, { ...cfg, setupsEveryMin: 0, slipPct: 0 }, deps(T * 1000 + 7200e3, 11.6 * 0.37)); console.log = log0;
  ok(held === 1 && st.positions.length === 0 && /moonbag trail: 62%/.test(st.closed[0].sells.at(-1).why), 'a 50% dip did not shake the giant ticket out; 63% off the high did (the giants\' width)'); }

// ---- the giants study tells giants from duds on day 3
{ const mk = (run) => { const bars = []; let p = 1; for (let i = 0; i < 120; i++) { const ph = i % 12, m = run ? (i < 90 ? (ph < 8 ? 1.09 : 0.9) : 0.975) : (i < 2 ? 1.5 : 0.9), o = p; p *= m; bars.push([1700000000 + i * 86400, o, Math.max(o, p) * 1.05, Math.min(o, p) * 0.95, p, run ? 1000 + i * 10 : 1000 - i * 8]); } return studyChart(bars); };
  const s = summarise([{ kind: 'giant', study: mk(true) }, { kind: 'giant', study: mk(true) }, { kind: 'dud', study: mk(false) }, { kind: 'dud', study: mk(false) }, { kind: 'dud', study: mk(false) }]);
  ok(s.n === 2 && s.duds === 3 && s.fingerprint.giants.xDay3 > s.fingerprint.duds.xDay3 && s.fingerprint.giants.heldDay1Close === 1 && s.fingerprint.duds.heldDay1Close === 0 && /Day-3 fingerprint/.test(s.lines.at(-1)), 'on day 3 the giants were still above their day-1 close and the duds were not; the summary says so'); }

process.exit(f);
