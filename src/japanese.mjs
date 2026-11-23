// JAPANESE VERSIONS (23 Nov, Ryan: "keep the English versions but also add a Japanese version of the same cards in case I want to buy the
// Japanese one"). TCGplayer only sells the English One Piece and Dragon Ball cards, so for each character card the Japanese printing's price
// comes from Card Rush (cardrush-op.jp / cardrush-db.jp, a large Japanese card shop), looked up by card number once a day. Its robots.txt
// only shuts out a few AI-training crawlers. Dragon Ball Super Masters (BT/TB...) was never printed in Japanese, so only One Piece and
// Fusion World cards are looked up. Writes docs/cards/data/japanese.json.
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.env.OUT_DIR || 'docs/cards/data', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = { OP: 'https://www.cardrush-op.jp', DB: 'https://www.cardrush-db.jp' };
// one Card Rush search page -> its listings { id, url, img, name, yen, num, stock, cond }
export function parseList(html) { const out = [];
  for (const chunk of String(html || '').split('<li class="list_item_cell').slice(1)) { const href = (chunk.match(/href="(https:\/\/www\.cardrush-[a-z]+\.jp\/product\/\d+)"/) || [])[1], alt = (chunk.match(/alt="([^"]*)"/) || [])[1] || '', yen = +((chunk.match(/class="figure">([\d,]+)円/) || [])[1] || '').replace(/,/g, '');
    const img = (chunk.match(/data-x2="(https:[^"]+\.jpg)"/) || chunk.match(/<img src="(https:[^"]+\.jpg)"/) || [])[1] || null; if (!href || !yen) continue;
    const num = (alt.match(/\{([^}]+)\}/) || [])[1] || null, name = alt.replace(/\{[^}]*\}\s*$/, '').trim();
    out.push({ url: href, img, name, yen, num, stock: !/soldout|売り切れ|在庫なし|SOLD OUT/i.test(chunk), cond: (name.match(/^〔([^〕]*)〕/) || [])[1] || null }); }
  return out; }
// the Japanese printing that matches an English card: same number, same version (manga / parallel / SP / plain), new and ungraded
export function pickJapanese(card, list) { const nm = String(card.name || ''), num = String(card.num || '').toUpperCase().trim();
  /* a special English printing (serial numbered, Treasure Cup, championship and event promos, pre-release, winner...) has no plain
     Japanese twin: matching it to the ordinary Japanese card would show a A$3 'version' of a A$3,000 card, so leave it unmatched */
  const extra = [...nm.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((g) => !/^[A-Z]{0,5}\d+[-A-Z0-9/]*$/i.test(g) && !/^(alternate art|alt art|manga|sp|parallel|special parallel)$/i.test(g));
  if (extra.length) return null;
  const manga = /manga/i.test(nm), par = /alternate art|alt art|parallel|\(sp\)|special/i.test(nm) || /\bSP\b/.test(String(card.rar || '')), sp = /\(sp\)|\bspr?\b/i.test(nm) || /^SP$/.test(String(card.rar || ''));
  const L = list.filter((x) => x.num && x.num.toUpperCase() === num && !x.cond && !/デッキ|スリーブ|プレイマット|ストレージ/.test(x.name))
    .filter((x) => (manga ? /漫画/.test(x.name) : !/漫画/.test(x.name)) && (par || manga ? /パラレル/.test(x.name) : !/パラレル/.test(x.name)) && (sp ? /SP/.test(x.name) : true));
  const inStock = L.filter((x) => x.stock), pool = inStock.length ? inStock : L; return pool.sort((a, b) => a.yen - b.yen)[0] || null; }
const isJapanesePrinted = (c) => c.g === 'OP' || (c.g === 'DB' && /fusion world/i.test(c.cat || ''));
async function getText(u) { for (let a = 0; a < 3; a++) { try { const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.text(); if (r.status === 404) return ''; } catch { /* retry */ } await sleep(3000 * (a + 1)); } return null; }
async function main() { const C = JSON.parse(fs.readFileSync(path.join(OUT, 'chars.json'), 'utf8')).cards.filter(isJapanesePrinted);
  const fxj = await fetch('https://api.frankfurter.app/latest?from=JPY&to=AUD').then((r) => r.json()).catch(() => null), fx = fxj && fxj.rates && fxj.rates.AUD > 0 ? fxj.rates.AUD : 0.0101;
  const byNum = new Map(); for (const c of C) { const k = `${c.g}|${String(c.num).toUpperCase()}`; if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(c); }
  const out = {}; let pages = 0, found = 0;
  for (const [k, cards] of byNum) { const [g, num] = k.split('|'); const html = await getText(`${SITE[g]}/product-list?keyword=${encodeURIComponent(num)}`); pages++; await sleep(1500); if (html == null) continue;
    const list = parseList(html); for (const c of cards) { const j = pickJapanese(c, list); if (!j) continue; out[c.id] = { yen: j.yen, aud: +(j.yen * fx).toFixed(2), url: j.url, img: j.img, name: j.name, stock: j.stock }; found++; } }
  fs.writeFileSync(path.join(OUT, 'japanese.json'), JSON.stringify({ at: new Date().toISOString(), jpyAud: fx, byId: out }));
  console.log(`Japanese versions: ${C.length} One Piece / Fusion World character cards, ${pages} Card Rush searches, ${found} matched (JPY to AUD ${fx})`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e.message); process.exit(1); });
