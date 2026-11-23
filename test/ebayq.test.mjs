// eBay searches read like a listing title (23 Nov, Ryan: "Roronoa Zoro OP01-025 SR Parallel Alt Art ... One Piece Japanese")
import { ebayQuery, slabQuery, ebayBuy } from '../docs/cards/ebayq.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const q = (name, num, g, rar, o, sub) => ebayQuery({ name, num, g, rar, sub }, o);
ok(q('Roronoa Zoro (025) (Parallel)', 'OP01-025', 'OP', 'SR') === 'Roronoa Zoro OP01-025 SR Alt Art One Piece -psa -cgc -bgs -proxy', 'English alt art: ' + q('Roronoa Zoro (025) (Parallel)', 'OP01-025', 'OP', 'SR'));
ok(q('Roronoa Zoro (025) (Parallel)', 'OP01-025', 'OP', 'SR', { jp: true }) === 'Roronoa Zoro OP01-025 SR Parallel One Piece Japanese -psa -cgc -bgs -proxy', 'Japanese copy: Parallel + Japanese');
ok(q('Roronoa Zoro (Alternate Art) (Manga)', 'OP06-118', 'OP', 'SEC') === 'Roronoa Zoro OP06-118 SEC Manga One Piece -psa -cgc -bgs -proxy', 'manga');
ok(q('Monkey.D.Luffy (OP16 Release Event Winner)', 'P-135', 'OP', 'PR') === 'Luffy P-135 Winner One Piece -psa -cgc -bgs -proxy', 'dotted name stays short, promo rarity left out, Winner kept');
ok(q('Vegeta - ST01-071 (Super Alternate Art)', 'ST01-071', 'DB', 'SCR') === 'Vegeta ST01-071 SCR Super Alt Art Dragon Ball -psa -cgc -bgs -proxy', 'Fusion World super alt art');
ok(q('Mega Rayquaza ex - 110/076', '110/076', 'PJ', 'Special Art Rare') === 'Mega Rayquaza ex 110/076 Pokemon Japanese -psa -cgc -bgs -proxy', 'Japanese Pokémon');
ok(q('Charizard', '4/102', 'PK', 'Holo Rare', {}, '1st Edition Holofoil') === 'Charizard 4/102 1st Edition Pokemon -psa -cgc -bgs -proxy', '1st edition');
ok(q('Roronoa Zoro (025) (Parallel)', 'OP01-025', 'OP', 'SR', { graded: true }).endsWith('One Piece PSA 10'), 'PSA 10 search');
ok(ebayBuy({ name: 'Luffy (Manga)', num: 'OP05-119', g: 'OP' }, { max: 719.6 }).endsWith('&_udhi=720'), 'price-capped link');
ok(slabQuery('2015 #123 Rayquaza EX CGC 9 Japanese XY Promo Pokemon') === 'Rayquaza EX 123 CGC 9 -proxy -custom', 'slab search unchanged');
process.exit(f);
