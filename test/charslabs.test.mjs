// graded versions of checklist cards (23 Nov)
import { gradesFor } from '../src/charslabs.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const card = { g: 'OP', name: 'Roronoa Zoro (Alternate Art) (Manga)', num: 'OP06-118', set: 'Wings of the Captain' }, base = { ...card, name: 'Roronoa Zoro' };
const S = (name, co, gr, price, mint) => ({ itemName: name, gradingCompany: co, grade: gr, nftAddress: mint, listing: { price } });
const L = [S('2023 #OP06-118 Roronoa Zoro PSA 10 Manga Wings of the Captain', 'PSA', 'GEM MT 10', 4000, 'a'), S('2023 #OP06-118 Roronoa Zoro PSA 10 Manga Wings of the Captain', 'PSA', 'GEM MT 10', 3500, 'b'), S('2023 #OP06-118 Roronoa Zoro CGC 9.5 Manga Wings of the Captain', 'CGC', 'MINT+ 9.5', 2000, 'c'), S('2023 #OP06-118 Roronoa Zoro PSA 10 Wings of the Captain', 'PSA', 'GEM MT 10', 20, 'd'), S('2023 #OP01-025 Roronoa Zoro PSA 10 Romance Dawn', 'PSA', 'GEM MT 10', 50, 'e')];
const g = gradesFor(card, L, 1.5);
ok(g['PSA 10'] && g['PSA 10'].aud === 5250 && g['PSA 10'].n === 2 && g['PSA 10'].url.endsWith('/b') && g['CGC 9.5'].aud === 3000 && Object.keys(g).length === 2, 'manga: cheapest PSA 10 (2 listed) and CGC 9.5; the plain and other-number slabs left out');
ok(gradesFor(base, L, 1.5)['PSA 10'].aud === 30, 'plain card gets the plain slab');
process.exit(f);
