// the bottomed-out backtest's maths: SOL's risk switch, the 70-90% entries, the exits and the DCA
import { regimeMap, entriesFor, exitFrom, tradesFor, EXITS, BBT } from '../src/bottombt.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const D = 86400, T0 = 1700000000 - (1700000000 % D);
// SOL: falls for 120 days, then rises
const sol = [...Array(300)].map((_, i) => [T0 + i * D, i < 150 ? 200 - i * 0.6 : 110 + (i - 150) * 0.8]); const reg = regimeMap(sol);
ok(reg.get(Math.floor((T0 + 100 * D) / D)) === false && reg.get(Math.floor((T0 + 200 * D) / D)) === true, 'SOL under its 20-day average for two days: risk-off; back over it: risk-on');
// a coin: 1.0 for 30 days, up to 5.0, then down 90% to 0.5 by day 150, flat, then up from day 170 (after SOL turns)
const coin = [...Array(300)].map((_, i) => { const p = i < 30 ? 1 : i < 60 ? 1 + (i - 30) * (4 / 30) : i < 150 ? 5 - (i - 60) * (4.5 / 90) : i < 170 ? 0.5 : 0.5 + (i - 170) * 0.02; return [T0 + i * D, p, 100000, p * 1e6]; });
const E = entriesFor(coin, reg); ok(E.dd80.length && E.dd80[0] > 170 && E.dd70.length >= E.dd90.length, 'the 80% entry waits for SOL risk-on AND the coin turning up (after day 170), not just the drop');
ok(E.dca.some((x) => x.dd >= 0.9), 'the DCA sees the 90% level');
const x = exitFrom(coin, E.dd80[0], reg, EXITS.hold60); ok(x.ret > 50 && x.days === 60, 'held 60 days from the turn: ' + x.ret.toFixed(0) + '%');
const T = tradesFor(coin, reg, BBT, () => 0.5); ok(T['dca / hold60'].length === 3 && T['dd80 / riskoff'].length >= 1 && T['random / trail40'].length === 1, 'every entry with every exit; the DCA buys three thirds');
process.exit(f);
