// eBay AU under-market listings (22 Nov): which listing titles count as the card itself
import { titleMatches, titleCheck, listingRow } from '../src/ebaydeals.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const manga = { name: 'Monkey.D.Luffy (119) (Manga)', num: 'OP05-119', g: 'OP', sub: 'Foil', aud: 900 }, alt = { ...manga, name: 'Monkey.D.Luffy (119) (Alternate Art)', aud: 300 };
ok(titleMatches('Monkey D. Luffy OP05-119 Manga Alt Art Awakening of the New Era NM', manga), 'manga listing matches the manga card');
ok(!titleMatches('Monkey D. Luffy OP05-119 Alt Art SEC Foil NM', manga), 'plain alt art is not the manga card');
ok(titleMatches('Monkey D. Luffy OP05-119 SEC Alt Art Foil EN', alt), 'alt art listing matches the alt art card');
ok(!titleMatches('Monkey D. Luffy OP05-119 Manga Alt Art', alt), 'manga listing is not the plain alt art');
ok(!titleMatches('PSA 10 Monkey D. Luffy OP05-119 Manga', manga), 'slabs left out');
ok(!titleMatches('One Piece OP05 singles - choose your card - OP05-119 Luffy manga', manga), '"choose your card" listings left out');
ok(!titleMatches('Luffy OP05-119 manga Japanese', manga), 'Japanese copy is not the English card');
ok(!titleMatches('Luffy OP05-118 manga', manga), 'wrong number');
const pj = { name: 'Mega Rayquaza ex - 110/076', num: '110/076', g: 'PJ', sub: 'Holofoil', aud: 400 };
ok(titleMatches('Mega Rayquaza ex SAR 110/076 M6 Japanese Pokemon', pj) && !titleMatches('Mega Rayquaza ex SAR 110/076', pj), 'Japanese card needs "Japanese" in the title');
const pk = { name: "Team Rocket's Mewtwo ex - 231/182", num: '231/182', g: 'PK', sub: 'Holofoil', aud: 500 };
ok(titleMatches("Team Rocket's Mewtwo ex 231/182 SIR Destined Rivals Pokemon", pk), 'apostrophe names');
const r = listingRow({ title: 'Monkey D Luffy OP05-119 Manga NM', price: { value: '600', currency: 'AUD' }, shippingOptions: [{ shippingCost: { value: '10', currency: 'AUD' } }], itemWebUrl: 'https://www.ebay.com.au/itm/1' }, manga);
ok(r && r.aud === 610 && Math.abs(r.under - 0.322) < 0.01, 'price includes postage: A$610 is 32% under A$900');
ok(!listingRow({ title: 'Monkey D Luffy OP05-119 Manga NM', price: { value: '850', currency: 'AUD' } }, manga), 'only 6% under: not kept');
const cheapR = listingRow({ title: 'Monkey D Luffy OP05-119 Manga NM', price: { value: '200', currency: 'AUD' } }, manga); ok(cheapR && !cheapR.exact && cheapR.flags.includes('very cheap: check it is real'), 'very cheap: kept with a warning');
ok(!listingRow({ title: 'Monkey D Luffy OP05-119 Manga NM', price: { value: '50', currency: 'AUD' } }, manga), '94% under: not a real listing for this card, not kept');
// Ryan 22 Nov: show the near misses too, labelled
const lab = (t, c) => (titleCheck(t, c) || { flags: ['DROPPED'] }).flags.join(', ');
ok(lab('PSA 10 Monkey D. Luffy OP05-119 Manga', manga) === 'slab', 'slab labelled: ' + lab('PSA 10 Monkey D. Luffy OP05-119 Manga', manga));
ok(lab('One Piece OP05 singles - choose your card - OP05-119 Luffy manga', manga) === 'lot or pick-a-card', 'pick-a-card labelled');
ok(lab('Monkey D. Luffy OP05-119 Alt Art SEC Foil NM', manga) === 'maybe another version', 'other version labelled');
ok(lab('Luffy OP05-119 manga Japanese', manga) === 'Japanese copy', 'Japanese copy labelled');
ok(lab('Mega Rayquaza ex SAR 110/076', pj) === 'maybe the English copy', 'Japanese card without "Japanese" labelled');
ok(lab('Luffy OP05-118 manga', manga) === 'DROPPED' && lab('Luffy OP05-119 manga sleeve', manga) === 'DROPPED', 'wrong number or not a card: still dropped');
const sl = listingRow({ title: 'PSA 10 Luffy OP05-119 Manga', price: { value: '700', currency: 'AUD' } }, manga); ok(sl && !sl.exact && sl.flags[0] === 'slab', 'slab under market is shown, labelled');
{ const gc = { name: 'Monkey.D.Luffy (Gen Con 2023)', num: 'P-037', g: 'OP', sub: 'Foil', aud: 157 }, an = { name: 'Monkey.D.Luffy (119) (English Version 2nd Anniversary Set)', num: 'OP05-119', g: 'OP', sub: 'Foil', aud: 108 }, mk = { name: 'Magikarp - 203/193', num: '203/193', g: 'PK', set: 'SV02: Paldea Evolved', sub: 'Holofoil', aud: 439 };
  ok(lab('Bandai One Piece Monkey.D.Luffy 1st Anniversary Promo Foil P-037', gc) === 'maybe another version' && lab('Monkey D Luffy P-037 Gen Con 2023 promo', gc) === '', 'event promo: the event must be in the title');
  ok(lab('Monkey.D.Luffy (119) OP05-119 Secret Rare Awakening of the New Era', an) === 'maybe another version' && lab('Luffy OP05-119 2nd Anniversary Set English', an) === '', 'reprint set: "Anniversary" must be in the title');
  ok(lab('Magikarp 203/193 - 30th Celebration - Classic Collection - NM', mk) === 'maybe another version' && lab('Pokemon Paldea Evolved Magikarp 203/193 Illustration Rare', mk) === '', 'a later reprint of the same number');
  ok(lab('DEMO Monkey D. Luffy P-037 Gen Con 2023', gc) === 'maybe another version', 'demo copies'); }
ok(lab('Squirtle 170/165 - Art Rare - SV2a: Pokemon Card 151 - NM', { name: 'Squirtle - 170/165', num: '170/165', g: 'PK', set: 'SV: Scarlet & Violet 151', sub: 'Holofoil' }) === 'Japanese copy', 'a Japanese set code (SV2a) marks a Japanese copy');
process.exit(f);
