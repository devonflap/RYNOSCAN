// DIAGNOSTIC (1 Nov, Ryan: "Volume rider isn't buying anything"): the Volume rider's rules on today's real volume list, a few looser
// settings beside them, how often each would have bought in the last 4 days had it checked every 15 minutes, and roughly how those trades
// went (stop, half-way, the old high, 3 days). Today's list only (coins that are busy today): read the counts, not the profit, as the answer.
import { VOLR, volCandidates, volSetup } from '../bot/volrider.mjs';
const GT = 'https://api.geckoterminal.com/api/v2', H = { accept: 'application/json;version=20230302', 'user-agent': 'RynoScan diag' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { for (let i = 0; i < 4; i++) { const r = await fetch(u, { headers: H }); if (r.status === 429) { await sleep(15000); continue; } if (!r.ok) { console.log('HTTP', r.status, u); return null; } return r.json(); } return null; }
const SETS = { 'A now': VOLR, 'B 2h base, 30% range': { ...VOLR, baseBars: 8, baseRangePct: 30 }, 'C B + dip from 38%': { ...VOLR, baseBars: 8, baseRangePct: 30, zoneLo: 0.38 }, 'D C + volume under 75%': { ...VOLR, baseBars: 8, baseRangePct: 30, zoneLo: 0.38, baseVolMax: 0.75 } };
const pages = []; for (const net of ['solana', 'robinhood']) for (const p of ['trending_pools?page=1&duration=1h', 'trending_pools?page=2&duration=1h', 'trending_pools?page=1&duration=6h', 'trending_pools?page=2&duration=6h', 'pools?sort=h24_volume_usd_desc&page=1', 'pools?sort=h24_volume_usd_desc&page=2']) { const j = await get(`${GT}/networks/${net}/${p}&include=base_token`); if (j && j.data) pages.push({ net, data: j.data, included: j.included }); await sleep(2200); }
const L = volCandidates(pages, { ...VOLR, listMax: 60 }); console.log(`volume list (2 pages each): ${L.length} coins: ${L.map((c) => c.coin).join(', ')}\n`);
const res = Object.fromEntries(Object.keys(SETS).map((k) => [k, { coins: new Set(), trades: [], why: {} }]));
function sim(B, k, r) { const e = r.price, t1 = e * r.mults[0], t2 = e * r.mults[1]; let left = 1, got = 0, stop = r.stop, hit1 = false; for (let i = k; i < Math.min(B.length, k + 288); i++) { const b = B[i];
    if (b[3] <= stop) return got + left * stop / e - 1; if (!hit1 && b[2] >= t1) { got += 0.3 * t1 / e; left -= 0.3; hit1 = true; stop = Math.max(stop, e); } if (hit1 && b[2] >= t2) { return got + 0.4 * t2 / e + 0.3 * t2 / e - 1; } }
  const last = B[Math.min(B.length, k + 288) - 1][4]; return got + left * last / e - 1; }
for (const c of L) { await sleep(2200); const j = await get(`${GT}/networks/${c.chain}/pools/${c.pool}/ohlcv/minute?aggregate=15&limit=400&currency=usd&token=base`), B = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list ? j.data.attributes.ohlcv_list.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]) : null; if (!B || B.length < 20) continue;
  for (const [name, cfg] of Object.entries(SETS)) { let skipTo = 0; for (let k = 16; k < B.length; k++) { if (k < skipTo) continue; const sub = B.slice(0, k), x = volSetup(sub, sub[k - 1][4], sub[k - 1][0] + 960, cfg);
      if (x && !x.none) { res[name].coins.add(c.coin); const pnl = sim(B, k, x); res[name].trades.push({ coin: c.coin, pnl, open: k + 288 > B.length }); skipTo = k + 8; } else if (x) { const w = x.none.replace(/[\d.$k,%x]+/g, '#'); res[name].why[w] = (res[name].why[w] || 0) + 1; } } } }
for (const [name, r] of Object.entries(res)) { const T = r.trades, avg = T.length ? (T.reduce((a, t) => a + t.pnl, 0) / T.length) * 100 : 0, won = T.filter((t) => t.pnl > 0).length;
  console.log(`${name.padEnd(26)} buys in 4 days: ${String(T.length).padStart(3)} on ${r.coins.size} coins | avg ${avg.toFixed(1)}% | won ${won}/${T.length} | coins: ${[...r.coins].slice(0, 12).join(', ')}`);
  console.log('   top blockers:', Object.entries(r.why).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(' | ')); }
