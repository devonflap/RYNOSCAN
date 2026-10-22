// THE GIANTS STUDY: reverse-engineer the coins that ran to the top (WIF, POPCAT, ai16z, HOOKR, CASHCAT, TROLL, ...) from their full
// price history, and ask the only questions that matter for "fuck-all in, a shit-load out":
//   1 how long from launch to the top, and how many times did the chart fall 30% / 50% on the WAY to the top (a rule that sells on a 50%
//     giveback is shaken out of a giant early: this is the cost of the HOOKR rule, measured on the coins that mattered)
//   2 which entry day caught the ride: day 1, day 3, day 7, the first 30% pullback after a 2x
//   3 what each exit rule would have pulled out of a $500 entry: hold-and-ride-it-back (the human), the runner's clips plus the trailing
//     take-profit, a plain trail at 35% / 50% / 65% off the high, the giveback rule; and the moonbag question: how wide must the trail be
//     for the last 20% to survive a giant's dips
//   4 what the first days looked like (volume against market cap, candle sizes) so the scanner can look for the same shape early
// Pure maths in here (studyChart, summarise); the fetch (GeckoTerminal daily candles from the pool's birth) in runGiants. Output:
// docs/data/giants.json, read by the council's scout hat and shown on the dashboard. Runs from .github/workflows/giants.yml.
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';

export const GIANTS = { entryDays: [0, 1, 2, 3, 5, 7, 14], stake: 500, dipPcts: [30, 50, 70], trails: [0.35, 0.5, 0.65], clips: { mults: [2, 3, 4, 5], shares: [0.2, 0.2, 0.2, 0.2] } };
const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100), r0 = (x) => (x == null || !isFinite(x) ? null : Math.round(x));

// bars: [[tSec, o, h, l, c, v], ...] oldest first, daily. Everything is measured on closes except the peak (the high) and the dips (lows).
export function studyChart(bars, cfg = GIANTS) {
  const B = (bars || []).filter((b) => b && b[4] > 0).sort((a, b) => a[0] - b[0]); if (B.length < 5) return null;
  const peakI = B.reduce((m, b, i) => (b[2] > B[m][2] ? i : m), 0), peak = B[peakI][2], c0 = B[0][4];
  // the route to the top: every pullback from a running high, on lows, before the final peak
  const dips = []; let hi = B[0][2], hiI = 0, lo = B[0][3], loI = 0; for (let i = 1; i <= peakI; i++) { const b = B[i]; if (b[2] > hi) { if (hi > 0 && lo < hi) dips.push({ pct: r0((1 - lo / hi) * 100), days: loI - hiI, atDay: hiI }); hi = b[2]; hiI = i; lo = b[3]; loI = i; } else if (b[3] < lo) { lo = b[3]; loI = i; } }
  const dipCount = Object.fromEntries(cfg.dipPcts.map((p) => [p, dips.filter((d) => d.pct >= p).length])), worstDip = dips.length ? Math.max(...dips.map((d) => d.pct)) : 0;
  // after the top
  const after = B.slice(peakI); const daysTo = (pct) => { const i = after.findIndex((b) => b[4] <= peak * (1 - pct / 100)); return i < 0 ? null : i; };
  const last = B[B.length - 1][4];
  // entry days: the multiple from that day's close to the peak high, and to today
  const entries = cfg.entryDays.filter((d) => d < B.length).map((d) => ({ day: d, toPeak: r2(peak / B[d][4]), toNow: r2(last / B[d][4]), daysToPeak: peakI - d }));
  // the first 30% pullback after a 2x from day 0: buy the close of the day the pullback ends (first up close after a 30% dip from the running high)
  let pb = null; { let h = 0, hI = -1, dipped = false; for (let i = 0; i < B.length; i++) { if (B[i][2] > h) { h = B[i][2]; hI = i; dipped = false; } if (h >= c0 * 2 && B[i][3] <= h * 0.7) dipped = true; if (dipped && i > 0 && B[i][4] > B[i - 1][4]) { pb = { day: i, price: B[i][4], toPeak: r2(peak / B[i][4]), toNow: r2(last / B[i][4]) }; break; } } }
  // exits from a $500 entry on day 1's close (day 0 is the launch candle), run on daily closes with the high/low of each day for the trail
  const eI = Math.min(1, B.length - 1), E = B[eI][4], units = cfg.stake / E, sims = {};
  sims.hold = { out: r0(units * last), why: 'never sold (rode it to wherever it is now)' };
  sims.peakSold = { out: r0(units * peak), why: 'sold the exact top (nobody does)' };
  for (const t of cfg.trails) { let h = E, out = null, day = null; for (let i = eI + 1; i < B.length; i++) { h = Math.max(h, B[i][2]); if (B[i][3] <= h * (1 - t)) { out = units * h * (1 - t); day = i; break; } } sims['trail' + Math.round(t * 100)] = { out: r0(out ?? units * last), day, why: `everything sold ${Math.round(t * 100)}% off the running high` }; }
  { // the runner's clips, then the last 20% trails: at 35% (the runner today) and at the other widths
    for (const t of cfg.trails) { let rem = units, cash = 0, h = E, hit = 0, day = null; const tg = cfg.clips.mults.map((m) => E * m);
      for (let i = eI + 1; i < B.length; i++) { while (hit < tg.length && B[i][2] >= tg[hit]) { cash += units * cfg.clips.shares[hit] * tg[hit]; rem -= units * cfg.clips.shares[hit]; hit++; } h = Math.max(h, B[i][2]); if (rem > 0 && hit === tg.length && B[i][3] <= h * (1 - t)) { cash += rem * h * (1 - t); rem = 0; day = i; break; } if (rem > 0 && hit < tg.length && B[i][3] <= E * 0.8 && hit === 0) { cash += rem * E * 0.8; rem = 0; day = i; break; } }
      sims['clipsTrail' + Math.round(t * 100)] = { out: r0(cash + rem * last), day, clips: hit, why: `20% at 2x, 3x, 4x, 5x, the last 20% trails ${Math.round(t * 100)}% off its high (stop 20% before the first clip)` }; } }
  { // the giveback rule alone: once up 30%, out when half the best gain is given back (on closes)
    let h = E, out = null, day = null; for (let i = eI + 1; i < B.length; i++) { h = Math.max(h, B[i][2]); const g = h / E - 1; if (g >= 0.3 && B[i][4] <= E * (1 + g * 0.5)) { out = units * B[i][4]; day = i; break; } } sims.giveback = { out: r0(out ?? units * last), day, why: 'once up 30%, half the best gain given back: out' }; }
  // the first days' shape: volume against the close-price market proxy (volume / close, a turnover proxy when supply is unknown) and candle size
  const first = B.slice(0, 7).map((b, i) => ({ day: i, ret: r0((b[4] / b[1] - 1) * 100), range: r0((b[2] / b[3] - 1) * 100), vol: r0(b[5]), xFromDay1: r2(b[4] / B[eI][4]), volVsDay1: r2(B[eI][5] > 0 ? b[5] / B[eI][5] : null) }));
  // the day-3 fingerprint: where the coin stood on its third day (the rider's window), for the giants-against-duds comparison
  const d3 = B[Math.min(3, B.length - 1)], fp = { xDay3: r2(d3[4] / B[eI][4]), offHighDay3: r0((1 - d3[4] / Math.max(...B.slice(0, 4).map((b) => b[2]))) * 100), volDay3VsDay1: r2(B[eI][5] > 0 ? d3[5] / B[eI][5] : null), heldDay1Close: d3[4] >= B[eI][4] };
  return { days: B.length, launch: new Date(B[0][0] * 1000).toISOString().slice(0, 10), peakDay: peakI, peakAt: new Date(B[peakI][0] * 1000).toISOString().slice(0, 10), x: r2(peak / c0), xFromDay1: r2(peak / B[eI][4]), dips: dips.slice(0, 40), dipCount, worstDip, afterPeak: { to50: daysTo(50), to80: daysTo(80), nowPct: r0((last / peak - 1) * 100) }, entries, pullback: pb, sims, first, fp };
}
// across the giants: what is typical, and which exit kept the most (the sum over all of them is the answer to "what extracts the most")
export function summarise(rows) {
  const all = rows.filter((r) => r.study && !r.study.truncated && r.study.days >= 10), trunc = rows.filter((r) => r.study && r.study.truncated), guessed = rows.filter((r) => r.guessed), duds = all.filter((r) => r.kind === 'dud'), ok = all.filter((r) => r.kind !== 'dud'); if (!ok.length) return { n: 0, truncated: trunc.length, lines: [`No giant with a complete history yet: ${trunc.length} of the listed coins are older than the free candle feed reaches (about six months), so their launch cannot be seen. List the recent giants (with pool addresses) or add a paid CoinGecko key for deeper history.`] }; const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const simKeys = Object.keys(ok[0].study.sims), totals = Object.fromEntries(simKeys.map((k) => [k, ok.reduce((a, r) => a + (r.study.sims[k].out || 0), 0)])), best = simKeys.filter((k) => k !== 'peakSold').sort((a, b) => totals[b] - totals[a])[0];
  const dips50 = med(ok.map((r) => r.study.dipCount[50])), dips30 = med(ok.map((r) => r.study.dipCount[30])), worst = med(ok.map((r) => r.study.worstDip)), daysToPeak = med(ok.map((r) => r.study.peakDay)), x = med(ok.map((r) => r.study.xFromDay1));
  const entryByDay = {}; for (const r of ok) for (const e of r.study.entries) (entryByDay[e.day] ||= []).push(e.toPeak); const entryMed = Object.fromEntries(Object.entries(entryByDay).map(([d, xs]) => [d, med(xs)]));
  const pbs = ok.map((r) => r.study.pullback).filter(Boolean);
  const lines = [];
  if (trunc.length) lines.push(`${trunc.length} listed coin${trunc.length === 1 ? '' : 's'} (${trunc.map((r) => r.symbol).join(', ')}) left out: older than the free candle feed reaches (about six months), so the launch is not in the data. ${guessed.length ? 'Pools picked by symbol search (check these are the real coins): ' + guessed.map((r) => r.symbol + ' = ' + (r.name || '?')).join(', ') + '.' : ''}`);
  lines.push(`${ok.length} giants studied${ok.some((r) => r.source === 'coingecko') ? ' (' + ok.filter((r) => r.source === 'coingecko').length + ' from CoinGecko\'s full history on daily closes, the rest from on-chain candles)' : ''}. The typical one took ${daysToPeak} days from launch to its top, went ${x}x from the day-1 close, and on the WAY there fell 30%+ ${dips30} times and 50%+ ${dips50} times (worst dip before the top: ${worst}%).`);
  lines.push(dips50 >= 1 ? `So a rule that sells everything on a 50% giveback is out of the typical giant before the top: the clips must fund the ride, and the moonbag must trail wider than a giant's dips (${worst}%+), or it never sees the top.` : `A 50% giveback rule would have survived the typical giant's route to the top (worst dip ${worst}%): the moonbag's trail needs to sit just wider than that.`);
  lines.push(`From a $${GIANTS.stake} entry on the day-1 close, summed over all ${ok.length}: ${simKeys.filter((k) => k !== 'peakSold').sort((a, b) => totals[b] - totals[a]).map((k) => `${k} $${r0(totals[k]).toLocaleString('en')}`).join(', ')} (the exact top would have been $${r0(totals.peakSold).toLocaleString('en')}). Best rule: ${best}: ${ok[0].study.sims[best].why}.`);
  lines.push(`Entry day against the multiple to the top (median): ${Object.entries(entryMed).map(([d, m]) => `day ${d} ${m}x`).join(', ')}${pbs.length ? `; the first 30% pullback after a 2x: ${med(pbs.map((p) => p.toPeak))}x (${pbs.length} of ${ok.length} gave one)` : ''}.`);
  const nowDown = ok.filter((r) => r.study.afterPeak.nowPct <= -80).length; lines.push(`After the top: ${nowDown} of ${ok.length} are now 80%+ under it (median ${med(ok.map((r) => r.study.afterPeak.to50))} days to lose half from the top). Riding it back is the default outcome; the rules above are what stand between a $500k position and zero.`);
  let fingerprint = null; if (duds.length >= 3) { const f = (rs, k) => med(rs.map((r) => r.study.fp && r.study.fp[k])), g3 = f(ok, 'xDay3'), d3 = f(duds, 'xDay3'), gv = f(ok, 'volDay3VsDay1'), dv = f(duds, 'volDay3VsDay1'), gh = ok.filter((r) => r.study.fp && r.study.fp.heldDay1Close).length / ok.length, dh = duds.filter((r) => r.study.fp && r.study.fp.heldDay1Close).length / duds.length;
    fingerprint = { giants: { xDay3: g3, volDay3VsDay1: gv, heldDay1Close: r2(gh) }, duds: { xDay3: d3, volDay3VsDay1: dv, heldDay1Close: r2(dh) } };
    lines.push(`Day-3 fingerprint, giants against ${duds.length} duds (coins that pumped and died): on day 3 the giants stood at ${g3}x their day-1 close with ${gv}x day-1's volume and ${Math.round(gh * 100)}% were still above the day-1 close; the duds at ${d3}x, ${dv}x the volume, ${Math.round(dh * 100)}% above. ${g3 > d3 * 1.3 && gh > dh ? 'That separation is the rider\'s entry gate: a coin that is still up and still turning over on day 3 is the one to ride.' : 'Not a clean separation yet: add more duds and giants to src/giants.json.'}`); }
  return { n: ok.length, truncated: trunc.length, guessed: guessed.map((r) => r.symbol), duds: duds.length, fingerprint, daysToPeak, x, dips30, dips50, worstDip: worst, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, r0(v)])), best, entryMed, lines };
}
// --- fetch: resolve each coin to its main Solana pool (or use the pool given), then daily candles from birth (GeckoTerminal pages 1000 at a time)
export async function resolvePool(api, g) {
  if (g.pool) return { pool: g.pool, chain: g.chain || 'solana', name: g.name || null };
  // a token address is exact (the symbol search is what picks copycats): all its pairs, the deepest one wins
  if (g.token) { const j = await api.getJson('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(g.token)); const ps = (j && j.pairs || []).filter((p) => !g.chain || p.chainId === g.chain).sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0)); return ps[0] ? { pool: ps[0].pairAddress, chain: ps[0].chainId, name: ps[0].baseToken.name } : null; }
  const j = await api.getJson('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(g.symbol));
  const ps = (j && j.pairs || []).filter((p) => (p.baseToken && p.baseToken.symbol || '').toUpperCase() === g.symbol.toUpperCase() && (!g.chain || p.chainId === g.chain)).sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0));
  return ps[0] ? { pool: ps[0].pairAddress, chain: ps[0].chainId, name: ps[0].baseToken.name, guessed: true } : null;
}
export const GT_NET = { solana: 'solana', robinhood: 'robinhood', ethereum: 'eth', eth: 'eth', base: 'base', bsc: 'bsc' };
// when the pool was born (GeckoTerminal pool info): the free feed only serves about six months of candles, so an older coin's history
// starts in the middle of its life and its launch-based numbers (days to the top, entry days) mean nothing. Those are marked truncated.
export async function poolBorn(api, chain, pool) { try { const j = await api.get(`/networks/${GT_NET[chain] || chain}/pools/${pool}`); const t = j && j.data && j.data.attributes && j.data.attributes.pool_created_at; return t ? Math.floor(Date.parse(t) / 1000) : null; } catch { return null; } }
export async function dailyFromBirth(api, chain, pool, maxPages = 4) {
  const net = GT_NET[chain] || chain; let before = Math.floor(Date.now() / 1000) + 86400, all = [];
  for (let p = 0; p < maxPages; p++) { const j = await api.get(`/networks/${net}/pools/${pool}/ohlcv/day?aggregate=1&limit=1000&before_timestamp=${before}&currency=usd`); const L = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || []; if (!L.length) break; all = [...L.map((b) => b.map(Number)), ...all]; before = Math.min(...L.map((b) => b[0])) - 1; if (L.length < 1000) break; }
  return all.sort((a, b) => a[0] - b[0]);
}
// the full life of an older giant from CoinGecko's own history (the paid key the scanner already has): daily closes and volumes from
// listing day, turned into candles (open = the previous close, high/low = the two closes, so dips are measured on closes: a touch kinder
// than true lows, and the summary says so). Used when the list gives a CoinGecko id; the on-chain feed only reaches back six months.
export async function dailyFromCoinGecko(api, id) {
  const j = await api.getCG(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=max&interval=daily`); const P = (j && j.prices) || [], V = (j && j.total_volumes) || []; if (P.length < 5) return [];
  const vol = new Map(V.map(([t, v]) => [Math.floor(t / 86400e3), v])); const out = []; let prev = null; for (const [t, c] of P) { const d = Math.floor(t / 86400e3), o = prev ?? c; out.push([d * 86400, o, Math.max(o, c), Math.min(o, c), c, vol.get(d) || 0]); prev = c; }
  return out;
}
export async function runGiants({ list = JSON.parse(fs.readFileSync(path.join('src', 'giants.json'), 'utf8')), out = path.join(process.env.OUT_DIR || 'docs/data', 'giants.json'), api = makeApi(), log = console.log } = {}) {
  const rows = []; for (const g of list) { try {
      if (g.cg && api.keyed) { try { const bars = await dailyFromCoinGecko(api, g.cg); if (bars.length >= 10) { const study = studyChart(bars); if (study) { study.truncated = false; study.source = 'coingecko (closes)'; } rows.push({ symbol: g.symbol, name: g.name || g.cg, kind: g.kind || 'giant', chain: g.chain || null, pool: null, cg: g.cg, source: 'coingecko', born: new Date(bars[0][0] * 1000).toISOString().slice(0, 10), truncated: false, bars: bars.length, study }); log(`${g.symbol}: ${bars.length} days from CoinGecko (${g.cg}), ${study ? study.x + 'x, top on day ' + study.peakDay : 'too short'}`); continue; } } catch (e) { log(`${g.symbol}: CoinGecko ${e.message}; trying the pool`); } }
      const p = await resolvePool(api, g); if (!p) { rows.push({ symbol: g.symbol, error: 'no pool found' }); log(g.symbol + ': no pool'); continue; }
      const bars = await dailyFromBirth(api, p.chain, p.pool), born = await poolBorn(api, p.chain, p.pool), truncated = !!(born && bars.length && bars[0][0] - born > 3 * 86400), study = studyChart(bars); if (study) study.truncated = truncated; rows.push({ symbol: g.symbol, name: p.name || g.name || null, kind: g.kind || 'giant', chain: p.chain, pool: p.pool, guessed: !!p.guessed, born: born ? new Date(born * 1000).toISOString().slice(0, 10) : null, truncated, bars: bars.length, study }); log(`${g.symbol}: ${bars.length} days${truncated ? ' (history starts after the launch: truncated)' : ''}, ${study ? study.x + 'x, top on day ' + study.peakDay : 'too short'}`); }
    catch (e) { rows.push({ symbol: g.symbol, error: e.message }); log(g.symbol + ': ' + e.message); } }
  const result = { at: new Date().toISOString().slice(0, 19) + 'Z', rows, summary: summarise(rows) }; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result)); return result;
}
if (process.argv[1] && process.argv[1].endsWith('giants.mjs')) runGiants().then((r) => console.log((r.summary || { lines: ['nothing studied'] }).lines.join('\n')));
