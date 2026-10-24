// THE TRENCH COUNCIL (24 Oct): the five trenchers' own council and learning loop, apart from the main council so no rule, gate or study
// meant for another bot ever bends a trencher (and the trench results do not drown the other bots). Rule-based, free, runs on GitHub with
// every scan (src/councilrun.mjs) on the trenchers' published records (docs/data/bots/trench*.json); writes docs/data/trench-council.json.
// It never switches anything on or off and never trades: it reads, compares, learns and reports. What it asks, every scan:
//   1. the league: money per shot, win rate, R, the fat tail (how often 5x and 10x happen) and how much of the profit the top few made
//   2. head to head: the same coins traded by two trenchers (they see the same feed at the same moment), so the rules are the only difference
//   3. the exit autopsy: which exit rule fires, what it costs, and what it left on the table (trades stopped out after a big run up)
//   4. the learning loop: conditions at the entry (lane, market cap, how fast it was moving, buy pressure, age, holders, session) that
//      separate winners from losers, checked on the older half of the trades and then on the newer half; a lesson that holds on both is
//      "confirmed", and lessons are remembered across scans (first seen, times seen) so a one-off does not look like a law
//   5. the lab's seven ways side by side, and the holder read's real cost or saving
//   6. the chair: who leads, what to try next, and the lessons worth passing to the main council
import { labVariants } from './council.mjs';
export const TRENCHERS = { trench: 'OG trencher', trenchlab: 'Trench lab', trenchshot: 'Shotgun', trenchx: 'Extractor', trenchbonus: 'Second wave' };
export const TNEED = 30; // closed shots before a trencher's verdict means anything
const R2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(2)), avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fR = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(2) + 'R'), fU = (x) => (x == null ? '—' : (x >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(x)).toLocaleString('en'));
// a seeded bootstrap of the average (same answer every scan for the same trades)
function boot(xs, n = 2000, seed = 7) { if (xs.length < 2) return { lo: null, hi: null }; let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648), m = [];
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < xs.length; j++) t += xs[Math.floor(rnd() * xs.length)]; m.push(t / xs.length); } m.sort((a, b) => a - b); return { lo: m[Math.floor(n * 0.05)], hi: m[Math.floor(n * 0.95)] }; }
const xOf = (t) => (t.entry > 0 && t.exitAvg > 0 ? t.exitAvg / t.entry : t.costUsd > 0 ? 1 + t.pnl / t.costUsd : null), peakX = (t) => (t.entry > 0 && t.peak > 0 ? t.peak / t.entry : null);
const per100 = (t) => (t.costUsd > 0 ? (t.pnl / t.costUsd) * 100 : null);
// the record's trades, one "way" per trencher (the lab: one per variant)
export function waysOf(recs) { const W = {}; for (const [bot, r] of Object.entries(recs || {})) { if (!r || !TRENCHERS[bot]) continue; for (const t of r.closed || []) { if (!(t.costUsd > 0) || t.pnl == null) continue; const k = bot === 'trenchlab' ? 'lab ' + ((t.meta && t.meta.variant) || '?') : bot; (W[k] ||= []).push(t); } } return W; }
// 1. the league
export function league(recs) {
  return Object.entries(TRENCHERS).map(([bot, label]) => { const r = recs && recs[bot]; if (!r) return { bot, label, installed: false };
    const T = (r.closed || []).filter((t) => t.pnl != null && t.costUsd > 0), s = r.stats || {}, closed = s.closed ?? T.length, total = s.realised ?? T.reduce((a, t) => a + t.pnl, 0);
    const p = T.map(per100).filter((x) => x != null), Rs = T.map((t) => t.R).filter((x) => x != null), bs = boot(p), xs = T.map(xOf).filter((x) => x != null), wins = T.filter((t) => t.pnl > 0);
    const gains = wins.map((t) => t.pnl).sort((a, b) => b - a), top = gains.slice(0, Math.max(1, Math.ceil(T.length * 0.05))).reduce((a, x) => a + x, 0), grossWin = gains.reduce((a, x) => a + x, 0);
    const holds = T.map((t) => t.heldH).filter((x) => x != null).sort((a, b) => a - b);
    const verdict = closed < TNEED ? `collecting (${closed}/${TNEED})` : bs.lo > 0 ? 'making money so far (even the unlucky end is above zero)' : bs.hi < 0 ? 'losing (even the lucky end is under zero): change its rules' : 'not decided yet';
    return { bot, label, installed: true, closed, open: (r.open || []).length, winRate: T.length ? R2(wins.length / T.length) : null, totalUsd: R2(total), per100: R2(avg(p)), lo100: R2(bs.lo), hi100: R2(bs.hi), avgR: R2(avg(Rs)), pnlPct: r.account ? R2(r.account.pnlPct) : null,
      x2: T.length ? R2(T.filter((t) => (peakX(t) || 0) >= 2).length / T.length) : null, x5: xs.filter((x) => x >= 5).length, x10: xs.filter((x) => x >= 10).length, bestX: xs.length ? R2(Math.max(...xs)) : null,
      topShare: grossWin > 0 ? R2(top / grossWin) : null, medHoldMin: holds.length ? Math.round(holds[Math.floor(holds.length / 2)] * 60) : null, verdict };
  }); }
// 2. head to head: coins two ways both traded (matched by pool, within an hour of each other)
export function headToHead(W, base = 'trench', minN = 8) {
  const B = W[base] || [], out = []; if (!B.length) return out;
  for (const [k, T] of Object.entries(W)) { if (k === base) continue; const pairs = []; for (const t of T) { const b = B.find((x) => x.pool === t.pool && Math.abs(Date.parse(x.openedAt) - Date.parse(t.openedAt)) < 3600e3); if (b) pairs.push([per100(t), per100(b)]); }
    if (pairs.length < minN) { out.push({ way: k, n: pairs.length, call: 'too few' }); continue; } const d = pairs.map(([a, b]) => a - b), bs = boot(d);
    out.push({ way: k, n: pairs.length, wayPer100: R2(avg(pairs.map((p) => p[0]))), basePer100: R2(avg(pairs.map((p) => p[1]))), diff: R2(avg(d)), lo: R2(bs.lo), hi: R2(bs.hi), better: R2(d.filter((x) => x > 0).length / d.length), call: bs.lo > 0 ? 'better on the same coins' : bs.hi < 0 ? 'worse on the same coins' : 'no clear difference yet' }); }
  return out.sort((a, b) => (b.diff ?? -1e9) - (a.diff ?? -1e9)); }
// 3. the exit autopsy
const EXIT = [[/^stop$|^stop\b/, 'stop'], [/break-even stop/, 'break-even stop'], [/trailing stop/, 'trailing stop'], [/no pop/, 'no pop (cheap miss)'], [/dead chart/, 'dead chart'], [/gave back/, 'giveback'], [/sellers (dumping|took over)/, 'sellers'], [/moonbag trail/, 'free-ride trail'], [/FOMO fade/, 'FOMO fade trail'], [/extractors are leaving/, 'insiders selling'], [/time limit|no follow-through/, 'time'], [/^TP\d/, 'last clip'], [/a rug, booked at zero|honeypot, booked at zero/, 'rug (booked at zero)'], [/written off/, 'written off']];
export function exitAutopsy(T) {
  const by = {}; for (const t of T) { const why = String(t.why || ((t.sells || []).slice(-1)[0] || {}).why || ''), k = (EXIT.find(([re]) => re.test(why)) || [null, 'other'])[1]; (by[k] ||= []).push(t); }
  return Object.entries(by).map(([k, ts]) => ({ exit: k, n: ts.length, usd: R2(ts.reduce((a, t) => a + t.pnl, 0)), per100: R2(avg(ts.map(per100).filter((x) => x != null))), avgPeakX: R2(avg(ts.map(peakX).filter((x) => x != null))), leftOnTable: ts.filter((t) => t.pnl <= 0 && (peakX(t) || 0) >= 1.5).length })).sort((a, b) => b.n - a.n); }
// 4. the learning loop
const SESSION = (h) => (h < 7 ? 'Asia (UTC 0-7)' : h < 13 ? 'Europe (UTC 7-13)' : h < 21 ? 'America (UTC 13-21)' : 'late America (UTC 21-24)');
export const TFEATS = [
  ['lane', (m) => ({ feed: 'feed launches', ds: 'DexScreener launches', trend: 'trending coins' }[m.lane] || m.lane || null)],
  ['market cap', (m) => { const c = m.mkt && m.mkt.mcap; return c == null ? null : c < 50e3 ? 'under $50k' : c < 250e3 ? '$50-250k' : c < 1e6 ? '$250k-1m' : '$1m+'; }],
  ['hour move at entry', (m) => { const c = m.mkt && m.mkt.h1; return c == null ? null : c < 50 ? 'under +50%' : c < 150 ? '+50-150%' : '+150%+'; }],
  ['buy pressure (5 min)', (m) => { const b = m.mkt && m.mkt.b5, s = m.mkt && m.mkt.s5; return b == null ? null : b / Math.max(1, s) < 1.5 ? 'under 1.5x' : b / Math.max(1, s) < 2.5 ? '1.5-2.5x' : '2.5x+'; }],
  ['coin age', (m) => { const a = m.mkt && m.mkt.ageMin; return a == null ? null : a < 10 ? 'under 10 min' : a < 60 ? '10-60 min' : a < 360 ? '1-6 hours' : '6 hours+'; }],
  ['holder read', (m) => (m.holders ? (m.holders.clean === true ? 'clean' : m.holders.clean === false ? 'held by insiders' : 'no read yet') : null)],
  ['session', (m, t) => { const h = new Date(t.openedAt).getUTCHours(); return isFinite(h) ? SESSION(h) : null; }],
];
export function learnWay(T, minN = 8) {
  const S = T.filter((t) => t.meta && per100(t) != null).sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt)), out = []; if (S.length < 2 * minN) return out;
  const half = Math.floor(S.length / 2), older = S.slice(0, half), newer = S.slice(half);
  for (const [feat, fn] of TFEATS) { const by = {}; for (const t of S) { const v = fn(t.meta, t); if (v != null) (by[v] ||= []).push(t); } const ks = Object.keys(by).filter((k) => by[k].length >= minN); if (ks.length < 2) continue;
    const rows = ks.map((k) => ({ k, n: by[k].length, per100: avg(by[k].map(per100)) })).sort((a, b) => b.per100 - a.per100), best = rows[0], worst = rows[rows.length - 1]; if (best.per100 - worst.per100 < 10) continue;
    const inHalf = (H, k) => { const x = H.filter((t) => fn(t.meta, t) === k).map(per100); return x.length >= 3 ? avg(x) : null; }, o = [inHalf(older, best.k), inHalf(older, worst.k)], w = [inHalf(newer, best.k), inHalf(newer, worst.k)];
    const held = o[0] != null && o[1] != null && w[0] != null && w[1] != null && o[0] > o[1] && w[0] > w[1];
    out.push({ feat, best: { k: best.k, n: best.n, per100: R2(best.per100) }, worst: { k: worst.k, n: worst.n, per100: R2(worst.per100) }, gap: R2(best.per100 - worst.per100), status: held ? 'confirmed (held on the older and the newer trades)' : o[0] == null || w[0] == null ? 'too few to check both halves' : 'found, not yet confirmed (did not hold on both halves)' }); }
  return out.sort((a, b) => (b.status.startsWith('confirmed') - a.status.startsWith('confirmed')) || b.gap - a.gap).slice(0, 4); }
// remembered across scans: each lesson's first sighting and how many scans it has shown up in
export function remember(prevMemory = {}, lessons = [], at) { const mem = { ...(prevMemory || {}) };
  for (const l of lessons) { const key = `${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`, m = mem[key] || { firstSeen: at, seen: 0 }; mem[key] = { ...m, lastSeen: at, seen: m.seen + 1, confirmed: l.status.startsWith('confirmed') ? (m.confirmed || 0) + 1 : 0, status: l.status, gap: l.gap }; }
  const now = new Set(lessons.map((l) => `${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`)); for (const [k, m] of Object.entries(mem)) { if (!now.has(k)) mem[k] = { ...m, confirmed: 0 }; /* gone this scan: its count starts again */ if (Date.parse(at) - Date.parse(m.lastSeen) > 14 * 86400e3) delete mem[k]; } return mem; }
// the holder read's real cost or saving, with a luck check: the lab's shotgun on clean coins against coins the insiders held (10 each at
// least), the gap's 90% range clear of zero, and the same sign on the older and the newer half of the trades
export function holderProof(rec) {
  const T = ((rec && rec.closed) || []).filter((t) => t.meta && t.meta.variant === 'S-shotgun' && t.meta.holders && t.meta.holders.clean != null && per100(t) != null).sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const side = (xs, c) => xs.filter((t) => t.meta.holders.clean === c).map(per100), cl = side(T, true), fl = side(T, false); if (cl.length < 10 || fl.length < 10) return null;
  const gap = avg(cl) - avg(fl); let s0 = 11; const rnd = () => ((s0 = (s0 * 1103515245 + 12345) % 2147483648) / 2147483648), pick = (a) => a[Math.floor(rnd() * a.length)], G = [];
  for (let i = 0; i < 2000; i++) { let a = 0, b = 0; for (let j = 0; j < cl.length; j++) a += pick(cl); for (let j = 0; j < fl.length; j++) b += pick(fl); G.push(a / cl.length - b / fl.length); } G.sort((a, b) => a - b);
  const lo = G[100], hi = G[1899], h = Math.floor(T.length / 2), halves = [T.slice(0, h), T.slice(h)].map((H) => { const c = side(H, true), f = side(H, false); return c.length >= 3 && f.length >= 3 ? avg(c) - avg(f) : null; });
  const proven = (lo > 0 || hi < 0) && halves.every((x) => x != null && Math.sign(x) === Math.sign(gap));
  return { proven, gap: R2(gap), lo: R2(lo), hi: R2(hi), n: [cl.length, fl.length], text: `coins the insiders already held did ${gap > 0 ? 'worse' : 'better'} than clean coins on the same exits (${fU(avg(fl))} vs ${fU(avg(cl))} per $100 shot, ${fl.length} and ${cl.length} trades)` };
}
// a finding reaches the main council only once it has passed its own test in PROVE_SCANS scans running (24 Oct: early luck must not
// steer the other bots). The streaks are kept in the trench council's memory; a scan where the test fails starts the count again.
export const PROVE_SCANS = 3;
export function proveStreaks(prev = {}, results = {}, at) { const out = {}; for (const [k, r] of Object.entries(results)) { const m = (prev || {})[k] || {}; out[k] = r && r.proven ? { streak: (m.streak || 0) + 1, firstProven: m.streak ? m.firstProven : at, text: r.text } : { streak: 0, text: r ? r.text : null }; } return out; }
// 6. the chair
export function trenchCouncil({ recs = {}, prev = null, now = Date.now() } = {}) {
  const at = new Date(now).toISOString().slice(0, 19) + 'Z', L = league(recs), W = waysOf(recs), installed = L.filter((x) => x.installed);
  const h2h = headToHead(W), autopsy = Object.fromEntries(Object.entries(W).map(([k, T]) => [k, exitAutopsy(T)]));
  const lessons = Object.entries(W).flatMap(([way, T]) => learnWay(T).map((l) => ({ way, ...l }))), memory = remember(prev && prev.memory, lessons, at);
  for (const l of lessons) { const m = memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`]; l.seen = m.seen; l.firstSeen = m.firstSeen; }
  const lab = recs.trenchlab ? labVariants(recs.trenchlab) : [];
  const ranked = installed.filter((x) => x.closed >= 10 && x.per100 != null).sort((a, b) => b.per100 - a.per100), lead = ranked[0];
  const headline = !installed.length ? 'No trencher records yet (they publish hourly once the trench pack is running).' : !lead ? `Collecting: ${installed.map((x) => `${x.label} ${x.closed}`).join(', ')} closed shots so far; 10 each before anyone is ranked.`
    : `${lead.label} leads: ${fU(lead.per100)} per $100 shot over ${lead.closed}${ranked[1] ? `, then ${ranked[1].label} ${fU(ranked[1].per100)}` : ''}${ranked.length > 2 ? `; last ${ranked[ranked.length - 1].label} ${fU(ranked[ranked.length - 1].per100)}` : ''}.`;
  const actions = [], pts = [];
  for (const x of installed) pts.push(`${x.label}: ${x.closed} closed, ${x.winRate != null ? Math.round(x.winRate * 100) + '% won' : '—'}, ${fU(x.per100)} per $100 shot (range ${fU(x.lo100)} to ${fU(x.hi100)}), ${fU(x.totalUsd)} in all; ${x.x5} at 5x+, ${x.x10} at 10x+${x.topShare != null ? `; the best 5% of trades made ${Math.round(x.topShare * 100)}% of the winnings` : ''}. ${x.verdict}.`);
  for (const h of h2h.filter((h) => h.call !== 'too few').slice(0, 6)) pts.push(`Same coins as the OG: ${h.way} ${fU(h.wayPer100)} vs OG ${fU(h.basePer100)} per $100 over ${h.n} shared coins (${h.diff >= 0 ? '+' : ''}${h.diff} a shot, better on ${Math.round(h.better * 100)}%): ${h.call}.`);
  for (const [way, A] of Object.entries(autopsy)) { const worst = A.filter((a) => a.n >= 5).sort((a, b) => a.usd - b.usd)[0], left = A.reduce((a, x) => a + x.leftOnTable, 0); if (worst && worst.usd < 0) pts.push(`${way}: the costliest exit is "${worst.exit}" (${worst.n} trades, ${fU(worst.usd)}, ${fU(worst.per100)} per $100)${left >= 3 ? `; ${left} losing trades had been 1.5x+ up first: the exits are giving runners back` : ''}.`); }
  for (const l of lessons.slice(0, 8)) pts.push(`Learning (${l.way}): ${l.feat}: ${l.best.k} ${fU(l.best.per100)} per $100 (${l.best.n}) vs ${l.worst.k} ${fU(l.worst.per100)} (${l.worst.n}); ${l.status}${l.seen > 1 ? `, seen in ${l.seen} scans since ${l.firstSeen.slice(0, 10)}` : ''}.`);
  for (const t of lab) pts.push('Lab: ' + t);
  for (const l of lessons.filter((l) => (memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`].confirmed || 0) >= PROVE_SCANS)) actions.push({ kind: 'ask', text: `${l.way}: "${l.feat}: ${l.best.k}" has held on both halves for ${memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`].confirmed} scans (${fU(l.best.per100)} vs ${fU(l.worst.per100)} per $100). Worth a trencher of its own, or a lab way, if you OK it. Nothing changes until you do.` });
  for (const x of installed.filter((x) => x.closed >= TNEED && x.hi100 != null && x.hi100 < 0)) actions.push({ kind: 'ask', text: `${x.label} is losing even at the lucky end of its range over ${x.closed} shots. Change its rules or retire it: your call, it keeps running until you say.` });
  if (lead && lead.closed >= TNEED && lead.lo100 > 0) actions.push({ kind: 'ask', text: `${lead.label} has a real edge so far (${fU(lead.lo100)} per $100 even at the unlucky end, ${lead.closed} shots). The next step would be a rehearsal with real quotes, never live without your arming.` });
  // what the other councils can use: the trench's findings about coins and crowds (never about the trenchers' own rules), and only once
  // proven: a learning-loop lesson confirmed on both halves of the trades in PROVE_SCANS scans running; the holder read and the FOMO sale
  // only when their luck check has passed in PROVE_SCANS scans running. Until then they stay in here.
  const hp = holderProof(recs.trenchlab), fadeH = h2h.find((h) => /F-fade|trenchx/.test(h.way) && h.n >= 10);
  const proven = proveStreaks(prev && prev.proven, { holder: hp, fade: fadeH ? { proven: /^(better|worse) on the same coins/.test(fadeH.call), text: `selling half into the first FOMO spike did ${fadeH.diff >= 0 ? 'better' : 'worse'} than the OG's early clips on the same coins (${fadeH.diff >= 0 ? '+' : ''}${fadeH.diff} per $100 shot over ${fadeH.n} coins)` } : null }, at);
  const forOthers = [];
  for (const [k, v] of Object.entries(proven)) if (v.streak >= PROVE_SCANS) forOthers.push(`From the trenchers (proven ${v.streak} scans running): ${v.text}.`);
  const seenFeat = new Set(); for (const l of lessons) { const m = memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`]; if (!m || (m.confirmed || 0) < PROVE_SCANS || seenFeat.has(l.feat)) continue; seenFeat.add(l.feat);
    forOthers.push(`From the trenchers (confirmed ${m.confirmed} scans running, ${l.way}): ${l.feat} "${l.best.k}" ${fU(l.best.per100)} per $100 vs "${l.worst.k}" ${fU(l.worst.per100)}.`); }
  const waiting = [...Object.values(proven).filter((v) => v.text && v.streak < PROVE_SCANS).map((v) => `${v.text} (${v.streak ? `proven ${v.streak} of ${PROVE_SCANS} scans` : 'not proven yet'})`),
    ...lessons.filter((l) => { const m = memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`]; return m && (m.confirmed || 0) < PROVE_SCANS; }).map((l) => `${l.way} · ${l.feat}: ${l.best.k} over ${l.worst.k} (${(memory[`${l.way}|${l.feat}|${l.best.k}>${l.worst.k}`].confirmed || 0)} of ${PROVE_SCANS} confirmed scans)`)];
  return { at, headline, answer: pts.slice(0, 3).join(' '), points: pts, actions, league: L, headToHead: h2h, autopsy, lessons, lab, memory, proven, forOthers, waiting,
    note: 'The trenchers\' own council: it reads, compares and learns, and never switches a rule on or off or places a trade. Paper only.' };
}
