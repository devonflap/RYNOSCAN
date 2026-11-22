// one-off probe (22 Nov): for the cheapest Magic Eden slabs, what does Collector Crypt's market say (offers, recent sales)? Deleted after.
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'application/json, text/html, */*' };
async function get(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR', t: e.message }; } }
const CC = 'https://api.collectorcrypt.com', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await get('https://collectorcrypt.com/bundle/urls-DBUlD70M.js');
for (const k of ['getCardOffers', 'getSellerListings', 'criteriaOffers:', 'criteriaOffersReceived', 'recentSales', 'requestBuyback', 'getNFTCardMarket', 'buyback']) { const i = b.t.indexOf(k); if (i >= 0) console.log(`\nURL ${k}: ` + b.t.slice(i, i + 220)); }
const mints = process.env.MINTS.split(',');
for (const m of mints.slice(0, 6)) { console.log(`\n######## ${m}`);
  for (const p of [`cards/publicNft/${m}`, `cards/publicNft/${m}/market`, `card-activity/${m}?v2=true`]) { const r = await get(`${CC}/${p}`); console.log(`-- ${r.s} ${p}\n` + r.t.replace(/\s+/g, ' ').slice(0, 1400)); await sleep(500); } }
const rs = await get(`${CC}/card-activity/recent-sales?category=Pokemon`); console.log('\n-- recent-sales ' + rs.s + '\n' + rs.t.slice(0, 1500));
