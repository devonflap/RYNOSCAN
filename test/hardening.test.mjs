// Regression tests for problems found by the stress run: bad candles, bad response bodies, bad learned.json, unfinished candles.
import * as C from '../docs/core.mjs';
import { makeApi } from '../src/api.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const T = Math.floor(Date.now() / 14400e3) * 14400 - 14400 * 40; // a 4h boundary, 40 buckets ago
const mk = (n, f = (i) => 1 + Math.sin(i / 7) * 0.1) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return [T + i * 3600, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 1000]; });
const P = () => ({ sym: 'X', net: 'solana', chain: 'solana', pool: 'p', price: 1, v24: 1e6, v1: 4e4, liq: 2e5, b1: 3, s1: 2, b24: 50, s24: 40, buyers24: 50, sellers24: 40, ch24: 3, flags: [], created: new Date(Date.now() - 20 * 864e5).toISOString() });
// 1. one NaN candle must not poison the indicators
{ const raw = mk(150); raw[100] = [raw[100][0], NaN, NaN, NaN, NaN, NaN]; raw[101][5] = null; const p = P(); C.techFromRaw(p, raw, Date.now()); C.scoreList([p], Date.now()); const row = C.toRow(p, 'x');
  ok(Number.isFinite(row.rsi1h) && Number.isFinite(row.score), 'a NaN candle does not make scores NaN'); }
ok(C.cleanBars([[1, 1, 1, 1, 1, 1], [1, 2, 2, 2, 2, 2], [2, '3', '4', '2', '3', 'x'], [3, 0, 1, 1, 1, 1], 'junk', null]).length === 2, 'cleanBars drops duplicates, zero prices and junk, and fixes a bad volume');
// 2. unfinished candles are not scored (v2)
{ const nowMs = (T + 3600 * 50 + 1800) * 1000; const raw = mk(51); // last hour bar (index 50) is still forming at nowMs
  const closed = C.closedOnly(C.cleanBars(raw), nowMs); ok(closed.length === 50, 'the hour still in progress is dropped');
  const p = P(); ok(C.techFromRaw(p, raw, nowMs), 'techFromRaw runs on closed data');
  ok(p.h4.every((b) => b[0] + 14400 <= T + 3600 * 50), 'no 4h bucket extends past the last closed hour'); }
// 3. bad learned.json is ignored, good one applied
{ const o = JSON.stringify([C.RULES.off, C.RULES.shadow]); C.applyLearned({ promote: 'x', demote: { a: 1 } }); C.applyLearned('nonsense'); C.applyLearned(null); C.applyLearned({ promote: [1, null, 'Base breakout'] });
  ok(!C.RULES.shadow.includes('Base breakout') && C.RULES.off.length >= 0, 'malformed learned.json does not crash and valid entries still apply'); const [a, b] = JSON.parse(o); C.RULES.off = a; C.RULES.shadow = b; }
// 4. a plan with no risk is not evaluated into nonsense
{ const r = C.evaluate({ signalAt: new Date(T * 1000).toISOString(), entryLow: 1, entryHigh: 1, entryMid: 1, stop: 1.2, tp1: 2, tp2: 3, tp3: 4 }, mk(60), 'x', { fillAt: 'high' }); ok(r.status === 'invalid plan' && r.resultR === null, 'stop above entry is an invalid plan'); }
// 5. a response body that is not JSON is retried, not fatal
{ let n = 0; const f = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { if (n++ === 0) throw new SyntaxError('Unexpected token <'); return { data: 1 }; } });
  const api = makeApi({ CG_API_KEY: 'k', CG_PLAN: 'pro', PACE_MS: '0' }, f); const j = await api.get('/x'); ok(j && j.data === 1, 'html or truncated body is retried and then succeeds'); }
// 6. total outage: stop after 4 failed requests instead of grinding for hours
{ let calls = 0; const down = async () => { calls++; throw new Error('ECONNRESET'); }; const api = makeApi({ CG_API_KEY: 'k', CG_PLAN: 'pro', PACE_MS: '0', RETRY_SCALE: '0' }, down); let msg = '';
  for (let i = 0; i < 6; i++) { try { await api.get('/x'); } catch (e) { msg = e.message; break; } }
  ok(/unreachable/.test(msg) && calls <= 4 * 6, 'feed outage stops the run early (' + calls + ' attempts)');
  const up = async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }); const api2 = makeApi({ CG_API_KEY: 'k', CG_PLAN: 'pro', PACE_MS: '0', RETRY_SCALE: '0' }, up);
  let threw = false; for (let i = 0; i < 10; i++) { try { await api2.get('/x'); } catch { threw = true; } } ok(!threw, '404s never trip the outage breaker'); }
