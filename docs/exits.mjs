// Exit engine and paper account, shared by the scanner (Node) and the dashboard (browser).
// One rule set for every paper book: a stop, a ladder of take-profits (sell part of the position at each level),
// an optional trailing stop on what is left, an optional move of the stop to break-even after the first take-profit,
// and a time limit. The same code replays a trade on hourly or 5-minute candles.
// Paper money only. Nothing here places an order.

const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
const r6 = (x) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(6));
const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 16) + 'Z';

// Exit profiles. stopPct: stop below the entry price. ladder: [multiple of entry, share of the ORIGINAL position sold there].
// trailPct: trailing stop below the highest price, switched on after the first take-profit (trailFrom: 'first') or from entry ('start').
// beAfterFirst: stop moves up to the entry price once the first take-profit is banked. maxHours: everything left is sold after this.
// slipPct: entry slippage %. exitSlipPct: slippage % on every sale. sizeUsd: order size used for the price-impact estimate (size / liquidity).
export const PROFILES = {
  degen: { label: 'Current degen: stop 20%, half at 2x, rest trails 30%', stopPct: 0.20, ladder: [[2, 0.5]], trailPct: 0.30, trailFrom: 'first', beAfterFirst: true, maxHours: 72, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  ladder: { label: 'Ladder: stop 25%, sell 25% at 1.5x, 2x and 3x, last 25% trails 35%', stopPct: 0.25, ladder: [[1.5, 0.25], [2, 0.25], [3, 0.25]], trailPct: 0.35, trailFrom: 'first', beAfterFirst: true, maxHours: 120, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  moon: { label: 'Moonbag: stop 25%, half at 2x, 25% at 4x, last 25% trails 45% for up to 7 days', stopPct: 0.25, ladder: [[2, 0.5], [4, 0.25]], trailPct: 0.45, trailFrom: 'first', beAfterFirst: true, maxHours: 168, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  tight: { label: 'Tight: stop 12%, half at 1.3x, rest trails 15%, 48 hours', stopPct: 0.12, ladder: [[1.3, 0.5]], trailPct: 0.15, trailFrom: 'first', beAfterFirst: true, maxHours: 48, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  consRisky: { label: 'Careful: stop 10%, 40% at +15%, 30% at +30%, rest trails 10%, 24 hours', stopPct: 0.10, ladder: [[1.15, 0.4], [1.3, 0.3]], trailPct: 0.10, trailFrom: 'first', beAfterFirst: true, maxHours: 24, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  riskyRyan: { label: "Ryan's setup: stop 20%, sell 30% at +69%, 30% at +150%, the last 40% at +260%, 7 days", stopPct: 0.20, ladder: [[1.69, 0.3], [2.5, 0.3], [3.6, 0.4]], trailPct: null, trailFrom: null, beAfterFirst: false, maxHours: 168, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  riskyPick: { label: "Claude's setup: stop 18%, 25% at +40% then stop to break-even, 25% at 2x, 25% at 3x, last 25% trails 35%, 5 days", stopPct: 0.18, ladder: [[1.4, 0.25], [2, 0.25], [3, 0.25]], trailPct: 0.35, trailFrom: 'first', beAfterFirst: true, maxHours: 120, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  fibPull: { label: 'Fib pullback: limit buy at the 0.5 retrace, stop 7% under the 0.786 level, sell 30% at the old high, 30% at the 1.272 extension, 20% at 1.618, last 20% trails 30%, 5 days', stopPct: 0.25, ladder: [[1.33, 0.3], [1.5, 0.3], [1.75, 0.2]], trailPct: 0.30, trailFrom: 'first', beAfterFirst: true, maxHours: 120, slipPct: 2, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  patInside: { label: 'Inside the pattern: limit buy in the lower third, stop under the pattern low, sell half at the breakout line, 25% at half the pattern height above it, 25% at the full height, 7 days', stopPct: 0.15, ladder: [[1.2, 0.5], [1.3, 0.25], [1.4, 0.25]], trailPct: null, trailFrom: null, beAfterFirst: true, maxHours: 168, slipPct: 2, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  degenFlow: { label: 'Current degen exits, plus a cut on sellers: when the trade is 8%+ under the entry price AND sellers take over (1.2x more wallets selling than buying with money flowing out on the hourly read, or 1.2x more sells than buys in the last hour and more sells in the last 5 minutes on the 15-minute check), sell everything', stopPct: 0.20, ladder: [[2, 0.5]], trailPct: 0.30, trailFrom: 'first', beAfterFirst: true, maxHours: 72, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600, flowCut: { lossPct: 0.08, sellX: 1.2 } },
  // the execution stack (the bot's exits): stop under the flush low (5% minimum), a third at +1R then stop to break-even, ride free at 2x,
  // the rest on a 25% trail until free and then on a 50% giveback of the best 15-minute close; out early if it never reaches +1R in
  // 6 hours or volume dies. Replayed on 15-minute candles.
  exec: { label: 'Execution stack: stop under the flush low (at least 5%), sell a third at +1R and move the stop to break-even, ride free at 2x (sell enough to get the stake back), trail the rest 25% under the high until free, then 50% under the best close; out after 6 hours without +1R, or when volume dies; 3 days max', stopPct: 0.08, ladderR: [[1, 1 / 3]], rideFree: { at: 2 }, giveback: 0.5, trailPct: 0.25, trailFrom: 'first', beAfterFirst: true, noFollow: { h: 6, upR: 1 }, volDeath: { ratio: 0.2 }, maxHours: 72, slipPct: 2, exitSlipPct: 0.5, sizeUsd: 1000, barSec: 900 },
  // study exits: a wide floor 40% under the entry, ride free at 2x, then out when a 15-minute candle closes 50% under the best close
  brk: { label: 'As backtested: the pattern plan stop, a third at TP1 (stop to break-even), a third at TP2, the rest at TP3, 7 days; 1.5% round-trip costs', stopPct: 0.2, ladder: [], trailPct: null, trailFrom: null, beAfterFirst: true, maxHours: 168, slipPct: 0.75, exitSlipPct: 0.75, barSec: 3600 },
  study: { label: 'Study exits: stop 40% under the entry, ride free at 2x (sell enough to get the stake back), the rest rides until a 15-minute candle closes 50% under its best close, 7 days max', stopPct: 0.40, ladder: [], rideFree: { at: 2 }, giveback: 0.5, trailPct: null, trailFrom: null, beAfterFirst: false, maxHours: 168, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 900 },
  proven: { label: 'Proven wallets: stop 20%, half out at 2x (initial back), 25% at 3x, last 25% trails 35%, 5 days', stopPct: 0.20, ladder: [[2, 0.5], [3, 0.25]], trailPct: 0.35, trailFrom: 'first', beAfterFirst: true, maxHours: 120, slipPct: 3, exitSlipPct: 0, sizeUsd: 1000, barSec: 3600 },
  pulse: { label: 'Early pulse: stop 10%, 30% at +20% then stop to break-even, 30% at +50%, last 40% trails 20%, 12 hours', stopPct: 0.10, ladder: [[1.2, 0.3], [1.5, 0.3]], trailPct: 0.20, trailFrom: 'first', beAfterFirst: true, maxHours: 12, slipPct: 1.5, exitSlipPct: 0.5, sizeUsd: 500, barSec: 300 },
  pulseFlush: { label: 'Early pulse, buy the flush: limit buy 6% under the alert price, stop 10% under the fill, 30% at +20% then stop to break-even, 30% at +50%, last 40% trails 20%; cancelled if it runs 25% without dipping or after 3 hours; 12 hours max', stopPct: 0.10, ladder: [[1.2, 0.3], [1.5, 0.3]], trailPct: 0.20, trailFrom: 'first', beAfterFirst: true, maxHours: 12, slipPct: 0.5, exitSlipPct: 0.5, sizeUsd: 500, barSec: 300 },
  spike: { label: 'Buyer spike: stop 12%, 30% at +25% then stop to break-even, 30% at +60%, last 40% trails 25%, 48 hours', stopPct: 0.12, ladder: [[1.25, 0.3], [1.6, 0.3]], trailPct: 0.25, trailFrom: 'first', beAfterFirst: true, maxHours: 48, slipPct: 2, exitSlipPct: 0.5, sizeUsd: 1000, barSec: 3600 },
  scalpBreak: { label: 'Scalp breakout: stop 4%, half at +4%, rest at +8% or trails 3%, 2 hours', stopPct: 0.04, ladder: [[1.04, 0.5], [1.08, 0.5]], trailPct: 0.03, trailFrom: 'first', beAfterFirst: true, maxHours: 2, slipPct: 1, exitSlipPct: 1, sizeUsd: 500, barSec: 300 },
  scalpDip: { label: 'Scalp dip-buy: stop 5%, all out at +5%, 90 minutes', stopPct: 0.05, ladder: [[1.05, 1]], trailPct: null, trailFrom: null, beAfterFirst: false, maxHours: 1.5, slipPct: 1, exitSlipPct: 1, sizeUsd: 500, barSec: 300 },
};
const mx = (m) => (Math.round(m * 100) / 100) + 'x';

// Optional loss reducers (tested side by side, never switched on for a book by themselves):
//   s.cut = { at, px?, why }: an exit decided outside the candles (sellers took over). With a price it sells there on the candle that
//     contains that moment (unless that candle already hit the stop); without one it sells at the next candle's open.
//   P.sellCandle = { volX, lowPct, dropPct, lossPct, look }: a closed candle that drops dropPct+, closes in the bottom lowPct of its range
//     on volX times the average volume of the previous `look` candles, while the trade is lossPct+ under entry: sell at the next open.
//   P.volDeath = { ratio }: volume has died: the last 6 hourly candles traded less than `ratio` of the 24-hour pace (24h volume / 4). Sell at the next open.
//   P.noFollow = { h, upPct }: after h hours, if the trade never got upPct above entry, has sold nothing and is under entry: sell at the next open.
//   P.rideFree = { at }: when price reaches `at` times the entry, sell just enough to get the whole stake back ("ride free"); from then on
//     the position cannot lose money, so the hard stop is dropped and the rest rides on the giveback line (or the time limit).
//   P.giveback = x: the rest is sold when a candle CLOSES x under the best close since entry (confirmed price under the confirmed peak).
//     Active after riding free, or from the start with givebackFrom: 'start'.
//   P.ladderR = [[r, share]]: take-profits in multiples of the trade's own risk (+1R = entry plus the stop distance).
//   s.fill = { px, at }: the entry is already known (a trigger found on 5-minute candles): the trade starts at that price and time.
//   s.stopPx: an explicit stop price for a market or fixed entry (instead of stopPct).
//   Decisions on a candle's close are only taken once that candle has closed (nowIso), so a forming candle never triggers anything.
// Replay one trade. s: { signalAt, liq, plan? }. bars: [t(sec), open, high, low, close, ...] ascending.
// Market entry (no plan): the open of the first candle that starts at or after the signal, plus slippage and price impact.
// Limit entry (s.plan = { limit, stop, targets: [[price, share]], expireH, cancelAbove }): fills when a candle trades down to the limit
// (at the open if it gaps below), expires after expireH hours, and is cancelled if price runs above cancelAbove first. Stop and targets are prices.
// Inside one candle: the time limit is checked first, then the stop (so a candle that touches both the stop and a target counts as a loss),
// then the take-profits. On the candle a limit order fills, only the stop is checked (we cannot know whether the high came before the dip).
// The trailing stop only uses highs of candles that have already closed, so it never reacts to a high and a low inside the same candle.
export function runExit(s, bars, nowIso, prof) {
  const P = { trailFrom: 'first', beAfterFirst: true, exitSlipPct: 0, ...prof }, bsz = P.barSec || 3600, fx = s && s.fill && +s.fill.px > 0 && isFinite(Date.parse(s.fill.at)) ? s.fill : null, pl = !fx && s && s.plan && +s.plan.limit > 0 ? s.plan : null;
  const t0 = fx ? Date.parse(fx.at) / 1000 : Date.parse(s && s.signalAt) / 1000;
  const B = (Array.isArray(bars) ? bars : []).filter((b) => b && (fx ? +b[0] + bsz > t0 : +b[0] >= t0) && [b[1], b[2], b[3], b[4]].every((v) => isFinite(+v) && +v > 0)).map((b) => b.slice(0, 6).map(Number));
  const out = { checkedAt: nowIso };
  if (!isFinite(t0) || !B.length) return { ...out, status: 'waiting for entry' };
  if (+bars[0][0] > t0 + bsz) return { ...out, status: 'waiting for entry', gap: true }; // the candles on hand start after the signal, so the trade cannot be replayed faithfully
  const liq = num(s.liq), imp = liq && liq > 0 ? Math.min(0.5, (P.sizeUsd || 0) / liq) : 0, cut = imp + (P.exitSlipPct || 0) / 100, eff = (x) => x * (1 - cut);
  let k0 = 0, base = B[0][1];
  if (pl) { let k = -1, why = null, at = null;
    for (let i = 0; i < B.length; i++) { const [t, o, h, l] = B[i];
      if (pl.expireH && t > t0 + pl.expireH * 3600) { why = 'expired (no fill)'; at = t; break; }
      if (pl.cancelAbove && o >= pl.cancelAbove) { why = pl.cancelWhy || 'cancelled (ran before the entry filled)'; at = t; break; }
      if (l <= pl.limit) { k = i; break; }
      if (pl.cancelAbove && h >= pl.cancelAbove) { why = pl.cancelWhy || 'cancelled (ran before the entry filled)'; at = t; break; } }
    if (k < 0) return { ...out, status: why || 'waiting for entry', closedAt: why ? iso(at) : null };
    k0 = k; base = Math.min(B[k][1], pl.limit); }
  if (fx) base = +fx.px;
  const F = base * (1 + (P.slipPct || 0) / 100 + imp), E0 = fx ? t0 : B[k0][0];
  let stopNow = pl ? +pl.stop : +s.stopPx > 0 ? +s.stopPx : F * (1 - P.stopPct); if (!(stopNow < F)) return { ...out, status: 'invalid plan', closedAt: iso(E0) };
  const tg = !pl && Array.isArray(s && s.targets) && s.targets.length ? s.targets : null; // absolute targets on a row that filled by trigger
  const ladder = pl && Array.isArray(pl.targets) && pl.targets.length ? pl.targets.filter(([px]) => px > F).map(([px, f]) => [px / F, f]) : tg ? tg.filter(([px]) => px > F).map(([px, f]) => [px / F, f]) : P.ladderR ? P.ladderR.map(([r, f]) => [1 + r * (F - stopNow) / F, f]) : (P.ladder || []).map(([m, f]) => [m, f]);
  const stop0 = stopNow; let lo = Math.min(F, B[k0][3]), hi = F, hiT = F, rem = 1, hits = 0, trailOn = P.trailFrom === 'start' && P.trailPct > 0, status = 'open', closedAt = null, last = B[k0][4], free = false, peakC = F;
  let gotRaw = 0; const fills = [], sell = (t, level, frac, why) => { const f = Math.min(frac, rem); if (f <= 1e-9) return; rem = Math.max(0, rem - f); gotRaw += f * eff(level); fills.push({ t: iso(t), level: r6(level), px: r6(eff(level)), frac: +f.toFixed(4), why }); };
  const lbl = (k) => (pl || tg ? 'target ' + k : mx(ladder[k - 1][0]));
  const bs = P.barSec || 3600, nowS = isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) / 1000 : Infinity, cutT = s && s.cut && isFinite(Date.parse(s.cut.at)) ? Date.parse(s.cut.at) / 1000 : null, cutPx = cutT != null && +s.cut.px > 0 ? +s.cut.px : null;
  const VT = new Map(), VA = (Array.isArray(bars) ? bars : []).map((b, j) => { VT.set(+b[0], j); return +b[5]; }), volAvg = (t, n) => { const j = VT.get(t); if (j == null || j < n) return null; const a = VA.slice(j - n, j).filter((x) => isFinite(x) && x >= 0); return a.length >= n / 2 ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  let pend = null;
  for (let i = k0; i < B.length; i++) {
    const [t, o, h, l, c, v] = B[i], fillBar = (pl || fx) && i === k0; last = c;
    if (t > E0 + P.maxHours * 3600) { sell(t, c, rem, 'time'); status = `time exit (${P.maxHours} hours)`; closedAt = t; break; }
    if (pend) { sell(t, o, rem, pend.why); status = pend.status; closedAt = t; pend = null; break; }
    if (cutT != null && cutPx == null && cutT >= E0 && t >= cutT) { sell(t, o, rem, 'cut'); status = 'cut early: sellers took over'; closedAt = t; break; }
    if (trailOn) stopNow = Math.max(stopNow, hiT * (1 - P.trailPct));
    if (l <= stopNow) { lo = Math.min(lo, l); const px = Math.min(stopNow, fillBar ? F : o); sell(t, px, rem, hits ? (trailOn ? 'trail' : 'breakeven') : 'stop');
      status = !hits ? 'stopped out' : trailOn ? `trailed out after ${lbl(hits)}` : `stopped at break-even after ${lbl(hits)}`; closedAt = t; break; }
    if (cutPx != null && cutT >= E0 && cutT < t + bs) { sell(t, cutT >= t ? cutPx : Math.min(cutPx, o), rem, 'cut'); status = 'cut early: sellers took over'; closedAt = t; break; }
    if (!fillBar) while (hits < ladder.length && h >= F * ladder[hits][0]) {
      sell(t, F * ladder[hits][0], ladder[hits][1], 'tp' + (hits + 1)); hits++;
      if (hits === 1) { if (P.beAfterFirst) stopNow = Math.max(stopNow, F); if (P.trailFrom === 'first' && P.trailPct > 0) { trailOn = true; hiT = Math.max(F, F * ladder[0][0]); } }
    }
    if (P.rideFree && !free && !fillBar && rem > 1e-9 && h >= F * P.rideFree.at) { const need = Math.max(0, 1 - gotRaw / F) / (P.rideFree.at * (1 - cut)); sell(t, F * P.rideFree.at, need, 'ridefree'); free = true; stopNow = 0; trailOn = false; }
    if (rem <= 1e-9) { status = free ? 'all sold at the ride-free level' : 'all targets hit'; closedAt = t; break; }
    hi = Math.max(hi, h); lo = Math.min(lo, l); if (trailOn) hiT = Math.max(hiT, h);
    if (t + bs <= nowS) { const sc = P.sellCandle, nf = P.noFollow;
      if (sc && c < o && h > l && (c - l) / (h - l) <= sc.lowPct && (o - c) / o >= sc.dropPct && c <= F * (1 - sc.lossPct)) { const a = volAvg(t, sc.look || 12); if (a > 0 && v >= sc.volX * a) pend = { why: 'sellers', status: 'cut early: heavy selling candle' }; }
      if (!pend && nf && hits === 0 && !free && t + bs - E0 >= nf.h * 3600 && hi < F * (1 + (nf.upR != null ? nf.upR * (F - stop0) / F : nf.upPct)) && c < F) pend = { why: 'time', status: `cut early: no follow-through after ${nf.h} hours` };
      if (!pend && P.volDeath) { const j = VT.get(t), n6 = Math.round(6 * 3600 / bs), n24 = Math.round(24 * 3600 / bs); if (j != null && j >= n24 - 1) { const s6 = VA.slice(j - n6 + 1, j + 1).reduce((a, x) => a + (isFinite(x) ? x : 0), 0), s24 = VA.slice(j - n24 + 1, j + 1).reduce((a, x) => a + (isFinite(x) ? x : 0), 0); if (s24 > 0 && s6 / (s24 / 4) < P.volDeath.ratio) pend = { why: 'volume', status: `volume died (6h volume under ${Math.round(P.volDeath.ratio * 100)}% of the 24h pace)` }; } }
      if (!fillBar) peakC = Math.max(peakC, c);
      if (!pend && P.giveback && (free || P.givebackFrom === 'start') && c <= peakC * (1 - P.giveback)) pend = { why: 'giveback', status: `giveback: closed ${Math.round(P.giveback * 100)}% under the best close (${mx(peakC / F)})${free ? ' while riding free' : ''}` }; }
  }
  const open = status === 'open', ret = open ? gotRaw / F + rem * eff(last) / F - 1 : gotRaw / F - 1;
  return { ...out, status, entryAt: iso(E0), entryPx: r6(F), slipUsed: +((P.slipPct || 0) + imp * 100).toFixed(1), impactPct: +(imp * 100).toFixed(2), fills, rem: +rem.toFixed(4), tpHit: hits,
    stop0: r6(stop0), stopNow: r6(stopNow), stopNet: r6(eff(stopNow)), lastPx: r6(last), markPx: r6(eff(last)), hiPx: r6(hi), loPx: r6(lo), peakPct: +((hi / F - 1) * 100).toFixed(0), mfePct: +((hi / F - 1) * 100).toFixed(1), maePct: +((1 - lo / F) * 100).toFixed(1),
    retX: +ret.toFixed(6), retPct: open ? null : +(ret * 100).toFixed(1), openRet: open ? +(ret * 100).toFixed(1) : null, closedAt: closedAt ? iso(closedAt) : null, free, peakClosePct: +((peakC / F - 1) * 100).toFixed(1), ...(open && pend ? { pendingExit: pend.status } : {}) };
}

// Dead pool: the pool stopped giving candles (rugged, delisted or migrated) for several scans in a row while the data feed itself
// worked. Whatever is still held is closed at DEAD_HAIRCUT of the last price seen and labelled, so dead coins count as losses instead
// of staying open forever or dropping out of the results (which would flatter every book).
export const DEAD_HAIRCUT = 0.5;
export function deadExit(x, nowIso) {
  const E = num(x && x.entryPx) ?? num(x && x.entryMid); if (!(E > 0)) return { ...x, checkedAt: nowIso, status: 'no data' };
  const fills = Array.isArray(x.fills) ? x.fills.slice() : (+x.tpHit > 0 && num(x.tp1) ? [{ t: x.checkedAt, level: num(x.tp1), px: num(x.tp1), frac: 0.5, why: 'tp1' }] : []);
  const sold = fills.reduce((a, f) => a + (+f.frac || 0), 0), rem = Math.max(0, x.rem != null && Array.isArray(x.fills) ? +x.rem : 1 - sold), last = num(x.lastPx) > 0 ? num(x.lastPx) : E, px = r6(last * DEAD_HAIRCUT), t = String(nowIso).slice(0, 16) + 'Z';
  if (rem > 1e-9) fills.push({ t, level: px, px, frac: +rem.toFixed(4), why: 'dead' });
  const ret = fills.reduce((a, f) => a + f.frac * f.px, 0) / E - 1;
  return { ...x, entryPx: num(x.entryPx) ?? E, fills, rem: 0, status: 'closed: price data stopped (counted at half the last price)', closedAt: t, checkedAt: nowIso, retX: +ret.toFixed(6), retPct: +(ret * 100).toFixed(1), openRet: null, openR: null, dead: true };
}

// One scan without fresh candles for a row. Counts the miss only while the data feed works; an entered trade is closed by deadExit after
// maxMiss misses in a row; a trade still waiting for entry becomes 'no data' after 48 hours (it never cost anything).
export function missStep(x, nowIso, { feedOk = true, maxMiss = 6, now = Date.now() } = {}) {
  if (!feedOk) return { ...x, checkedAt: nowIso };
  const miss = (+x.miss || 0) + 1, entered = x.status === 'open' && (num(x.entryPx) > 0 || num(x.entryMid) > 0);
  if (entered && miss >= maxMiss) return deadExit({ ...x, miss }, nowIso);
  if (!entered && now - Date.parse(x.signalAt) > 48 * 3600e3) return { ...x, checkedAt: nowIso, status: 'no data', miss };
  return { ...x, checkedAt: nowIso, miss };
}

// Cut on sellers: the first moment after entry when the trade is lossPct+ under the entry price AND sellers have taken over.
// events: wallet reads from the hourly scan { t, b, s, n, p? } (unique wallets buying and selling in the last ~300 trades, net USD, price then)
// and 15-minute DexScreener checks { t, src: 'dex', b1, s1, b5, s5, px } (buys and sells in the last hour and 5 minutes, price then).
// The price used is the one recorded with the event, else the close of the last candle that had closed by then (never a later price).
// Returns { at, px, why } for runExit's s.cut, or null.
export const FLOW_CUT = { lossPct: 0.08, sellX: 1.2 };
export function flowCutEvent(events, bars, entryPx, entryAt, cfg = FLOW_CUT, barSec = 3600) {
  const E = +entryPx, t0 = Date.parse(entryAt || ''); if (!(E > 0) || !isFinite(t0) || !cfg) return null;
  const C = (Array.isArray(bars) ? bars : []).map((b) => [+b[0], +b[4]]).filter((b) => isFinite(b[0]) && b[1] > 0);
  const evs = (Array.isArray(events) ? events : []).filter((e) => e && isFinite(Date.parse(e.t)) && Date.parse(e.t) > t0).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  for (const e of evs) {
    const T = Date.parse(e.t) / 1000, own = +e.px > 0 ? +e.px : +e.p > 0 ? +e.p : null; let px = own;
    if (px == null) for (let i = C.length - 1; i >= 0; i--) if (C[i][0] + barSec <= T) { px = C[i][1]; break; }
    if (!(px > 0) || px > E * (1 - cfg.lossPct)) continue;
    let why = null;
    if (e.src === 'dex') { if (+e.s1 > 0 && +e.s1 >= cfg.sellX * +e.b1 && +e.s5 > +e.b5) why = `${e.s1} sells vs ${e.b1} buys in the last hour and ${e.s5} vs ${e.b5} in the last 5 minutes`; }
    else if (+e.s > 0 && +e.s >= cfg.sellX * +e.b && (e.n == null || +e.n < 0)) why = `${e.s} wallets selling vs ${e.b} buying${e.n != null ? `, $${Math.round(-e.n).toLocaleString('en')} net out` : ''}`;
    if (why) return { at: e.t, px: own, why: `sellers took over: ${why}, ${((1 - px / E) * 100).toFixed(0)}% under entry` };
  }
  return null;
}

// ---------- the bid-ready signal log (R-based, from the main rules) turned into the same position format ----------
// Thirds are sold at TP1, TP2 and TP3. The result in R from the log is the source of truth; the cost line makes the dollars add up to it.
export function fromSignal(s) {
  const lo = num(s.entryLow), hi = num(s.entryHigh), E = num(s.entryPx) ?? num(s.entryMid) ?? (lo != null && hi != null ? (lo + hi) / 2 : null), stop = num(s.stop);
  if (E == null || stop == null || !(E > stop)) return null;
  const risk = E - stop, tps = [num(s.tp1), num(s.tp2), num(s.tp3)], hit = Math.min(3, Math.max(0, +s.tpHit || 0)), base = { key: s.signalId || s.id, src: 'bid', liq: num(s.liq), coin: s.coin, chain: s.chain, pool: s.pool, setup: s.setup, at: s.signalAt, sig: s, ladder: tps.filter((x) => x != null).map((x) => [x / E, 1 / 3]) };
  if (s.status === 'waiting for entry') return { ...base, waiting: true, entryLow: lo, entryHigh: hi, stop, tp1: tps[0] };
  const closed = num(s.resultR) != null && s.status !== 'expired (no fill)' && s.status !== 'invalid plan', open = s.status === 'open' && num(s.openR) != null;
  if (!closed && !open) return null;
  const fills = []; let realR = 0; for (let i = 0; i < hit; i++) if (tps[i] != null) { fills.push({ t: s.closedAt || s.checkedAt || s.signalAt, level: tps[i], px: tps[i], frac: 1 / 3, why: 'tp' + (i + 1) }); realR += (1 / 3) * (tps[i] - E) / risk; }
  const rem = Math.max(0, 1 - fills.length / 3), R = closed ? +s.resultR : +s.openR;
  const stopNow = hit >= 1 ? Math.max(stop, num(s.stopNow) ?? E) : stop;
  let lastPx = num(s.lastPx); if (lastPx == null && rem > 0) lastPx = E + risk * (R - realR) / rem;
  if (closed && rem > 0) { const ex = num(s.exitPx) ?? (E + risk * (R - realR) / rem); fills.push({ t: s.closedAt || s.checkedAt, level: ex, px: ex, frac: rem, why: /stopped/.test(s.status) ? 'stop' : 'time' }); }
  const priceFrac = fills.reduce((a, f) => a + f.frac * f.px, 0) / E + (closed ? 0 : rem * (lastPx ?? E) / E) - 1, costPct = (priceFrac - R * risk / E) * 100; // slippage and fees in the log's R
  const mfePct = num(s.mfeR) != null ? +(s.mfeR * risk / E * 100).toFixed(1) : null, maePct = num(s.maeR) != null ? +(s.maeR * risk / E * 100).toFixed(1) : null;
  return { ...base, status: s.status, open: !closed, costPct, stop0: stop, mfePct, maePct, mkt: { sol: s.regime || null, vol: s.volDay || null }, entryAt: s.filledAt || s.signalAt, entryPx: E, fills, rem: closed ? 0 : rem, stopNow, stopNet: stopNow, lastPx: lastPx ?? E, markPx: lastPx ?? E, tpHit: hit, closedAt: s.closedAt || null, R, riskFrac: risk / E };
}

// A lab or degen row (already replayed by runExit) in the position format.
export function fromRun(s, profKey) {
  const prof = PROFILES[profKey || s.profile] || PROFILES.degen, lad = s.plan && Array.isArray(s.plan.targets) && num(s.entryPx) ? s.plan.targets.filter(([px]) => px > s.entryPx).map(([px, f]) => [px / s.entryPx, f]) : prof.ladder;
  const base = { key: s.lid || s.signalId, src: s.book || profKey || 'degen', liq: num(s.liq), coin: s.coin, chain: s.chain, pool: s.pool, setup: s.setup, at: s.signalAt, sig: s, ladder: lad, trailPct: prof.trailPct };
  if (s.status === 'no data' || /^(expired|cancelled|invalid)/.test(s.status || '')) return null;
  if (s.status === 'waiting for entry' || (!s.entryPx && !num(s.entryMid))) return { ...base, waiting: true, entryLow: num(s.plan ? s.plan.limit : s.entryLow), entryHigh: num(s.plan ? s.plan.limit : s.entryHigh), stop: num(s.plan ? s.plan.stop : s.stop), expireH: s.plan ? s.plan.expireH : null };
  const open = s.status === 'open';
  if (!Array.isArray(s.fills) && num(s.entryMid)) { // degen rows written before the exit engine kept no fills: rebuild them from the stored return
    const E = +s.entryMid, half = (+s.tpHit || 0) > 0 ? [{ t: s.checkedAt, level: num(s.tp1), px: num(s.tp1), frac: 0.5, why: 'tp1' }] : [], rem = half.length ? 0.5 : 1;
    if (!open) return num(s.retPct) == null ? null : { ...base, status: s.status, open: false, stop0: num(s.stop), mfePct: num(s.peakPct), maePct: null, mkt: s.mkt || null, entryAt: s.signalAt, entryPx: E, fills: [{ t: s.closedAt || s.checkedAt, level: E * (1 + s.retPct / 100), px: E * (1 + s.retPct / 100), frac: 1, why: 'legacy' }], rem: 0, tpHit: +s.tpHit || 0, closedAt: s.closedAt };
    const mark = num(s.openRet) == null ? E : (1 + s.openRet / 100 - half.reduce((a, f) => a + f.frac * f.px, 0) / E) * E / rem;
    return { ...base, status: 'open', open: true, stop0: num(s.stop), mkt: s.mkt || null, entryAt: s.signalAt, entryPx: E, fills: half, rem, stopNow: half.length ? E : num(s.stop), stopNet: half.length ? E : num(s.stop), lastPx: mark, markPx: mark, tpHit: +s.tpHit || 0 };
  }
  const stop0 = num(s.stop0) ?? (s.plan ? num(s.plan.stop) : null) ?? num(s.stop) ?? +s.entryPx * (1 - prof.stopPct);
  return { ...base, status: s.status, open, stop0, mfePct: num(s.mfePct) ?? (num(s.hiPx) ? +((s.hiPx / s.entryPx - 1) * 100).toFixed(1) : null), maePct: num(s.maePct), mkt: s.mkt || null, entryAt: s.entryAt || s.signalAt, entryPx: +s.entryPx, fills: Array.isArray(s.fills) ? s.fills : [], rem: open ? +s.rem : 0, stopNow: num(s.stopNow), stopNet: num(s.stopNet) ?? num(s.stopNow), lastPx: num(s.lastPx), markPx: num(s.markPx) ?? num(s.lastPx), tpHit: +s.tpHit || 0, closedAt: s.closedAt || null };
}

// The same positions with no account limits (every recorded signal counts, nothing skipped for full slots or cash). The evidence
// (average R, verdicts, the council) is measured on this, so a book learns from every signal; the account view keeps its slots.
export const statsBook = (positions, { since = null, now = Date.now() } = {}) => book(positions, { start: 1e7, pct: 0.1, slots: 1e5, since, now });

// ---------- paper account ----------
// Every trade is sized at pct% of the account when it enters (cash plus the cost of what is still held). Sales put cash back as they happen.
// At most `slots` trades are held at once; a trade that arrives when every slot is taken is skipped and counted.
// costPct: an extra cost per trade as % of its size (the bid-ready log charges its round-trip slippage this way).
// sizeFn(p, ctx) (optional): replaces the fixed % sizing. Returns { size, why, cut }: size 0 skips the trade (why = reason), cut = which limit made it smaller.
export function book(positions, { start = 10000, pct = 5, slots = 99, since = null, costPct = 0, now = Date.now(), sizeFn = null } = {}) {
  const sinceT = since ? Date.parse(since) : NaN, ts = (x) => { const t = Date.parse(x || ''); return isFinite(t) ? t : null; };
  const list = (positions || []).filter((p) => p && !(isFinite(sinceT) && (ts(p.at) ?? 0) < sinceT));
  const waiting = list.filter((p) => p.waiting), live = list.filter((p) => !p.waiting && p.entryPx > 0 && (ts(p.entryAt) ?? ts(p.at)) != null).map((p) => ({ ...p })); // copies: the same positions can be booked again at another size
  const ev = [];
  for (const p of live) { const t0 = ts(p.entryAt) ?? ts(p.at); ev.push({ t: t0, k: 0, p }); (p.fills || []).forEach((f, i) => ev.push({ t: Math.max(t0, p.open ? Math.min(ts(f.t) ?? now, now) : ts(f.t) ?? ts(p.closedAt) ?? now), k: 1, p, f, last: !p.open && i === p.fills.length - 1 })); if (!p.open && !(p.fills || []).length) ev.push({ t: ts(p.closedAt) ?? t0, k: 1, p, f: null, last: true }); }
  ev.sort((a, b) => a.t - b.t || a.k - b.k);
  let cash = start, held = new Set(), skipped = 0; const curve = [{ t: ev.length ? ev[0].t : now, eq: start }], skipWhy = {}, cutWhy = {}, dayPnl = new Map(), dk = (t) => new Date(t).toISOString().slice(0, 10);
  const equityAtCost = () => cash + [...held].reduce((a, p) => a + p.qty * p.remNow * p.entryPx, 0);
  for (const e of ev) {
    const p = e.p;
    if (e.k === 0) { if (held.size >= slots) { p.skip = true; skipped++; skipWhy['all slots full'] = (skipWhy['all slots full'] || 0) + 1; continue; } let size = Math.min(cash, equityAtCost() * pct / 100);
      if (sizeFn) { const r = sizeFn(p, { t: e.t, equity: equityAtCost(), cash, held: [...held], dayPnl: dayPnl.get(dk(e.t)) || 0 }) || {}; size = Math.min(cash, r.size > 0 ? r.size : 0); if (r.cut && size > 1) cutWhy[r.cut] = (cutWhy[r.cut] || 0) + 1; if (!(size > 1)) { const w = r.why || 'no cash left'; skipWhy[w] = (skipWhy[w] || 0) + 1; } }
      if (!(size > 1)) { p.skip = true; skipped++; if (!sizeFn) skipWhy['no cash left'] = (skipWhy['no cash left'] || 0) + 1; continue; }
      p.size = size; p.qty = size / p.entryPx; p.cost = size * (p.costPct ?? costPct) / 100; p.banked = 0; p.remNow = 1; cash -= size + p.cost; held.add(p); continue; }
    if (p.skip || !held.has(p)) continue;
    if (e.f) { const got = p.qty * e.f.frac * e.f.px; cash += got; p.banked += got; p.remNow = Math.max(0, p.remNow - e.f.frac); }
    if (e.last) { held.delete(p); p.pnl = p.banked - p.size - p.cost; dayPnl.set(dk(e.t), (dayPnl.get(dk(e.t)) || 0) + p.pnl); curve.push({ t: e.t, eq: equityAtCost() }); }
  }
  const trades = live.filter((p) => !p.skip && p.size), out = [];
  let realized = 0, openPnl = 0, openValue = 0, openRisk = 0, openBanked = 0;
  for (const p of trades) {
    const value = p.open ? p.qty * p.rem * (p.markPx ?? p.entryPx) : 0, pnl = p.open ? p.banked + value - p.size - p.cost : p.pnl ?? (p.banked - p.size - p.cost);
    const riskNow = p.open && p.stopNet != null ? Math.max(0, p.qty * p.rem * ((p.markPx ?? p.entryPx) - p.stopNet)) : 0, locked = p.open && p.stopNet != null ? p.banked + p.qty * p.rem * p.stopNet - p.size - p.cost : null;
    const sold = (p.fills || []).reduce((a, f) => a + f.frac, 0), exitAvg = !p.open && sold > 0 ? (p.fills || []).reduce((a, f) => a + f.frac * f.px, 0) / sold : null;
    if (p.open) { openPnl += pnl; openValue += value; openRisk += riskNow; openBanked += p.banked; } else realized += pnl;
    const risk0 = p.stop0 != null && p.entryPx > p.stop0 ? p.size * (p.entryPx - p.stop0) / p.entryPx + (p.cost || 0) : null; // dollars lost if the first stop had hit
    out.push({ ...p, value, pnl, risk0, R: risk0 ? pnl / risk0 : null, pnlPct: p.size ? pnl / p.size * 100 : 0, riskNow, locked, exitAvg, nowPx: p.open ? p.lastPx : null, sharePct: p.size / start * 100 });
  }
  const equity = start + realized + openPnl, check = Math.abs(cash + openValue - equity) < Math.max(0.05, start * 1e-6);
  if (out.some((t) => t.open)) curve.push({ t: now, eq: equity });
  let peak = start, maxDD = 0; for (const c of curve) { peak = Math.max(peak, c.eq); maxDD = Math.max(maxDD, (peak - c.eq) / peak * 100); }
  const done = out.filter((t) => !t.open), wins = done.filter((t) => t.pnl > 0).length; let streak = 0, run = 0;
  done.slice().sort((a, b) => (ts(a.closedAt) ?? 0) - (ts(b.closedAt) ?? 0)).forEach((t) => { if (t.pnl <= 0) { run++; streak = Math.max(streak, run); } else run = 0; });
  out.sort((a, b) => (ts(b.at) ?? 0) - (ts(a.at) ?? 0));
  const bySetup = new Map(); for (const t of out) { const k = t.setup || 'Unknown'; if (!bySetup.has(k)) bySetup.set(k, { setup: k, n: 0, closed: 0, wins: 0, pnl: 0 }); const g = bySetup.get(k); g.n++; g.pnl += t.pnl; if (!t.open) { g.closed++; if (t.pnl > 0) g.wins++; } }
  const peakEq = Math.max(peak, equity), firstAt = out.length ? out.reduce((m, t) => Math.min(m, ts(t.at) ?? m), Infinity) : null;
  return { start, pct, slots, equity, cash, realized, openPnl, openValue, openRisk, openBanked, retPct: (equity / start - 1) * 100, closedN: done.length, openN: out.length - done.length, waitingN: waiting.length, skipped, skipWhy, cutWhy, takenN: out.length,
    wins, winRate: done.length ? wins / done.length : null, avgRet: done.length ? done.reduce((a, t) => a + t.pnlPct, 0) / done.length : null, best: done.length ? Math.max(...done.map((t) => t.pnlPct)) : null, worst: done.length ? Math.min(...done.map((t) => t.pnlPct)) : null,
    losingRun: streak, maxDD, curve, trades: out, waiting: waiting.sort((a, b) => (ts(b.at) ?? 0) - (ts(a.at) ?? 0)), check, peakEq, belowPeakPct: peakEq > 0 ? (peakEq - equity) / peakEq * 100 : 0,
    firstAt: firstAt != null && isFinite(firstAt) ? new Date(firstAt).toISOString() : null, bySetup: [...bySetup.values()].sort((a, b) => b.pnl - a.pnl) };
}
