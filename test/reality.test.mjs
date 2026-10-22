// Reality check: the bot's dry-run trades against the paper "Bot rules" book on the same coins, why trades were missed, and the 14-day schedule.
import { realityCheck, reportText } from '../bot/reality.mjs';
import { cycle, newState, DEFAULTS } from '../bot/run.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-21T00:00:00Z'), H = 3600e3, iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z', isoM = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
// a closed paper row: entry 1, stop 0.9, a third sold at +1R (1.10), the rest out at break-even
const paperRow = (i, pool, h, o = {}) => ({ lid: `exec|${pool}@${h}`, book: 'exec', profile: 'exec', id: 'SOL:' + pool, coin: pool.toUpperCase(), chain: 'Solana', pool, signalAt: isoM(T0 + (h - 1) * H), entryAt: isoM(T0 + h * H), entryPx: 1, stop0: 0.9,
  fills: [{ t: isoM(T0 + (h + 1) * H), level: 1.1, px: 1.1, frac: 1 / 3, why: 'tp1' }, { t: isoM(T0 + (h + 2) * H), level: 1, px: 1, frac: 2 / 3, why: 'stop' }], rem: 0, status: 'stopped out', closedAt: isoM(T0 + (h + 2) * H), ...o });
// a closed bot trade: paid 1% more, never saw the target, out 2% under the entry
const botPos = (pool, h, o = {}) => ({ id: pool + '@x', coin: pool.toUpperCase(), pool, openedAt: iso(T0 + h * H + 4 * 60e3), entry: 1.01, stop0: 0.91, stop: 0.91, costUsd: 100, units: 100 / 1.01, remUnits: 0, bankedUsd: 98, pnl: -2, sells: [{ why: 'no follow-through after 6 hours', usd: 98 }], closedAt: iso(T0 + (h + 6) * H), ...o });

const paper = [], closed = [];
for (let i = 0; i < 12; i++) { paper.push(paperRow(i, 'p' + i, 10 * i)); closed.push(botPos('p' + i, 10 * i)); }
// paper trades the bot missed, one per reason
paper.push(paperRow(0, 'off', 125), paperRow(0, 'full', 135), paperRow(0, 'ran', 145), paperRow(0, 'quiet', 155), paperRow(0, 'never', 165));
closed.push(botPos('solo', 170)); // the bot took one the paper did not
const journal = [{ at: iso(T0 + 144 * H), type: 'drop', pool: 'ran', why: 'price already ran past the zone: no chasing' }, { at: iso(T0 + 150 * H), type: 'setup', pool: 'quiet' }, { at: iso(T0 + 130 * H), type: 'setup', pool: 'full' }];
const bot = { closed, positions: [], journal, gaps: [[iso(T0 + 124 * H), iso(T0 + 126 * H)]], blocks: [[iso(T0 + 133 * H), iso(T0 + 137 * H), 'all 4 position slots were full']], startedAt: iso(T0) };
const r = realityCheck(bot, paper, { now: T0 + 14 * 24 * H });
ok(r.shared === 12 && r.n === 12 && Math.abs(r.paperPct - 3.33) < 0.02 && r.botPct === -2 && Math.abs(r.gapPct - 5.33) < 0.02, 'same coins matched: paper +3.3% a trade, bot -2%, the replay looks 5.3% better');
ok(r.call === 'paper flatters' && r.lo > 0 && Math.abs(r.entryGapPct - 1) < 1e-6 && r.paperFurther === 12 && r.botFurther === 0, 'consistent gap: called, with where it comes from (1% worse entries, targets the bot never reached)');
ok(r.missed['the bot was offline'] === 1 && r.missed['all 4 position slots were full'] === 1 && r.missed['price ran before the bot could buy'] === 1 && r.missed["the bot was watching but its trigger didn't fire"] === 1 && r.missed['the bot never picked up the setup'] === 1, 'every paper trade the bot missed gets a reason');
ok(r.botOnly.length === 1 && r.botOnly[0].coin === 'SOLO' && r.offlineH === 2, 'bot-only trades and offline hours are counted');
const txt = reportText(r, T0 + 28 * 24 * H);
ok(/knock about 5\.3% \(0\.\d\dR\) a trade off every paper book/.test(txt) && /Missed: the paper took 5 the bot didn't/.test(txt) && /Next check: 18 Nov 2026/.test(txt) && /still simulated/.test(txt), 'the phone message says what to do with the number and when the next check is');
{ const few = realityCheck({ ...bot, closed: closed.slice(0, 3) }, paper.slice(0, 3), { now: T0 + 14 * 24 * H }); ok(few.call === 'too few' && /too few for a firm number \(10 needed\)/.test(reportText(few)), 'under 10 shared trades: no firm number yet'); }
{ const e = realityCheck({ startedAt: iso(T0) }, [], { now: T0 + 14 * 24 * H }); ok(/Neither side has taken a trade yet/.test(reportText(e)), 'no trades yet: says so'); }
{ const late = realityCheck({ ...bot, startedAt: iso(T0 + 200 * H) }, paper, { now: T0 + 400 * H }); ok(late.shared === 0 && late.paperTrades === 0, 'paper trades from before the bot started are not counted against it'); }

// schedule inside the bot loop: first check 14 days after it starts, then every 14 days; offline spells and full slots are remembered
{ const cfg = { ...DEFAULTS, setupsEveryMin: 1e9, maxOpen: 0, realityEveryDays: 14 }, st = newState(cfg), msgs = [], saved = [];
  const deps = (ms) => ({ now: ms, getJson: async (u) => (u.endsWith('lab.json') ? paper : []), quotes: async () => ({}), candles5: async () => null, notify: async (t, b) => msgs.push(t + ' | ' + b), journal: () => {}, readJournal: () => journal, saveReality: (x) => saved.push(x) });
  st.setupsAt = T0; await cycle(st, cfg, deps(T0)); await cycle(st, cfg, deps(T0 + 60e3));
  ok(st.startedAt === iso(T0) && msgs.length === 0 && st.blocks.length === 1 && st.blocks[0][1] == null && /slots were full/.test(st.blocks[0][2]), 'starts the clock, no check on day one, and remembers that buying was blocked');
  await cycle(st, cfg, deps(T0 + H)); ok(st.gaps.length === 1 && st.gaps[0][1] === iso(T0 + H), 'an hour without a cycle is remembered as offline');
  await cycle(st, cfg, deps(T0 + 14 * 24 * H)); ok(msgs.length === 1 && /reality check/.test(msgs[0]) && saved.length === 1 && st.realityAt === T0 + 14 * 24 * H, 'day 14: the reality check goes to the phone and is saved');
  await cycle(st, cfg, deps(T0 + 14 * 24 * H + 2 * H)); await cycle(st, cfg, deps(T0 + 27 * 24 * H)); ok(msgs.length === 1, 'not again until another 14 days have passed');
  await cycle(st, cfg, deps(T0 + 28 * 24 * H + 60e3)); ok(msgs.length === 2 && /Next check: 2 Dec 2026/.test(msgs[1]), 'day 28: the next one, with the date after that'); }
process.exit(f);
