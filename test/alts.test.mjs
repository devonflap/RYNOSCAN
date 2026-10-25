// Offline check of the Market Watcher engine (docs/mw.mjs) on real daily candles for 7 alts + BTC to 25 Oct 2026.
// Expected values come from the reference implementation; these guard the trendline and state logic against drift.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { analyse, regime, basketIndex, managePositions, P } from '../docs/mw.mjs';
const dir = 'test/fixtures/alts', load = (f) => { const rows = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').slice(1).map((l) => l.split(';')); if (rows[0][0] > rows.at(-1)[0]) rows.reverse(); return rows.map((r) => [r[0], +r[1], +r[2], +r[3], +r[4], 0]); };
const data = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).map((f) => [f.slice(0, -4), load(f)]));
const alts = Object.keys(data).filter((s) => s !== 'BTC'), btc = data.BTC.map((b) => b[4]);
const basket = basketIndex(alts.map((s) => data[s].map((b) => b[4])));
const w = P.rsWindow, basketRet = basket.at(-1) / basket.at(-1 - w) - 1, btcRet = btc.at(-1) / btc.at(-1 - w) - 1;
const reg = regime(btc, basket); assert.equal(reg.label, 'BULL / CORRECTING'); assert.ok(Math.abs(reg.btcSupport - 75644.48) < 1);
const R = Object.fromEntries(alts.map((s) => [s, analyse(s, data[s], { basketRet, btcRet })]));
const want = { ENA: ['DECISION', 'falling wedge', 82], ZRO: ['WATCH', 'falling wedge', 86], SOL: ['WATCH', 'falling wedge', 85], NEAR: ['WATCH', 'falling wedge', 83], LINK: ['WATCH', 'falling wedge', 75], TAO: ['WATCH', 'falling wedge', 73], ONDO: ['WATCH', 'falling wedge', 64] };
for (const [s, [st, pat, sc]] of Object.entries(want)) { const r = R[s]; assert.equal(r.state, st, s + ' state'); assert.equal(r.pattern, pat, s + ' pattern'); assert.equal(r.score, sc, s + ' score ' + r.score); }
// ENA: the wedge is drawn from the 0.2946 high to the 0.226 lower high, lows from 0.1941 down to 0.1744
assert.deepEqual(R.ENA.upperPts.map((p) => p[1]), [0.2946, 0.226]); assert.deepEqual(R.ENA.lowerPts.map((p) => p[1]), [0.1941, 0.1744]);
assert.ok(Math.abs(R.ENA.invalidation - 0.170912) < 1e-5 && Math.abs(R.ENA.t1 - 0.2946) < 1e-9);
// book: a position at +0.8R is untouched; at +1R the stop goes to breakeven; through T1 it clips 25%
const pos = [{ symbol: 'ENA', entry: 0.19, invalidation: 0.17 }]; let ev = managePositions(pos, Object.values(R), reg); assert.equal(ev.length, 0); assert.equal(pos[0].stop, 0.17);
const fake = [{ ...R.ENA, lastClose: 0.30 }]; ev = managePositions(pos, fake, reg); assert.deepEqual(ev.map((e) => e[1]), ['SL TO BE', 'SELL INTO MOMENTUM (T1)']); assert.equal(pos[0].size, 0.75);
// a flat series has no impulse; a short one is rejected
assert.equal(analyse('X', Array.from({ length: 100 }, (_, i) => [i, 1, 1.01, 0.99, 1, 0])).reasons[0].slice(0, 10), 'no impulse'); assert.equal(analyse('Y', data.ENA.slice(-20)).state, 'NONE');
console.log('alts engine OK:', alts.map((s) => `${s} ${R[s].state} ${R[s].score}`).join(', '), '| regime', reg.label);

// the daily job end to end on a mocked Gate.io feed (offline): writes alts.json, keeps state, fires the right alerts
import os from 'node:os'; import { runAlts } from '../src/alts.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alts-')); process.env.OUT_DIR = tmp;
const gate = (sym) => data[sym].map((b) => [String(b[0] === undefined ? 0 : Math.floor(Date.parse(b[0]) / 1000)), String(b[5]), String(b[4]), String(b[2]), String(b[3]), String(b[1]), '0']);
const posts = []; globalThis.fetch = async (url, init) => { posts.push({ url, init }); return { ok: true }; };
const mockApi = { keyed: false, sleep: async () => {}, get: async () => null, getJson: async (url) => {
  if (url.includes('/tickers')) return [...alts.map((s) => ({ currency_pair: s + '_USDT', quote_volume: '1000000' })), { currency_pair: 'USDC_USDT', quote_volume: '9e9' }, { currency_pair: 'ENA3L_USDT', quote_volume: '5e6' }, { currency_pair: 'BTC_USDT', quote_volume: '9e9' }];
  const m = url.match(/currency_pair=([A-Z0-9]+)_USDT/); return gate(m[1]); } };
const out = path.join(tmp, 'alts.json'); let res = await runAlts({ api: mockApi, log: () => {}, out, topic: 'test-topic' });
assert.equal(res.scored, 7); assert.equal(res.regime.label, 'BULL / CORRECTING'); assert.ok(res.results.every((r, i) => !i || res.results[i - 1].score >= r.score)); assert.ok(['ZRO', 'NEAR', 'SOL'].includes(res.results[0].symbol));
assert.ok(fs.existsSync(out) && JSON.parse(fs.readFileSync(out)).results.length === 7);
// first run: ENA went to DECISION from nothing -> one alert (unless it's Sunday, when only the digest goes)
const sunday = new Date().getUTCDay() === 0; const titles = posts.map((p) => p.init.headers.Title);
assert.ok(sunday ? titles.includes('weekly close check') : titles.includes('ENA · decision time'), titles.join(' | '));
// second run: nothing changed -> no new state alert
posts.length = 0; res = await runAlts({ api: mockApi, log: () => {}, out, topic: 'test-topic' }); assert.ok(!posts.some((p) => p.init.headers.Title === 'ENA · decision time'));
console.log('alts job OK (' + titles.length + ' alert(s) on first run)');
