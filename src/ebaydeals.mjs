// EBAY AU LISTINGS UNDER MARKET (22 Nov, Ryan: "Yeah let's set this all up"). For every dropped-deal card and new-release chase card,
// reads eBay Australia's live Buy It Now listings (eBay's own Browse API) and keeps the ones priced, with postage, at least 20% under the
// card's market price. Needs Ryan's free eBay developer keys in GitHub Secrets (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET); without them it
// does nothing. The keys only read public listings (no account access, no buying). Writes docs/cards/data/ebay.json.
import fs from 'node:fs';
import path from 'node:path';
import { cardTerms } from '../docs/cards/ebayq.mjs';
const OUT = process.env.OUT_DIR || 'docs/cards/data', ID = process.env.EBAY_CLIENT_ID, SECRET = process.env.EBAY_CLIENT_SECRET;
export const EB = { maxRatio: 0.8, minRatio: 0.35, floor: 0.1, maxCards: 450, perCard: 50, perCardShown: 4 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/-]+/g, ' ').trim();
// 22 Nov (Ryan: "still show deals for these, I'll find myself if a good deal"): a listing needs the card's number and name; anything else
// that differs is shown with a label (slab, lot, other version, Japanese copy, very cheap) instead of being dropped.
export function titleCheck(title, c) { const t = ` ${norm(title)} `, T = cardTerms(c), num = norm(String(c.num || '').trim()), flags = [];
  if (!num) return null; const bare = num.replace(/^0+(?=\d)/, ''), nums = [num, bare, num.split('/')[0], bare.split('/')[0]].filter((x) => x.length >= 2);
  if (/\//.test(num)) { if (!t.includes(num) && !t.includes(bare)) return null; } else if (!nums.some((n) => new RegExp(`(^|[^a-z0-9])${n.replace(/[-/]/g, '\\$&')}([^a-z0-9]|$)`).test(t))) return null;
  for (const w of T.core.toLowerCase().split(/\s+/)) if (w.length > 2 && !t.includes(norm(w))) return null;
  if (/\b(sleeve|binder|poster|sticker|empty|booster|display|playmat|proxy|custom|orica|replica|fan art)\b/.test(t)) return null; /* not a card, or not a real one */
  if (/\b(psa|cgc|bgs|beckett|sgc|graded|slab|gem mint)\b/.test(t)) flags.push('slab');
  if (/\b(lot|lots|bundle|choose|pick|select your|you pick|u pick|complete set|playset|x2|x3|x4)\b/.test(t)) flags.push('lot or pick-a-card');
  let other = false; for (const v of T.vs) { if (v.startsWith('-')) { if (t.includes(` ${v.slice(1)} `)) other = true; continue; } const alts = v.replace(/[()]/g, '').split(',').map((x) => norm(x)); if (!alts.some((a) => t.includes(` ${a}`))) other = true; }
  if (other) flags.push('maybe another version');
  if (c.g === 'PJ' && !/\b(japanese|jp|japan|jpn)\b/.test(t)) flags.push('maybe the English copy'); if (c.g !== 'PJ' && /\b(japanese|jp|japan|jpn|korean|chinese)\b/.test(t)) flags.push(/korean/.test(t) ? 'Korean copy' : /chinese/.test(t) ? 'Chinese copy' : 'Japanese copy');
  return { flags }; }
export const titleMatches = (title, c) => { const r = titleCheck(title, c); return !!r && !r.flags.length; };
// one Browse API result -> a row (A$ including postage) with its labels, or null
export function listingRow(it, c) { if (!it || !it.price || it.price.currency !== 'AUD') return null; const chk = titleCheck(it.title, c); if (!chk) return null;
  const ship = (it.shippingOptions || []).map((o) => (o.shippingCost && o.shippingCost.currency === 'AUD' ? +o.shippingCost.value : null)).filter((x) => x != null), post = ship.length ? Math.min(...ship) : null;
  const total = +it.price.value + (post || 0), ratio = total / c.aud; if (ratio > EB.maxRatio || ratio < EB.floor) return null;
  const flags = [...chk.flags]; if (ratio < EB.minRatio) flags.push('very cheap: check it is real');
  return { title: it.title, aud: +total.toFixed(2), post, under: +(1 - ratio).toFixed(3), exact: !flags.length, flags, url: it.itemWebUrl, img: (it.image && it.image.imageUrl) || (it.thumbnailImages && it.thumbnailImages[0] && it.thumbnailImages[0].imageUrl) || c.img, cond: it.condition || null, seller: it.seller ? { name: it.seller.username, fb: it.seller.feedbackPercentage, n: it.seller.feedbackScore } : null, loc: it.itemLocation ? [it.itemLocation.city, it.itemLocation.stateOrProvince].filter(Boolean).join(', ') : null }; }
async function token() { const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64') }, body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope') });
  if (!r.ok) throw new Error('eBay sign-in refused (' + r.status + '): check the two keys in GitHub Secrets'); return (await r.json()).access_token; }
async function search(tok, q) { for (let a = 0; a < 3; a++) { try { const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${EB.perCard}&filter=${encodeURIComponent('buyingOptions:{FIXED_PRICE},itemLocationCountry:AU,priceCurrency:AUD')}&sort=price`, { headers: { authorization: 'Bearer ' + tok, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU', 'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=AU' }, signal: AbortSignal.timeout(25000) });
  if (r.ok) return (await r.json()).itemSummaries || []; if (r.status === 429) { await sleep(5000); continue; } return []; } catch { await sleep(2000); } } return []; }
async function main() { if (!ID || !SECRET) { console.log('eBay keys not set up yet (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET): eBay scan skipped'); return; }
  const D = JSON.parse(fs.readFileSync(path.join(OUT, 'cards.json'), 'utf8')), seen = new Set(), cards = [];
  for (const c of [...D.deals.filter((x) => !x.check), ...D.newSets.flatMap((s) => s.chase), ...D.deals.filter((x) => x.check)]) if (c.num && c.aud >= 100 && !seen.has(c.id || c.name + c.num)) { seen.add(c.id || c.name + c.num); cards.push(c); }
  const tok = await token(), rows = []; let calls = 0;
  for (const c of cards.slice(0, EB.maxCards)) { const T = cardTerms(c), q = [T.core, String(c.num).trim()].join(' '); const L = await search(tok, q); calls++; await sleep(250);
    const got = L.map((it) => listingRow(it, c)).filter(Boolean).sort((a, b) => (b.exact - a.exact) || a.aud - b.aud).slice(0, EB.perCardShown); /* exact matches first, then labelled ones */
    for (const best of got) rows.push({ ...best, card: { id: c.id, g: c.g, name: c.name, set: c.set, num: c.num, sub: c.sub, aud: c.aud, img: c.img, url: c.url, high: c.high, off: c.off, st: c.st, stKey: c.stKey, hz: c.hz, sp: c.sp } }); }
  rows.sort((a, b) => (b.exact - a.exact) || b.under - a.under);
  fs.writeFileSync(path.join(OUT, 'ebay.json'), JSON.stringify({ at: new Date().toISOString(), checked: calls, items: rows }));
  console.log(`eBay AU: ${calls} cards checked, ${rows.length} listings ${Math.round((1 - EB.maxRatio) * 100)}%+ under market (${rows.filter((r) => r.exact).length} exact matches)`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e.message); process.exit(1); });
