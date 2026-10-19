// Strategy lab: every paper approach in one place (which coins it buys, how it sizes, how it exits).
// This registry is also the blueprint for a future trading bot: a bot would read the same entry rule and exit profile and place real orders.
// Today everything here is paper money only.
import { PROFILES } from './exits.mjs';
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
const r6 = (x) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(6));

// group: which tab shows the book. same: books that share their entries (so only the exits differ and they compare directly).
export const BOOKS = {
  bid: { group: 'cons', label: 'Bid-ready setups', short: 'Bid-ready', entry: 'Every bid-ready call from the main rules (all 7 gates pass), limit order in the entry zone, 48 hours to fill.', exits: 'Thirds sold at TP1, TP2 and TP3, stop to break-even after TP1, 7-day time limit.', pct: 5, slots: 10 },
  risky: { group: 'cons', label: 'Risky coins, careful rules', short: 'Risky coins', profile: 'consRisky', entry: 'High-risk runners that pass at least 3 of the 4 checks and no risk rule, at most 2 new per scan.', pct: 4, slots: 6, maxNew: 2 },
  degen: { group: 'degen', same: 'degen', label: 'Degen desk (current exits)', short: 'Degen current', profile: 'degen', entry: 'Volume surge of 2.5x or more, up 10% to 400% in 24 hours, buyers leading, $50k+ liquidity, wallets not leaning out.', pct: 10, slots: 8 },
  degenLadder: { group: 'degen', same: 'degen', label: 'Degen · ladder (bank on the way up)', short: 'Degen ladder', profile: 'ladder', entry: 'Same coins and times as the degen desk.', pct: 10, slots: 8 },
  degenMoon: { group: 'degen', same: 'degen', label: 'Degen · moonbag', short: 'Degen moonbag', profile: 'moon', entry: 'Same coins and times as the degen desk.', pct: 10, slots: 8 },
  degenTight: { group: 'degen', same: 'degen', label: 'Degen · tight', short: 'Degen tight', profile: 'tight', entry: 'Same coins and times as the degen desk.', pct: 10, slots: 8 },
  fibPull: { group: 'play', label: 'First Fib pullback (playbook)', short: 'Fib pullback', profile: 'fibPull', entry: 'A coin that ran 50% or more to a new high in the last 2 days (1-hour candles, wick to wick). Limit buy at the 0.5 retracement of that run, or 0.618 if price is already below 0.5; cancelled if it makes a new high first or after 48 hours.', pct: 6, slots: 6, maxNew: 3 },
  patInside: { group: 'play', label: 'Inside the pattern (playbook)', short: 'Inside pattern', profile: 'patInside', entry: 'A forming falling wedge, bull flag, double bottom, inverse H&S or cup & handle on the 4h chart. Limit buy in the lower third of the pattern (third touch, right shoulder, handle, second bottom); cancelled if it breaks out first or after 72 hours.', pct: 5, slots: 6, maxNew: 3 },
  proven: { group: 'play', label: 'Follow proven wallets', short: 'Proven wallets', profile: 'proven', entry: 'Two or more wallets from the wallet scorecard are net buyers in the last 24 hours and no risk rule fires. Buys the next hourly open.', pct: 5, slots: 6, maxNew: 3 },
  scalpBreak: { group: 'scalp', label: 'Scalper · breakout', short: 'Scalp breakout', profile: 'scalpBreak', entry: '5-minute candle closes above the last hour\'s high on at least 2x normal volume, near the top of its range, uptrend on the 20-candle average, not already stretched.', pct: 5, slots: 4, maxNew: 3 },
  scalpDip: { group: 'scalp', label: 'Scalper · dip-buy', short: 'Scalp dip', profile: 'scalpDip', entry: 'Coin up on the day; a 5-minute candle flushes 5% or more below its 20-candle average with RSI under 30 on heavy volume and closes off its low.', pct: 5, slots: 4, maxNew: 3 },
};
for (const k of Object.keys(BOOKS)) if (BOOKS[k].profile) BOOKS[k].exits = PROFILES[BOOKS[k].profile].label;
export const DEGEN_COPIES = ['degenLadder', 'degenMoon', 'degenTight'];

// Exit rules compared on every logged runner (Learn tab, runner study). Same entries, only the exit differs.
const DP = PROFILES.degen;
export const EXIT_SET = {
  'stop 15%': { ...DP, stopPct: 0.15 }, 'stop 25%': { ...DP, stopPct: 0.25 }, 'trail 20%': { ...DP, trailPct: 0.2 }, 'trail 40%': { ...DP, trailPct: 0.4 },
  'sell half at 3x': { ...DP, ladder: [[3, 0.5]] }, 'sell half at 1.5x': { ...DP, ladder: [[1.5, 0.5]] },
  'ladder 1.5x/2x/3x, trail 35%': PROFILES.ladder, 'moonbag 2x/4x, trail 45%': PROFILES.moon, 'tight: 12% stop, half at 1.3x': PROFILES.tight, 'careful: 10% stop, +15%/+30%, 24h': PROFILES.consRisky, 'tiers: half at 2x, 25% at 3x, trail 35%': PROFILES.proven,
};
export const EXIT_SET_HOURS = Math.max(...Object.values(EXIT_SET).map((p) => p.maxHours));

// A lab row: one paper trade for one book. lid is unique per book.
export function labRow(book, src, at, extra = {}) {
  const px = num(src.price ?? src.priceAtSignal ?? src.entryMid), id = src.id || (String(src.chain).slice(0, 3).toUpperCase() + ':' + (src.coin || src.sym));
  return { lid: book + '|' + (src.signalId || id + '@' + at.slice(0, 16)), book, profile: BOOKS[book].profile, id, coin: src.coin || src.sym, chain: src.chain, pool: src.pool, net: src.net, setup: BOOKS[book].short, signalAt: src.signalAt || at,
    priceAtSignal: r6(px), liq: num(src.liq ?? (src.m && src.m.liq)), status: 'waiting for entry', checkedAt: at, why: extra.why || src.why || null, from: src.signalId || null, ...extra };
}

// ---------- scalp rules on 5-minute candles ----------
const ema = (v, n) => { const k = 2 / (n + 1), o = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o.push(e); } return o; };
function rsi(c, n = 14) { const o = Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
  if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
// bars: 5-minute [t,o,h,l,c,v] ascending. Only candles that have closed by nowSec count, and the trigger candle must have closed in the last 10 minutes
// (the scan decides once an hour, so a trigger from earlier would already be stale).
export function scalpSignals(bars, nowSec, row = {}) {
  const B = (bars || []).map((b) => b.slice(0, 6).map(Number)).filter((b) => b.every((x) => isFinite(x)) && b[0] + 300 <= nowSec);
  if (B.length < 40) return [];
  const k = B.length - 1, b = B[k]; if (nowSec - (b[0] + 300) > 600) return [];
  const C = B.map((x) => x[4]), E = ema(C, 20), R = rsi(C, 14), avgV = B.slice(k - 24, k).reduce((a, x) => a + x[5], 0) / 24, [, o, h, l, c, v] = b, rng = h - l, out = [];
  const prevHi = Math.max(...B.slice(k - 12, k).map((x) => x[2]));
  if (c > prevHi && avgV > 0 && v >= 2 * avgV && rng > 0 && (c - l) / rng >= 0.6 && c <= E[k] * 1.06 && E[k] > E[k - 6] && c / B[k - 12][1] - 1 <= 0.25)
    out.push({ book: 'scalpBreak', why: [`5m close ${((c / prevHi - 1) * 100).toFixed(1)}% above the last hour's high`, `volume ${(v / avgV).toFixed(1)}x normal`, 'uptrend on the 20-candle average'] });
  if ((num(row.ch24) ?? 0) > 0 && l <= E[k] * 0.95 && R[k] != null && R[k] < 30 && avgV > 0 && v >= 1.5 * avgV && rng > 0 && c >= l + 0.5 * rng && E[k] >= E[Math.max(0, k - 12)] * 0.97)
    out.push({ book: 'scalpDip', why: [`flushed ${((1 - l / E[k]) * 100).toFixed(1)}% below the 20-candle average`, `RSI ${R[k].toFixed(0)}`, `volume ${(v / avgV).toFixed(1)}x normal`, 'closed off its low'] });
  return out;
}
// Which coins the scalper looks at: liquid enough to get in and out, ranked by how hard volume is running right now.
export function scalpCandidates(rows, n = 6, skipPools = new Set()) {
  return (rows || []).filter((p) => p && num(p.price) > 0 && p.rug !== 'danger' && (num(p.liq) ?? 0) >= 150000 && (num(p.v24) ?? 0) >= 750000 && !skipPools.has(p.pool))
    .sort((a, b) => (num(b.vacc) ?? 0) - (num(a.vacc) ?? 0)).slice(0, n);
}

// ---------- lifecycle phase (from the playbooks: too early, sweet spot, fading) ----------
export function lifecycle(p) {
  const age = num(p && p.ageD); if (age != null && age < 3) return 'new (under 3 days)';
  const dv = p && Array.isArray(p.dv) ? p.dv : null, prev = dv ? Math.max(...dv.slice(1, 7)) : null;
  if ((dv && prev > 0 && dv[0] < 0.4 * prev && (num(p.ch7d) ?? 0) < 0) || (num(p.ch7d) ?? 0) < -50) return 'fading';
  return 'sweet spot';
}

// ---------- first Fibonacci pullback (hourly candles, wick to wick) ----------
// The run: lowest low in the last 7 days before the highest high, the high made in the last 48 hours, at least +50%.
// Still a FIRST pullback: nothing since the high has traded below the 0.618 level. Limit at 0.5 (or 0.618 if price is already under 0.5).
// Stop 7% under the 0.786 level (memes overshoot). Targets: the old high, the 1.272 and 1.618 extensions of the run.
export function fibSetup(h1, nowSec, minGain = 0.5) {
  const B = (h1 || []).filter((b) => b && +b[0] + 3600 <= nowSec).slice(-168); if (B.length < 24) return null;
  let ih = 0; for (let i = 0; i < B.length; i++) if (+B[i][2] >= +B[ih][2]) ih = i;
  if (B.length - 1 - ih > 48) return null; let il = 0; for (let i = 0; i <= ih; i++) if (+B[i][3] < +B[il][3]) il = i;
  const H = +B[ih][2], L = +B[il][3]; if (!(L > 0) || H / L - 1 < minGain || ih - il < 4) return null;
  const lv = (x) => H - x * (H - L), after = B.slice(ih + 1), lowAfter = after.length ? Math.min(...after.map((b) => +b[3])) : H, c = +B[B.length - 1][4];
  if (lowAfter < lv(0.618)) return null; // already went deeper than the golden zone: not a clean first pullback
  let limit = null, lvl = null; if (c > lv(0.5) * 1.01) { limit = lv(0.5); lvl = '0.5'; } else if (c > lv(0.618) * 1.01) { limit = lv(0.618); lvl = '0.618'; } else return null;
  const stop = lv(0.786) * 0.93, ext = (x) => L + x * (H - L);
  return { limit: r6(limit), stop: r6(stop), targets: [[r6(H), 0.3], [r6(ext(1.272)), 0.3], [r6(ext(1.618)), 0.2]], expireH: 48, cancelAbove: r6(H * 1.02), cancelWhy: 'cancelled (new high before the pullback)',
    hiAt: new Date(B[ih][0] * 1000).toISOString().slice(0, 13), gain: +((H / L - 1) * 100).toFixed(0), why: [`ran ${((H / L - 1) * 100).toFixed(0)}% in ${ih - il} hours`, `limit at the ${lvl} retrace`, `stop under 0.786`] };
}

// ---------- inside the pattern (4h patterns that are still forming) ----------
export const INSIDE = ['Falling wedge', 'Bull flag', 'Double bottom', 'Inverse H&S', 'Cup & handle'];
export function insideSetup(p) {
  const price = num(p && (p.lastClose ?? p.price)), out = [];
  for (const q of (p && p.pats) || []) {
    if (!INSIDE.includes(q.name) || q.status !== 'forming' || !(q.quality >= 55) || !q.plan) continue;
    const trig = +q.trigger, sb = +q.stopBase, stop = +q.plan.stop, H = +q.H, rng = trig - sb; if (!(rng > 0) || !(stop < sb) || !(price > 0) || price >= trig) continue;
    let limit = sb + 0.33 * rng; if (price < limit) limit = price; if (!(limit > stop)) continue;
    if ((trig - limit) / (limit - stop) < 0.8) continue; // too little room to the breakout line for the risk
    out.push({ name: q.name, quality: q.quality, plan: { limit: r6(limit), stop: r6(stop), targets: [[r6(trig), 0.5], [r6(trig + 0.5 * H), 0.25], [r6(trig + H), 0.25]], expireH: 72, cancelAbove: r6(trig), cancelWhy: 'cancelled (broke out before the entry filled)' },
      why: [`${q.name} forming (quality ${q.quality})`, `bid the lower third, breakout line ${r6(trig)}`] });
  }
  return out.sort((a, b) => b.quality - a.quality);
}
