// one-off probe (22 Nov): can Actions read Collector Crypt's own marketplace? Deleted after.
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'application/json, text/html, */*' };
async function get(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return { s: r.status, t: await r.text(), ct: r.headers.get('content-type') }; } catch (e) { return { s: 'ERR', t: e.message }; } }
const seen = new Set(), apis = new Set();
for (const u of ['https://collectorcrypt.com/', 'https://collectorcrypt.com/marketplace', 'https://www.collectorcrypt.com/marketplace']) { const r = await get(u); console.log(`\n== ${r.s} ${u} ${r.ct} (${r.t.length})\n` + r.t.replace(/\s+/g, ' ').slice(0, 300));
  for (const m of r.t.matchAll(/(?:src|href)="([^"]+\.js)"/g)) seen.add(new URL(m[1], u).href); for (const m of r.t.matchAll(/https?:\/\/[a-z0-9.-]*(?:collectorcrypt|cc)[a-z0-9.-]*\.[a-z]+\/[^"'\s\\)]*/gi)) apis.add(m[0]); }
console.log('\nscripts: ' + seen.size);
for (const js of [...seen].slice(0, 60)) { const r = await get(js); for (const m of r.t.matchAll(/["'`](https?:\/\/[^"'`\s]*(?:api|backend|server)[^"'`\s]*)["'`]/gi)) apis.add(m[1]); for (const m of r.t.matchAll(/["'`](\/api\/[a-zA-Z0-9/_-]{3,60})["'`]/g)) apis.add(m[1]); }
console.log('\nAPI-looking strings:\n' + [...apis].slice(0, 120).join('\n'));
for (const a of [...apis].filter((x) => /market|listing|card|nft|search/i.test(x)).slice(0, 15)) { const u = a.startsWith('/') ? 'https://collectorcrypt.com' + a : a; const r = await get(u); console.log(`\n== ${r.s} ${u} ${r.ct}\n` + r.t.replace(/\s+/g, ' ').slice(0, 500)); }
