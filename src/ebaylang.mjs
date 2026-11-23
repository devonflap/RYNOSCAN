// JAPANESE AND CHINESE PRICES FROM EBAY (23 Nov, Ryan: "find the prices for Japanese cards on eBay, I can find them there; show the price
// for Japanese or English or Chinese on that card"). Once a day, for every One Piece and Fusion World Zoro / Vegeta card on the checklist,
// reads eBay's live Buy It Now listings that post to Australia (eBay's own Browse API, the same free keys as the eBay deals scan) and keeps
// the cheapest single raw copy in each language whose title has the card's number, its version and the language. One search per card number
// and language (about 180 a day, well inside eBay's free 5,000). Writes docs/cards/data/langs.json.
import fs from 'node:fs';
import path from 'node:path';
import { langTitle } from '../docs/cards/langs.mjs';
const OUT = process.env.OUT_DIR || 'docs/cards/data', ID = process.env.EBAY_CLIENT_ID, SECRET = process.env.EBAY_CLIENT_SECRET, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORD = { jp: 'japanese', cn: 'chinese' };
const isAsianPrinted = (c) => c.g === 'OP' || (c.g === 'DB' && /fusion world/i.test(c.cat || ''));
// one Browse API listing -> A$ price including the cheapest postage, or null (fx: A$ per unit of other currencies)
export function audOf(it, fx) { const cv = (m) => (m && m.value != null ? (m.currency === 'AUD' ? +m.value : fx[m.currency] ? +m.value * fx[m.currency] : null) : null);
  const p = cv(it && it.price); if (p == null) return null; const ship = (it.shippingOptions || []).map((o) => cv(o.shippingCost)).filter((x) => x != null), post = ship.length ? Math.min(...ship) : null;
  return { aud: +(p + (post || 0)).toFixed(2), post }; }
// the cheapest matching listing for one card in one language
export function cheapest(items, c, lang, fx) { let best = null, n = 0;
  for (const it of items) { if (!langTitle(it.title, c, lang)) continue; const a = audOf(it, fx); if (!a) continue; n++; if (!best || a.aud < best.aud) best = { ...a, url: it.itemWebUrl, title: it.title, img: (it.image && it.image.imageUrl) || null }; }
  return best ? { ...best, n } : null; }
async function token() { const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64') }, body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope') });
  if (!r.ok) throw new Error('eBay sign-in refused (' + r.status + ')'); return (await r.json()).access_token; }
async function search(tok, q) { for (let a = 0; a < 3; a++) { try { const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=100&filter=${encodeURIComponent('buyingOptions:{FIXED_PRICE},deliveryCountry:AU')}&sort=price`, { headers: { authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU', 'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=AU' }, signal: AbortSignal.timeout(25000) });
  if (r.ok) return (await r.json()).itemSummaries || []; if (r.status === 429) { await sleep(5000); continue; } return []; } catch { await sleep(2000); } } return []; }
async function main() { if (!ID || !SECRET) { console.log('eBay keys not set up: language prices skipped'); return; }
  const F = path.join(OUT, 'langs.json'); try { const old = JSON.parse(fs.readFileSync(F, 'utf8')); if (Date.now() - Date.parse(old.at) < 20 * 3600e3 && !process.env.FORCE) { console.log('language prices: already done today'); return; } } catch { /* first run */ }
  const C = JSON.parse(fs.readFileSync(path.join(OUT, 'chars.json'), 'utf8')).cards.filter(isAsianPrinted);
  const fxj = await fetch('https://api.frankfurter.app/latest?from=AUD&to=USD,JPY,EUR,GBP,CNY,HKD,SGD,CAD').then((r) => r.json()).catch(() => null), fx = {};
  for (const [k, v] of Object.entries((fxj && fxj.rates) || { USD: 0.65, JPY: 99 })) if (v > 0) fx[k] = 1 / v;
  const byNum = new Map(); for (const c of C) { const k = String(c.num).toUpperCase(); if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(c); }
  const tok = await token(), byId = {}; let calls = 0, found = 0;
  for (const [num, cards] of byNum) for (const lang of ['jp', 'cn']) { const q = `${num} ${WORD[lang]}${/^P-/i.test(num) ? (cards[0].g === 'OP' ? ' one piece' : ' dragon ball') : ''}`; const L = await search(tok, q); calls++; await sleep(300);
    for (const c of cards) { const b = cheapest(L, c, lang, fx); if (b) { (byId[c.id] = byId[c.id] || {})[lang] = b; found++; } } }
  fs.writeFileSync(F, JSON.stringify({ at: new Date().toISOString(), byId }));
  console.log(`eBay language prices: ${C.length} cards, ${calls} searches, ${found} prices (${Object.values(byId).filter((x) => x.jp).length} Japanese, ${Object.values(byId).filter((x) => x.cn).length} Chinese)`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e.message); process.exit(1); });
