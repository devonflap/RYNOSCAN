// SLABS ON SALE (21 Nov, Ryan: "scan the gacha websites for deals, as they have slabs on sale sometimes"). Collector Crypt's graded cards
// (PSA, CGC, BGS) are listed for sale on Magic Eden's public API, each with Collector Crypt's own valuation ("Insured Value", US dollars)
// beside the asking price (SOL). A slab listed well under its insured value is a measurable discount. Writes docs/cards/data/slabs.json.
// 22 Nov: plus Collector Crypt's own marketplace (collectorcrypt.com, priced in USDC), read from its public listings API; Ryan found
// slabs priced well apart between the two. Each slab shows where it is listed. Courtyard needs an OpenSea key; Phygitals' Magic Eden
// listings carry no valuation, so neither is scanned.
import fs from 'node:fs';
import path from 'node:path';
import { matchSlab } from '../docs/cards/slabmatch.mjs';
import { cardTerms } from '../docs/cards/ebayq.mjs';
const ME = 'https://api-mainnet.magiceden.dev/v2', CC = 'https://api.collectorcrypt.com', OUT = process.env.OUT_DIR || 'docs/cards/data', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)';
/* 22 Nov (Ryan: "just focus on Collector Crypt, treat it like NFTs"): Collector Crypt's own marketplace only. Measured that day: buyers
   pay a median ~87% of insured value, and Collector Crypt's buybacks pay exactly 86.7% (38 of 38), but only on cards flagged for it. */
export const SLAB = { buyback: 0.867, typical: 0.87, maxRatio: 0.9, minAud: 35, maxAud: 3000, /* 22 Nov: down to A$35 valuations (cheap long-term keepers) and up to A$3,000 (high end) */ pages: 60, per: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJ(u) { for (let a = 0; a < 4; a++) { try { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); if (r.status === 429) { await sleep(5000 * (a + 1)); continue; } return null; } catch { await sleep(2000); } } return null; }
const attr = (t, k) => { const a = ((t && t.attributes) || []).find((x) => String(x.trait_type).toLowerCase() === k.toLowerCase()); return a ? a.value : null; };
// which game, from Collector Crypt's category and the card's name
export function gameOf(cat, name) { const s = `${cat || ''} ${name || ''}`.toLowerCase(); if (/one ?piece/.test(s)) return 'OP'; if (/dragon ?ball/.test(s)) return 'DB'; if (/pok[eé]mon/.test(s)) return /japan|japanese|\bjp\b/.test(s) ? 'PJ' : 'PK'; return null; }
export function gradeOf(name) { const m = String(name || '').match(/\b(PSA|CGC|BGS|SGC|TAG|ACE)\s*(?:GEM\s*MT\s*|PRISTINE\s*|BLACK\s*LABEL\s*)?(\d+(?:\.\d)?)/i); return m ? `${m[1].toUpperCase()} ${m[2]}` : null; }
// one listing -> a deal row, or null
export function slabRow(x, { solUsd, fx, S = SLAB }) { const t = x.token || {}, ins = +attr(t, 'Insured Value'), g = gameOf(attr(t, 'Category'), t.name);
  if (!g || !(ins > 0) || !(x.price > 0) || String(attr(t, 'Status') || 'Valid') !== 'Valid') return null;
  const usd = x.price * solUsd, aud = usd * fx, insAud = ins * fx, ratio = usd / ins; if (insAud < S.minAud || insAud > S.maxAud || ratio > S.maxRatio || ratio < 0.2) return null;
  return { g, name: String(t.name || '').trim(), grade: gradeOf(t.name), year: attr(t, 'Year'), img: t.image || null, aud: +aud.toFixed(2), insAud: +insAud.toFixed(2), sol: +x.price.toFixed(4), under: +(1 - ratio).toFixed(3), vault: attr(t, 'Vault'), src: 'Magic Eden', mint: x.tokenMint, seller: x.seller || null, url: `https://magiceden.io/item-details/${x.tokenMint}` }; }
// one listing on Collector Crypt's own marketplace (price in USDC = US dollars) -> a deal row, or null
export function ccRow(c, { fx, S = SLAB }) { const L = c && c.listing, ins = +(c && c.insuredValue), g = gameOf(c && c.category, c && c.itemName);
  if (!L || !g || !(ins > 0) || !(+L.price > 0) || !/^USDC?$/i.test(String(L.currency || 'USDC')) || String(c.nftStatus || 'Valid') !== 'Valid') return null;
  const usd = +L.price, aud = usd * fx, insAud = ins * fx, ratio = usd / ins; if (insAud < S.minAud || insAud > S.maxAud || ratio > S.maxRatio || ratio < 0.2) return null;
  const img = (c.images && (c.images.frontM || c.images.frontS)) || c.frontImage || null, mp = String(L.marketplace || 'CC');
  return { g, name: String(c.itemName || '').trim(), grade: [c.gradingCompany, c.grade && String(c.grade).replace(/^[A-Z/ +-]*(?=\d)/, '')].filter(Boolean).join(' ') || gradeOf(c.itemName), year: c.year || null, img, aud: +aud.toFixed(2), insAud: +insAud.toFixed(2), usd: +usd.toFixed(2), under: +(1 - ratio).toFixed(3), vault: c.vault || null,
    bb: c.getBuybackOffer === true ? true : c.getBuybackOffer === false ? false : null, bbAud: +(ins * S.buyback * fx).toFixed(2),
    src: /^ME|magic/i.test(mp) ? 'Magic Eden' : 'Collector Crypt', mint: c.nftAddress, url: `https://collectorcrypt.com/assets/solana/${c.nftAddress}` }; }
// Collector Crypt's marketplace, one insured-value band at a time (10% wide), asking only for listings priced under the band's top x 0.9:
// a small superset of the deals, so a few hundred requests cover every listing in A$100-1,500 instead of tens of thousands of pages
export function ccBands(fx, S = SLAB) { const out = []; for (let lo = S.minAud / fx; lo < S.maxAud / fx; lo *= 1.1) out.push([Math.floor(lo), Math.ceil(lo * 1.1), Math.ceil(lo * 1.1 * S.maxRatio)]); return out; }
async function ccScan(fx) { const rows = [], seen = new Set(); let reads = 0, calls = 0;
  for (const cat of ['Pokemon', 'One Piece', 'Dragon Ball']) for (const [lo, hi, maxP] of ccBands(fx)) { let cur = null;
    for (let p = 0; p < 12; p++) { const u = `${CC}/marketplace?${cur ? 'cursor=' + encodeURIComponent(cur) + '&' : ''}step=96&cardType=Card&insuredValueMin=${lo}&insuredValueMax=${hi}&listPriceMax=${maxP}&categories=${encodeURIComponent(cat)}`;
      const j = await getJ(u); calls++; await sleep(350); const L = (j && j.filterNFtCard) || []; reads += L.length;
      for (const c of L) { if (seen.has(c.nftAddress)) continue; seen.add(c.nftAddress); const r = ccRow(c, { fx }); if (r) rows.push(r); }
      cur = j && j.nextCursor; if (!cur || L.length < 96) break; } }
  console.log(`Collector Crypt marketplace: ${calls} requests, ${reads} listings read, ${rows.length} deals`); return { rows, reads }; }
// GOOD BUYS (22 Nov, Ryan: "make the Collector Crypt section more like Dropped deals, showing good buys and deals available"): the
// Card Finder's dropped deals (25%+ off their 6-month high and no longer falling), looked up on Collector Crypt's marketplace; every slab
// of that exact card listed at a fair price (up to its valuation) is a good buy, cheapest against its valuation first, 3 per card.
const CAT = { PK: 'Pokemon', PJ: 'Pokemon', OP: 'One Piece', DB: 'Dragon Ball' };
export const RAWKEEP = ['id', 'name', 'set', 'num', 'rar', 'sub', 'st', 'stKey', 'hz', 'off', 'high', 'aud', 'ch7', 'ch30', 'sp', 'url'];
async function goodBuys(fx, typ, file = path.join(OUT, 'cards.json')) { let D; try { D = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { console.log('good buys: no cards.json'); return []; }
  const deals = (D.deals || []).filter((c) => !c.check && CAT[c.g]), out = []; let calls = 0;
  for (const card of deals) { const q = cardTerms(card).core; if (!q) continue;
    const j = await getJ(`${CC}/marketplace?step=96&cardType=Card&search=${encodeURIComponent(q)}&categories=${encodeURIComponent(CAT[card.g])}`); calls++; await sleep(300);
    const got = []; for (const c of (j && j.filterNFtCard) || []) { const r = ccRow(c, { fx, S: { ...SLAB, maxRatio: 1.0, maxAud: 4000 } }); if (!r || r.src !== 'Collector Crypt') continue; if (!matchSlab(r, [card])) continue;
      const ratio = 1 - r.under; got.push({ ...r, vsTyp: +(1 - ratio / typ).toFixed(3), raw: Object.fromEntries(RAWKEEP.map((k) => [k, card[k]])), hz: card.hz, good: true }); }
    got.sort((a, b) => b.under - a.under); out.push(...got.slice(0, 3)); }
  console.log(`good buys: ${deals.length} dropped deals looked up on Collector Crypt (${calls} searches), ${out.length} slabs listed at a fair price`); return out; }
async function main() { fs.mkdirSync(OUT, { recursive: true });
  const fxj = await getJ('https://api.frankfurter.app/latest?from=USD&to=AUD'), fx = fxj && fxj.rates && fxj.rates.AUD > 1 ? fxj.rates.AUD : 1.53;
  const sp = await getJ('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'), solUsd = sp && sp.solana && sp.solana.usd > 0 ? sp.solana.usd : null;
  if (!solUsd) { console.log('no SOL price: slabs skipped this run'); return; } console.log(`SOL $${solUsd}, USD to AUD ${fx}`);
  // what Collector Crypt buyers actually pay, as a share of insured value: the median of recent marketplace sales (not buybacks)
  const ratios = []; for (const cat of ['Pokemon', 'One Piece', 'Dragon Ball']) { const L = await getJ(`${CC}/card-activity/recent-sales?category=${encodeURIComponent(cat)}`); await sleep(500);
    for (const x of Array.isArray(L) ? L : []) { const ins = +(x.card && x.card.insuredValue), amt = +x.amount; if (ins >= 30 && amt > 0 && !/buyback/i.test((x.to && x.to.name) || '')) ratios.push(amt / ins); } }
  ratios.sort((a, b) => a - b); const med = ratios.length >= 10 ? ratios[Math.floor(ratios.length / 2)] : null, typ = med && med > 0.7 && med < 1.05 ? +med.toFixed(3) : SLAB.typical;
  console.log(`recent Collector Crypt sales: ${ratios.length}, median ${med ? Math.round(med * 100) + '%' : '?'} of insured value (using ${Math.round(typ * 100)}%)`);
  const rows = []; let ccReads = 0; try { const cc = await ccScan(fx); ccReads = cc.reads; rows.push(...cc.rows.filter((r) => r.src === 'Collector Crypt')); } catch (e) { console.log('Collector Crypt marketplace skipped: ' + e.message); }
  // buyback flag: from the card's own page when the listing didn't carry it
  for (const r of rows) if (r.bb == null) { const c = await getJ(`${CC}/cards/publicNft/${r.mint}`); await sleep(250); r.bb = !!(c && c.getBuybackOffer === true); }
  for (const r of rows) { const ratio = 1 - r.under; r.vsTyp = +(1 - ratio / typ).toFixed(3); r.underBb = !!(r.bb && r.aud < r.bbAud); }
  const keep = rows.filter((r) => r.vsTyp > 0 || r.underBb); rows.length = 0; rows.push(...keep);
  console.log(`buyback open on ${rows.filter((r) => r.bb).length}, priced under its buyback on ${rows.filter((r) => r.underBb).length}`);
  rows.sort((a, b) => (b.underBb - a.underBb) || b.vsTyp - a.vsTyp); const seen = ccReads;
  let buys = []; try { buys = await goodBuys(fx, typ); } catch (e) { console.log('good buys skipped: ' + e.message); }
  fs.writeFileSync(path.join(OUT, 'slabs.json'), JSON.stringify({ buys, at: new Date().toISOString(), fx, solUsd, seen, source: 'Collector Crypt marketplace', typical: typ, sales: ratios.length, buyback: SLAB.buyback, ccSeen: ccReads, items: rows.slice(0, 250) }));
  console.log(`slabs: ${seen} listings read, ${rows.length} under what Collector Crypt cards usually sell for`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
