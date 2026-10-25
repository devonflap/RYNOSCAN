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
assert.deepEqual(titles, ['weekly close check'], 'first run sends only the digest: ' + titles.join(' | '));
// second run: nothing changed -> no state alert; then fake a change (ENA was WATCH) -> one decision-time alert unless it's Sunday
posts.length = 0; res = await runAlts({ api: mockApi, log: () => {}, out, topic: 'test-topic' }); assert.ok(!posts.some((p) => /decision time|BID/.test(p.init.headers.Title)));
const st = JSON.parse(fs.readFileSync(path.join(tmp, 'alts-state.json'))); const sym = res.results.find((r) => r.state === 'DECISION' || r.state === 'WATCH').symbol; st[sym] = 'NONE'; fs.writeFileSync(path.join(tmp, 'alts-state.json'), JSON.stringify(st));
posts.length = 0; res = await runAlts({ api: mockApi, log: () => {}, out, topic: 'test-topic' }); const st2 = res.results.find((r) => r.symbol === sym).state; if (st2 === 'DECISION') assert.ok(posts.some((p) => p.init.headers.Title === sym + ' · decision time'), 'state change alerts');
console.log('alts job OK (' + titles.length + ' alert(s) on first run)');

// chill method for memes: a 10x run wedging down into the deep fib zone -> wedge, low tagged at its fib, invalidation at the next fib down
{ const { P_MEME } = await import('../docs/mw.mjs'); const bars = []; let p = 0.001; for (let i = 0; i < 60; i++) { bars.push([i, p, p * 1.03, p * 0.98, p, 1e5]); p *= 1.01; }
  for (let i = 0; i < 20; i++) { const q = p * (1 + i * 0.1); bars.push([60 + i, q, q * 1.08, q * 0.95, q * 1.05, 5e5]); }
  const hi = bars.at(-1)[2], legLow = Math.min(...bars.slice(55, 62).map((b) => b[3])), tgt = hi - (hi - legLow) * 0.80; for (let i = 0; i < 30; i++) { const t = i / 29, x = hi - (hi - tgt) * Math.pow(t, 0.6), amp = (hi - tgt) * 0.25 * (1 - t); bars.push([80 + i, x + amp * 0.5, x + amp, x - amp * 0.3, x, 2e5]); }
  const r = analyse('MEME', bars, { p: P_MEME }); assert.equal(r.pattern, 'falling wedge'); assert.equal(r.fibLowAt, '0.886'); assert.ok(Math.abs(r.invalidation - r.fib.f886) < 1e-9); assert.ok(r.score >= 85);
  // the same coin only 30% back is not a chill setup yet; the alt profile has no fib gate
  const shallow = bars.slice(0, 80).concat(bars.slice(80, 92).map((b, i) => { const k = 1 - i * 0.025; return [b[0], hi * k, hi * k * 1.02, hi * k * 0.98, hi * k, 2e5]; }));
  assert.ok(/not yet in the fib zone/.test(analyse('MEME', shallow, { p: P_MEME }).reasons[0])); assert.equal(analyse('ALT', shallow).fibLowAt, '<0.5');
  // a 0.618 pullback scores like a deeper one; a coin still sliding on rising volume carries the "may run deeper" warning
  const mid = bars.slice(0, 80); const hi2 = bars[79][2], lo2 = legLow, t618 = hi2 - (hi2 - lo2) * 0.64; for (let i = 0; i < 14; i++) { const t = i / 13, x = hi2 - (hi2 - t618) * Math.pow(t, 0.6), amp = (hi2 - t618) * 0.25 * (1 - t); mid.push([80 + i, x + amp * 0.5, Math.min(x + amp, hi2 * 0.995), x - amp * 0.3, x, 2e5 * (1 + i * 0.1)]); }
  const m = analyse('MEME', mid, { p: P_MEME }); assert.equal(m.fibLowAt, '0.618'); assert.ok(m.score >= 60, 'score ' + m.score); assert.ok(m.deeper && /0\.786/.test(m.deeper), 'deeper warning: ' + m.deeper);
  console.log('chill method OK'); }
