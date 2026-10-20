// The bot desk: turns a bot's state file and journal into what the desk dashboard shows (account, equity curve, positions with live
// P&L, closed trades, risk, health, filters, what it is watching, recent activity). Pure: no network, no clock, no file access.
import { pnlOf } from './manage.mjs';
import { labelOf } from '../docs/tuner.mjs';
const r2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(2)), mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const T = (x) => { const t = Date.parse(x || ''); return isFinite(t) ? t : null; };

export function deskSummary(name, { st, cfg, journal = [], reality = null, stopFile = false, now = Date.now() }) {
  const out = { name, label: cfg.label, installed: !!st, strategy: describe(cfg) };
  if (!st) return out;
  const px = (p) => (p.lastPx > 0 ? p.lastPx : p.entry), open = (st.positions || []).map((p) => {
    const price = px(p), upnl = pnlOf(p, price), risk = p.riskUsd > 0 ? p.riskUsd : null, next = p.mode === 'ladder' ? (p.targets || [])[p.hits || 0] ?? null : !p.tp1Done ? p.tp1 : !p.free ? p.freeAt : null;
    return { coin: p.coin, chain: p.chain, pool: p.pool, url: p.url, setup: p.setup, kind: p.kind, mode: p.mode || 'stack', openedAt: p.openedAt, entry: p.entry, stop: p.stop, stop0: p.stop0, targets: p.mode === 'ladder' ? p.targets : [p.tp1, p.freeAt].filter(Boolean),
      next, price, priceAt: p.lastAt || null, costUsd: r2(p.costUsd), valueUsd: r2(p.remUnits * price), bankedUsd: r2(p.bankedUsd), upnl: r2(upnl), upnlPct: r2((upnl / p.costUsd) * 100), R: risk ? r2(upnl / risk) : null, riskUsd: r2(risk),
      leftPct: r2((p.remUnits / p.units) * 100), heldH: r2((now - T(p.openedAt)) / 3600e3), status: p.free ? 'riding free' : p.mode === 'ladder' ? (p.hits ? `TP${p.hits} hit` : 'waiting for TP1') : p.tp1Done ? 'TP1 hit, trailing' : 'waiting for TP1',
      sells: p.sells || [], meta: p.meta || null };
  });
  const closed = (st.closed || []).slice().reverse().map((p) => ({ coin: p.coin, chain: p.chain, pool: p.pool, url: p.url, setup: p.setup, kind: p.kind, mode: p.mode || 'stack', openedAt: p.openedAt, closedAt: p.closedAt, entry: p.entry, stop0: p.stop0,
    targets: p.mode === 'ladder' ? p.targets : [p.tp1, p.freeAt].filter(Boolean), exitAvg: p.exitAvg ?? (p.units > 0 ? r2(p.bankedUsd / p.units) : null), costUsd: r2(p.costUsd), pnl: r2(p.pnl), pnlPct: r2((p.pnl / p.costUsd) * 100), R: p.R ?? null,
    why: ((p.sells || [])[(p.sells || []).length - 1] || {}).why || '', heldH: r2((T(p.closedAt) - T(p.openedAt)) / 3600e3), sells: p.sells || [], meta: p.meta || null }));
  const equity = (st.cash || 0) + (st.positions || []).reduce((a, p) => a + p.remUnits * px(p), 0), start = st.start || cfg.accountUsd;
  const C = closed, wins = C.filter((x) => x.pnl > 0), losses = C.filter((x) => x.pnl <= 0), Rs = C.map((x) => x.R).filter((x) => x != null), gain = wins.reduce((a, x) => a + x.pnl, 0), loss = -losses.reduce((a, x) => a + x.pnl, 0);
  const eq = [...(st.eq || []), [now, r2(equity)]]; let peak = -Infinity, dd = 0; for (const [, v] of eq) { peak = Math.max(peak, v); dd = Math.max(dd, peak > 0 ? (peak - v) / peak : 0); }
  const openRisk = (st.positions || []).reduce((a, p) => a + (p.free ? 0 : Math.max(0, p.remUnits * (p.entry - p.stop * (1 - (cfg.slipPct || 0) / 100)))), 0);
  const dayKey = new Date(now + 10 * 3600e3).toISOString().slice(0, 10), today = (st.days || {})[dayKey] || 0, lastBlock = (st.blocks || [])[(st.blocks || []).length - 1];
  const watch = Object.values(st.setups || {}).filter((s) => !s.dropped).map((s) => ({ coin: s.coin, chain: s.chain, pool: s.pool, setup: s.setup, kind: s.kind, opp: s.opp ?? null, zoneLow: s.zoneLow, zoneHigh: s.zoneHigh, stop: s.stop, price: s.lastPx ?? null,
    distPct: s.lastPx > 0 && s.zoneHigh > 0 ? r2((s.lastPx / s.zoneHigh - 1) * 100) : null, rr2: s.rr2 ?? null, riskPct: s.riskPct ?? null, at: s.at, expiresAt: new Date(T(s.at) + (s.expireH || 24) * 3600e3).toISOString().slice(0, 19) + 'Z' }))
    .sort((a, b) => (a.distPct ?? 999) - (b.distPct ?? 999));
  const ageS = st.lastCycleAt ? Math.round((now - st.lastCycleAt) / 1000) : null;
  // streak, expectancy, and what saying no would have cost or saved
  let streak = 0; for (const c of C) { if (!streak) streak = c.pnl > 0 ? 1 : -1; else if ((c.pnl > 0) === (streak > 0)) streak += Math.sign(streak); else break; }
  const passed = (st.passed || []).slice().reverse().map((x) => ({ coin: x.coin, chain: x.chain, pool: x.pool, at: x.at, why: x.why, px0: x.px0, last: x.last, hi: x.hi, lo: x.lo ?? null, sincePct: x.px0 > 0 ? r2((x.last / x.px0 - 1) * 100) : null, bestPct: x.px0 > 0 ? r2((x.hi / x.px0 - 1) * 100) : null, wouldStop: x.stop > 0 && x.lo != null ? x.lo <= x.stop : null, done: !!x.done, hoursIn: r2((now - T(x.at)) / 3600e3) }));
  const pd = passed.filter((x) => x.done), avoided = pd.filter((x) => x.wouldStop || (x.sincePct != null && x.sincePct < 0)).length;
  const lat = C.concat(open).map((p) => p.meta).filter((m) => m && m.trigPx > 0 && m.quotePx > 0).map((m) => (m.quotePx / m.trigPx - 1) * 100);
  Object.assign(out, {
    account: { start, equity: r2(equity), cash: r2(st.cash), pnl: r2(equity - start), pnlPct: r2((equity / start - 1) * 100), peak: r2(Math.max(start, ...eq.map((x) => x[1]))), maxDDPct: r2(dd * 100), startedAt: st.startedAt || null },
    stats: { closed: C.length, wins: wins.length, streak, expectancyUsd: C.length ? r2(C.reduce((a, x) => a + x.pnl, 0) / C.length) : null, avgWin: r2(mean(wins.map((x) => x.pnl))), avgLoss: r2(mean(losses.map((x) => x.pnl))), latencyPct: r2(mean(lat)), latencyN: lat.length, winRate: C.length ? r2(wins.length / C.length) : null, avgR: r2(mean(Rs)), totalR: r2(Rs.reduce((a, x) => a + x, 0)), pf: loss > 0 ? r2(gain / loss) : gain > 0 ? 99 : null,
      realised: r2(C.reduce((a, x) => a + x.pnl, 0)), best: C.length ? C.reduce((a, x) => (x.pnl > a.pnl ? x : a)) : null, worst: C.length ? C.reduce((a, x) => (x.pnl < a.pnl ? x : a)) : null, avgHoldH: r2(mean(C.map((x) => x.heldH).filter((x) => x != null))) },
    risk: { openRisk: r2(openRisk), openRiskPct: r2((openRisk / start) * 100), maxOpenRiskPct: cfg.maxOpenRiskPct, slots: (st.positions || []).length, maxOpen: cfg.maxOpen, todayPnl: r2(today), dailyLimit: r2(-(cfg.dailyLossPct / 100) * start), riskPerTrade: r2((cfg.riskPct / 100) * equity),
      blocked: lastBlock && lastBlock[1] == null ? lastBlock[2] : stopFile ? 'new buys are paused (STOP file)' : null },
    health: { lastCycleAt: st.lastCycleAt ? new Date(st.lastCycleAt).toISOString().slice(0, 19) + 'Z' : null, ageS, live: ageS != null && ageS < Math.max(180, (cfg.pollSec || 60) * 3), problems: Object.entries(st.health || {}).map(([k, v]) => ({ key: k, since: new Date(v.since).toISOString().slice(0, 19) + 'Z', why: v.why, alerted: !!v.alerted })),
      offlineH: r2((st.gaps || []).reduce((a, [x, y]) => a + ((T(y) ?? now) - T(x)) / 3600e3, 0)) },
    filters: st.filters ? st.filters.map(labelOf) : null, passed: passed.slice(0, 30), passedSummary: pd.length ? { n: pd.length, avoided, avgSince: r2(mean(pd.map((x) => x.sincePct).filter((x) => x != null))) } : null,
    open, closed: closed.slice(0, 200), watch: watch.slice(0, 40), equityCurve: eq.slice(-2000),
    days: Object.entries(st.days || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-60).map(([d, v]) => [d, r2(v)]),
    events: journal.slice(-60).reverse().map((j) => ({ at: j.at, type: j.type, coin: j.coin || null, why: Array.isArray(j.why) ? j.why.join(', ') : j.why || null, usd: j.usd ?? null, pnl: j.pnl ?? null, active: j.active ? j.active.map(labelOf) : null })),
    reality: reality && reality.latest ? { at: reality.latest.at, n: reality.latest.n, gapPct: reality.latest.gapPct, gapR: reality.latest.gapR, call: reality.latest.call } : null,
  });
  return out;
}

function describe(cfg) {
  return cfg.entry === 'limit'
    ? { entry: 'Limit order at the top of the retest zone, 48 hours to fill; cancelled if the price falls through the stop first.', exits: `Pattern stop; a third at TP1 (stop to break-even), a third at TP2, the rest at TP3; out after ${Math.round((cfg.maxHoldH || 168) / 24)} days.`,
      rules: [['Pattern', 'Breakout retest'], ['Score', `${cfg.minOpp}+`], ['Liquidity', `$${Math.round(cfg.minLiqUsd / 1000)}k+`], ['Stop distance', `up to ${cfg.maxStopPct}%`], ['One per coin', `${cfg.coolH} hours`], ['Filters', 'bot tuner (only after they hold on new trades)']] }
    : { entry: 'The scanner\'s bid-ready and worth-watching setups, bought only when a 5-minute candle confirms in the zone (flush and reclaim, or a bounce) on 1.5-2x volume, no chasing.', exits: 'A third at +1R and stop to break-even, 25% trail, ride free at 2x, then out on a 5-minute close 50% under the best close; early exits on sellers, volume dying or no follow-through; 72 hours.',
      rules: [['Signals', 'bid-ready and worth watching'], ['Score', `over ${cfg.minOpp}`], ['Liquidity', `$${Math.round(cfg.minLiqUsd / 1000)}k+`], ['Stop distance', `${cfg.minStopPct}-${cfg.maxStopPct}%`], ['No chasing', `${cfg.chasePct}% over the zone at most`], ['One per coin', `${cfg.coolH} hours`]] };
}
