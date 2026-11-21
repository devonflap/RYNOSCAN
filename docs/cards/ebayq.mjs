// EBAY SEARCHES THAT FIND THE RIGHT CARD (22 Nov, Ryan: "I'm clicking links and they show me the wrong cards on eBay"). The old search
// dropped everything in brackets, so "Monkey.D.Luffy (Manga)" searched plain Luffy and showed every version. Now:
//   the card's name without repeated numbers, + its number in quotes (an exact match), + its version words (manga, SP, alt art,
//   SPR, reverse holo, 1st edition, Japanese), + the game; raw searches leave out graded slabs, proxies and customs.
const GAME = { OP: 'one piece', DB: 'dragon ball', PK: 'pokemon', PJ: 'pokemon japanese' };
// version words in the name's brackets -> what sellers write in their titles (eBay reads (a,b) as "a or b")
const VARIANTS = [[/super alternate art/i, 'super (alt,alternate) art'], [/alternate art|alt art/i, '(alt,alternate) art'], [/manga/i, 'manga'], [/\bsp\b|special parallel/i, 'SP'], [/\bspr\b/i, 'SPR'], [/serial/i, 'serial'], [/gold[- ]stamp/i, 'gold'], [/full art/i, 'full art'], [/parallel/i, 'parallel'], [/pre-?release/i, 'pre release'], [/\bpromo\b/i, 'promo']];
export function cardTerms(c) { const raw = String(c.name || '');
  const groups = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  let core = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+[A-Z]{0,5}\d*[-/]?[A-Z0-9-]*\/?[A-Z0-9-]*\s*$/i, ' ').replace(/\s+-\s+\S*\d\S*/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const vs = []; for (const g of groups) { if (/^[A-Z]{0,5}\d+[-A-Z0-9/]*$/i.test(g.trim())) continue; for (const [re, w] of VARIANTS) if (re.test(g) && !vs.includes(w)) { vs.push(w); if (w.includes('super')) break; } }
  const sub = String(c.sub || ''); if (/reverse/i.test(sub)) vs.push('reverse'); if (/1st edition/i.test(sub)) vs.push('1st edition');
  const num = c.num && !/^none$/i.test(c.num) ? `"${String(c.num).trim()}"` : '';
  return { core, num, vs, game: GAME[c.g] || '' }; }
export function ebayQuery(c, { graded = false } = {}) { const t = cardTerms(c);
  const parts = [t.core, t.num, ...t.vs, t.game, graded ? 'psa 10' : '-psa -cgc -bgs -graded -slab', '-proxy -custom -orica -fan -replica'];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
const E = 'https://www.ebay.com.au/sch/i.html?_nkw=';
export const ebayBuy = (c, o) => `${E}${encodeURIComponent(ebayQuery(c, o))}&LH_BIN=1&_sop=15&LH_PrefLoc=1`;
export const ebaySold = (c, o) => `${E}${encodeURIComponent(ebayQuery(c, o))}&LH_Sold=1&LH_Complete=1`;
// a graded slab's own title (Collector Crypt: "2023 #GG40 Full Art/Glaceon Vstar PSA 10 Crown Zenith Pokemon"): the card, its number and grade
export function slabQuery(name) { const s = String(name || ''), num = (s.match(/#\s*([A-Z]{0,4}\d+[A-Z0-9/-]*)/i) || [])[1], grade = (s.match(/\b(PSA|CGC|BGS|SGC)\s*(\d+(?:\.\d)?)/i) || []);
  const core = s.replace(/^\s*\d{4}\s*/, '').replace(/#\s*\S+/, '').replace(/\b(PSA|CGC|BGS|SGC)\s*(GEM\s*MT\s*|PRISTINE\s*)?\d+(\.\d)?/ig, '').replace(/[/]/g, ' ').replace(/\s+/g, ' ').trim();
  return [core, num ? `"${num}"` : '', grade[1] ? `${grade[1]} ${grade[2]}` : '', '-proxy -custom'].filter(Boolean).join(' ').trim(); }
