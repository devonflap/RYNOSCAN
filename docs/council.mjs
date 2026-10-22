// Review council: six rule-based reviewers, each wearing a different hat, read every paper book and argue about it; a chair
// (who never takes a position) weighs them and gives one final answer. Pure statistics on the paper results, no AI service and
// nothing paid, so it runs on GitHub with every scan. Shared by the scanner (writes docs/data/council.json) and the dashboard.
// It only ever acts on paper: the "council bot" in the bot simulator trades the books the chair approves. Real rules are never
// switched on or off by the council; anything like that is listed under "needs your OK".
import { book, statsBook, fromSignal, fromRun } from './exits.mjs';
import { BOOKS } from './strategies.mjs';
import { evidence, bootstrap, exitHint, pDiff, bhQ, sizeStudy } from './evidence.mjs';
import { botBook, BOT } from './botsim.mjs';

export const HATS = [
  { key: 'stats', name: 'Statistician', role: 'counts the evidence', icon: '📊' },
  { key: 'skeptic', name: 'Skeptic', role: 'tries to break every result', icon: '🧐' },
  { key: 'risk', name: 'Risk manager', role: 'asks what could blow up the account', icon: '🛡️' },
  { key: 'exits', name: 'Exit tuner', role: 'same coins, different exits', icon: '✂️' },
  { key: 'scout', name: 'Scout', role: 'looks for where the next edge is', icon: '🔭' },
  { key: 'exec', name: 'Execution', role: 'checks the fills are believable', icon: '⚙️' },
  { key: 'live', name: 'Bot desk', role: 'reads what the server bots actually did', icon: '🤖' },
  { key: 'chair', name: 'Chair', role: 'never takes a position · gives the final answer', icon: '⚖️' },
];
export const NEED = 30; // closed trades before any book is judged
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(2));
const R = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(2) + 'R');
const P = (x, d = 0) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(d) + '%');
const pc = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const short = (k) => (BOOKS[k] ? BOOKS[k].short : BOT[k] ? BOT[k].short : k);
const pairKey = (t) => { const k = String((t && t.key) || ''), i = k.indexOf('|'); return i > 0 && BOOKS[k.slice(0, i)] ? k.slice(i + 1) : k; };

// every paper book rebuilt from the data files, with its account and evidence
export function gather({ signals = [], degen = [], lab = [], since = null, now = Date.now() } = {}) {
  const tests = Object.keys(BOOKS).length + 2, books = {}, allPos = [];
  for (const [k, B] of Object.entries(BOOKS)) {
    const rows = k === 'bid' ? signals : k === 'degen' ? degen : lab.filter((x) => x && x.book === k);
    const pos = (k === 'bid' ? rows.map(fromSignal) : k === 'degen' ? rows.map((x) => fromRun(x, 'degen')) : rows.map((x) => fromRun(x))).filter(Boolean);
    if (!B.noBot) pos.forEach((x) => allPos.push({ ...x, src: k }));
    // b: the account (slots, cash) for drawdowns and money; st: every recorded signal, for the statistics
    const b = book(pos, { pct: B.pct, slots: B.slots, since, now }), st = statsBook(pos, { since, now }), ev = evidence(st, { tests, now });
    books[k] = { key: k, B, rows, b, st, ev };
  }
  return { books, allPos, tests, since, now };
}

// same entries, different exits: compare trade by trade (the coin and the timing are identical, so the gap is the exit alone)
export function paired(baseTrades, altTrades, minN = 10) {
  const m = new Map((baseTrades || []).filter((t) => !t.open).map((t) => [pairKey(t), t])), d = [];
  for (const t of altTrades || []) { if (t.open) continue; const u = m.get(pairKey(t)); if (u) d.push(t.pnlPct - u.pnlPct); }
  const n = d.length, out = { n, diff: r2(mean(d)), better: n ? r2(d.filter((x) => x > 0).length / n) : null };
  const b = n >= 5 ? bootstrap(d, 4000, 11) : null; if (b) { out.lo = r2(b.lo); out.hi = r2(b.hi); }
  out.call = n < minN ? 'too few' : b.lo > 0 ? 'better' : b.hi < 0 ? 'worse' : 'no clear difference';
  return out;
}

// ---------- the hats ----------
function hatStats(G) {
  const rows = Object.values(G.books).filter((x) => x.key !== 'randomCtl'), seen = rows.filter((x) => x.ev.n > 0), total = seen.reduce((a, x) => a + x.ev.n, 0), notes = {};
  for (const x of rows) { const e = x.ev; if (!e.n && !e.open) continue; notes[x.key] = e.n < 5 ? `${e.n} closed of ${NEED}: nothing to measure yet.` : `${e.n} closed of ${NEED}, ${R(e.avgR)} a trade (90% range ${R(e.lo)} to ${R(e.hi)}), ${pc(e.pPos)} chance the true average is above zero.${e.n < NEED ? ` ${NEED - e.n} more trades before I would call it${e.etaDays ? ` (about ${e.etaDays} days at this pace)` : ''}.` : ''}`; }
  const edge = rows.filter((x) => x.ev.verdict === 'edge'), close = rows.filter((x) => x.ev.n >= 5 && x.ev.avgR > 0).sort((a, b) => (b.ev.pPos ?? 0) - (a.ev.pPos ?? 0) || b.ev.n - a.ev.n).slice(0, 3), losing = rows.filter((x) => ['losing', 'no edge'].includes(x.ev.verdict));
  const points = [...close.map((x) => `${x.B.short}: ${notes[x.key]}`), ...losing.slice(0, 3).map((x) => `${x.B.short} is losing: ${R(x.ev.avgR)} a trade over ${x.ev.n}, range ${R(x.ev.lo)} to ${R(x.ev.hi)}.`)];
  const headline = edge.length ? `Edge candidate: ${edge.map((x) => `${x.B.short} (${x.ev.n} trades, ${R(x.ev.avgR)})`).join(', ')}.` : total < NEED ? `Too early: ${total} closed trades across all books. One book needs ${NEED} before it can be judged.` : close.length ? `No edge proven yet. Closest: ${close[0].B.short}, ${pc(close[0].ev.pPos)} likely positive over ${close[0].ev.n} trades.` : 'No edge proven yet, and no book is averaging a profit.';
  const best = close[0] ? close[0].ev.pPos : null;
  return { stance: edge.length ? 'for' : close.length ? 'wait' : losing.length ? 'against' : 'wait', headline, points: points.length ? points : ['Every book is still collecting trades.'], notes, metric: best != null ? pc(best) : `${total}`, metricLabel: best != null ? 'best book likely positive' : 'closed trades', total };
}

// Deflated-Sharpe idea (Bailey and Lopez de Prado): the more variants you try, the higher the best lucky one looks. With N variants the
// expected best of N skill-free means is about sqrt(2 ln N) standard errors above zero; a book must beat that bar, not just zero.
export function deflatedBar(e) { if (!e || !(e.n >= 10) || e.sd == null || e.tests == null) return null; const trials = Math.max(1, e.tests), z = Math.sqrt(2 * Math.log(trials)); return { trials, z: +z.toFixed(2), need: +((z * e.sd) / Math.sqrt(e.n)).toFixed(2) }; }
function hatSkeptic(G) {
  const base = G.books.randomCtl ? G.books.randomCtl.ev : null, notes = {}, checks = {};
  for (const x of Object.values(G.books)) { const e = x.ev; if (x.key === 'randomCtl' || e.n < 10 || !(e.avgR > 0)) continue;
    const ck = [];
    ck.push(base && base.n >= 10 ? [e.avgR > base.avgR + 0.1, `beats random entries (${R(base.avgR)}) by 0.1R or more`] : [null, 'random baseline still collecting']);
    ck.push([e.exBestR > 0, 'still positive without its single best trade']);
    { const bar = deflatedBar(e); ck.push(bar == null ? [null, 'too few trades for the variants bar'] : [e.avgR >= bar.need, `clears the variants bar: with ${bar.trials} rules and exits tried, the best loser would show about ${R(bar.need)} by luck`]); }
    ck.push(e.half1 != null ? [e.half1 > 0 && e.half2 > 0, 'first and second half both positive'] : [null, 'too few trades to split in halves']);
    ck.push(e.stressR != null ? [e.stressR > 0, 'survives 1% extra cost per round trip'] : [null, 'no cost check yet']);
    if (e.slipR != null) ck.push([e.slipR > 0, 'survives stops filling 5% worse (DEXes have no resting stop orders)']);
    const mk = (e.bySol || []).filter((g) => g.n >= 5); ck.push(mk.length >= 2 ? [mk.filter((g) => g.avgR > 0).length >= 2, 'works in more than one market mood'] : [null, 'only one market mood seen so far']);
    const done = x.b.trades.filter((t) => !t.open), byCoin = new Map(); for (const t of done) byCoin.set(t.coin, (byCoin.get(t.coin) || 0) + t.pnl); const posSum = [...byCoin.values()].filter((v) => v > 0).reduce((a, v) => a + v, 0), top = posSum > 0 ? Math.max(...byCoin.values()) / posSum : null;
    ck.push(top != null ? [top < 0.5, 'profit not from one coin'] : [null, 'no profit to split by coin']);
    const known = ck.filter((c) => c[0] != null), passed = known.filter((c) => c[0]).length, fails = known.filter((c) => !c[0]).map((c) => c[1]);
    checks[x.key] = { passed, known: known.length, of: ck.length, fails, pending: ck.filter((c) => c[0] == null).map((c) => c[1]) };
    notes[x.key] = fails.length ? `Not convinced: it fails "${fails.join('", "')}". ${passed} of ${known.length} checks passed.` : `Passes ${passed} of ${known.length} checks so far${ck.length > known.length ? ` (${ck.length - known.length} can't be run yet: ${ck.filter((c) => c[0] == null).map((c) => c[1]).join('; ')})` : ''}.`; }
  const keys = Object.keys(checks).sort((a, b) => checks[b].passed - checks[a].passed || G.books[b].ev.n - G.books[a].ev.n);
  const headline = !keys.length ? 'Nothing to attack yet: no book has 10+ closed trades with a positive average.' : checks[keys[0]].fails.length ? `Even the best, ${short(keys[0])}, fails: ${checks[keys[0]].fails[0]}.` : `${short(keys[0])} survives every check I can run (${checks[keys[0]].passed}/${checks[keys[0]].known}).`;
  const points = keys.slice(0, 4).map((k) => `${short(k)}: ${notes[k]}`);
  if (base) points.push(base.n >= 10 ? `Random baseline: ${R(base.avgR)} a trade over ${base.n}. Any book whose entries matter has to beat this.` : `Random baseline: ${base.n} closed of 10 needed before it can be used as the bar to beat.`);
  return { stance: !keys.length ? 'wait' : checks[keys[0]].fails.length ? 'against' : 'for', headline, points, notes, checks, metric: keys.length ? `${checks[keys[0]].passed}/${checks[keys[0]].known}` : '—', metricLabel: 'checks passed by the best book' };
}

function hatRisk(G, bots) {
  const notes = {}, flags = [];
  for (const x of Object.values(G.books)) { const e = x.ev, b = x.b, done = b.trades.filter((t) => !t.open && t.R != null); if (done.length < 5) continue;
    const worst = Math.min(...done.map((t) => t.R)), gap = done.filter((t) => t.R < -1.25).length / done.length, f = [];
    if (done.length >= 10 && gap >= 0.2) f.push(`${pc(gap)} of trades lost more than 1.25x the planned risk (stops gapping or thin exits)`);
    if (b.maxDD > 25) f.push(`deepest drop ${b.maxDD.toFixed(0)}% from peak`);
    if (b.losingRun >= 8) f.push(`${b.losingRun} losers in a row`);
    const dead = x.rows.filter((r) => r && r.dead).length, closedRows = x.rows.filter((r) => r && r.status && r.status !== 'open' && r.status !== 'waiting for entry' && !/^(expired|cancelled|no data)/.test(r.status)).length; if (closedRows >= 10 && dead / closedRows >= 0.15) f.push(`${pc(dead / closedRows)} of its closed trades were coins whose pool died (rug or delisting)`);
    notes[x.key] = `Deepest drop ${b.maxDD.toFixed(0)}%, worst trade ${R(worst)}, longest losing run ${b.losingRun}${gap > 0 ? `, ${pc(gap)} of trades lost more than planned` : ''}.${f.length ? ' Flag: ' + f.join('; ') + '.' : ''}`;
    if (f.length) flags.push({ key: x.key, text: `${x.B.short}: ${f.join('; ')}` }); }
  const points = flags.map((f) => f.text), sizing = {};
  // size study: is more (or less) risk per trade better, measured as return against the deepest drop, on each book with 30+ closed trades
  for (const x of Object.values(G.books)) { if (x.key === 'randomCtl') continue; const done = x.b.trades.filter((t) => !t.open && t.R != null).map((t) => t.R), ss = sizeStudy(done); if (!ss.rows.length) continue; sizing[x.key] = ss;
    const at1 = ss.rows.find((r) => r.risk === 1), b = ss.best; if (b && at1) points.push(`${x.B.short} size study (${ss.n} trades): at 1% a trade ${P(at1.retPct, 0)} with a ${at1.ddPct}% deepest drop; best return-to-drop is ${b.risk}% a trade (${P(b.retPct, 0)}, drop ${b.ddPct}%, unlucky-order drop ${b.dd95Pct}%)${b.risk > 1 ? ': more size would have paid, but only once the edge is proven' : b.risk < 1 ? ': less size would have paid' : ''}.`); else points.push(`${x.B.short} size study (${ss.n} trades): no risk level keeps the unlucky-order drop under ${ss.maxDD}%; size down, not up.`); }
  for (const [k, b] of Object.entries(bots)) if (b.closedN || b.openN) { const dl = b.skipWhy['daily loss limit hit'] || 0; points.push(`${BOT[k].short}: ${P(b.retPct, 1)}, deepest drop ${b.maxDD.toFixed(0)}%${dl ? `, daily loss limit stopped ${dl} trade${dl === 1 ? '' : 's'}` : ''}${b.stacked && b.stacked.length ? `, ${b.stacked.length} coin${b.stacked.length === 1 ? '' : 's'} held by 2+ books right now` : ''}.`); }
  const judged = Object.values(G.books).filter((x) => x.ev.n >= 5), worstDD = Math.max(0, ...judged.map((x) => x.b.maxDD));
  return { sizing, stance: flags.length ? 'against' : judged.length ? 'for' : 'wait', headline: flags.length ? `Warning: ${flags[0].text}.` : judged.length ? 'No blow-up risk flagged so far: losses are staying close to plan.' : 'Too few closed trades to judge risk yet (a book needs 5).', points: points.length ? points : ['Not enough closed trades to judge risk yet.'], notes, flags, metric: worstDD ? worstDD.toFixed(0) + '%' : '—', metricLabel: 'deepest book drawdown' };
}

function hatExits(G, learned) {
  const groups = {}; for (const [k, B] of Object.entries(BOOKS)) if (B.same && k !== B.same) (groups[B.same] ||= []).push(k);
  const pairs = [], notes = {};
  for (const [base, alts] of Object.entries(groups)) { if (!G.books[base]) continue; for (const k of alts) {
    // an entry variant (limit instead of market) is judged per signal: a missed fill counts as 0%, so skipping the losers by luck is not a free win
    const missed = BOOKS[k].entryVariant ? G.books[k].rows.filter((r) => /^(expired|cancelled)/.test(r.status || '')).map((r) => ({ key: r.lid, open: false, pnlPct: 0 })) : [];
    const p = paired(G.books[base].b.trades, [...G.books[k].b.trades, ...missed]); pairs.push({ base, alt: k, ...p });
    notes[k] = p.n < 5 ? `${p.n} shared closed trades with ${short(base)} so far; needs 10 to compare.` : `Against ${short(base)} on the same ${p.n} coins: ${P(p.diff, 1)} a trade (range ${P(p.lo, 1)} to ${P(p.hi, 1)}), better on ${pc(p.better)} of them. ${p.call === 'better' ? 'Clearly better.' : p.call === 'worse' ? 'Clearly worse.' : p.call === 'too few' ? 'Too few to call.' : 'No clear difference yet.'}`; } }
  const points = pairs.filter((p) => p.n >= 1).sort((a, b) => b.n - a.n).map((p) => `${short(p.alt)} vs ${short(p.base)}: ${notes[p.alt]}`);
  const ex = learned && learned.runners && Array.isArray(learned.runners.exits) ? learned.runners.exits : [];
  if (ex.length >= 2) { const cur = ex[0], alt = ex.slice(1).filter((x) => x.n >= 8).sort((a, b) => b.avgRet - a.avgRet).slice(0, 2); if (alt.length) points.push(`Runner study (every logged runner replayed): current exits ${P(cur.avgRet, 1)} a trade over ${cur.n}; best alternatives ${alt.map((x) => `${x.name} ${P(x.avgRet, 1)}`).join(', ')}.`); }
  for (const x of Object.values(G.books)) { const h = exitHint(x.ev); if (h) { notes[x.key] = (notes[x.key] ? notes[x.key] + ' ' : '') + h; points.push(`${x.B.short}: ${h}`); } }
  const clear = pairs.filter((p) => p.call === 'better' || p.call === 'worse').sort((a, b) => b.n - a.n), most = pairs.slice().sort((a, b) => b.n - a.n)[0];
  const headline = clear.length ? `${short(clear[0].alt)} is clearly ${clear[0].call} than ${short(clear[0].base)} on the same coins (${P(clear[0].diff, 1)} a trade over ${clear[0].n}).` : most && most.n ? `No exit has pulled clearly ahead yet (most shared trades: ${most.n}, ${short(most.alt)} vs ${short(most.base)}).` : 'Exit comparisons start once the copies of the same coins close.';
  return { stance: clear.some((p) => p.call === 'better') ? 'for' : clear.length ? 'against' : 'wait', headline, points: points.length ? points : ['Waiting for shared trades to close.'], notes, pairs, metric: most ? String(most.n) : '0', metricLabel: 'most shared trades compared' };
}

// where each book works: its closed trades split by market mood, volume day, lifecycle phase, liquidity, hour, chain, and for the bot's
// books also setup type, bid-ready vs watch, trigger kind, score band and stop distance. Each slice is
// compared with the rest of that book's trades; the q-value corrects for every slice tested across every book.
const SLICES = [
  ['market mood', (t) => (t.mkt && t.mkt.sol) || null], ['volume day', (t) => (t.mkt && t.mkt.vol) || null], ['lifecycle phase', (t) => (t.sig && t.sig.phase) || null],
  ['liquidity', (t) => (t.liq == null ? null : t.liq < 150000 ? 'under $150k' : t.liq < 400000 ? '$150k-400k' : '$400k+')],
  ['hour (UTC)', (t) => { const h = new Date(t.at).getUTCHours(); return isFinite(h) ? (h < 6 ? '00-06' : h < 12 ? '06-12' : h < 18 ? '12-18' : '18-24') : null; }], ['chain', (t) => t.chain || null],
  // where the bot's rules work (rows that carry these fields: the Bot rules books mostly)
  ['setup type', (t) => (t.sig && t.sig.setupType) || null], ['signal', (t) => { const w = String(((t.sig && t.sig.why) || [])[0] || ''); return /bid-ready/.test(w) ? 'bid-ready' : /worth watching/.test(w) ? 'worth watching' : null; }],
  ['trigger', (t) => (t.sig && t.sig.trig) || null], ['score', (t) => { const o = t.sig && t.sig.opp; return o == null ? null : o < 70 ? 'under 70' : o < 80 ? '70-79' : '80+'; }],
  ['stop distance', (t) => { const d = t.entryPx > 0 && t.stop0 > 0 ? (1 - t.stop0 / t.entryPx) * 100 : null; return d == null ? null : d < 8 ? 'under 8%' : d < 12 ? '8-12%' : '12%+'; }],
];
export function bookSlices(G, minBook = 20, minN = 8) {
  const tests = [];
  for (const x of Object.values(G.books)) { const done = (x.st || x.b).trades.filter((t) => !t.open && t.R != null && isFinite(t.R)); if (done.length < minBook) continue;
    for (const [label, fn] of SLICES) { const by = new Map(); for (const t of done) { const k = fn(t); if (k == null) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(t.R); }
      for (const [k, a] of by) { const rest = [...by].filter(([j]) => j !== k).flatMap(([, v]) => v); if (a.length < minN || rest.length < minN) continue;
        const m = mean(a), mr = mean(rest), byT = done.slice().sort((u, v) => Date.parse(u.closedAt || u.at) - Date.parse(v.closedAt || v.at)), h = Math.floor(byT.length / 2), half = (arr) => { const i = arr.filter((t) => fn(t) === k).map((t) => t.R), o = arr.filter((t) => { const z = fn(t); return z != null && z !== k; }).map((t) => t.R); return i.length >= 3 && o.length >= 3 ? Math.sign(mean(i) - mean(o)) : 0; };
        tests.push({ book: x.key, short: x.B.short, slice: label, bucket: k, n: a.length, avgR: r2(m), restAvgR: r2(mr), diff: r2(m - mr), p: pDiff(a, rest), halves: half(byT.slice(0, h)) === Math.sign(m - mr) && half(byT.slice(h)) === Math.sign(m - mr) }); } } }
  const q = bhQ(tests.map((t) => t.p)); tests.forEach((t, i) => { t.q = +q[i].toFixed(3); t.reliable = t.q <= 0.1 && Math.abs(t.diff) >= 0.3 && t.halves; }); // a slice must also point the same way in the older and newer half of the trades
  return tests.sort((a, b) => a.q - b.q);
}
function hatScout(learned, wscore, G) {
  const slices = bookSlices(G), relS = slices.filter((t) => t.reliable);
  const pts = relS.slice(0, 4).map((t) => `${t.short} in ${t.slice} "${t.bucket}": ${R(t.avgR)} over ${t.n} against ${R(t.restAvgR)} otherwise (passes the luck check across ${slices.length} slices).`);
  if (!relS.length && slices.length) pts.push(`Where each book works: ${slices.length} book-and-condition slices tested, none clearly different yet.`);
  const f = learned && Array.isArray(learned.features) ? learned.features : [];
  const rel = (x) => (x.reliable != null ? x.reliable && x.diff != null : (x.lo90 > 0 || x.hi90 < 0)), dif = (x) => (x.diff != null ? x.diff : x.avgR), good = f.filter((x) => rel(x) && dif(x) > 0 && x.avgR > 0).sort((a, b) => dif(b) - dif(a)).slice(0, 3), bad = f.filter((x) => rel(x) && dif(x) < 0 && x.n >= 10).sort((a, b) => dif(a) - dif(b)).slice(0, 3);
  const vs = (x) => (x.restAvgR != null ? ` against ${R(x.restAvgR)} for the rest` : '');
  good.forEach((x) => pts.push(`Bid-ready trades where ${x.feature.toLowerCase()} is "${x.bucket}" averaged ${R(x.avgR)} over ${x.n}${vs(x)}, and it passes the luck check. Worth watching.`));
  bad.forEach((x) => pts.push(`Bid-ready trades where ${x.feature.toLowerCase()} is "${x.bucket}" averaged ${R(x.avgR)} over ${x.n}${vs(x)}, worse than the rest even after the luck check.`));
  if (f.length) pts.push(`Careful: ${f.length} slices were tested, so about ${Math.max(1, Math.round(f.length * 0.05))} would look "reliable" by luck alone. Treat a single finding as a lead, not a rule, until it holds on new trades.`);
  const cal = learned && learned.calibration; if (cal && cal.opp && cal.opp.n >= 30) pts.push(`Score check: the opportunity score's rank correlation with results is ${cal.opp.rho} over ${cal.opp.n} trades${Math.abs(cal.opp.rho) < 0.15 ? ' (it barely ranks them)' : ''}; pattern quality ${cal.parts['pattern quality'].rho}, gates passed ${cal.parts['gates passed'].rho}, 4h volume surge ${cal.parts['4h volume surge'].rho}. Shadow score v2 on new trades: ${cal.v2New.n >= 20 ? cal.v2New.rho + ' against ' + cal.oppNew.rho + ' for the current score' : cal.v2New.n + ' of 20 trades so far'}.`);
  if (learned && learned.edge && learned.edge.headline) pts.push('Learning loop: ' + learned.edge.headline);
  if (learned && Array.isArray(learned.filters) && learned.filters.length) pts.push(`Candidate skip rules that held on older and newer trades: ${learned.filters.map((x) => x.label).join('; ')}.`);
  if (wscore) pts.push(wscore.proven && wscore.proven.length ? `Wallet scorecard: ${wscore.proven.length} proven wallet${wscore.proven.length === 1 ? '' : 's'} out of ${wscore.wallets} scored.` : `Wallet scorecard: ${wscore.episodes || 0} coin-days logged, ${wscore.resolved || 0} with an outcome, no proven wallets yet.`);
  const fast = ['pulse', 'scalpBreak', 'proven'].map((k) => G.books[k]).filter((x) => x && x.ev.n >= 5 && x.ev.avgR > 0); fast.forEach((x) => pts.push(`${x.B.short} is early but positive: ${R(x.ev.avgR)} over ${x.ev.n}.`));
  const headline = relS.length ? `${relS[0].short} does ${relS[0].diff > 0 ? 'better' : 'worse'} when ${relS[0].slice} is "${relS[0].bucket}" (${R(relS[0].avgR)} against ${R(relS[0].restAvgR)}).` : good.length ? `Lead to follow: ${good[0].feature.toLowerCase()} "${good[0].bucket}" (${R(good[0].avgR)} over ${good[0].n}).` : bad.length ? `Clearest finding is a warning: ${bad[0].feature.toLowerCase()} "${bad[0].bucket}" loses (${R(bad[0].avgR)} over ${bad[0].n}).` : 'Nothing stands out yet in the learning loop.';
  return { stance: good.length || relS.some((t) => t.diff > 0) ? 'for' : bad.length || relS.length ? 'mixed' : 'wait', headline, points: pts.length ? pts : ['The learning loop has not run on enough trades yet.'], good, bad, slices: relS, metric: String(good.length + bad.length), metricLabel: 'reliable findings' };
}

function hatExec(G) {
  const notes = {}, pts = [];
  for (const x of Object.values(G.books)) { const rows = x.rows.filter((r) => r && r.plan); if (rows.length >= 3) { const exp = rows.filter((r) => /^expired/.test(r.status || '')).length, can = rows.filter((r) => /^cancelled/.test(r.status || '')).length, wait = rows.filter((r) => r.status === 'waiting for entry').length, filled = rows.length - exp - can - wait - rows.filter((r) => r.status === 'no data').length, tried = filled + exp + can;
      if (tried) { notes[x.key] = `Limit orders: ${filled} of the ${tried} that resolved filled (${pc(filled / tried)}); ${can} cancelled because price ran first, ${exp} expired${wait ? `, ${wait} still waiting` : ''}.`; pts.push(`${x.B.short}: ${notes[x.key]}`); } }
    const e = x.ev; if (e.n >= 5 && e.stressR != null && e.avgR != null) { const drag = e.avgR - e.stressR; notes[x.key] = (notes[x.key] ? notes[x.key] + ' ' : '') + `1% extra cost per round trip would take ${drag.toFixed(2)}R a trade off it.`; if (drag >= 0.15) pts.push(`${x.B.short}: very cost-sensitive (1% extra cost = ${drag.toFixed(2)}R a trade).`); }
    const full = x.b.skipWhy && x.b.skipWhy['all slots full']; if (full) pts.push(`${x.B.short}: ${full} signal${full === 1 ? '' : 's'} skipped because every slot was full.`);
    const thin = x.b.trades.filter((t) => t.liq != null && t.liq < 100000).length; if (x.b.trades.length >= 10 && thin / x.b.trades.length >= 0.4) pts.push(`${x.B.short}: ${pc(thin / x.b.trades.length)} of trades in pools under $100k liquidity, so real fills would be worse than paper.`); }
  const enough = Object.values(G.books).some((x) => x.ev.n >= 5);
  return { stance: pts.some((p) => /very cost|worse than paper/.test(p)) ? 'mixed' : enough ? 'for' : 'wait', headline: pts.length ? pts[0] : 'Fills look believable so far: no cost or liquidity warning.', points: pts.length ? pts : ['Nothing to flag on fills yet.'], notes, metric: String(pts.length), metricLabel: 'execution notes' };
}

// the server bots' own records (docs/data/bots/<bot>.json, published hourly by RynoBot when it has a GitHub token). What the bots really
// filled, what they passed on and what happened next, and how their fills compare with the paper twins. Read only; it never changes a rule.
// the bots' own gates, argued from their closed trades' pre-entry record: which buckets of each feature made or lost money
const BOT_FEATS = [['stop distance', (m) => (m.stopPct == null ? null : m.stopPct < 10 ? 'under 10%' : m.stopPct < 20 ? '10-20%' : '20%+')], ['hour (UTC)', (m, t) => { const h = new Date(t.openedAt).getUTCHours(); return isNaN(h) ? null : h < 6 ? '00-06' : h < 12 ? '06-12' : h < 18 ? '12-18' : '18-24'; }], ['chain', (m, t) => t.chain || null], ['weekday (UTC)', (m, t) => { const d = new Date(t.openedAt).getUTCDay(); return isNaN(d) ? null : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]; }], ['token age', (m) => (m.ageH == null ? null : m.ageH < 48 ? 'under 2 days' : m.ageH < 168 ? '2-7 days' : '7 days+')], ['score', (m) => (m.opp == null ? null : m.opp < 65 ? 'under 65' : m.opp < 80 ? '65-80' : '80+')], ['reward to risk', (m) => (m.rr2 ?? m.rr) == null ? null : (m.rr2 ?? m.rr) < 3 ? 'under 3R' : (m.rr2 ?? m.rr) < 5 ? '3-5R' : '5R+'], ['ignition volume', (m) => (m.volX == null ? null : m.volX < 20 ? '12-20x' : m.volX < 40 ? '20-40x' : '40x+')], ['24h change at signal', (m) => (m.ch24 == null ? null : m.ch24 < 30 ? 'under 30%' : m.ch24 < 100 ? '30-100%' : '100%+')], ['liquidity', (m) => (m.liq == null ? null : m.liq < 200000 ? 'under $200k' : m.liq < 1e6 ? '$200k-1m' : '$1m+')], ['price impact', (m) => (m.impactPct == null ? null : m.impactPct < 0.5 ? 'under 0.5%' : m.impactPct < 1 ? '0.5-1%' : '1%+')]];
export function botSlices(rec, minN = 5) {
  const T = (rec && rec.closed || []).filter((t) => t.R != null && t.meta), out = []; if (T.length < 2 * minN) return out;
  for (const [name, fn] of BOT_FEATS) { const by = {}; for (const t of T) { const v = fn(t.meta, t); if (v == null) continue; (by[v] ||= []).push(t.R); } const ks = Object.keys(by).filter((k) => by[k].length >= minN); if (ks.length < 2) continue;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length, rows = ks.map((k) => ({ k, n: by[k].length, avgR: avg(by[k]) })).sort((a, b) => b.avgR - a.avgR), best = rows[0], worst = rows[rows.length - 1];
    if (best.avgR - worst.avgR >= 0.5) out.push({ feat: name, best, worst, text: `${name}: ${best.k} averages ${(best.avgR >= 0 ? '+' : '') + best.avgR.toFixed(2)}R (${best.n}) against ${worst.k} at ${(worst.avgR >= 0 ? '+' : '') + worst.avgR.toFixed(2)}R (${worst.n})` }); }
  return out.sort((a, b) => (b.best.avgR - b.worst.avgR) - (a.best.avgR - a.worst.avgR)).slice(0, 3);
}
function hatLive(botRecs, G) {
  const recs = Object.values(botRecs || {}).filter((r) => r && r.bot), pts = [], notes = {}; if (!recs.length) return { stance: 'wait', headline: 'No bot records yet (the server bots publish hourly once they have a GitHub token).', points: ['Nothing from the server bots yet.'], notes, metric: '0', metricLabel: 'bot records' };
  const twin = { rules: 'exec', breakout: 'brkBot', runner: 'riskyClip', degen: 'degenStudy' }, R = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(2) + 'R'), P = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(1) + '%');
  for (const r of recs) { const s = r.stats || {}, lab = G.books[twin[r.bot]], mode = r.execMode === 'live' ? 'LIVE' : r.execMode === 'quote' ? 'rehearsal quotes' : 'paper';
    const line = `${r.bot} bot (${mode}): ${s.closed || 0} closed, ${R(s.avgR)} a trade, ${P(r.account && r.account.pnlPct)} on the account${s.latencyN ? `; fills ${P(s.latencyPct)} off the trigger price over ${s.latencyN}` : ''}.`; pts.push(line); if (lab) notes[twin[r.bot]] = line;
    if (lab && lab.ev.n >= 5 && s.closed >= 5 && s.avgR != null && lab.ev.avgR != null) { const gap = lab.ev.avgR - s.avgR; pts.push(`${r.bot}: the paper twin averages ${R(lab.ev.avgR)} against the bot's ${R(s.avgR)} (${gap >= 0.3 ? 'the paper flatters by ' + gap.toFixed(2) + 'R a trade' : 'close enough to trust the paper'}).`); }
    const ps = r.passedSummary; if (ps && ps.n >= 5) pts.push(`${r.bot}: passed on ${ps.n} setups; ${Math.round((ps.avoided / ps.n) * 100)}% went on to stop out or fall (${P(ps.avgSince)} a day later on average)${ps.avoided / ps.n < 0.4 ? ': it is leaving good setups behind, look at the gates' : ': saying no has been right'}.`);
    const Rs = (r.closed || []).map((t) => t.R).filter((x) => x != null); if (Rs.length >= 30) { const mu = Rs.reduce((a, b) => a + b, 0) / Rs.length, bs = bootstrap(Rs, 4000, 11), hi = bs.hi, lo = bs.lo;
      pts.push(hi < 0 ? `${r.bot}: KILL RULE. ${Rs.length} closed, ${R(mu)} a trade and even the lucky end of its range (${R(hi)}) is under zero: retire this rulebook or change it.` : lo > 0 ? `${r.bot}: ${Rs.length} closed, ${R(mu)} a trade with the unlucky end of its range (${R(lo)}) above zero: a real edge so far.` : `${r.bot}: ${Rs.length} closed, ${R(mu)} a trade, range ${R(lo)} to ${R(hi)}: not decided yet.`); }
    for (const sl of botSlices(r)) pts.push(`${r.bot}: ${sl.text}; worth a filter once it holds on new trades.`);
    const refused = (r.events || []).filter((e) => e.type === 'refused').length; if (refused) pts.push(`${r.bot}: ${refused} order${refused === 1 ? '' : 's'} refused by the market checks (slippage, safety, honeypot) in the last stretch.`); }
  const liveN = recs.filter((r) => r.execMode === 'live').length;
  return { stance: recs.some((r) => (r.stats || {}).closed >= 10 && r.stats.avgR > 0) ? 'for' : recs.some((r) => (r.stats || {}).closed >= 10 && r.stats.avgR < 0) ? 'against' : 'wait', headline: pts[0], points: pts, notes, metric: String(liveN), metricLabel: 'bots trading live' };
}
// ---------- the chair ----------
const CALLS = { 'bot candidate': 'for', promising: 'for', 'watch closely': 'mixed', unclear: 'wait', collecting: 'wait', losing: 'against' };
function chair(G, H, bots, prevApproved = [], learned = null) {
  const rows = [], approved = [];
  for (const x of Object.values(G.books)) { const e = x.ev; if (!e.n && !e.open) continue; const sk = H.skeptic.checks[x.key], riskFlag = H.risk.flags.some((f) => f.key === x.key);
    let call = e.n < 10 ? 'collecting' : e.verdict === 'edge' ? (sk && sk.fails.length === 0 && !riskFlag ? 'bot candidate' : 'watch closely') : e.verdict === 'promising' || (e.pPos >= 0.8 && sk && sk.passed >= 3 && sk.fails.length <= 1) ? 'promising' : ['losing', 'no edge'].includes(e.verdict) ? 'losing' : 'unclear';
    if (x.key === 'randomCtl') call = 'baseline';
    if (['bot candidate', 'promising'].includes(call) && !x.B.noBot) approved.push(x.key);
    rows.push({ key: x.key, short: x.B.short, group: x.B.group, n: e.n, open: e.open, avgR: e.avgR, lo: e.lo, hi: e.hi, worth: e.pPos ?? null, evidence: r2(Math.min(1, e.n / NEED)), verdict: e.verdict, call, etaDays: e.etaDays ?? null, retPct: r2(x.b.retPct) }); }
  rows.sort((a, b) => ({ 'bot candidate': 0, promising: 1, 'watch closely': 2, unclear: 3, collecting: 4, losing: 5, baseline: 6 }[a.call] - { 'bot candidate': 0, promising: 1, 'watch closely': 2, unclear: 3, collecting: 4, losing: 5, baseline: 6 }[b.call]) || (b.worth ?? -1) - (a.worth ?? -1) || b.n - a.n);
  const cand = rows.filter((r) => r.call === 'bot candidate'), prom = rows.filter((r) => r.call === 'promising'), lose = rows.filter((r) => r.call === 'losing'), lead = rows.filter((r) => r.call !== 'baseline' && r.n < NEED && r.etaDays != null).sort((a, b) => a.etaDays - b.etaDays)[0];
  const lines = [];
  if (cand.length) lines.push(`${cand.map((r) => r.short).join(' and ')} ${cand.length === 1 ? 'has' : 'have'} earned a tiny real-money trial: ${cand.map((r) => `${r.n} trades, ${R(r.avgR)} a trade`).join('; ')}, and every reviewer signed off. Paper-tested only, so start very small.`);
  else if (prom.length) lines.push(`No edge proven yet. ${prom.map((r) => r.short).join(', ')} ${prom.length === 1 ? 'is' : 'are'} promising and now trade${prom.length === 1 ? 's' : ''} in the council bot (paper). Keep collecting.`);
  else lines.push(`No edge proven yet, and no book is promising. ${H.stats.total < NEED ? 'It is simply too early: ' + H.stats.total + ' closed trades in total.' : 'Keep collecting; nothing should go near real money.'}`);
  const clearExit = H.exits.pairs.filter((p) => (p.call === 'better' || p.call === 'worse') && p.n >= 10)[0]; if (clearExit) lines.push(`Exits: ${short(clearExit.alt)} is ${clearExit.call} than ${short(clearExit.base)} on the same coins (${P(clearExit.diff, 1)} a trade over ${clearExit.n}).`);
  if (H.risk.flags.length) lines.push(`Risk: ${H.risk.flags[0].text}.`);
  if (lead) lines.push(`Next real verdict: ${lead.short} reaches ${NEED} closed trades in about ${lead.etaDays} day${lead.etaDays === 1 ? '' : 's'}.`);
  const actions = [];
  const added = approved.filter((k) => !prevApproved.includes(k)), dropped = prevApproved.filter((k) => !approved.includes(k));
  actions.push({ kind: 'auto', text: approved.length ? `Council bot (paper) trades only: ${approved.map(short).join(', ')}.${added.length ? ' Added: ' + added.map(short).join(', ') + '.' : ''}${dropped.length ? ' Dropped: ' + dropped.map(short).join(', ') + '.' : ''}` : 'Council bot (paper) is waiting in cash: no book approved yet.' });
  for (const r of lose.filter((r) => r.n >= NEED && r.verdict === 'no edge')) actions.push({ kind: 'ask', text: `Retire ${r.short}? It lost ${R(r.avgR)} a trade over ${r.n} (range ${R(r.lo)} to ${R(r.hi)}). Nothing has been switched off.` });
  for (const p of H.exits.pairs.filter((p) => p.call === 'better' && p.n >= NEED)) actions.push({ kind: 'ask', text: `Make ${short(p.alt)} the main exits for these coins? It beat ${short(p.base)} by ${P(p.diff, 1)} a trade over ${p.n} shared coins.` });
  for (const g of (H.scout.bad || []).filter((x) => x.n >= NEED)) actions.push({ kind: 'ask', text: `Consider skipping bid-ready trades where ${g.feature.toLowerCase()} is "${g.bucket}" (${R(g.avgR)} over ${g.n}). Report only until you say so.` });
  { const cal = learned && learned.calibration; if (cal && cal.v2New && cal.v2New.n >= 30 && cal.v2New.rho != null && cal.oppNew.rho != null && cal.v2New.rho >= cal.oppNew.rho + 0.15) actions.push({ kind: 'ask', text: `Switch the bid-ready ranking to the shadow score v2? On ${cal.v2New.n} trades since ${cal.since.slice(0, 10)} it ranked results at ${cal.v2New.rho} against ${cal.oppNew.rho} for the current score.` }); }
  for (const t of (H.scout.slices || []).filter((t) => t.diff > 0 && t.n >= 15)) actions.push({ kind: 'ask', text: `Only run ${t.short} when ${t.slice} is "${t.bucket}"? It averaged ${R(t.avgR)} over ${t.n} there against ${R(t.restAvgR)} otherwise. Report only until you say so.` });
  for (const c of cand) { const Rs = G.books[c.key].b.trades.filter((t) => !t.open && t.R != null && isFinite(t.R)).map((t) => t.R), m = mean(Rs), m2 = mean(Rs.map((x) => x * x)), kelly = m2 > 0 ? m / m2 : 0, risk = Math.max(0.1, Math.min(1, (kelly / 4) * 100));
    c.riskPct = +risk.toFixed(2); actions.push({ kind: 'ask', text: `Start a tiny real-money trial of ${c.short}? If you do: risk about ${risk.toFixed(1)}% of the trial money per trade (a quarter of the Kelly figure from its paper trades, capped at 1%). Only you can decide that, and only with keys kept in your own secret store.` }); }
  const votes = HATS.filter((h) => h.key !== 'chair').map((h) => H[h.key].stance), split = votes.includes('for') && votes.includes('against');
  const headline = cand.length ? `Bot candidate: ${cand.map((r) => r.short).join(', ')}` : prom.length ? `No edge yet · promising: ${prom.map((r) => r.short).join(', ')}` : 'No edge yet · keep collecting';
  return { stance: cand.length ? 'for' : prom.length ? 'mixed' : 'wait', headline, answer: lines.join(' '), lines, actions, approved, rows, split, metric: String(approved.length), metricLabel: 'books approved for the council bot', points: lines };
}

// a short argument between the hats about the book most worth discussing
function discuss(G, H, C) {
  const pick = C.rows.filter((r) => r.call !== 'baseline' && r.n >= 1).sort((a, b) => (b.n >= 5 && b.avgR > 0) - (a.n >= 5 && a.avgR > 0) || b.n - a.n || b.open - a.open)[0]; if (!pick) return { about: null, lines: [] };
  const k = pick.key, say = (hat, text) => text && lines.push({ hat, text }), lines = [];
  say('stats', H.stats.notes[k]); say('skeptic', H.skeptic.notes[k] || (pick.n < 10 ? `Only ${pick.n} closed: one lucky or unlucky coin decides everything at this size. I start testing at 10.` : pick.avgR > 0 ? 'Nothing to test yet.' : 'Nothing to defend: it is not making money.'));
  say('risk', H.risk.notes[k] || (pick.n < 5 ? 'Too few closed trades to judge the risk yet.' : null));
  say('exits', H.exits.notes[k]); say('exec', H.exec.notes[k]); say('live', H.live && H.live.notes[k]);
  const why = { 'bot candidate': 'every check passed', promising: 'the numbers lean positive but the sample is small', 'watch closely': 'the statistics pass but another reviewer objects', unclear: 'the range still straddles zero', collecting: 'too few trades', losing: 'it is reliably losing' }[pick.call] || '';
  say('chair', `Ruling on ${pick.short}: ${pick.call}${why ? ', because ' + why : ''}.${pick.call === 'losing' ? ' I will not switch it off; that is your call.' : ''}`);
  return { about: k, short: pick.short, lines };
}

// the whole council. learned: learned.json; wscore: walletscore.json; history: [{ at, approved }] from earlier runs
export function council({ signals = [], degen = [], lab = [], learned = null, wscore = null, since = null, history = [], now = Date.now(), botRecs = null } = {}) {
  const G = gather({ signals, degen, lab, since, now }), hist = Array.isArray(history) ? history : [];
  const bots = {}; for (const [k, B] of Object.entries(BOT)) bots[k] = botBook(G.allPos, { adaptive: B.adaptive, approvals: B.council ? hist : null, regime: !!B.regime, since, now });
  const H = { stats: hatStats(G) }; H.skeptic = hatSkeptic(G); H.risk = hatRisk(G, bots); H.exits = hatExits(G, learned); H.scout = hatScout(learned, wscore, G); H.exec = hatExec(G); H.live = hatLive(botRecs, G);
  const prev = hist.length ? hist[hist.length - 1].approved || [] : []; H.chair = chair(G, H, bots, prev, learned);
  const talk = discuss(G, H, H.chair);
  const at = new Date(now).toISOString().slice(0, 19) + 'Z', same = prev.length === H.chair.approved.length && prev.every((k) => H.chair.approved.includes(k));
  const history2 = same && hist.length ? hist : [...hist, { at, approved: H.chair.approved }].slice(-300);
  const botLines = Object.entries(bots).filter(([, b]) => b.closedN || b.openN).map(([k, b]) => { const e = evidence(b, { tests: G.tests, now }); return { key: k, short: BOT[k].short, retPct: r2(b.retPct), closed: b.closedN, open: b.openN, avgR: e.avgR, verdict: e.verdict }; });
  const hats = HATS.map((h) => { const x = H[h.key]; return { ...h, stance: x.stance, headline: x.headline, points: (x.points || []).slice(0, 8), metric: x.metric, metricLabel: x.metricLabel }; });
  return { at, final: { headline: H.chair.headline, answer: H.chair.answer, actions: H.chair.actions, split: H.chair.split }, hats, discussion: talk, books: H.chair.rows, pairs: H.exits.pairs, bots: botLines, approved: H.chair.approved, history: history2,
    note: 'Rule-based reviewers on paper results only. The council never switches a real rule on or off and never places a trade; the council bot is paper.' };
}
