import { simulate, fwdSummary } from '../docs/paper.mjs';
import { pickCandidates, trim } from '../src/forward.mjs';
import { learn } from '../src/learn.mjs';
import * as C from '../docs/core.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sig = (o) => ({ signalId: o.id + '@d', id: o.id, coin: o.id, chain: 'Solana', setup: 'Bottom reversal', entryLow: 0.98, entryHigh: 1.02, entryMid: 1, stop: 0.9, tp1: 1.2, tp2: 1.3, tp3: 1.5, signalAt: o.at, closedAt: o.end || null, status: o.status, resultR: o.R ?? null, openR: o.open ?? null, tpHit: 0 });
// paper: 10k, 5% = 500; stop distance 10%; +2R closed = +0.2 * 500 = +100
{ const p = simulate([sig({ id: 'A', at: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z', status: 'hit TP3', R: 2 })]);
  ok(Math.abs(p.equity - 10100) < 1e-6 && p.closedN === 1 && p.wins === 1, 'paper: +2R on 5% of 10k with a 10% stop = +$100'); }
// a stop loss of -1R loses 5% * 10% = 0.5% of the account, and the next trade is sized on the new balance
{ const p = simulate([sig({ id: 'A', at: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z', status: 'stopped', R: -1 }), sig({ id: 'B', at: '2026-10-03T00:00:00Z', end: '2026-10-04T00:00:00Z', status: 'stopped', R: -1 })]);
  ok(Math.abs(p.equity - (10000 - 50 - 49.75)) < 0.01, 'paper: second trade sized on the reduced balance: ' + p.equity.toFixed(2)); ok(p.maxDD > 0.9 && p.maxDD < 1.1, 'paper: drawdown about 1%'); }
// overlapping trades are both sized on the balance at entry; open trades are marked, waiting and unfilled use no money
{ const p = simulate([sig({ id: 'A', at: '2026-10-01T00:00:00Z', status: 'open', open: 1 }), sig({ id: 'B', at: '2026-10-01T01:00:00Z', status: 'waiting for entry' }), sig({ id: 'C', at: '2026-10-01T02:00:00Z', status: 'expired (no fill)' })]);
  ok(p.openN === 1 && p.waitingN === 1 && p.closedN === 0 && Math.abs(p.equity - 10050) < 1e-6, 'paper: open marked, waiting and unfilled ignored'); }
ok(simulate(null).equity === 10000 && simulate([null, 5, {}, { status: 'open' }]).trades.length === 0, 'paper: junk input is safe');
ok(simulate([sig({ id: 'Z', at: 'not a date', status: 'stopped', R: -1 })]).closedN === 0, 'paper: bad date skipped');
// forward
{ const pl = { entryLow: 1, entryHigh: 1.1, stop: 0.9, tp1: 1.3, tp2: 1.5, tp3: 1.8 }, mk = (sym, opp, o = {}) => ({ sym, chain: 'solana', opp, signal: 'No trade', sp: pl, setupType: 'Bottom reversal', pool: 'p' + sym, score: 70, lastClose: 1.05, ...o });
  const rows = [mk('A', 60), mk('B', 55), mk('C', 40), mk('D', 70), mk('E', 62, { signal: 'Entry signal' }), mk('F', 58, { sp: null })];
  const got = pickCandidates(rows, [], '2026-10-14T00:00:00Z', C.newSignal, 65);
  ok(got.map((s) => s.coin).join() === 'A,B' && got.every((s) => s.forward), 'forward: only opp 50-65 without a plan gap, no bid-ready, no low scores: ' + got.map((s) => s.coin));
  ok(pickCandidates(rows, got, '2026-10-14T00:00:00Z', C.newSignal, 65).length === 0, 'forward: no duplicates while one is open');
  const many = Array.from({ length: 50 }, (_, i) => mk('S' + i, 60)); ok(pickCandidates(many, [], '2026-10-14T00:00:00Z', C.newSignal, 65).length === 25, 'forward: capped at 25 new per scan');
  const big = Array.from({ length: 700 }, (_, i) => ({ signalId: 'x' + i, id: 'x' + i, status: 'stopped', signalAt: '2026-10-' + String(1 + i % 28).padStart(2, '0') })); big.push({ signalId: 'o', id: 'o', status: 'open', signalAt: '2026-09-01' });
  const t = trim(big); ok(t.length === 601 && t.some((s) => s.id === 'o'), 'forward: closed trimmed to 600, open always kept'); }
// learn: near-miss is evidence but never promoted or demoted; new features
{ const rs = []; for (let i = 0; i < 20; i++) rs.push({ setup: 'Near-miss: Bottom reversal', chain: 'Solana', at: '2026-10-01T05:00:00Z', resultR: -1, status: 'stopped', regime: 'Risk-on', volDay: 'Strong' });
  for (let i = 0; i < 20; i++) rs.push({ setup: 'Bottom reversal', chain: 'Solana', at: '2026-10-01T05:00:00Z', resultR: i % 2 ? 2 : -1, status: 'x', regime: 'Risk-on', volDay: 'Strong' });
  const L = learn(rs, { off: [], shadow: [] }); ok(L.setups.some((s) => s.setup.startsWith('Near-miss')) && !L.demote.some((n) => n.startsWith('Near-miss')), 'learn: near-miss shown, never demoted');
  ok(L.features.some((f) => f.feature === 'Market regime') && L.features.some((f) => f.feature === 'Volume day'), 'learn: regime and volume-day features');
  ok(L.total.n === 20, 'learn: overall excludes near-miss'); }
// volume breakout candidate: shadow by default, detected when shadows are allowed
{ const t0 = 1.7e9, cs = []; for (let i = 0; i < 70; i++) cs.push(1 + 0.02 * Math.sin(i / 3)); cs.push(1.08, 1.12); const h4 = cs.map((c, i) => [t0 + i * 14400, i ? cs[i - 1] : c, c * 1.01, c * 0.99, c, i >= cs.length - 2 ? 9000 : 1000]);
  C.RULES.allowShadow = true; const r = C.detectPatterns(h4).map((x) => x.name); C.RULES.allowShadow = false; ok(r.includes('Volume breakout'), 'volume breakout detected: ' + r.join(','));
  ok(!C.detectPatterns(h4).some((x) => x.name === 'Volume breakout'), 'volume breakout stays shadow until proven'); }
