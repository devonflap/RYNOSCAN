// Setup detectors for the bots that find their own trades from candles (pure: no network, no clock; everything comes in as arguments).
//
// RANGE SCALPER (CSK's Monday-range trade, adapted to coins that trade 24/7: the range is the previous UTC day, not Monday):
//   1 the range closes (previous UTC day's high and low from hourly candles)
//   2 price sweeps the range low (an hourly candle trades under it)
//   3 an hourly candle CLOSES back inside the range
//   4 market structure break on the 15-minute chart: a close above the last swing high (3-bar swings: a high with a lower high each side)
//   5 the break leaves a bullish order block: the last down candle before the move that broke structure
//   6 the entry is a resting limit at the top of that order block (the retest); stop under the order block's body; target the range high
//   Only 3R to 8R setups (under 3R is not worth the risk, over 8R fails too often). Optional: entry in discount (under the midpoint of the
//   low-to-break range). Long only (no shorting on a spot wallet). Everything out at the range high; 24 hours for the retest to come.
//
// IGNITION (Cashmore's Ignition Rider, adapted to meme coins): an hourly candle closes up ignPct% or more on ignVolX times the coin's
//   median hourly volume (over the last 30 days or as much history as it has, 48 hours at least), buyers leading on the hour, the coin not
//   already up more than ignMax24h% in 24 hours (we want to be early, not last), $50k+ liquidity. Market buy at the next check after
//   the close; stop at the trigger candle's low. Exits live in manage.mjs (manageMomentum): trail 25% off the high once up 30%, or a
//   faded red hourly candle, sells 90%; the 10% moonbag trails 45% for up to 7 days.
//
// RUNNER (the paper books in the green so far: Risky coins on Ryan's ladder, plus the seller cut from Degen cut-on-sellers):
//   the scanner's runners that pass at least 3 of the 4 checks with no risk rule tripped, at most 2 new per scan, bought on sight.
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
export const RANGE = { rrMin: 3, rrMax: 8, discount: false, expireH: 24, swept: 72 };
export const IGN = { ignPct: 5, ignVolX: 12, ignMax24h: 150, ignMinHist: 48, ignBuyX: 1.1 };

// bars: [[tSec, open, high, low, close, vol], ...] oldest first. dayStart(nowSec) = 00:00 UTC of the current day.
const dayStart = (t) => Math.floor(t / 86400) * 86400;
export function swings(bars) { const hi = [], lo = []; for (let i = 1; i < bars.length - 1; i++) { if (bars[i][2] > bars[i - 1][2] && bars[i][2] > bars[i + 1][2]) hi.push(i); if (bars[i][3] < bars[i - 1][3] && bars[i][3] < bars[i + 1][3]) lo.push(i); } return { hi, lo }; }

export function rangeSetup(bars1h, bars15, nowSec, cfg = RANGE) {
  if (!Array.isArray(bars1h)) return null; const d0 = dayStart(nowSec), prev = bars1h.filter((b) => b[0] >= d0 - 86400 && b[0] < d0), today = bars1h.filter((b) => b[0] >= d0 && b[0] + 3600 <= nowSec);
  if (prev.length < 20) return { dead: 'not enough of yesterday' }; const rHi = Math.max(...prev.map((b) => b[2])), rLo = Math.min(...prev.map((b) => b[3]));
  let sweepI = -1; for (let i = 0; i < today.length; i++) if (today[i][3] < rLo) { sweepI = i; break; } if (sweepI < 0) return null;
  let backI = -1; for (let i = sweepI; i < today.length; i++) if (today[i][4] > rLo) { backI = i; break; } if (backI < 0) return null;
  if (!Array.isArray(bars15)) return { need15: true, rangeHi: rHi, rangeLo: rLo }; // the hourly part passed: the caller fetches the 15-minute candles and calls again
  const sweepT = today[sweepI][0], since = bars15.filter((b) => b[0] >= sweepT && b[0] + 900 <= nowSec); if (since.length < 6) return null;
  // the lowest low after the sweep is the swing low; structure breaks when a 15-minute close beats the last swing high before that break
  const sw = swings(since), lowI = since.reduce((m, b, i) => (b[3] < since[m][3] ? i : m), 0);
  let msbI = -1, swingHi = null; const highsBefore = sw.hi.filter((h) => h < lowI); const lastHi = highsBefore.length ? highsBefore[highsBefore.length - 1] : null; if (lastHi == null) return null;
  swingHi = since[lastHi][2]; for (let i = lowI + 1; i < since.length; i++) if (since[i][4] > swingHi) { msbI = i; break; } if (msbI < 0) return null;
  // order block: the last down candle between the swing low and the break
  let ob = null; for (let i = msbI; i >= lowI; i--) if (since[i][4] < since[i][1]) { ob = since[i]; break; } if (!ob) return { dead: 'the break left no order block (market noise)' };
  const entry = ob[2], bodyLow = Math.min(ob[1], ob[4]), stop = +(bodyLow * 0.995).toPrecision(6), target = rHi, rr = (target - entry) / (entry - stop);
  if (!(entry > stop) || !(rr > 0)) return null; if (rr < cfg.rrMin) return { dead: `only ${rr.toFixed(1)}R to the range high: under ${cfg.rrMin}R` }; if (rr > cfg.rrMax) return { dead: `${rr.toFixed(1)}R to the range high: over ${cfg.rrMax}R, too far to be real` };
  const mid = (since[lowI][3] + since[msbI][2]) / 2; if (cfg.discount && entry > mid) return { dead: 'order block is above the midpoint: not in discount' };
  return { zoneLow: +bodyLow.toPrecision(6), zoneHigh: +entry.toPrecision(6), stop, tp1: +target.toPrecision(6), rr: +rr.toFixed(2), rangeHi: rHi, rangeLo: rLo, sweepAt: sweepT, msbAt: since[msbI][0], discount: entry <= mid, expireH: cfg.expireH,
    why: [`swept yesterday's low ${rLo} and closed back inside`, `15-minute structure break at ${swingHi}`, `order block ${bodyLow}-${entry}`, `${rr.toFixed(1)}R to the range high ${rHi}`] };
}

// bars1h: hourly candles oldest first, the last one may still be forming (ignored unless closed). q: DexScreener pair (txns.h1, priceChange.h24, liquidity).
export function ignitionSetup(bars1h, q, nowSec, cfg = IGN) {
  if (!Array.isArray(bars1h)) return null; const closed = bars1h.filter((b) => b[0] + 3600 <= nowSec); if (closed.length < (cfg.ignMinHist || 48) + 1) return null;
  const t = closed[closed.length - 1], hist = closed.slice(Math.max(0, closed.length - 721), closed.length - 1).map((b) => b[5] || 0).filter((v) => v > 0).sort((a, b) => a - b);
  if (hist.length < cfg.ignMinHist) return null; const med = hist[Math.floor(hist.length / 2)], ret = (t[4] / t[1] - 1) * 100, volX = med > 0 ? t[5] / med : 0;
  if (ret < cfg.ignPct || volX < cfg.ignVolX) return null;
  const h1 = (q && q.txns && q.txns.h1) || {}, buys = +h1.buys || 0, sells = +h1.sells || 0, ch24 = n(q && q.priceChange && q.priceChange.h24);
  if (sells > 0 && buys < sells * cfg.ignBuyX) return { dead: `candle fired but sellers lead the hour (${buys} buys vs ${sells} sells)` };
  if (ch24 != null && ch24 > cfg.ignMax24h) return { dead: `already up ${Math.round(ch24)}% in 24 hours: too late to be early` };
  return { zoneLow: +t[4].toPrecision(6), zoneHigh: +t[4].toPrecision(6), stop: +t[3].toPrecision(6), trigAt: t[0], trigVol: t[5], volX: +volX.toFixed(1), retPct: +ret.toFixed(1), ch24,
    why: [`hourly candle closed +${ret.toFixed(1)}% on ${volX.toFixed(0)}x the usual hourly volume`, `${buys} buys vs ${sells} sells in the hour`, ch24 != null ? `${ch24 >= 0 ? '+' : ''}${Math.round(ch24)}% in 24 hours` : null].filter(Boolean) };
}

// RUNNER, every minute (DexScreener only): the scanner's two live checks plus its risk rules, so the runner of the day is caught within a
// minute of starting, not at the next four-hourly scan. Volume surge: the last hour's volume at least surgeX times the 24-hour hourly
// pace. Buyers leading: buys at least buyX times sells in the hour. Moving: up in the hour and in the last 5 minutes, not already up
// more than max24h in a day. Liquidity, age and the 72-hour cooldown are applied by the bot.
export const RUN = { surgeX: 2.5, buyX: 1.15, minH1Pct: 3, maxH1Pct: 60, max24h: 150, minH1Usd: 25000 };
export function runnerLive(q, cfg = RUN) {
  if (!q || !(+q.priceUsd > 0)) return null; const v = q.volume || {}, h1 = +v.h1 || 0, h24 = +v.h24 || 0, pace = h24 / 24, t1 = (q.txns && q.txns.h1) || {}, b = +t1.buys || 0, s = +t1.sells || 0, pc = q.priceChange || {}, c1 = n(pc.h1), c5 = n(pc.m5), c24 = n(pc.h24);
  if (!(pace > 0) || h1 < cfg.minH1Usd) return null; const surge = h1 / pace; if (surge < cfg.surgeX) return null;
  if (!(b > 0) || b < s * cfg.buyX) return null; if (c1 == null || c1 < cfg.minH1Pct) return null;
  if (c1 > cfg.maxH1Pct) return { dead: `already up ${Math.round(c1)}% in the hour: vertical, no entry` }; if (c24 != null && c24 > cfg.max24h) return { dead: `already up ${Math.round(c24)}% in 24 hours: too late` }; if (c5 != null && c5 < 0) return null;
  return { price: +q.priceUsd, surge: +surge.toFixed(1), buyRatio: s > 0 ? +(b / s).toFixed(2) : null, c1, c24, why: [`volume ${surge.toFixed(1)}x the 24-hour pace`, `${b} buys vs ${s} sells in the hour`, `+${c1.toFixed(1)}% in the hour${c24 != null ? `, ${c24 >= 0 ? '+' : ''}${Math.round(c24)}% in 24h` : ''}`] };
}
// why the minute scan said no to a coin (for the missed-runner review: which gate stood in the way of a coin that then ran)
export function runnerWhyNot(q, cfg = RUN) {
  if (!q || !(+q.priceUsd > 0)) return { gate: 'no quote', why: 'no DexScreener quote' }; const v = q.volume || {}, h1 = +v.h1 || 0, h24 = +v.h24 || 0, pace = h24 / 24, t1 = (q.txns && q.txns.h1) || {}, b = +t1.buys || 0, s = +t1.sells || 0, pc = q.priceChange || {}, c1 = n(pc.h1), c5 = n(pc.m5), c24 = n(pc.h24);
  if (!(pace > 0) || h1 < cfg.minH1Usd) return { gate: 'hourly volume', why: `only $${Math.round(h1 / 1000)}k traded in the hour (needs $${Math.round(cfg.minH1Usd / 1000)}k)` };
  const surge = h1 / pace; if (surge < cfg.surgeX) return { gate: 'volume surge', why: `hourly volume ${surge.toFixed(1)}x the 24-hour pace (needs ${cfg.surgeX}x)` };
  if (!(b > 0) || b < s * cfg.buyX) return { gate: 'buyers leading', why: `${b} buys vs ${s} sells in the hour (needs ${cfg.buyX}x)` };
  if (c1 == null || c1 < cfg.minH1Pct) return { gate: 'moving', why: `${c1 == null ? 'no' : c1.toFixed(1) + '%'} change in the hour (needs +${cfg.minH1Pct}%)` };
  if (c1 > cfg.maxH1Pct) return { gate: 'too vertical', why: `already up ${Math.round(c1)}% in the hour (cap ${cfg.maxH1Pct}%)` };
  if (c24 != null && c24 > cfg.max24h) return { gate: 'too late (24h)', why: `already up ${Math.round(c24)}% in 24 hours (cap ${cfg.max24h}%)` };
  if (c5 != null && c5 < 0) return { gate: 'red 5 minutes', why: `${c5.toFixed(1)}% in the last 5 minutes` };
  return { gate: 'none', why: 'passed every gate (the cap of new entries a minute, or the cooldown, or it was seen too late)' };
}
// THE MINUTE BOT's looser scan (research: catch more, learn what rugs): volume 1.8x the pace, buyers barely leading, up 2% to 120% in the hour, up to 400% in a day
export const MIN = { surgeX: 1.8, buyX: 1.05, minH1Pct: 2, maxH1Pct: 120, max24h: 400, minH1Usd: 10000 };
// runners.json items -> setups for the runner bot (the paper Risky book's rule: 3 of 4 checks, no risk rule, 2 new per scan)
export function runnerSetups(items, { minPassed = 3, maxNew = 2, minLiqUsd = 100000 } = {}) {
  const ok = (Array.isArray(items) ? items : []).filter((r) => r && r.pool && (r.passed ?? 0) >= minPassed && !(r.vetoed || []).length && n(r.price) > 0 && (n(r.m && r.m.liq) ?? Infinity) >= minLiqUsd);
  return ok.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, maxNew).map((r) => ({ pool: r.pool, coin: r.coin, chain: r.chain, token: r.token || null, price: +r.price, opp: r.score ?? null, liq: n(r.m && r.m.liq) || 0, checks: (r.checks || []).filter((c) => c.ok).map((c) => c.k), why: (r.checks || []).filter((c) => c.ok).map((c) => `${c.k}: ${c.note}`) }));
}

// THE RIDER (from the giants study): not the launch, the first real pullback on day 2 to 7 of a coin that has already proven it can move.
// The giants were up multiples by day 3 and every one of them gave a 20-45% pullback on the way; buying that pullback as it turns, and
// never letting go of the last clip, is the trade. q: DexScreener quote; daily: daily candles from birth (GeckoTerminal); bars1h: the last
// hours. Gates: age minAgeD-maxAgeD days; price at least minX times the first daily close and not round-tripped; price pbMin-pbMax off the
// running high; 24h volume at least turnoverX times the liquidity (the whole pool changes hands daily: real interest, not one whale);
// buyers at least level in the hour; the trigger is the last closed hourly candle green and above the previous close (the turn).
export const RIDER = { minAgeD: 1.5, maxAgeD: 7, minX: 1.5, pbMin: 0.2, pbMax: 0.5, turnoverX: 1.5, minLiqUsd: 150000, stopMinPct: 15, stopMaxPct: 35 };
export function riderSetup(q, daily, bars1h, nowSec, cfg = RIDER) {
  if (!q || !(+q.priceUsd > 0) || !Array.isArray(daily) || !daily.length) return null; const price = +q.priceUsd, created = q.pairCreatedAt ? +q.pairCreatedAt / 1000 : daily[0][0], ageD = (nowSec - created) / 86400;
  if (ageD < cfg.minAgeD) return null; if (ageD > cfg.maxAgeD) return { dead: `${ageD.toFixed(0)} days old: past the window (day ${cfg.minAgeD}-${cfg.maxAgeD} only)` };
  const closedD = daily.filter((b) => b[0] + 86400 <= nowSec), c0 = (closedD[0] || daily[0])[4], hi = Math.max(...daily.map((b) => b[2]), price); if (!(c0 > 0)) return null;
  const x = price / c0, off = 1 - price / hi; if (x < cfg.minX) return { dead: `only ${x.toFixed(2)}x its first day's close: has not proven it can move` };
  if (off < cfg.pbMin) return null; if (off > cfg.pbMax) return { dead: `${Math.round(off * 100)}% off its high: that is a collapse, not a pullback` };
  const liq = +(q.liquidity && q.liquidity.usd) || 0, v24 = +(q.volume && q.volume.h24) || 0; if (liq < cfg.minLiqUsd) return { dead: `liquidity $${Math.round(liq / 1000)}k (needs $${Math.round(cfg.minLiqUsd / 1000)}k)` };
  if (v24 < cfg.turnoverX * liq) return { dead: `24-hour volume ${(v24 / Math.max(1, liq)).toFixed(1)}x the liquidity (needs ${cfg.turnoverX}x): interest fading` };
  const t1 = (q.txns && q.txns.h1) || {}, b = +t1.buys || 0, s = +t1.sells || 0; if (b < s) return null;
  const H = (bars1h || []).filter((b) => b[0] + 3600 <= nowSec); if (H.length < 2) return null; const last = H[H.length - 1], prev = H[H.length - 2]; if (!(last[4] > last[1] && last[4] > prev[4])) return null;
  const pbLow = Math.min(...H.slice(-24).map((b) => b[3]), price), raw = (1 - (pbLow * 0.95) / price) * 100, stopPct = Math.min(cfg.stopMaxPct, Math.max(cfg.stopMinPct, raw)), stop = +(price * (1 - stopPct / 100)).toPrecision(6);
  return { price, stop, stopPct: +stopPct.toFixed(1), ageD: +ageD.toFixed(1), x: +x.toFixed(2), offHighPct: Math.round(off * 100), turnover: +(v24 / Math.max(1, liq)).toFixed(1), hi, c0, why: [`day ${ageD.toFixed(1)}: ${x.toFixed(1)}x its first day's close, ${Math.round(off * 100)}% off the high and turning (green hour above the last close)`, `24h volume ${(v24 / Math.max(1, liq)).toFixed(1)}x the liquidity, ${b} buys vs ${s} sells in the hour`, `stop ${stopPct.toFixed(0)}% under (5% under the pullback low)`] };
}
