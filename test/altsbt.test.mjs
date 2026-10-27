// the alts backtest (27 Oct): Chill's DCA and a trend rule on the big coins, against holding BTC and random days
import { altEntries, altTrades, altSummary, btcSame, isAlt, ABT, LEVELS } from '../src/altsbt.mjs';
import { regimeMap } from '../src/bottombt.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const D = 86400, T0 = 1700000000 - 1700000000 % D, mk = (fn, n = 800, vol = 1e7, mcap = 5e8) => Array.from({ length: n }, (_, i) => [T0 + i * D, fn(i), vol, mcap]);
const btc = mk((i) => 100 + i * 0.2), reg = regimeMap(btc.map((x) => [x[0], x[1]])), btcByDay = new Map(btc.map((x) => [Math.floor(x[0] / D), x[1]]));
ok([...reg.values()].every(Boolean), 'a steadily rising BTC: risk-on every day');
// a coin that peaks at 100 on day 200, falls to 8 by day 400, then recovers to 60 by day 700
const coin = mk((i) => (i < 200 ? 10 + i * 0.45 : i < 400 ? 100 - (i - 200) * 0.46 : 8 + (i - 400) * 0.1733));
const E = altEntries(coin, reg);
ok(E.dca.filter((x) => x.l === 0.7).length === 1 && E.dca.filter((x) => x.l === 0.9).length === 1 && E.dca.every((x) => x.i >= ABT.minAgeD), 'the coin crosses -70%, -80% and -90% under its year high once each on the way down');
ok(E.trend.length > 0 && E.trend.every((i) => coin[i][1] > Math.max(...coin.slice(i - ABT.trendD, i).map((x) => x[1]))), 'trend entries: a close above the last 20 days\' high while BTC is risk-on');
ok(altEntries(mk((i) => (i < 200 ? 10 + i * 0.45 : 100 - (i - 200) * 0.46), 400, 1e5, 5e8), reg).dca.length === 0 && altEntries(mk((i) => (i < 200 ? 10 + i * 0.45 : 100 - (i - 200) * 0.46), 400, 1e7, 1e7), reg).dca.length === 0, 'no entries on a coin trading $100k a day, or a $10m coin: the quality bar is checked on the day');
const T = altTrades(coin, reg, btcByDay, ABT, () => 0.5);
ok(Object.keys(T).some((k) => k === 'dca / riskoff') && T['dca / hold60'].length === 3 && T['dca / hold60'].every((r) => r.btc != null), 'every entry through every exit, each trade carrying what holding BTC the same days made');
ok(T['dca / hold60'].filter((r) => r.lvl === 0.9)[0].ret > 50, 'the -90% clip held 60 days into the recovery makes money');
ok(Math.abs(btcSame(btcByDay, T0 + 100 * D, 10) - (122 / 120 - 1) * 100) < 1e-6, 'holding BTC over the same days: its close-to-close return');
const S = altSummary([{ coin: 'A', res: T }, { coin: 'B', res: altTrades(mk((i) => (i < 300 ? 5 + i * 0.3 : 95 - (i - 300) * 0.17)), reg, btcByDay, ABT, () => 0.2) }]);
ok(S.combos['dca / hold60'] && 'btcAvg' in S.combos['dca / hold60'] && 'beatsBtc' in S.combos['dca / hold60'] && 'holdsTrim' in S.combos['dca / hold60'] && Array.isArray(S.passed), 'the summary measures each rule against holding BTC and random days, on both halves without their best trade');
ok(isAlt({ id: 'solana', symbol: 'sol', name: 'Solana' }) && !isAlt({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }) && !isAlt({ id: 'tether', symbol: 'usdt', name: 'Tether' }) && !isAlt({ id: 'wrapped-bitcoin', symbol: 'wbtc', name: 'Wrapped Bitcoin' }) && !isAlt({ id: 'lido-staked-ether', symbol: 'steth', name: 'Lido Staked Ether' }), 'alts only: no BTC, no stablecoins, no wrapped or staked coins');
process.exit(f);
