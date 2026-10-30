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
// what an open position is worth now: spot = units times the price; a perp = its margin plus the profit or loss on the full size, less
// the fees and borrow so far (never under zero: that is a liquidation). A closed position is worth nothing more (it is all in bankedUsd).
// THE POOL CAP (24 Oct: the desk showed +$6.2m from one coin, Cash Cat, whose chart was painted by sub-cent trades in a thin pool; nobody
// could ever have sold that bag). A paper sale can never fetch more than the pool would really pay: on a constant-product pool holding
// liq/2 dollars on the buy side, selling a bag worth V at the quoted price returns (liq/2) x V / (liq/2 + V) before fees. Small sales
// barely move; a bag the size of the pool gets about half; a bag 100x the pool gets the pool and no more. Unknown liquidity: no cap.
export function poolExit(usdAtSpot, liq, feePct = 0) { if (!(usdAtSpot > 0)) return 0; if (!(liq > 0)) return usdAtSpot * (1 - feePct / 100); const Q = liq / 2; return ((Q * usdAtSpot) / (Q + usdAtSpot)) * (1 - feePct / 100); }
// is this a market anyone could really trade? (every spot bot, before every buy; null = fine). Painted charts: the hour's trades average
// under minAvgTradeUsd (sub-cent trades walking the price up); a coin almost nobody can sell: 30+ buys in the hour and sells under 5% of
// them; no real liquidity figure on a pool that is not a pump.fun bonding curve (the curve itself is the liquidity there)
export function marketProblem(q, cfg = {}) {
  if (!q || cfg.marketCheck === false) return null; const t1 = (q.txns && q.txns.h1) || {}, b = +t1.buys || 0, s = +t1.sells || 0, v1 = +(q.volume && q.volume.h1) || 0, n = b + s, minAvg = cfg.minAvgTradeUsd ?? 5;
  if (n >= 40 && q.volume && q.volume.h1 != null && v1 / n < minAvg) return `dust trades: ${n} trades in the hour averaging $${(v1 / n).toFixed(2)} (the chart is being painted, not traded)`;
  if (b >= 30 && s < b * 0.05) return `almost nobody has sold: ${s} sells vs ${b} buys in the hour (a coin you may not be able to sell)`;
  if (q.liquidity && q.liquidity.estimated && String(q.dexId || '') !== 'pumpfun' && !q.pump) return 'no real liquidity figure for this pool (only a pump.fun bonding curve may go without one)';
  // thin pools (24 Oct, the trenchers kept finding them): a traded pool (not a bonding curve) needs real liquidity of its own, and enough
  // of it for its market cap; a $1m coin on $5k of liquidity is a price anyone can push and nobody can sell into
  const curve = String(q.dexId || '') === 'pumpfun' || q.pump, L = +(q.liquidity && q.liquidity.usd) || 0, mc = +(q.marketCap || q.fdv) || 0;
  if (!curve && cfg.minPoolLiqUsd > 0 && L < cfg.minPoolLiqUsd) return `thin pool: $${Math.round(L / 1000)}k of liquidity (needs $${Math.round(cfg.minPoolLiqUsd / 1000)}k+ off the bonding curve)`;
  if (!curve && cfg.minLiqMcap > 0 && mc > 0 && L / mc < cfg.minLiqMcap) return `thin for its size: $${Math.round(L / 1000)}k of liquidity under a $${mc >= 1e6 ? (mc / 1e6).toFixed(1) + 'm' : Math.round(mc / 1000) + 'k'} market cap (${((L / mc) * 100).toFixed(1)}%, needs ${Math.round(cfg.minLiqMcap * 100)}%)`;
  return null; }
// SANE QUOTES (24 Oct, the second make-believe win: three trenchers booked $3.7m-$8.8m in an hour on one coin). DexScreener works out a
// pool's dollar price AND its dollar liquidity from the price it gives the quote token, so one wrong quote-token price makes both wrong
// together and the pool cap cannot see it. The checks, on every quote before any bot uses it (null = fine, else why it is ignored):
//   the pair must show the coin we hold or watch (not another coin at the same address, not SOL/USDC itself: an upside-down pair);
//   it must be priced against SOL or a dollar coin; on a SOL pair the dollar price must agree with price-in-SOL x the SOL price (25%);
//   and the dollar liquidity is re-worked from the pool's own SOL or dollar balance (2 x the quote side), never taken on trust.
export const QUOTE_OK = { solana: ['SOL', 'WSOL', 'USDC', 'USDT', 'USD1', 'PYUSD', 'USDS'], evm: ['ETH', 'WETH', 'USDC', 'USDT', 'BNB', 'WBNB', 'USDC.E'] };
const MAJOR_BASE = new Set(['SOL', 'WSOL', 'USDC', 'USDT', 'ETH', 'WETH', 'BNB', 'WBNB', 'USD1']);
// OTHER PAIRINGS (30 Oct, Ryan: "HI was bought on Solana, paired with HYPE; AI on Robinhood is paired with NVIDIA; Phantom and Axiom buy them
// with SOL or ETH with ease"). A coin priced against another token (an RWA, a stock token, HYPE) is fine once that token's own dollar price
// is known from its own SOL or dollar market (quotePx: { [address]: { px, liq } }, refreshed by the bot every 30 minutes): the pair's dollar
// price must agree with price-in-that-token x that token's price (25%), and the token's own market must be deep enough ($250k) that its
// price can be trusted. Until its price is known, the quote waits, as before.
export const OTHER_QUOTE = { minLiqUsd: 250000 };
export function quoteProblem(q, { token = null, chain = 'solana', solUsd = 0, majors = false, quotePx = null } = {}) {
  if (!q) return null; const bt = q.baseToken || {}, qt = q.quoteToken || {}, sym = String(qt.symbol || '').toUpperCase(), sol = !/robinhood|bsc|base|ethereum|eth/i.test(String(chain || q.chainId || 'solana'));
  if (q.pump) return null; /* the launch feed's own price from the bonding curve */
  const same = (a, b) => (/^0x/i.test(String(a)) ? String(a).toLowerCase() === String(b).toLowerCase() : a === b); /* EVM addresses come in any letter case (25 Oct: the Breakout bot ignored every Robinhood quote for a day over this); Solana's do not */
  if (token && bt.address && !same(bt.address, token)) return `the pair now shows a different coin (${bt.symbol || bt.address.slice(0, 6)})`;
  if (!majors && MAJOR_BASE.has(String(bt.symbol || '').toUpperCase())) return `upside-down pair: the base coin is ${bt.symbol}`;
  if (sym && !(sol ? QUOTE_OK.solana : QUOTE_OK.evm).includes(sym)) { const k = String(qt.address || '').toLowerCase(), o = quotePx && quotePx[k];
    if (!o || !(o.px > 0)) return `priced against ${qt.symbol}, whose own dollar price is not checked yet`;
    if (!(o.liq >= OTHER_QUOTE.minLiqUsd)) return `priced against ${qt.symbol}, whose own market is too thin to trust its price ($${Math.round((o.liq || 0) / 1000)}k)`;
    if (+q.priceNative > 0 && +q.priceUsd > 0) { const r = +q.priceUsd / (+q.priceNative * o.px); if (r > 1.25 || r < 0.8) return `dollar price does not match price-in-${qt.symbol} x ${qt.symbol}'s own price (${r.toFixed(2)}x off)`; } }
  /* a pool cannot hold more money than the whole coin is worth (Water Coin, 24 Oct: $240m of "liquidity" under a coin that was $34k a quarter of an hour earlier) */
  { const L = +(q.liquidity && q.liquidity.usd) || 0, mc = +(q.marketCap || q.fdv) || 0; if (L > 0 && mc > 0 && L > 1.5 * mc) return `liquidity ($${Math.round(L).toLocaleString('en')}) bigger than the coin's whole market cap ($${Math.round(mc).toLocaleString('en')}): a broken quote`; }
  if (sol && /^W?SOL$/.test(sym) && solUsd > 0 && +q.priceNative > 0 && +q.priceUsd > 0) { const r = +q.priceUsd / (+q.priceNative * solUsd); if (r > 1.25 || r < 0.8) return `dollar price does not match price-in-SOL x SOL (${r.toFixed(2)}x off)`; }
  return null; }
export function trueLiq(q, solUsd = 0, quotePx = null) { const L = q && q.liquidity; if (!L) return; const sym = String((q.quoteToken && q.quoteToken.symbol) || '').toUpperCase(), qa = +L.quote, o = quotePx && q.quoteToken && quotePx[String(q.quoteToken.address || '').toLowerCase()], usd = /^W?SOL$/.test(sym) ? (solUsd > 0 && qa >= 0 ? 2 * qa * solUsd : null) : /^(USDC|USDT|USD1|PYUSD|USDS|USDC\.E)$/.test(sym) && qa >= 0 ? 2 * qa : o && o.px > 0 && qa >= 0 ? 2 * qa * o.px : null;
  if (usd != null && isFinite(usd)) { L.reported = L.usd; L.usd = +L.usd > 0 ? Math.min(+L.usd, usd) : usd; } }
// THE ORGANIC-CHART FILTER (24 Oct, Ryan: "all the shit coins I have flagged look like they're just buyers and no sellers"). The coins
// that faked their way past everything else had one shape: a fresh coin with hundreds of buys a minute and almost no sellers (COIL,
// DOPE, 派大星: about 420 buys to 60 sells in 5 minutes, near-identical numbers on different coins: one bot farm), thousands of buying
// wallets against a handful of selling ones (Rockstar: 2,112 buyers, 102 sellers), or an hour's volume many times the whole coin
// (HYPEST: $8.9m traded on a $92k coin). A real crowd has people taking profit. null = looks organic; else why not.
export const ORGANIC = { minSellShare5: 0.25, minSellShare1: 0.3, minBuys5: 50, minBuys1: 100, maxVolToMcap: 20, minSellerShare: 0.2, minBuyers: 50 };
export function organicProblem(q, gt = null, cfg = ORGANIC) {
  if (!q) return null; const C = { ...ORGANIC, ...(cfg || {}) }, t5 = (q.txns && q.txns.m5) || {}, t1 = (q.txns && q.txns.h1) || {}, b5 = +t5.buys || 0, s5 = +t5.sells || 0, b1 = +t1.buys || 0, s1 = +t1.sells || 0, v1 = +(q.volume && q.volume.h1) || 0, mc = +(q.marketCap || q.fdv) || 0;
  if (b5 >= C.minBuys5 && s5 < b5 * C.minSellShare5) return `one-way buying: ${b5} buys vs ${s5} sells in 5 minutes (a real crowd has sellers; this is a bot farm's shape)`;
  if (b1 >= C.minBuys1 && s1 < b1 * C.minSellShare1) return `one-way buying: ${b1} buys vs ${s1} sells in the hour`;
  if (mc > 0 && v1 > C.maxVolToMcap * mc) return `wash volume: $${Math.round(v1 / 1000).toLocaleString('en')}k traded in the hour on a $${Math.round(mc / 1000)}k coin (${Math.round(v1 / mc)}x its whole value)`;
  const g = gt && gt.transactions && gt.transactions.h1; if (g && +g.buyers >= C.minBuyers && +g.sellers < +g.buyers * C.minSellerShare) return `fake buyers: ${g.buyers} wallets buying vs ${g.sellers} selling in the hour`;
  return null; }
export const posValue = (p, price) => { if (p.mode !== 'perp') return p.remUnits * (price > 0 ? price : 0) * (1 - (p.slipOut || 0) / 100); /* what selling now would fetch */ if (!(p.remUnits > 0)) return 0; const px = price > 0 ? price : p.entry; return Math.max(0, p.costUsd + (p.side === 'short' ? -1 : 1) * (px - p.entry) * p.units - (p.feesUsd || 0) - (p.borrowUsd || 0)); };
export const pnlOf = (pos, price) => pos.bankedUsd + posValue(pos, price) - pos.costUsd;
// open risk of a position (what hitting its stop would cost now): perps carry it in riskUsd; spot from the units left and the stop
export const riskOf = (p, slipPct = 0) => (p.mode === 'perp' ? (p.remUnits > 0 ? p.riskUsd || 0 : 0) : p.free ? 0 : Math.max(0, p.remUnits * (p.entry - p.stop * (1 - (p.slipOut ?? slipPct) / 100))));

// ---------- PERPS (paper only: the BTC and ETH range bots; no perps executor exists, live is refused) ----------
// Costs modelled on Jupiter Perps: 0.06% of the position size to open and again to close, borrow charged hourly on the full size
// (borrowPctH, 0.002%/hour: their example rate is 0.0016%), USDC collateral. Liquidation when the loss eats the margin less a
// maintenance cushion (mmPct of the size); a liquidation loses the whole margin. Size: the 1% risk spread over stop distance plus fees,
// capped at maxNotionalX times the pot; the stop must sit well inside the liquidation price (stopPct at most 80% of the distance to it).
export const PERP = { leverage: 10, feePct: 0.06, borrowPctH: 0.002, mmPct: 0.75, maxNotionalX: 3 };
export const liqDistPct = (lev, mmPct = PERP.mmPct) => 100 / lev - mmPct;
export function perpSize(acct, stopPct, openRiskUsd, cfg) {
  const P = { ...PERP, ...cfg }, eff = stopPct + 2 * P.feePct, riskUsd = acct.equity * P.riskPct / 100; let notional = riskUsd / (eff / 100), cut = null;
  if (stopPct > 0.8 * liqDistPct(P.leverage, P.mmPct)) return { notional: 0, cut: `stop ${stopPct.toFixed(1)}% is too close to liquidation at ${P.leverage}x (${liqDistPct(P.leverage, P.mmPct).toFixed(1)}%)` };
  const caps = [[acct.equity * P.maxNotionalX, `size cap ${P.maxNotionalX}x the pot`], [acct.cash * P.leverage, 'cash for the margin'], [acct.equity * P.maxPosPct / 100 * P.leverage, 'margin cap'], [Math.max(0, acct.equity * P.maxOpenRiskPct / 100 - openRiskUsd) / (eff / 100), 'open risk cap']];
  for (const [lim, why] of caps) if (notional > lim) { notional = Math.max(0, lim); cut = why; }
  return { notional: +notional.toFixed(2), margin: +(notional / P.leverage).toFixed(2), riskUsd: +(notional * eff / 100).toFixed(2), cut };
}
export function openPerp(setup, d, sz, nowIso, cfg) {
  const P = { ...PERP, ...cfg }, side = setup.side === 'short' ? 'short' : 'long', entry = d.price, units = sz.notional / entry, ld = liqDistPct(P.leverage, P.mmPct) / 100;
  return { id: setup.pool + '@' + nowIso + (side === 'short' ? ':s' : ''), mode: 'perp', side, coin: setup.coin, chain: setup.chain, pool: setup.pool, url: setup.url || null, openedAt: nowIso, entry: +entry.toPrecision(8), stop0: d.stop, stop: d.stop, tp1: setup.tp1, targets: [setup.tp1], hits: 0,
    leverage: P.leverage, notional: sz.notional, units, remUnits: units, costUsd: sz.margin, bankedUsd: 0, feesUsd: +(sz.notional * P.feePct / 100).toFixed(4), borrowUsd: 0, borrowAt: Date.parse(nowIso) / 1000, liqPx: +(entry * (side === 'short' ? 1 + ld : 1 - ld)).toPrecision(8), riskUsd: sz.riskUsd, peak: entry, trough: entry, sells: [], free: false };
}
export function managePerp(pos0, q, nowSec, cfg) {
  const P = { ...PERP, ...cfg }, pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = n(q && q.priceUsd), actions = []; if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const dir = pos.side === 'short' ? -1 : 1, at = new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z';
  pos.borrowUsd = +((pos.borrowUsd || 0) + pos.notional * P.borrowPctH / 100 * Math.max(0, nowSec - (pos.borrowAt || nowSec)) / 3600).toFixed(4); pos.borrowAt = nowSec; pos.peak = Math.max(pos.peak, price); pos.trough = Math.min(pos.trough ?? price, price);
  const close = (px, why, liquidated = false) => { const exitFee = pos.units * px * P.feePct / 100, pnl = dir * (px - pos.entry) * pos.units - pos.feesUsd - exitFee - pos.borrowUsd, banked = liquidated ? 0 : Math.max(0, pos.costUsd + pnl); pos.feesUsd = +(pos.feesUsd + exitFee).toFixed(4); pos.remUnits = 0; pos.bankedUsd = +banked.toFixed(2); const a = { why, units: pos.units, usd: pos.bankedUsd, px: +px.toPrecision(8), all: true, at }; pos.sells.push(a); actions.push(a); return { pos, actions }; };
  if (P.closeNow) return close(price, 'closed by hand from the desk');
  if (dir * (price - pos.liqPx) <= 0) return close(pos.liqPx, `liquidated at ${pos.leverage}x: the whole margin is gone`, true);
  if (dir * (price - pos.stop) <= 0) return close(price * (1 - dir * (P.slipPct || 0) / 100), 'stop');
  if (pos.tp1 > 0 && dir * (price - pos.tp1) >= 0) { pos.hits = 1; return close(pos.tp1, pos.side === 'short' ? "target: Monday's low" : "target: Monday's high"); }
  if ((nowSec - Date.parse(pos.openedAt) / 1000) / 3600 >= (P.maxHoldH || 120)) return close(price, `time limit (${Math.round((P.maxHoldH || 120) / 24)} days)`);
  return { pos, actions };
}
// the short-side limit: rests at the bottom of the bearish order block; a price through the stop (above) first cancels it
export function decideLimitShort(setup, price, nowSec, cfg = BOT) {
  if (!(price > 0)) return null; const age = nowSec - Date.parse(setup.at) / 1000, eh = setup.expireH || 48;
  if (age > eh * 3600) return { act: 'drop', why: `expired (no fill in ${eh} hours)` }; if (price >= setup.stop) return setup.prevPx > 0 && setup.prevPx < setup.zoneLow ? { act: 'buy', price: setup.zoneLow, stop: setup.stop, stopPct: +((setup.stop / setup.zoneLow - 1) * 100).toFixed(2), kind: 'short filled on the way through', why: ['the price went through the short and its stop between two checks: filled, stopped at the next check'] } : { act: 'drop', why: 'cancelled (price went through the stop before the limit filled)' };
  if (price < setup.zoneLow) return null; const fillPx = setup.zoneLow, stopPct = (setup.stop / fillPx - 1) * 100; if (stopPct > (cfg.maxStopPct || 35)) return { act: 'drop', why: `stop would be ${stopPct.toFixed(0)}% away: too wide` };
  return { act: 'buy', price: fillPx, stop: setup.stop, stopPct: +stopPct.toFixed(2), kind: 'short limit at the bottom of the order block', why: [price > setup.zoneHigh ? 'price went through the zone: the short filled at the bottom of it' : 'price came back up into the order block'] };
}

// ---------- Breakout retest (the pattern exactly as the backtest traded it) ----------
// Entry: a limit order at the top of the retest zone, 48 hours to fill; cancelled if the price falls through the stop first.
// Exits: the pattern plan's stop; a third at TP1 (stop to break-even), a third at TP2, the rest at TP3; 7 days at most.
export function decideLimit(setup, price, nowSec, cfg = BOT) {
  if (!(price > 0)) return null; const age = nowSec - Date.parse(setup.at) / 1000, eh = setup.expireH || 48;
  if (age > eh * 3600) return { act: 'drop', why: `expired (no fill in ${eh} hours)` };
  // a resting limit fills at the limit price on the first touch, however much lower the price is by the time the bot looks (anything else
  // flatters the bot). If the price went from above the limit straight to under the stop between two checks, the limit filled on the way
  // down: it is booked, and the stop takes it out at the next check (a cancel here would hide a real loss)
  if (price <= setup.stop) return setup.prevPx > setup.zoneHigh ? { act: 'buy', price: setup.zoneHigh, stop: setup.stop, stopPct: +((1 - setup.stop / setup.zoneHigh) * 100).toFixed(1), kind: 'limit filled on the way through', why: ['the price went through the limit and the stop between two checks: filled at the limit, stopped at the next check'] } : { act: 'drop', why: 'cancelled (price fell through the stop before the limit filled)' };
  if (price > setup.zoneHigh) return null; // the limit is still resting
  const fillPx = setup.zoneHigh, stopPct = (1 - setup.stop / fillPx) * 100; if (stopPct > (cfg.maxStopPct || 35)) return { act: 'drop', why: `stop would be ${stopPct.toFixed(0)}% away: too wide` };
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
  if (price <= pos.stop) { sell(pos.remUnits, pos.stop > pos.entry * 1.002 ? 'trailing stop (in profit)' : pos.hits ? 'break-even stop' : 'stop', true); return { pos, actions }; }
  // the dump cut (degen runner): sellers plainly in control and the price already well off its high, at any stage, in profit or not: everything out
  if (cfg.dumpCut && pos.remUnits > 0 && !(pos.free && cfg.freeRide) && !pos.rideFree) { const t1 = (q.txns && q.txns.h1) || {}, t5 = (q.txns && q.txns.m5) || {}, b1 = +t1.buys || 0, s1 = +t1.sells || 0, b5 = +t5.buys || 0, s5 = +t5.sells || 0, D = cfg.dumpCut;
    if (s5 >= (D.min5 || 8) && s5 >= (D.sellX5 || 1.5) * Math.max(1, b5) && s1 >= (D.sellX1 || 1.2) * Math.max(1, b1) && price <= pos.peak * (1 - (D.offHighPct || 0.15))) { sell(pos.remUnits, `sellers dumping (${s5} sells vs ${b5} buys in 5 minutes, ${Math.round((1 - price / pos.peak) * 100)}% off the high)`, true); return { pos, actions }; } }
  // the giveback rule (HOOKR, 22 Oct: up well over 30%, dumped back to the entry and the bot sat through it): once the trade has shown armPct,
  // giving back keep (half) of the best gain is the exit, before the clips or the stop ever get a say. Off once the moonbag is free.
  if (cfg.peakGiveback && !pos.free && !pos.rideFree && pos.remUnits > 0) { const G = cfg.peakGiveback, gain = pos.peak / pos.entry - 1; if (gain >= (G.armPct ?? 0.3) && price <= pos.entry * (1 + gain * (1 - (G.keep ?? 0.5)))) { sell(pos.remUnits, `gave back ${Math.round((G.keep ?? 0.5) * 100)}% of a +${Math.round(gain * 100)}% gain`, true); return { pos, actions }; } }
  // a dead chart (the trencher): no trade at all for deadMin minutes means the buyers are gone; out at whatever the curve pays
  if (cfg.deadMin > 0 && q.lastTradeSec > 0 && nowSec - q.lastTradeSec >= cfg.deadMin * 60) { sell(pos.remUnits, `dead chart: no trades for ${Math.round((nowSec - q.lastTradeSec) / 60)} minutes`, true); return { pos, actions }; }
  // the same on DexScreener's numbers (the trencher's DexScreener lanes): not one trade in the last 5 minutes, after deadMin minutes held
  if (cfg.deadMin > 0 && !(q.lastTradeSec > 0) && q.txns && q.txns.m5 && (+q.txns.m5.buys || 0) + (+q.txns.m5.sells || 0) === 0 && (nowSec - Date.parse(pos.openedAt) / 1000) >= cfg.deadMin * 60) { sell(pos.remUnits, 'dead chart: no trades in the last 5 minutes', true); return { pos, actions }; }
  // the FOMO fade: the first 5-minute spike of spikePct% or more with buyers piling in (buyX the sells), while in profit, sells share of
  // the position into the crowd's excitement; the rest is then protected at break-even or better and trails trail% off its high
  if (cfg.spikeSell && pos.remUnits > 0) { const K = cfg.spikeSell; if (!pos.spiked) { const c5 = n(q.priceChange && q.priceChange.m5), t5 = (q.txns && q.txns.m5) || {}, b5 = +t5.buys || 0, s5 = +t5.sells || 0;
      const spike = c5 != null && c5 >= (K.spikePct ?? 30) && b5 >= (K.buyX ?? 2) * Math.max(1, s5) && price > pos.entry, slow = price >= pos.entry * (K.atX ?? 2);
      if (spike || slow) { sell(pos.remUnits * (K.share ?? 0.5), spike ? `sold into the FOMO: +${Math.round(c5)}% in 5 minutes, ${b5} buys vs ${s5} sells` : `${K.atX ?? 2}x without a FOMO spike: half sold anyway`); pos.spiked = true; pos.spikePeak = price; pos.stop = Math.max(pos.stop, pos.entry); (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: pos.stop, why: 'after the FOMO sale: stop to break-even' }); return { pos, actions }; } }
    else if (K.trail != null) { pos.spikePeak = Math.max(pos.spikePeak || price, price); if (price <= pos.spikePeak * (1 - K.trail)) { sell(pos.remUnits, `FOMO fade: the rest out ${Math.round(K.trail * 100)}% off its high`, true); return { pos, actions }; } } } /* no trail: the ladder and the free ride take it from here */
  // the shotgun's cheap miss: a shot that has not been up noPopPct% within noPopMin minutes (and has sold nothing) is out, before it costs the full stop
  if (cfg.noPopMin > 0 && !pos.hits && pos.remUnits > 0 && (nowSec - Date.parse(pos.openedAt) / 1000) >= cfg.noPopMin * 60 && pos.peak < pos.entry * (1 + (cfg.noPopPct ?? 15) / 100)) { sell(pos.remUnits, `no pop: never up ${cfg.noPopPct ?? 15}% in ${cfg.noPopMin} minutes`, true); return { pos, actions }; }
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
    pos.hits++; if (pos.hits === 1 && cfg.freeAfterFirst) { pos.rideFree = true; pos.stop = 0; (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: 0, why: 'initials out: the rest rides free (no stop, no dump cut, no giveback)' }); }
    if (pos.hits === 1 && cfg.beAfterFirst !== false && !cfg.freeAfterFirst) { pos.tp1Done = true; pos.stop = Math.max(pos.stop, pos.entry); (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: pos.stop, why: 'break-even after TP1' }); }
    if (pos.hits === N && hasMoon && pos.remUnits > 0) { pos.free = true; pos.stop = 0; pos.moonPeak = price; (pos.moves ||= []).push({ at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', stop: 0, why: cfg.ticketExit ? `${Math.round(moon * 100)}% giant ticket: no stop, no trail; sold only when the coin is dead (${cfg.ticketExit.days || 7}-day volume under ${cfg.ticketExit.deadVolPct ?? 5}% of its best week) or after ${cfg.ticketExit.maxDays || 120} days` : `${Math.round(moon * 100)}% moonbag: no stop, trails ${Math.round((cfg.moonTrail || 0.45) * 100)}% off its high` }); } }
  // the giant ticket (the rider; from the giants study, 22 Oct: the five complete giants fell 92-99% on the way to 85x-3,549x, so no price
  // trail survives them and "hold" beat every trail 16 to 1): the moonbag is never sold on price. It is sold when the coin is dead:
  // the last `days` days' average 24-hour volume under deadVolPct of the best such average since entry (interest gone), or after maxDays.
  if (pos.free && hasMoon && pos.remUnits > 0 && cfg.ticketExit) { const T = cfg.ticketExit, dayK = Math.floor(nowSec / 86400), v24 = +(q.volume && q.volume.h24) || 0; pos.volLog ||= []; const lastD = pos.volLog.length ? pos.volLog[pos.volLog.length - 1][0] : null;
    if (lastD !== dayK) pos.volLog.push([dayK, v24]); else pos.volLog[pos.volLog.length - 1][1] = Math.max(pos.volLog[pos.volLog.length - 1][1], v24); pos.volLog = pos.volLog.slice(-400);
    const n = T.days || 7, avg = (xs) => xs.reduce((a, x) => a + x[1], 0) / xs.length; if (pos.volLog.length >= 2 * n) { let best = 0; for (let i = n; i <= pos.volLog.length; i++) best = Math.max(best, avg(pos.volLog.slice(i - n, i))); const nowAvg = avg(pos.volLog.slice(-n));
      if (best > 0 && nowAvg < best * ((T.deadVolPct ?? 5) / 100)) { sell(pos.remUnits, `giant ticket: the coin is dead (${n}-day volume ${Math.round((nowAvg / best) * 100)}% of its best week)`, true); return { pos, actions }; } }
    if (heldH >= (T.maxDays || 120) * 24) { sell(pos.remUnits, `giant ticket: ${T.maxDays || 120} days are up`, true); return { pos, actions }; }
    pos.moonPeak = Math.max(pos.moonPeak || price, price); }
  else if (pos.free && hasMoon && pos.remUnits > 0) { pos.moonPeak = Math.max(pos.moonPeak || price, price); if (price <= pos.moonPeak * (1 - (cfg.moonTrail || 0.45))) { sell(pos.remUnits, `moonbag trail: ${Math.round((cfg.moonTrail || 0.45) * 100)}% off the high`, true); return { pos, actions }; } }
  if (pos.remUnits > 0 && heldH >= (cfg.maxHoldH || 168)) sell(pos.remUnits, `time limit (${Math.round((cfg.maxHoldH || 168) / 24)} days)`, true);
  return { pos, actions };
}

// a stop that fits the coin (edge report: never widen risk to fit a thin pool; here the other way round, never use a fixed 20% on a coin whose
// structure says 12%): the low of the last closed hourly candle less 2%, kept between minPct and maxPct under the price; fixed stopPct when no candles
export function structureStop(price, bars1h, nowSec, { minPct = 12, maxPct = 30, fixedPct = 20 } = {}) {
  const closed = (bars1h || []).filter((b) => b[0] + 3600 <= nowSec); if (!closed.length || !(price > 0)) return { stop: +(price * (1 - fixedPct / 100)).toPrecision(6), stopPct: fixedPct, why: 'fixed' };
  const low = Math.min(...closed.slice(-2).map((b) => b[3])) * 0.98, pct = (1 - low / price) * 100, use = Math.min(maxPct, Math.max(minPct, pct));
  return { stop: +(price * (1 - use / 100)).toPrecision(6), stopPct: +use.toFixed(1), why: pct < minPct ? `under the last hours' low would be only ${pct.toFixed(0)}%: widened to ${minPct}%` : pct > maxPct ? `the last hours' low is ${pct.toFixed(0)}% down: capped at ${maxPct}%` : `2% under the last two hours' low` };
}
// the pullback entry: after a signal, wait for the first dip of dipPct from the post-signal high and buy the first 5-minute close back above the
// previous close (the dip being bought, not the spike). Gives up after waitH hours or if the dip breaks the signal price by more than failPct.
export function decidePullback(setup, bars5, price, nowSec, cfg = BOT) {
  const dipPct = cfg.pbDipPct ?? 12, waitH = cfg.pbWaitH ?? 3, failPct = cfg.pbFailPct ?? 15, t0 = Date.parse(setup.at) / 1000; if (!(price > 0)) return null;
  if (nowSec - t0 > waitH * 3600) return { act: 'drop', why: `no pullback within ${waitH} hours` };
  const B = (bars5 || []).filter((b) => b[0] >= t0 && b[0] + 300 <= nowSec); if (B.length < 2) return null;
  let hi = setup.zoneHigh, dipLow = null, dipI = -1; for (let i = 0; i < B.length; i++) { hi = Math.max(hi, B[i][2]); if (dipI < 0 && B[i][3] <= hi * (1 - dipPct / 100)) { dipI = i; dipLow = B[i][3]; } else if (dipI >= 0) dipLow = Math.min(dipLow, B[i][3]); }
  if (dipI < 0) return null; if (dipLow < setup.zoneHigh * (1 - failPct / 100)) return { act: 'drop', why: `the dip went ${failPct}%+ under the signal price: the move failed` };
  const last = B[B.length - 1], prev = B[B.length - 2]; if (last[4] > prev[4] && last[4] > last[1] && price >= last[4] * 0.99) return { act: 'buy', price, stop: +(dipLow * 0.97).toPrecision(6), stopPct: +((1 - (dipLow * 0.97) / price) * 100).toFixed(1), kind: 'first pullback bought', why: [`bought the first ${dipPct}%+ dip after the signal, on the first 5-minute close back up`, `dip low ${dipLow}`] };
  return null;
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
  const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: true, manual: why === 'closed by hand from the desk', at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); return { pos, actions };
}

// THE MINUTE BOT's entry and exit on 1-minute candles (bars1m: [[tSec, o, h, l, c, v], ...] oldest first; the last may still be forming).
// Entry: after the minute-scan signal, buy on the first CLOSED green 1-minute candle whose close beats the previous close, as long as the
// price is not more than chaseLimitPct above the signal; give up after waitMin minutes or if the price falls failPct under the signal.
export function decideMinute(setup, bars1m, price, nowSec, cfg = BOT) {
  const t0 = Date.parse(setup.at) / 1000, waitMin = cfg.minWaitMin ?? 15, failPct = cfg.minFailPct ?? 10, chase = cfg.chaseLimitPct ?? 10; if (!(price > 0)) return null;
  if (price < setup.zoneHigh * (1 - failPct / 100)) return { act: 'drop', why: `fell ${failPct}%+ under the signal price before any entry` };
  if (nowSec - t0 > waitMin * 60) return { act: 'drop', why: `no green minute within ${waitMin} minutes of the signal` };
  const B = (bars1m || []).filter((b) => b[0] + 60 <= nowSec); if (B.length < 2) return null; const last = B[B.length - 1], prev = B[B.length - 2]; if (last[0] + 60 <= t0) return null; // the green minute must close after the signal
  if (!(last[4] > last[1] && last[4] > prev[4])) return null; if (price > setup.zoneHigh * (1 + chase / 100)) return { act: 'drop', why: `already ${chase}%+ above the signal price: chased` };
  const stop = +(price * (1 - (cfg.fixedStopPct || 15) / 100)).toPrecision(6);
  return { act: 'buy', price, stop, stopPct: cfg.fixedStopPct || 15, kind: 'first green minute', why: [`first green 1-minute close above the previous close after the signal`, ...(setup.why || []).slice(0, 2)] };
}
// Exit: a 1-minute dump candle (down dumpBarPct or more on dumpVolX the median minute volume) is the exit, in profit or not; once up armPct the
// stop ratchets to 2% under the lowest low of the last trailBars closed minutes (never down); then the ordinary ladder rules (stop, clips, cuts).
export function manageMinute(pos0, q, bars1m, nowSec, cfg = BOT) {
  const price = n(q && q.priceUsd); if (!(price > 0) || !(pos0.remUnits > 0)) return { pos: pos0, actions: [] }; const B = (bars1m || []).filter((b) => b[0] + 60 <= nowSec), pos = { ...pos0, sells: [...(pos0.sells || [])] };
  const at = new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z', px = price * (1 - (pos.slipOut ?? cfg.slipPct) / 100);
  if (B.length >= 6) { const last = B[B.length - 1], vols = B.slice(-21, -1).map((b) => b[5] || 0).sort((a, b) => a - b), med = vols[Math.floor(vols.length / 2)] || 0, drop = (last[4] / last[1] - 1) * 100;
    if (drop <= -(cfg.dumpBarPct ?? 8) && (med <= 0 || last[5] >= (cfg.dumpVolX ?? 2) * med)) { const u = pos.remUnits, usd = u * px; pos.remUnits = 0; pos.bankedUsd += usd; const a = { why: `1-minute dump candle (${drop.toFixed(0)}% on ${med > 0 ? (last[5] / med).toFixed(1) + 'x' : 'heavy'} volume)`, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: true, at }; pos.sells.push(a); return { pos, actions: [a] }; }
    const peak = Math.max(pos.peak || price, price); if (!pos.free && peak >= pos.entry * (1 + (cfg.armPct ?? 0.2))) { const lo = Math.min(...B.slice(-(cfg.trailBars ?? 3)).map((b) => b[3])) * 0.98, t = +lo.toPrecision(6); if (t > pos.stop) { pos.stop = t; (pos.moves ||= []).push({ at, stop: t, why: `trail: 2% under the last ${cfg.trailBars ?? 3} minutes' low` }); } } }
  return manageLadder(pos, q, nowSec, cfg);
}
