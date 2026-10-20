// Phone = health only: the bot keeps would-be trades in its log, alerts once when a feed has been down long enough (and when it
// clears), sends a heartbeat to the silent topic, and the GitHub watchdog reports a bot that has gone quiet, once.
import { decide, message } from '../src/botwatch.mjs';
import { cycle, newState, DEFAULTS, health } from '../bot/run.mjs';
import fs from 'node:fs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-21T00:00:00Z'), M = 60e3, H = 3600e3, iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

// GitHub watchdog: is the bot alive? (T0 is 10am Brisbane)
{ const hb = (ms) => ({ time: ms / 1000, message: 'hb ' + iso(ms) }), mark = (ms, t) => ({ time: ms / 1000, message: t });
  ok(decide([], { now: T0 }).action === 'none', 'no heartbeat in 12 hours (bot not installed yet): stays quiet');
  ok(decide([hb(T0 - 20 * M)], { now: T0 }).action === 'ok', 'heartbeat 20 minutes ago: fine');
  const d = decide([hb(T0 - 2 * H)], { now: T0 }); ok(d.action === 'alert' && /gone quiet/.test(message(d).title) && /08:00 Brisbane/.test(message(d).body) && /systemctl status rynobot/.test(message(d).body), 'two hours without a heartbeat: one alert with when it stopped and what to check');
  ok(decide([hb(T0 - 2 * H), mark(T0 - 30 * M, 'quiet-alerted')], { now: T0 }).action === 'already', 'the same outage is not reported twice');
  ok(decide([hb(T0 - 10 * H)], { now: T0 - 8 * H }).action === 'wait', 'at 2am it waits until 6am Brisbane');
  const b = decide([hb(T0 - 3 * H), mark(T0 - H, 'quiet-alerted'), hb(T0 - 5 * M)], { now: T0 }); ok(b.action === 'back' && /is back/.test(message(b).title), 'heartbeats start again: one "back" message');
  ok(decide([hb(T0 - 3 * H), mark(T0 - H, 'quiet-alerted'), hb(T0 - 5 * M), mark(T0 - 4 * M, 'back-noted')], { now: T0 }).action === 'ok', 'and only once'); }

// bot health helper: alert once after the wait, then once when it clears
{ const st = {}, msgs = [], N = async (t, b) => msgs.push(t + ' | ' + b), o = { afterMin: 15, title: 'prices', text: (m, why) => `down ${m} min (${why})` };
  await health(st, 'prices', 'no prices', T0, N, o); await health(st, 'prices', 'no prices', T0 + 10 * M, N, o); ok(msgs.length === 0, 'a short blip stays quiet');
  await health(st, 'prices', 'no prices', T0 + 16 * M, N, o); await health(st, 'prices', 'no prices', T0 + 30 * M, N, o); ok(msgs.length === 1 && /RynoBot problem: prices \| down 16 min/.test(msgs[0]), 'after 15 minutes: one alert, not one a minute');
  await health(st, 'prices', false, T0 + 40 * M, N, o); ok(msgs.length === 2 && /back to normal/.test(msgs[1]) && !st.health.prices, 'when it clears: one note');
  await health(st, 'x', 'blip', T0, N, o); await health(st, 'x', false, T0 + M, N, o); ok(msgs.length === 2, 'a problem that never alerted clears silently'); }

// the bot loop with the default settings: trades stay in the log, outages reach the phone, heartbeats go to the silent topic
{ const cfg = { ...DEFAULTS, setupsEveryMin: 10, slipPct: 0 }, st = newState(cfg), msgs = [], hbs = [], logs = [], log0 = console.log; console.log = (...a) => logs.push(a.join(' '));
  const pos = { id: 'P1@x', coin: 'AAA', chain: 'Solana', pool: 'P1', openedAt: iso(T0), entry: 1, stop0: 0.9, stop: 0.9, R: 0.1, tp1: 1.1, freeAt: 2, costUsd: 100, units: 100, remUnits: 100, bankedUsd: 0, tp1Done: false, free: false, peak: 1, peakClose: 1, sells: [] };
  st.positions.push(pos); st.cash -= 100;
  let feed = 'up', pages = 'up'; const q = (px) => ({ p1: { priceUsd: String(px), txns: { h1: { buys: 50, sells: 40 }, m5: { buys: 5, sells: 4 } }, volume: { h6: 30000, h24: 100000 }, pairCreatedAt: T0 - 5 * 86400e3 } });
  const deps = (ms, px) => ({ now: ms, getJson: async (u) => { if (pages !== 'up') throw new Error('HTTP 503'); return []; }, quotes: async () => (feed === 'up' ? q(px) : {}), candles5: async () => [[T0 / 1000, 1, 1, 1, 1, 1]], notify: async (t, b) => msgs.push(t + ' | ' + b), journal: () => {}, heartbeat: async (m) => hbs.push(m) });
  await cycle(st, cfg, deps(T0, 1.0)); await cycle(st, cfg, deps(T0 + M, 0.89));
  ok(st.positions.length === 0 && msgs.length === 0 && logs.some((l) => /SELL ALL AAA/.test(l)), 'a would-be sale is logged on the server, not sent to the phone');
  ok(hbs.length === 1 && /^hb:rules .* open=1 watching=0$/.test(hbs[0]), 'heartbeat sent to the silent topic');
  st.positions.push({ ...pos, id: 'P1@y' }); feed = 'down'; for (let i = 2; i <= 20; i++) await cycle(st, cfg, deps(T0 + i * M, 1));
  ok(msgs.length === 1 && /RynoBot problem: prices/.test(msgs[0]) && /1 open position is not being checked/.test(msgs[0]), 'prices down 15+ minutes with a position open: one alert');
  feed = 'up'; await cycle(st, cfg, deps(T0 + 21 * M, 1)); ok(msgs.length === 2 && /prices back to normal/.test(msgs[1]), 'prices back: one note');
  pages = 'down'; for (let i = 22; i <= 60; i++) await cycle(st, cfg, deps(T0 + i * M, 1));
  ok(msgs.length === 3 && /RynoBot problem: scanner data/.test(msgs[2]) && /HTTP 503/.test(msgs[2]), "can't read the dashboard data for 30 minutes: one alert");
  ok(hbs.length === 3, 'heartbeats keep going every 30 minutes (0, 30 and 60 minutes in)');
  console.log = log0; }
ok(JSON.parse(fs.readFileSync('config/settings.json', 'utf8')).phoneAlerts === 'health' && DEFAULTS.tradeAlerts === false && DEFAULTS.dailySummary === false, 'defaults: phone gets health alerts only, scanner and bot');
process.exit(f);
