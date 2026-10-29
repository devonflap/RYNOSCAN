// THE ALTS DESK AND SPOT & CHILL SCOREBOARD (30 Oct, Ryan's yes: "they have no scoreboard"). Every BID either desk calls is booked on
// paper at that daily close, managed on daily closes exactly the way the desk tells a person to manage it (bot/../docs/mw.mjs
// managePositions): out on a close under the stop (the pattern's invalidation), stop to the entry at +1R, a quarter sold at each of T1, T2
// and T3, the last quarter riding until the stop or 60 days. Next to every BID, a RANDOM coin from the same desk's list that day (one with
// no setup at all) is booked at its close with the same distance to its stop and the same R-multiple targets: the luck bar. Pure: the
// daily scan passes in the day's results and gets the book back.
export const DESK = { maxHoldD: 60, missD: 10 };
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const retOf = (t) => { const sold = t.sales.reduce((a, s) => a + s.frac * s.px, 0), left = 1 - t.sales.reduce((a, s) => a + s.frac, 0); return ((sold + left * (t.last || t.entry)) / t.entry - 1) * 100; };
function manage(t, px, day) { if (!(px > 0)) return; t.last = px; t.peak = Math.max(t.peak || px, px); const R = t.entry - t.stop0, left = () => 1 - t.sales.reduce((a, s) => a + s.frac, 0), out = (why) => { t.sales.push({ frac: left(), px, why, day }); t.closedDay = day; t.why = why; };
  if (px < t.stop) return out(t.stop >= t.entry ? 'back to the entry after +1R (break-even stop)' : 'closed under the invalidation');
  if (R > 0 && px >= t.entry + R && t.stop < t.entry) t.stop = t.entry;
  for (const [k, lvl] of [['T1', t.t1], ['T2', t.t2], ['T3', t.t3]]) if (lvl > 0 && px >= lvl && !t.hit.includes(k) && left() > 0.26) { t.hit.push(k); t.sales.push({ frac: 0.25, px, why: k, day }); }
  if (t.days >= DESK.maxHoldD) out(`${DESK.maxHoldD} days`); }
export function newTrade(r, day, random = false) { const entry = +r.lastClose, stop = +r.invalidation; if (!(entry > 0) || !(stop > 0) || stop >= entry) return null;
  return { sym: r.symbol, coin: r.coin || r.symbol, pattern: random ? 'random coin (the luck bar)' : r.pattern, random, openedDay: day, entry, stop0: stop, stop, t1: +r.t1 || 0, t2: +r.t2 || 0, t3: +r.t3 || 0, sales: [], hit: [], days: 0, miss: 0, last: entry }; }
// a random coin with no setup, given the BID's distance to its stop and its targets as R multiples
export function randomTwin(bid, results, rnd = Math.random) { const pool = results.filter((x) => x.state === 'NONE' && +x.lastClose > 0 && x.symbol !== bid.sym); if (!pool.length) return null; const x = pool[Math.floor(rnd() * pool.length)], e = +x.lastClose, R = bid.entry - bid.stop0, m = (lvl) => (lvl > 0 ? e * (1 + (lvl - bid.entry) / bid.entry) : 0);
  return { ...newTrade({ symbol: x.symbol, coin: x.coin, lastClose: e, invalidation: e * (1 - R / bid.entry), t1: m(bid.t1), t2: m(bid.t2), t3: m(bid.t3) }, bid.openedDay, true) }; }
// one day: manage open trades on today's closes, then book today's new BIDs (a coin's first BID since it last left the BID state)
export function stepDeskBook(book0, results, { day, prevStates = {}, keyPrefix = '', minScore = 0, rnd = Math.random } = {}) {
  const book = { open: [...((book0 && book0.open) || [])].map((t) => ({ ...t, sales: [...t.sales], hit: [...t.hit] })), closed: [...((book0 && book0.closed) || [])] }, by = new Map(results.map((r) => [r.symbol, r]));
  if (book0 && book0.lastDay === day) return { ...book0 }; /* one step a day */
  for (const t of book.open) { const r = by.get(t.sym); t.days++; if (!r) { t.miss++; if (t.miss >= DESK.missD) { const why = `off the desk's list for ${DESK.missD} days: closed at the last close seen`; t.sales.push({ frac: 1 - t.sales.reduce((a, s) => a + s.frac, 0), px: t.last, why, day }); t.closedDay = day; t.why = why; } continue; } t.miss = 0; manage(t, +r.lastClose, day); }
  for (const t of book.open.filter((x) => x.closedDay)) book.closed.push({ ...t, ret: r1(retOf(t)) }); book.open = book.open.filter((x) => !x.closedDay);
  for (const r of results) { if (r.state !== 'BID' || prevStates[keyPrefix + r.symbol] === 'BID' || (r.score ?? 0) < minScore) continue; if (book.open.some((t) => t.sym === r.symbol && !t.random)) continue;
    const t = newTrade(r, day); if (!t) continue; book.open.push(t); const tw = randomTwin(t, results, rnd); if (tw) book.open.push(tw); }
  return { ...book, lastDay: day, closed: book.closed.slice(-500) }; }
export function deskRecord(book) { const C = (book && book.closed) || [], rec = (T) => { const R = T.map((t) => t.ret).filter((x) => x != null); return R.length ? { n: R.length, avg: r1(R.reduce((a, b) => a + b, 0) / R.length), win: r1((R.filter((x) => x > 0).length / R.length) * 100) } : { n: 0 }; };
  return { bids: rec(C.filter((t) => !t.random)), random: rec(C.filter((t) => t.random)), open: ((book && book.open) || []).filter((t) => !t.random).length }; }
export function deskLine(name, book) { const r = deskRecord(book); return r.bids.n ? `${name} BIDs on paper: ${r.bids.avg >= 0 ? '+' : ''}${r.bids.avg}% a trade over ${r.bids.n} (${r.bids.win}% won); random coins the same days ${r.random.n ? (r.random.avg >= 0 ? '+' : '') + r.random.avg + '%' : '—'}${r.open ? `; ${r.open} open` : ''}${r.bids.n < 30 ? ' (too few to judge)' : ''}.` : `${name}: no BID closed yet${r.open ? ` (${r.open} open)` : ' (none called yet)'}; every BID is booked on paper from 30 Oct.`; }
