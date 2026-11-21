// eBay searches for the right card (22 Nov): real names from the card data. Every query here was run on eBay AU on 22 Nov and found the card.
import { ebayQuery, slabQuery } from '../docs/cards/ebayq.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const q = (name, num, g, sub = 'Foil', o) => ebayQuery({ name, num, g, sub }, o);
const RAW = '-psa -cgc -bgs -graded -slab -proxy -custom -orica -replica';
const t1 = q('Monkey.D.Luffy (119) (Manga)', 'OP05-119', 'OP'); ok(t1 === `Luffy "OP05-119" manga ${RAW}`, 'manga: short name, exact number, manga: ' + t1);
const t2 = q('Monkey.D.Luffy (119) (Alternate Art)', 'OP05-119', 'OP'); ok(t2.startsWith('Luffy "OP05-119" (alt,alternate,parallel,aa) -manga '), 'alt art (any spelling), not the manga: ' + t2);
const t3 = q('Monkey.D.Luffy (OP16 Release Event Winner)', 'P-135', 'OP'); ok(t3.startsWith('Luffy "P-135" winner '), 'winner promo: ' + t3);
const t4 = q('Tony Tony.Chopper (CS 25-26 Event Pack)', 'P-065', 'OP'); ok(t4.startsWith('Tony Chopper "P-065" -psa'), t4);
const t5 = q('Mega Greninja ex - 116/086', '116/086', 'PK', 'Holofoil'); ok(t5 === `Mega Greninja ex "116/086" ${RAW}`, 'number in the name dropped, no extra words: ' + t5);
const t6 = q('Mega Rayquaza ex - 110/076', '110/076', 'PJ', 'Holofoil'); ok(t6.startsWith('Mega Rayquaza ex "110/076" (japanese,jp,japan) '), 'Japanese: ' + t6);
const t7 = q('Clefable (Prerelease)', '01/64', 'PK', 'Holofoil'); ok(t7.includes('(prerelease,pre-release,stamp,stamped)'), t7);
const t8 = q('Rain Castform', '23/101', 'PK', 'Reverse Holofoil'); ok(t8.startsWith('Rain Castform "23/101" reverse '), 'reverse holo: ' + t8);
const t9 = q('Energy Marker (E-127) (Gold)', 'E-127', 'DB', 'Holofoil'); ok(t9.startsWith('Energy Marker "E-127" gold '), t9);
const g1 = q('Monkey.D.Luffy (119) (Manga)', 'OP05-119', 'OP', 'Foil', { graded: true }); ok(g1.includes('manga psa 10') && !g1.includes('-psa'), 'PSA 10 search keeps slabs: ' + g1);
ok(slabQuery('2015 #123 Rayquaza EX CGC 9 Japanese XY Promo Pokemon') === 'Rayquaza EX 123 CGC 9 -proxy -custom', 'slab: name, number, grade only (was empty on eBay with the set words)');
ok(slabQuery('2023 #GG40 Full Art/Glaceon Vstar PSA 10 Crown Zenith Pokemon') === 'Glaceon Vstar GG40 PSA 10 -proxy -custom', 'slab with Full Art/ prefix');
ok(slabQuery('2004 #66 Meditite Reverse Holo CGC 10 EX Hidden Legends - English Pokemon') === 'Meditite 66 CGC 10 -proxy -custom', 'slab: holo words left out');
process.exit(f);
