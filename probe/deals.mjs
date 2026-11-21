// one-off probe 2 (22 Nov): listing samples from the sources that answered. Deleted after.
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'application/json, text/html' };
async function get(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR', t: e.message }; } }
const show = async (u, n = 600) => { const r = await get(u); console.log(`\n== ${r.s} ${u} (${r.t.length})\n${r.t.replace(/\s+/g, ' ').slice(0, n)}`); return r; };
const ME = 'https://api-mainnet.magiceden.dev/v2';
for (const s of ['phygitals___', 'phygital_', 'phygitals', 'beezie', 'collector_crypt_', 'pocketpull_origin_pokemon', 'tokenized_collectibles_drop11', 'slabz']) { const r = await show(`${ME}/collections/${s}/stats`, 200); try { if (JSON.parse(r.t).listedCount > 0) await show(`${ME}/collections/${s}/listings?limit=2`, 1500); } catch {} }
await show('https://api.opensea.io/api/v2/listings/collection/courtyard-nft/best?limit=2', 1500);
await show('https://api.opensea.io/api/v2/collection/courtyard-nft/nfts?limit=1', 1500);
for (const [u, re] of [['https://beezie.com/marketplace', /https?:\/\/[a-z.]*beezie\.(?:com|io)[^"'\\\s]*/g], ['https://courtyard.io/marketplace', /https?:\/\/api[a-z.-]*courtyard\.io[^"'\\\s]*/g], ['https://phygitals.gitbook.io/docs', /https?:\/\/api\.phygitals\.com[^"'\\\s]*/g]]) { const r = await get(u); console.log(`\n== ${r.s} ${u} api urls: ` + [...new Set(r.t.match(re) || [])].slice(0, 30).join(' | ')); const nd = r.t.match(/__NEXT_DATA__[^>]*>([\s\S]{0,800})/); if (nd) console.log('NEXT_DATA: ' + nd[1]); }
// Beezie marketplace: look for price-like data in the page
{ const r = await get('https://beezie.com/marketplace'); const i = r.t.search(/PSA|Pok[eé]mon/); console.log('\nbeezie sample around PSA: ' + r.t.slice(Math.max(0, i - 300), i + 900).replace(/\s+/g, ' ')); }
for (const u of ['https://api.beezie.com/marketplace', 'https://api.beezie.com/v1/marketplace', 'https://api.beezie.com/listings', 'https://api.beezie.com/marketplace/listings', 'https://api.phygitals.com/api/marketplace', 'https://api.phygitals.com/marketplace/listings', 'https://api.phygitals.com/api/listings', 'https://api.phygitals.com/api/cards']) await show(u, 300);
// Card Rush One Piece: product names and prices
{ const r = await get('https://www.cardrush-op.jp/product-list?keyword=OP05-119'); const items = [...r.t.matchAll(/class="goods_name"[^>]*>([^<]{3,120})<[\s\S]{0,1500}?([\d,]+)円/g)].slice(0, 8).map((m) => m[1].trim() + ' = ' + m[2] + '円'); console.log('\ncardrush items: ' + (items.join('\n') || r.t.slice(r.t.indexOf('OP05-119', 3000) - 500, r.t.indexOf('OP05-119', 3000) + 1500).replace(/\s+/g, ' '))); }
await show('https://snkrdunk.com/en/search/result?keyword=OP05-119', 300);
