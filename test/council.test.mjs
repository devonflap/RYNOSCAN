// Review council: paired exit tests, the hats, the chair's final answer, history, and the walk-forward council bot.
import { council, paired, HATS } from '../docs/council.mjs';
import { botBook } from '../docs/botsim.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const D0 = Date.parse('2026-09-01T00:00:00Z'), at = (h) => new Date(D0 + h * 3600e3).toISOString().slice(0, 16) + 'Z';
// a closed lab row: entry 1, first stop 0.8 (20%), one sale at 1 + ret
const row = (book, i, ret, o = {}) => ({ lid: `${book}|sig${i}`, book, profile: o.profile || 'riskyPick', id: 'SOL:C' + i, coin: o.coin || 'C' + i, chain: 'Solana', pool: 'p' + i, signalAt: at(i * 10), entryAt: at(i * 10), entryPx: 1, stop0: 0.8, stopNow: 0.8,
  fills: [{ t: at(i * 10 + 5), level: 1 + ret, px: 1 + ret, frac: 1, why: ret > 0 ? 'tp1' : 'stop' }], rem: 0, status: ret > 0 ? 'all targets hit' : 'stopped out', closedAt: at(i * 10 + 5), liq: 500000, mkt: { sol: i % 4 < 2 ? 'Risk-on' : 'Risk-off', vol: 'Normal' }, ...o });

// paired comparison
{ const base = Array.from({ length: 12 }, (_, i) => ({ key: 'risky|s' + i, open: false, pnlPct: -5 + (i % 3) })), alt = base.map((t, i) => ({ key: 'riskyPick|s' + i, open: false, pnlPct: t.pnlPct + 4 + (i % 2) }));
  const p = paired(base, alt); ok(p.n === 12 && p.call === 'better' && p.better === 1 && p.diff > 4, 'paired test: same coins, alt beats base on every trade -> better');
  ok(paired(base.slice(0, 6), alt.slice(0, 6)).call === 'too few', 'fewer than 10 shared trades -> too few to call');
  ok(paired([{ key: 'degen-sig', open: false, pnlPct: -20 }], [{ key: 'degenFlow|degen-sig', open: false, pnlPct: -9 }]).n === 1, 'degen desk rows pair with their lab copies by signal'); }

// empty data: the council still meets and says so
{ const c = council({}); ok(c.final.headline === 'No edge yet · keep collecting' && c.hats.length === HATS.length && c.discussion.about === null && c.approved.length === 0, 'no data: keep collecting, nothing approved');
  ok(c.final.actions.some((a) => a.kind === 'auto' && /waiting in cash/.test(a.text)), 'council bot waits in cash'); }

// a book with a real-looking edge, a weaker copy on the same coins, and a losing random baseline
const lab = [];
for (let i = 0; i < 34; i++) { lab.push(row('riskyPick', i, i % 2 ? 0.3 : -0.05)); lab.push(row('risky', i, i % 2 ? 0.12 : -0.1, { profile: 'consRisky' })); }
for (let i = 0; i < 14; i++) lab.push(row('randomCtl', 100 + i, i % 3 ? -0.08 : 0.04, { profile: 'consRisky' }));
// (both market moods carry winners and losers, otherwise the skeptic rightly objects that it works in one mood only)
const C1 = council({ lab, now: D0 + 400 * 3600e3 }), bk = (k) => C1.books.find((b) => b.key === k);
ok(bk('riskyPick').call === 'bot candidate' && bk('riskyPick').n === 34 && bk('riskyPick').worth >= 0.99, 'clear edge, passes the skeptic and risk: bot candidate');
ok(bk('randomCtl').call === 'baseline' && !C1.approved.includes('randomCtl'), 'the random baseline is never approved');
ok(C1.approved.includes('riskyPick') && C1.history.length === 1, 'approved books recorded with a date for the council bot');
const pr = C1.pairs.find((p) => p.alt === 'riskyPick'); ok(pr && pr.n === 34 && pr.call === 'better', "exit tuner: Claude's exits beat the careful exits on the same coins");
ok(C1.final.actions.some((a) => a.kind === 'ask' && /Make Risky · Claude the main exits/.test(a.text)) && C1.final.actions.some((a) => a.kind === 'ask' && /tiny real-money trial/.test(a.text)), 'changes to real rules are listed as needing your OK');
ok(C1.discussion.lines.length >= 3 && C1.discussion.lines[C1.discussion.lines.length - 1].hat === 'chair', 'round table ends with the chair ruling');
const sk = C1.hats.find((h) => h.key === 'skeptic'); ok(sk.stance === 'for' && /survives every check/.test(sk.headline), 'skeptic signs off only when every check it can run passes');
const C2 = council({ lab, now: D0 + 401 * 3600e3, history: C1.history }); ok(C2.history.length === 1, 'same approvals next scan: history not repeated');

// the skeptic catches a one-coin wonder
{ const lab2 = []; for (let i = 0; i < 34; i++) lab2.push(row('proven', i, i === 3 ? 6 : -0.04, { profile: 'proven', coin: i === 3 ? 'MOON' : 'C' + i }));
  const c = council({ lab: lab2, now: D0 + 400 * 3600e3 }), s = c.hats.find((h) => h.key === 'skeptic'); ok(c.books.find((b) => b.key === 'proven').call !== 'bot candidate' && /without its single best trade|one coin/.test(s.points.join(' ')), 'one moonshot carrying the book: not a bot candidate'); }

// risk manager flags gapping stops
{ const lab3 = []; for (let i = 0; i < 20; i++) lab3.push(row('degenLadder', i, i % 4 === 0 ? -0.4 : -0.1, { profile: 'ladder' }));
  const r = council({ lab: lab3, now: D0 + 400 * 3600e3 }).hats.find((h) => h.key === 'risk'); ok(r.stance === 'against' && /more than 1.25x the planned risk/.test(r.headline), 'stops gapping past the plan are flagged'); }

// council bot: walk-forward on the approvals
{ const pos = [0, 1].map((i) => ({ key: 'x' + i, src: 'riskyPick', coin: 'K' + i, pool: 'q' + i, at: at(i ? 50 : 5), entryAt: at(i ? 50 : 5), entryPx: 1, stop0: 0.8, fills: [{ t: at(i ? 55 : 8), px: 1.2, frac: 1 }], rem: 0, open: false, closedAt: at(i ? 55 : 8), liq: 1e6 }));
  const b = botBook(pos, { approvals: [{ at: at(20), approved: ['riskyPick'] }], now: D0 + 100 * 3600e3 });
  ok(b.takenN === 1 && b.skipWhy['council had not met yet'] === 1 && b.trades[0].key === 'x1', 'council bot only takes signals after the council approved the book');
  const b2 = botBook(pos, { approvals: [{ at: at(1), approved: ['degen'] }], now: D0 + 100 * 3600e3 }); ok(b2.takenN === 0 && b2.skipWhy['council had not approved this book'] === 2, 'books the council has not approved are skipped'); }
// buy the flush: a limit entry is judged per signal, a missed fill counts as 0%
{ const { flushPlan } = await import('../docs/strategies.mjs'); const fp = flushPlan(1); ok(fp.limit === 0.94 && fp.stop === 0.846 && fp.cancelAbove === 1.25 && fp.expireH === 3, 'flush plan: bid 6% under the alert, stop 10% under that, cancel on a 25% run');
  const labF = []; for (let i = 0; i < 12; i++) { labF.push(row('pulse', i, -0.06, { profile: 'pulse' })); labF.push(i < 6 ? row('pulseFlush', i, 0.05, { profile: 'pulseFlush' }) : { lid: 'pulseFlush|sig' + i, book: 'pulseFlush', profile: 'pulseFlush', coin: 'C' + i, chain: 'Solana', signalAt: at(i * 10), status: 'cancelled (ran without a dip)', plan: fp }); }
  const pf = council({ lab: labF, now: D0 + 400 * 3600e3 }).pairs.find((p) => p.alt === 'pulseFlush'); ok(pf && pf.n === 12 && pf.diff > 5 && pf.diff < 12, 'flush vs market entry compared on all 12 alerts (6 missed fills count as 0%)'); }
// where each book works: a book that only makes money in one market mood
{ const labS = [];
  for (let i = 0; i < 40; i++) labS.push(row('fibPull', i, i % 2 ? (i % 4 === 1 ? 0.3 : 0.2) : -0.1, { profile: 'fibPull', mkt: { sol: i % 2 ? 'Risk-on' : 'Risk-off', vol: 'Normal' } }));
  const c = council({ lab: labS, now: D0 + 500 * 3600e3 });
  const sc = c.hats.find((h) => h.key === 'scout'); ok(/Fib pullback does better when market mood is "Risk-on"/.test(sc.headline), 'scout finds where a book works (luck-corrected): ' + sc.headline);
  ok(c.final.actions.some((a) => a.kind === 'ask' && /Only run Fib pullback when market mood is "Risk-on"/.test(a.text)), 'a condition rule is offered as a question, never applied'); }
// Kelly-based size hint for a bot candidate
ok(C1.final.actions.some((a) => /quarter of the Kelly figure/.test(a.text) && /risk about (0\.\d|1\.0)%/.test(a.text)), 'bot candidate comes with a capped, quarter-Kelly risk hint');
// learning loop: slices are judged against the rest of the trades, not against zero
{ const { learn } = await import('../src/learn.mjs'); const sigs = Array.from({ length: 60 }, (_, i) => ({ setup: 'Bottom reversal', chain: 'Solana', at: '2026-10-01T00:00:00Z', signalAt: '2026-10-01T00:00:00Z', status: 'stopped out', resultR: i % 3 === 0 ? -0.9 + (i % 2) * 0.1 : -0.3 + (i % 2) * 0.1, pq: i % 3 === 0 ? 60 : 80 }));
  const L = learn(sigs); ok(/Most slices look negative because the trades as a whole average/.test(L.insights[0]) && L.insights.some((t) => /Pattern quality under 70: .* against .* for the rest \(worse by/.test(t)), 'when everything loses, the learning loop shows which slices are worse than the rest'); }
// RynoBot spot alert: Risky · Ryan / Risky · Claude get their own phone alert the first time the council calls them a bot candidate
{ const { botSpotAlerts, runCouncil } = await import('../src/councilrun.mjs'); const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const a1 = botSpotAlerts(C1, {}); ok(a1.alerts.length === 1 && a1.alerts[0].key === 'riskyPick' && a1.alerts[0].title === 'RynoBot: Risky · Claude has earned a bot spot' && /34 closed paper trades/.test(a1.alerts[0].body) && /Random entries on the same desk/.test(a1.alerts[0].body) && /add it to RynoBot/.test(a1.alerts[0].body) && a1.spot.riskyPick, 'bot spot: Claude\'s risky setup becomes a bot candidate -> its own alert with the numbers and the next step');
  ok(botSpotAlerts(C1, { botSpot: a1.spot }).alerts.length === 0, 'bot spot: alerts once, not every scan');
  const lose = { at: 'x', books: [{ key: 'riskyPick', short: 'Risky · Claude', call: 'losing', n: 40 }] }, r2 = botSpotAlerts(lose, { botSpot: a1.spot });
  ok(!r2.spot.riskyPick && botSpotAlerts(C1, { botSpot: r2.spot }).alerts.length === 1, 'bot spot: re-arms only after the book falls to losing');
  ok(botSpotAlerts({ at: 'x', books: [{ key: 'riskyRyan', short: 'Risky · Ryan', call: 'promising', n: 12 }, { key: 'risky', short: 'Risky coins', call: 'bot candidate', n: 40 }] }, {}).alerts.length === 0, 'bot spot: promising is not enough, and other books are not on this watch');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-')), sent = []; fs.writeFileSync(path.join(dir, 'lab.json'), JSON.stringify(lab));
  const post = async (t, b) => sent.push(t); await runCouncil(dir, { now: D0 + 400 * 3600e3, post, since: null }); await runCouncil(dir, { now: D0 + 401 * 3600e3, post, since: null });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'council.json'), 'utf8'));
  ok(sent.length === 1 && sent[0] === 'RynoBot: Risky · Claude has earned a bot spot' && saved.botSpot.riskyPick && saved.botSpot.riskyPick.n === 34, 'scan run: one phone alert over two scans, remembered in council.json, no double general alert');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'council-')); fs.writeFileSync(path.join(dir2, 'lab.json'), JSON.stringify(lab)); let tries = 0;
  await runCouncil(dir2, { now: D0 + 400 * 3600e3, post: async () => { tries++; throw new Error('ntfy down'); }, since: null }); await runCouncil(dir2, { now: D0 + 401 * 3600e3, post: async () => { tries++; }, since: null });
  ok(tries === 2 && JSON.parse(fs.readFileSync(path.join(dir2, 'council.json'), 'utf8')).botSpot.riskyPick, 'if the phone alert fails it tries again next scan'); }
// bot-rule slices and the study exits judged against the bot rules on the same trigger entries
{ const { bookSlices, gather } = await import('../docs/council.mjs'); const rows = [];
  for (let i = 0; i < 30; i++) { const flush = i % 2 === 0, why = [`Falling wedge (${i % 3 ? 'worth watching' : 'bid-ready'}, score 7${i % 10})`];
    rows.push(row('exec', i, flush ? 0.12 : -0.08, { profile: 'exec', setupType: 'Falling wedge', trig: flush ? 'flush and reclaim' : 'bounce in the zone', opp: 70 + (i % 10), why, stop0: i % 4 === 0 ? 0.93 : 0.8 }));
    rows.push(row('execStudy', i, flush ? 0.2 : -0.1, { profile: 'study', setupType: 'Falling wedge', trig: flush ? 'flush and reclaim' : 'bounce in the zone', opp: 70 + (i % 10), why })); }
  const G = gather({ lab: rows, now: D0 + 400 * 3600e3 }), sl = bookSlices(G), tr = sl.find((t) => t.book === 'exec' && t.slice === 'trigger' && t.bucket === 'flush and reclaim');
  ok(tr && tr.n === 15 && tr.diff > 0 && sl.some((t) => t.book === 'exec' && t.slice === 'signal') && sl.some((t) => t.book === 'exec' && t.slice === 'stop distance'), 'the council slices the bot rules by trigger kind, bid-ready vs watch, score and stop distance');
  const C = council({ lab: rows, now: D0 + 400 * 3600e3 }), pe = C.pairs.find((p) => p.alt === 'execStudy'); ok(pe && pe.base === 'exec' && pe.n === 30, 'study exits are compared with the bot rules on the same trigger entries (exits only)'); }
process.exit(f);
