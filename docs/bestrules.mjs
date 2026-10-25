// THE BEST-OF RULEBOOK (25 Oct, Ryan: "the best-of should run off what all the paper traders have found so far, not copy the other bots").
// Built from every piece of evidence the project has: the scanner's paper books (council.json, against its random baseline), every bot's
// own trades (retired ones included) and the backtests (runner-bt.json, bottom-bt.json, backtest.json). A rule only gets in when it made
// money on BOTH halves of its data, and when two qualify the one whose WORSE half is better wins (the least likely to be luck). Each rule
// carries its evidence. The bot (bot/bestof.mjs) trades the ACTIVE rulebook; a newly built one that differs is only a PROPOSAL, shown to
// Ryan by the head council, and becomes active when he says yes (docs/bestof-approve.json gets its version). Rules are frozen until 8 Nov.
export const ENTRY_KINDS = { base: 'base breakout', dca: 'bottomed-out DCA' };
// the backtests' exits, as the bot's exit settings (an exit the bot cannot run yet is listed, not used)
export const RUNNER_EXITS = { /* maxHoldH as the backtest ran them: hold7 a week, the others two weeks */
  hold7: { mults: [], shares: [], maxHoldH: 168 },
  giveback: { mults: [], shares: [], peakGiveback: { armPct: 0.5, keep: 0.5 }, maxHoldH: 336 },
  half2_t30: { mults: [2], shares: [0.5], moonTrail: 0.3, beAfterFirst: true, maxHoldH: 336 },
  half2_t50: { mults: [2], shares: [0.5], moonTrail: 0.5, beAfterFirst: true, maxHoldH: 336 },
  thirds_2_4_t50: { mults: [2, 4], shares: [1 / 3, 1 / 3], moonTrail: 0.5, beAfterFirst: true, maxHoldH: 336 },
  all_at_2x: { mults: [2], shares: [1], maxHoldH: 336 },
};
export const BOTTOM_EXITS = { riskoff: { mults: [], shares: [], regimeOut: true, maxHoldH: 180 * 24 }, hold60: { mults: [], shares: [], maxHoldH: 60 * 24 }, half2: { mults: [2], shares: [0.5], moonTrail: 0.99, regimeOut: true, maxHoldH: 180 * 24 } };
// the lessons every bot already trades by (from the trench council and the fake-profit fixes), kept in the rulebook with their evidence
export const FILTERS = [
  'No pools a dev can pull: coins not launched on pump.fun rugged 41% of the time against 12% (first day\'s 650 trench trades)',
  'No painted charts: wash volume (the hour\'s trading many times the coin\'s value) and one-way buying (buys with almost no sells) are never bought',
  'No broken quotes: liquidity bigger than the coin, prices against the wrong token, or a pool that grew faster than its price allows are ignored',
  'No chasing: nothing more than 10% past its signal price (chasing a +30% five minutes lost money in every trench way)',
  'Real exits only: every sale capped by what the pool can pay, dead pools and coins nobody can sell booked at zero',
];
const worse = (r) => Math.min(r.olderAvg ?? -1e9, r.newerAvg ?? -1e9), pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x + '%');
export const versionOf = (book) => { const s = JSON.stringify((book.entries || []).map((e) => [e.type, e.combo, e.exitKey])); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'v' + (h >>> 0).toString(36); };
// a bot way that has 30+ trades losing on both halves rules its exit out, whatever the backtest said
function liveVeto(botRecs, bot, variant) { const r = botRecs && botRecs[bot]; if (!r) return null; const T = (r.closed || []).filter((t) => (t.variant || (t.meta && t.meta.variant)) === variant && t.costUsd > 0 && t.pnl != null).sort((a, b) => Date.parse(a.closedAt || 0) - Date.parse(b.closedAt || 0)); if (T.length < 30) return null;
  const p = T.map((t) => (t.pnl / t.costUsd) * 100), h = Math.floor(p.length / 2), av = (a) => a.reduce((x, y) => x + y, 0) / a.length, o = av(p.slice(0, h)), n = av(p.slice(h)); return o < 0 && n < 0 ? `${bot} ${variant} lost on both halves of its ${T.length} live trades (${o.toFixed(1)}% then ${n.toFixed(1)}% per $100)` : null; }
const BASE_WAY = { hold7: 'H-hold', giveback: 'G-giveback', half2_t50: 'R-ride' };
export function buildRulebook({ council = null, runnerBt = null, bottomBt = null, patternBt = null, botRecs = {}, now = Date.now() } = {}) {
  const at = new Date(now).toISOString().slice(0, 19) + 'Z', entries = [], looked = [];
  // 1. the scanner's paper books against random
  const books = (council && council.books) || [], rnd = books.find((b) => b.key === 'randomCtl'), beat = books.filter((b) => b.key !== 'randomCtl' && b.n >= 30 && rnd && b.lo != null && b.lo > (rnd.avgR ?? 0));
  looked.push(books.length ? `Scanner paper books: ${books.length - (rnd ? 1 : 0)} setups, ${books.reduce((a, b) => a + (b.n || 0), 0)} closed trades; random entries ${rnd ? (rnd.avgR >= 0 ? '+' : '') + rnd.avgR + 'R' : '—'} a trade. ${beat.length ? `Beating random even at the unlucky end: ${beat.map((b) => b.short).join(', ')} (the bot cannot trade these yet: a yes from Ryan adds them)` : 'None beats random at the unlucky end of its range (most lose to it on average), so none is in the rulebook.'}` : 'Scanner paper books: not read.');
  // 2. the runner backtest: base breakouts on the scanner's coins. ONLY the forward book counts (breakouts after the scanner first saw the
  // coin); the lookback book is survivorship (coins watched today because they already ran: its +16.8% was two-thirds one coin's 50x).
  // A rule must hold on both halves WITHOUT each half's best trade, and beat random hours on the same coins with the same exit.
  const F = (runnerBt && runnerBt.universe && runnerBt.universe.forward) || null, R = (F && F.combos) || {}, rndOf = (ex) => (R['random / ' + ex] || {}).avg ?? null;
  const held = Object.entries(R).map(([combo, r]) => ({ combo, ...r })).filter((r) => !r.combo.startsWith('random') && r.holdsTrim && r.n >= 30 && r.exBest != null && (rndOf(r.combo.split(' / ')[1]) == null || r.exBest > rndOf(r.combo.split(' / ')[1])));
  const wTrim = (r) => Math.min(r.olderExBest ?? -1e9, r.newerExBest ?? -1e9);
  const ok = held.map((r) => { const [ent, ex] = r.combo.split(' / '), m = /box(\d+) ≤(\d+)% vol([\d.]+)x/.exec(ent || ''), veto = BASE_WAY[ex] ? liveVeto(botRecs, 'basebreak', BASE_WAY[ex]) : null; return { r, ex, m, veto }; }).filter((x) => x.m && RUNNER_EXITS[x.ex] && !x.veto).sort((a, b) => (wTrim(b.r) - wTrim(a.r)) || (b.r.exBest - a.r.exBest)); /* the best worse half without its best trade, then the best average without its best trade */
  if (ok.length) { const { r, ex, m } = ok[0]; entries.push({ type: 'base', combo: r.combo, boxH: +m[1], maxRangePct: +m[2], volX: +m[3], exitKey: ex, exit: RUNNER_EXITS[ex], evidence: `runner backtest ${runnerBt.at ? runnerBt.at.slice(0, 10) : ''}, forward book: "${r.combo}" ${pct(r.avg)} a trade over ${r.n} (${pct(r.exBest)} without its best trade, median ${pct(r.med)}), older half ${pct(r.olderExBest)} and newer half ${pct(r.newerExBest)} without their best trades, random hours on the same coins ${pct(rndOf(ex))} (the best of ${held.length} that passed)` }); }
  const lb = (runnerBt && runnerBt.universe && runnerBt.universe.best || [])[0];
  looked.push(runnerBt ? (F ? `Runner backtest, forward book (${F.pools || 0} coins watched before they broke out): ${held.length} entry/exit combinations held on both halves without their best trade and beat random${ok.length ? `; best "${ok[0].r.combo}"` : ''}.${lb ? ` The lookback book's "${lb.combo}" ${pct(lb.avg)} (${pct(lb.exBest)} without its best trade) is survivorship and does not count.` : ''}` : 'Runner backtest: no forward book yet (it needs the backtest to run again), so nothing from it is in the rulebook.') : 'Runner backtest: not read.');
  // 3. the bottomed-out backtest: Chill's DCA
  const BB = ((bottomBt && bottomBt.combos) || {}), bheld = Object.entries(BB).map(([combo, r]) => ({ combo, ...r })).filter((r) => (r.holdsTrim ?? r.holds) && r.n >= 20 && r.combo.startsWith('dca / ') && BOTTOM_EXITS[r.combo.split(' / ')[1]] && (BB['random / ' + r.combo.split(' / ')[1]] == null || r.exBest > BB['random / ' + r.combo.split(' / ')[1]].avg)).sort((a, b) => worse(b) - worse(a));
  if (bheld.length) { const r = bheld[0], ex = r.combo.split(' / ')[1]; entries.push({ type: 'dca', combo: r.combo, exitKey: ex, exit: BOTTOM_EXITS[ex], evidence: `bottomed-out backtest ${bottomBt.at ? bottomBt.at.slice(0, 10) : ''}: "${r.combo}" ${pct(r.avg)} a clip over ${r.n} (${pct(r.exBest)} without its best trade), older ${pct(r.olderAvg)}, newer ${pct(r.newerAvg)}, random days ${pct((BB['random / ' + ex] || {}).avg)}` }); }
  const bbest = (bottomBt && bottomBt.best || [])[0]; looked.push(bottomBt ? (bheld.length ? `Bottomed-out backtest: DCA held on both halves.` : `Bottomed-out backtest: nothing held on both halves${bbest ? ` (best "${bbest.combo}" ${pct(bbest.avg)}, older ${pct(bbest.olderAvg)}, newer ${pct(bbest.newerAvg)})` : ''}, so no DCA in the rulebook.`) : 'Bottomed-out backtest: not read.');
  // 4. the pattern backtest
  const pv = ((patternBt && patternBt.exitVariants) || []).filter((x) => x.closed >= 30 && x.avgR > 0); looked.push(patternBt ? (pv.length ? `Pattern backtest: "${pv[0].name}" made money over ${pv[0].closed} (the bot cannot trade chart patterns yet: a yes from Ryan adds them).` : `Pattern backtest: no exit made money over 30+ signals (${patternBt.overall ? (patternBt.overall.avgR >= 0 ? '+' : '') + patternBt.overall.avgR + 'R a trade as traded' : '—'}), so no chart patterns in the rulebook.`) : 'Pattern backtest: not read.');
  // 5. the bots' own trades
  const nb = Object.values(botRecs || {}).reduce((a, r) => a + ((r && r.closed) || []).length, 0); looked.push(`Bots: ${Object.keys(botRecs || {}).length} books, ${nb} closed trades read (retired bots included); a way losing on both halves over 30+ live trades is kept out of the rulebook.`);
  const book = { at, entries, filters: FILTERS, looked }; book.version = versionOf(book); return book; }
// what the bot trades: the rulebook in force. The first one ever built goes straight in; after that a new build is a proposal until Ryan approves its version.
// The first rulebook ever built went straight in (25 Oct). After that the active one only changes with Ryan's yes: docs/bestof-approve.json
// holding { version, at } for the proposed version, dated after the active one took force (a stale yes for a version that comes round
// again months later does not count). A missing file is not "no rulebook": the caller passes the last active one it can find.
export function activeRulebook(prevFile, proposed, approve = null, { bootstrap = false } = {}) { const prev = prevFile && prevFile.active; if (!prev) return bootstrap ? { active: { ...proposed, since: proposed.at }, proposed, differs: false } : { active: { ...proposed, entries: [], since: proposed.at, waiting: true }, proposed, differs: proposed.entries.length > 0 };
  const okYes = approve && approve.version === proposed.version && (!approve.at || !prev.since || approve.at > prev.since);
  if (okYes && prev.version !== proposed.version) return { active: { ...proposed, since: proposed.at, approvedBy: 'Ryan' }, proposed, differs: false };
  return { active: prev, proposed, differs: prev.version !== proposed.version, staleYes: approve && approve.version && approve.version !== proposed.version && approve.version !== prev.version ? approve.version : null }; }
export function rulebookLines(file) { if (!file || !file.active) return { lines: ['No rulebook yet.'], holding: [] }; const A = file.active, P = file.proposed;
  const lines = [`Rulebook ${A.version} (in force since ${String(A.since || A.at).slice(0, 10)}): ${A.entries.length ? A.entries.map((e) => `${ENTRY_KINDS[e.type]} "${e.combo}"`).join('; ') : 'nothing has earned a place yet, so it waits'}.`, ...A.entries.map((e) => `Why: ${e.evidence}.`), ...(A.looked || [])];
  if (file.differs && P) lines.push(`New evidence would change it to: ${P.entries.length ? P.entries.map((e) => `${ENTRY_KINDS[e.type]} "${e.combo}"`).join('; ') : 'nothing'} (version ${P.version}; needs Ryan's yes).`); if (file.staleYes) lines.push(`A yes is on file for version ${file.staleYes}, but the evidence has moved on since: it no longer matches, so nothing changed.`); return { lines, holding: [] }; }
