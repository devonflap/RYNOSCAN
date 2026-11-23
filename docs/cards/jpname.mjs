// JAPANESE CARD NAMES IN ENGLISH (23 Nov, Ryan: "don't label the Japanese cards in Japanese, translate to English"). Card Rush writes names
// like ロロノア・ゾロ(パラレル/漫画背景)【SEC】; this turns the words its listings use into English. Card text and quotes it doesn't know are
// dropped rather than shown in Japanese.
const W = [
  ['ブロリー＆ベジータ', 'Broly & Vegeta'], ['ゾロ＆サンジ', 'Zoro & Sanji'], ['ニコ・ロビン', 'Nico Robin'], ['ロビン', 'Robin'], ['ロロノア・ゾロ', 'Roronoa Zoro'], ['ゾロ十郎', 'Zoro-Juurou'], ['ロロノア', 'Roronoa'], ['ゾロ', 'Zoro'],
  ['ベジータミニ', 'Vegeta (Mini)'], ['ベジータ：幼年期', 'Vegeta: Childhood'], ['ベジータ', 'Vegeta'], ['孫悟空', 'Son Goku'], ['ラディッツ', 'Raditz'], ['スーパーベビー', 'Super Baby'], ['ベジット', 'Vegito'], ['ゴジータ', 'Gogeta'], ['たしぎ', 'Tashigi'], ['ルフィ', 'Luffy'], ['サンジ', 'Sanji'],
  ['スーパーパラレル', 'Super Parallel'], ['パラレル', 'Parallel'], ['漫画背景', 'Manga background'], ['漫画絵', 'Manga art'], ['漫画', 'Manga'], ['金文字', 'Gold letter'], ['フルアート', 'Full art'], ['シリアル', 'Serial'],
  ['ダンボール付未開封', 'Sealed, with box'], ['フィギュア付未開封', 'Sealed, with figure'], ['未開封', 'Sealed'], ['英語版', 'English edition'], ['中国語版', 'Chinese edition'], ['中国版', 'Chinese edition'], ['中国語', 'Chinese'],
  ['銀枠', 'Silver frame'], ['金枠', 'Gold frame'], ['赤枠', 'Red frame'], ['エナジーマーカー', 'Energy marker'], ['ドン!!カード', 'DON!! card'], ['ドン', 'DON!!'], ['カード', 'card'], ['赤背景', 'Red background'], ['黒背景', 'Black background'], ['コンパス背景', 'Compass background'],
  ['ロゴ有', 'With logo'], ['ロゴ', 'Logo'], ['レリーフ仕様', 'Relief finish'], ['実写', 'Live action'], ['白黒', 'Black and white'], ['和柄', 'Japanese pattern'], ['サプライ', 'Supply'], ['キャラ', 'Character'], ['緑', 'Green'],
  ['修正後', 'Corrected'], ['修正前', 'Pre-correction'], ['ワノ国', 'Wano'], ['特徴麦わらの一味', 'Straw Hat Crew'], ['麦わらの一味', 'Straw Hat Crew'], ['右手開き', 'Right hand open'], ['口閉じ', 'Mouth closed'],
  ['特訓の成果', 'Fruits of Training'], ['ファイナルかめはめ波', 'Final Kamehameha'], ['破壊王子', 'Prince of Destruction'], ['破壊の剛腕', 'Arm of Destruction'], ['リーダー', 'Leader'], ['プロモ', 'Promo'], ['優勝', 'Winner'], ['プレミアム', 'Premium'],
  ['フラッグシップバトル', 'Flagship Battle'], ['スタンダードバトル', 'Standard Battle'], ['状態', 'Condition '], ['幼年期', 'Childhood'], ['超サイヤ人', 'Super Saiyan'], ['少年期', 'Young'],
];
const JP = /[　-ヿ㐀-鿿！-｠]/;
export function jpName(s) { let t = String(s || '').replace(/^☆SALE☆/, '').replace(/【([^】]*)】/g, (m, g) => ` ${g.replace(/☆/g, '★').replace(/\//g, ' ').replace(/^-$/, '')}`).replace(/[『』「」]/g, ' ').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/：/g, ': ').replace(/＆/g, ' & ').replace(/・/g, ' ');
  for (const [j, e] of W) t = t.split(j).join(` ${e} `);
  /* bracket parts: translated words kept, anything still in Japanese (quotes, card text) dropped */
  t = t.replace(/\(([^)]*)\)/g, (m, g) => { const parts = g.split('/').map((x) => x.trim()).filter((x) => x && !JP.test(x)); return parts.length ? ` (${parts.join(', ')})` : ''; });
  t = t.split(/\s+/).filter((w) => !JP.test(w)).join(' ').replace(/\s+([),:])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();
  return t || 'Japanese card'; }
