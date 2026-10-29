// THE RUNNER BACKTEST (25 Oct, Ryan: "the scanner is good at finding things like BTC and CLAUDIA: find the best entries and exits"). Every
// coin the "High risk, high reward runners" section has listed or tracked (docs/data/runnerlog.json, with random coins as the control) is
// replayed on hourly candles from the moment the scan saw it, through a grid of ENTRIES (buy on the listing, buy the breakout of the
// base the coin built before it, buy the retest of that breakout) and EXITS (hold, half at 2x then a trail, thirds at 2x and 4x, a plain
// trail, the giveback rule). Costs are charged both ways. Output docs/data/runner-bt.json: every combination's record, split by the
// scan's checks, by chain, and into the older and newer half of the signals, so a winner has to hold on both halves to count.
// Pure maths (simulate, enter, exit, summarise) is exported for tests; the fetch (GeckoTerminal hourly candles) is in runRunnerBt.
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';

export const RBT = { windowH: 72, maxHoldH: 336, inPct: 2.5, outPct: 1.5, fixedStopPct: 25, maxStopPct: 35, boxMaxRangePct: 60, volX: 1.5, retestH: 24, retestTolPct: 5 };
const H = 3600, r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10), med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
// ENTRIES. bars: [[t, o, h, l, c, v]] oldest first, hourly. i0 = the first bar at or after the signal. Returns { i, px, stop, why } or null.
export const ENTRIES = {
  listing: (B, i0, c = RBT) => (B[i0] ? { i: i0, px: B[i0][1], stop: B[i0][1] * (1 - c.fixedStopPct / 100), why: 'bought at the next hourly open after the listing' } : null),
  box12: (B, i0, c) => boxBreak(B, i0, 12, c), box24: (B, i0, c) => boxBreak(B, i0, 24, c), box48: (B, i0, c) => boxBreak(B, i0, 48, c),
  retest24: (B, i0, c) => retest(B, i0, 24, c),
};
// the base (box) the coin built over the last n hours: an hourly CLOSE above its high on 1.5x the box's usual volume, bought at the next open; stop under the box
export function boxAt(B, i, n, c = RBT) { if (i < n || i >= B.length - 1) return null; const box = B.slice(i - n, i), hi = Math.max(...box.map((b) => b[2])), lo = Math.min(...box.map((b) => b[3])), v = med(box.map((b) => b[5]));
  if (!(lo > 0) || (hi / lo - 1) * 100 > c.boxMaxRangePct) return null; if (!(B[i][4] > hi && B[i][5] >= c.volX * v)) return null; const px = B[i + 1][1], stop = Math.max(lo * 0.98, px * (1 - c.maxStopPct / 100)); if (!(px > 0) || stop >= px) return null;
  return { i: i + 1, px, stop, boxHi: hi, boxLo: lo, why: `${n}h base broken ($${hi.toPrecision(3)}), bought at the next open` }; }
export function boxBreak(B, i0, n, c = RBT) { for (let i = Math.max(i0, n); i < B.length - 1 && B[i][0] < B[i0][0] + c.windowH * H; i++) { const e = boxAt(B, i, n, c); if (e) return e; } return null; }
// the retest: after the breakout, the first hour that dips back to the old box top (within 5%) and closes above it, bought at the next open
export function retest(B, i0, n, c = RBT) {
  const b = boxBreak(B, i0, n, c); if (!b) return null;
  for (let i = b.i; i < Math.min(B.length - 1, b.i + c.retestH); i++) { const x = B[i]; if (x[3] <= b.boxHi * (1 + c.retestTolPct / 100) && x[4] >= b.boxHi) { const px = B[i + 1][1], stop = Math.max(Math.min(x[3], b.boxHi * 0.92) * 0.98, px * (1 - c.maxStopPct / 100)); if (stop >= px) continue; return { i: i + 1, px, stop, why: 'retest of the broken base held, bought at the next open' }; } }
  return null; }
// EXITS on hourly bars from the entry bar: stop checked on the low first (worst case), then targets on the high, trails on closes.
export const EXITS = {
  hold7: { shares: [], trail: null, maxH: 168 },
  half2_t30: { mults: [2], shares: [0.5], trail: 0.3, beAfter: true },
  half2_t50: { mults: [2], shares: [0.5], trail: 0.5, beAfter: true },
  thirds_2_4_t50: { mults: [2, 4], shares: [1 / 3, 1 / 3], trail: 0.5, beAfter: true },
  trail20: { shares: [], trail: 0.2, trailFromStart: true },
  all_at_2x: { mults: [2], shares: [1], trail: null },
  giveback: { shares: [], giveback: { arm: 0.5, keep: 0.5 } },
  /* 30 Oct: the scanner's paper books' own exits, exactly (docs/exits.mjs PROFILES), so the runner backtest can test the books' claim on
     every signal the list has made and on the random coins: their own stop, their sales, break-even after the first, the trail starting
     after the first sale, their time limit */
  claude: { stopPct: 0.18, mults: [1.4, 2, 3], shares: [0.25, 0.25, 0.25], trail: 0.35, trailFrom: 'first', beAfter: true, maxH: 120 },
  ryan: { stopPct: 0.20, mults: [1.69, 2.5, 3.6], shares: [0.3, 0.3, 0.4], trail: null, beAfter: false, maxH: 168 },
  clips: { stopPct: 0.20, mults: [1.5, 2, 2.5, 3, 4], shares: [0.2, 0.2, 0.2, 0.2, 0.1], trail: 0.45, trailFrom: 'first', beAfter: false, maxH: 168 },
};
export function exit(B, e, X, c = RBT) {
  let rem = 1, got = 0, stop = X.stopPct ? e.px * (1 - X.stopPct) : e.stop, hiC = e.px, hits = 0; const mults = X.mults || [], shares = X.shares || [], maxH = X.maxH || c.maxHoldH, out = (frac, px, why) => { got += frac * px * (1 - c.outPct / 100); rem -= frac; return why; };
  let why = null, lastI = e.i;
  for (let i = e.i; i < B.length && B[i][0] < B[e.i][0] + maxH * H; i++) { const [, o, h, l, cl] = B[i]; lastI = i;
    if (l <= stop) { why = out(rem, Math.min(o, stop), hits ? 'break-even/trail stop' : 'stop'); break; }
    while (hits < mults.length && h >= e.px * mults[hits] && rem > 1e-9) { out(Math.min(rem, shares[hits]), e.px * mults[hits], 'clip'); hits++; if (X.beAfter) stop = Math.max(stop, e.px); }
    if (rem <= 1e-9) { why = 'all clipped'; break; }
    hiC = Math.max(hiC, cl);
    if (X.trail && (X.trailFromStart || (X.trailFrom === 'first' ? hits >= 1 : hits >= mults.length && mults.length)) && cl <= hiC * (1 - X.trail)) { why = out(rem, cl, `trail ${Math.round(X.trail * 100)}%`); break; }
    if (X.giveback && hiC >= e.px * (1 + X.giveback.arm) && cl <= e.px * (1 + (hiC / e.px - 1) * (1 - X.giveback.keep))) { why = out(rem, cl, 'giveback'); break; } }
  if (rem > 1e-9) { const px = B[lastI] ? B[lastI][4] : e.px; why = out(rem, px, why || 'time'); }
  return { ret: (got / (1 + c.inPct / 100) / e.px - 1) * 100, why, heldH: (B[lastI][0] - B[e.i][0]) / H, peakX: Math.max(...B.slice(e.i, lastI + 1).map((b) => b[2])) / e.px };
}
// THE UNIVERSE STUDY: the same base-breakout entries anywhere in the last ~40 days of every coin the scanner watches (not only at a
// runner-list signal), one trade at a time per coin and rule: hundreds of breakouts instead of a few dozen signals. Variants of the
// base (12/24/48 hours; at most 30% or 60% tall; breakout volume 1.5x or 2.5x the base's usual) x every exit.
// WHAT IT IS AND IS NOT (25 Oct review): the coins are the ones the scanner watches TODAY, which are mostly there because they already
// ran, so a replay of their past is survivorship: the first version's +16.8% a trade was two-thirds one Robinhood-chain coin's 50x, and
// the same rule from real signal times (the signal study below) lost money. So the study now keeps two books: LOOKBACK (everything, for
// curiosity) and FORWARD (only breakouts AFTER the scanner first saw the coin, docs/data/universe-seen.json: the honest test, which grows
// week by week). Only FORWARD can feed a rulebook. Both: a trade still open when the data ends is reported apart, not counted; a RANDOM
// baseline (random hours on the same coins, the same exits) is kept per exit; and a rule only HOLDS when both halves make money without
// each half's best trade (holdsTrim).
export const UNI = { boxes: [12, 24, 48], ranges: [30, 60], vols: [1.5, 2.5] };
export function universeTrades(B, c = RBT, U = UNI, { seenSec = null, rnd = Math.random } = {}) { const out = {}, maxH = Math.max(...Object.values(EXITS).map((X) => X.maxH || c.maxHoldH)), endSec = B.length ? B[B.length - 1][0] : 0;
  for (const n of U.boxes) for (const rg of U.ranges) for (const vx of U.vols) { const cc = { ...c, boxMaxRangePct: rg, volX: vx }, ek = `box${n} ≤${rg}% vol${vx}x`;
    for (const [xk, X] of Object.entries(EXITS)) { const L = (out[ek + ' / ' + xk] = []); let i = n; while (i < B.length - 2) { const e = boxAt(B, i, n, cc); if (!e) { i++; continue; } const r = exit(B, e, X, cc), t = B[e.i][0]; L.push({ ...r, t, fwd: seenSec != null && t >= seenSec, open: t + (X.maxH || c.maxHoldH) * H > endSec && r.why === 'time' }); i = e.i + Math.max(1, Math.round(r.heldH)) + 1; } } }
  /* the luck baseline: as many random hours as the plainest rule found breakouts, the same exits, the same coin */
  const nR = Math.max(1, (out['box24 ≤60% vol1.5x / hold7'] || []).length); for (const [xk, X] of Object.entries(EXITS)) { const L = (out['random / ' + xk] = []); for (let k = 0; k < nR && B.length > 30; k++) { const i = 24 + Math.floor(rnd() * (B.length - 26)), px = B[i + 1][1]; if (!(px > 0)) continue; const e = { i: i + 1, px, stop: px * (1 - c.maxStopPct / 100) }, r = exit(B, e, X, c), t = B[e.i][0]; L.push({ ...r, t, fwd: seenSec != null && t >= seenSec, open: t + (X.maxH || c.maxHoldH) * H > endSec && r.why === 'time' }); } }
  return out; }
function uniBook(perPool, pick) { const keys = [...new Set(perPool.flatMap((p) => Object.keys(p.res)))], all = perPool.flatMap((p) => Object.values(p.res).flat().filter(pick).map((x) => x.t)).sort((a, b) => a - b), cut = all[Math.floor(all.length / 2)] || 0, out = {};
  for (const k of keys) { const T0 = perPool.flatMap((p) => (p.res[k] || []).filter(pick).map((x) => ({ ...x, chain: p.chain }))), T = T0.filter((x) => !x.open), a = record(T), o = record(T.filter((x) => x.t < cut)), nw = record(T.filter((x) => x.t >= cut)), rh = record(T.filter((x) => /robinhood/i.test(x.chain))), so = record(T.filter((x) => /solana/i.test(x.chain)));
    out[k] = { ...a, openAtEnd: T0.length - T.length, olderAvg: o.avg ?? null, newerAvg: nw.avg ?? null, olderExBest: o.exBest ?? null, newerExBest: nw.exBest ?? null, holds: o.n >= 20 && nw.n >= 20 && o.avg > 0 && nw.avg > 0, holdsTrim: o.n >= 20 && nw.n >= 20 && o.exBest > 0 && nw.exBest > 0, robinhood: rh.n ? { n: rh.n, avg: rh.avg } : null, solana: so.n ? { n: so.n, avg: so.avg } : null }; }
  const ranked = Object.entries(out).filter(([k, r]) => r.n >= 30 && !k.startsWith('random')).sort((a, b) => b[1].avg - a[1].avg); return { combos: out, best: ranked.slice(0, 10).map(([k, r]) => ({ combo: k, ...r })), worst: ranked.slice(-3).map(([k, r]) => ({ combo: k, ...r })) }; }
export function universeSummary(perPool) { const look = uniBook(perPool, () => true), fwd = uniBook(perPool, (x) => x.fwd); return { ...look, lookback: true, forward: { ...fwd, pools: new Set(perPool.filter((p) => Object.values(p.res).flat().some((x) => x.fwd)).map((p) => p.coin)).size } }; }
// one signal through every entry x exit
export function simulate(B, signalSec, c = RBT) {
  const i0 = B.findIndex((b) => b[0] >= Math.ceil(signalSec / H) * H); if (i0 < 0) return {}; const out = {};
  for (const [ek, ef] of Object.entries(ENTRIES)) { const e = ef(B, i0, c); for (const [xk, X] of Object.entries(EXITS)) out[ek + ' / ' + xk] = e ? { ...exit(B, e, X, c), waitH: (B[e.i][0] - B[i0][0]) / H } : null; }
  return out; }
// the record of one combination over a set of signals
export function record(rows) { const t = rows.filter(Boolean); if (!t.length) return { n: 0 }; const R = t.map((x) => x.ret), top = Math.max(...R);
  return { n: t.length, avg: r1(R.reduce((a, b) => a + b, 0) / R.length), exBest: R.length > 1 ? r1((R.reduce((a, b) => a + b, 0) - top) / (R.length - 1)) : null, med: r1(med(R)), win: r1((R.filter((x) => x > 0).length / R.length) * 100), best: r1(Math.max(...R)), worst: r1(Math.min(...R)), x2: t.filter((x) => x.peakX >= 2).length, heldH: r1(med(t.map((x) => x.heldH))) }; }
export function summarise(sims) {
  const groups = { 'listed (3+ checks)': (s) => !s.control && s.passed >= 3, 'watch (2 checks)': (s) => !s.control && s.passed === 2, 'all scanned': (s) => !s.control, 'random control': (s) => s.control, 'Robinhood, scanned': (s) => !s.control && /robinhood/i.test(s.chain), 'Solana, scanned': (s) => !s.control && /solana/i.test(s.chain) };
  const keys = Object.keys((sims.find((s) => s.res && Object.keys(s.res).length) || {}).res || {}), sorted = [...sims].sort((a, b) => Date.parse(a.signalAt) - Date.parse(b.signalAt)), cut = sorted[Math.floor(sorted.length / 2)] ? Date.parse(sorted[Math.floor(sorted.length / 2)].signalAt) : 0, out = {};
  for (const [g, f] of Object.entries(groups)) { const S = sims.filter(f); out[g] = { signals: S.length, combos: Object.fromEntries(keys.map((k) => { const all = record(S.map((s) => s.res[k])), older = record(S.filter((s) => Date.parse(s.signalAt) < cut).map((s) => s.res[k])), newer = record(S.filter((s) => Date.parse(s.signalAt) >= cut).map((s) => s.res[k]));
    return [k, { ...all, triggered: S.length ? r1((all.n / S.length) * 100) : null, olderAvg: older.avg ?? null, newerAvg: newer.avg ?? null, holds: older.n >= 5 && newer.n >= 5 && older.avg > 0 && newer.avg > 0 }]; })) }; }
  const L = out['listed (3+ checks)'] || { combos: {} }, ranked = Object.entries(L.combos).filter(([, r]) => r.n >= 10).sort((a, b) => b[1].avg - a[1].avg);
  return { groups: out, best: ranked.slice(0, 8).map(([k, r]) => ({ combo: k, ...r })), worst: ranked.slice(-3).map(([k, r]) => ({ combo: k, ...r })) }; }
// the fetch: one GeckoTerminal hourly history per pool (the last ~40 days), every signal in the runner log
export async function runRunnerBt({ dir = 'docs/data', env = process.env, now = Date.now(), log = console.log } = {}) {
  const api = makeApi(env), rl = JSON.parse(fs.readFileSync(path.join(dir, 'runnerlog.json'), 'utf8')), sigs = rl.filter((x) => x && x.pool && x.net && x.signalAt && Date.parse(x.signalAt) < now - 6 * H * 1000);
  let uni = [], seen = {}; try { uni = JSON.parse(fs.readFileSync(path.join(dir, 'universe.json'), 'utf8')).filter((x) => x && x.pool && x.net).map((x) => ({ pool: x.pool, net: x.net, chain: x.chain, coin: x.sym })); } catch { /* none */ }
  try { seen = JSON.parse(fs.readFileSync(path.join(dir, 'universe-seen.json'), 'utf8')).seen || {}; } catch { /* none yet */ }
  for (const s of sigs) { const k = s.net + ':' + s.pool; if (!s.control && (!seen[k] || s.signalAt < seen[k])) seen[k] = s.signalAt; }
  const pools = [...new Map([...sigs, ...uni].map((s) => [s.net + ':' + s.pool, s])).values()], bars = new Map(); let k = 0;
  for (const p of pools) { try { const j = await api.get(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`), raw = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || []; bars.set(p.net + ':' + p.pool, raw.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0])); } catch (e) { log(`${p.coin}: ${e.message}`); } if (++k % 25 === 0) log(`candles ${k}/${pools.length}`); }
  const sims = sigs.map((s) => { const B = bars.get(s.net + ':' + s.pool) || []; return { coin: s.coin, chain: s.chain, signalAt: s.signalAt, passed: s.passed ?? 0, control: !!s.control, listed: !!s.listed, bars: B.length, res: B.length > 30 ? simulate(B, Date.parse(s.signalAt) / 1000) : {} }; }).filter((s) => Object.keys(s.res).length);
  const perPool = pools.map((p) => { const k = p.net + ':' + p.pool, sa = seen[k] ? Date.parse(seen[k]) / 1000 : null; return { coin: p.coin, chain: p.chain, res: (bars.get(k) || []).length > 60 ? universeTrades(bars.get(k), RBT, UNI, { seenSec: sa }) : {} }; }).filter((p) => Object.keys(p.res).length), universe = { pools: perPool.length, ...universeSummary(perPool) };
  const sum = summarise(sims), outp = { universe, at: new Date(now).toISOString().slice(0, 19) + 'Z', signals: sigs.length, simulated: sims.length, pools: pools.length, cfg: RBT, entries: Object.keys(ENTRIES), exits: EXITS, ...sum,
    trades: sims.map((s) => ({ coin: s.coin, chain: s.chain, signalAt: s.signalAt, passed: s.passed, control: s.control, res: Object.fromEntries(Object.entries(s.res).map(([k2, v]) => [k2, v ? [r1(v.ret), r1(v.peakX), v.why, r1(v.heldH), r1(v.waitH)] : null])) })) };
  fs.writeFileSync(path.join(dir, 'runner-bt.json'), JSON.stringify(outp)); log(`runner backtest: ${sims.length} signals simulated over ${pools.length} pools`); for (const b of universe.best) log(`  LOOKBACK (survivorship) ${b.combo}: ${b.avg}% avg over ${b.n}, ${b.exBest}% without its best trade (${b.win}% won; older ${b.olderAvg}%, newer ${b.newerAvg}%)`); for (const b of universe.forward.best) log(`  FORWARD ${b.combo}: ${b.avg}% avg over ${b.n}, ${b.exBest}% without its best trade (older ${b.olderAvg}%, newer ${b.newerAvg}%)${b.holdsTrim ? ' HOLDS' : ''}`); for (const [k, r] of Object.entries(universe.forward.combos).filter(([k]) => k.startsWith('random'))) if (r.n) log(`  FORWARD ${k}: ${r.avg}% over ${r.n}`); for (const b of sum.best) log(`  ${b.combo}: ${b.avg}% avg over ${b.n} (${b.win}% won; older half ${b.olderAvg}%, newer ${b.newerAvg}%)${b.holds ? ' HOLDS ON BOTH HALVES' : ''}`); return outp; }
if (process.argv[1] && process.argv[1].endsWith('runnerbt.mjs')) runRunnerBt().catch((e) => { console.log('runner backtest failed: ' + (e.stack || e.message)); process.exit(1); });
