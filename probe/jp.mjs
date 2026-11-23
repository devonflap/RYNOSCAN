// one-off probe 2 (23 Nov): Card Rush robots.txt and page structure. Deleted after.
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 'ERR', t: e.message }; } };
for (const h of ['https://www.cardrush-op.jp', 'https://www.cardrush-db.jp']) { const r = await get(h + '/robots.txt'); console.log(`\n== ${h}/robots.txt ${r.s}\n${r.t.slice(0, 800)}`); }
const r = await get('https://www.cardrush-op.jp/product-list?keyword=OP06-118'); const i = r.t.indexOf('class="goods_name"'); console.log('\n== item html:\n' + r.t.slice(i - 1500, i + 1200).replace(/\s+/g, ' '));
