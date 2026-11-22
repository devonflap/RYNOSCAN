// the card finder's signals (21 Nov): dropped deals, new-release chase cards, hold lengths
import { CARD, stats, statusOf, horizonOf, newSetView, isDeal } from '../src/cardsig.mjs';
import { sampleDays, slim, targetOf } from '../src/cards.mjs';
import { slabRow, ccRow, ccBands, gradeOf, gameOf, sameSlab, gradeKey, saleRow, ccComps } from '../src/slabs.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const D = 86400e3, now = Date.parse('2026-11-21T12:00:00Z'), ser = (pts) => pts.map(([daysAgo, v]) => [now - daysAgo * D, v]);
// a $600 card that fell to $400 and has sat there for 3 weeks: a deal
const flat = ser([[150, 560], [120, 600], [90, 590], [60, 520], [30, 430], [21, 405], [14, 402], [10, 398], [7, 401], [3, 400], [0, 404]]), s1 = stats(flat, now);
ok(Math.abs(s1.off - (404 / 600 - 1)) < 1e-9 && Math.abs(s1.ch7 - (404 / 401 - 1)) < 1e-9 && s1.range14 < 0.03, `stats: ${Math.round(s1.off * 100)}% off the 6-month high of $600, ${(s1.ch7 * 100).toFixed(1)}% this week, steady 2 weeks`);
ok(statusOf(s1).key === 'settled' && isDeal({ s: s1 }), 'a third off its high and steady: "buy zone", on the deals list');
// still sliding: not a deal yet
const slide = ser([[60, 600], [30, 500], [14, 450], [7, 430], [0, 380]]), s2 = stats(slide, now); ok(statusOf(s2).key === 'falling' && !isDeal({ s: s2 }), 'down 12% this week: "still falling, wait", kept off the deals list');
// bounced off its low: turning
const turn = ser([[120, 800], [30, 520], [14, 480], [10, 470], [7, 490], [0, 500]]), s3 = stats(turn, now); ok(statusOf(s3).key === 'turning' && isDeal({ s: s3 }), 'a third off and 6% up from its 2-week low: "turning up"');
// near its high: no discount
const hi = ser([[60, 300], [30, 310], [7, 305], [0, 300]]); ok(statusOf(stats(hi, now)).key === 'holding' && !isDeal({ s: stats(hi, now) }), 'near its high: "no discount yet"');
// outside the price band
const cheap = ser([[60, 120], [14, 60], [7, 61], [0, 62]]), dear = ser([[60, 3000], [14, 1500], [7, 1490], [0, 1500]]); ok(!isDeal({ s: stats(cheap, now) }) && !isDeal({ s: stats(dear, now) }), `outside the A$${CARD.minAud}-${CARD.maxAud} band: left out ($62 and $1,500)`);
ok(horizonOf(60) === 'short' && horizonOf(400) === 'medium' && horizonOf(1500) === 'long', 'hold length by set age: under 9 months short, 9-30 months medium, older long');
// a new set: chase cards falling after launch, then settled
const mk = (pts) => ({ s: stats(ser(pts), now) }), fall = newSetView([mk([[20, 900], [7, 700], [0, 600]]), mk([[20, 500], [7, 420], [0, 380]]), mk([[20, 300], [7, 260], [0, 240]])]);
ok(/still falling/.test(fall.verdict) && fall.chase[0].s.cur === 600, 'new set, chase cards still dropping each week: "wait" (' + fall.verdict + ')');
const settled = newSetView([mk([[40, 900], [14, 610], [7, 600], [0, 605]]), mk([[40, 500], [14, 352], [7, 350], [0, 351]]), mk([[40, 300], [14, 300], [0, 301]])]);
ok(settled.ready === 2 && /settled after the launch drop: look now/.test(settled.verdict), 'new set, two chase cards settled a third under launch: "look now"');
// archive days: daily for 3 weeks, then weekly to 6 months
const d = sampleDays(now); ok(d.length === 21 + 23 && d[d.length - 1] === '2026-11-20' && d[0] === '2026-05-23', `archive days: ${d.length} (21 daily, then weekly back to ${d[0]})`);
const sl = slim({ g: 'OP', set: 'X', age: 400, name: 'Luffy', aud: 404, s: s1, series: flat }); ok(sl.stKey === 'settled' && sl.hz === 'medium' && sl.sp.length >= 8 && sl.sp[sl.sp.length - 1] === 404, 'the page row: status, hold length and a weekly price line ending at today');
// vintage card trading on single sales: the price jumps about, the 'drop' is noise
const spiky = ser([[150, 3338], [120, 3338], [100, 750], [90, 3338], [70, 6751], [50, 6751], [30, 750], [14, 750], [7, 750], [0, 750]]), sk = stats(spiky, now);
ok(sk.erratic && !isDeal({ s: sk }) && sk.high === 6751, `single-sale vintage card (A$3,338 -> 750 -> 6,751 -> 750): erratic (${sk.jumps} big jumps), kept off the deals list`);
const one = ser([[120, 400], [100, 400], [90, 1200], [80, 400], [60, 380], [30, 300], [14, 290], [7, 288], [0, 290]]), so = stats(one, now);
ok(so.high === 400 && Math.abs(so.off - (290 / 400 - 1)) < 1e-9, 'one odd sale at A$1,200 does not become the high: the high is A$400 (smoothed), so the drop is 28%, not 76%');
// slabs on sale (Collector Crypt on Magic Eden): asking price in SOL against Collector Crypt's insured value in USD
const L = (name, cat, ins, price) => ({ tokenMint: 'Mint1', price, token: { name, image: 'i', attributes: [{ trait_type: 'Category', value: cat }, { trait_type: 'Insured Value', value: String(ins) }, { trait_type: 'Status', value: 'Valid' }, { trait_type: 'Year', value: '2023' }] } });
const env = { solUsd: 150, fx: 1.5 };
const r1 = slabRow(L('2023 #GG40 Full Art/Glaceon Vstar PSA 10 Crown Zenith Pokemon', 'Pokemon', 200, 1), env);
ok(r1 && r1.g === 'PK' && r1.grade === 'PSA 10' && r1.aud === 225 && r1.insAud === 300 && Math.abs(r1.under - 0.25) < 1e-9 && /magiceden\.io\/item-details\/Mint1/.test(r1.url), 'a PSA 10 listed at 1 SOL ($150) against a $200 insured value: 25% under, A$225 vs A$300, with its Magic Eden link');
ok(r1 && 'seller' in r1, 'Magic Eden rows keep the seller (checked against the owner on Collector Crypt)');
ok(slabRow(L('Luffy PSA 10', 'One Piece', 200, 1.25), env) === null, 'listed at 94% of its value: not a deal');
ok(slabRow(L('Energy Removal CGC 8.5 Pokemon', 'Pokemon', 11, 0.03), env) === null && slabRow(L('Jordan PSA 9', 'Basketball', 400, 1), env) === null, 'under A$100, or not one of our games: left out');
ok(gradeOf('2000 #119 BASE SET 2 ENERGY REMOVAL CGC 8.5 POKEMON') === 'CGC 8.5' && gradeOf('Charizard BGS 9.5') === 'BGS 9.5' && gameOf('One Piece', 'x') === 'OP' && gameOf('Pokemon', 'Pikachu Japanese PSA 10') === 'PJ' && gameOf('TCG', 'Goku Dragon Ball Super PSA 9') === 'DB', 'grades and games read from the listing');
ok(targetOf(s1) === Math.round(404 * 0.9) && targetOf(s2) === Math.round(380 * 0.9) && targetOf({ cur: 100, lo14: 80 }) === 80, 'wish-list target: 10% under today (A$364 on a A$404 card), or the 2-week low when that is lower (A$80 on a A$100 card)');
// 22 Nov: Collector Crypt's own marketplace (a real listing's shape from api.collectorcrypt.com/marketplace)
{ const cc = (name, cat, ins, price, mp = 'CC') => ({ itemName: name, category: cat, insuredValue: String(ins), nftStatus: 'Valid', gradingCompany: 'PSA', grade: 'GEM-MT 10', nftAddress: 'Abc123', images: { frontM: 'https://x/f.jpg' }, vault: 'PWCC', listing: { currency: 'USDC', price, marketplace: mp } });
  const r = ccRow(cc('2000 #6 Team Rocket 1st Edition Holo Dark Dugtrio MINT PSA 9', 'Pokemon', 505, 366), { fx: 1.5 });
  ok(r && r.src === 'Collector Crypt' && Math.abs(r.under - 0.275) < 0.01 && r.url === 'https://collectorcrypt.com/assets/solana/Abc123' && r.aud === 549, 'Collector Crypt listing 27% under its valuation: a deal, linked to its card page');
  ok(ccRow(cc('Umbreon PSA 10', 'Pokemon', 170, 165), { fx: 1.5 }) === null, '97% of its value: not a deal');
  ok(ccRow({ ...cc('Luffy PSA 10', 'One Piece', 200, 100), listing: null }, { fx: 1.5 }) === null, 'not listed: skipped');
  ok(ccRow(cc('Luffy PSA 10', 'One Piece', 200, 100, 'ME'), { fx: 1.5 }).src === 'Magic Eden', 'listed on Magic Eden through Collector Crypt: says so');
  const b = ccBands(1.5); ok(b[0][0] === 23 && b[b.length - 1][1] >= 2000 && b.every(([lo, hi, m]) => hi > lo && m < hi), `${b.length} value bands cover A$35-3,000, each asking only for listings under 90% of its top`); }
{ const r = ccRow({ itemName: 'Luffy PSA 10', category: 'One Piece', insuredValue: '200', nftStatus: 'Valid', nftAddress: 'Z9', getBuybackOffer: true, listing: { currency: 'USDC', price: 150, marketplace: 'CC' } }, { fx: 1.5 });
  ok(r.bb === true && r.bbAud === 260.1 && r.aud < r.bbAud, 'buyback open card: buyback A$260 (86.7%) is more than its A$225 price'); }
{ const row = { name: '2024 #170 Terapagos EX PSA 10 Scr EN-Stellar Crown', grade: 'PSA 10' }, mk = (name, co, gr) => ({ itemName: name, gradingCompany: co, grade: gr });
  ok(sameSlab(row, mk('2024 #170 Terapagos EX PSA 10 Scr EN-Stellar Crown Pokemon', 'PSA', 'GEM MT 10')) && !sameSlab(row, mk('2024 #170 Terapagos EX PSA 9 Stellar Crown', 'PSA', 'MINT 9')) && !sameSlab(row, mk('2024 #170 Terapagos EX CGC 10', 'CGC', 'Pristine 10')) && !sameSlab(row, mk('2024 #128 Terapagos EX PSA 10', 'PSA', 'GEM MT 10')), 'supply counts the same card in the same grade only');
  ok(gradeKey('CGC', 'NM/MINT+ 8.5') === 'CGC 8.5' && gradeKey('PSA', 'GEM-MT 10') === 'PSA 10', 'grade keys'); }
{ const x = saleRow({ amount: '120.5', createdAt: '2026-11-20T10:00:00Z', to: { name: 'someone' }, card: { nftAddress: 'A1', insuredValue: '140', itemName: '2024 #170 Terapagos EX PSA 10 Stellar Crown', gradingCompany: 'PSA', grade: 'GEM MT 10', category: 'Pokemon' } });
  const bb = saleRow({ amount: '100', createdAt: '2026-11-21T10:00:00Z', to: { name: 'Collector Crypt Buybacks' }, card: { nftAddress: 'A2', insuredValue: '115', itemName: '2024 #170 Terapagos EX PSA 10', gradingCompany: 'PSA', grade: 'GEM MT 10' } });
  const y = { ...x, k: 'b', usd: 130, t: Date.parse('2026-11-22') }, z = { ...x, k: 'c', usd: 90, name: '2024 #170 Terapagos EX PSA 9', grade: 'MINT 9' };
  const cc = ccComps({ name: '2024 #170 Terapagos EX PSA 10 Scr EN-Stellar Crown', grade: 'PSA 10' }, [x, y, z, bb], 1.5, Date.parse('2026-11-23'));
  ok(x.usd === 120.5 && bb.bb && cc && cc.n === 2 && cc.aud === 187.88, 'Collector Crypt sales log: same card and grade only, buybacks kept apart, median A$188'); }
process.exit(f);
