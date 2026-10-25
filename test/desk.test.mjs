// The bot desk: the summary built from a bot's state, the web server (password, commands, candle cache) and the wallet reader.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynodesk-'); // the bot modules read this at import time
import { deskSummary } from '../bot/desk.mjs';
import { server, authorised, candles, command, balance } from '../bot/dash.mjs';
import { closeNow } from '../bot/manage.mjs';
import { cycle, filesFor } from '../bot/run.mjs';
import fs from 'node:fs';
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
  const api = await fetch(U + '/api/desk', { headers: { authorization: auth } }), j = await api.json(); ok(api.status === 200 && j.mode === 'dry run' && j.bots.length === 9 && j.bots.every((b) => b.name), 'the desk data covers all eight bots (four plus the five trenchers, the OG among them)');
  ok((await fetch(U + '/api/desk', { method: 'POST', headers: { authorization: auth } })).status === 405, 'the server accepts nothing but reads');
  ok(authorised({ headers: { authorization: auth } }, 'correct horse battery') && !authorised({ headers: {} }, 'correct horse battery'), 'password check');
  const cmd = await fetch(U + '/api/cmd', { method: 'POST', headers: { authorization: auth, 'x-desk': '1', 'content-type': 'application/json' }, body: '{"bot":"breakout","type":"pause"}' });
  ok(cmd.status === 403 && /read only/.test((await cmd.json()).error) && j.controls === 'off', 'with no control password the desk is read only: controls refused and the page told');
  process.env.NTFY_TOPIC = 'zz-secret-topic-zz'; const leak = JSON.stringify(await (await fetch(U + '/api/desk', { headers: { authorization: auth } })).json()) + await (await fetch(U + '/', { headers: { authorization: auth } })).text();
  ok(!/zz-secret-topic-zz|correct horse battery|privateKey/.test(leak), 'no secret reaches the page or the API (ntfy topic, passwords, keys)'); delete process.env.NTFY_TOPIC;
  const csp = (await fetch(U + '/', { headers: { authorization: auth } })).headers.get('content-security-policy'); ok(/frame-src https:\/\/dexscreener\.com/.test(csp) && /default-src 'self'/.test(csp), 'the page may embed DexScreener charts and nothing else from outside');
  srv.close(); }
// controls with their own password, logged for fail2ban, and locked to the server itself when asked
{ const lines = [], srv = server('correct horse battery', { controlPass: 'control phrase here', log: (l) => lines.push(l) }); await new Promise((r) => srv.listen(0, r)); const U = 'http://127.0.0.1:' + srv.address().port;
  const auth = 'Basic ' + Buffer.from('a:correct horse battery').toString('base64'), post = (h, body = '{"bot":"breakout","type":"pause"}') => fetch(U + '/api/cmd', { method: 'POST', headers: { authorization: auth, 'x-desk': '1', 'content-type': 'application/json', ...h }, body });
  ok((await post({})).status === 403 && (await post({ 'x-control': 'nope' })).status === 403 && lines.some((l) => /wrong password from 127\.0\.0\.1/.test(l)), 'a control without the control password is refused and the wrong try is logged with the address');
  const r = await post({ 'x-control': 'control phrase here' }); ok(r.status === 200 && (await r.json()).ok && lines.some((l) => /desk: pause breakout/.test(l)), 'the control password works and the action is logged'); command('breakout', 'resume');
  ok((await (await fetch(U + '/api/desk', { headers: { authorization: auth } })).json()).controls === 'on', 'the page is told controls are on');
  await fetch(U + '/', { headers: { authorization: 'Basic ' + Buffer.from('x:bad').toString('base64'), 'x-forwarded-for': '203.0.113.9' } }); ok(!lines.some((l) => /203\.0\.113\.9/.test(l)), 'X-Forwarded-For is ignored unless the desk is told it sits behind a proxy');
  srv.close();
  const srv2 = server('correct horse battery', { controlPass: 'control phrase here', controls: 'local', trustProxy: true, log: (l) => lines.push(l) }); await new Promise((r) => srv2.listen(0, r)); const U2 = 'http://127.0.0.1:' + srv2.address().port;
  const r2 = await fetch(U2 + '/api/cmd', { method: 'POST', headers: { authorization: auth, 'x-desk': '1', 'x-control': 'control phrase here', 'content-type': 'application/json' }, body: '{"bot":"breakout","type":"pause"}' }); ok(r2.status === 200, 'controls=local: accepted from the server itself'); command('breakout', 'resume');
  await fetch(U2 + '/', { headers: { authorization: 'Basic ' + Buffer.from('x:bad').toString('base64'), 'x-forwarded-for': '203.0.113.9' } }); ok(lines.some((l) => /wrong password from 203\.0\.113\.9/.test(l)), 'behind a proxy the real address is logged (fail2ban bans the right one)');
  ok((await (await fetch(U2 + '/api/desk', { headers: { authorization: auth } })).json()).controls === 'local', 'the page is told controls are local only');
  srv2.close(); }

// candles: cached a minute, rate limited, unknown coins refused
{ let n = 0; const fetcher = async () => { n++; return { ok: true, json: async () => ({ data: { attributes: { ohlcv_list: [[2, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]] } } }) }; };
  const a = await candles('solana', 'A'.repeat(44), fetcher, T0), b = await candles('solana', 'A'.repeat(44), fetcher, T0 + 30e3);
  ok(a.bars.length === 2 && a.bars[0][0] === 1 && b === a && n === 1, 'candles sorted oldest first and cached for a minute');
  ok((await candles('solana', 'not a pool', fetcher, T0)).error && (await candles('mars', 'A'.repeat(44), fetcher, T0)).error, 'unknown chain or odd pool address: refused, never fetched'); }
// desk commands: close a position, cancel a setup, pause and resume; the bot does the work at its next check
{   const F = filesFor('breakout'); const r1 = command('breakout', 'pause'); ok(r1.ok && fs.existsSync(F.stop) && !fs.existsSync(F.stopAll), 'pause writes this bot\'s own STOP file, not the all-bots one');
  const r2 = command('breakout', 'resume'); ok(r2.ok && !fs.existsSync(F.stop), 'resume removes it');
  const r3 = command('breakout', 'close', 'A'.repeat(44)); ok(r3.ok && /close sent/.test(r3.did) && fs.readFileSync(F.cmd, 'utf8').includes('"type":"close"'), 'close is queued as a command for the bot');
  ok(command('nope', 'close', 'A'.repeat(44)).error && command('breakout', 'close', '../etc').error && command('breakout', 'explode').error, 'unknown bots, odd pool ids and unknown commands are refused');
  const st = newState(DEFAULTS); st.positions.push({ id: 'x', coin: 'AAA', chain: 'Solana', pool: 'A'.repeat(44), openedAt: iso(T0 - H), entry: 1, stop0: 0.9, stop: 0.9, tp1: 1.1, freeAt: 2, costUsd: 100, units: 100, remUnits: 100, bankedUsd: 0, tp1Done: false, free: false, peak: 1, peakClose: 1, sells: [], slipOut: 1 });
  st.setups = { p9: { pool: 'B'.repeat(44), coin: 'BBB', chain: 'Solana', zoneLow: 1, zoneHigh: 1.04, stop: 0.9, at: iso(T0 - H) } }; st.cash = 9900;
  const cmds = [{ id: 'c1', type: 'close', pool: 'A'.repeat(44) }, { id: 'c2', type: 'cancel', pool: 'B'.repeat(44) }], jr = [], log0 = console.log; console.log = () => {};
  const deps = { now: T0, getJson: async () => [], quotes: async () => ({ ['a'.repeat(44)]: { priceUsd: '1.2', liquidity: { usd: 500000 } }, ['b'.repeat(44)]: { priceUsd: '1.1' } }), candles5: async () => null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {}, commands: () => cmds };
  await cycle(st, { ...DEFAULTS, setupsEveryMin: 1e9 }, deps); await cycle(st, { ...DEFAULTS, setupsEveryMin: 1e9 }, { ...deps, now: T0 + 60e3 }); console.log = log0;
  ok(st.positions.length === 0 && st.closed[0].sells[0].manual && /by hand/.test(st.closed[0].sells[0].why) && Math.abs(st.closed[0].pnl - (120 * 0.99 - 100)) < 0.01, 'close: sold everything at the live price less costs, marked as by hand');
  ok(!st.setups.p9 && jr.some((j) => j.type === 'drop' && j.manual), 'cancel: the setup is dropped and the journal says it was by hand');
  ok(st.cmdDone.includes('c1') && st.cmdDone.includes('c2'), 'each command is done once');
  const r = closeNow({ remUnits: 10, bankedUsd: 0, costUsd: 10, sells: [], slipOut: 2 }, { priceUsd: '2' }, T0 / 1000); ok(r.actions[0].usd === 19.6 && r.pos.remUnits === 0, 'closeNow sells all at the price less this position\'s costs'); }

// read-only wallet balance
{ const f = async (url, o) => ({ ok: true, json: async () => (/solana/.test(url) ? { result: { value: 2.5e9 } } : { result: '0x' + (3n * 10n ** 18n).toString(16) }) });
  const a = await balance('solana', 'X'.repeat(44), f, T0), b = await balance('bsc', '0x' + 'a'.repeat(40), f, T0);
  ok(a.native === 2.5 && a.unit === 'SOL' && b.native === 3 && b.unit === 'BNB' && (await balance('mars', 'x', f, T0)).error, 'balances read from public addresses on Solana and BNB; unknown chains refused'); }
process.exit(f);
