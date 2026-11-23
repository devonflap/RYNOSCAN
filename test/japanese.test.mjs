// Japanese versions from Card Rush (23 Nov): parsing a search page and matching the right version
import { parseList, pickJapanese, exclusives } from '../src/japanese.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const li = (id, alt, yen, extra = '') => `<li class="list_item_cell list_item_${id} "><div class="item_data"><a href="https://www.cardrush-op.jp/product/${id}" class="item_data_link"><img src="https://www.cardrush-op.jp/data/s${id}.jpg" data-x2="https://www.cardrush-op.jp/data/l${id}.jpg" alt="${alt}" /></a><p class="selling_price"><span class="figure">${yen}円</span></p>${extra}</div></li>`;
const html = '<ul>' + [li(1, 'ロロノア・ゾロ(コンパス背景)【SEC】{OP06-118}', '7,980'), li(2, 'ロロノア・ゾロ【SEC】{OP06-118}', '680'), li(3, '〔状態B〕ロロノア・ゾロ(パラレル/漫画背景/漫画絵)【SEC/SP】{OP06-118}', '168,000'),
  li(4, 'ロロノア・ゾロ(パラレル/漫画背景/漫画絵)【SEC/SP】{OP06-118}', '198,000'), li(5, 'ロロノア・ゾロ(パラレル/illust:Midori Matsuda)【SEC/P】{OP06-118}', '4,980'), li(6, '〔PSA10鑑定済〕ロロノア・ゾロ【SEC】{OP06-118}', '9,000'), li(7, 'ロロノア・ゾロ【SEC】{OP06-118}', '500', '<span class="soldout">SOLD OUT</span>')].join('') + '</ul>';
const L = parseList(html);
ok(L.length === 7 && L[0].yen === 7980 && L[0].num === 'OP06-118' && L[0].url.endsWith('/product/1') && L[0].img.endsWith('l1.jpg') && L[2].cond === '状態B' && !L[6].stock, 'Card Rush listings: price, number, link, picture, condition, sold out');
const card = (name, rar = 'SEC') => ({ name, num: 'OP06-118', rar, g: 'OP' });
ok(pickJapanese(card('Roronoa Zoro'), L).yen === 680, 'plain card: cheapest in-stock plain copy (not the sold-out one, not played, not a PSA slab)');
ok(pickJapanese(card('Roronoa Zoro (Alternate Art) (Manga)'), L).yen === 198000, 'manga: the manga parallel, not the played one');
ok(pickJapanese(card('Roronoa Zoro (Alternate Art)'), L).yen === 4980, 'alternate art: the parallel without manga');
ok(pickJapanese({ name: 'Roronoa Zoro', num: 'OP01-025', g: 'OP' }, L) === null, 'another number: no match');
ok(pickJapanese(card('Roronoa Zoro (Serial Numbered)'), L) === null && pickJapanese(card('Roronoa Zoro (Treasure Cup August 2026)'), L) === null && pickJapanese({ name: 'Roronoa Zoro - ST01-013 (Treasure Cup)', num: 'OP06-118', g: 'OP' }, L) === null, 'special printings (serial, Treasure Cup, events) get no Japanese match');
ok(pickJapanese({ name: 'Roronoa Zoro - OP06-118 (Alternate Art)', num: 'OP06-118', g: 'OP', rar: 'SEC' }, L).yen === 4980, 'a name with its number and a version in brackets still matches');
{ const T = parseList('<ul>' + [li(11, 'ロロノア・ゾロ【R】{OP13-037}', '180'), li(12, 'ロロノア・ゾロ(トレジャーレア)【TR】{OP13-037}', '24,800')].join('') + '</ul>');
  ok(pickJapanese({ name: 'Roronoa Zoro (OP13-037)', num: 'OP13-037', rar: 'TR', g: 'OP' }, T).yen === 24800 && pickJapanese({ name: 'Roronoa Zoro', num: 'OP13-037', rar: 'R', g: 'OP' }, T).yen === 180, 'rarity must agree: an English Treasure Rare gets the Japanese TR, not the R'); }
{ const X = [{ url: 'u1', name: 'ロロノア・ゾロ(金文字)【P】', num: 'P-001', yen: 12000, stock: true }, { url: 'u2', name: 'ロロノア・ゾロ【SEC】', num: 'OP06-118', yen: 680, stock: true }, { url: 'u3', name: '〔状態B〕ロロノア・ゾロ(金文字)【P】', num: 'P-001', yen: 9000, stock: true, cond: '状態B' }, { url: 'u4', name: 'ゾロ デッキ', num: null, yen: 5000, stock: true }, { url: 'u5', name: 'ロロノア・ゾロ(パラレル)【SR/P】', num: 'OP01-025', yen: 4000, stock: true }, { url: 'u6', name: 'ロロノア・ゾロ(金文字)【P】', num: 'P-001', yen: 15000, stock: true }, { url: 'v1', name: 'ベジット(パラレル)【SCR☆☆】', num: 'FB10-121', yen: 90000, stock: true }];
  const E = exclusives(X, { taken: new Set(['u5']), not: /ベジット/ }); ok(E.length === 1 && E[0].url === 'u1', 'Japanese exclusives: cheapest new copy once; not played, cheap, decks, or cards already matched to an English twin');
  ok(exclusives(X, { not: /ベジット|ゴジータ/ }).every((x) => !/ベジット/.test(x.name)), 'fusions left out of Vegeta'); }
process.exit(f);
