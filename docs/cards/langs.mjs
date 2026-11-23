// ONE CARD, EVERY LANGUAGE (23 Nov, Ryan: "instead of having the cards twice, show the price for Japanese or English or Chinese on that
// card"). Shared by the checklist page and the eBay language scan (src/ebaylang.mjs).
const ver = (name) => { const n = String(name || ''); return /manga|漫画/i.test(n) ? 'manga' : /alternate art|alt art|parallel|パラレル|\(sp\)|special/i.test(n) ? 'alt' : 'plain'; };
// a Japanese Card Rush listing that carries an English card's number belongs on that card (best: same version), not on its own row
export function homeFor(x, cards) { const num = String(x.num || '').toUpperCase(); if (!num) return null;
  const same = cards.filter((c) => String(c.num || '').toUpperCase() === num); if (!same.length) return null;
  return same.find((c) => ver(c.name) === ver(x.name)) || same.find((c) => ver(c.name) === 'alt' && ver(x.name) === 'manga') || same.sort((a, b) => a.aud - b.aud)[0]; }
// an eBay listing title for this card in this language: the right number, the right version, the language named, a single raw card
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9/-]+/g, ' ').trim();
const LANGW = { jp: /\b(japanese|japan|jp|jpn)\b/, cn: /\b(chinese|china|cn|simplified|s-chinese)\b/ };
export function langTitle(title, c, lang) { const t = ` ${norm(title)} `, num = norm(c.num); if (!num || !new RegExp(`(^|[^a-z0-9])${num.replace(/[-/]/g, '\\$&')}([^a-z0-9]|$)`).test(t)) return false;
  if (!LANGW[lang].test(t)) return false; for (const [k, re] of Object.entries(LANGW)) if (k !== lang && re.test(t) && !/\b(not|no)\s+(japanese|chinese)\b/.test(t)) return false;
  if (/\b(korean|english|eng|en)\b/.test(t) && !/\b(not english)\b/.test(t)) return false;
  if (/\b(psa|cgc|bgs|beckett|sgc|ace|tag|graded|slab|lot|lots|bundle|choose|pick|select|playset|x2|x3|x4|proxy|custom|orica|replica|fan art|sleeve|playmat|booster box|display|sealed|deck)\b/.test(t)) return false;
  const v = ver(c.name), manga = /\bmanga\b/.test(t), alt = /\b(alt|alternate|parallel|aa|sp|special)\b/.test(t);
  if (v === 'manga' ? !manga : manga) return false; if (v === 'alt' && !alt) return false; if (v === 'plain' && alt) return false;
  if (/\(sp\)/i.test(c.name) && !/\bsp\b/.test(t)) return false;
  return true; }
