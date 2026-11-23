// One card, every language (23 Nov): Japanese Card Rush listings fold into their English card; eBay titles matched per language
import { homeFor, langTitle } from '../docs/cards/langs.mjs';
import { cheapest, audOf } from '../src/ebaylang.mjs';
import { jpName } from '../docs/cards/jpname.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const plain = { id: 'a', name: 'Roronoa Zoro', num: 'OP01-025', g: 'OP', aud: 20 }, alt = { id: 'b', name: 'Roronoa Zoro (Parallel)', num: 'OP01-025', g: 'OP', aud: 347 }, manga = { id: 'c', name: 'Roronoa Zoro (Alternate Art) (Manga)', num: 'OP06-118', g: 'OP', aud: 3600 };
ok(homeFor({ num: 'OP01-025', name: 'ロロノア・ゾロ(パラレル)【SR】' }, [plain, alt, manga]) === alt, 'a Japanese parallel goes on the English alt art');
ok(homeFor({ num: 'OP01-025', name: 'ロロノア・ゾロ(CS/illust:kankurou)【SR】' }, [plain, alt]) === plain, 'another plain-ish printing goes on the plain card');
ok(homeFor({ num: 'P-001', name: 'ロロノア・ゾロ(金文字)【P】' }, [plain, alt]) === null, 'a number with no English card stays a Japanese exclusive');
ok(langTitle('Roronoa Zoro OP01-025 SR Parallel Alt Art Romance Dawn One Piece Japanese NM', alt, 'jp'), 'Japanese parallel title matches the alt art');
ok(!langTitle('Roronoa Zoro OP01-025 SR Romance Dawn One Piece Japanese NM', alt, 'jp'), 'plain copy is not the alt art');
ok(!langTitle('Roronoa Zoro OP01-025 SR Parallel One Piece Japanese PSA 10', alt, 'jp'), 'slabs left out');
ok(!langTitle('Roronoa Zoro OP01-025 SR Parallel One Piece English', alt, 'jp') && !langTitle('Roronoa Zoro OP01-025 Parallel Chinese', alt, 'jp'), 'other languages left out');
ok(langTitle('One Piece Simplified Chinese OP01-025 Zoro SR Parallel', alt, 'cn'), 'Chinese title matches in Chinese');
ok(!langTitle('Zoro OP06-118 SEC Parallel Japanese', manga, 'jp') && langTitle('Zoro OP06-118 SEC Manga Japanese', manga, 'jp'), 'manga needs manga in the title');
{ const fx = { USD: 1.5 }, L = [{ title: 'Zoro OP01-025 Parallel Japanese', price: { value: '40', currency: 'USD' }, shippingOptions: [{ shippingCost: { value: '5', currency: 'USD' } }], itemWebUrl: 'u1' }, { title: 'Zoro OP01-025 Parallel Japanese', price: { value: '50', currency: 'AUD' }, itemWebUrl: 'u2' }, { title: 'Zoro OP01-025 Japanese', price: { value: '5', currency: 'AUD' }, itemWebUrl: 'u3' }];
  ok(audOf(L[0], fx).aud === 67.5, 'US$ listing converted to A$ with postage'); const b = cheapest(L, alt, 'jp', fx); ok(b.url === 'u2' && b.n === 2, 'cheapest matching listing, count of matches'); }
ok(jpName('ベジータ(パラレル/金文字)【SR☆】') === 'Vegeta (Parallel, Gold letter) SR★' && jpName('ロロノア・ゾロ(未開封/英語版/TREASURECUP/illust:kankurou)【SR】') === 'Roronoa Zoro (Sealed, English edition, TREASURECUP, illust:kankurou) SR', 'Japanese names in English');
ok(!/[\u3040-\u30ff\u4e00-\u9fff]/.test(jpName('ルフィは海賊王になる男だ!!!(フルアート/金文字)【R】')), 'untranslated Japanese dropped, not shown');
{ const fx = {}, it = (title, v) => ({ title, price: { value: String(v), currency: 'AUD' }, itemWebUrl: title });
  ok(cheapest([it('Roronoa Zoro OP15-113 Japanese', 2.5)], { name: 'Roronoa Zoro (Treasure Cup August 2026)', num: 'OP15-113', g: 'OP', aud: 3599 }, 'jp', fx) === null, 'special printings (Treasure Cup, serial, judge pack) get no eBay match');
  ok(cheapest([it('Roronoa Zoro OP06-118 SEC Parallel Alt Art Japanese', 4.5)], { name: 'Roronoa Zoro (Alternate Art)', num: 'OP06-118', g: 'OP', aud: 147 }, 'jp', fx) === null, 'a price far under the English one is left out');
  ok(cheapest([it('Roronoa Zoro OP18-092 UC Chinese', 452)], { name: 'Roronoa Zoro (092)', num: 'OP18-092', g: 'OP', aud: 12 }, 'cn', fx) === null, 'a price far over the English one is left out');
  ok(cheapest([it('Roronoa Zoro OP13-037 Rare Japanese', 2.3)], { name: 'Roronoa Zoro (OP13-037)', num: 'OP13-037', rar: 'TR', g: 'OP', aud: 170 }, 'jp', fx) === null, 'a Treasure Rare needs TR in the title'); }
process.exit(f);
