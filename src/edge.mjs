// "Edge report": plain-language commentary from the closed-trade evidence on which rules might create an edge.
// It never changes a rule by itself (promote/demote in learn.mjs does that, with its own thresholds). It proposes candidate rules,
// shows the effect on the same data, and checks each one on an older and a newer half of the trades so a pattern that only
// exists in one slice is labelled as probable noise. Many buckets are tested, so some will look good by chance: a rule is only
// called "holds up" when it helps in BOTH halves with enough trades.
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
const r2 = (x) => (x == null ? null : +(+x).toFixed(2));
// seeded generator so the same data always gives the same report
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// permutation test: how often does a random group of the same size average this low (or lower) by luck alone?
function permP(all, k, obs, iters = 600) { const rnd = rng(all.length * 31 + k), a = all.slice(); let hit = 0; for (let t = 0; t < iters; t++) { let sum = 0; for (let i = 0; i < k; i++) { const j = i + Math.floor(rnd() * (a.length - i)); const x = a[i]; a[i] = a[j]; a[j] = x; sum += a[i]; } if (sum / k <= obs + 1e-12) hit++; } return (hit + 1) / (iters + 1); }
// Benjamini-Hochberg: adjusts p-values for the fact that many rules were tried, so a lucky one does not pass as a finding
function bh(ps) { const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), q = Array(m); let prev = 1; for (let r = m; r >= 1; r--) { const [p, i] = idx[r - 1]; prev = Math.min(prev, p * m / r); q[i] = prev; } return q; }
const sgn = (x) => (x > 0 ? '+' : '') + r2(x) + 'R';

export function edge(closed, FEATS, setups, all, poolIn) {
  const pool = Array.isArray(poolIn) && poolIn.length ? poolIn : closed; // pool: real trades plus the below-cut-off near-misses, so the cut-off itself gets tested
  const n = closed.length, out = { headline: '', status: 'too-early', patterns: [], rules: [], profiles: [], next: [], filters: [], tested: 0, exits: null };
  if (!n) { out.headline = 'No closed trades yet. Nothing can be said about an edge until trades have finished.'; out.next.push('Let the scanner run: every closed trade, including the background tracking of candidate patterns, adds evidence.'); return out; }
  // headline
  if (n < 30) { out.status = 'too-early'; out.headline = `Too early to call. ${n} closed trades (${sgn(all.avgR)} average). Below about 30 trades a streak is indistinguishable from luck, so no rule should be changed on this.`; }
  else if (all.lo90 > 0) { out.status = 'edge-candidate'; out.headline = `Possible edge: ${sgn(all.avgR)} average over ${n} trades, and the 90% range (${sgn(all.lo90)} to ${sgn(all.hi90)}) is above zero. Still unproven live until it holds on new trades.`; }
  else if (all.hi90 < 0) { out.status = 'negative'; out.headline = `No edge: ${sgn(all.avgR)} average over ${n} trades and the 90% range (${sgn(all.lo90)} to ${sgn(all.hi90)}) is below zero. The system as a whole loses money; the rules below are about stopping the bleeding.`; }
  else { out.status = 'unproven'; out.headline = `No edge proven yet: ${sgn(all.avgR)} average over ${n} trades, 90% range ${sgn(all.lo90)} to ${sgn(all.hi90)} includes zero.`; }

  // per pattern commentary
  for (const s of setups) {
    if (String(s.setup).startsWith('Near-miss')) continue;
    let c;
    if (s.verdict === 'unproven') c = `${s.n} closed trades so far, needs about ${s.need} more before a verdict.`;
    else if (s.verdict === 'failing') c = `${sgn(s.avgR)} over ${s.n} trades and reliably negative. ${s.live ? 'The weekly loop will switch it off.' : 'Keep it off.'}`;
    else if (s.verdict === 'proven') c = `${sgn(s.avgR)} over ${s.n} trades, reliably positive with profit factor ${s.pf}. ${s.live ? 'Keep it on.' : 'Eligible to go live.'}`;
    else if (s.verdict === 'promising') c = `${sgn(s.avgR)} over ${s.n} trades but the range still includes zero. ${s.live ? 'Keep watching.' : 'Needs ' + (s.need || 'more') + ' more trades to qualify for live.'}`;
    else c = `${sgn(s.avgR)} over ${s.n} trades, leaning negative but not yet reliably. Gets switched off if it stays this way.`;
    { const list = closed.filter((x) => x.setup === s.setup).sort((a, b) => String(a.at || a.signalAt || '').localeCompare(String(b.at || b.signalAt || ''))), RR = list.map((x) => +x.resultR);
      if (RR.length >= 20) { const last = mean(RR.slice(-10)); if (last < mean(RR) - 0.5) c += ` Recent form is fading: the last 10 trades average ${sgn(last)}.`; else if (last > mean(RR) + 0.5) c += ` Recent form is improving: the last 10 trades average ${sgn(last)}.`; }
      if ((s.verdict === 'promising' || s.verdict === 'weak') && s.avgR > 0 && RR.length > 3) { const sd = Math.sqrt(RR.reduce((a, b) => a + (b - mean(RR)) ** 2, 0) / (RR.length - 1)), need = Math.ceil((1.645 * sd / s.avgR) ** 2); if (isFinite(need) && need > s.n) c += ` At this size of result, about ${need} trades are needed to be reasonably sure.`; } }
    out.patterns.push({ setup: s.setup, live: s.live, verdict: s.verdict, comment: c });
  }

  // winner profile per pattern: what winners had that losers did not
  const by = new Map(); for (const s of closed) { const k = s.setup || 'Unknown'; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  for (const [k, list] of by) {
    const w = list.filter((s) => +s.resultR > 0), l = list.filter((s) => +s.resultR <= 0); if (w.length < 3 || l.length < 3) continue;
    const bits = [];
    for (const [lab, f, unit] of [['stop distance', (s) => s.riskPct, '%'], ['opportunity score', (s) => s.opp, '']]) { const a = med(w.map(f)), b = med(l.map(f)); if (a != null && b != null && Math.abs(a - b) >= (unit ? 1.5 : 3)) bits.push(`winners had a ${lab} of about ${r2(a)}${unit} against ${r2(b)}${unit} for losers`); }
    for (const [lab, FN] of FEATS.filter((x) => ['Chain', 'Market regime', 'Social links', 'Volume day'].includes(x[0])).map((x) => [x[0], x[1]])) { const cnt = (arr) => { const m = {}; arr.forEach((s) => { const v = FN(s); if (v != null) m[v] = (m[v] || 0) + 1; }); return m; }, cw = cnt(w), cl = cnt(l); const top = Object.entries(cw).sort((a, b) => b[1] - a[1])[0]; if (top && top[1] / w.length >= 0.7 && (cl[top[0]] || 0) / l.length <= 0.4) bits.push(`${Math.round(top[1] / w.length * 100)}% of winners were ${lab.toLowerCase()} "${top[0]}" against ${Math.round((cl[top[0]] || 0) / l.length * 100)}% of losers`); }
    out.profiles.push({ setup: k, wins: w.length, losses: l.length, comment: bits.length ? bits.join('; ') + '.' : 'No clear difference between winners and losers yet on the recorded features.' });
  }

  // candidate rules. Each is a "skip trades like this" filter. Tested on the whole sample with a permutation test and a Benjamini-Hochberg
  // correction for the number of rules tried, and on an older 60% / newer 40% split. Single features, and pattern x feature combinations.
  const sorted = pool.slice().sort((a, b) => String(a.at || a.signalAt || '').localeCompare(String(b.at || b.signalAt || ''))), K = sorted.length >= 80 ? 4 : 2, folds = Array.from({ length: K }, (_, i) => sorted.slice(Math.floor(i * sorted.length / K), Math.floor((i + 1) * sorted.length / K)));
  const R = pool.map((s) => +s.resultR), base = mean(R);
  const cands = [], setupsSeen = [...new Set(pool.map((s) => s.setup).filter(Boolean))];
  const seen = new Set(), total = {}; pool.forEach((s) => { total[s.setup] = (total[s.setup] || 0) + 1; });
  const consider = (text, pred, filter) => {
    const inB = pool.filter(pred); if (inB.length < 8 || pool.length - inB.length < 8) return;
    if (filter.setup && inB.length > 0.85 * total[filter.setup]) return; // that is just 'skip the whole pattern', which the on/off logic already handles
    const sig = inB.map((s) => pool.indexOf(s)).join(','); if (seen.has(sig)) return; seen.add(sig); // same trades as a rule already tried
    const m = mean(inB.map((s) => +s.resultR)); cands.push({ text, pred, filter, n: inB.length, m, p: permP(R, inB.length, m) });
  };
  for (const [label, fn] of FEATS) {
    const keys = [...new Set(pool.map(fn).filter((v) => v != null))];
    for (const k of keys) {
      consider(`Skip trades where ${label.toLowerCase()} is "${k}"`, (s) => fn(s) === k, { feature: label, bucket: k });
      if (setupsSeen.length > 1) for (const st of setupsSeen) consider(`Skip ${st} trades where ${label.toLowerCase()} is "${k}"`, (s) => s.setup === st && fn(s) === k, { feature: label, bucket: k, setup: st });
    }
  }
  const qs = bh(cands.map((c) => c.p)); cands.forEach((c, i) => { c.q = qs[i]; });
  out.tested = cands.length;
  for (const c of cands) {
    const keep = pool.filter((s) => !c.pred(s)), gain = mean(keep.map((s) => +s.resultR)) - base; if (c.m > base - 0.3 || gain < 0.05) continue;
    // chronological folds: the rule must beat 'keep everything' in the newest fold and in all but at most one other fold that has enough trades
    const fres = folds.map((f) => { const x = f.filter(c.pred), y = f.filter((s) => !c.pred(s)); return x.length >= 3 && y.length >= 3 ? mean(y.map((s) => +s.resultR)) - mean(x.map((s) => +s.resultR)) > 0 : null; });
    const known = fres.filter((v) => v !== null), nGood = known.filter(Boolean).length, last = fres[fres.length - 1], both = known.length >= 2 && last !== false && (K === 2 ? nGood === known.length : known.length - nGood <= 1 && last === true);
    const status = c.n >= 15 && both && c.q <= 0.25 ? 'holds up' : both && c.q <= 0.25 ? 'holds up, but few trades' : both ? 'consistent but could be luck (many rules were tried)' : (known.length < 2) ? 'not enough trades to check' : 'only some periods: probably noise';
    out.rules.push({ rule: c.text, trades: c.n, avgR: r2(c.m), keepAvgR: r2(mean(keep.map((s) => +s.resultR))), gain: r2(gain), p: +c.p.toFixed(3), q: +c.q.toFixed(3), status, ok: status === 'holds up', filter: c.filter });
  }
  out.rules.sort((a, b) => (b.ok - a.ok) || b.gain - a.gain); out.rules = out.rules.slice(0, 10);
  out.filters = out.rules.filter((r) => r.ok && n >= 30).slice(0, 3).map((r) => ({ ...r.filter, label: r.rule, avgR: r.avgR, trades: r.trades, q: r.q }));

  // exit study: every tracked trade records how far price went in your favour (mfeR) before it ended. If you had taken all profit at a fixed
  // target T instead of the 3-step ladder, what would the same trades have averaged? An estimate only: it ignores slippage on the exit.
  { const ex = pool.filter((s) => s.mfeR != null && isFinite(+s.mfeR) && s.resultR != null);
    if (ex.length >= 20) { const actual = mean(ex.map((s) => +s.resultR)), rows = [0.5, 1, 1.5, 2, 3, 4].map((T) => ({ target: T, avgR: r2(mean(ex.map((s) => (+s.mfeR >= T ? T : +s.resultR)))), reachPct: Math.round(ex.filter((s) => +s.mfeR >= T).length / ex.length * 100) }));
      const best = rows.slice().sort((a, b) => b.avgR - a.avgR)[0]; out.exits = { n: ex.length, actualAvgR: r2(actual), rows, best };
      if (best.avgR - actual >= 0.15 && ex.length >= 30) out.next.push(`Exit study (${ex.length} tracked trades): taking all profit at ${best.target}R would have averaged ${sgn(best.avgR)} against ${sgn(actual)} with the current 3-step exits (${best.reachPct}% of trades got that far). An estimate before exit slippage, worth testing as a rule.`);
      else if (ex.length >= 30) out.next.push(`Exit study (${ex.length} tracked trades): no fixed profit target beats the current 3-step exits by a meaningful margin.`); } }
  // does the backtest tell the truth? Compare it with what live and background trades actually did.
  { const g = {}; for (const s of closed) { const k = s.source || 'live'; (g[k] = g[k] || []).push(+s.resultR); }
    const bt = g.backtest, lv = [...(g.live || []), ...(g.shadow || [])];
    if (bt && bt.length >= 10 && lv.length >= 8) { const d = mean(bt) - mean(lv); out.source = { backtest: { n: bt.length, avgR: r2(mean(bt)) }, live: { n: lv.length, avgR: r2(mean(lv)) } };
      if (d > 0.3) out.next.push(`The backtest averages ${sgn(mean(bt))} but live and background trades average ${sgn(mean(lv))}. The backtest is too optimistic (fills, slippage and coins that later died), so trust live results over it.`);
      else if (d < -0.3) out.next.push(`Live and background trades (${sgn(mean(lv))}) are beating the backtest (${sgn(mean(bt))}), which is a good sign for the live results.`); } }
  const good = out.rules.filter((r) => r.ok);
  if (good.length) out.next.push(`Candidate rule${good.length > 1 ? 's' : ''} that held up on both older and newer trades and survived the correction for trying many rules: ${good.map((r) => r.rule.toLowerCase()).join('; ')}. ${out.filters.length ? 'These are now applied as warnings on matching coins (the panel treats them as a strong reason to pass), and are re-tested every week.' : 'Worth applying and re-testing on new trades.'}`);
  else if (n >= 30) out.next.push('No single filter has helped in both halves of the data, so there is no rule to add yet. That is a finding, not a failure: do not add rules for the sake of it.');
  if (n < 30) out.next.push(`Collect about ${30 - n} more closed trades before acting on anything here. The background tracking of candidate patterns and near-misses is what fills this fastest.`);
  const unprov = setups.filter((s) => !s.live && !String(s.setup).startsWith('Near-miss') && s.verdict !== 'proven' && s.verdict !== 'failing');
  if (unprov.length) out.next.push(`Candidate patterns still gathering evidence: ${unprov.map((s) => `${s.setup} (${s.n})`).join(', ')}.`);
  out.next.push('A rule counts as an edge only if it keeps working on trades that came after it was found. Re-check each new rule after its first 20 trades.');
  return out;
}
