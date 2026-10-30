// THE VOLUME RIDER (30 Oct, Ryan's playbook, from his HI/HYPE chart: "follow the money"). The coins with the day's biggest volume, traded
// the way he trades them by hand:
//   1. big volume: the coin is on the 6-hour volume list (or its hour just spiked). Do nothing on the launch pump.
//   2. decline: wait for the first dip, back into the 0.5 to 0.786 retracement of the move (HI pulled back to about 0.68).
//   3. bid here: wait for it to go sideways (a tight base over a few hours, volume cooled but alive), then buy the base.
//   4. stop: a little under the base's low, never more than 20% away ("sell if it declines from the bid by a certain percentage").
//   5. sell in batches on the way back up to the previous high, and leave a moonbag on a trail.
//   6. go again: another base on the same coin (a cup and handle, a retest) is bid again while the volume is still there, up to 3 times.
//   7. the volume dies, we leave: an hour of trading far below the base's own pace and the whole position is sold, whatever the chart says.
// Pure functions: the bot (bot/run.mjs, source 'volume') passes in GeckoTerminal's pools and 15-minute candles and gets candidates and setups.
export const VOLR = {
  minH6Usd: 250000, minLiqUsd: 30000, listMax: 30, spikeX: 3, // the list: $250k+ traded in 6 hours (or the hour 3x the day's pace), $30k+ pools, the top 30
  minPumpX: 1.8, zoneLo: 0.5, zoneHi: 0.85, againZoneLo: 0.3, // the move must be 1.8x+; the first dip into 0.5-0.786 (0.85 with a little slack); later entries also take shallower handles (0.3+)
  minSinceHighH: 1, baseBars: 12, baseRangePct: 22, // the high at least an hour old; the base: the last 3 hours (12 x 15 minutes) inside a 22% range
  baseVolMax: 0.6, baseVolMinUsdH: 5000, // the base's volume cooled to under 60% of the run's pace, but still $5k+ an hour
  stopUnderPct: 3, minStopPct: 6, maxStopPct: 20, minRoomX: 1.3, // stop 3% under the base's low, 6-20% away; the old high at least 1.3x above
  shares: [0.3, 0.4], moonTrail: 0.35, // 30% half-way back to the high, 40% at the high, the last 30% a moonbag trailing 35% off its peak
  volDeadFrac: 0.25, volDeadMin: 60, // out when an hour's trading is under 25% of the base's own hourly pace for 60 minutes running
};
const EXCLUDE = /^(SOL|WSOL|USDC|USDT|USD1|PYUSD|USDS|ETH|WETH|HYPE|WBTC|CBBTC|JUP|RAY)$/;
const sum = (a) => a.reduce((x, y) => x + y, 0);
// the day's money: GeckoTerminal pools (trending 1h/6h and top volume, any chain we trade) ranked by 6-hour volume, the hour's spikes kept too
export function volCandidates(pages, cfg = VOLR) { const by = new Map();
  for (const { net, data, included } of pages) { const toks = {}; for (const t of included || []) toks[t.id] = t.attributes || {};
    for (const d of data || []) { const a = d.attributes || {}, pool = (d.id || '').split('_').slice(1).join('_') || a.address; if (!pool) continue;
      const bt = toks[d.relationships && d.relationships.base_token && d.relationships.base_token.data && d.relationships.base_token.data.id] || {}, sym = String(bt.symbol || String(a.name || '').split(' / ')[0] || '').toUpperCase().trim();
      if (!sym || EXCLUDE.test(sym) || /Robinhood Token/i.test(bt.name || '')) continue; // the pairing token itself (SOL, HYPE, a stock token) is not the coin
      const v = a.volume_usd || {}, h1 = +v.h1 || 0, h6 = +v.h6 || 0, h24 = +v.h24 || 0, liq = +a.reserve_in_usd || 0; if (liq < cfg.minLiqUsd) continue;
      const spike = h24 > 0 && h1 >= cfg.spikeX * (h24 / 24) && h1 >= cfg.minH6Usd / 6; if (h6 < cfg.minH6Usd && !spike) continue;
      const key = net + '|' + (bt.address || pool), had = by.get(key); if (had && had.liq >= liq) continue;
      by.set(key, { pool, chain: net, coin: sym, token: bt.address || null, h1, h6, h24, liq, spike, pair: a.name || null, created: a.pool_created_at || null }); } }
  return [...by.values()].sort((x, y) => y.h6 - x.h6).slice(0, cfg.listMax); }
// 15-minute candles [[t, o, h, l, c, v]] oldest first -> a setup to bid now, or null (with .why when it was close: for the journal)
export function volSetup(bars, price, nowSec, cfg = VOLR, { entryN = 1 } = {}) {
  const B = (bars || []).filter((b) => b[0] + 900 <= nowSec + 1); if (B.length < cfg.baseBars + 8 || !(price > 0)) return null;
  // the run: its high, and the low it started from (the lowest low before the high)
  let hi = 0, hiI = -1; B.forEach((b, i) => { if (b[2] > hi) { hi = b[2]; hiI = i; } });
  if (hiI < 1) return null; let lo = Infinity, loI = 0; for (let i = 0; i < hiI; i++) if (B[i][3] < lo) { lo = B[i][3]; loI = i; }
  if (!(lo > 0) || hi / lo < cfg.minPumpX) return { none: `no real run yet (${(hi / lo).toFixed(1)}x)` };
  if (nowSec - B[hiI][0] < cfg.minSinceHighH * 3600) return { none: 'still running: no first dip yet' };
  // the dip: how deep it came back into the run
  const after = B.slice(hiI + 1); if (after.length < cfg.baseBars) return { none: 'the dip is too fresh to have a base' };
  const dip = Math.min(...after.map((b) => b[3])), retr = (hi - dip) / (hi - lo), zLo = entryN > 1 ? cfg.againZoneLo : cfg.zoneLo;
  if (retr < zLo) return { none: `only ${(retr * 100).toFixed(0)}% back into the run (waits for ${Math.round(zLo * 100)}%+)` };
  if (retr > cfg.zoneHi) return { none: `gave back ${(retr * 100).toFixed(0)}% of the run: broken, not a dip` };
  // the base: the last 3 hours inside a tight range, price still in it, volume cooled but alive
  const base = B.slice(-cfg.baseBars), bHi = Math.max(...base.map((b) => b[2])), bLo = Math.min(...base.map((b) => b[3])), rangePct = (bHi / bLo - 1) * 100;
  if (rangePct > cfg.baseRangePct) return { none: `not a base yet (${rangePct.toFixed(0)}% range over 3 hours)` };
  if (price < bLo) return { none: 'broke down out of the base' }; if (price > bHi * 1.05) return { none: 'already left the base' };
  const run = B.slice(loI, hiI + 1), runPaceH = (sum(run.map((b) => b[5])) / run.length) * 4, basePaceH = (sum(base.map((b) => b[5])) / base.length) * 4;
  if (!(runPaceH > 0) || basePaceH > cfg.baseVolMax * runPaceH) return { none: `volume has not cooled (${Math.round((basePaceH / runPaceH) * 100)}% of the run's pace)` };
  if (basePaceH < cfg.baseVolMinUsdH) return { none: `volume dead in the base ($${Math.round(basePaceH)} an hour)` };
  const stop = bLo * (1 - cfg.stopUnderPct / 100), stopPct = (1 - stop / price) * 100;
  if (stopPct > cfg.maxStopPct) return { none: `the base is too wide for the stop (${stopPct.toFixed(0)}%)` };
  // targets: the first time, half-way back and the old high; on a go-again (a handle under the high), the old high and the measured move above
  // it (the cup's depth added on top: "ride the volume and momentum and sell portions on the way up")
  const stopF = stopPct < cfg.minStopPct ? price * (1 - cfg.minStopPct / 100) : stop, again = entryN > 1, room = again ? (hi + (hi - dip)) / price : hi / price;
  if (room < cfg.minRoomX) return { none: `too close to the old high (${room.toFixed(2)}x)` };
  const half = again ? Math.max(1.05, hi / price) : 1 + (room - 1) / 2;
  return { price, stop: +stopF.toPrecision(6), stopPct: +((1 - stopF / price) * 100).toFixed(1), hi, lo, dip, retr: +retr.toFixed(3), baseLo: bLo, baseHi: bHi, rangePct: +rangePct.toFixed(1), basePaceH: Math.round(basePaceH), runPaceH: Math.round(runPaceH),
    mults: [+half.toFixed(3), +room.toFixed(3)], shares: cfg.shares, why: [`ran ${(hi / lo).toFixed(1)}x, came back ${(retr * 100).toFixed(0)}% (the ${retr < 0.618 ? '0.5' : retr < 0.786 ? '0.618-0.786' : '0.786'} zone)`, `based for 3 hours in a ${rangePct.toFixed(0)}% range, volume at ${Math.round((basePaceH / runPaceH) * 100)}% of the run's pace ($${Math.round(basePaceH / 1000)}k an hour)`, again ? `go again: 30% at ${half.toFixed(2)}x (the old high), 40% at ${room.toFixed(2)}x (the measured move above it), 30% moonbag` : `sells: 30% at ${half.toFixed(2)}x (half-way back), 40% at ${room.toFixed(2)}x (the old high), 30% moonbag`] }; }
// the volume-death exit: true once the hour's trading has stayed under volDeadFrac of the base's hourly pace for volDeadMin minutes
export function volDead(pos, h1Usd, now, cfg = VOLR) { const ref = pos.meta && pos.meta.basePaceH; if (!(ref > 0) || h1Usd == null) return null;
  if (h1Usd < cfg.volDeadFrac * ref) { pos.volLowSince ||= now; if (now - pos.volLowSince >= cfg.volDeadMin * 60e3) return `the volume died: $${Math.round(h1Usd / 1000)}k in the last hour against $${Math.round(ref / 1000)}k an hour in the base, for ${cfg.volDeadMin}+ minutes`; }
  else pos.volLowSince = null; return null; }
