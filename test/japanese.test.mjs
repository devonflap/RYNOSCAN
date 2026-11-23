// Japanese versions from Card Rush (23 Nov): parsing a search page and matching the right version
import { parseList, pickJapanese } from '../src/japanese.mjs';
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
process.exit(f);
