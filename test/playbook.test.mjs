// Playbook books (Fib pullback, inside the pattern), limit entries, new pattern detectors, lifecycle tags and the wallet scorecard.
import { runExit, PROFILES, fromRun, book } from '../docs/exits.mjs';
import { fibSetup, insideSetup, lifecycle, BOOKS } from '../docs/strategies.mjs';
import * as C from '../docs/core.mjs';
import * as SCO from '../src/scorecard.mjs';
import { netFlows } from '../src/wallets.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-18T00:00:00Z') / 1000, H = 3600, hb = (i, o, h, l, c) => [T0 + i * H, o, h, l, c, 100], sig = '2026-10-17T23:59:00Z';

// limit entries with price targets
{ const plan = { limit: 1.5, stop: 1.2, targets: [[2, 0.3], [2.3, 0.3], [2.6, 0.2]], expireH: 48, cancelAbove: 2.04 };
  const P = { ...PROFILES.fibPull, slipPct: 0 }, bars = [hb(0, 1.8, 1.85, 1.7, 1.75), hb(1, 1.75, 1.76, 1.45, 1.6), hb(2, 1.6, 2.1, 1.55, 2.05), hb(3, 2.05, 2.4, 2.0, 2.35)];
  const r = runExit({ signalAt: sig, plan }, bars, 'n', P); ok(r.entryPx === 1.5 && r.entryAt === '2026-10-18T01:00Z', 'limit fills when a candle trades down to it');
  ok(r.fills.map((x) => x.why).join() === 'tp1,tp2' && r.fills[0].level === 2 && r.status === 'open', 'targets are prices: old high, then the 1.272 extension');
  const g = runExit({ signalAt: sig, plan }, [hb(0, 1.8, 1.85, 1.7, 1.75), hb(1, 1.6, 1.62, 1.4, 1.5)], 'n', P); ok(g.entryPx === 1.5 && g.fills.length === 0, 'fill candle: no target counted on the same candle');
  const gap = runExit({ signalAt: sig, plan }, [hb(0, 1.4, 1.45, 1.3, 1.35)], 'n', P); ok(gap.entryPx === 1.4, 'a gap below the limit fills at the open');
  const run = runExit({ signalAt: sig, plan }, [hb(0, 1.8, 2.1, 1.7, 2.05)], 'n', P); ok(/^cancelled/.test(run.status), 'a new high before the pullback cancels the order');
  const exp = runExit({ signalAt: sig, plan }, Array.from({ length: 50 }, (_, i) => hb(i, 1.8, 1.85, 1.7, 1.8)), 'n', P); ok(exp.status === 'expired (no fill)', 'unfilled after 48 hours: expired');
  const st = runExit({ signalAt: sig, plan }, [hb(0, 1.8, 1.85, 1.7, 1.75), hb(1, 1.7, 1.72, 1.1, 1.15)], 'n', P); ok(st.status === 'stopped out' && st.fills[0].level === 1.2, 'stop on the fill candle counts');
  ok(fromRun({ ...run, lid: 'x', profile: 'fibPull', plan }) === null && fromRun({ lid: 'w', profile: 'fibPull', status: 'waiting for entry', signalAt: sig, plan }).entryLow === 1.5, 'cancelled orders are not trades; waiting shows the limit'); }
// trailing stop never uses the high and low of the same candle
{ const P = { ...PROFILES.degen, slipPct: 0 }, bars = [hb(0, 1, 2.05, 0.95, 2), hb(1, 2, 3, 2.05, 2.1)];
  const r = runExit({ signalAt: sig }, bars, 'n', P); ok(r.status === 'open' && r.stopNow < 2.1, 'a candle that spikes and fades does not trail itself out'); }

// first Fib pullback
{ const now = T0 + 60 * H; const up = []; for (let i = 0; i < 40; i++) { const p = 1 + i * 0.03; up.push(hb(i, p, p * 1.01, p * 0.99, p * 1.005)); } // 1 -> ~2.2
  const top = up[up.length - 1][4]; const bars = [...up, hb(40, top, top * 1.02, top * 0.97, top * 0.98), hb(41, top * 0.98, top * 0.99, top * 0.9, top * 0.92)];
  const s = fibSetup(bars, now); ok(s && s.limit > 1 && s.limit < top && s.stop < s.limit && s.targets.length === 3 && s.targets[0][0] > top, 'Fib setup: limit at the 0.5 retrace, stop below, targets above the high');
  const deep = [...bars, hb(42, top * 0.92, top * 0.93, 1.1, 1.15)]; ok(fibSetup(deep, now + 2 * H) === null, 'not a first pullback once it trades below 0.618');
  const flat = Array.from({ length: 60 }, (_, i) => hb(i, 1, 1.02, 0.98, 1)); ok(fibSetup(flat, now) === null, 'no run, no setup'); }

// inside the pattern
{ const p = { lastClose: 1.1, pats: [{ name: 'Falling wedge', status: 'forming', quality: 70, trigger: 1.3, stopBase: 1.0, H: 0.5, plan: { stop: 0.95 } }, { name: 'Bull flag', status: 'breakout', quality: 90, trigger: 1.2, stopBase: 1, H: 0.4, plan: { stop: 0.9 } }] };
  const s = insideSetup(p); ok(s.length === 1 && s[0].plan.limit === 1.099 && s[0].plan.cancelAbove === 1.3 && s[0].plan.targets[0][0] === 1.3, 'inside setup: bid the lower third, cancel on breakout, first target is the breakout line');
  ok(insideSetup({ lastClose: 1.35, pats: p.pats }).length === 0, 'already above the breakout line: no inside entry'); }

// new detectors
{ const mk = (cl) => cl.map((c, i) => { const o = i ? cl[i - 1] : c; return [1792000000 + i * 14400, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 100]; }), seg = (a, b, k) => Array.from({ length: k }, (_, i) => a + (b - a) * (i + 1) / k);
  const ihs = [2.2, ...seg(2.2, 2.0, 10), ...seg(2.0, 1.2, 14), ...seg(1.2, 1.45, 6), ...seg(1.45, 1.0, 7), ...seg(1.0, 1.46, 7), ...seg(1.46, 1.22, 6), ...seg(1.22, 1.33, 5)];
  ok(C.detectPatterns(mk(ihs)).some((q) => q.name === 'Inverse H&S' && q.status === 'forming' && q.quality >= 55), 'inverse head and shoulders is detected');
  const cup = [1.2, ...seg(1.2, 2.0, 12), ...seg(2.0, 1.6, 6), ...seg(1.6, 1.32, 6), 1.3, 1.31, 1.3, 1.32, 1.31, ...seg(1.31, 1.6, 6), ...seg(1.6, 1.98, 6), ...seg(1.98, 1.82, 5), ...seg(1.82, 1.9, 3)];
  ok(C.detectPatterns(mk(cup)).some((q) => q.name === 'Cup & handle' && q.status === 'forming' && q.quality >= 55), 'cup and handle is detected'); }

// lifecycle
ok(lifecycle({ ageD: 1 }) === 'new (under 3 days)' && lifecycle({ ageD: 9, dv: [10, 100, 90, 80, 70, 60, 50], ch7d: -10 }) === 'fading' && lifecycle({ ageD: 9, dv: [90, 100, 90], ch7d: 20 }) === 'sweet spot', 'lifecycle phases');

// wallet scorecard
{ const nf = netFlows([{ wallet: 'a', kind: 'buy', usd: 500 }, { wallet: 'a', kind: 'sell', usd: 100 }, { wallet: 'b', kind: 'buy', usd: 300 }, { wallet: 'b', kind: 'sell', usd: 290 }, { wallet: 'c', kind: 'sell', usd: 400 }]);
  ok(nf.buyers.map((x) => x[0]).join() === 'a' && nf.sellers.map((x) => x[0]).join() === 'c', 'net buyers and sellers (churners left out)');
  const eps = []; const day = (d) => new Date(Date.parse('2026-09-01T06:00:00Z') + (d - 1) * 864e5).toISOString().slice(0, 19) + 'Z';
  for (let d = 1; d <= 60; d++) SCO.record(eps, { pool: 'p' + d, coin: 'C' + d, px: 1, t: day(d), buyers: [['bot', 1], ['w' + (d % 7), 1], ...(d % 5 === 0 ? [['smart', 1]] : [])] });
  SCO.record(eps, { pool: 'p3', coin: 'C3', px: 1, t: day(3), buyers: [['extra', 1]] }); ok(eps.length === 60 && eps.find((e) => e.id === 'p3@2026-09-03').b.includes('extra'), 'one episode per coin per day, buyers merged');
  const barsRun = (t) => { const s = Date.parse(t) / 1000; return Array.from({ length: 80 }, (_, i) => [s + i * 3600, i >= 10 ? 1.3 : 1, i === 10 ? 1.8 : i >= 10 ? 1.35 : 1.05, 0.95, i >= 10 ? 1.3 : 1]); }, barsFlat = (t) => { const s = Date.parse(t) / 1000; return Array.from({ length: 80 }, (_, i) => [s + i * 3600, 1, 1.05, 0.9, 1]); };
  for (const e of eps) e.out = SCO.resolve(e, e.b.includes('smart') ? barsRun(e.t) : barsFlat(e.t));
  ok(eps.every((e) => e.out) && eps.filter((e) => e.out.ran).length === 12, 'outcome: +50% within 72 hours counts as a run');
  ok(SCO.resolve({ t: day(1), px: 1 }, barsFlat(day(1)).slice(0, 20)) === null, 'no outcome before 72 hours have passed');
  const sc = SCO.score(eps); ok(sc.provenSet.has('smart') && !sc.provenSet.has('bot') && sc.botSet.has('bot') && Math.abs(sc.base - 0.2) < 1e-9, 'the wallet in every winner is proven; the wallet in every coin is treated as a bot');
  ok(sc.proven[0].copyPct > 20 && eps.find((e) => e.b.includes('smart')).out.copy > 20, 'copyable return: in at the next hourly open plus 3%, out at the 24-hour close less 1%');
  { const e2 = eps.map((e) => ({ ...e, ageH: e.b.includes('smart') ? 0.5 : 48 })); ok(!SCO.score(e2).provenSet.has('smart') && SCO.score(e2).snipers >= 1, 'a wallet first seen buying pools under an hour old is a sniper: purged'); }
  { const e3 = eps.map((e) => ({ ...e, bots: e.b.includes('smart') ? ['smart'] : [] })); ok(!SCO.score(e3).provenSet.has('smart'), 'over 100 swaps in one read: a bot, purged'); }
  { const e4 = eps.map((e) => ({ ...e, out: e.out && e.b.includes('smart') ? { ...e.out, copy: e.id === 'p5@2026-09-05' ? 500 : 1 } : e.out })); ok(SCO.score(e4).proven.every((r) => r.w !== 'smart') && SCO.score(e4).candidates.find((r) => r.w === 'smart').cherry, 'profit from one trade: cherry-picked, not proven'); }
  ok(!sc.proven.some((r) => /^w/.test(r.w)), 'ordinary wallets with average luck are not proven');
  const pi = SCO.provenIn({ netBuyers: [['smart', 900], ['x', 10]], netSellers: [['smart', 5]] }, sc); ok(pi.in === 1 && pi.out === 1, 'counts proven wallets buying and selling');
  ok(SCO.trim(eps, Date.parse('2027-03-30T00:00:00Z')).length === 0, 'old episodes are dropped');
  const s2 = SCO.summary(sc, [], 'now'); ok(s2.proven.length >= 1 && typeof s2.rule === 'string' && !('provenSet' in s2), 'dashboard summary has no internal sets'); }
ok(['fibPull', 'patInside', 'proven'].every((k) => BOOKS[k] && BOOKS[k].group === 'play'), 'playbook books registered');
process.exit(f);
