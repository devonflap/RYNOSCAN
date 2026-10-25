// THE FOUR RESEARCH TRACKS AND THE HEAD COUNCIL (25 Oct, Ryan: "a council for each topic, each testing its learning with a bot, and a
// council over all of them that builds the bots our findings say can work"). Each track has its own council (the same engine as the
// trench council: league, same-coin comparisons, exit autopsy, a learning loop checked on older and newer trades and remembered across
// scans) plus the track's own backtest. The head council reads the four and says which ideas are working, which backtest findings no
// bot is testing yet (a new bot to propose), and which bots have earned nothing (to retire). It never builds, changes or retires a bot by
// itself: its proposals go to Ryan in the Monday review, and need his yes. Rules are frozen for two weeks or 30 trades from 25 Oct
// (bug fixes only), so every verdict is about rules that held still long enough to judge.
import { trenchCouncil } from './trenchcouncil.mjs';
import { rulebookLines } from './bestrules.mjs';
export const FREEZE = { from: '2026-10-25', until: '2026-11-08', minTrades: 30 };
export const TRACKS = {
  trenches: { title: 'Trenches', what: 'trencher', bots: { trench: 'OG trencher', trenchbonus: 'Second wave' }, base: 'trench', labBot: null },
  patterns: { title: 'Chart patterns', what: 'chart-pattern bot', bots: { breakout: 'Breakout retest' }, base: 'breakout', backtest: 'backtest.json' },
  runners: { title: 'High risk runners', what: 'runner bot', bots: { basebreak: 'Base breakout + proven-wallet copies' }, base: 'basebreak', labBot: 'basebreak', backtest: 'runner-bt.json' },
  bottoms: { title: 'Bottomed-out holds', what: 'bottomed-out bot', bots: { bottoms: 'Bottomed-out (Chill)' }, base: 'bottoms', backtest: 'bottom-bt.json' },
  best: { title: 'Best-of bot', what: 'best-of bot', bots: { bestof: 'Best-of (head council)' }, base: 'bestof', backtest: 'bestof-rules.json' },
};
const fP = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x + '%'), fR = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(2) + 'R');
// what each track's backtest says, in one or two lines, and the combinations that held on both halves of the period
export function backtestLines(key, bt) {
  if (!bt) return { lines: ['No backtest yet.'], holding: [] };
  if (key === 'patterns') { const v = (bt.exitVariants || []).slice().sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9)); return { lines: [`Weekly pattern backtest (${bt.at ? bt.at.slice(0, 10) : '?'}): ${bt.overall ? `${bt.overall.closed} signals, ${fR(bt.overall.avgR)} a trade as traded` : 'no signals'}${v[0] ? `; best exit "${v[0].name}" ${fR(v[0].avgR)}` : ''}.`], holding: v.filter((x) => x.closed >= 30 && x.avgR > 0).map((x) => ({ combo: x.name, avg: x.avgR, n: x.closed, unit: 'R' })) }; }
  if (key === 'runners') { const u = bt.universe || {}, best = (u.best || [])[0]; return { lines: [`Runner backtest (${bt.at ? bt.at.slice(0, 10) : '?'}): buying on the listing ${fP(((bt.groups || {})['listed (3+ checks)'] || { combos: {} }).combos['listing / hold7'] ? bt.groups['listed (3+ checks)'].combos['listing / hold7'].avg : null)} a trade; best base breakout ${best ? `"${best.combo}" ${fP(best.avg)} over ${best.n}` : 'none yet'}.`], holding: (u.best || []).filter((x) => x.holds).map((x) => ({ combo: x.combo, avg: x.avg, n: x.n, unit: '%' })) }; }
  if (key === 'best') return rulebookLines(bt);
  if (key === 'bottoms') { const best = (bt.best || [])[0], rnd = Object.entries(bt.combos || {}).filter(([k]) => k.startsWith('random')).map(([, r]) => r.avg).filter((x) => x != null); return { lines: [`Bottomed-out backtest (${bt.at ? bt.at.slice(0, 10) : '?'}): ${bt.tested || 0} coins, a year of days; best ${best ? `"${best.combo}" ${fP(best.avg)} a trade over ${best.n} (median ${fP(best.med)})` : 'none'}; random days ${rnd.length ? fP(Math.round((rnd.reduce((a, b) => a + b, 0) / rnd.length) * 10) / 10) : '—'}.`], holding: (bt.best || []).filter((x) => x.holds).map((x) => ({ combo: x.combo, avg: x.avg, n: x.n, unit: '%' })) }; }
  return { lines: [], holding: [] }; }
// the head council: across the four tracks
export function headCouncil(tracks, now = Date.now()) {
  const at = new Date(now).toISOString().slice(0, 19) + 'Z', pts = [], proposals = [], frozen = at.slice(0, 10) < FREEZE.until;
  for (const [k, t] of Object.entries(tracks)) { pts.push(`${t.title}: ${t.council.headline}`); for (const l of t.backtest.lines) pts.push(`${t.title} backtest: ${l}`);
    const bots = (t.council.league || []).filter((x) => x.installed); if (!bots.length && t.backtest.holding.length) proposals.push({ track: k, kind: 'new bot', text: `${t.title}: the backtest's "${t.backtest.holding[0].combo}" held on both halves (${t.backtest.holding[0].avg}${t.backtest.holding[0].unit} a trade over ${t.backtest.holding[0].n}) and no bot is trading it yet. Build a paper bot for it?` });
    if (k === 'best' && t.rulebook && t.rulebook.differs && t.rulebook.proposed) proposals.push({ track: k, kind: 'rulebook', text: `Best-of rulebook: new evidence would change it from ${t.rulebook.active.version} to ${t.rulebook.proposed.version} (${t.rulebook.proposed.entries.map((e) => e.combo).join('; ') || 'nothing'}). Switch the best-of bot to the new rulebook?` });
    for (const x of bots) if (x.closed >= FREEZE.minTrades && x.hi100 != null && x.hi100 < 0) proposals.push({ track: k, kind: 'retire or change', text: `${t.title}: ${x.label} is losing even at the lucky end of its range over ${x.closed} trades. Retire it or change its rules?` });
    for (const x of bots) if (x.closed >= FREEZE.minTrades && x.lo100 != null && x.lo100 > 0) proposals.push({ track: k, kind: 'promote', text: `${t.title}: ${x.label} is making money even at the unlucky end of its range over ${x.closed} trades. Next step: a rehearsal on real quotes (never live without your arming).` }); }
  const working = Object.values(tracks).flatMap((t) => (t.council.league || []).filter((x) => x.installed && x.closed >= 10 && x.per100 > 0).map((x) => `${x.label} (${t.title}) ${fP(Math.round(x.per100))} per $100`));
  return { at, headline: working.length ? `Making money so far: ${working.join('; ')}.` : 'Nothing is making money on paper yet; the base-breakout and bottomed-out backtests are the leads being tested.', points: pts, proposals, freeze: { ...FREEZE, active: frozen, note: frozen ? `Rules frozen until ${FREEZE.until} (or ${FREEZE.minTrades} trades a bot): only bug fixes until then, so the verdicts mean something.` : 'Rules freeze over: changes the evidence supports can go to Ryan.' } }; }
export function trackCouncils({ recs = {}, backtests = {}, prev = null, now = Date.now() } = {}) {
  const tracks = {}; for (const [k, T] of Object.entries(TRACKS)) { const R = Object.fromEntries(Object.entries(recs).filter(([b]) => T.bots[b])), council = trenchCouncil({ recs: R, prev: prev && prev.tracks && prev.tracks[k] && prev.tracks[k].council, now, labels: T.bots, base: T.base, labBot: T.labBot || null, what: T.what });
    tracks[k] = { title: T.title, bots: T.bots, council, backtest: backtestLines(k, T.backtest ? backtests[T.backtest] : null), ...(k === 'best' ? { rulebook: backtests['bestof-rules.json'] || null } : {}) }; }
  return { at: new Date(now).toISOString().slice(0, 19) + 'Z', tracks, head: headCouncil(tracks, now) }; }
