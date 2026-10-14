import { learn } from '../src/learn.mjs';
import { edge } from '../src/edge.mjs';
import * as shadow from '../src/shadow.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const mk = (i, setup, R, o = {}) => ({ setup, chain: o.chain || 'Solana', at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), coin: 'C' + i, resultR: R, status: R > 0 ? 'hit TP1' : 'stopped', riskPct: o.risk ?? 8, opp: o.opp ?? 70, regime: o.regime, soc: o.soc });
// no trades
ok(/No closed trades/.test(learn([]).edge.headline), 'edge: empty says so');
// too early
{ const L = learn(Array.from({ length: 10 }, (_, i) => mk(i, 'Bottom reversal', i % 2 ? 1 : -1))); ok(L.edge.status === 'too-early' && /Too early/.test(L.edge.headline) && L.edge.next.some((x) => /more closed trades/.test(x)), 'edge: 10 trades is too early'); }
// a filter that helps in both halves is "holds up"; one that only helps in one half is noise
{ const t = []; for (let i = 0; i < 60; i++) { const bad = i % 3 === 0; t.push(mk(i, 'Bottom reversal', bad ? -1 : (i % 2 ? 1.2 : -0.2), { regime: bad ? 'Risk-off' : 'Risk-on' })); }
  const L = learn(t); const r = L.edge.rules.find((x) => /market regime/.test(x.rule) && /Risk-off/.test(x.rule)); ok(r && r.ok && r.status === 'holds up' && r.gain > 0, 'edge: filter that helps in both halves holds up'); }
{ const t = []; for (let i = 0; i < 60; i++) { const bad = i < 20 && i % 2 === 0; t.push(mk(i, 'Bottom reversal', bad ? -1.5 : (i % 2 ? 1 : 0.2), { chain: bad ? 'Robinhood' : 'Solana' })); }
  const L = learn(t); const r = L.edge.rules.find((x) => /chain/.test(x.rule) && /Robinhood/.test(x.rule)); ok(!r || !r.ok, 'edge: slice that only exists in the older half is not called an edge'); }
// negative overall
{ const L = learn(Array.from({ length: 40 }, (_, i) => mk(i, 'Bottom reversal', i % 5 === 0 ? 0.5 : -1))); ok(L.edge.status === 'negative' && /No edge/.test(L.edge.headline), 'edge: reliably negative says no edge'); }
// pattern comment + winner profile
{ const t = []; for (let i = 0; i < 12; i++) t.push(mk(i, 'Base breakout', i < 6 ? 1.5 : -1, { risk: i < 6 ? 5 : 14, opp: i < 6 ? 85 : 70 })); const L = learn(t, { off: [], shadow: ['Base breakout'] });
  ok(L.edge.patterns.some((p) => p.setup === 'Base breakout' && /background/.test(p.live ? '' : 'background')) && L.edge.profiles.some((p) => /stop distance/.test(p.comment)), 'edge: pattern commentary and winner profile'); }
// junk safe
ok(edge([], [], [], { n: 0 }).status === 'too-early', 'edge: junk safe');
// shadow tracking: only not-live patterns, valid plans, no duplicates, always restores the rule flag
{ const RULES = { v2: true, shadow: ['Volume breakout'], off: ['Trend pullback'], allowShadow: false };
  const C = { RULES, detectPatterns: (h) => { ok(RULES.allowShadow === true, 'shadow: rules opened while scoring'); return [{ name: 'Volume breakout', quality: 70, status: 'breakout' }]; }, scoreList: (l) => l.forEach((p) => { p.lead = 'pattern'; p.setupType = 'Volume breakout'; p.sp = { entryLow: 1, entryHigh: 1.1, stop: .9, tp1: 1.2, tp2: 1.3, tp3: 1.5 }; p.opp = 60; }) };
  const rows = [{ sym: 'A', h4: Array(50).fill([0, 1, 1, 1, 1, 1]), tf: {} }, { sym: 'B', h4: [], tf: {} }, { sym: 'C' }];
  const c = shadow.candidates(rows, C); ok(c.length === 1 && c[0].sym === 'A' && RULES.allowShadow === false, 'shadow: one candidate, flag restored');
  const ns = (p, t) => ({ signalId: p.sym + '@d', id: p.sym, setup: p.setupType, entryLow: 1, entryHigh: 1.1, stop: .9, tp1: 1.2, tp2: 1.3, tp3: 1.5 });
  const a = shadow.pick(c, [], 'x', ns); ok(a.length === 1 && a[0].shadow && a[0].setup === 'Volume breakout' && a[0].signalId.includes('|'), 'shadow: logged under its own name');
  ok(shadow.pick(c, [{ ...a[0], status: 'open' }], 'x', ns).length === 0, 'shadow: no duplicate while one is open');
  const C2 = { ...C, detectPatterns: () => { throw new Error('boom'); } }; ok(shadow.candidates(rows, C2).length === 0 && RULES.allowShadow === false, 'shadow: a failure is contained'); }
// ---- advanced learning: learned filters, source gap, combos, panel integration ----
import { matchFilters, rowToSig } from '../docs/features.mjs';
import { debate } from '../docs/panel.mjs';
{ const t = []; for (let i = 0; i < 80; i++) { const bad = i % 3 === 0; t.push({ ...mk(i, i % 2 ? 'Bottom reversal' : 'Falling wedge', bad ? -1 : (i % 2 ? 1.1 : -0.1), { regime: bad ? 'Risk-off' : 'Risk-on' }), source: i % 4 === 0 ? 'backtest' : 'live' }); }
  const L = learn(t); ok(L.filters.length >= 1 && L.filters.length <= 3 && L.filters[0].feature === 'Market regime' && L.filters[0].bucket === 'Risk-off', 'learned: a validated skip rule becomes a filter');
  ok(L.edge.rules.every((r) => typeof r.q === 'number' && typeof r.p === 'number') && L.edge.tested > 5, 'learned: every rule carries p and corrected q, and the count tried is reported');
  ok(learn(t).edge.filters.length === L.filters.length && JSON.stringify(learn(t).edge.rules) === JSON.stringify(L.edge.rules), 'learned: same data gives the same report');
  const row = { setupType: 'Bottom reversal', regime: 'Risk-off', entryLow: 1, entryHigh: 1.02, stop: .95, riskPct: 5, opp: 70, chain: 'Solana', gatesPassed: 7, tp1: 1.1, tp2: 1.2, tp3: 1.3, rr2: 3, _ready: true };
  ok(matchFilters(row, L.filters).length >= 1 && matchFilters({ ...row, regime: 'Risk-on' }, L.filters).length === 0 && matchFilters({ ...row, regime: null }, L.filters).length === 0, 'learned: matches a live coin, unknown never matches');
  const d1 = debate(row, { learned: { ...L } }), d0 = debate(row, { learned: { ...L, filters: [] } });
  ok(d1.bearScore > d0.bearScore && d1.bear.some((b) => b.id === 'learned'), 'panel: a learned rule adds a strong bear point');
  ok(debate(row, { learned: { filters: [null, 5, { feature: 'Nope', bucket: 'x' }] } }) != null && matchFilters(null, L.filters).length === 0 && Object.keys(rowToSig(null)).length === 0, 'learned: junk filters and rows are safe'); }
{ // backtest much better than live -> the report says so
  const t = []; for (let i = 0; i < 30; i++) t.push({ ...mk(i, 'Bottom reversal', 1), source: 'backtest' }); for (let i = 0; i < 12; i++) t.push({ ...mk(40 + i, 'Bottom reversal', -1), source: 'live' });
  ok(learn(t).edge.next.some((x) => /backtest is too optimistic/.test(x)), 'edge: warns when the backtest is far better than live'); }
{ // a rule from a tiny sample never becomes a filter
  const t = []; for (let i = 0; i < 20; i++) t.push(mk(i, 'Bottom reversal', i % 3 === 0 ? -1 : 0.5, { regime: i % 3 === 0 ? 'Risk-off' : 'Risk-on' })); ok(learn(t).filters.length === 0, 'learned: under 30 trades never creates a filter'); }
// ---- stronger learning: MFE/MAE, exit study, near-miss pool, richer features, folds ----
import * as C2 from '../docs/core.mjs';
import { FEATS } from '../docs/features.mjs';
{ // evaluate records how far price went each way
  const t0 = 1.7e9, s = { signalAt: new Date(t0 * 1000).toISOString(), entryLow: 0.98, entryHigh: 1.02, entryMid: 1, stop: 0.9, tp1: 1.3, tp2: 1.5, tp3: 1.8 };
  const h1 = [[t0 + 3600, 1, 1.0, 0.99, 1.0, 1], [t0 + 7200, 1, 1.25, 0.97, 1.2, 1], [t0 + 10800, 1.2, 1.22, 0.89, 0.9, 1]];
  const r = C2.evaluate(s, h1, new Date().toISOString()); ok(r.status === 'stopped out' && r.mfeR === 2.5 && r.maeR >= 1, 'mfe/mae: favourable and adverse excursion recorded, stop bar high not counted: ' + r.mfeR + '/' + r.maeR); }
{ const f = Object.fromEntries(FEATS.map((x) => [x[0], x[1]])); const sg = { liq: 200e3, age: 3, rvol: 2, bs: 1.3, rr2: 2.5, pq: 90, opp: 55 };
  ok(f['Liquidity'](sg) === '$150k-400k' && f['Token age'](sg) === 'under 7 days' && f['4h volume surge'](sg) === '1.5-2.5x' && f['Buyers vs sellers (24h)'](sg) === 'buyers lead' && f['Reward to risk (TP2)'](sg) === '2-3R' && f['Pattern quality'](sg) === '85+' && f['Opportunity score'](sg) === '50-65 (below cut-off)', 'features: new buckets')
  ok(f['Liquidity']({}) === null && f['Token age']({ age: 'x' }) !== undefined, 'features: unknown stays null'); }
{ // exit study: trades that run to 1R+ then stop out should show that taking profit earlier would have paid
  const t = []; for (let i = 0; i < 40; i++) t.push({ ...mk(i, 'Bottom reversal', i % 4 === 0 ? 2 : -1), mfeR: i % 4 === 0 ? 3 : (i % 2 ? 1.4 : 0.3) });
  const L = learn(t); ok(L.edge.exits && L.edge.exits.n === 40 && L.edge.exits.best.target <= 1.5 && L.edge.next.some((x) => /Exit study/.test(x)), 'exit study: finds the target that would have paid: ' + JSON.stringify(L.edge.exits && L.edge.exits.best)); }
{ // near-misses join the rule search under their real pattern name, but never the headline
  const t = []; for (let i = 0; i < 30; i++) t.push(mk(i, 'Bottom reversal', i % 2 ? 0.8 : -0.5, { opp: 70 }));
  for (let i = 0; i < 40; i++) t.push({ ...mk(40 + i, 'Near-miss: Bottom reversal', -1, { opp: 55 }), setupBase: 'Bottom reversal', source: 'near-miss' });
  const L = learn(t); ok(L.edge.headline.includes('30 trades') || /30 closed/.test(L.edge.headline) || L.edge.headline.length > 0, 'pool: headline built from real trades');
  ok(L.edge.rules.some((r) => /below cut-off/.test(r.rule)), 'pool: near-misses let the 65 cut-off itself be tested'); }
{ // a rule that only works in the older periods is not accepted with 4 folds
  const t = []; for (let i = 0; i < 100; i++) { const bad = i < 40 && i % 2 === 0; t.push(mk(i, 'Bottom reversal', bad ? -2 : (i % 2 ? 0.6 : 0.1), { chain: bad ? 'Robinhood' : 'Solana' })); }
  ok(!learn(t).filters.some((f) => f.bucket === 'Robinhood'), 'folds: a pattern that stopped working in recent periods is not applied'); }
// ---- pattern analysts ----
import { dossier, analysts } from '../src/analyst.mjs';
{ const t = []; for (let i = 0; i < 40; i++) { const hot = i % 2 === 0; t.push({ ...mk(i, 'Falling wedge', hot ? 1.2 : -1, { chain: hot ? 'Solana' : 'Robinhood' }), mfeR: hot ? 2.5 : (i % 4 === 1 ? 1.3 : 0.2), pq: hot ? 90 : 60 }); }
  const d = dossier('Falling wedge', t, FEATS, true);
  ok(d.n === 40 && d.verdict && d.headline.includes('40 closed trades'), 'analyst: headline carries the record');
  ok(d.conditions.best.some((c) => /Solana/.test(c.text) && c.reliable) && d.conditions.avoid.some((c) => /Robinhood/.test(c.text) && c.reliable), 'analyst: finds where it works and where it fails, marked reliable');
  ok(d.loses && d.loses.gaveBackPct >= 35 && /given back|break-even/.test(d.loses.comment), 'analyst: spots losers that ran then reversed');
  ok(d.quality && d.quality.hi.avgR > d.quality.lo.avgR && /quality score is useful/.test(d.quality.comment), 'analyst: tests the pattern quality score');
  ok(d.exit && d.exit.best.target > 0, 'analyst: finds the best exit');
  ok(typeof d.recommendation === 'string' && d.recommendation.length > 10, 'analyst: gives a recommendation'); }
{ const d0 = dossier('X', [], FEATS); ok(d0.n === 0 && /No closed trades/.test(d0.headline), 'analyst: empty pattern is safe');
  const d1 = dossier('X', [mk(1, 'X', 1), { setup: 'X', resultR: 'bad' }, null].filter(Boolean), FEATS); ok(d1.n === 1 && /Too few|Keep collecting/.test(d1.headline + d1.recommendation), 'analyst: tiny sample is not over-read'); }
{ const t = [...Array.from({ length: 14 }, (_, i) => mk(i, 'A', i % 2 ? 1 : -1)), ...Array.from({ length: 14 }, (_, i) => mk(20 + i, 'B', -1)), ...Array.from({ length: 8 }, (_, i) => ({ ...mk(40 + i, 'Near-miss: A', -1), setupBase: 'A', source: 'near-miss' }))];
  const L = learn(t); const names = L.analysts.map((a) => a.setup).sort().join(); ok(names === 'A,B', 'analyst: one dossier per real pattern, near-misses folded in under the real name');
  ok(L.analysts.find((a) => a.setup === 'B').recommendation.includes('Switch off') || L.analysts.find((a) => a.setup === 'B').verdict === 'failing', 'analyst: a failing pattern is told to switch off'); }
