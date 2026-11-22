// Collector Crypt slab -> the tracked raw card (22 Nov): only confident matches
import { matchSlab, slabNum, slabHold } from '../docs/cards/slabmatch.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const I = [{ id: 'a', g: 'PK', name: 'Chansey', num: '20/115', sub: 'Reverse Holofoil', set: 'EX Unseen Forces', hz: 'long' }, { id: 'b', g: 'PK', name: 'Chansey', num: '20/115', sub: 'Holofoil', set: 'EX Unseen Forces', hz: 'long' },
  { id: 'c', g: 'PK', name: "Erika's Bulbasaur", num: '039/132', sub: '1st Edition', set: 'Gym Challenge' }, { id: 'd', g: 'PK', name: "Erika's Bulbasaur", num: '039/132', sub: 'Unlimited', set: 'Gym Challenge' },
  { id: 'e', g: 'PK', name: 'Charizard VMAX - SV107/SV122', num: 'SV107/SV122', sub: 'Holofoil', set: 'Shining Fates: Shiny Vault' },
  { id: 'f', g: 'OP', name: 'Monkey.D.Luffy (Manga)', num: 'OP05-119', sub: 'Foil', set: 'Awakening' }, { id: 'g', g: 'OP', name: 'Monkey.D.Luffy (Alternate Art)', num: 'OP05-119', sub: 'Foil', set: 'Awakening' }];
const m = (name, g = 'PK') => (matchSlab({ name, g }, I) || {}).id;
ok(m('2005 #20 Chansey-Reverse Foil PSA 9 EX Unseen Forces Pokemon') === 'a', 'reverse foil slab -> the reverse holo card');
ok(m('2005 #20 Chansey-Holo PSA 9 EX Unseen Forces') === 'b', 'holo slab -> the holo card');
ok(m("2000 #39 Erika's Bulbasaur 1st Edition PSA 9 Gym Challenge") === 'c', '1st edition, number with leading zeros');
ok(m('2021 #SV107/SV122 Charizard VMAX CGC 10 Shining Fates - English Pokemon') === 'e', 'shiny vault number');
ok(m('2023 #OP05-119 Monkey D. Luffy PSA 10 Manga Rare', 'OP') === 'f', 'manga slab -> manga card');
ok(m('2023 #OP05-119 Monkey D. Luffy PSA 10 Japanese Manga', 'OP') === undefined, 'Japanese One Piece: no match (not tracked)');
ok(m('2005 #21 Chansey PSA 9') === undefined, 'wrong number: no match');
ok(slabNum('2023 #042 Golbat') === '42' && slabNum('2022 #ST01-008 Nico Robin') === 'ST1-8', 'slab numbers');
ok(slabHold({ name: '2026 #1 X' }, null, 2026) === 'short' && slabHold({ name: '2025 #1 X' }, null, 2026) === 'medium' && slabHold({ name: '2019 #1 X' }, null, 2026) === 'long' && slabHold({ name: 'x' }, { hz: 'medium' }) === 'medium', 'hold length: the card\'s, else from the year');
process.exit(f);
