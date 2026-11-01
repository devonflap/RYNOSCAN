// DIAGNOSTIC (1 Nov, Ryan: "Volume rider isn't buying anything"): the Volume rider's own rules on today's real volume list, the reason each
// coin was passed over, and how often each coin would have qualified over the last 24 hours had the bot checked every 15 minutes.
import { VOLR, volCandidates, volSetup } from '../bot/volrider.mjs';
const GT = 'https://api.geckoterminal.com/api/v2', H = { accept: 'application/json;version=20230302', 'user-agent': 'RynoScan diag' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { for (let i = 0; i < 4; i++) { const r = await fetch(u, { headers: H }); if (r.status === 429) { await sleep(15000); continue; } if (!r.ok) { console.log('HTTP', r.status, u); return null; } return r.json(); } return null; }
const pages = []; for (const net of ['solana', 'robinhood']) for (const p of ['trending_pools?page=1&duration=1h', 'trending_pools?page=1&duration=6h', 'pools?sort=h24_volume_usd_desc&page=1']) { const j = await get(`${GT}/networks/${net}/${p}&include=base_token`); console.log(net, p, j && j.data ? j.data.length + ' pools' : 'NO DATA'); if (j && j.data) pages.push({ net, data: j.data, included: j.included }); await sleep(2500); }
const L = volCandidates(pages, VOLR); console.log(`\nvolume list: ${L.length} coins`);
const tally = {}, hits = [];
for (const c of L) { await sleep(2500); const j = await get(`${GT}/networks/${c.chain}/pools/${c.pool}/ohlcv/minute?aggregate=15&limit=400&currency=usd&token=base`), B = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list ? j.data.attributes.ohlcv_list.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]) : null;
  if (!B || !B.length) { console.log(c.coin.padEnd(12), 'no candles'); continue; } const last = B[B.length - 1], now = last[0] + 900 + 60;
  const r = volSetup(B, last[4], now, VOLR); const why = !r ? 'too little history' : r.none || 'SETUP NOW';
  let n24 = 0; const reasons = {}; for (let k = B.length - 96; k < B.length; k++) { if (k < 30) continue; const sub = B.slice(0, k), t = sub[sub.length - 1][0] + 900 + 60, x = volSetup(sub, sub[sub.length - 1][4], t, VOLR); if (x && !x.none) n24++; else { const w = !x ? 'too little history' : x.none.replace(/[\d.$k,%x]+/g, '#'); reasons[w] = (reasons[w] || 0) + 1; } }
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]; tally[top ? top[0] : '-'] = (tally[top ? top[0] : '-'] || 0) + 1; if (n24) hits.push(c.coin + ' (' + n24 + ')');
  console.log(c.coin.padEnd(12), c.chain.padEnd(9), ('$' + Math.round(c.h6 / 1000) + 'k 6h').padEnd(11), (B.length + ' bars').padEnd(9), 'now:', why.padEnd(60), '| 24h: qualified ' + n24 + '/96, mostly: ' + (top ? top[0] : '-')); }
console.log('\nmost common blocker over the last 24h:'); for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log('  ', v, k);
console.log('coins that would have qualified at some point in 24h:', hits.join(', ') || 'none');
