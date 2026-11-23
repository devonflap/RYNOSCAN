// SLAB -> THE SAME CARD'S PRICE HISTORY (22 Nov, Ryan: "buy and sell purely through Collector Crypt, mid or longer holds"). For a hold, what
// matters is where the card's price is heading, so each Collector Crypt slab is matched to the raw card the Card Finder tracks (6 months of
// TCGplayer prices): its trend (settled, still falling...) and how far it is off its high. Only confident matches: same game, same card
// number, the card's name in the slab title, and the right version (1st edition, manga, alt art, reverse...); anything unclear gets no match.
const STOP = new Set(['the', 'and', 'of', 'ex', 'gx', 'v', 'vmax', 'vstar', 'holo', 'full', 'art', 'pokemon', 'card', 'one', 'piece', 'dragon', 'ball']);
const words = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const numKey = (n) => { const s = String(n || '').trim().toUpperCase().split('/')[0]; return s.replace(/^([A-Z]*)0*(?=\d)/, '$1').replace(/-0*(?=\d)/, '-'); }; /* 025/198 -> 25, SV107/SV122 -> SV107, ST01-008 -> ST1-8 */
export function slabNum(name) { const m = String(name || '').match(/#\s*([A-Z]{0,5}\d+[A-Z0-9-]*)/i); return m ? numKey(m[1]) : null; }
const VERS = [['1st edition', /1st edition/i], ['reverse', /reverse/i], ['manga', /manga/i], ['alt', /alt\.? art|alternate art|parallel/i], ['sp', /\bsp\b|special/i]];
// index: Map or array of tracked cards (id, g, name, num, set, sub, aud, off, high, st, stKey, sp)
export function matchSlab(slab, index) { const sn = String(slab.name || ''), g = slab.g, num = slabNum(sn); if (!num || !g) return null;
  if (g === 'OP' && /japanese/i.test(sn)) return null; /* the Card Finder tracks English One Piece only */
  const sw = new Set(words(sn)), cards = index instanceof Map ? [...index.values()] : index;
  let C = cards.filter((c) => c.g === g && numKey(c.num) === num);
  C = C.filter((c) => { const nw = words(String(c.name).replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, '')).filter((w) => w.length > 2 && !STOP.has(w)); return nw.length && nw.every((w) => sw.has(w) || sn.toLowerCase().includes(w)); });
  if (!C.length) return null;
  // the version: the slab says it or doesn't; the card's name/printing must agree
  const ver = (c) => `${c.name} ${c.sub || ''}`; for (const [k, re] of VERS) { const want = re.test(sn); C = C.filter((c) => (k === 'alt' && /manga/i.test(sn) && /manga/i.test(ver(c))) || re.test(ver(c)) === want); } /* 23 Nov: a manga card is an alt art too; slab titles often say only "Manga" */
  if (C.length > 1) { const setHit = C.filter((c) => words(c.set).filter((w) => w.length > 3 && !STOP.has(w)).some((w) => sw.has(w))); if (setHit.length) C = setHit; }
  if (C.length !== 1) return null;
  // the set must agree too (a reprint has the same name and number: Umbreon Gold Star in Celebrations is not the POP Series 5 one)
  const SETSTOP = new Set(['series', 'black', 'star', 'cards', 'card', 'trainer', 'gallery', 'collection', 'expansion', 'pack', 'english', 'japanese', 'sword', 'shield', 'scarlet', 'violet', 'mega', 'evolution']);
  const sk = words(C[0].set).filter((w) => w.length >= 3 && !STOP.has(w) && !SETSTOP.has(w)); const slabW = words(sn);
  if (sk.length && !sk.some((w) => slabW.some((x) => x.slice(0, 5) === w.slice(0, 5) || x === w))) return null;
  return C[0]; }
// how long to plan to hold a slab: the matched card's hold length, or from its year when there's no match (as the Card Finder does by set age)
export function slabHold(slab, raw, year = new Date().getFullYear()) { if (raw && raw.hz) return raw.hz; const y = +slab.year || +(String(slab.name || '').match(/^\s*(19|20)\d{2}/) || [])[0]; if (!y) return 'long'; return y >= year ? 'short' : y >= year - 2 ? 'medium' : 'long'; }
// a slab title ("2021 #SV107/SV122 Charizard VMAX CGC 10 Shining Fates - English Pokemon") -> its parts for a tidy card:
// name "Charizard VMAX", number "SV107/SV122", set "Shining Fates"
export function slabParts(title) { const t = String(title || '').trim(), num = (t.match(/#\s*([A-Z0-9/-]+)/i) || [])[1] || null, g = t.match(/\b(PSA|CGC|BGS|SGC|TAG|ACE|BECKETT)\b/i);
  let rest = t.replace(/^\s*(19|20)\d{2}\s*/, '').replace(/#\s*\S+/, ' '), name = rest, set = '';
  if (g) { const i = rest.search(new RegExp('\\b' + g[1] + '\\b', 'i')); name = rest.slice(0, i); set = rest.slice(i).replace(/^\S+\s*(GEM[ -]?MT|GEM MINT|PRISTINE|MINT|NM[-/ ]?MT\+?|NM|EX[-/ ]?MT|EX)?\s*\d+(\.5)?\s*(GEM[ -]?MT|GEM MINT|PRISTINE|MINT)?/i, ''); }
  name = name.split('/').pop().replace(/\b(GEM[ -]?MT|GEM MINT|PRISTINE|MINT|NM[-/ ]?MT\+?|EX[-/ ]?MT)\s*$/i, '').replace(/\s+/g, ' ').trim(); set = set.replace(/\b(Pokemon|Pok[eé]mon|One Piece|Dragon Ball( Super)?|English|Japanese)\b/gi, ' ').replace(/\s*-\s*$|^\s*-\s*/g, '').replace(/\s+/g, ' ').trim();
  return { name: name || t, num, set }; }
