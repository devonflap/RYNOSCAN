// SLABS ON SALE (21 Nov, Ryan: "scan the gacha websites for deals, as they have slabs on sale sometimes"). Collector Crypt's graded cards
// (PSA, CGC, BGS) are listed for sale on Magic Eden's public API, each with Collector Crypt's own valuation ("Insured Value", US dollars)
// beside the asking price (SOL). A slab listed well under its insured value is a measurable discount. Writes docs/cards/data/slabs.json.
// Courtyard and Phygitals are not scanned: Courtyard has no public search, and Phygitals refuses automated reads.
import fs from 'node:fs';
import path from 'node:path';
const ME = 'https://api-mainnet.magiceden.dev/v2', OUT = process.env.OUT_DIR || 'docs/cards/data', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)';
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
  return { g, name: String(t.name || '').trim(), grade: gradeOf(t.name), year: attr(t, 'Year'), img: t.image || null, aud: +aud.toFixed(2), insAud: +insAud.toFixed(2), sol: +x.price.toFixed(4), under: +(1 - ratio).toFixed(3), vault: attr(t, 'Vault'), url: `https://magiceden.io/item-details/${x.tokenMint}` }; }
async function main() { fs.mkdirSync(OUT, { recursive: true });
  const fxj = await getJ('https://api.frankfurter.app/latest?from=USD&to=AUD'), fx = fxj && fxj.rates && fxj.rates.AUD > 1 ? fxj.rates.AUD : 1.53;
  const sp = await getJ('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'), solUsd = sp && sp.solana && sp.solana.usd > 0 ? sp.solana.usd : null;
  if (!solUsd) { console.log('no SOL price: slabs skipped this run'); return; } console.log(`SOL $${solUsd}, USD to AUD ${fx}`);
  const rows = []; let seen = 0;
  for (let p = 0; p < SLAB.pages; p++) { const L = await getJ(`${ME}/collections/collector_crypt/listings?offset=${p * SLAB.per}&limit=${SLAB.per}`); await sleep(700); if (!Array.isArray(L) || !L.length) break; seen += L.length; for (const x of L) { const r = slabRow(x, { solUsd, fx }); if (r) rows.push(r); } if (L.length < SLAB.per) break; }
  rows.sort((a, b) => b.under - a.under);
  fs.writeFileSync(path.join(OUT, 'slabs.json'), JSON.stringify({ at: new Date().toISOString(), fx, solUsd, seen, source: 'Collector Crypt on Magic Eden', items: rows.slice(0, 200) }));
  console.log(`slabs: ${seen} listings read, ${rows.length} under ${Math.round(SLAB.maxRatio * 100)}% of their insured value`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
