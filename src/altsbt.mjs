// THE ALTS BACKTEST (27 Oct, Ryan: "an auto trading bot for alts might be safer, and we can learn from our meme coin findings"). The same
// two ideas the meme-coin work left standing, replayed on the big coins, where the data is clean (years of daily closes, deep books, no
// honeypots), so a backtest can be trusted: (1) Chill's bottomed-out DCA: a clip each time a quality coin crosses 70%, 80% and 90% under its
// high of the last year, held through the next risk-on spell and sold when the market flips back to risk-off; (2) a plain trend rule: buy a
// close above the last 20 days' high while the market is risk-on, trail out. The market switch is BITCOIN's own trend (close over its
// 20-day average; off after two closes under). Every trade is measured against two bars it must clear: random days on the same coins, and
// HOLDING BITCOIN over the same days (an alt bot that does not beat holding BTC is not worth running). Both halves of the years, each
// half's best trade taken out (holdsTrim), trades still open at the end reported apart, data glitches smoothed first.
// SURVIVORSHIP: the coins are today's top 300 by market cap (stablecoins and wrapped coins left out), so coins that died are missing; the
// quality filter (a $100m+ market cap and $5m+ a day of volume ON THE DAY) keeps each entry to coins that were real at the time, which
// softens it but does not remove it. Said in the output. Output docs/data/alts-bt.json. Backtest only: no bot until a rule holds.
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';
import { regimeMap, exitFrom, dailyRows, cleanRows, rec, sma } from './bottombt.mjs';

export const ABT = { minAgeD: 90, minVolUsd: 5e6, minMcapUsd: 1e8, maxDayX: 5, inPct: 0.5, outPct: 0.5, sma: 20, reentryD: 14, maxHoldD: 180, highD: 365, trendD: 20, coins: 300 };
export const LEVELS = [0.7, 0.8, 0.9];
export const EXITS = { riskoff: { stop: 0.4, regimeOut: true }, hold60: { stop: 0.5, maxD: 60 }, hold180: { stop: 0.5, maxD: 180 }, half2: { stop: 0.4, half: 2, regimeOut: true }, trail40: { stop: 0.4, trail: 0.4 }, trail25: { stop: 0.25, trail: 0.25 } };
export const STABLE = new Set(['usdt', 'usdc', 'dai', 'usds', 'usde', 'fdusd', 'tusd', 'usdd', 'pyusd', 'usd1', 'busd', 'frax', 'gusd', 'usdp', 'lusd', 'eurc', 'eurs', 'xaut', 'paxg', 'usdy', 'susds', 'susde', 'buidl', 'ustc', 'crvusd', 'gho', 'rlusd', 'usdg', 'usd0', 'usdtb', 'usdx', 'bsc-usd']);
export const WRAPPED = /^(w|st|wst|cb|r|ez|we|ws|m|j|bn|sol|e)(btc|eth|sol|bnb|hype|avax|ftm|bch|ltc|xrp)$|^(steth|wsteth|weth|wbtc|cbbtc|cbeth|reth|tbtc|frxeth|sfrxeth|lseth|meth|ezeth|rseth|weeth|jitosol|msol|bsol|jupsol|binance-peg|bnsol|wbnb|wbeth|whype|wavax|solvbtc|lbtc|fbtc|ubtc)$/i;
const D = 86400, r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
// a coin's daily rows [[t, close, volUsd, mcap]] -> its entries. The quality filters are checked ON THE DAY of each entry.
export function altEntries(coin, reg, c = ABT) { const C = coin.map((x) => x[1]), out = { dca: [], trend: [], all: [] };
  for (let i = 0; i < coin.length; i++) { if (i < c.minAgeD) continue; const vol30 = coin.slice(i - 29, i + 1).reduce((a, x) => a + (x[2] || 0), 0) / 30, ok = vol30 >= c.minVolUsd && coin[i][3] >= c.minMcapUsd; if (!ok) continue;
    out.all.push(i); const hi = Math.max(...C.slice(Math.max(0, i - c.highD), i + 1)), hiPrev = Math.max(...C.slice(Math.max(0, i - 1 - c.highD), i)), dd = 1 - C[i] / hi, ddPrev = 1 - C[i - 1] / hiPrev, day = Math.floor(coin[i][0] / D), on = reg.get(day) === true;
    for (const l of LEVELS) if (dd >= l && ddPrev < l) out.dca.push({ i, l }); /* the day the coin CROSSES a level (it can come round again after a recovery) */
    if (on && i > c.trendD && C[i] > Math.max(...C.slice(i - c.trendD, i)) && sma(C, i, c.sma) != null && C[i] > sma(C, i, c.sma)) out.trend.push(i); }
  return out; }
// holding BTC over the same days as a trade: the bar every alt trade must clear
export function btcSame(btcByDay, t0, days) { const d0 = Math.floor(t0 / D), a = btcByDay.get(d0), b = btcByDay.get(d0 + days) ?? btcByDay.get(d0 + days - 1); return a > 0 && b > 0 ? (b / a - 1) * 100 : null; }
export function altTrades(coin, reg, btcByDay, c = ABT, rnd = Math.random) { const E = altEntries(coin, reg, c), out = {}, tag = (r) => ({ ...r, btc: btcSame(btcByDay, r.t, r.days) });
  for (const [xk, X] of Object.entries(EXITS)) {
    const L = (out['dca / ' + xk] = []), nextL = {}; for (const e of E.dca) { if (e.i < (nextL[e.l] ?? -1)) continue; const r = exitFrom(coin, e.i, reg, X, c); L.push(tag({ ...r, lvl: e.l })); nextL[e.l] = e.i + r.days + c.reentryD; } /* each level is its own clip (the DCA adds); a level comes round again only after its clip is out */
    const T = (out['trend / ' + xk] = []); let next = -1; for (const i of E.trend) { if (i < next) continue; const r = exitFrom(coin, i, reg, X, c); T.push(tag(r)); next = i + r.days + c.reentryD; }
    const R = (out['random / ' + xk] = []), n = Math.max(L.length, T.length, 1); for (let k = 0; k < n && E.all.length; k++) R.push(tag(exitFrom(coin, E.all[Math.floor(rnd() * E.all.length)], reg, X, c))); }
  return out; }
export function altSummary(per) { const keys = [...new Set(per.flatMap((p) => Object.keys(p.res)))], ts = per.flatMap((p) => Object.values(p.res).flat().map((x) => x.t)).sort((a, b) => a - b), cut = ts[Math.floor(ts.length / 2)] || 0, combos = {};
  for (const k of keys) { const T = per.flatMap((p) => p.res[k] || []), a = rec(T), o = rec(T.filter((x) => x.t < cut)), n = rec(T.filter((x) => x.t >= cut)), B = T.filter((x) => !x.openAtEnd && x.btc != null).map((x) => x.btc), btcAvg = B.length ? r1(B.reduce((x, y) => x + y, 0) / B.length) : null;
    combos[k] = { ...a, btcAvg, beatsBtc: a.exBest != null && btcAvg != null && a.exBest > btcAvg, olderAvg: o.avg ?? null, newerAvg: n.avg ?? null, olderExBest: o.exBest ?? null, newerExBest: n.exBest ?? null, holds: o.n >= 15 && n.n >= 15 && o.avg > 0 && n.avg > 0, holdsTrim: o.n >= 15 && n.n >= 15 && o.exBest > 0 && n.exBest > 0, cutAt: new Date(cut * 1000).toISOString().slice(0, 10) }; }
  const rnd = (ex) => combos['random / ' + ex] || {}, ranked = Object.entries(combos).filter(([k, r]) => r.n >= 30 && !k.startsWith('random')).map(([k, r]) => ({ combo: k, ...r, beatsRandom: r.exBest != null && rnd(k.split(' / ')[1]).avg != null && r.exBest > rnd(k.split(' / ')[1]).avg, randomAvg: rnd(k.split(' / ')[1]).avg ?? null })).sort((a, b) => (b.exBest ?? -1e9) - (a.exBest ?? -1e9));
  return { combos, best: ranked.slice(0, 10), passed: ranked.filter((r) => r.holdsTrim && r.beatsBtc && r.beatsRandom) }; }
export const isAlt = (x) => x && x.id && x.symbol && x.id !== 'bitcoin' && !STABLE.has(String(x.symbol).toLowerCase()) && !WRAPPED.test(String(x.symbol)) && !/wrapped|staked|bridged|peg|tokenized|liquid/i.test(String(x.name || ''));
export async function runAltsBt({ dir = 'docs/data', env = process.env, now = Date.now(), log = console.log } = {}) {
  const api = makeApi(env), list = []; for (let p = 1; p <= Math.ceil(ABT.coins / 250) + 1 && list.length < ABT.coins; p++) { const j = await api.getCG(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}`); if (!Array.isArray(j) || !j.length) break; for (const x of j) if (isAlt(x) && list.length < ABT.coins) list.push({ id: x.id, symbol: String(x.symbol).toUpperCase(), name: x.name }); }
  const rows = async (id) => { const j = await api.getCG(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=max&interval=daily`); if (!j || !Array.isArray(j.prices)) return null; const vol = new Map((j.total_volumes || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]])), mc = new Map((j.market_caps || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]])); return cleanRows(dailyRows(j.prices.map((x) => { const t = Math.floor(x[0] / 1000), d = Math.floor(t / D); return [t, x[1], vol.get(d) || 0, mc.get(d) || 0]; }).filter((x) => x[1] > 0)), ABT).rows; };
  const btc = await rows('bitcoin'); if (!btc || btc.length < 400) throw new Error('no BTC history'); const reg = regimeMap(btc.map((x) => [x[0], x[1]]), ABT.sma), btcByDay = new Map(btc.map((x) => [Math.floor(x[0] / D), x[1]])), per = []; let k = 0;
  for (const c of list) { try { const coin = await rows(c.id); if (coin && coin.length > ABT.minAgeD + 60) per.push({ coin: c.symbol, from: new Date(coin[0][0] * 1000).toISOString().slice(0, 10), res: altTrades(coin, reg, btcByDay) }); } catch (e) { log(`${c.symbol}: ${e.message}`); } if (++k % 50 === 0) log(`coins ${k}/${list.length}`); }
  const sum = altSummary(per), daysOn = [...reg.values()].filter(Boolean).length, from = per.map((p) => p.from).sort()[0] || null;
  const out = { at: new Date(now).toISOString().slice(0, 19) + 'Z', coins: list.length, tested: per.length, from, btcRiskOnDays: daysOn, btcDays: reg.size, cfg: ABT, exits: EXITS, caveat: 'the coins are today\'s top 300 by market cap, so coins that died are missing (survivorship); each entry needed a $100m+ market cap and $5m+ a day of volume on the day, which softens that but does not remove it', ...sum };
  fs.writeFileSync(path.join(dir, 'alts-bt.json'), JSON.stringify(out)); log(`alts backtest: ${per.length} coins of ${list.length}, data from ${from}; BTC risk-on ${daysOn} of ${reg.size} days; ${sum.passed.length} rules passed every bar`);
  for (const b of sum.best) log(`  ${b.combo}: ${b.avg}% avg over ${b.n} (${b.exBest}% without its best trade, median ${b.med}%, ${b.win}% won); holding BTC the same days ${b.btcAvg}%, random ${b.randomAvg}%; older ${b.olderExBest}%, newer ${b.newerExBest}% without their best${b.holdsTrim && b.beatsBtc && b.beatsRandom ? ' PASSED' : ''}`); return out; }
if (process.argv[1] && process.argv[1].endsWith('altsbt.mjs')) runAltsBt().catch((e) => { console.log('alts backtest failed: ' + (e.stack || e.message)); process.exit(1); });
