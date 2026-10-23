// THE MONDAY-RANGE BACKTEST (BTC and ETH): the exact detector the bots trade (bot/setups.mjs rangeSetup, Monday mode) walked hour by
// hour over a year of Coinbase candles, with no look-ahead (each hour sees only the candles closed by then), then the order and the
// trade played out on 15-minute candles the way the bot would:
//   the limit rests at the top of the order block for expireH hours; price through the stop first = cancelled; a 15-minute candle that
//   touches the limit fills it; if the same candle also reaches the stop, it counts as a loss (never the flattering order)
//   in the trade: stop, or Monday's high, or maxHoldH hours (out at the close); a candle that reaches both stop and target is a loss
//   costs: costPct of the price each way (0.1% default: slippage and fees on a deep pool), taken off every R
// Variants answer "which rule matters": the rules as written, the discount rule on, 2R minimum, and the previous-day range.
// Output docs/data/majors-bt.json (the council reads it). Run by .github/workflows/majors.yml (Sundays, or Run workflow).
import fs from 'node:fs';
import path from 'node:path';
import { rangeSetup, mondayStart, mondayStartTz } from '../bot/setups.mjs';
import { MAJORS } from '../bot/run.mjs';

export const BT = { days: 365, costPct: 0.06, borrowPctH: 0.002, products: { BTC: 'BTC-USD', ETH: 'ETH-USD' } }; // perp costs (Jupiter Perps: 0.06% each way, borrow hourly on the size)
export const VARIANTS = [
  { key: 'rules', label: 'the rules as written (UTC Monday, 3R-8R)', cfg: {} },
  { key: 'ny', label: 'New York\'s Monday instead of UTC', cfg: { rangeTz: 'America/New_York' } },
  { key: 'discount', label: 'plus the discount rule (order block under the midpoint)', cfg: { discount: true } },
  { key: 'rr2', label: '2R minimum instead of 3R', cfg: { rrMin: 2 } },
  { key: 'daily', label: 'previous-day range instead of Monday', cfg: { rangeMode: 'day', lastSweep: false } },
];
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
// first index with b[0] >= t (bars sorted by time)
const lowerBound = (B, t) => { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] < t) lo = m + 1; else hi = m; } return lo; };

// Coinbase Exchange candles: [time, low, high, open, close, volume], newest first, 300 a request. Returned as [t, o, h, l, c, v] oldest first.
export async function coinbaseCandles(product, granularity, fromSec, toSec, { fetcher = fetch, pause = 150 } = {}) {
  const out = new Map(); for (let end = toSec; end > fromSec; end -= granularity * 300) { const start = Math.max(fromSec, end - granularity * 300);
    let j = null; for (let a = 0; a < 4; a++) { try { const r = await fetcher(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`, { headers: { 'user-agent': 'rynoscan' }, signal: AbortSignal.timeout(20000) }); if (r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * (a + 1))); continue; } if (r.ok) { j = await r.json(); break; } } catch { await new Promise((res) => setTimeout(res, 1500)); } }
    for (const c of Array.isArray(j) ? j : []) out.set(+c[0], [+c[0], +c[3], +c[2], +c[1], +c[4], +c[5]]); if (pause) await new Promise((res) => setTimeout(res, pause)); }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}

// one coin, one rulebook: every trade the bot would have taken
export function simulate(h1, m15, cfg, { costPct = BT.costPct, borrowPctH = BT.borrowPctH, from = null, to = null } = {}) {
  const trades = [], used = new Set(); if (!h1.length || !m15.length) return trades; const t0 = from ?? h1[0][0] + 8 * 86400, t1 = to ?? h1[h1.length - 1][0] + 3600;
  for (let t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) {
    const wk = cfg.rangeMode === 'monday' ? mondayStartTz(t, cfg.rangeTz) : Math.floor(t / 86400) * 86400 - 86400, a = lowerBound(h1, wk - 3600), b = lowerBound(h1, t); if (b - a < 21) continue;
    const H = h1.slice(a, b), pre = rangeSetup(H, null, t, cfg); if (!pre || !pre.need15) continue;
    const M = m15.slice(lowerBound(m15, wk), lowerBound(m15, t)), r = rangeSetup(H, M, t, cfg); if (!r || r.dead || r.need15) continue; const key = r.sweepAt + ':' + r.msbAt; if (used.has(key)) continue; used.add(key);
    // the order: rests from t for expireH hours. A 15-minute candle that opens under the stop cancels it (the bot sees the price through the
    // stop first); one that touches the limit fills it, and if that same candle also reaches the stop it is a loss (never the kind order)
    const entry = r.zoneHigh, stop = r.stop, target = r.tp1, R = entry - stop, cost = entry * (costPct / 100); let i = lowerBound(m15, t), fillI = -1, gone = null;
    for (; i < m15.length && m15[i][0] < t + (cfg.expireH || 24) * 3600; i++) { const c = m15[i]; if (c[1] <= stop) { gone = 'cancelled: opened under the stop before the fill'; break; } if (c[3] <= entry) { fillI = i; break; } }
    if (fillI < 0) { trades.push({ setupAt: t, sweepAt: r.sweepAt, filled: false, why: gone || 'expired: no fill', rr: r.rr }); continue; }
    const fill = m15[fillI][0]; let exitPx = null, exitAt = null, exitWhy = null;
    if (m15[fillI][3] <= stop) { exitPx = stop; exitAt = fill; exitWhy = 'stop'; }
    for (let k = fillI + 1; exitPx == null && k < m15.length; k++) { const c = m15[k];
      if (c[3] <= stop) { exitPx = stop; exitAt = c[0]; exitWhy = 'stop'; } else if (c[2] >= target) { exitPx = target; exitAt = c[0]; exitWhy = 'target (Monday high)'; } else if (c[0] + 900 >= fill + (cfg.maxHoldH || 120) * 3600) { exitPx = c[4]; exitAt = c[0] + 900; exitWhy = 'time limit'; } }
    if (exitPx == null) { trades.push({ setupAt: t, fillAt: fill, filled: true, open: true, entry, stop, target, rr: r.rr }); break; }
    const borrow = entry * (borrowPctH / 100) * Math.max(0, exitAt - fill) / 3600, Rr = (exitPx - entry - 2 * cost - borrow) / R; trades.push({ setupAt: t, sweepAt: r.sweepAt, fillAt: fill, exitAt, filled: true, entry: +entry.toPrecision(7), stop: +stop.toPrecision(7), target: +target.toPrecision(7), exitPx, rr: r.rr, stopPct: r2((1 - stop / entry) * 100), R: r2(Rr), why: exitWhy });
    t = Math.ceil(exitAt / 3600) * 3600; // one trade at a time: the scan resumes after the exit
  }
  return trades;
}
// the short side: the same simulation on the price turned upside down (the detector's mirror, exactly as the bot builds it), then every
// level mapped back to real prices and the R recomputed in real dollars with real costs
const invBar = (b) => [b[0], 1 / b[1], 1 / b[3], 1 / b[2], 1 / b[4], b[5]];
export function simulateShort(h1, m15, cfg, { costPct = BT.costPct, borrowPctH = BT.borrowPctH, from = null, to = null } = {}) {
  return simulate(h1.map(invBar), m15.map(invBar), cfg, { costPct: 0, borrowPctH: 0, from, to }).map((x) => { if (!x.filled || x.R == null) return { ...x, side: 'short' };
    const e = 1 / x.entry, st = 1 / x.stop, tg = 1 / x.target, ex = 1 / x.exitPx, cost = e * costPct / 100, borrow = e * (borrowPctH / 100) * Math.max(0, x.exitAt - x.fillAt) / 3600;
    return { ...x, side: 'short', entry: +e.toPrecision(7), stop: +st.toPrecision(7), target: +tg.toPrecision(7), exitPx: ex, stopPct: r2((st / e - 1) * 100), rr: r2((e - tg) / (st - e)), R: r2((e - ex - 2 * cost - borrow) / (st - e)), why: x.why.replace('Monday high', 'Monday low') }; });
}
// the numbers that decide it: R per trade with a luck check (bootstrap), win rate, worst run, the R a year
export function stats(trades, { seed = 7, n = 4000 } = {}) {
  const T = trades.filter((x) => x.filled && x.R != null), Rs = T.map((x) => x.R), N = Rs.length, setups = trades.length; if (!N) return { setups, trades: 0, filledPct: 0 };
  const mean = Rs.reduce((a, b) => a + b, 0) / N; let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; const bs = [];
  for (let k = 0; k < n; k++) { let t = 0; for (let i = 0; i < N; i++) t += Rs[Math.floor(rnd() * N)]; bs.push(t / N); } bs.sort((a, b) => a - b);
  let eq = 0, peak = 0, dd = 0, run = 0, worstRun = 0; for (const x of Rs) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); run = x < 0 ? run + 1 : 0; worstRun = Math.max(worstRun, run); }
  return { setups, trades: N, filledPct: Math.round((N / setups) * 100), winPct: Math.round((Rs.filter((x) => x > 0).length / N) * 100), avgR: r2(mean), totalR: r2(eq), lo90: r2(bs[Math.floor(n * 0.05)]), hi90: r2(bs[Math.floor(n * 0.95)]), maxDDR: r2(dd), worstLosingRun: worstRun, avgStopPct: r2(T.reduce((a, x) => a + (x.stopPct || 0), 0) / N), targets: T.filter((x) => /target/.test(x.why)).length, stops: T.filter((x) => x.why === 'stop').length, timeouts: T.filter((x) => x.why === 'time limit').length };
}
// the year split in two by time: an edge has to show in both halves (on pure noise the luck range clears zero about one time in twenty)
export function halves(trades) { const T = trades.filter((x) => x.filled && x.R != null).sort((a, b) => a.fillAt - b.fillAt), h = Math.floor(T.length / 2), m = (xs) => (xs.length ? r2(xs.reduce((a, x) => a + x.R, 0) / xs.length) : null); return { first: m(T.slice(0, h)), second: m(T.slice(h)), n: T.length }; }
export function verdict(st) {
  if (!st || !st.trades) return 'no trades: the setup never completed in the period';
  if (st.trades < 20) return `only ${st.trades} trades: too few to call`;
  if (st.lo90 > 0 && st.halves && !(st.halves.first > 0 && st.halves.second > 0)) return `PROMISING, NOT PROVEN: ${st.avgR}R a trade over ${st.trades} with the luck range above zero, but one half of the year was not positive (${st.halves.first}R then ${st.halves.second}R)`;
  if (st.lo90 > 0) return `EDGE: ${st.avgR}R a trade over ${st.trades}, and even the unlucky end of the range (${st.lo90}R) is above zero`;
  if (st.hi90 < 0) return `NO EDGE: ${st.avgR}R a trade over ${st.trades}, and even the lucky end (${st.hi90}R) is below zero`;
  return `UNDECIDED: ${st.avgR}R a trade over ${st.trades}, range ${st.lo90}R to ${st.hi90}R includes zero`;
}
export async function runMajors({ out = path.join(process.env.OUT_DIR || 'docs/data', 'majors-bt.json'), days = BT.days, fetcher = fetch, log = console.log, now = Math.floor(Date.now() / 1000) } = {}) {
  const from = now - days * 86400 - 8 * 86400, result = { at: new Date(now * 1000).toISOString().slice(0, 19) + 'Z', days, costPct: BT.costPct, borrowPctH: BT.borrowPctH, source: 'Coinbase Exchange candles (BTC-USD, ETH-USD)', coins: {}, lines: [] }, all = {};
  for (const [coin, product] of Object.entries(BT.products)) {
    const h1 = await coinbaseCandles(product, 3600, from, now, { fetcher }), m15 = await coinbaseCandles(product, 900, from, now, { fetcher }); log(`${coin}: ${h1.length} hourly and ${m15.length} 15-minute candles`);
    result.coins[coin] = { h1: h1.length, m15: m15.length, variants: {} };
    for (const v of VARIANTS) { const cfg = { ...MAJORS, ...v.cfg }, L = simulate(h1, m15, cfg, { from: from + 8 * 86400 }), S = simulateShort(h1, m15, cfg, { from: from + 8 * 86400 }), row = {};
      for (const [side, tr] of [['long', L], ['short', S], ['both', [...L, ...S]]]) { const st = { ...stats(tr), halves: halves(tr) }; row[side] = { stats: st, verdict: verdict(st) }; ((all[v.key] ||= {})[side] ||= []).push(...tr); }
      result.coins[coin].variants[v.key] = { label: v.label, ...row, trades: [...L, ...S].filter((x) => x.filled).sort((a, b) => a.fillAt - b.fillAt).slice(-80) }; log(`  ${coin} ${v.key}: long ${row.long.verdict} | short ${row.short.verdict}`); } }
  const agg = (k, side) => { const tr = all[k][side]; return { ...stats(tr), halves: halves(tr) }; }, b = agg('rules', 'both'), bl = agg('rules', 'long'), bs = agg('rules', 'short');
  result.combined = { both: b, long: bl, short: bs, verdict: verdict(b) };
  result.lines.push(`MONDAY RANGE (UTC) on BTC and ETH, ${days} days of Coinbase candles, the bots' own detector, no look-ahead, perp costs (0.06% each way and hourly borrow), the unkind fill whenever a candle could go either way: ${verdict(b)}.`);
  result.lines.push(`By side: longs ${bl.avgR ?? '—'}R over ${bl.trades} (${bl.winPct ?? 0}% won); shorts ${bs.avgR ?? '—'}R over ${bs.trades} (${bs.winPct ?? 0}% won).`);
  for (const [coin, c] of Object.entries(result.coins)) { const s2 = c.variants.rules.both.stats; result.lines.push(`${coin}: ${s2.setups} setups, ${s2.trades} filled (${s2.winPct ?? 0}% won, ${s2.targets ?? 0} reached the other side of the range, ${s2.stops ?? 0} stopped, ${s2.timeouts ?? 0} timed out), ${s2.avgR ?? '—'}R a trade, ${s2.totalR ?? 0}R in total, deepest drop ${s2.maxDDR ?? 0}R (${s2.worstLosingRun ?? 0} losses in a row), typical stop ${s2.avgStopPct ?? '—'}% from the entry.`); }
  const vs = VARIANTS.slice(1).map((v) => { const s3 = agg(v.key, 'both'); return `${v.label}: ${s3.avgR ?? '—'}R over ${s3.trades}`; }); result.lines.push('Against the rules as written (' + (b.avgR ?? '—') + 'R over ' + b.trades + '): ' + vs.join('; ') + '.');
  if (b.avgStopPct > 0) { const spot = Math.min(1, 0.5 * b.avgStopPct); result.lines.push(`Leverage: the typical stop is ${b.avgStopPct}% away, so 1% of the pot at risk needs a position ${Math.round(100 / b.avgStopPct)}% of the pot. Spot capped at half the pot could only risk ${spot.toFixed(2)}% a trade; at 10x the full 1% is used with ${(10 / b.avgStopPct).toFixed(0)}% of the pot as margin. Leverage does not make the trade better, it lets the same R be worth the full 1%.`); }
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result)); return result;
}
if (process.argv[1] && process.argv[1].endsWith('majorsbt.mjs')) runMajors().then((r) => console.log(r.lines.join('\n')));
