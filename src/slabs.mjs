// SLABS ON SALE (21 Nov, Ryan: "scan the gacha websites for deals, as they have slabs on sale sometimes"). Collector Crypt's graded cards
// (PSA, CGC, BGS) are listed for sale on Magic Eden's public API, each with Collector Crypt's own valuation ("Insured Value", US dollars)
// beside the asking price (SOL). A slab listed well under its insured value is a measurable discount. Writes docs/cards/data/slabs.json.
// 22 Nov: plus Collector Crypt's own marketplace (collectorcrypt.com, priced in USDC), read from its public listings API; Ryan found
// slabs priced well apart between the two. Each slab shows where it is listed. Courtyard needs an OpenSea key; Phygitals' Magic Eden
// listings carry no valuation, so neither is scanned.
import fs from 'node:fs';
import path from 'node:path';
const ME = 'https://api-mainnet.magiceden.dev/v2', CC = 'https://api.collectorcrypt.com', OUT = process.env.OUT_DIR || 'docs/cards/data', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)';
export const SLAB = { maxRatio: 0.9, minAud: 100, maxAud: 1500, pages: 60, per: 100 };
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
async function main() { fs.mkdirSync(OUT, { recursive: true });
  const fxj = await getJ('https://api.frankfurter.app/latest?from=USD&to=AUD'), fx = fxj && fxj.rates && fxj.rates.AUD > 1 ? fxj.rates.AUD : 1.53;
  const sp = await getJ('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'), solUsd = sp && sp.solana && sp.solana.usd > 0 ? sp.solana.usd : null;
  if (!solUsd) { console.log('no SOL price: slabs skipped this run'); return; } console.log(`SOL $${solUsd}, USD to AUD ${fx}`);
  const rows = []; let seen = 0;
  for (let p = 0; p < SLAB.pages; p++) { const L = await getJ(`${ME}/collections/collector_crypt/listings?offset=${p * SLAB.per}&limit=${SLAB.per}`); await sleep(700); if (!Array.isArray(L) || !L.length) break; seen += L.length; for (const x of L) { const r = slabRow(x, { solUsd, fx }); if (r) rows.push(r); } if (L.length < SLAB.per) break; }
  /* 22 Nov: Magic Eden keeps showing some listings after the card has been sold on Collector Crypt (all 12 of the cheapest, 50-70%
     "under", had a Magic Eden seller who no longer owns the card). Keep a Magic Eden slab only if Collector Crypt says its seller still owns it. */
  let stale = 0; for (const r of [...rows]) { const m = await getJ(`${CC}/cards/publicNft/${r.mint}/market`); await sleep(300); const w = m && m.owner && m.owner.wallet;
    if (w && r.seller && w !== r.seller) { rows.splice(rows.indexOf(r), 1); stale++; } }
  console.log(`Magic Eden: ${stale} listings dropped as stale (the seller no longer owns the card), ${rows.length} live`);
  let ccReads = 0; try { const cc = await ccScan(fx); ccReads = cc.reads; const have = new Set(rows.map((r) => r.mint)); for (const r of cc.rows) if (!have.has(r.mint)) rows.push(r); } catch (e) { console.log('Collector Crypt marketplace skipped: ' + e.message); }
  rows.sort((a, b) => b.under - a.under);
  fs.writeFileSync(path.join(OUT, 'slabs.json'), JSON.stringify({ at: new Date().toISOString(), fx, solUsd, seen, source: 'Collector Crypt slabs on Magic Eden and on Collector Crypt', ccSeen: ccReads, items: rows.slice(0, 250) }));
  console.log(`slabs: ${seen} listings read, ${rows.length} under ${Math.round(SLAB.maxRatio * 100)}% of their insured value`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
