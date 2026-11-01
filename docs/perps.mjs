// THE PERPS PLANNER (1 Nov, Ryan: "mainly perps and futures with alts: search a ticker and give me entry, exit, TPs, SL; small $100 bets at
// 5-10x; limit orders only, never FOMO"). Pure functions: the page passes in a coin's candles (Gate.io USDT perpetuals, read live) and the
// contract's maintenance margin, and gets back a plan built from the chart's own structure:
//   ENTRY  a limit order at the nearest real support below the price (long) or resistance above it (short): a level the chart has
//          turned at before (daily and 4-hour swing points, merged when they sit within about 1.5% of each other). Never at the market.
//   STOP   just past that level, by half the daily average range (ATR), 2% at least, so ordinary noise does not take it out.
//   TPs    the resistance levels above the entry (supports below, for a short), each at least 1R further on; R multiples fill any gap.
//   GRADE  A only with the trend on its side (20 over 50-day average, price over the 50, and over the 200 where there is one) and 2R+ to TP2.
// Then the money: position size, the liquidation price, what the stop costs, what each TP pays, and the most leverage that keeps the
// liquidation well past the stop. It is a plan to check, not a signal: the alts backtest found no rule that beat holding BTC on both halves.
export const PERP = { pivotD: 3, pivot4: 4, mergePct: 1.5, nearPct: 1.2, farPct: 15, stopAtr: 0.5, minStopPct: 2, liqBuffer: 0.7, shares: [0.4, 0.3, 0.3], mmr: 0.005, makerFee: 0.0002, takerFee: 0.0005, minRR2: 2 };
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export function ema(xs, n) { if (xs.length < n) return null; let e = avg(xs.slice(0, n)); const k = 2 / (n + 1); for (const x of xs.slice(n)) e = x * k + e * (1 - k); return e; }
export function atr(bars, n = 14) { if (bars.length < n + 1) return null; const tr = bars.slice(1).map((b, i) => Math.max(b[2] - b[3], Math.abs(b[2] - bars[i][4]), Math.abs(b[3] - bars[i][4]))); return avg(tr.slice(-n)); }
// swing points: a candle whose high (or low) is the highest (lowest) of the k candles either side
export function pivots(bars, k) { const hi = [], lo = []; for (let i = k; i < bars.length - k; i++) { const w = bars.slice(i - k, i + k + 1); if (bars[i][2] === Math.max(...w.map((b) => b[2]))) hi.push({ px: bars[i][2], t: bars[i][0] }); if (bars[i][3] === Math.min(...w.map((b) => b[3]))) lo.push({ px: bars[i][3], t: bars[i][0] }); } return { hi, lo }; }
// merge nearby levels into zones; a zone touched more often, or on the daily chart, is stronger
export function zones(points, mergePct) { const s = [...points].sort((a, b) => a.px - b.px), out = [];
  for (const p of s) { const z = out[out.length - 1]; if (z && (p.px / z.hi - 1) * 100 <= mergePct) { z.hi = Math.max(z.hi, p.px); z.lo = Math.min(z.lo, p.px); z.n++; z.w += p.w; z.tfs.add(p.tf); } else out.push({ lo: p.px, hi: p.px, n: 1, w: p.w, tfs: new Set([p.tf]) }); }
  return out.map((z) => ({ lo: z.lo, hi: z.hi, mid: (z.lo + z.hi) / 2, touches: z.n, strength: z.w, tfs: [...z.tfs] })); }
export function levels(daily, h4, P = PERP) { const pd = pivots(daily, P.pivotD), p4 = h4 && h4.length ? pivots(h4, P.pivot4) : { hi: [], lo: [] };
  const pts = (arr, tf, w) => arr.map((x) => ({ px: x.px, tf, w })), all = [...pts(pd.hi, '1d', 2), ...pts(pd.lo, '1d', 2), ...pts(p4.hi, '4h', 1), ...pts(p4.lo, '4h', 1)];
  return zones(all, P.mergePct); }
export function trendOf(daily) { const c = daily.map((b) => b[4]), px = c[c.length - 1], e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const up = e20 != null && e50 != null && e20 > e50 && px > e50 && (e200 == null || px > e200), down = e20 != null && e50 != null && e20 < e50 && px < e50 && (e200 == null || px < e200);
  return { px, e20, e50, e200, label: up ? 'uptrend' : down ? 'downtrend' : 'mixed', up, down, ch30: c.length > 30 ? +((px / c[c.length - 31] - 1) * 100).toFixed(1) : null }; }
// the plan. side: 'long' | 'short'. price: the live (mark) price.
export function planTrade({ daily, h4, price, side = 'long', P = PERP }) {
  if (!daily || daily.length < 30 || !(price > 0)) return { none: 'not enough chart history yet (needs 30+ days)' };
  const L = side === 'long', A = atr(daily) || price * 0.04, Z = levels(daily, h4, P), T = trendOf(daily), dist = (px) => (L ? (price - px) / price : (px - price) / price) * 100;
  // entry: the nearest zone on the right side of the price, at least nearPct away (a limit, not a chase) and no further than farPct
  const cands = Z.filter((z) => { const d = dist(L ? z.hi : z.lo); return d >= P.nearPct && d <= P.farPct; }).sort((a, b) => dist(L ? a.hi : a.lo) - dist(L ? b.hi : b.lo));
  const strong = cands.find((z) => z.touches >= 2 || z.tfs.includes('1d')) || cands[0];
  if (!strong) return { none: `no clean ${L ? 'support' : 'resistance'} between ${P.nearPct}% and ${P.farPct}% ${L ? 'under' : 'over'} the price: wait for one to form, do not chase`, trend: T, atr: A, zones: Z };
  const entry = L ? strong.hi : strong.lo, stopRaw = L ? strong.lo - P.stopAtr * A : strong.hi + P.stopAtr * A, minStop = entry * P.minStopPct / 100, stop = L ? Math.min(stopRaw, entry - minStop) : Math.max(stopRaw, entry + minStop), R = Math.abs(entry - stop);
  // targets: the zones past the entry, each at least 1R further; the 90-day high (low) as a far target; R multiples fill any gap
  const beyond = Z.map((z) => (L ? z.lo : z.hi)).filter((px) => (L ? px > entry : px < entry)).sort((a, b) => (L ? a - b : b - a)), tps = [];
  for (const px of beyond) { const last = tps.length ? tps[tps.length - 1].px : entry; if (Math.abs(px - last) >= R * (tps.length ? 0.75 : 1)) tps.push({ px, from: 'level' }); if (tps.length === 3) break; }
  const ext = L ? Math.max(...daily.slice(-90).map((b) => b[2])) : Math.min(...daily.slice(-90).map((b) => b[3])), lastPx = () => (tps.length ? tps[tps.length - 1].px : entry);
  if (tps.length < 3 && (L ? ext > lastPx() + 0.75 * R : ext < lastPx() - 0.75 * R)) tps.push({ px: ext, from: L ? '90-day high' : '90-day low' });
  /* a first level more than 3R away is a long wait for the first sale: bank some at 2R on the way (Ryan's batches up to the old high) */
  if (!tps.length || Math.abs(tps[0].px - entry) > 3 * R) tps.unshift({ px: L ? entry + 2 * R : entry - 2 * R, from: '2R' });
  while (tps.length < 3) { const px = L ? lastPx() + 1.5 * R : lastPx() - 1.5 * R; if (!L && px <= 0) break; tps.push({ px, from: 'R step' }); }
  tps.length = Math.min(tps.length, 3);
  tps.forEach((t) => { t.r = +(Math.abs(t.px - entry) / R).toFixed(2); });
  const rr2 = tps[1] ? tps[1].r : tps[0] ? tps[0].r : 0, withTrend = L ? T.up : T.down, against = L ? T.down : T.up, stopPct = +((R / entry) * 100).toFixed(2);
  const grade = against ? 'C' : withTrend && rr2 >= P.minRR2 ? 'A' : rr2 >= P.minRR2 ? 'B' : 'C';
  const why = [`${L ? 'support' : 'resistance'} ${fx(strong.lo)}-${fx(strong.hi)}: turned there ${strong.touches} time${strong.touches > 1 ? 's' : ''} (${strong.tfs.join(' and ')} chart), ${dist(entry).toFixed(1)}% from the price`, `trend: ${T.label} (20-day ${T.e20 > T.e50 ? 'over' : 'under'} the 50-day${T.e200 ? `, price ${T.px > T.e200 ? 'over' : 'under'} the 200-day` : ''})`, `TP2 is ${rr2}R`];
  const verdict = grade === 'A' ? `A: the trend is with the trade and TP2 pays ${rr2}R. Set the limit and walk away.` : grade === 'B' ? `B: the levels work (${rr2}R to TP2) but the trend is ${T.label}: half size or wait.` : against ? `C: this ${side} fights the ${T.label}. Skip it, or look at the other side.` : `C: only ${rr2}R to TP2: not worth the risk. Wait for a better level.`;
  return { side, price, entry, stop, stopPct, tps, rr2, grade, verdict, why, trend: T, atr: A, zone: strong, zones: Z }; }
const fx = (x) => (x == null ? '—' : Number(Number(x).toPrecision(5)).toString());
// the money, for isolated margin on a linear USDT perpetual (a close estimate: the exchange's own figure differs slightly with fees)
export function sizeTrade(plan, { margin = 100, lev = 5, maxLoss = null, mmr = PERP.mmr, P = PERP } = {}) {
  if (!plan || plan.none) return null; const L = plan.side === 'long', e = plan.entry, d = plan.stopPct / 100;
  const liqOf = (lv) => (L ? e * (1 - 1 / lv + mmr) : e * (1 + 1 / lv - mmr)), notional = margin * lev, qty = notional / e, liq = liqOf(lev), liqPct = Math.abs(liq - e) / e * 100;
  const feesStop = notional * P.makerFee + notional * (1 - (L ? d : -d)) * P.takerFee, lossAtStop = notional * d + feesStop;
  const maxLev = Math.max(1, Math.floor(1 / (d / P.liqBuffer + mmr))), stopPastLiq = L ? plan.stop <= liq : plan.stop >= liq;
  let left = 1, banked = 0; const tps = plan.tps.map((t, i) => { const sh = i === plan.tps.length - 1 ? left : Math.min(left, P.shares[i] ?? 0.3); left -= sh; const g = qty * sh * Math.abs(t.px - e) - qty * sh * t.px * P.makerFee; banked += g; return { ...t, share: Math.round(sh * 100), usd: +g.toFixed(2), total: +banked.toFixed(2), roe: +((banked / margin) * 100).toFixed(0) }; });
  const fit = maxLoss > 0 ? Math.min(margin, maxLoss / (d + P.takerFee + P.makerFee) / lev) : null;
  const warn = []; if (stopPastLiq) warn.push(`At ${lev}x you would be liquidated at ${fx(liq)} BEFORE the stop at ${fx(plan.stop)}: use ${maxLev}x or less.`); else if (lev > maxLev) warn.push(`At ${lev}x the liquidation (${fx(liq)}) sits close behind the stop: ${maxLev}x or less keeps a safe gap.`);
  if (maxLoss > 0 && lossAtStop > maxLoss) warn.push(`The stop costs $${lossAtStop.toFixed(0)}, over your $${maxLoss} limit: use $${fit.toFixed(0)} margin at ${lev}x instead.`);
  return { margin, lev, notional: +notional.toFixed(2), qty, liq, liqPct: +liqPct.toFixed(1), lossAtStop: +lossAtStop.toFixed(2), lossPctMargin: +((lossAtStop / margin) * 100).toFixed(0), maxLev, tps, fitMargin: fit != null ? +fit.toFixed(2) : null, warn }; }
// the order ticket, to copy into the exchange
export function ticket(sym, plan, s) { if (!plan || plan.none || !s) return ''; const T = plan.tps;
  return [`${plan.side.toUpperCase()} ${sym}USDT perpetual · isolated ${s.lev}x · margin $${s.margin}`, `Limit entry ${fx(plan.entry)} (size ${fx(s.qty)} ${sym}, $${s.notional} position)`, `Stop loss ${fx(plan.stop)} (−${plan.stopPct}%, costs about $${s.lossAtStop.toFixed(0)})`, ...s.tps.map((t, i) => `TP${i + 1} ${fx(t.px)}: close ${t.share}% (${t.r}R, +$${t.usd.toFixed(0)})`), `After TP1: move the stop to the entry.`, `Liquidation about ${fx(s.liq)}.`].join('\n'); }
export { fx };
