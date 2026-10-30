// Breakout retest: the shared setup rule, the bot tuner (hints confirmed only on new trades), the pattern analyst fixes,
// the Breakout bot (limit entry, thirds at TP1/TP2/TP3, break-even, 7 days), its reality check, and the per-bot watchdog.
import { brkSetup, BOOKS } from '../docs/strategies.mjs';
import { runExit, PROFILES } from '../docs/exits.mjs';
import { keeps, split, tune, forwardTrades, labelOf, TUNE } from '../docs/tuner.mjs';
import { dossier } from '../src/analyst.mjs';
import { FEATS } from '../docs/features.mjs';
import { decideLimit, openLadder, manageLadder, BOT } from '../bot/manage.mjs';
import { cycle, newState, loadConfig, BOTS, RETIRED, DEFAULTS } from '../bot/run.mjs';
import { realityCheck } from '../bot/reality.mjs';
import { decide, message, botsIn } from '../src/botwatch.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-22T00:00:00Z'), H = 3600e3, iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

// shared setup rule
{ const p = { setupType: 'Breakout retest', opp: 58, liq: 300000, rug: 'ok', sp: { valid: true, entryLow: 1.0, entryHigh: 1.05, entryMid: 1.025, stop: 0.8, tp1: 1.3, tp2: 1.7, tp3: 2.2, rr2: 3.2, riskPct: 22 } };
  const b = brkSetup(p, 'Normal'); ok(b && b.zoneHigh === 1.05 && b.rr2 === 3.2 && b.riskPct === 22 && b.volDay === 'Normal' && b.expireH === 48, 'Breakout retest setup: the pattern plan with reward to risk, stop distance and volume day');
  ok(!brkSetup({ ...p, opp: 45 }) && !brkSetup({ ...p, liq: 50000 }) && !brkSetup({ ...p, rug: 'danger' }) && !brkSetup({ ...p, setupType: 'Bull flag' }) && !brkSetup({ ...p, sp: { ...p.sp, valid: false } }), 'score under 50, thin liquidity, rug danger, another pattern or an invalid plan: no setup');
  ok(BOOKS.brk.profile === 'brk' && BOOKS.brkTrig.same === 'brk' && BOOKS.brkTrig.entryVariant && BOOKS.brkBot.profile === 'brk', 'three research books: as backtested, bot filters, 5-minute trigger'); }

// the backtest's exits as a paper profile, and absolute targets on a trigger fill
{ const hb = (i, o, h, l, c) => [T0 / 1000 + i * 3600, o, h, l, c, 100], P = { ...PROFILES.brk, slipPct: 0, exitSlipPct: 0 };
  const s = { signalAt: iso(T0 - 60e3), plan: { limit: 1.05, stop: 0.8, targets: [[1.3, 1 / 3], [1.7, 1 / 3], [2.2, 1 / 3]], expireH: 48 } };
  const r = runExit(s, [hb(0, 1.1, 1.12, 1.04, 1.06), hb(1, 1.06, 1.35, 1.05, 1.3), hb(2, 1.3, 1.32, 1.0, 1.02)], iso(T0 + 400 * H), P);
  ok(r.entryPx === 1.05 && r.fills[0].why === 'tp1' && r.fills[1].px === 1.05 && /stopped/.test(r.status) && r.retPct > 0, 'as backtested: limit at the top of the zone, a third at TP1, then out at break-even');
  const t = runExit({ signalAt: iso(T0 - 60e3), fill: { px: 1.0, at: iso(T0 + 1800e3) }, stopPx: 0.8, targets: [[1.3, 1 / 3], [1.7, 1 / 3], [2.2, 1 / 3]] }, [hb(0, 1, 1.02, 0.98, 1.0), hb(1, 1.0, 1.75, 0.99, 1.7)], iso(T0 + 400 * H), P);
  ok(t.fills.map((x) => x.why).join() === 'tp1,tp2' && t.stop0 === 0.8, 'trigger fill: the plan stop and plan targets still apply (tests the entry only)'); }

// tuner: filters from hints, judged only on trades after they were found
{ const k1 = 'Reward to risk (TP2)|3R+|only', k2 = 'Chain|Robinhood|only', k3 = 'Volume day|Strong|skip';
  ok(keeps(k1, { rr2: 3.4 }) && !keeps(k1, { rr2: 2.5 }) && !keeps(k1, {}) && keeps(k3, {}) && !keeps(k3, { volDay: 'Strong' }) && labelOf(k1) === 'only when reward to risk (TP2) is 3R+', 'filters: "only" needs the value, "skip" keeps unknowns');
  const sp = split(k3, [{ R: 1, volDay: 'Normal' }, { R: -1, volDay: 'Strong' }, { R: 5 }]); ok(sp.kept === 1 && sp.removed === 1 && sp.diff === 2, 'a trade with the feature unknown is left out of both sides');
  const cfg = { ...TUNE.breakout, from: iso(T0) }, mk = (i, R, o) => ({ coin: 'C' + i, at: iso(T0 + i * H), R, chain: 'Solana', rr2: 3.5, riskPct: 12, volDay: 'Normal', ...o });
  const t0 = tune({ cfg, hints: [{ feat: 'Chain', bucket: 'Robinhood', side: 'only' }, { feat: 'Volume day', bucket: 'Strong', side: 'skip' }], now: T0 - H });
  ok(t0.active.join() === k1 && t0.candidates.length === 3 && t0.candidates.every((c) => c.status === 'testing'), 'day one: only the starting filter is on; every hint is testing');
  const fwd = []; for (let i = 0; i < 10; i++) fwd.push(mk(i, i % 2 ? 1.2 : 0.8, { chain: 'Robinhood' })); for (let i = 10; i < 18; i++) fwd.push(mk(i, -0.9));
  const t1 = tune({ cfg, hints: [], forward: fwd, prev: t0, now: T0 + 30 * H }), rh = t1.candidates.find((c) => c.key === k2);
  ok(rh.status === 'confirmed' && t1.active.includes(k2) && t1.on.includes(k2) && t1.candidates.length === 3, 'a hint that holds on 10+ new trades switches on by itself (and is remembered after the learning loop drops it)');
  const bad = []; for (let i = 0; i < 10; i++) bad.push(mk(i, -0.8)); for (let i = 10; i < 18; i++) bad.push(mk(i, 0.9, { rr2: 2.4 }));
  const t2 = tune({ cfg, forward: bad, prev: t0, now: T0 + 30 * H }); ok(!t2.active.includes(k1) && t2.off.includes(k1) && t2.candidates.find((c) => c.key === k1).status === 'rejected', 'a starting filter that new trades contradict switches off');
  const noisy = []; for (let i = 0; i < 12; i++) noisy.push(mk(i, i % 2 ? 2.2 : -1, { chain: 'Robinhood' })); for (let i = 12; i < 22; i++) noisy.push(mk(i, i % 2 ? 1.6 : -1));
  const tn = tune({ cfg, forward: noisy, prev: t1.candidates ? { ...t1, active: [k1] } : t0, now: T0 + 30 * H }), rn = tn.candidates.find((c) => c.key === k2);
  ok(rn.status !== 'confirmed' && !tn.active.includes(k2) && rn.forward.kept === 12 && rn.forward.diff >= 0.3, 'a 0.3R+ gap on noisy wins and losses is not enough: it has to pass the luck check');
  const pre = tune({ cfg, forward: fwd.map((x) => ({ ...x, at: iso(T0 - 50 * H) })), prev: t0, now: T0 + 30 * H }); ok(pre.forwardN === 0 && pre.active.join() === k1, 'trades from before the tuner started never confirm anything');
  const lab = [{ lid: 'brk|x', book: 'brk', profile: 'brk', coin: 'AAA', chain: 'Robinhood', pool: 'p', signalAt: iso(T0), entryAt: iso(T0), entryPx: 1, stop0: 0.8, fills: [{ t: iso(T0 + H), level: 1.2, px: 1.2, frac: 1, why: 'tp1' }], rem: 0, status: 'hit TP3', closedAt: iso(T0 + H), rr2: 3.1, riskPct: 20, volDay: 'Normal' }];
  const ft = forwardTrades({ pattern: 'Breakout retest', book: 'brk', lab, forward: [{ setup: 'Breakout retest', coin: 'AAA', signalAt: iso(T0 + 600e3), resultR: -1, chain: 'Robinhood' }, { setup: 'Breakout retest', coin: 'BBB', signalAt: iso(T0), resultR: 0.5, chain: 'Solana', entryMid: 1, stop: 0.9 }], now: T0 + 5 * H });
  ok(ft.length === 2 && ft[0].src === 'paper' && Math.abs(ft[0].R - 1) < 1e-9 && ft[1].riskPct === 10, 'forward trades: the paper book first, the same coin on the same day counted once'); }

// pattern analyst: slices compare like with like; backtest and live records shown apart
{ const tr = []; for (let i = 0; i < 20; i++) tr.push({ setup: 'Breakout retest', source: 'backtest-nm', resultR: i % 3 ? 1.5 : -1, chain: 'Solana', at: iso(T0 + i * H), mfeR: 0.2 });
  for (let i = 0; i < 7; i++) tr.push({ setup: 'Breakout retest', source: 'shadow', resultR: i % 2 ? -1 : 0.2, chain: 'Solana', volDay: 'Strong', at: iso(T0 + (30 + i) * H), mfeR: 0.2 });
  const d = dossier('Breakout retest', tr, FEATS);
  ok(!d.conditions.avoid.some((c) => /Volume day/.test(c.text)), 'volume day exists only on live-tracked trades, so it is no longer compared against backtest replays');
  ok(d.split.backtest.n === 20 && d.split.tracked.n === 7 && /tracked as it happened/.test(d.split.comment) && /flatter/.test(d.split.comment), 'the dossier shows backtest replays and live-tracked trades apart, and says when the replays flatter');
  ok(d.conditions.best.every((c) => c.feat && c.bucket && c.side === 'only'), 'conditions carry the feature and bucket for the tuner'); }

// the Breakout bot's rules
{ const s = { pool: 'P', coin: 'AAA', chain: 'Robinhood', zoneLow: 1.0, zoneHigh: 1.05, stop: 0.8, tp1: 1.3, tp2: 1.7, tp3: 2.2, expireH: 48, at: iso(T0) }, now = T0 / 1000 + 3600;
  const BC = { ...BOT, maxStopPct: 35 }; ok(decideLimit(s, 1.1, now, BC) === null && decideLimit(s, 1.04, now, BC).act === 'buy' && decideLimit(s, 0.79, now, BC).act === 'drop' && decideLimit(s, 1.04, T0 / 1000 + 49 * 3600, BC).act === 'drop' && decideLimit(s, 1.04, now, { ...BOT, maxStopPct: 20 }).act === 'drop', 'limit entry: waits above the zone, buys inside it, cancels through the stop, after 48 hours, or past the stop cap');
  const C = { ...BOT, slipPct: 0, maxHoldH: 168 }; let p = openLadder(s, { price: 1.04, stop: 0.8 }, 104, iso(T0), C); const q = (px) => ({ priceUsd: String(px) }), acts = [];
  const step = (px, t) => { const r = manageLadder(p, q(px), t, C); p = r.pos; acts.push(...r.actions); };
  step(1.31, now); ok(acts.length === 1 && /^TP1/.test(acts[0].why) && p.stop === 1.04, 'TP1: a third, stop to break-even'); step(1.72, now + 60); ok(acts.length === 2 && /^TP2/.test(acts[1].why), 'TP2: another third');
  step(1.03, now + 120); ok(acts.length === 3 && acts[2].why === 'break-even stop' && p.remUnits === 0, 'falls back to the entry: the rest out at break-even');
  let p2 = openLadder(s, { price: 1.04, stop: 0.8 }, 104, iso(T0), C); const r2 = manageLadder(p2, q(1.1), T0 / 1000 + 169 * 3600, C); ok(/time limit \(7 days\)/.test(r2.actions[0].why), '7 days: out'); }

// the Breakout bot end to end: breakouts.json, the tuner's filters from council.json, a would-be buy, and a filter change note
{ const cfg = { ...loadConfig('breakout'), accountUsd: 1000, setupsEveryMin: 0, slipPct: 0 }, st = newState(cfg), msgs = [], logs = [], jr = [];
  const row = (coin, o) => ({ coin, chain: 'Robinhood', pool: coin.toLowerCase(), opp: 60, liquidity: 400000, rug: 'ok', zoneLow: 1.0, zoneHigh: 1.05, stop: 0.8, tp1: 1.3, tp2: 1.7, tp3: 2.2, rr2: 3.4, riskPct: 22, volDay: 'Normal', expireH: 48, at: iso(T0), ...o });
  let council = { botTuning: { breakout: { active: ['Reward to risk (TP2)|3R+|only'] } } }; const rows = [row('GOOD'), row('LOWRR', { rr2: 2.4 }), row('WIDE', { riskPct: 40 }), row('THIN', { liquidity: 50000 })];
  const deps = (ms, px) => ({ now: ms, getJson: async (u) => (u.endsWith('breakouts.json') ? rows : u.endsWith('council.json') ? council : []), quotes: async () => ({ good: { priceUsd: String(px), liquidity: { usd: 400000 }, url: 'u' } }), candles5: async () => { throw new Error('the breakout bot never needs candles'); }, notify: async (t, b) => msgs.push(t + ' | ' + b), journal: (o) => jr.push(o), heartbeat: async () => {} });
  console.log = (...a) => logs.push(a.join(' '));
  await cycle(st, cfg, deps(T0 + H, 1.2)); ok(Object.keys(st.setups).join() === 'good' && st.positions.length === 0, 'takes only the setups that pass the tuner filter, the 35% stop cap and liquidity; waits above the zone');
  await cycle(st, cfg, deps(T0 + 2 * H, 1.04)); ok(st.positions.length === 1 && st.positions[0].mode === 'ladder' && st.positions[0].book === 'brkBot' && logs.some((l) => /RynoBot Breakout \(dry run\): BUY GOOD/.test(l)) && msgs.length === 0, 'price back in the zone: a would-be buy (logged, not sent), ladder exits, paper twin brkBot');
  const loss = (() => { const p = st.positions[0]; return p.remUnits * (p.entry - p.stop); })(); ok(Math.abs(loss - 10) < 0.01, 'risk at the stop is 1% of the account');
  council = { botTuning: { breakout: { active: ['Reward to risk (TP2)|3R+|only', 'Chain|Robinhood|only'] } } }; await cycle(st, cfg, deps(T0 + 3 * H, 1.1));
  console.log = out; ok(msgs.length === 1 && /RynoBot Breakout: filters changed/.test(msgs[0]) && /On: only when chain is Robinhood/.test(msgs[0]) && jr.some((j) => j.type === 'filters'), 'the tuner switched a filter on: one phone note saying what changed (sizing untouched)');
  ok(Object.keys(BOTS).join() === 'riskyclaude,riskyryan,volrider,breakout,bottoms,bestof' && ['runner', 'minute', 'ignition', 'rider', 'copy', 'trenchlab', 'trenchshot', 'trenchx', 'trenchbonus', 'trench', 'basebreak'].every((k) => RETIRED[k]) && DEFAULTS.name === 'rules' && cfg.name === 'breakout' && cfg.maxStopPct === 35 && cfg.minOpp === 50, 'the 30 Oct lineup: the two risky bots, breakout, bottomed-out and best-of; the losing bots retired (the retired rules book stays as the defaults)'); }

// reality check against the Breakout bot's paper twin
{ const paper = [], closed = [];
  for (let i = 0; i < 10; i++) { paper.push({ lid: 'brkBot|p' + i, book: 'brkBot', profile: 'brk', coin: 'C' + i, chain: 'Robinhood', pool: 'p' + i, signalAt: iso(T0 + i * 10 * H), entryAt: iso(T0 + i * 10 * H), entryPx: 1, stop0: 0.8, fills: [{ t: iso(T0 + (i * 10 + 1) * H), level: 1.3, px: 1.3, frac: 1 / 3, why: 'tp1' }, { t: iso(T0 + (i * 10 + 2) * H), level: 1, px: 1, frac: 2 / 3, why: 'stop' }], rem: 0, status: 'stopped after TP1', closedAt: iso(T0 + (i * 10 + 2) * H) });
    closed.push({ coin: 'C' + i, pool: 'p' + i, book: 'brkBot', openedAt: iso(T0 + i * 10 * H + 120e3), entry: 1.01, stop0: 0.8, costUsd: 100, pnl: -20, sells: [{ why: 'stop' }] }); }
  const r = realityCheck({ closed, startedAt: iso(T0 - H) }, paper, { now: T0 + 200 * H, cfg: { book: 'brkBot', everyDays: 14, matchH: 3, minN: 10 } });
  ok(r.n === 10 && r.book === 'brkBot' && r.paperFurther === 10 && r.call === 'paper flatters', 'the Breakout bot is compared with its own paper twin, target by target'); }

// the watchdog watches each bot on its own
{ const hb = (ms, n) => ({ time: ms / 1000, message: `hb:${n} ${iso(ms)}` }), now = T0 + H; const msgs = [hb(now - 10 * 60e3, 'rules'), hb(now - 7 * H, 'breakout')];
  ok(botsIn(msgs).sort().join() === 'breakout,rules' && decide(msgs, { now, name: 'rules' }).action === 'ok' && decide(msgs, { now, name: 'breakout' }).action === 'alert', 'one bot quiet, the other fine: only the quiet one is reported');
  ok(/RynoBot breakout has gone quiet/.test(message(decide(msgs, { now, name: 'breakout' }), 'breakout').title) && /systemctl status rynobot@breakout/.test(message(decide(msgs, { now, name: 'breakout' }), 'breakout').body), 'the alert names the bot and the exact service to check');
  ok(decide([...msgs, { time: (now - H) / 1000, message: 'quiet-alerted:breakout' }], { now, name: 'breakout' }).action === 'already', 'reported once per outage, per bot'); }
process.exit(f);
