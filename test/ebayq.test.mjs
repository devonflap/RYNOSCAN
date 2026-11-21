// eBay searches for the right card (22 Nov): real names from the card data
import { ebayQuery, cardTerms, slabQuery } from '../docs/cards/ebayq.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const q = (name, num, g, sub = 'Foil', o) => ebayQuery({ name, num, g, sub }, o);
const t1 = q('Monkey.D.Luffy (119) (Manga)', 'OP09-119', 'OP'); ok(/^Monkey D Luffy "OP09-119" manga one piece -psa/.test(t1), 'One Piece manga: ' + t1);
const t2 = q('Monkey.D.Luffy - OP09-119 (SP)', 'OP09-119', 'OP'); ok(/^Monkey D Luffy "OP09-119" SP one piece/.test(t2) && !/- OP09/.test(t2), 'One Piece SP (number in the name dropped): ' + t2);
const t3 = q('Smoker (093) (Alternate Art)', 'OP02-093', 'OP'); ok(/^Smoker "OP02-093" \(alt,alternate\) art one piece/.test(t3), 'alt art matches "alt" or "alternate": ' + t3);
const t4 = q('Charlotte Pudding (OP17-109) (SP)', 'OP17-109', 'OP'); ok(/^Charlotte Pudding "OP17-109" SP /.test(t4), t4);
const t5 = q('Bardock - FB11-123 (Super Alternate Art)', 'FB11-123', 'DB', 'Holofoil'); ok(/^Bardock "FB11-123" super \(alt,alternate\) art dragon ball/.test(t5) && !/ \(alt,alternate\) art.*\(alt,alternate\)/.test(t5), 'Dragon Ball super alt art: ' + t5);
const t6 = q('Together on the Nimbus (SPR)', 'BT28-074', 'DB'); ok(/"BT28-074" SPR dragon ball/.test(t6), t6);
const t7 = q('Rain Castform', '23/101', 'PK', 'Reverse Holofoil'); ok(/^Rain Castform "23\/101" reverse pokemon/.test(t7), 'Pokémon reverse holo: ' + t7);
const t8 = q('Gyarados - 021/081', '021/081', 'PJ', '1st Edition Holofoil'); ok(/^Gyarados "021\/081" 1st edition pokemon japanese/.test(t8), 'Japanese 1st edition, number not doubled: ' + t8);
const t9 = q("Team Aqua's Kyogre EX", '6/34', 'PK', 'Holofoil'); ok(/^Team Aqua's Kyogre EX "6\/34" pokemon -psa -cgc -bgs -graded -slab -proxy/.test(t9), 'raw search leaves out slabs and fakes: ' + t9);
const g1 = q('Monkey.D.Luffy (119) (Manga)', 'OP09-119', 'OP', 'Foil', { graded: true }); ok(/manga one piece psa 10 -proxy/.test(g1) && !/-psa/.test(g1), 'PSA 10 search keeps slabs: ' + g1);
const s1 = slabQuery('2023 #GG40 Full Art/Glaceon Vstar PSA 10 Crown Zenith Pokemon'); ok(/Full Art Glaceon Vstar Crown Zenith Pokemon "GG40" PSA 10/.test(s1), 'a Collector Crypt slab: ' + s1);
ok(cardTerms({ name: 'Energy Marker (BT31-EM01) (Gold-Stamped)', num: 'BT31-EM01', g: 'DB' }).vs.includes('gold'), 'gold-stamped kept, the number in brackets dropped');
process.exit(f);
