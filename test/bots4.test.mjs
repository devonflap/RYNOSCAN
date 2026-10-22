// The three new bots: Runner (Ryan's ladder + seller cut on the scanner's runners), Range (the Monday-range trade on yesterday's range)
// and Ignition (the Ignition Rider on meme coins with momentum exits and a moonbag). Candles are made up; nothing touches the network.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynobots4-');
import { rangeSetup, ignitionSetup, runnerSetups, swings } from '../bot/setups.mjs';
import { manageMomentum, openMomentum, manageLadder, openLadder } from '../bot/manage.mjs';
import { cycle, newState, loadConfig, BOTS } from '../bot/run.mjs';
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
  const cfg = loadConfig('runner'); ok(cfg.fixedStopPct === 20 && cfg.mults.join() === '1.5,2,2.5,3,4' && cfg.shares.join() === '0.2,0.2,0.2,0.2,0.1' && cfg.flowCut && cfg.beAfterFirst === false && cfg.moonTrail === 0.45, "Ryan's clips: stop 20%, 20% out at +50/+100/+150/+200%, 10% at +300%, a 10% moonbag trailing 45%, no break-even move, seller cut on");
  const pos = openLadder({ pool: 'a', coin: 'A', chain: 'Solana', mults: cfg.mults, shares: cfg.shares }, { price: 1, stop: 0.8 }, 300, iso(DAY), { slipPct: 0 }, 0);
  ok(pos.targets.join() === '1.5,2,2.5,3,4' && pos.shares.join() === '0.2,0.2,0.2,0.2,0.1', 'targets from the fill');
  const t1 = manageLadder(pos, { priceUsd: '1.5', txns: {} }, DAY + H, { ...cfg, slipPct: 0 }); ok(t1.actions.length === 1 && Math.abs(t1.actions[0].units - 60) < 1e-9 && t1.pos.stop === 0.8, 'first clip at +50%: 20% out, stop stays at 20% under (no break-even move, as Ryan trades it)');
  let pm = pos; for (const px of ['1.5', '2', '2.5', '3', '4']) pm = manageLadder(pm, { priceUsd: px, txns: {} }, DAY + H, { ...cfg, slipPct: 0 }).pos; ok(pm.hits === 5 && Math.abs(pm.remUnits - 30) < 1e-9 && pm.free && pm.stop === 0, 'all five clips taken on the way to 4x: 10% moonbag left, no stop');
  pm = manageLadder(pm, { priceUsd: '6', txns: {} }, DAY + 2 * H, { ...cfg, slipPct: 0 }).pos; const mb = manageLadder(pm, { priceUsd: '3.2', txns: {} }, DAY + 3 * H, { ...cfg, slipPct: 0 }); ok(mb.actions.length === 1 && mb.actions[0].all && /moonbag trail/.test(mb.actions[0].why) && Math.abs(mb.pos.bankedUsd - (60 * 1.5 + 60 * 2 + 60 * 2.5 + 60 * 3 + 30 * 4 + 30 * 3.2)) < 0.01, 'the moonbag rode to 6x and was sold 45% off that high: the whole trade banked');
  const cut = manageLadder(pos, { priceUsd: '0.9', txns: { h1: { buys: 10, sells: 30 }, m5: { buys: 1, sells: 5 } } }, DAY + H, { ...cfg, slipPct: 0 }); ok(cut.actions.length === 1 && cut.actions[0].all && /sellers took over/.test(cut.actions[0].why), 'down 10% with sellers in control: the seller cut takes it out before the 20% stop');
  const hold = manageLadder(pos, { priceUsd: '0.9', txns: { h1: { buys: 30, sells: 10 }, m5: { buys: 5, sells: 1 } } }, DAY + H, { ...cfg, slipPct: 0 }); ok(hold.actions.length === 0, 'down 10% with buyers still leading: held');
  // the bot end to end: the list arrives, two setups, bought on sight, the third coin waits for the next scan
  const st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};
  const deps = (ms) => ({ now: ms, getJson: async (u) => (u.endsWith('runners.json') ? { at: iso(DAY), items } : []), quotes: async () => ({ a: { priceUsd: '1.01', liquidity: { usd: 300000 }, txns: {} }, b: { priceUsd: '2.02', liquidity: { usd: 150000 }, txns: {} } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, { ...cfg, setupsEveryMin: 0, slipPct: 0 }, deps(DAY * 1000 + 60e3)); console.log = log0;
  ok(st.positions.length === 2 && st.positions.every((p) => p.mode === 'ladder' && p.targets.length === 5 && Math.abs(p.stop / p.entry - 0.8) < 0.01) && jr.filter((j) => j.type === 'buy').length === 2, 'two runners bought on sight with 20% stops and the five clips'); }

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
  await cycle(st, { ...cfg, setupsEveryMin: 0 }, { now: DAY * 1000 + 60e3, getJson: async (u) => (u.endsWith('runners.json') ? { at: iso(DAY), items } : []), quotes: async () => ({ n: { priceUsd: '1.01', liquidity: { usd: 300000 }, txns: {}, pairCreatedAt: DAY * 1000 - 5 * 3600e3 } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} }); console.log = log0;
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

// ---- the four bots are what the services run, each with its own paper twin or none
{ ok(Object.keys(BOTS).join() === 'runner,breakout,range,ignition', 'four bots: runner, breakout, range, ignition');
  ok(BOTS.runner.realityBook === 'riskyClip' && BOTS.breakout.realityBook === 'brkBot' && BOTS.range.realityBook === null && BOTS.ignition.realityBook === null, 'runner and breakout have paper twins; range and ignition are new and judged on their own record');
  ok(loadConfig('ignition').exit === 'ladder' && loadConfig('ignition').shares.join() === loadConfig('runner').shares.join() && loadConfig('range').entry === 'limit' && loadConfig('range').rrMin === 3 && loadConfig('range').rrMax === 8, 'range is a limit entry on 3R-8R setups; ignition uses the same clips as the runner'); }
process.exit(f);
