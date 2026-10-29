// the Alts desk and Spot & chill scoreboard (30 Oct): every BID on paper next to a random coin, managed the way the desk says
import { stepDeskBook, deskRecord, deskLine, DESK } from '../docs/deskbook.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const d = (i) => new Date(Date.UTC(2026, 9, 30) + i * 86400e3).toISOString().slice(0, 10);
const res = (bidPx, rndPx, state = 'NONE') => [{ symbol: 'ENA', state, score: 80, pattern: 'falling wedge', lastClose: bidPx, invalidation: 0.8, t1: 1.3, t2: 1.6, t3: 2 }, { symbol: 'ZZZ', state: 'NONE', score: 10, lastClose: rndPx }];
let b = stepDeskBook(null, res(1, 10, 'BID'), { day: d(0), rnd: () => 0 });
ok(b.open.length === 2 && b.open[0].sym === 'ENA' && b.open[0].stop === 0.8 && b.open[1].random && b.open[1].sym === 'ZZZ' && Math.abs(b.open[1].stop0 - 8) < 1e-9 && Math.abs(b.open[1].t1 - 13) < 1e-9, 'a BID is booked at the daily close with the pattern\'s invalidation as its stop; a random no-setup coin beside it with the same 20% stop and the same R targets');
ok(stepDeskBook(b, res(1, 10, 'BID'), { day: d(0) }).open.length === 2, 'one step a day');
b = stepDeskBook(b, res(1.25, 10.5, 'BID'), { day: d(1), prevStates: { ENA: 'BID' } }); ok(b.open.length === 2 && b.open[0].stop === 1, 'still BID the next day: not booked twice; +1R reached, so the stop moves to the entry');
b = stepDeskBook(b, res(1.35, 10.5), { day: d(2), prevStates: { ENA: 'BID' } }); ok(b.open[0].hit.join() === 'T1' && b.open[0].sales.length === 1, 'T1 hit: a quarter sold into strength');
b = stepDeskBook(b, res(0.99, 7.5), { day: d(3) }); const R = deskRecord(b);
ok(b.closed.length === 2 && R.bids.n === 1 && R.random.n === 1 && R.bids.avg > 0 && R.random.avg < 0, 'back under the entry: the rest out at break-even (a profit after the T1 sale); the random coin hit its stop');
ok(/BIDs on paper: \+[\d.]+% a trade over 1 .* random coins the same days -[\d.]+%.*too few to judge/.test(deskLine('Alts desk', b)) && /no BID closed yet \(none called yet\)/.test(deskLine('Spot & chill', null)), 'the page and the council get a plain line with the luck bar');
let m = stepDeskBook(null, res(1, 10, 'BID'), { day: d(0), rnd: () => 0 }); for (let i = 1; i <= DESK.maxHoldD; i++) m = stepDeskBook(m, res(1.1, 10), { day: d(i), prevStates: { ENA: 'BID' } }); ok(!m.open.length && m.closed.some((t) => /60 days/.test(t.why)), 'nothing rides forever: out after 60 days');
let g = stepDeskBook(null, res(1, 10, 'BID'), { day: d(0), rnd: () => 0 }); for (let i = 1; i <= DESK.missD; i++) g = stepDeskBook(g, [], { day: d(i) }); ok(!g.open.length && g.closed.every((t) => /off the desk/.test(t.why)), 'a coin that drops off the desk\'s list for 10 days is closed at its last close');
const { headCouncil } = await import('../docs/trackcouncil.mjs');
{ const h = headCouncil({}, Date.now(), [], { alts: { bids: { n: 31, avg: 6, win: 45 }, random: { n: 31, avg: -2 }, open: 2 }, memes: { bids: { n: 0 }, random: { n: 0 }, open: 0 } });
  ok(h.points.some((p) => /Alts desk BIDs on paper: \+6/.test(p)) && h.points.some((p) => /Spot & chill: no BID closed/.test(p)) && h.proposals.some((p) => p.kind === 'bot candidate' && /Alts desk/.test(p.text)), 'the head council reads both scoreboards and proposes a desk as a bot once its BIDs beat random over 30+'); }
process.exit(f);
