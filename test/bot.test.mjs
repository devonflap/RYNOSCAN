// RynoBot (dry run): entry decision, sizing, the exit stack on live quotes, and one full simulated cycle with fake data feeds.
import { BOT, decideEntry, sizeFor, openPosition, managePosition, pnlOf } from '../bot/manage.mjs';
import { cycle, newState, DEFAULTS } from '../bot/run.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-20T00:00:00Z') / 1000, M = 300, iso = (s) => new Date(s * 1000).toISOString().slice(0, 19) + 'Z';
const mk = (i, o, h, l, c, v) => [T0 + i * M, o, h, l, c, v], base = Array.from({ length: 14 }, (_, i) => mk(i, 1.05, 1.06, 1.04, 1.05, 100));
const setup = { pool: 'P1', coin: 'AAA', chain: 'Solana', zoneLow: 1.0, zoneHigh: 1.04, stop: 0.9, at: iso(T0 - 60) };
const flush = [...base, mk(14, 1.05, 1.05, 0.97, 0.98, 120), mk(15, 0.98, 1.03, 0.97, 1.02, 200)];

// entry
{ const d = decideEntry(setup, flush, 1.025, T0 + 16 * M + 30); ok(d && d.act === 'buy' && Math.abs(d.stop - 0.9603) < 1e-6 && d.stopPct > 5 && /flush and reclaim/.test(d.why[0]), 'trigger just fired on the last closed 5-minute candle: buy now, stop under the flush low');
  ok(decideEntry(setup, flush, 1.09, T0 + 16 * M + 30).act === 'drop', 'price already 5% over the zone: dropped, no chasing');
  const later = [...flush, mk(16, 1.02, 1.05, 1.01, 1.04, 150), ...Array.from({ length: 6 }, (_, i) => mk(17 + i, 1.04, 1.05, 1.03, 1.04, 100))];
  ok(decideEntry(setup, later, 1.04, T0 + 23 * M + 30).act === 'drop', 'a trigger from 30 minutes ago is too late to act on');
  ok(decideEntry(setup, base, 1.05, T0 + 14 * M + 30) === null, 'no trigger yet: keep watching'); }

// sizing
{ const s = sizeFor({ equity: 1000, cash: 1000 }, { stopPct: 8 }, 500000, 0); ok(Math.abs(s.usd - 125) < 0.01 && Math.abs(s.riskUsd - 10) < 0.01 && !s.cut, 'risk 1% of $1,000 with an 8% stop: $125 position');
  ok(sizeFor({ equity: 1000, cash: 1000 }, { stopPct: 2 }, 500000, 0).cut === 'account share cap', 'a tight stop cannot make the position bigger than 25% of the account');
  ok(sizeFor({ equity: 1000, cash: 1000 }, { stopPct: 8 }, 500000, 35).usd === 62.5 && sizeFor({ equity: 1000, cash: 1000 }, { stopPct: 8 }, 3000, 0).cut === 'price impact cap' && sizeFor({ equity: 1000, cash: 1000 }, { stopPct: 8 }, 3000, 0).usd === 22.5, 'total open risk and price impact cap the size (1.5% impact at most: $22.50 in a $3k pool)'); }

// the exit stack on live quotes
const q = (px, o = {}) => ({ priceUsd: String(px), txns: { h1: { buys: o.b1 ?? 50, sells: o.s1 ?? 40 }, m5: { buys: o.b5 ?? 5, sells: o.s5 ?? 4 } }, volume: { h6: o.h6 ?? 30000, h24: o.h24 ?? 100000 }, pairCreatedAt: (T0 - 5 * 86400) * 1000 });
{ let p = openPosition(setup, { price: 1, stop: 0.9 }, 100, iso(T0), { ...BOT, slipPct: 0 }); const C = { ...BOT, slipPct: 0 }; let all = [];
  const step = (px, t, closes = null, o) => { const r = managePosition(p, q(px, o), closes, t, C); p = r.pos; all.push(...r.actions); return r.actions; };
  step(1.05, T0 + 600); ok(all.length === 0, 'between stop and TP1: nothing to do');
  const a1 = step(1.11, T0 + 1200); ok(a1.length === 1 && /TP1/.test(a1[0].why) && Math.abs(a1[0].units - 100 / 3) < 1e-6 && p.stop === 1, 'TP1 at +1R: a third sold, stop to break-even');
  const a2 = step(2.05, T0 + 3600); ok(a2.length === 1 && /ride free/.test(a2[0].why) && p.free && p.stop === 0 && Math.abs(p.bankedUsd - 100) < 1e-6, 'ride free at 2x: sells just enough that $100 is back in the bank');
  step(3.0, T0 + 7200, [[T0 + 6000, 2.8], [T0 + 6600, 3.0]]); const a3 = step(1.4, T0 + 9000, [[T0 + 6600, 3.0], [T0 + 8400, 1.45]]);
  ok(a3.length === 1 && /giveback/.test(a3[0].why) && a3[0].all && pnlOf(p, 0) > 0, 'giveback: a 5-minute close 50% under the best close sells the rest, and the trade still made money'); }
{ const C = { ...BOT, slipPct: 0 }, P = () => openPosition(setup, { price: 1, stop: 0.9 }, 100, iso(T0), C);
  ok(managePosition(P(), q(0.89), null, T0 + 600, C).actions[0].why === 'stop', 'hard stop');
  ok(/sellers took over/.test(managePosition(P(), q(0.91, { b1: 20, s1: 40, b5: 1, s5: 6 }), null, T0 + 600, C).actions[0].why), 'sellers took over while 9% under: out');
  ok(/volume died/.test(managePosition(P(), q(1.02, { h6: 3000 }), null, T0 + 600, C).actions[0].why), 'volume died: out');
  ok(/no follow-through/.test(managePosition(P(), q(0.98), null, T0 + 7 * 3600, C).actions[0].why), 'six hours, never reached +1R, under entry: out'); }

// one full cycle with fake feeds: setups -> quotes -> 5-minute trigger -> would-buy message, then a later cycle manages it
{ const cfg = { ...DEFAULTS, accountUsd: 1000, setupsEveryMin: 0, slipPct: 0, tradeAlerts: true }, st = newState(cfg), msgs = [], jr = [];
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', signal: 'Entry signal', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2 }];
  const deps = (now, price, bars) => ({ now: now * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: { ...q(price), url: 'https://dexscreener.com/solana/p1', liquidity: { usd: 400000 } } }), candles5: async () => bars, notify: async (t, b) => msgs.push(t + ' | ' + b), journal: (o) => jr.push(o) });
  await cycle(st, cfg, deps(T0 - 30, 1.05, base.slice(0, 1)));
  ok(Object.keys(st.setups).length === 1 && st.positions.length === 0, 'cycle 1: the bid-ready setup is on the watch list, no trigger yet');
  st.setups.P1.at = iso(T0 - 60); await cycle(st, cfg, deps(T0 + 16 * M + 30, 1.025, flush));
  ok(st.positions.length === 1 && /Would buy \$155 of AAA/.test(msgs.join('\n')) && /DRY RUN: no order was placed/.test(msgs[0]) && st.cash < 1000, 'cycle 2: trigger fires, the exact would-be order goes to the phone, nothing is bought');
  await cycle(st, cfg, deps(T0 + 20 * M, 0.95, flush));
  ok(st.positions.length === 0 && st.closed.length === 1 && /SELL ALL AAA/.test(msgs.join('\n')) && st.closed[0].pnl < 0, 'cycle 3: the stop is hit, a would-sell message, the paper loss is booked');
  ok(jr.some((x) => x.type === 'buy') && jr.some((x) => x.type === 'sell'), 'every decision is written to the journal'); }
// the bot takes the same setups as the paper Bot rules book, one per coin per 24 hours, and fetches candles once per closed 5-minute candle
{ const cfg = { ...DEFAULTS, setupsEveryMin: 0, slipPct: 0 }, st = newState(cfg); let calls = 0;
  const row = (coin, o) => ({ id: 'SOL:' + coin, coin, chain: 'Solana', pool: coin.toLowerCase(), signal: 'Watch', opp: 72, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000, rug: 'ok', ...o });
  let setupsJson = [row('OK1'), row('LOWSCORE', { opp: 65 }), row('THIN', { liquidity: 60000 }), row('RUG', { rug: 'danger' }), row('BID', { signal: 'Entry signal', opp: 81 })];
  const deps = (ms) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ ok1: { ...q(1.02), liquidity: { usd: 500000 } }, bid: { ...q(1.02), liquidity: { usd: 500000 } } }), candles5: async () => { calls++; return base; }, notify: async () => {}, journal: () => {}, heartbeat: async () => {} });
  await cycle(st, cfg, deps(T0 + 60)); ok(Object.keys(st.setups).sort().join() === 'bid,ok1', 'same filter as the paper book: score over 65, $100k+ liquidity, no rug danger');
  ok(calls === 2, 'one candle fetch per watched coin'); await cycle(st, cfg, deps(T0 + 120)); await cycle(st, cfg, deps(T0 + 180)); ok(calls === 2, 'no new fetch until the next 5-minute candle has closed');
  await cycle(st, cfg, deps(T0 + 400)); ok(calls === 4, 'next candle closed: fetched again');
  delete st.setups.ok1; await cycle(st, cfg, deps(T0 + 3 * 3600)); ok(!st.setups.ok1, 'a coin is not taken again within 24 hours (no buying straight back after a stop)');
  await cycle(st, cfg, deps(T0 + 25 * 3600)); ok(!!st.setups.ok1, 'after 24 hours the setup can come back'); }
// sizing counts slippage: a stop-out loses 1% of the account, not more
{ const cfg = { ...DEFAULTS, accountUsd: 1000, setupsEveryMin: 0, slipPct: 1 }, st = newState(cfg), jr = [];
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', signal: 'Watch', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000 }];
  const deps = (ms, price) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: { ...q(price), liquidity: { usd: 400000 } } }), candles5: async () => flush, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, cfg, deps(T0 - 30, 1.05)); st.setups.P1.at = iso(T0 - 60); await cycle(st, cfg, deps(T0 + 16 * M + 30, 1.025));
  const p = st.positions[0]; await cycle(st, cfg, deps(T0 + 17 * M + 30, p.stop)); const loss = -st.closed[0].pnl;
  ok(Math.abs(loss - 10) < 0.05, `stopped exactly at the stop with 1% slippage each way: lost $${loss.toFixed(2)} of the planned $10 (1% of $1,000)`); }
// the desk dashboard's data: $10,000 accounts, live prices on positions and setups, the equity curve, R on closed trades
{ ok(DEFAULTS.accountUsd === 10000 && newState(DEFAULTS).cash === 10000, 'paper accounts start with $10,000');
  const cfg = { ...DEFAULTS, setupsEveryMin: 0, slipPct: 0 }, st = newState(cfg);
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', signal: 'Watch', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000 }];
  const deps = (ms, price) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: { ...q(price), liquidity: { usd: 4000000 } } }), candles5: async () => flush, notify: async () => {}, journal: () => {}, heartbeat: async () => {} });
  const log0 = console.log; console.log = () => {};
  await cycle(st, cfg, deps(T0 - 30, 1.05)); ok(st.setups.P1.lastPx === 1.05 && st.eq.length === 1 && st.eq[0][1] === 10000, 'watched setups carry the live price; the equity curve starts at $10,000');
  st.setups.P1.at = iso(T0 - 60); await cycle(st, cfg, deps(T0 + 16 * M + 30, 1.025)); const p = st.positions[0];
  ok(p && p.lastPx === 1.025 && Math.abs(p.riskUsd - 100) < 0.01 && p.meta && p.meta.zoneHigh === 1.04 && p.meta.signal === 'watch', 'a position keeps its live price, its planned risk ($100 = 1% of $10,000) and its setup');
  await cycle(st, cfg, deps(T0 + 17 * M + 30, p.stop)); console.log = log0; const c = st.closed[0];
  ok(c && Math.abs(c.R + 1) < 0.01 && c.exitAvg > 0 && st.eq.length === 3, 'a closed trade records its result in R (a stop-out is -1R) and its average exit'); }
// execution realism: price impact in costs and sizing, pulled liquidity, the day's loss counting open positions
{ const { costPct } = await import('../bot/manage.mjs');
  ok(costPct(2000, 100000).inPct === 5 && costPct(125, 500000).impactPct === 0.05, 'a $2,000 buy in a $100k pool costs about 5% each way; $125 in a $500k pool next to nothing');
  const cfg = { ...DEFAULTS, setupsEveryMin: 0 }, st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', signal: 'Watch', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000 }];
  let liq = 500000; const deps = (ms, price) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: { ...q(price), liquidity: { usd: liq } } }), candles5: async () => flush, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, cfg, deps(T0 - 30, 1.05)); st.setups.P1.at = iso(T0 - 60); liq = 250000; await cycle(st, cfg, deps(T0 + 16 * M + 30, 1.025)); console.log = log0;
  ok(st.positions.length === 0 && jr.some((j) => j.type === 'drop' && /liquidity fell 50%/.test(j.why)), 'liquidity halved since the setup: the buy is dropped (pool being pulled)');
  const st2 = newState(cfg); console.log = () => {}; liq = 120000; setupsJson[0].liquidity = 120000; await cycle(st2, cfg, deps(T0 - 30, 1.05)); st2.setups.P1.at = iso(T0 - 60); await cycle(st2, cfg, deps(T0 + 16 * M + 30, 1.025)); console.log = log0;
  const p = st2.positions[0]; ok(p && p.slipOut > 1 && p.costUsd * p.slipOut < 1e9 && Math.abs(p.remUnits * (p.entry - p.stop * (1 - p.slipOut / 100)) - 100) < 3, 'in a thin pool the size is cut so the loss at the stop, after impact both ways, is still 1% of the account');
  const st3 = newState(cfg); st3.cash = 8000; st3.positions.push({ ...p, id: 'x', pool: 'P1', remUnits: 2000, units: 2000, entry: 1, stop: 0.5, stop0: 0.5, costUsd: 2000, bankedUsd: 0, lastPx: 1, free: false, tp1Done: false, sells: [], peak: 1, peakClose: 1, tp1: 1.5, freeAt: 2, openedAt: iso(T0 - 60) });
  console.log = () => {}; await cycle(st3, cfg, deps(T0, 1.0)); await cycle(st3, cfg, deps(T0 + 60, 0.8)); console.log = log0;
  ok(st3.blocks.some((b) => /daily loss limit/.test(b[2])), 'an open position down hard counts toward the daily loss limit, not only sold trades'); }
// what the bot passed on is followed for 24 hours, and the fill is compared with the trigger price
{ const cfg = { ...DEFAULTS, setupsEveryMin: 0 }, st = newState(cfg), log0 = console.log; console.log = () => {};
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', signal: 'Watch', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000 }];
  const deps = (ms, price) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: { ...q(price), liquidity: { usd: 500000 } } }), candles5: async () => flush, notify: async () => {}, journal: () => {}, heartbeat: async () => {} });
  await cycle(st, cfg, deps(T0 - 30, 1.05)); st.setups.P1.at = iso(T0 - 60); await cycle(st, cfg, deps(T0 + 16 * M + 30, 1.025));
  ok(st.positions[0].meta.trigPx === 1.02 && st.positions[0].meta.quotePx === 1.025, 'the fill records the trigger price (the trigger candle closed at 1.02) and the price actually paid (1.025)');
  const st2 = newState(cfg); await cycle(st2, cfg, deps(T0 - 30, 1.05)); st2.setups.P1.at = iso(T0 - 60); await cycle(st2, cfg, deps(T0 + 16 * M + 30, 1.09)); await cycle(st2, cfg, deps(T0 + 16 * M + 90, 1.09)); // too far over the zone: dropped, listed on the next check
  ok(st2.positions.length === 0 && st2.passed.length === 1 && /no chasing/.test(st2.passed[0].why) && st2.passed[0].px0 === 1.09, 'a dropped setup goes on the passed-on list with the price at the time');
  await cycle(st2, cfg, deps(T0 + 17 * M, 1.3)); await cycle(st2, cfg, deps(T0 + 18 * M, 0.85)); ok(st2.passed[0].hi === 1.3 && st2.passed[0].lo === 0.85 && !st2.passed[0].done, 'its best and worst prices are followed');
  await cycle(st2, cfg, deps(T0 + 26 * 3600, 1.0)); console.log = log0; ok(st2.passed[0].done === true, 'after 24 hours it stops following'); }
process.exit(f);
