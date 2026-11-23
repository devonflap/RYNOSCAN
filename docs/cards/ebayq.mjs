// EBAY SEARCHES THAT FIND THE RIGHT CARD (22 Nov). eBay needs every word in a search to be in the listing title, so a search can only
// carry what nearly every seller writes: the character's name (short), the card number, and the one version word that tells it apart
// (manga, SP, alt art...). First try (22 Nov am) added the set, the game and "Japanese/Promo" etc. and came back empty (Ryan's screenshot:
// "No exact matches" for a CGC 9 Rayquaza). Words after a minus only remove listings, so the slab/fake filters are safe to keep.
const NOISE = /^(the|of|and|-)$/i;
// version words in the name's brackets -> one eBay "either word" group, as sellers write them in titles
const VARIANTS = [[/manga/i, 'manga'], [/\bspr\b/i, 'spr'], [/\bsp\b|special parallel/i, 'sp'], [/alternate art|alt art|parallel/i, '(alt,alternate,parallel,aa)'], [/full art/i, '(full,fa)'], [/winner/i, 'winner'], [/\bgold\b/i, 'gold'], [/pre-?release/i, '(prerelease,pre-release,stamp,stamped)']];
// "Monkey.D.Luffy" -> "Luffy" (sellers write Monkey D Luffy, Monkey.D.Luffy or just Luffy; Luffy is in all of them)
const shortName = (s) => s.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, ' ').split(/\s+/).map((w) => (w.includes('.') ? w.split('.').filter(Boolean).pop() : w)).filter((w) => w && !NOISE.test(w)).slice(0, 3).join(' ');
export function cardTerms(c) { const raw = String(c.name || ''), groups = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(' ');
  const vs = []; for (const [re, w] of VARIANTS) if (re.test(groups) && !vs.includes(w)) { if (w === 'sp' && vs.includes('spr')) continue; vs.push(w); if (w === 'manga') break; }
  if (vs.includes('(alt,alternate,parallel,aa)') && !vs.includes('manga')) vs.push('-manga'); /* the plain alt art, not its dearer manga version */
  const sub = String(c.sub || ''); if (/reverse/i.test(sub)) vs.push('reverse'); if (/1st edition/i.test(sub)) vs.push('1st');
  const num = c.num && !/^none$/i.test(c.num) ? String(c.num).trim() : ''; /* as printed on the card (sellers copy it) */
  return { core: shortName(raw), num: num ? (/[-/]/.test(num) ? `"${num}"` : num) : '', vs, game: c.g === 'PJ' ? '(japanese,jp,japan)' : '' }; }
// 23 Nov (Ryan: the search should read like a listing title, e.g. "Roronoa Zoro OP01-025 SR Parallel Alt Art ... One Piece Japanese"):
// full name, card number, rarity, version in plain words, the game, and "Japanese" for Japanese copies. The set name and condition are
// left out on purpose: eBay only shows titles with every word, and many sellers don't write them. A short tail keeps slabs and proxies
// out of the raw-card searches.
const RAR = /^(C|UC|R|SR|SEC|L|SCR|TR|SP|SPR|SLR|PR|P)$/i, GAMEW = { OP: 'One Piece', DB: 'Dragon Ball', PK: 'Pokemon', PJ: 'Pokemon' };
export function ebayQuery(c, { graded = false, jp = false } = {}) { const raw = String(c.name || ''), t = cardTerms(c);
  const name = /\./.test(raw) ? t.core : raw.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, ' ').replace(/\s+/g, ' ').trim(); /* dotted names (Monkey.D.Luffy) stay short: Luffy */
  const groups = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(' '), ver = [];
  if (/manga/i.test(groups)) ver.push('Manga'); else if (/super alternate art/i.test(groups)) ver.push('Super Alt Art'); else if (/alternate art|alt art|parallel/i.test(groups)) ver.push(jp || c.g === 'PJ' ? 'Parallel' : 'Alt Art');
  for (const [re, w] of [[/winner/i, 'Winner'], [/\bgold\b/i, 'Gold'], [/pre-?release/i, 'Pre-Release'], [/serial/i, 'Serial']]) if (re.test(groups)) ver.push(w);
  if (/\(sp\)/i.test(raw)) ver.push('SP'); if (/reverse/i.test(String(c.sub || ''))) ver.push('Reverse'); if (/1st edition/i.test(String(c.sub || ''))) ver.push('1st Edition');
  const rar = RAR.test(String(c.rar || '').trim()) && !/^(C|UC|P|PR)$/i.test(c.rar) ? String(c.rar).toUpperCase() : '', num = String(c.num || '').trim();
  return [name, num, rar, ...ver, GAMEW[c.g] || '', jp || c.g === 'PJ' ? 'Japanese' : '', graded ? 'PSA 10' : '-psa -cgc -bgs -proxy'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
const E = 'https://www.ebay.com.au/sch/i.html?_nkw=';
// max: only listings at or under that price in A$ (eBay's own price filter), e.g. 80% of market or Ryan's wish-list price. Saved on eBay
// ("Save this search"), eBay itself alerts him when a new one is listed: the under-market scan without a developer key.
export const ebayJapanese = (c) => `${E}${encodeURIComponent(ebayQuery(c, { jp: true }))}&LH_BIN=1&_sop=15&LH_PrefLoc=1`;
export const ebayBuy = (c, o = {}) => `${E}${encodeURIComponent(ebayQuery(c, o))}&LH_BIN=1&_sop=15&LH_PrefLoc=1${o.max > 0 ? `&_udhi=${Math.round(o.max)}` : ''}`;
export const ebaySold = (c, o) => `${E}${encodeURIComponent(ebayQuery(c, o))}&LH_Sold=1&LH_Complete=1`;
// a slab's title from Collector Crypt ("2015 #123 Rayquaza EX CGC 9 Japanese XY Promo Pokemon", "2023 #GG40 Full Art/Glaceon Vstar PSA 10
// Crown Zenith Pokemon"): the card's name (the words between the number and the grade), its number and the grade
export function slabQuery(name) { const s = String(name || ''), num = (s.match(/#\s*([A-Z]{0,4}\d+[A-Z0-9-]*)/i) || [])[1], g = s.match(/\b(PSA|CGC|BGS|SGC|TAG|ACE)\s*(?:GEM\s*MT\s*|PRISTINE\s*|MINT\s*)?(\d+(?:\.5)?)/i);
  let card = s.replace(/^\s*\d{4}\s*/, '').replace(/#\s*\S+/, ' '); if (g) card = card.slice(0, card.search(new RegExp('\\b' + g[1], 'i')));
  card = card.split('/').pop(); /* "Full Art/Glaceon Vstar" -> "Glaceon Vstar" */ card = shortName(card.replace(/\b(reverse\s+holo|reverse|holo|full\s+art|1st\s+edition)\b/ig, ' ').replace(/[^\w\s.'-]/g, ' ')); /* version words left out: they made searches too narrow (a CGC 6.5 Yanma Reverse Holo found nothing) */
  return [card, num || '', g ? `${g[1]} ${g[2]}` : '', '-proxy -custom'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
