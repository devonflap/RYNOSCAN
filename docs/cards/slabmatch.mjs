// SLAB -> THE SAME CARD'S PRICE HISTORY (22 Nov, Ryan: "buy and sell purely through Collector Crypt, mid or longer holds"). For a hold, what
// matters is where the card's price is heading, so each Collector Crypt slab is matched to the raw card the Card Finder tracks (6 months of
// TCGplayer prices): its trend (settled, still falling...) and how far it is off its high. Only confident matches: same game, same card
// number, the card's name in the slab title, and the right version (1st edition, manga, alt art, reverse...); anything unclear gets no match.
const STOP = new Set(['the', 'and', 'of', 'ex', 'gx', 'v', 'vmax', 'vstar', 'holo', 'full', 'art', 'pokemon', 'card', 'one', 'piece', 'dragon', 'ball']);
const words = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const numKey = (n) => { const s = String(n || '').trim().toUpperCase(); if (/^\d+\/\w+$/.test(s)) return s.split('/')[0].replace(/^0+(?=\d)/, ''); return s.replace(/^([A-Z]*)0*(?=\d)/, '$1'); };
export function slabNum(name) { const m = String(name || '').match(/#\s*([A-Z]{0,5}\d+[A-Z0-9-]*)/i); return m ? numKey(m[1].replace(/-0*(\d)/, (x, d) => '-' + d)) : null; }
const opKey = (n) => String(n || '').toUpperCase().replace(/-0*(\d)/, (x, d) => '-' + d);
const VERS = [['1st edition', /1st edition/i], ['reverse', /reverse/i], ['manga', /manga/i], ['alt', /alt\.? art|alternate art|parallel/i], ['sp', /\bsp\b|special/i]];
// index: Map or array of tracked cards (id, g, name, num, set, sub, aud, off, high, st, stKey, sp)
export function matchSlab(slab, index) { const sn = String(slab.name || ''), g = slab.g, num = slabNum(sn); if (!num || !g) return null;
  if (g === 'OP' && /japanese/i.test(sn)) return null; /* the Card Finder tracks English One Piece only */
  const sw = new Set(words(sn)), cards = index instanceof Map ? [...index.values()] : index;
  let C = cards.filter((c) => c.g === g && (g === 'OP' || g === 'DB' ? opKey(c.num) === opKey(num) || numKey(c.num) === num : numKey(c.num) === num));
  C = C.filter((c) => { const nw = words(String(c.name).replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, '')).filter((w) => w.length > 2 && !STOP.has(w)); return nw.length && nw.every((w) => sw.has(w) || sn.toLowerCase().includes(w)); });
  if (!C.length) return null;
  // the version: the slab says it or doesn't; the card's name/printing must agree
  const ver = (c) => `${c.name} ${c.sub || ''}`; for (const [, re] of VERS) { const want = re.test(sn); C = C.filter((c) => re.test(ver(c)) === want); }
  if (C.length > 1) { const setHit = C.filter((c) => words(c.set).filter((w) => w.length > 3 && !STOP.has(w)).some((w) => sw.has(w))); if (setHit.length) C = setHit; }
  if (C.length !== 1) return null; return C[0]; }
