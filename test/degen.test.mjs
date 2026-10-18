import * as D from '../docs/degen.mjs';
import { simulate } from '../docs/paper.mjs';
import { parseTrades } from '../src/wallets.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-18T00:00:00Z') / 1000, bar = (i, o, h, l, c) => [T0 + 3600 * i, o, h, l, c, 1000];
const sig = { signalAt: '2026-10-17T23:30:00Z', signalId: 'x', coin: 'X', chain: 'Solana', pool: 'p' };
// entry is the next hourly open plus 3% slippage; stop 20% below
{ const r = D.evaluateDegen(sig, [bar(0, 1, 1.05, 0.95, 1.0), bar(1, 1, 1.1, 0.9, 1.05)], '2026-10-18T02:00:00Z');
  ok(Math.abs(r.entryMid - 1.03) < 1e-3 && Math.abs(r.stop - 0.824) < 1e-3 && r.status === 'open', 'entry = next open + 3%, stop 20% below'); }
// stop out is about -1R (slightly worse on a gap)
{ const r = D.evaluateDegen(sig, [bar(0, 1, 1.02, 0.99, 1), bar(1, 1, 1.0, 0.5, 0.6)], 'n'); ok(r.status === 'stopped out' && r.resultR < -0.95 && r.resultR > -1.6 && r.closedAt, 'stop hit closes near -1R'); }
// 2x sells half, then trails 30% below the high and never below break-even
{ const r = D.evaluateDegen(sig, [bar(0, 1, 1.02, 0.99, 1), bar(1, 1.1, 2.2, 1.1, 2.0), bar(2, 2.0, 3.0, 1.9, 2.9), bar(3, 2.9, 2.95, 1.9, 2.0)], 'n');
  ok(r.status.startsWith('trailed out') && r.tpHit === 1 && r.resultR > 3, 'half sold at 2x then trailed out for a big win: ' + r.resultR); }
// stop is assumed first when one hour touches both
{ const r = D.evaluateDegen(sig, [bar(0, 1, 1.02, 0.99, 1), bar(1, 1, 3, 0.5, 2)], 'n'); ok(r.status === 'stopped out', 'same-hour stop and target: stop first'); }
// time exit after 72 hours
{ const bars = [bar(0, 1, 1.02, 0.99, 1)]; for (let i = 1; i <= 80; i++) bars.push(bar(i, 1, 1.1, 0.95, 1.05)); const r = D.evaluateDegen(sig, bars, 'n'); ok(r.status.startsWith('time exit'), 'time exit at 72 hours'); }
ok(D.evaluateDegen(sig, [], 'n').status === undefined && D.evaluateDegen(sig, null, 'n') != null, 'no candles yet leaves the row alone');
// wallets
const tr = (k, w, u) => ({ kind: k, wallet: w, usd: u, ts: 1 });
{ const w = D.walletStats([tr('buy', 'a', 100), tr('buy', 'b', 100), tr('buy', 'c', 100), tr('sell', 'd', 50), tr('buy', 'e', 100)], [{ address: 'C', label: 'whale' }]);
  ok(w.buyers === 4 && w.sellers === 1 && w.netUsd === 350 && w.smartIn.join() === 'whale', 'wallet counts and smart wallet match (case-insensitive)'); ok(D.walletVerdict(w) === 'smart wallets buying', 'verdict'); ok(D.walletOk(w), 'leaning in passes'); }
{ const w = D.walletStats([tr('sell', 'a', 100), tr('sell', 'b', 100), tr('buy', 'c', 50)]); ok(!D.walletOk(w), 'leaning out is rejected'); }
{ const w = D.walletStats([tr('buy', 'a', 900), tr('buy', 'b', 10), tr('buy', 'c', 10), tr('buy', 'd', 10), tr('sell', 'e', 5)]); ok(w.top3Share > 0.9 && !D.walletOk(w), 'a few wallets doing the volume is rejected'); }
ok(D.walletStats([]) === null && D.walletOk(null), 'no trade data = unchecked, not rejected');
ok(parseTrades({ data: [{ attributes: { kind: 'buy', tx_from_address: 'A', volume_in_usd: '12.5', block_timestamp: '2026-10-18T00:00:00Z' } }, { attributes: {} }] }).length === 1, 'trade feed parsed');
// candidates
const row = (o) => ({ sym: 'R', chain: 'solana', net: 'solana', pool: 'p', price: 1, liq: 80000, v24: 400000, vacc: 4, bs1: 1.4, ch24: 60, ageD: 1, tf: { '4h': { rvol: 3 } }, ...o });
ok(D.candidates([row({})]).length === 1 && D.candidates([row({})])[0].why.includes('new launch'), 'runner with volume, momentum and buyers is a candidate');
ok(D.candidates([row({ vacc: 1, tf: { '4h': { rvol: 1 } } }), row({ ch24: 5 }), row({ ch24: 900 }), row({ bs1: 0.9 }), row({ liq: 10000 }), row({ rug: 'danger' })]).length === 0, 'weak volume, no momentum, too late, sellers leading, thin and dangerous are all rejected');
// picking: respects slots, dedupes, wallet gate
{ const cands = D.candidates([row({ sym: 'A', pool: 'a' }), row({ sym: 'B', pool: 'b' }), row({ sym: 'C', pool: 'c' }), row({ sym: 'E', pool: 'e' })]);
  const bad = D.walletStats([tr('sell', 'a', 100), tr('sell', 'b', 100), tr('buy', 'c', 10)]), W = new Map([['b', bad]]);
  const got = D.pickNew(cands, [], '2026-10-18T05:00:00Z', W); ok(got.length === 3 && !got.some((s) => s.coin === 'B') && got.every((s) => s.desk === 'degen'), 'max 3 new, wallet-rejected coin skipped');
  ok(D.pickNew(cands, got, '2026-10-18T06:00:00Z', W).every((s) => !got.some((g) => g.id === s.id)), 'no duplicate coin while open'); 
  const full = Array.from({ length: 8 }, (_, i) => ({ signalId: 'o' + i, id: 'o' + i, status: 'open', signalAt: '2026-10-18T00:00:00Z' })); ok(D.pickNew(cands, full, '2026-10-18T06:00:00Z').length === 0, 'no new trades when all 8 slots are used'); }
// paper compatibility and reset date
{ const s2 = { ...D.evaluateDegen(sig, [bar(0, 1, 1.02, 0.99, 1), bar(1, 1, 1.1, 0.9, 1.05)], 'n'), setup: 'Degen runner' };
  const p = simulate([s2], { pct: 10 }); ok(p.openN === 1 && Math.abs(p.trades[0].size - 1000) < 1e-6, 'degen trade sized at 10% of the desk'); ok(simulate([s2], { pct: 10, since: '2026-10-18T00:00:00Z' }).trades.length === 0 && simulate([s2], { pct: 10, since: '2026-10-17T00:00:00Z' }).trades.length === 1, 'reset date hides older signals'); }
// runners list
{ const base = { sym: 'R', chain: 'solana', net: 'solana', pool: 'p', price: 1, liq: 120000, v24: 600000, fdv: 2e6, vacc: 5, bs1: 1.5, ch24: 80, ageD: 1.2, tf: { '4h': { rvol: 4 } }, hs: { holders: 1200, top10: 35, growPct: 12 }, soc: { n: 2 }, rug: 'ok' };
  const good = D.walletStats([tr('buy', 'a', 100), tr('buy', 'b', 100), tr('buy', 'c', 100), tr('buy', 'd', 80), tr('sell', 'e', 40)], [{ address: 'a', label: 'sharp' }]);
  const hi = D.runnerScore(base, good), lo = D.runnerScore({ ...base, vacc: 2, tf: { '4h': { rvol: 1 } }, bs1: 1.05, hs: { holders: 90, top10: 85, growPct: 0 }, soc: { n: 0 }, liq: 40000, fdv: 9e6 }, null);
  ok(hi.score > 70 && hi.tier === 'Strong runner' && hi.parts.some((x) => x.k === 'Wallets') && hi.parts.some((x) => x.k === 'Holders'), 'strong runner scores high from volume, wallets and holders: ' + hi.score);
  ok(lo.score < hi.score && lo.flags.some((x) => /top 10/.test(x)) && lo.flags.some((x) => /thin liquidity/.test(x)) && lo.flags.some((x) => /wallet activity not checked/.test(x)), 'weak runner scores lower and lists its risks');
  const c = D.runnerCandidates([base, { ...base, sym: 'Q', vacc: 1, tf: { '4h': { rvol: 1 } } }, { ...base, sym: 'D', rug: 'danger' }, { ...base, sym: 'S', bs1: 0.8 }]); ok(c.length === 1 && c[0].p.sym === 'R', 'candidate filter keeps only volume runs with buyers leading and safe tokens');
  const built = D.buildRunners(c, new Map([['p', good]]), new Set(['SOL:R'])); ok(built[0].paper && built[0].wallet.buyers === 4 && built[0].id === 'SOL:R' && built[0].m.surge >= 4, 'runner rows carry wallet data and the paper-desk marker'); }
// checklist, risk rules, runner log, runner study
{ const base = { sym: 'R', chain: 'solana', net: 'solana', pool: 'p', price: 1, liq: 120000, v24: 600000, fdv: 2e6, vacc: 5, bs1: 1.5, ch24: 80, ageD: 1.2, tf: { '4h': { rvol: 4 } }, hs: { holders: 1200, top10: 35, growPct: 12 }, soc: { n: 2 }, rug: 'ok' };
  const many = (k, n, u) => Array.from({ length: n }, (_, i) => tr(k, k + i, u)); const good = D.walletStats([...many('buy', 12, 100), ...many('sell', 3, 60)]), bad = D.walletStats([...many('sell', 12, 100), ...many('buy', 3, 60)]);
  const g = D.buildRunners([{ p: base }], new Map([['p', good]]))[0], d = D.buildRunners([{ p: base }], new Map([['p', bad]]))[0], u = D.buildRunners([{ p: base }], new Map())[0];
  ok(g.passed === 4 && g.tier === 'Strong' && !g.vetoed.length, 'all four checks pass -> Strong'); ok(d.vetoed.some((x) => /selling/.test(x)) && d.tier === 'Dropped', 'wallets leaning out -> dropped'); ok(u.passed === 3 && u.checks[2].ok === null && !u.vetoed.length, 'unchecked wallets are a question mark, not a failure');
  ok(D.runnerVeto({ ...base, liq: 30000 }, good).some((x) => /liquidity/.test(x)) && D.runnerVeto({ ...base, rug: 'warn' }, good).length === 1 && D.runnerVeto({ ...base, ch24: 500 }, good).length === 1, 'liquidity, flagged token and late pump are vetoed');
  const sg = D.runnerSignal(d, '2026-10-18T05:00:00Z'); ok(sg.listed === false && sg.f.wB === 3 && sg.f.hour === 5 && sg.signalId === 'SOL:R@2026-10-18' && sg.desk === 'runnerlog', 'dropped runner is logged with its numbers');
  const bars = [bar(0, 1, 1.02, 0.99, 1), bar(1, 1, 1.1, 0.7, 0.8)]; const v = D.exitVariants({ signalAt: '2026-10-17T23:30:00Z' }, bars, 'n'); ok(Object.keys(v).length === 6 && v['stop 15%'] > v['stop 25%'], 'exit variants replay the same trade'); }
{ const { runnerReport } = await import('../src/runnerlearn.mjs'); const mk = (i, listed, ret, surge) => ({ status: 'stopped out', retPct: ret, listed, passed: listed ? 3 : 1, f: { surge, ch24: 50, bs1: 1.3, liq: 100000, ageD: 2, hour: 3, regime: 'x' }, variants: { 'stop 15%': ret + 1, 'trail 20%': ret + 6 } });
  const tr2 = []; for (let i = 0; i < 20; i++) tr2.push(mk(i, true, 20 + (i % 3) * 5, 6)); for (let i = 0; i < 20; i++) tr2.push(mk(i, false, -25 + (i % 3) * 5, 2));
  const r = runnerReport(tr2); ok(r.closed === 40 && r.veto.verdict === 'works', 'risk rules verdict: listed beat dropped'); ok(r.findings.some((x) => x.feature === 'Volume surge' && x.reliable), 'volume surge range found reliable'); ok(r.exits[0].name === 'trail 20%', 'exit study finds the better exit');
  const none = runnerReport(Array.from({ length: 30 }, (_, i) => mk(i, i % 2 === 0, (i % 7) - 3, 3))); ok(!none.findings.some((x) => x.reliable), 'noise does not produce reliable findings'); ok(runnerReport([]).closed === 0 && runnerReport(null).logged === 0, 'empty input is safe'); }

{ const D2 = await import('../docs/degen.mjs'); const bars = []; const t0 = Date.parse('2026-10-18T00:00:00Z') / 1000; for (let i = 0; i < 10; i++) bars.push([t0 + i * 3600, 1, 1.02, 0.99, 1.0, 100]);
  const base = { id: 'X', coin: 'X', status: 'waiting for entry', signalAt: '2026-10-17T23:30:00Z', liq: 1e9 }, thin = { ...base, liq: 20000 };
  const a = D2.evaluateDegen(base, bars, '2026-10-18T12:00:00Z'), b = D2.evaluateDegen(thin, bars, '2026-10-18T12:00:00Z');
  ok(b.slipUsed > a.slipUsed && b.slipUsed >= 8, 'thin pool pays more slippage than a deep one'); ok(a.slipUsed <= 3.1, 'deep pool slippage stays near the flat 3%');
  const hist = [{ t: '2026-10-18T00:00:00Z', b: 10, s: 20 }]; const up = D2.walletTrend(hist, { buyers: 30, sellers: 20 }, '2026-10-18T03:00:00Z'), dn = D2.walletTrend(hist, { buyers: 10, sellers: 80 }, '2026-10-18T03:00:00Z');
  ok(up && up.label === 'buying picking up' && dn && dn.label === 'selling picking up', 'wallet trend direction'); ok(D2.walletTrend(hist, { buyers: 30, sellers: 20 }, '2026-10-18T00:10:00Z') === null && D2.walletTrend(null, { buyers: 1, sellers: 1 }, '2026-10-18T03:00:00Z') === null, 'no trend without an older snapshot');
  const rows = Array.from({ length: 20 }, (_, i) => ({ pool: 'p' + i, sym: 'S' + i, chain: 'solana', net: 'solana', price: 1, liq: 80000, v24: 500000 })), skip = new Set(['p0', 'p1']);
  const c1 = D2.controlSample(rows, skip, 6, 5), c2 = D2.controlSample(rows, skip, 6, 5); ok(c1.length === 6 && !c1.some((x) => skip.has(x.p.pool)) && JSON.stringify(c1) === JSON.stringify(c2), 'control sample is random but repeatable and skips runners');
  const sg = D2.runnerSignal(D2.buildRunners(c1)[0], '2026-10-18T10:00:00Z', undefined, { control: true }); ok(sg.control && sg.listed === false && sg.signalId.endsWith('|c'), 'control rows are marked and never listed');
  const { runnerReport } = await import('../src/runnerlearn.mjs'); const mk = (day, ctl, ret, tr) => ({ status: 'stopped out', retPct: ret, listed: !ctl, control: ctl, signalAt: `2026-10-${day}T10:00:00Z`, passed: 3, f: { surge: 5, ch24: 50, bs1: 1.3, liq: 100000, ageD: 2, hour: 3, regime: 'x', wTrend: tr } });
  const tr = []; for (let i = 0; i < 24; i++) tr.push(mk(10 + (i % 5), false, 20 + (i % 3) * 4, 0.6)); for (let i = 0; i < 24; i++) tr.push(mk(10 + (i % 5), false, -15 + (i % 3) * 4, -0.6)); for (let i = 0; i < 16; i++) tr.push(mk(12 + (i % 4), true, -5 + (i % 4), 0));
  for (let i = 0; i < 10; i++) tr.push(mk(26 + (i % 2), false, 18 + (i % 3), 0.6), mk(26 + (i % 2), false, -14 - (i % 3), -0.6));
  const r = runnerReport(tr, new Date('2026-10-29T00:00:00Z'), { lockFrom: '2026-10-25' });
  ok(r.control.verdict === 'beats' && r.control.n === 16, 'runners beat the control group'); ok(r.oos && r.oos.rules.some((x) => x.feature === 'Wallet trend' && x.held === true), 'rule found before the lock date held after it');
  ok(runnerReport(tr, new Date()).oos === undefined, 'no lock date means no locked test'); ok(r.logged === 48 + 20, 'control trades are not counted as runners'); }

{ const D3 = await import('../docs/degen.mjs'); const thin = D3.runnerVeto({ liq: 20000, v24: 300000, ch24: 30 }, null), pump = D3.runnerVeto({ liq: 60000, v24: 60000 * 80, ch24: 30 }, null), good = D3.runnerVeto({ liq: 200000, v24: 900000, ch24: 30 }, null);
  ok(thin.some((x) => x.includes('selling $1,000 would move')), 'exit impact veto on a thin pool'); ok(pump.some((x) => x.includes('pump or wash')), 'volume far above pool vetoed'); ok(good.length === 0, 'healthy pool has no veto');
  const { runnerReport } = await import('../src/runnerlearn.mjs'); const mk = (i, ret) => ({ status: 'stopped out', retPct: ret, listed: true, signalAt: `2026-10-${10 + (i % 6)}T10:00:00Z`, closedAt: `2026-10-${11 + (i % 6)}T${String(i % 24).padStart(2, '0')}:00:00Z`, passed: 3, f: { surge: i % 2 ? 6 : 2, ch24: 50, bs1: 1.3, liq: 100000, ageD: 2, hour: 3, regime: 'x' } });
  const tr = Array.from({ length: 40 }, (_, i) => mk(i, i % 4 === 0 ? 40 : -20)); const r = runnerReport(tr, new Date('2026-10-20T00:00:00Z'), { fills: [{ paperEntry: 1, fillEntry: 1.04, paperExit: 2, fillExit: 1.9, feesUsd: 5, sizeUsd: 500 }, { paperEntry: 1, fillEntry: 1.06, paperExit: 2, fillExit: 1.9, feesUsd: 5, sizeUsd: 500 }] });
  ok(r.risk && r.risk.maxDrawdownPct > 0 && r.risk.suggestedSizePct >= 1 && r.risk.suggestedSizePct <= 10, 'risk view: drawdown and a suggested size'); ok(r.fills && r.fills.n === 2 && Math.abs(r.fills.entryGapPct - 5) < 0.01 && Math.abs(r.fills.exitGapPct - 5) < 0.01 && Math.abs(r.fills.feePct - 1) < 0.01, 'real fills: entry, exit and fee gaps');
  ok(r.progress && r.progress.target === 30 && r.summary.some((x) => x.includes('of 30 closed trades')), 'progress line toward 30 trades'); ok(Array.isArray(r.rolling), 'rolling weekly check present'); ok(runnerReport(tr, new Date(), { fills: 'junk' }).fills === undefined, 'junk fills file is ignored'); }
process.exit(f);
