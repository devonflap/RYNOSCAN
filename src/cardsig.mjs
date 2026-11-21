// CARD FINDER SIGNALS (21 Nov, Ryan: "cards that have dropped in price between $100 and $1000, One Piece and Pokémon; short, medium and
// long holds; cards worth holding that have dropped; new launches: wait a few weeks for the price to drop and get the chase cards at a
// discount"). Pure functions: src/cards.mjs passes in each card's price history (TCGplayer market price, raw near-mint, in AUD) and the
// set's release date, and gets back what the card is doing.
export const CARD = {
  minAud: 100, maxAud: 1000,      // the price band Ryan buys in
  newSetDays: 75,                 // a set this young is a "new release": its chase cards are watched for the post-launch drop
  chasePerSet: 10,                // the dearest cards in a new set
  dropMin: 0.25,                  // "dropped": 25%+ under its high of the last 6 months
  settleCh7: -0.03,               // settled: the last 7 days fell no more than 3%...
  settleRange14: 0.15,            // ...and the last 14 days stayed inside a 15% range
  fallingCh7: -0.05,              // still falling: down 5%+ in 7 days
  turnUp: 0.03,                   // turning up: 3%+ off its 14-day low
  minPoints: 4,
};
const DAY = 86400e3;
// series: [[t(ms), aud], ...] oldest first; now: ms
export function stats(series, now) {
  const S = (series || []).filter((p) => p[1] > 0).sort((a, b) => a[0] - b[0]); if (!S.length) return null;
  const cur = S[S.length - 1][1], at = (d) => { let best = null; for (const p of S) if (p[0] <= now - d * DAY + DAY / 2) best = p; return best ? best[1] : null; };
  const win = (d) => S.filter((p) => p[0] >= now - d * DAY - DAY / 2), mx = (w) => (w.length ? w.reduce((m, p) => (p[1] > m[1] ? p : m)) : null), mn = (w) => (w.length ? Math.min(...w.map((p) => p[1])) : null);
  const p7 = at(7), p30 = at(30), h180 = mx(win(182)), w14 = win(14), lo14 = mn(w14), hi14 = w14.length ? Math.max(...w14.map((p) => p[1])) : null;
  return { cur, n: S.length, ch7: p7 ? cur / p7 - 1 : null, ch30: p30 ? cur / p30 - 1 : null, high: h180 ? h180[1] : cur, highAt: h180 ? h180[0] : null, off: h180 ? cur / h180[1] - 1 : 0, lo14, range14: lo14 > 0 ? hi14 / lo14 - 1 : null, upFromLow14: lo14 > 0 ? cur / lo14 - 1 : null, first: S[0] }; }
export function horizonOf(ageDays) { return ageDays == null ? 'medium' : ageDays <= 270 ? 'short' : ageDays <= 900 ? 'medium' : 'long'; }
// what the card is doing, in plain words
export function statusOf(s, C = CARD) { if (!s) return { key: 'none', label: '—' };
  if (s.ch7 != null && s.ch7 <= C.fallingCh7) return { key: 'falling', label: `Still falling (${pc(s.ch7)} this week): wait` };
  const settled = (s.ch7 == null || s.ch7 >= C.settleCh7) && (s.range14 == null || s.range14 <= C.settleRange14);
  if (s.off <= -C.dropMin && settled && s.upFromLow14 >= C.turnUp) return { key: 'turning', label: `${pc(s.off)} off its high and turning up (${pc(s.upFromLow14)} off its 2-week low)` };
  if (s.off <= -C.dropMin && settled) return { key: 'settled', label: `${pc(s.off)} off its high and holding steady: buy zone` };
  if (s.off <= -C.dropMin) return { key: 'dropping', label: `${pc(s.off)} off its high, still choppy: wait for it to settle` };
  if (s.off > -0.1) return { key: 'holding', label: 'Near its high: no discount yet' };
  return { key: 'easing', label: `${pc(s.off)} off its high: watch` }; }
// a new set's chase cards: from launch, how far each has come down and whether it has stopped falling
export function newSetView(cards, C = CARD) { const chase = [...cards].filter((c) => c.s && c.s.cur > 0).sort((a, b) => b.s.cur - a.s.cur).slice(0, C.chasePerSet);
  const ups = chase.map((c) => ({ ...c, st: statusOf(c.s, C) })); const falling = ups.filter((c) => c.st.key === 'falling').length, ready = ups.filter((c) => ['settled', 'turning'].includes(c.st.key)).length;
  const avgOff = ups.length ? ups.reduce((a, c) => a + c.s.off, 0) / ups.length : 0;
  const verdict = !ups.length ? 'No prices yet.' : falling >= Math.ceil(ups.length / 2) ? `Chase cards still falling (${falling} of ${ups.length} down 5%+ this week): wait` : ready ? `${ready} chase card${ready > 1 ? 's' : ''} settled after the launch drop: look now` : avgOff > -0.15 ? 'Chase cards near their launch prices: no discount yet, wait' : 'Prices easing: watch';
  return { chase: ups, falling, ready, avgOff, verdict }; }
// the dropped-deals list: quality cards in the price band, well off their 6-month high, that have stopped falling
export function isDeal(c, C = CARD) { const s = c.s; if (!s || s.n < C.minPoints) return false; if (!(s.cur >= C.minAud && s.cur <= C.maxAud)) return false; if (!(s.off <= -C.dropMin)) return false; return statusOf(s, C).key === 'settled' || statusOf(s, C).key === 'turning'; }
export function dealScore(c) { const s = c.s; return -s.off * 100 + (s.upFromLow14 > 0 ? Math.min(10, s.upFromLow14 * 100) : 0) + (c.thin ? -15 : 0); }
const pc = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + Math.round(x * 100) + '%');
export { pc };
