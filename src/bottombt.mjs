// THE BOTTOMED-OUT BACKTEST (25 Oct, from ChillTRD's risk-on / risk-off framework): "in risk-off, tokens drop 70-90% from their high;
// the deeper you get, the more you DCA projects at a 70-90% discount (teams that have kept building) and watch for the flip back to
// risk-on." Replayed on a year of daily candles for Solana meme coins from CoinGecko's category list (up to 1,000 coins, ranked by
// market cap today, which still includes many that crashed and never came back), with SOL's own trend as the risk-on / risk-off switch.
// ENTRIES (a coin at least 90 days old with $50k+ a day of volume over the last month):
//   dd70 / dd80 / dd90: the coin is 70/80/90%+ under its all-time high close, SOL is risk-on (close over its 20-day average) and the
//     coin itself has turned (close over its own 20-day average, which is no longer falling)
//   dca: a third bought at -70%, -80% and -90% from the high, whatever the market (Chill's DCA, no timing)
//   random: a random day for the same coins (the luck baseline)
// EXITS: riskoff (out when SOL closes under its 20-day average two days running; 40% stop), hold60 (60 days, 50% stop), half2 (half at
// 2x, the rest out at risk-off; 40% stop), trail40 (40% off the best close). Costs 2% each way. Output docs/data/bottom-bt.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';

export const BBT = { minAgeD: 90, minVolUsd: 50000, minMcapUsd: 1000000, maxDayX: 5, inPct: 2, outPct: 2, sma: 20, reentryD: 14, maxHoldD: 180 };
const D = 86400, r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10), med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const sma = (xs, i, n) => (i + 1 < n ? null : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
// SOL's switch by day (true = risk-on), from daily closes [[t, close]]
export function regimeMap(sol, n = BBT.sma) { const C = sol.map((x) => x[1]), m = new Map(); let offRun = 0, on = true;
  for (let i = 0; i < sol.length; i++) { const a = sma(C, i, n); if (a == null) continue; if (C[i] > a) { on = true; offRun = 0; } else { offRun++; if (offRun >= 2) on = false; } m.set(Math.floor(sol[i][0] / D), on); } return m; }
// coin: [[t, close, volUsd, mcap]] daily, oldest first
export function entriesFor(coin, reg, c = BBT) { const C = coin.map((x) => x[1]), out = { dd70: [], dd80: [], dd90: [], dca: [] }; let ath = 0;
  for (let i = 0; i < coin.length; i++) { ath = Math.max(ath, C[i]); if (i < c.minAgeD) continue; const vol30 = coin.slice(i - 29, i + 1).reduce((a, x) => a + (x[2] || 0), 0) / 30; if (vol30 < c.minVolUsd) continue;
    if (!(coin[i][3] >= c.minMcapUsd)) continue; /* a real project, not a dust coin */
    const dd = 1 - C[i] / ath, a = sma(C, i, c.sma), a5 = sma(C, i - 5, c.sma), day = Math.floor(coin[i][0] / D), on = reg.get(day);
    const turned = a != null && a5 != null && C[i] > a && a >= a5;
    for (const [k, lvl] of [['dd70', 0.7], ['dd80', 0.8], ['dd90', 0.9]]) if (dd >= lvl && on && turned) out[k].push(i);
    out.dca.push({ i, dd }); }
  return out; }
export const EXITS = { riskoff: { stop: 0.4, regimeOut: true }, hold60: { stop: 0.5, maxD: 60 }, half2: { stop: 0.4, half: 2, regimeOut: true }, trail40: { stop: 0.4, trail: 0.4 } };
export function exitFrom(coin, i, reg, X, c = BBT) { const px = coin[i][1]; let rem = 1, got = 0, hi = px, j = i + 1, halfDone = false, seenOn = reg.get(Math.floor(coin[i][0] / D)) === true; /* a DCA bought in risk-off holds until the market has turned risk-on and back */ const sell = (f, p) => { got += f * p * (1 - c.outPct / 100); rem -= f; };
  for (; j < coin.length && j - i <= (X.maxD || c.maxHoldD); j++) { const p = coin[j][1], day = Math.floor(coin[j][0] / D);
    if (p <= px * (1 - X.stop)) { sell(rem, p); break; }
    if (X.half && !halfDone && p >= px * X.half) { sell(0.5, p); halfDone = true; }
    hi = Math.max(hi, p); if (X.trail && p <= hi * (1 - X.trail)) { sell(rem, p); break; }
    if (reg.get(day) === true) seenOn = true; if (X.regimeOut && seenOn && reg.get(day) === false) { sell(rem, p); break; } }
  const k = Math.min(j, coin.length - 1, i + (X.maxD || c.maxHoldD)); if (rem > 1e-9) sell(rem, coin[k][1]);
  const broken = coin.slice(Math.max(1, i), k + 1).some((x, n) => { const prev = coin[Math.max(0, i + n - 1)][1]; return prev > 0 && (x[1] / prev > c.maxDayX || prev / x[1] > c.maxDayX); }); /* a 5x jump in one day in CoinGecko's daily price is a data glitch on these coins, not a trade */
  return { broken, ret: (got / (1 + c.inPct / 100) / px - 1) * 100, days: k - i, peakX: Math.max(...coin.slice(i, k + 1).map((x) => x[1])) / px, t: coin[i][0] }; }
// the DCA: thirds at -70/-80/-90 (the first day each level is reached), each third held by the same exit from its own buy
export function dcaTrades(coin, list, reg, X, c = BBT) { const out = []; for (const lvl of [0.7, 0.8, 0.9]) { const e = list.find((x) => x.dd >= lvl); if (e) out.push({ ...exitFrom(coin, e.i, reg, X, c), w: 1 / 3 }); } return out; }
export function tradesFor(coin, reg, c = BBT, rnd = Math.random) { const E = entriesFor(coin, reg, c), out = {};
  for (const [xk, X] of Object.entries(EXITS)) {
    for (const ek of ['dd70', 'dd80', 'dd90']) { const L = (out[ek + ' / ' + xk] = []); let next = 0; for (const i of E[ek]) { if (i < next) continue; const r = exitFrom(coin, i, reg, X, c); L.push(r); next = i + r.days + c.reentryD; } }
    out['dca / ' + xk] = dcaTrades(coin, E.dca, reg, X, c);
    const ok = E.dca.map((x) => x.i); out['random / ' + xk] = ok.length ? [exitFrom(coin, ok[Math.floor(rnd() * ok.length)], reg, X, c)] : []; }
  return out; }
export function rec(T0) { const T = T0.filter((x) => !x.broken); if (!T.length) return { n: 0, broken: T0.length }; const R = T.map((x) => x.ret); return { n: T.length, avg: r1(R.reduce((a, b) => a + b, 0) / R.length), med: r1(med(R)), win: r1((R.filter((x) => x > 0).length / R.length) * 100), best: r1(Math.max(...R)), worst: r1(Math.min(...R)), x2: T.filter((x) => x.peakX >= 2).length, days: r1(med(T.map((x) => x.days))), broken: T0.length - T.length }; }
export function summarise(per) { const keys = [...new Set(per.flatMap((p) => Object.keys(p.res)))], ts = per.flatMap((p) => Object.values(p.res).flat().map((x) => x.t)).sort((a, b) => a - b), cut = ts[Math.floor(ts.length / 2)] || 0, combos = {};
  for (const k of keys) { const T = per.flatMap((p) => p.res[k] || []), a = rec(T), o = rec(T.filter((x) => x.t < cut)), n = rec(T.filter((x) => x.t >= cut)); combos[k] = { ...a, olderAvg: o.avg ?? null, newerAvg: n.avg ?? null, holds: o.n >= 15 && n.n >= 15 && o.avg > 0 && n.avg > 0 }; }
  const ranked = Object.entries(combos).filter(([k, r]) => r.n >= 20 && !k.startsWith('random')).sort((a, b) => b[1].avg - a[1].avg); return { combos, best: ranked.slice(0, 8).map(([k, r]) => ({ combo: k, ...r })) }; }
export async function runBottomBt({ dir = 'docs/data', env = process.env, now = Date.now(), log = console.log, pages = 4 } = {}) {
  const api = makeApi(env), list = [];
  for (let p = 1; p <= pages; p++) { const j = await api.getCG(`/coins/markets?vs_currency=usd&category=solana-meme-coins&order=market_cap_desc&per_page=250&page=${p}`); if (!Array.isArray(j) || !j.length) break; list.push(...j.map((x) => ({ id: x.id, symbol: x.symbol }))); }
  const solJ = await api.getCG('/coins/solana/market_chart?vs_currency=usd&days=365&interval=daily'), sol = ((solJ && solJ.prices) || []).map((x) => [Math.floor(x[0] / 1000), x[1]]); if (sol.length < 60) throw new Error('no SOL history');
  const reg = regimeMap(sol), per = []; let k = 0;
  for (const c of list) { try { const j = await api.getCG(`/coins/${encodeURIComponent(c.id)}/market_chart?vs_currency=usd&days=365&interval=daily`); if (j && Array.isArray(j.prices) && j.prices.length > BBT.minAgeD + 30) { const vol = new Map((j.total_volumes || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]])), mc = new Map((j.market_caps || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]]));
        const coin = j.prices.map((x) => { const t = Math.floor(x[0] / 1000), d = Math.floor(t / D); return [t, x[1], vol.get(d) || 0, mc.get(d) || 0]; }).filter((x) => x[1] > 0); per.push({ coin: c.symbol, res: tradesFor(coin, reg) }); } } catch (e) { log(`${c.symbol}: ${e.message}`); }
    if (++k % 100 === 0) log(`coins ${k}/${list.length}`); }
  const sum = summarise(per), daysOn = [...reg.values()].filter(Boolean).length, out = { at: new Date(now).toISOString().slice(0, 19) + 'Z', coins: list.length, tested: per.length, solRiskOnDays: daysOn, solDays: reg.size, cfg: BBT, exits: EXITS, ...sum };
  fs.writeFileSync(path.join(dir, 'bottom-bt.json'), JSON.stringify(out)); log(`bottomed-out backtest: ${per.length} coins tested of ${list.length}; SOL risk-on ${daysOn} of ${reg.size} days`);
  for (const b of sum.best) log(`  ${b.combo}: ${b.avg}% avg over ${b.n} (${b.win}% won, median ${b.med}%, older ${b.olderAvg}%, newer ${b.newerAvg}%)${b.holds ? ' HOLDS' : ''}`);
  for (const k of Object.keys(sum.combos).filter((x) => x.startsWith('random'))) log(`  ${k}: ${sum.combos[k].avg}% avg over ${sum.combos[k].n}`); return out; }
if (process.argv[1] && process.argv[1].endsWith('bottombt.mjs')) runBottomBt().catch((e) => { console.log('bottomed-out backtest failed: ' + (e.stack || e.message)); process.exit(1); });
