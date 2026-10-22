// RynoBot decisions, kept pure (no network, no clock) so the same rules are tested here and replayed by the paper books.
// Entry: a scanner setup (zone + invalidation) only becomes a buy when the 5-minute trigger fires (docs/strategies.mjs execTrigger).
// Exits, checked every poll, in this order:
//   1 stop (hard stop, then break-even after TP1, then the 25% trail)      5 TP1: a third at +1R, stop to break-even, trail on
//   2 sellers took over (8%+ under entry, sellers lead hour and 5 min)    6 ride free at 2x: sell just enough to get the stake back
//   3 volume died (6h under 20% of the 24h pace)                          7 giveback: after riding free, a 5-minute close 50% under the best close
//   4 no follow-through (6 hours, never reached +1R, under the entry)     8 time limit (72 hours)
// Dry run only: these functions return what WOULD be done; nothing here can place an order.
import { execTrigger } from '../docs/strategies.mjs';
export const BOT = { riskPct: 1, maxPosPct: 25, maxLiqPct: 1, maxImpactPct: 1.5, liqDropPct: 40, maxOpen: 4, maxOpenRiskPct: 4, dailyLossPct: 3, slipPct: 1, minStopPct: 5, maxStopPct: 20, chasePct: 3,
  tp1R: 1, tp1Share: 1 / 3, rideFreeAt: 2, trailPct: 0.25, giveback: 0.5, noFollowH: 6, maxHoldH: 72, volDied: 0.2, sellersLoss: 0.08, sellersX: 1.2, triggerFreshMin: 10 };
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);

// entry. setup: { zoneLow, zoneHigh, stop, at }. bars5: 5-minute candles. price: live price now. Returns { act: 'buy', ... } | { act: 'drop', why } | null
export function decideEntry(setup, bars5, price, nowSec, cfg = BOT) {
  const tr = execTrigger(setup, bars5, nowSec, setup.at); if (!tr) return null;
  if (tr.dead) return { act: 'drop', why: tr.why };
  const at = Date.parse(tr.at) / 1000; if (!(price > 0)) return null;
  if (!tr.pending && nowSec - at > cfg.triggerFreshMin * 60) return { act: 'drop', why: `trigger was ${Math.round((nowSec - at) / 60)} minutes ago: too late to act` };
  if (price > n(setup.zoneHigh) * (1 + cfg.chasePct / 100)) return { act: 'drop', why: 'price already ran past the zone: no chasing' };
  const flushLow = tr.pending ? n(tr.flushLow) : n(tr.stop) / 0.99, stop = Math.min(flushLow * 0.99, price * (1 - cfg.minStopPct / 100)), stopPct = (1 - stop / price) * 100;
  if (!(stop > 0) || stopPct > cfg.maxStopPct) return { act: 'drop', why: `stop would be ${stopPct.toFixed(0)}% away: too wide` };
  return { act: 'buy', price, stop: +stop.toPrecision(6), stopPct: +stopPct.toFixed(1), kind: tr.kind, trigPx: tr.px ?? null, trigAt: tr.at || null, why: [`${tr.kind} on the 5-minute chart`, tr.vol ? `volume ${tr.vol}x normal` : null].filter(Boolean) };
}

// what a trade of `usd` costs to get in and out of a pool with `liq` of liquidity: the fixed slippage plus price impact. On a constant-
// product pool a buy moves the price by about twice its share of the pool, and the sell moves it back the same way, so the round trip
// costs roughly 4x (size / liquidity). This is why a $2,000 buy in a $100k pool is a losing trade before it starts.
// plus a sandwich haircut on small pools (edge report: trades on thin pools get sandwiched; assume some loss on every fill there)
export function costPct(usd, liq, cfg = BOT) { const imp = liq > 0 ? (usd / liq) * 100 * 2 : 0, sw = liq > 0 && liq < (cfg.sandwichLiq ?? 200000) ? (cfg.sandwichPct ?? 0.5) : 0; return { inPct: cfg.slipPct + imp + sw, outPct: cfg.slipPct + imp + sw, impactPct: +imp.toFixed(2), sandwichPct: sw }; }
// position size: risk a fixed share of the account at the stop, capped by account share, price impact, pool liquidity and open risk
export function sizeFor(acct, buy, liq, openRiskUsd, cfg = BOT) {
  const riskUsd = acct.equity * cfg.riskPct / 100, want = riskUsd / (buy.stopPct / 100);
  const caps = [[acct.equity * cfg.maxPosPct / 100, 'account share cap'], [liq > 0 ? liq * cfg.maxLiqPct / 100 : Infinity, 'liquidity cap'], [liq > 0 && cfg.maxImpactPct ? (liq * cfg.maxImpactPct / 100) / 2 : Infinity, 'price impact cap'], [(acct.equity * cfg.maxOpenRiskPct / 100 - openRiskUsd) / (buy.stopPct / 100), 'total risk cap'], [acct.cash, 'cash']];
  let usd = want, cut = null; for (const [lim, why] of caps) if (usd > lim) { usd = Math.max(0, lim); cut = why; }
  return { usd: +usd.toFixed(2), riskUsd: +(usd * buy.stopPct / 100).toFixed(2), cut };
}

export function openPosition(setup, buy, usd, nowIso, cfg = BOT, liq = 0) {
  const inPct = costPct(usd, liq, cfg).inPct, fill = buy.price * (1 + inPct / 100), R = fill - buy.stop;
  return { id: setup.pool + '@' + nowIso, coin: setup.coin, chain: setup.chain, pool: setup.pool, url: setup.url || null, openedAt: nowIso, entry: +fill.toPrecision(6), stop0: buy.stop, stop: buy.stop, R: +R.toPrecision(6),
    tp1: +(fill + cfg.tp1R * R).toPrecision(6), freeAt: +(fill * cfg.rideFreeAt).toPrecision(6), costUsd: usd, units: usd / fill, remUnits: usd / fill, bankedUsd: 0, tp1Done: false, free: false, peak: fill, peakClose: fill, sells: [], liq: liq || null, slipOut: +(costPct(usd, liq, cfg).outPct).toFixed(3) };
}

// one poll for one open position. q: DexScreener pair (priceUsd, txns, volume, pairCreatedAt). closes5: [[t, close], ...] recent 5-minute closes.
// Returns { pos (updated copy), actions: [{ why, units, usd, px, all }] }.
export function managePosition(pos0, q, closes5, nowSec, cfg = BOT) {
  const pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = n(q && q.priceUsd), actions = [];
  if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const sell = (units, why, all = false) => { const u = Math.min(units, pos.remUnits); if (!(u > 0)) return; const px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100), usd = u * px; pos.remUnits -= u; pos.bankedUsd += usd; const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: all || pos.remUnits <= 1e-12, at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); };
  const sellAll = (why) => sell(pos.remUnits, why, true);
  pos.peak = Math.max(pos.peak, price); pos.trough = Math.min(pos.trough ?? price, price);
  const opened = Date.parse(pos.openedAt) / 1000, heldH = (nowSec - opened) / 3600;
  for (const [t, c] of closes5 || []) if (t >= opened && c > 0) pos.peakClose = Math.max(pos.peakClose, c);
  const lastClose = closes5 && closes5.length ? closes5[closes5.length - 1][1] : null;
  // 1 stop / break-even / trail
  if (!pos.free && price <= pos.stop) { sellAll(pos.tp1Done ? (pos.stop > pos.entry ? 'trailing stop' : 'break-even stop') : 'stop'); return { pos, actions }; }
  // 2 sellers took over while underwater
  { const t1 = (q.txns && q.txns.h1) || {}, t5 = (q.txns && q.txns.m5) || {}, b1 = +t1.buys || 0, s1 = +t1.sells || 0;
    if (!pos.free && price <= pos.entry * (1 - cfg.sellersLoss) && s1 > 0 && s1 >= cfg.sellersX * b1 && (+t5.sells || 0) > (+t5.buys || 0)) { sellAll(`sellers took over (${s1} sells vs ${b1} buys in the hour)`); return { pos, actions }; } }
  // 3 volume died
  { const v = q.volume || {}, d = n(v.h24), s6 = n(v.h6), age = q.pairCreatedAt ? (nowSec * 1000 - +q.pairCreatedAt) / 3600e3 : null;
    if (d > 0 && s6 != null && !(age != null && age < 24) && s6 / (d / 4) < cfg.volDied) { sellAll(`volume died (6h volume ${Math.round(s6 / (d / 4) * 100)}% of the 24h pace)`); return { pos, actions }; } }
  // 4 no follow-through
  if (!pos.tp1Done && !pos.free && heldH >= cfg.noFollowH && pos.peak < pos.tp1 && price < pos.entry) { sellAll(`no follow-through after ${cfg.noFollowH} hours`); return { pos, actions }; }
  // 5 TP1
  if (!pos.tp1Done && price >= pos.tp1) { sell(pos.units * cfg.tp1Share, 'TP1: a third at +1R'); pos.tp1Done = true; pos.stop = Math.max(pos.stop, pos.entry); (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: pos.stop, why: 'break-even after TP1' }); }
  // 6 ride free
  if (!pos.free && price >= pos.freeAt && pos.remUnits > 0) { const need = Math.max(0, pos.costUsd - pos.bankedUsd), px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100); sell(need / px, 'ride free: stake back at 2x'); pos.free = true; pos.stop = 0; }
  // 7 trail before free / giveback after free
  if (pos.tp1Done && !pos.free) { const t = pos.peak * (1 - cfg.trailPct); if (t > pos.stop) { pos.stop = +t.toPrecision(6); (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: pos.stop, why: 'trail 25% under the high' }); } }
  if (pos.free && lastClose != null && lastClose <= pos.peakClose * (1 - cfg.giveback)) { sellAll(`giveback: 5-minute close ${Math.round(cfg.giveback * 100)}% under the best close`); return { pos, actions }; }
  // 8 time limit
  if (heldH >= cfg.maxHoldH && pos.remUnits > 0) sellAll(`time limit (${cfg.maxHoldH} hours)`);
  return { pos, actions };
}
export const pnlOf = (pos, price) => pos.bankedUsd + pos.remUnits * (price > 0 ? price : 0) - pos.costUsd;

// ---------- Breakout retest (the pattern exactly as the backtest traded it) ----------
// Entry: a limit order at the top of the retest zone, 48 hours to fill; cancelled if the price falls through the stop first.
// Exits: the pattern plan's stop; a third at TP1 (stop to break-even), a third at TP2, the rest at TP3; 7 days at most.
export function decideLimit(setup, price, nowSec, cfg = BOT) {
  if (!(price > 0)) return null; const age = nowSec - Date.parse(setup.at) / 1000, eh = setup.expireH || 48;
  if (age > eh * 3600) return { act: 'drop', why: `expired (no fill in ${eh} hours)` };
  if (price <= setup.stop) return { act: 'drop', why: 'cancelled (price fell through the stop before the limit filled)' };
  if (price > setup.zoneHigh) return null; // the limit is still resting
  // a resting limit fills at the limit price on the first touch; if the bot only sees the price once it is lower, the fill was still the limit (anything else flatters the bot)
  const fillPx = price >= setup.zoneLow ? price : setup.zoneHigh, stopPct = (1 - setup.stop / fillPx) * 100; if (stopPct > (cfg.maxStopPct || 35)) return { act: 'drop', why: `stop would be ${stopPct.toFixed(0)}% away: too wide` };
  return { act: 'buy', price: fillPx, stop: setup.stop, stopPct: +stopPct.toFixed(1), kind: 'limit at the top of the retest zone', why: [price < setup.zoneLow ? 'price fell through the zone: the limit filled at the top of it' : 'price came back into the retest zone'] };
}
export function openLadder(setup, buy, usd, nowIso, cfg = BOT, liq = 0) {
  const c = costPct(usd, liq, cfg), fill = buy.price * (1 + c.inPct / 100), tg = (setup.mults ? setup.mults.map((m) => fill * m) : [setup.tp1, setup.tp2, setup.tp3].map(Number)).filter((x) => x > fill);
  return { id: setup.pool + '@' + nowIso, mode: 'ladder', coin: setup.coin, chain: setup.chain, pool: setup.pool, url: setup.url || null, openedAt: nowIso, entry: +fill.toPrecision(6), stop0: buy.stop, stop: buy.stop, R: +(fill - buy.stop).toPrecision(6),
    targets: tg.map((x) => +x.toPrecision(6)), shares: setup.shares || null, hits: 0, tp1: tg[0] || null, costUsd: usd, units: usd / fill, remUnits: usd / fill, bankedUsd: 0, tp1Done: false, free: false, peak: fill, peakClose: fill, sells: [], liq: liq || null, slipOut: +c.outPct.toFixed(3) };
}
export function manageLadder(pos0, q, nowSec, cfg = BOT) {
  const pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = n(q && q.priceUsd), actions = [];
  if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const sell = (units, why, all = false) => { const u = Math.min(units, pos.remUnits); if (!(u > 0)) return; const px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100), usd = u * px; pos.remUnits -= u; pos.bankedUsd += usd; const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: all || pos.remUnits <= 1e-12, at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); };
  pos.peak = Math.max(pos.peak, price); pos.trough = Math.min(pos.trough ?? price, price);
  if (price <= pos.stop) { sell(pos.remUnits, pos.hits ? 'break-even stop' : 'stop', true); return { pos, actions }; }
  // the seller cut (from the Degen cut-on-sellers book): underwater by sellersLoss and sellers lead the hour and the last 5 minutes: out
  if (cfg.flowCut && !pos.hits && price <= pos.entry * (1 - cfg.sellersLoss)) { const t1 = (q.txns && q.txns.h1) || {}, t5 = (q.txns && q.txns.m5) || {}, b1 = +t1.buys || 0, s1 = +t1.sells || 0;
    if (s1 > 0 && s1 >= cfg.sellersX * b1 && (+t5.sells || 0) > (+t5.buys || 0)) { sell(pos.remUnits, `sellers took over (${s1} sells vs ${b1} buys in the hour)`, true); return { pos, actions }; } }
  // clips on the way up: each target sells its share; with shares that add up to under 1 the remainder is a moonbag that trails moonTrail off its high
  const heldH = (nowSec - Date.parse(pos.openedAt) / 1000) / 3600;
  // no follow-through (edge report: a runner that has not made a new high in a day is usually the start of the retrace, not a pause)
  if (cfg.noFollowH > 0 && !pos.hits && heldH >= cfg.noFollowH && price < pos.entry) { sell(pos.remUnits, `no follow-through after ${cfg.noFollowH} hours`, true); return { pos, actions }; }
  // a paid DexScreener boost on a held coin is promotion, and promotion is followed by collapse more often than not: tighten, never enter on it
  if (cfg.boostTighten && q.boosts && +q.boosts.active > 0 && !pos.free && price > pos.entry) { const t = +(price * (1 - cfg.boostTighten)).toPrecision(6); if (t > pos.stop) { pos.stop = t; (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: t, why: `paid boost seen: stop tightened to ${Math.round(cfg.boostTighten * 100)}% under the price` }); } }
  const N = pos.targets.length, share = (i) => (pos.shares && pos.shares[i] != null ? pos.shares[i] : 1 / N), moon = pos.shares ? +(1 - pos.shares.reduce((a, x) => a + x, 0)).toFixed(4) : 0, hasMoon = moon > 0.001;
  while (pos.hits < N && price >= pos.targets[pos.hits] && pos.remUnits > 0) {
    const last = pos.hits === N - 1 && !hasMoon; sell(last ? pos.remUnits : pos.units * share(pos.hits), `TP${pos.hits + 1}: ${last ? 'the rest' : N === 3 && !pos.shares ? 'a third' : Math.round(share(pos.hits) * 100) + '%'}`, last);
    pos.hits++; if (pos.hits === 1 && cfg.beAfterFirst !== false) { pos.tp1Done = true; pos.stop = Math.max(pos.stop, pos.entry); (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: pos.stop, why: 'break-even after TP1' }); }
    if (pos.hits === N && hasMoon && pos.remUnits > 0) { pos.free = true; pos.stop = 0; pos.moonPeak = price; (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: 0, why: `${Math.round(moon * 100)}% moonbag: no stop, trails ${Math.round((cfg.moonTrail || 0.45) * 100)}% off its high` }); } }
  if (pos.free && hasMoon && pos.remUnits > 0) { pos.moonPeak = Math.max(pos.moonPeak || price, price); if (price <= pos.moonPeak * (1 - (cfg.moonTrail || 0.45))) { sell(pos.remUnits, `moonbag trail: ${Math.round((cfg.moonTrail || 0.45) * 100)}% off the high`, true); return { pos, actions }; } }
  if (pos.remUnits > 0 && heldH >= (cfg.maxHoldH || 168)) sell(pos.remUnits, `time limit (${Math.round((cfg.maxHoldH || 168) / 24)} days)`, true);
  return { pos, actions };
}

// ---------- Ignition (momentum ride): stop at the trigger candle's low; once up armPct, trail trailPct off the high and sell 90% when it
// hits; a red hourly candle on under fadeX of the trigger volume while in profit also sells 90%; the 10% moonbag trails moonTrail for up to
// maxHoldH; a trade that never moves is closed after flatH. bars1h: hourly candles (closed ones), newest last.
export const MOM = { armPct: 0.3, trailPct: 0.25, cashShare: 0.9, fadeX: 0.35, moonTrail: 0.45, flatH: 48, maxHoldH: 168 };
export function openMomentum(setup, buy, usd, nowIso, cfg = BOT, liq = 0) {
  const c = costPct(usd, liq, cfg), fill = buy.price * (1 + c.inPct / 100);
  return { id: setup.pool + '@' + nowIso, mode: 'momentum', coin: setup.coin, chain: setup.chain, pool: setup.pool, url: setup.url || null, openedAt: nowIso, entry: +fill.toPrecision(6), stop0: buy.stop, stop: buy.stop, R: +(fill - buy.stop).toPrecision(6), tp1: +(fill * (1 + (cfg.armPct ?? MOM.armPct))).toPrecision(6), targets: [], trigVol: setup.trigVol || null,
    costUsd: usd, units: usd / fill, remUnits: usd / fill, bankedUsd: 0, tp1Done: false, free: false, cashed: false, peak: fill, peakClose: fill, sells: [], liq: liq || null, slipOut: +c.outPct.toFixed(3) };
}
export function manageMomentum(pos0, q, bars1h, nowSec, cfg = BOT) {
  const M = { ...MOM, ...cfg }, pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = n(q && q.priceUsd), actions = [];
  if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const sell = (units, why, all = false) => { const u = Math.min(units, pos.remUnits); if (!(u > 0)) return; const px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100), usd = u * px; pos.remUnits -= u; pos.bankedUsd += usd; const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: all || pos.remUnits <= 1e-12, at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); };
  pos.peak = Math.max(pos.peak, price); pos.trough = Math.min(pos.trough ?? price, price); const heldH = (nowSec - Date.parse(pos.openedAt) / 1000) / 3600;
  if (!pos.cashed) {
    const armed = pos.peak >= pos.entry * (1 + M.armPct); if (armed) { const t = +(pos.peak * (1 - M.trailPct)).toPrecision(6); if (t > pos.stop) { pos.stop = t; (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: t, why: `trail ${Math.round(M.trailPct * 100)}% under the high` }); } }
    const cash = (why) => { sell(pos.units * M.cashShare, why); pos.cashed = true; pos.tp1Done = true; pos.free = true; pos.stop = 0; pos.moonPeak = price; };
    if (armed && price <= pos.stop) { cash(`momentum trail: ${Math.round(M.trailPct * 100)}% off the high, 90% out`); return { pos, actions }; }
    if (price <= pos.stop) { sell(pos.remUnits, 'stop at the trigger candle\'s low', true); return { pos, actions }; }
    const last = Array.isArray(bars1h) && bars1h.length ? bars1h.filter((b) => b[0] + 3600 <= nowSec).slice(-1)[0] : null;
    if (last && price > pos.entry && last[4] < last[1] && pos.trigVol > 0 && (last[5] || 0) < pos.trigVol * M.fadeX) { cash(`volume faded (red hour on ${Math.round(((last[5] || 0) / pos.trigVol) * 100)}% of the ignition volume), 90% out`); return { pos, actions }; }
    if (heldH >= M.flatH) { sell(pos.remUnits, `no run in ${M.flatH} hours`, true); return { pos, actions }; }
    return { pos, actions };
  }
  pos.moonPeak = Math.max(pos.moonPeak || price, price);
  if (price <= pos.moonPeak * (1 - M.moonTrail)) { sell(pos.remUnits, `moonbag trail: ${Math.round(M.moonTrail * 100)}% off the high`, true); return { pos, actions }; }
  if (heldH >= M.maxHoldH) sell(pos.remUnits, `moonbag time limit (${Math.round(M.maxHoldH / 24)} days)`, true);
  return { pos, actions };
}

// the desk's "close now": sell everything at the live price with this position's costs (paper). why is recorded on the trade.
export function closeNow(pos0, q, nowSec, cfg = BOT, why = 'closed by hand from the desk') {
  const pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = n(q && q.priceUsd), actions = []; if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100), u = pos.remUnits, usd = u * px; pos.remUnits = 0; pos.bankedUsd += usd;
  const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: true, manual: true, at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); return { pos, actions };
}
