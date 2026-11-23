// GRADED VERSIONS OF THE CHECKLIST CARDS (23 Nov, Ryan: "graded versions as targets"): for each Zoro and Vegeta card, the cheapest slab
// in each grade listed on Collector Crypt right now (PSA 10, CGC 10, PSA 9...), so raw vs slab can be decided card by card. One broad
// marketplace search per character (paged), each slab matched to the card by number, name, version and set (docs/cards/slabmatch.mjs).
// Writes docs/cards/data/graded.json.
import fs from 'node:fs';
import path from 'node:path';
import { matchSlab } from '../docs/cards/slabmatch.mjs';
import { gradeKey } from './slabs.mjs';
const OUT = process.env.OUT_DIR || 'docs/cards/data', CC = 'https://api.collectorcrypt.com', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEARCH = { zoro: [['Zoro', 'One Piece']], vegeta: [['Vegeta', 'Dragon Ball']] };
async function getJ(u) { for (let a = 0; a < 3; a++) { try { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(2000 * (a + 1)); } return null; }
// the cheapest listing per grade for one card, from a list of marketplace slabs
export function gradesFor(card, slabs, fx) { const out = {};
  for (const c of slabs) { if (!c.listing || !(+c.listing.price > 0) || !matchSlab({ name: c.itemName, g: card.g }, [card])) continue; const k = gradeKey(c.gradingCompany, c.grade); if (!k) continue;
    const aud = +(+c.listing.price * fx).toFixed(2); if (!out[k] || aud < out[k].aud) out[k] = { aud, url: `https://collectorcrypt.com/assets/solana/${c.nftAddress}`, n: (out[k] ? out[k].n : 0) + 1 }; else out[k].n++; }
  return out; }
async function main() { const C = JSON.parse(fs.readFileSync(path.join(OUT, 'chars.json'), 'utf8')), fxj = await getJ('https://api.frankfurter.app/latest?from=USD&to=AUD'), fx = fxj && fxj.rates && fxj.rates.AUD > 1 ? fxj.rates.AUD : 1.52;
  const byId = {}; let reads = 0, calls = 0;
  for (const who of C.chars || []) { const re = who === 'zoro' ? /\b(roronoa )?zoro\b(?!ark)/i : new RegExp('\\b' + who + '\\b', 'i'), cards = C.cards.filter((c) => re.test(c.name)), slabs = [];
    for (const [q, cat] of SEARCH[who] || [[who, '']]) { let cur = null; for (let p = 0; p < 5; p++) { const j = await getJ(`${CC}/marketplace?${cur ? 'cursor=' + encodeURIComponent(cur) + '&' : ''}step=200&cardType=Card&search=${encodeURIComponent(q)}${cat ? '&categories=' + encodeURIComponent(cat) : ''}`); calls++; await sleep(400); const A = (j && j.filterNFtCard) || []; slabs.push(...A); cur = j && j.nextCursor; if (!cur || A.length < 200) break; } }
    reads += slabs.length; for (const c of cards) { const g = gradesFor(c, slabs, fx); if (Object.keys(g).length) byId[c.id] = g; } }
  fs.writeFileSync(path.join(OUT, 'graded.json'), JSON.stringify({ at: new Date().toISOString(), byId }));
  console.log(`graded versions: ${reads} Collector Crypt slabs read (${calls} searches), ${Object.keys(byId).length} checklist cards with a slab listed`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e.message); process.exit(1); });
