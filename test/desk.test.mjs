// The bot desk: the summary built from a bot's state, and the read-only web server (password, no writes, candle cache).
import { deskSummary } from '../bot/desk.mjs';
import { server, authorised, candles } from '../bot/dash.mjs';
import { DEFAULTS, newState } from '../bot/run.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-22T00:00:00Z'), H = 3600e3, iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

// summary
{ const st = newState(DEFAULTS); st.startedAt = iso(T0 - 48 * H); st.lastCycleAt = T0 - 30e3; st.cash = 9700;
  st.positions.push({ id: 'p@x', coin: 'AAA', chain: 'Solana', pool: 'p1', openedAt: iso(T0 - 5 * H), entry: 1, stop0: 0.9, stop: 1, tp1: 1.1, freeAt: 2, costUsd: 300, units: 300, remUnits: 200, bankedUsd: 110, tp1Done: true, free: false, peak: 1.2, peakClose: 1.2, sells: [{ why: 'TP1: a third at +1R', usd: 110, px: 1.1, at: iso(T0 - H) }], riskUsd: 30, lastPx: 1.25, meta: { opp: 72, signal: 'watch' } });
  st.closed.push({ coin: 'BBB', chain: 'Solana', pool: 'p2', openedAt: iso(T0 - 30 * H), closedAt: iso(T0 - 20 * H), entry: 2, stop0: 1.8, costUsd: 200, units: 100, bankedUsd: 180, pnl: -20, R: -1, sells: [{ why: 'stop', usd: 180, px: 1.8, at: iso(T0 - 20 * H) }] });
  st.setups = { p3: { pool: 'p3', coin: 'CCC', chain: 'Robinhood', zoneLow: 1, zoneHigh: 1.04, stop: 0.9, at: iso(T0 - H), lastPx: 1.1, opp: 70, kind: 'watch' } };
  st.eq = [[T0 - 2 * H, 10000], [T0 - H, 9950]]; st.days = { '2026-10-21': -20 }; st.blocks = [[iso(T0 - H), null, 'all 4 position slots were full']];
  const d = deskSummary('rules', { st, cfg: DEFAULTS, journal: [{ at: iso(T0 - H), type: 'sell', coin: 'AAA', why: 'TP1: a third at +1R', usd: 110 }], now: T0 });
  ok(d.installed && d.account.equity === 9950 && d.account.pnl === -50 && d.account.start === 10000, 'account: cash plus open positions at the live price');
  const o = d.open[0]; ok(o.price === 1.25 && o.upnl === 60 && o.R === 2 && o.leftPct === 66.67 && o.status === 'TP1 hit, trailing' && o.next === 2, 'open position: live P&L in dollars and R, what is left, the next target');
  ok(d.closed[0].pnl === -20 && d.closed[0].R === -1 && d.closed[0].exitAvg === 1.8 && d.closed[0].why === 'stop' && d.stats.closed === 1 && d.stats.winRate === 0, 'closed trade and record');
  ok(d.watch[0].coin === 'CCC' && d.watch[0].distPct === 5.77 && d.risk.blocked === 'all 4 position slots were full' && d.health.live && d.equityCurve.length === 3, 'watch list distance to zone, the current block, health, and the equity curve ends now');
  st.passed = [{ coin: 'DDD', chain: 'Solana', pool: 'p4', at: iso(T0 - 25 * H), px0: 1, hi: 1.4, lo: 0.95, last: 1.2, stop: 0.9, why: 'no chasing', done: true }, { coin: 'EEE', chain: 'Solana', pool: 'p5', at: iso(T0 - 25 * H), px0: 1, hi: 1.0, lo: 0.8, last: 0.85, stop: 0.9, why: 'too late', done: true }];
  const d2 = deskSummary('rules', { st, cfg: DEFAULTS, now: T0 }); ok(d2.passed[1].sincePct === 20 && d2.passed[1].bestPct === 40 && d2.passed[0].wouldStop === true && d2.passedSummary.n === 2 && d2.passedSummary.avoided === 1 && d2.stats.streak === -1, 'passed-on setups: what they did since, whether the stop would have hit, and how often saying no was right');
  ok(deskSummary('breakout', { st: null, cfg: DEFAULTS }).installed === false, 'a bot that has not run shows as not installed'); }

// server: password, read only, no secrets
{ const srv = server('correct horse battery'); await new Promise((r) => srv.listen(0, r)); const port = srv.address().port, U = 'http://127.0.0.1:' + port;
  const auth = 'Basic ' + Buffer.from('anyone:correct horse battery').toString('base64');
  ok((await fetch(U + '/')).status === 401 && (await fetch(U + '/api/desk')).status === 401, 'nothing is served without the password');
  ok((await fetch(U + '/', { headers: { authorization: 'Basic ' + Buffer.from('x:wrong').toString('base64') } })).status === 401, 'a wrong password is refused');
  const page = await fetch(U + '/', { headers: { authorization: auth } }); ok(page.status === 200 && /RynoBot desk/.test(await page.text()), 'the desk page opens with the password (any user name)');
  const api = await fetch(U + '/api/desk', { headers: { authorization: auth } }), j = await api.json(); ok(api.status === 200 && j.mode === 'dry run' && j.bots.length === 2 && j.bots.every((b) => b.name), 'the desk data covers both bots');
  ok((await fetch(U + '/api/desk', { method: 'POST', headers: { authorization: auth } })).status === 405, 'the server accepts nothing but reads');
  ok(authorised({ headers: { authorization: auth } }, 'correct horse battery') && !authorised({ headers: {} }, 'correct horse battery'), 'password check');
  srv.close(); }

// candles: cached a minute, rate limited, unknown coins refused
{ let n = 0; const fetcher = async () => { n++; return { ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[2, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]] } } }) }; };
  const a = await candles('solana', 'A'.repeat(44), fetcher, T0), b = await candles('solana', 'A'.repeat(44), fetcher, T0 + 30e3);
  ok(a.bars.length === 2 && a.bars[0][0] === 1 && b === a && n === 1, 'candles sorted oldest first and cached for a minute');
  ok((await candles('solana', 'not a pool', fetcher, T0)).error && (await candles('mars', 'A'.repeat(44), fetcher, T0)).error, 'unknown chain or odd pool address: refused, never fetched'); }
process.exit(f);
