// graded sold comps -> fair value (23 Nov)
import { fairValue, parseGrade, salesFrom, gradeSummary } from '../src/comps.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const now = Date.parse('2026-11-23T00:00:00Z'), d = (days) => now - days * 86400e3, s = (p, days, co = 'PSA', g = 10) => ({ p, d: d(days), co, g });
ok(JSON.stringify(parseGrade('CGC 9.5')) === '{"co":"CGC","g":9.5}' && parseGrade('PSA GEM MT 10').g === 10 && parseGrade('Beckett 9.5').co === 'BGS', 'grades');
const S = [s(100, 2), s(104, 5), s(98, 9), s(110, 20), s(95, 40), s(102, 60), s(99, 75), s(101, 85), s(400, 3), s(20, 4), s(300, 10, 'CGC'), s(60, 6, 'PSA', 9), s(150, 300)];
const fv = fairValue(S, { co: 'PSA', g: 10, now });
ok(fv && fv.usd >= 99 && fv.usd <= 104, 'fair value ~US$100 from the PSA 10 sales: ' + (fv && fv.usd));
ok(fv.n === 8 && fv.n90 === 8 && fv.n30 === 4 && fv.conf === 'high', 'the A$400 and A$20 oddities, the CGC and PSA 9 sales and the 300-day-old sale are left out; 8 in 90 days, latest this month: high confidence');
ok(fairValue(S, { co: 'PSA', g: 9, now }).conf === 'none' && fairValue([], { co: 'PSA', g: 10, now }) === null, 'one sale: no confidence; none: nothing');
ok(fairValue([s(100, 100), s(110, 120), s(90, 150), s(105, 170)], { co: 'PSA', g: 10, now }).conf === 'low', 'old sales only: low confidence');
const fresh = fairValue([s(100, 80), s(100, 85), s(100, 70), s(200, 1), s(200, 2), s(200, 3)], { co: 'PSA', g: 10, now }); ok(fresh.usd === 200, 'recent sales count most (price went up)');
const L = salesFrom({ ebay: { soldListings: [{ gradingCompany: 'PSA', grade: '10', price: 55, soldDate: '2026-11-20', bestOfferAccepted: true, printing: 'Holofoil' }, { gradingCompany: 'CGC', grade: 9.5, price: 30, date: '2026-11-01' }, { grade: 'raw', price: 5 }] } });
ok(L.length === 2 && L[0].co === 'PSA' && L[0].g === 10 && L[0].bo && L[0].d === Date.parse('2026-11-20') && L[1].g === 9.5, 'PokemonPriceTracker sold listings read (grader, grade, date, best offer)');
ok(gradeSummary({ ebay: { salesByGrade: { psa10: { count: 9, medianPrice: 80, smartMarketPrice: 85 } } } }, 'PSA', 10).usd === 85, 'per-grade summary as a fallback');
process.exit(f);
