// WHICH VERSIONS ARE WORTH COLLECTING (23 Nov, Ryan: "a checklist of good Zoro and Vegeta cards to collect: SR alt arts, manga, leader alts,
// parallel leaders, rare alt arts and promos... I don't know the Dragon Ball rarities, show me the ones to collect based on One Piece").
// Each card goes into one collector's group (or none: plain commons, uncommons, rares and base leaders aren't chase cards). Groups are
// ordered rarest first, and each carries a plain explanation, with the One Piece equivalent for the Dragon Ball ones.
const has = (s, re) => re.test(String(s || ''));
export const GROUPS = {
  // One Piece
  'op-manga': { t: 'Manga', d: 'The manga-panel alt arts: the rarest and most wanted One Piece cards.', game: 'One Piece' },
  'op-sp': { t: 'SP (Special) cards', d: 'Special-art reprints of older chase cards, found in later sets.', game: 'One Piece' },
  'op-tr': { t: 'Treasure Rares', d: 'Gold-framed treasure rares from newer sets.', game: 'One Piece' },
  'op-sec-alt': { t: 'Secret Rare alt arts', d: 'Parallel (alternate art) versions of secret rares.', game: 'One Piece' },
  'op-leader-alt': { t: 'Leader alt arts / parallels', d: 'Parallel versions of leader cards.', game: 'One Piece' },
  'op-sr-alt': { t: 'SR alt arts', d: 'Parallel versions of super rares.', game: 'One Piece' },
  'op-rare-alt': { t: 'Rare and promo alt arts', d: 'Alternate-art versions of lower rarities and promos.', game: 'One Piece' },
  'op-prize': { t: 'Prize, event and serial cards', d: 'Serial-numbered, Treasure Cup, championship, winner and event cards: limited runs.', game: 'One Piece' },
  'op-prerelease': { t: 'Pre-release stamped', d: 'Pre-release and Super Pre-release stamped cards, only handed out at launch events.', game: 'One Piece' },
  'op-don': { t: 'DON!! cards', d: 'Character DON!! cards, especially gold and alt-art ones: a collecting line of their own.', game: 'One Piece' },
  'op-promo': { t: 'Other promos', d: 'Promo cards from event and promotion packs.', game: 'One Piece' },
  'op-sec': { t: 'Secret Rares (base)', d: 'The normal-art secret rares (SEC): the cheapest way to own each set\'s top card.', game: 'One Piece' },
  'op-sr': { t: 'Super Rares (base)', d: 'The normal-art super rares (SR).', game: 'One Piece' },
  // Dragon Ball Super: Fusion World (the current game; works like One Piece)
  'fw-saa': { t: 'Super Alternate Art', d: 'Fusion World\'s top chase: like a One Piece manga card.', game: 'Fusion World' },
  'fw-scr': { t: 'Secret Rares (SCR)', d: 'Fusion World secret rares and their alt arts: like One Piece SEC alt arts.', game: 'Fusion World' },
  'fw-leader-alt': { t: 'Leader alt arts', d: 'Parallel leaders: same as One Piece leader alts.', game: 'Fusion World' },
  'fw-sr-alt': { t: 'SR alt arts', d: 'Parallel super rares: same as One Piece SR alt arts.', game: 'Fusion World' },
  'fw-rare-alt': { t: 'Rare alt arts', d: 'Parallel versions of rares: the cheap alt arts.', game: 'Fusion World' },
  'fw-dokkan': { t: 'Dokkan Battle alt arts', d: 'Alt arts drawn in the Dokkan Battle mobile-game style.', game: 'Fusion World' },
  'fw-mini': { t: 'Mini cards', d: 'Small-size collector versions from special products.', game: 'Fusion World' },
  'fw-prize': { t: 'Gold, prize and event cards', d: 'Gold cards, tournament and championship winner cards, judge packs: like One Piece prize cards.', game: 'Fusion World' },
  'fw-promo': { t: 'Other promos', d: 'Promo and limited-pack cards.', game: 'Fusion World' },
  // Dragon Ball Super: Masters (the older game, BT numbers)
  'ma-gdr': { t: 'God Rares', d: 'The rarest Masters cards (about one per case): like a One Piece manga.', game: 'Masters' },
  'ma-scr': { t: 'Secret Rares', d: 'Masters secret rares: like One Piece SEC.', game: 'Masters' },
  'ma-slr': { t: 'Special Leader Rares (SLR)', d: 'Full-art leader cards: like One Piece leader alts.', game: 'Masters' },
  'ma-spr': { t: 'Special Rares (SPR)', d: 'Full-art alt versions of super rares: like One Piece SR alt arts.', game: 'Masters' },
  'ma-special': { t: 'Iconic, Concept, Duo and Expansion rares', d: 'Special-art rares made for particular sets.', game: 'Masters' },
  'ma-prize': { t: 'Gold-stamped, prize and alt-art sets', d: 'Winner and championship gold stamps, collector booster gold/silver, premium alt-art sets.', game: 'Masters' },
  'ma-promo': { t: 'Other promos', d: 'Promo cards.', game: 'Masters' },
  'ma-sr': { t: 'Super Rares (base)', d: 'Normal super rares: the cheap way in.', game: 'Masters' },
  'jp-only': { t: 'Japanese cards not in the English list', d: 'Japanese printings with no English match here: Japan-only promos, prize and event cards, gold-letter parallels, DON!! cards. Prices from Card Rush in Japan (buy through a proxy such as Buyee or ZenMarket).', game: 'Japanese' },
  'dbz-classic': { t: 'Classic Dragon Ball Z TCG', d: 'The original 2000s Dragon Ball Z game: ultra rares, rainbow foils and old promos.', game: 'Classic DBZ' },
};
export const ORDER = Object.keys(GROUPS);
export function groupOf(c) { const n = String(c.name || ''), r = String(c.rar || ''), alt = has(n, /alternate art|alt-art|parallel/i), prize = has(n, /serial|treasure cup|championship|regional|winner|judge|ultimate battle|tournament|event|playmat|gold|celebration|anniversary/i);
  if (c.g === 'OP') { if (has(n, /manga/i)) return 'op-manga'; if (has(n, /\(sp\)/i) || r === 'SP') return 'op-sp'; if (r === 'TR') return 'op-tr';
    if (r === 'DON!!' || has(n, /^don!!/i)) return 'op-don'; if (has(n, /pre-?release/i)) return 'op-prerelease'; if (prize) return 'op-prize'; if (alt && r === 'SEC') return 'op-sec-alt'; if (alt && r === 'L') return 'op-leader-alt'; if (alt && r === 'SR') return 'op-sr-alt'; if (alt) return 'op-rare-alt';
    if (r === 'PR') return 'op-promo'; if (r === 'SEC') return 'op-sec'; if (r === 'SR') return 'op-sr'; return null; }
  if (c.g !== 'DB') return null; const cat = String(c.cat || '');
  if (/fusion world/i.test(cat)) { if (has(n, /super alternate art/i)) return 'fw-saa'; if (r === 'SCR') return 'fw-scr'; if (has(n, /dokkan/i)) return 'fw-dokkan'; if (has(n, /\(mini\)/i)) return 'fw-mini'; if (prize) return 'fw-prize';
    if (alt && r === 'L') return 'fw-leader-alt'; if (alt && r === 'SR') return 'fw-sr-alt'; if (alt) return 'fw-rare-alt'; if (r === 'PR' || has(n, /limited pack|selection pack/i)) return 'fw-promo'; return null; }
  if (/masters/i.test(cat)) { if (/god rare/i.test(r)) return 'ma-gdr'; if (/secret rare/i.test(r)) return 'ma-scr'; if (/special leader rare/i.test(r)) return 'ma-slr'; if (/special rare/i.test(r)) return 'ma-spr';
    if (/iconic|concept|duo power|expansion/i.test(r)) return 'ma-special'; if (prize || has(n, /collector booster (gold|silver)|premium alt-art|alt-art set|stamped/i)) return 'ma-prize'; if (/promo/i.test(r)) return 'ma-promo'; if (/super rare/i.test(r)) return 'ma-sr'; return null; }
  if (/dragon ball z/i.test(cat)) return 'dbz-classic'; return null; }
