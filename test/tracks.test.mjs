// the four research tracks and the head council (25 Oct)
import { trackCouncils, headCouncil, backtestLines, TRACKS, FREEZE } from '../docs/trackcouncil.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const iso = (t) => new Date(t * 1000).toISOString(), T0 = 1800000000;
const tr = (i, pnl, o = {}) => ({ coin: 'C' + i, pool: 'P' + i, openedAt: iso(T0 + i * 3600), entry: 1, exitAvg: 1 + pnl / 100, peak: 1.2, costUsd: 100, pnl, R: pnl / 25, heldH: 2, why: pnl > 0 ? 'time limit' : 'stop', meta: { variant: o.v } });
ok(Object.keys(TRACKS).join() === 'trenches,patterns,runners,bottoms,alts,best' && TRACKS.runners.bots.basebreak && TRACKS.patterns.bots.breakout && TRACKS.trenches.bots.trench && !TRACKS.trenches.bots.trenchbonus && TRACKS.bottoms.bots.bottoms && TRACKS.best.bots.bestof, 'five tracks and the best-of bot, one bot each (the alts track backtest only)');
const recs = { breakout: { bot: 'breakout', closed: [...Array(40)].map((_, i) => tr(i, i % 3 ? -10 : 40)), open: [], stats: { closed: 40 } }, basebreak: { bot: 'basebreak', closed: [...Array(40)].map((_, i) => tr(i, i % 2 ? -30 : -20, { v: i % 2 ? 'H-hold' : 'R-ride' })), open: [], stats: { closed: 40 } } };
const bts = { 'bottom-bt.json': { at: '2026-10-25T00:00:00Z', tested: 800, best: [{ combo: 'dd90 / trail40', avg: 8, n: 60, med: -20, holds: true }], combos: { 'random / hold60': { avg: -19 } } } };
const c = trackCouncils({ recs, backtests: bts, now: (T0 + 86400 * 3) * 1000 });
ok(c.tracks.patterns.council.league[0].closed === 40 && c.tracks.runners.council.league.find((x) => x.bot === 'basebreak').closed === 40, 'each track reads only its own bots');
ok(Object.keys(c.tracks.runners.council.autopsy).some((k) => /basebreak H-hold/.test(k)), 'a bot with ways is judged way by way');
ok(c.head.proposals.some((p) => p.track === 'bottoms' && p.kind === 'new bot' && /dd90 \/ trail40/.test(p.text)), 'the head council proposes a bot for a backtest finding that held on both halves and that no bot trades yet');
ok(c.head.proposals.some((p) => p.track === 'runners' && p.kind === 'retire or change'), 'and flags a bot losing even at the lucky end of its range over 30+ trades');
ok(c.head.freeze.active === (iso(T0 + 86400 * 3).slice(0, 10) < FREEZE.until) && /frozen|over/.test(c.head.freeze.note), 'the two-week rules freeze is stated');
ok(/No backtest yet/.test(backtestLines('bottoms', null).lines[0]), 'no backtest file: said plainly');
process.exit(f);
