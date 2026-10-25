// THE BOTTOMED-OUT BOT'S DAILY LIST (25 Oct). Once a day on GitHub: SOL's risk-on / risk-off switch (close over its 20-day average; off after
// two closes under) and every Solana meme coin on CoinGecko's category list that has just reached 70%, 80% or 90% under its highest daily
// close of the last year, with the backtest's own filters (90+ days old, $1m+ market cap, $50k+ a day traded over the month, no one-day
// 5x glitch in the data). "Just reached" = the first qualifying day at that depth was in the last 3 days, exactly the day the backtest's DCA
// buys. The bot (bot/bottoms.mjs) buys a $100 clip per new level. Output: docs/data/bottoms.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';
import { BBT, regimeMap, entriesFor } from './bottombt.mjs';
export const LEVELS = [0.7, 0.8, 0.9];
export const FRESH_D = 3;
const D = 86400;
// one coin's daily rows [[t, close, volUsd, mcap]] -> what is new today, or null
export function freshLevels(coin, reg, c = BBT, freshD = FRESH_D) {
  if (coin.length < c.minAgeD + 30) return null; const E = entriesFor(coin, reg, c), last = coin.length - 1, out = [];
  for (const l of LEVELS) { const e = E.dca.find((x) => x.dd >= l); if (e && last - e.i < freshD) { const s0 = Math.max(1, e.i - 5), seg = coin.slice(s0, last + 1), glitch = seg.some((x, n) => { const prev = coin[s0 + n - 1][1]; return prev > 0 && (x[1] / prev > c.maxDayX || prev / x[1] > c.maxDayX); }); if (!glitch) out.push({ l, i: e.i }); } }
  if (!out.length) return null; const ath = Math.max(...coin.map((x) => x[1])), x = coin[last], vol30 = coin.slice(-30).reduce((a, r) => a + (r[2] || 0), 0) / 30;
  return { fresh: out.map((o) => o.l), firstAt: new Date(coin[out[0].i][0] * 1000).toISOString().slice(0, 10), dd: +(1 - x[1] / ath).toFixed(3), price: x[1], mcap: Math.round(x[3] || 0), vol30: Math.round(vol30), ageD: coin.length >= 365 ? '365+' : coin.length }; }
export async function runBottoms({ dir = 'docs/data', env = process.env, now = Date.now(), log = console.log, pages = 4 } = {}) {
  const api = makeApi(env), list = [];
  for (let p = 1; p <= pages; p++) { const j = await api.getCG(`/coins/markets?vs_currency=usd&category=solana-meme-coins&order=market_cap_desc&per_page=250&page=${p}`); if (!Array.isArray(j) || !j.length) break; list.push(...j); }
  const solJ = await api.getCG('/coins/solana/market_chart?vs_currency=usd&days=120&interval=daily'), sol = ((solJ && solJ.prices) || []).map((x) => [Math.floor(x[0] / 1000), x[1]]); if (sol.length < 40) throw new Error('no SOL history');
  const reg = regimeMap(sol), days = [...reg.keys()].sort((a, b) => a - b), riskOn = reg.get(days[days.length - 1]) === true, C = sol.map((x) => x[1]), a20 = C.slice(-20).reduce((x, y) => x + y, 0) / 20;
  /* a coin less than 70% under its all-time high cannot be 70% under its high of the year */
  const cands = list.filter((x) => x && x.id && (x.ath_change_percentage ?? 0) <= -70 && (x.market_cap || 0) >= BBT.minMcapUsd), coins = [];
  for (const c of cands) { try { const j = await api.getCG(`/coins/${encodeURIComponent(c.id)}/market_chart?vs_currency=usd&days=365&interval=daily`); if (!j || !Array.isArray(j.prices)) continue;
      const vol = new Map((j.total_volumes || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]])), mc = new Map((j.market_caps || []).map((x) => [Math.floor(x[0] / 1000 / D), x[1]]));
      const rows = j.prices.map((x) => { const t = Math.floor(x[0] / 1000), d = Math.floor(t / D); return [t, x[1], vol.get(d) || 0, mc.get(d) || 0]; }).filter((x) => x[1] > 0), f = freshLevels(rows, reg); if (!f) continue;
      let token = null; try { const info = await api.getCG(`/coins/${encodeURIComponent(c.id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`); token = (info && info.platforms && info.platforms.solana) || null; } catch { /* no address: the bot skips it */ }
      coins.push({ id: c.id, symbol: String(c.symbol || '').toUpperCase(), token, ...f }); } catch (e) { log(`${c.id}: ${e.message}`); } }
  const out = { at: new Date(now).toISOString().slice(0, 19) + 'Z', riskOn, regimeWhy: `SOL $${C[C.length - 1].toFixed(2)} against its 20-day average $${a20.toFixed(2)}: ${riskOn ? 'risk-on' : 'risk-off'}`, checked: cands.length, of: list.length, coins };
  fs.writeFileSync(path.join(dir, 'bottoms.json'), JSON.stringify(out)); log(`bottoms: ${out.regimeWhy}; ${coins.length} coins newly at a DCA level (of ${cands.length} checked, ${list.length} listed)`); for (const c of coins) log(`  ${c.symbol}: ${Math.round(c.dd * 100)}% under its high, new level(s) ${c.fresh.map((l) => '-' + l * 100 + '%').join(', ')}${c.token ? '' : ' (no Solana address)'}`); return out; }
if (process.argv[1] && process.argv[1].endsWith('bottoms.mjs')) runBottoms().catch((e) => { console.log('bottoms failed: ' + (e.stack || e.message)); process.exit(1); });
