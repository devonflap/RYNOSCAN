// BEST BETS RIGHT NOW (30 Oct, Ryan: "is there something better than bid-ready that our research has found?"). The top of the scanner shows
// only the setups whose record beats random entries, each with the exact trade plan that record was earned with, and every coin checked
// against the red flags the research confirmed on both halves of hundreds of trades. A setup drops off by itself when its record stops
// beating random (self-policing); a coin with a red flag is held back and says why. Pure functions: the page passes in the data files.
export const CLAUDE = { stopPct: 18, sells: [[1.4, 25], [2, 25], [3, 25]], trailPct: 35, maxDays: 5 };
// the red flags (each held on both halves of its data): see bot/README.md, the trench council's confirmed slices and the fake-profit fixes
export function redFlags(r) { const m = (r && r.m) || {}, out = [], fdv = +m.fdv || 0, liq = +m.liq || 0, v24 = +m.v24 || 0, ageH = m.ageD != null ? +m.ageD * 24 : null;
  if (fdv > 0 && fdv < 1e6) out.push(`market cap $${Math.round(fdv / 1000)}k: under $1m, the worst slice of every trench test`);
  if (ageH != null && ageH < 1) out.push(`${Math.round(ageH * 60)} minutes old: coins under an hour old lost the most and rugged the most`);
  if (m.bs1 != null && +m.bs1 > 2.5) out.push(`buys ${(+m.bs1).toFixed(1)}x the sells: a pile-in, the confirmed worst slice`);
  if (fdv > 0 && v24 > 20 * fdv) out.push(`$${Math.round(v24 / 1e6)}m traded on a $${Math.round(fdv / 1e6) || '<1'}m coin in a day: wash volume`);
  if (fdv > 0 && liq > 0 && liq < 0.05 * fdv) out.push(`$${Math.round(liq / 1000)}k of liquidity under a $${(fdv / 1e6).toFixed(1)}m coin: a price nobody can sell into`);
  if (liq > 0 && liq < 30000) out.push(`$${Math.round(liq / 1000)}k pool: too thin`);
  return out; }
export const planFor = (price, P = CLAUDE) => ({ entry: price, stop: price * (1 - P.stopPct / 100), sells: P.sells.map(([x, pct]) => ({ px: price * x, pct })), trailPct: P.trailPct, maxDays: P.maxDays });
const fR = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(2) + 'R'), fP = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x + '%');
// the runner list, sold the Risky · Claude way: shown while its paper record beats random entries
export function runnerBets({ runners, council, runnerBt }) { const bk = (council && council.books) || [], P = bk.find((b) => b.key === 'riskyPick'), R = bk.find((b) => b.key === 'randomCtl'), G = runnerBt && runnerBt.groups, bt = G && G['listed (3+ checks)'] && G['listed (3+ checks)'].combos['listing / claude'], btR = G && G['random control'] && G['random control'].combos['listing / claude'];
  const beats = P && P.n >= 15 && R && P.avgR > R.avgR, record = P ? `Paper: ${fR(P.avgR)} a trade over ${P.n} (range ${fR(P.lo)} to ${fR(P.hi)}), random coins ${fR(R && R.avgR)}.${bt && bt.n ? ` Backtest on every 3-check coin so far: ${fP(bt.avg)} a trade over ${bt.n} (${fP(bt.exBest)} without its best), random coins with the same plan ${fP(btR && btR.avg)}.` : ''}` : 'No record yet.';
  const items = ((runners && runners.items) || []).filter((r) => r && (r.passed ?? 0) >= 3 && !(r.vetoed || []).length && r.tier !== 'Dropped' && +r.price > 0).map((r) => ({ coin: r.coin, chain: r.chain, pool: r.pool, net: r.net, price: +r.price, passed: r.passed, flags: redFlags(r), plan: planFor(+r.price) }));
  return { title: 'Runner list, 3+ checks, sold the Risky · Claude way', beats: !!beats, record, why: beats ? 'Beating random entries on paper, so it is shown.' : 'Not beating random entries on paper right now, so its coins are not shown here.', go: beats ? items.filter((x) => !x.flags.length) : [], held: beats ? items.filter((x) => x.flags.length) : [] }; }
// Chill's DCA: today's coins newly 70/80/90% under their year's high, shown while its backtest beats random days without its best trade
export function chillBets({ bottoms, bottomBt }) { const c = bottomBt && bottomBt.combos && bottomBt.combos['dca / riskoff'], rnd = bottomBt && bottomBt.combos && bottomBt.combos['random / riskoff'], beats = !!(c && c.n >= 20 && rnd && c.exBest != null && c.exBest > rnd.avg);
  const record = c ? `Backtest: ${fP(c.avg)} a clip over ${c.n} (${fP(c.exBest)} without its best; older half ${fP(c.olderExBest)}, newer ${fP(c.newerExBest)}), random days ${fP(rnd && rnd.avg)}.${c.holdsTrim ? '' : ' Not proven on both halves yet.'}` : 'No backtest yet.';
  return { title: 'Chill: quality coins newly 70/80/90% under their high', beats, record, why: beats ? 'Beating random days in the backtest, so it is shown. Bought a clip at each level, sold when the market flips from risk-on back to risk-off (stop 40%).' : 'Not beating random days right now, so it is not shown.', go: beats ? ((bottoms && bottoms.coins) || []).map((x) => ({ coin: x.symbol, dd: x.dd, fresh: x.fresh, mcap: x.mcap })) : [], regime: bottoms && bottoms.regimeWhy || null }; }
