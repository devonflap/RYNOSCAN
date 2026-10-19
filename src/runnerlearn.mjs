// Runner study: learns from every coin the runners list showed or dropped (logged as a paper trade with the degen exit rules and the numbers at that moment).
// Answers: do the dropped coins really do worse, how many checks passed matters, which numbers separate winners from losers (luck-corrected), and which exit rule suits these coins.
// Report only: it never changes a rule by itself.
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
const r1 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(1));
const pc = (x) => (x > 0 ? '+' : '') + r1(x) + '%';
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function permDiff(all, k, obs, iters = 500) { const rnd = rng(all.length * 17 + k), a = all.slice(); let hit = 0; for (let t = 0; t < iters; t++) { let sa = 0; for (let i = 0; i < k; i++) { const j = i + Math.floor(rnd() * (a.length - i)); const x = a[i]; a[i] = a[j]; a[j] = x; sa += a[i]; } const d = sa / k - (a.reduce((p, q) => p + q, 0) - sa) / (a.length - k); if (Math.abs(d) >= Math.abs(obs) - 1e-9) hit++; } return (hit + 1) / (iters + 1); }
function bh(ps) { const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), q = Array(m); let prev = 1; for (let r = m; r >= 1; r--) { const [p, i] = idx[r - 1]; prev = Math.min(prev, p * m / r); q[i] = prev; } return q; }
const b3 = (v, a, b, la, lb, lc) => (v == null ? null : v < a ? la : v < b ? lb : lc);
const FE = [
  ['Volume surge', (f) => b3(f.surge, 4, 8, 'under 4x', '4x to 8x', '8x or more')], ['24h change', (f) => b3(f.ch24, 25, 100, 'under 25%', '25% to 100%', 'over 100%')], ['Buyers lead', (f) => b3(f.bs1, 1.25, 1.6, 'under 1.25x', '1.25x to 1.6x', 'over 1.6x')],
  ['Liquidity', (f) => b3(f.liq, 75000, 250000, 'under $75k', '$75k to $250k', 'over $250k')], ['Token age', (f) => b3(f.ageD, 1, 7, 'under 1 day', '1 to 7 days', 'over 7 days')], ['Valuation vs liquidity', (f) => b3(f.fdvLiq, 10, 40, 'under 10x', '10x to 40x', 'over 40x')],
  ['Holder growth', (f) => (f.holdG == null ? 'unknown' : f.holdG > 5 ? 'growing over 5%' : f.holdG > 0 ? 'growing slightly' : 'flat or falling')], ['Top 10 wallets hold', (f) => (f.top10 == null ? null : b3(f.top10, 40, 65, 'under 40%', '40% to 65%', 'over 65%'))],
  ['Wallets', (f) => (f.wB == null ? 'unchecked' : f.wB >= f.wS * 1.2 ? 'leaning in' : f.wS >= f.wB * 1.2 ? 'leaning out' : 'mixed')], ['Top 3 wallets share of volume', (f) => (f.top3 == null ? null : b3(f.top3, 0.4, 0.6, 'under 40%', '40% to 60%', 'over 60%'))],
  ['Wallet trend', (f) => (f.wTrend == null ? null : f.wTrend > 0.3 ? 'buying picking up' : f.wTrend < -0.3 ? 'selling picking up' : 'steady')], ['Lifecycle phase', (f) => f.phase || null], ['Found on the 1h/6h trending list', (f) => (f.fresh == null ? null : f.fresh ? 'yes' : 'no')], ['Proven wallets buying', (f) => (f.proven == null ? null : f.proven >= 2 ? '2 or more' : f.proven === 1 ? 'one' : 'none')], ['Smart wallets in', (f) => (f.smart == null ? null : f.smart > 0 ? 'yes' : 'no')], ['Social links', (f) => (f.soc == null ? null : f.soc > 0 ? 'has links' : 'none')], ['Market regime', (f) => f.regime || null],
  ['Hour of day (UTC)', (f) => (f.hour == null ? null : f.hour < 6 ? '00-06' : f.hour < 12 ? '06-12' : f.hour < 18 ? '12-18' : '18-24')],
];
export function runnerReport(trades, now = new Date(), opts = {}) {
  const everything = (Array.isArray(trades) ? trades : []).filter((s) => s && typeof s === 'object' && s.f), ctl = everything.filter((s) => s.control), all = everything.filter((s) => !s.control);
  const isClosed = (s) => s.retPct != null && isFinite(+s.retPct) && !(s.status === 'open' || s.status === 'waiting for entry'), ctlClosed = ctl.filter(isClosed);
  const closed = all.filter(isClosed), open = all.length - closed.length;
  const out = { at: now.toISOString().slice(0, 19) + 'Z', logged: all.length, closed: closed.length, open, summary: [], findings: [], checks: [], exits: [], notes: [] };
  if (!closed.length) { out.summary.push(`Runner study: ${all.length} runners logged, none closed yet. Each closes on its stop, its trail or after 72 hours.`); return out; }
  const R = closed.map((s) => +s.retPct), top = Math.max(...R), exBest = R.length > 1 ? mean(R.filter((x, i) => i !== R.indexOf(top))) : null;
  out.avgRet = r1(mean(R)); out.medianRet = r1(med(R)); out.winRate = +(R.filter((x) => x > 0).length / R.length).toFixed(2); out.avgExBest = r1(exBest); out.bestRet = r1(top);
  out.summary.push(`Runner study: ${closed.length} closed paper trades, average ${pc(mean(R))} (median ${pc(med(R))}, ${Math.round(out.winRate * 100)}% won${exBest != null ? `, ${pc(exBest)} without the single best trade` : ''}).`);
  // 1. do the risk rules help?
  const L = closed.filter((s) => s.listed), D = closed.filter((s) => !s.listed), v = { listed: { n: L.length, avgRet: L.length ? r1(mean(L.map((s) => +s.retPct))) : null }, dropped: { n: D.length, avgRet: D.length ? r1(mean(D.map((s) => +s.retPct))) : null }, verdict: 'unclear' };
  if (L.length >= 8 && D.length >= 8) { const lr = L.map((s) => +s.retPct), dr = D.map((s) => +s.retPct), d = mean(lr) - mean(dr), p = permDiff([...lr, ...dr], lr.length, d); v.p = +p.toFixed(3);
    v.verdict = p <= 0.1 && d >= 5 ? 'works' : p <= 0.1 && d <= -5 ? 'backwards' : 'no-difference'; v.comment = v.verdict === 'works' ? `The risk rules help: listed coins averaged ${pc(mean(lr))} against ${pc(mean(dr))} for dropped ones.` : v.verdict === 'backwards' ? `Warning: dropped coins averaged ${pc(mean(dr))}, better than the ${pc(mean(lr))} of listed ones. The risk rules may be throwing out winners.` : `Listed (${pc(mean(lr))}) and dropped (${pc(mean(dr))}) coins did about the same so far.`; }
  else v.comment = `Not enough closed trades to test the risk rules (listed ${L.length}, dropped ${D.length}; needs 8 each).`;
  out.veto = v; out.summary.push('Risk rules: ' + v.comment);
  // 2. does passing more checks help?
  for (let k = 0; k <= 4; k++) { const g = closed.filter((s) => s.passed === k); if (g.length) out.checks.push({ passed: k, n: g.length, avgRet: r1(mean(g.map((s) => +s.retPct))) }); }
  // 3. which numbers separate winners from losers
  const bucketTests = (rows, minN = 8) => { const tests = [];
    for (const [label, fn] of FE) { const by = new Map(); for (const s of rows) { const b = fn(s.f); if (b == null) continue; if (!by.has(b)) by.set(b, []); by.get(b).push(+s.retPct); }
      for (const [b, g] of by) { const rest = rows.filter((s) => { const x = fn(s.f); return x != null && x !== b; }).map((s) => +s.retPct); if (g.length < minN || rest.length < minN) continue; const d = mean(g) - mean(rest), p = permDiff([...g, ...rest], g.length, d); tests.push({ feature: label, bucket: b, n: g.length, avgRet: r1(mean(g)), restAvgRet: r1(mean(rest)), diff: r1(d), p: +p.toFixed(3) }); } }
    const qs = bh(tests.map((t) => t.p)); tests.forEach((t, i) => { t.q = +qs[i].toFixed(3); t.reliable = t.q <= 0.1 && Math.abs(t.diff) >= 5; }); return tests; };
  const featRows = [...closed, ...ctlClosed], lock = opts.lockFrom && isFinite(Date.parse(opts.lockFrom)) ? Date.parse(opts.lockFrom) : null;
  const tests = bucketTests(lock ? featRows.filter((s) => Date.parse(s.signalAt) < lock) : featRows);
  out.tested = tests.length; out.findings = tests.filter((t) => t.reliable || t.p <= 0.05).sort((a, b) => a.q - b.q || Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 8);
  const rel = out.findings.filter((t) => t.reliable); out.summary.push(rel.length ? `Numbers that reliably separated winners from losers (luck-corrected): ${rel.slice(0, 3).map((t) => `${t.feature} ${t.bucket} (${pc(t.avgRet)} against ${pc(t.restAvgRet)})`).join('; ')}.` : tests.length ? `${tests.length} number ranges were tested and none has beaten luck yet.` : 'Not enough closed trades to test which numbers matter (needs 8 in a range and 8 outside it).');
  // control group: random coins of the same size, same exits
  const LL = closed.filter((s) => s.listed);
  out.control = { n: ctlClosed.length, avgRet: ctlClosed.length ? r1(mean(ctlClosed.map((s) => +s.retPct))) : null, listedN: LL.length, listedAvgRet: LL.length ? r1(mean(LL.map((s) => +s.retPct))) : null, verdict: 'unclear' };
  if (LL.length >= 8 && ctlClosed.length >= 8) { const a = LL.map((s) => +s.retPct), b = ctlClosed.map((s) => +s.retPct), d = mean(a) - mean(b), p = permDiff([...a, ...b], a.length, d); out.control.p = +p.toFixed(3); out.control.verdict = p <= 0.1 && d >= 5 ? 'beats' : p <= 0.1 && d <= -5 ? 'worse' : 'no-difference';
    out.control.comment = out.control.verdict === 'beats' ? `The runners list beat random coins: ${pc(mean(a))} against ${pc(mean(b))}.` : out.control.verdict === 'worse' ? `The runners list did WORSE than random coins (${pc(mean(a))} against ${pc(mean(b))}). The list adds nothing yet.` : `The runners list (${pc(mean(a))}) and random coins (${pc(mean(b))}) did about the same so far.`; }
  else out.control.comment = `Control group not ready: ${ctlClosed.length} random coins closed, ${LL.length} listed runners closed (needs 8 each).`;
  out.summary.push('Against random coins: ' + out.control.comment);
  // locked out-of-sample: rules are found only on trades before the lock date and judged only on trades on or after it
  if (lock) { const test = featRows.filter((s) => Date.parse(s.signalAt) >= lock), disc = featRows.length - test.length, rules = tests.filter((t) => t.reliable); out.oos = { lockedFrom: opts.lockFrom.slice(0, 10), discovery: disc, test: test.length, rules: [] };
    for (const t of rules) { const fn = FE.find((f) => f[0] === t.feature)[1], ins = test.filter((s) => fn(s.f) === t.bucket).map((s) => +s.retPct), outs = test.filter((s) => { const x = fn(s.f); return x != null && x !== t.bucket; }).map((s) => +s.retPct); const r = { feature: t.feature, bucket: t.bucket, found: t.diff, n: ins.length };
      if (ins.length >= 5 && outs.length >= 5) { r.testDiff = r1(mean(ins) - mean(outs)); r.held = Math.sign(r.testDiff) === Math.sign(t.diff) && Math.abs(r.testDiff) >= 5; } else r.held = null; out.oos.rules.push(r); }
    const judged = out.oos.rules.filter((r) => r.held != null), held = judged.filter((r) => r.held).length;
    out.summary.push(!rules.length ? `Locked test (from ${out.oos.lockedFrom}): no rule was found before the lock date, so there is nothing to test yet.` : !judged.length ? `Locked test (from ${out.oos.lockedFrom}): ${rules.length} rule${rules.length === 1 ? '' : 's'} found, but only ${test.length} trades closed since the lock date. Too few to judge.` : `Locked test (from ${out.oos.lockedFrom}): ${held} of ${judged.length} rules found before the lock date also held on ${test.length} later trades.`); }
  // rolling check: for each top finding, in how many separate weeks did the range beat the rest? (consistency across periods, not a fresh test)
  { const wk = (s) => Math.floor(Date.parse(s.signalAt) / (7 * 864e5)), weeks = [...new Set(featRows.map(wk))].sort(), roll = [];
    for (const t of out.findings.slice(0, 5)) { const fn = FE.find((f) => f[0] === t.feature)[1]; let good = 0, seen = 0;
      for (const w of weeks) { const rows = featRows.filter((s) => wk(s) === w), ins = rows.filter((s) => fn(s.f) === t.bucket).map((s) => +s.retPct), outs = rows.filter((s) => { const x = fn(s.f); return x != null && x !== t.bucket; }).map((s) => +s.retPct); if (ins.length < 3 || outs.length < 3) continue; seen++; if (Math.sign(mean(ins) - mean(outs)) === Math.sign(t.diff)) good++; }
      roll.push({ feature: t.feature, bucket: t.bucket, weeks: seen, held: good}); }
    out.rolling = roll.filter((r) => r.weeks > 0); if (out.rolling.length) out.summary.push('Week by week: ' + out.rolling.slice(0, 2).map((r) => `${r.feature} ${r.bucket} pointed the same way in ${r.held} of ${r.weeks} weeks`).join('; ') + '.'); }
  // risk of ruin view: equity path of the listed runners in the order they closed, at a fixed share of the account per trade
  { const seq = closed.filter((s) => s.listed).slice().sort((a, b) => String(a.closedAt || a.checkedAt).localeCompare(String(b.closedAt || b.checkedAt))), pct = 10;
    if (seq.length >= 10) { let eq = 1, peak = 1, dd = 0, run = 0, streak = 0; for (const s of seq) { eq *= 1 + (pct / 100) * (+s.retPct / 100); peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); if (+s.retPct <= 0) { run++; streak = Math.max(streak, run); } else run = 0; }
      const losses = seq.filter((s) => +s.retPct <= 0).map((s) => Math.abs(+s.retPct) / 100), avgLoss = losses.length ? mean(losses) : 0.2, planStreak = Math.max(streak + 2, 6), size = Math.max(1, Math.min(10, Math.floor(30 / (planStreak * Math.max(avgLoss, 0.05)) * 10) / 10));
      out.risk = { n: seq.length, sizePct: pct, maxDrawdownPct: r1(dd * 100), longestLosingStreak: streak, endEquityPct: r1((eq - 1) * 100), suggestedSizePct: size };
      out.summary.push(`Risk: at ${pct}% of the account per trade the listed runners had a worst drawdown of ${r1(dd * 100)}% and a longest losing run of ${streak}. A size of about ${size}% per trade would keep ${planStreak} losses in a row under a 30% account hit.`); } }
  // real fills versus paper fills (entered by hand in config/livefills.json)
  { const fl = Array.isArray(opts.fills) ? opts.fills.filter((f) => f && +f.paperEntry > 0 && +f.fillEntry > 0) : [];
    if (fl.length) { const ent = fl.map((f) => (+f.fillEntry / +f.paperEntry - 1) * 100), ex = fl.filter((f) => +f.paperExit > 0 && +f.fillExit > 0).map((f) => (1 - +f.fillExit / +f.paperExit) * 100), fee = fl.filter((f) => +f.sizeUsd > 0 && +f.feesUsd >= 0).map((f) => (+f.feesUsd / +f.sizeUsd) * 100);
      out.fills = { n: fl.length, entryGapPct: r1(mean(ent)), exitGapPct: ex.length ? r1(mean(ex)) : null, feePct: fee.length ? r1(mean(fee)) : null }; out.fills.totalCostPct = r1((out.fills.entryGapPct || 0) + (out.fills.exitGapPct || 0) + (out.fills.feePct || 0));
      out.summary.push(fl.length < 5 ? `Real fills: ${fl.length} logged, need 5 for a verdict.` : `Real fills: ${fl.length} trades cost about ${out.fills.totalCostPct}% more than paper (entry ${out.fills.entryGapPct}%, exit ${out.fills.exitGapPct ?? '?'}%, fees ${out.fills.feePct ?? '?'}%). Paper results should be cut by that much.`); } }
  out.progress = { closedListed: LL.length, closedControl: ctlClosed.length, target: 30 };
  out.summary.push(`Progress: ${closed.length} of 30 closed trades needed before reading results (${Math.max(0, 30 - closed.length)} to go).`);
  // 4. exit study on the same trades
  const ex = new Map(); for (const s of closed) if (s.variants) for (const [k, x] of Object.entries(s.variants)) { if (!ex.has(k)) ex.set(k, []); ex.get(k).push(+x); }
  const cur = closed.filter((s) => s.variants).map((s) => +s.retPct); if (cur.length >= 8) { out.exits = [{ name: 'current (stop 20%, half at 2x, trail 30%)', n: cur.length, avgRet: r1(mean(cur)) }, ...[...ex].map(([name, a]) => ({ name, n: a.length, avgRet: r1(mean(a)) }))].sort((a, b) => b.avgRet - a.avgRet);
    const best = out.exits[0]; out.summary.push(best.name.startsWith('current') ? 'Exit study: the current exit rule is the best of those tested.' : `Exit study: "${best.name}" averaged ${pc(best.avgRet)} against ${pc(mean(cur))} for the current exit over ${best.n} trades. Treat it as a hint until it holds on more trades.`); }
  out.notes.push('Returns are paper returns after 3% entry slippage plus the price impact of a $1,000 order on the pool liquidity. They ignore gas, exit liquidity and rugs, so real results would be lower. One huge winner can lift an average, so the median and the average without the best trade are shown.');
  return out;
}
