// best bets (30 Oct): only what beats random, with its plan and the research's red flags
import { redFlags, planFor, runnerBets, chillBets } from '../docs/bestbets.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const coin = (m, o = {}) => ({ coin: 'X', chain: 'Solana', pool: 'P', net: 'solana', price: 1, passed: 3, vetoed: [], tier: 'Runner', m: { fdv: 3e6, liq: 300000, v24: 2e6, ageD: 3, bs1: 1.4, ...m }, ...o });
ok(!redFlags(coin({})).length, 'a $3m coin, 3 days old, $300k pool, calm buying: no red flag');
ok(redFlags(coin({ fdv: 5e5 })).length === 1 && redFlags(coin({ ageD: 0.02 })).some((x) => /minutes old/.test(x)) && redFlags(coin({ bs1: 3.1 })).some((x) => /pile-in/.test(x)) && redFlags(coin({ v24: 1e8 })).some((x) => /wash/.test(x)) && redFlags(coin({ liq: 50000, fdv: 3e6 })).some((x) => /nobody can sell/.test(x)), 'each red flag: under $1m, under an hour, buys 2.5x+, wash volume, a thin pool under its coin');
const p = planFor(2); ok(Math.abs(p.stop - 1.64) < 1e-9 && p.sells.map((s) => s.px).join() === '2.8,4,6', 'the plan is the Risky · Claude book\'s: stop 18%, sells at +40%, 2x, 3x');
const council = { books: [{ key: 'riskyPick', n: 21, avgR: 0.86, lo: -0.28, hi: 2.11 }, { key: 'randomCtl', n: 50, avgR: -0.18 }] }, runners = { items: [coin({}), coin({ fdv: 4e5 }, { coin: 'Y' }), coin({}, { coin: 'Z', passed: 2 }), coin({}, { coin: 'V', vetoed: ['dev'] })] };
const A = runnerBets({ runners, council, runnerBt: null }); ok(A.beats && A.go.map((x) => x.coin).join() === 'X' && A.held.map((x) => x.coin).join() === 'Y' && /\+0\.86R/.test(A.record), 'beating random: the clean 3-check coin is shown with its plan; the flagged one is held back with why; 2 checks or a veto are not there');
const A2 = runnerBets({ runners, council: { books: [{ key: 'riskyPick', n: 21, avgR: -0.3 }, { key: 'randomCtl', n: 50, avgR: -0.18 }] } }); ok(!A2.beats && !A2.go.length && /Not beating random/.test(A2.why), 'when its record stops beating random, its coins drop off by themselves');
const bt = { combos: { 'dca / riskoff': { n: 105, avg: 38, exBest: 32, olderExBest: 45, newerExBest: -1.5, holdsTrim: false }, 'random / riskoff': { avg: -18 } } };
const B = chillBets({ bottoms: { coins: [{ symbol: 'ANSEM', dd: 0.81, fresh: [0.8], mcap: 5e6 }], regimeWhy: 'risk-off' }, bottomBt: bt }); ok(B.beats && B.go.length === 1 && /Not proven on both halves/.test(B.record), 'Chill: shown while its backtest beats random days, with the honest caveat');
ok(!chillBets({ bottoms: { coins: [{ symbol: 'A', dd: 0.8 }] }, bottomBt: { combos: { 'dca / riskoff': { n: 105, avg: -5, exBest: -20 }, 'random / riskoff': { avg: -18 } } } }).go.length, 'and hidden when it does not');
process.exit(f);
