// Paper trading: replay the signal log as if $10,000 had been traded, 5% of the account on every bid-ready setup.
// Position size = pct of the account (cash plus realised results) when the signal fired. Profit on a trade = size x R x stop distance,
// where R is the result already shown in the log (slippage included). Signals that never filled use no money. Open trades are marked at their open R.
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
const ts = (s) => { const t = Date.parse(s || ''); return isFinite(t) ? t : null; };

export function simulate(signals, { start = 10000, pct = 5 } = {}) {
  const rows = (Array.isArray(signals) ? signals : []).filter((s) => s && typeof s === 'object');
  const filled = [], waiting = [];
  for (const s of rows) {
    const mid = num(s.entryMid) ?? (num(s.entryLow) != null && num(s.entryHigh) != null ? (+s.entryLow + +s.entryHigh) / 2 : null), stop = num(s.stop), at = ts(s.signalAt);
    if (mid == null || stop == null || at == null || mid <= stop) continue;
    const closed = num(s.resultR) != null && s.status !== 'expired (no fill)', open = s.status === 'open' && num(s.openR) != null;
    if (s.status === 'waiting for entry') { waiting.push(s); continue; }
    if (!closed && !open) continue;
    filled.push({ s, at, end: closed ? (ts(s.closedAt) ?? at) : null, R: closed ? +s.resultR : +s.openR, risk: (mid - stop) / mid, open: !closed });
  }
  // events in time order: a trade is sized when it enters, and its result is banked when it closes
  const ev = []; filled.forEach((f) => { ev.push({ t: f.at, k: 0, f }); if (!f.open) ev.push({ t: Math.max(f.end, f.at), k: 1, f }); });
  ev.sort((a, b) => a.t - b.t || a.k - b.k);
  let cash = start; const curve = [{ t: ev.length ? ev[0].t : Date.now(), eq: start }], trades = [];
  for (const e of ev) {
    const f = e.f;
    if (e.k === 0) { f.size = cash * pct / 100; continue; }
    f.pnl = f.size * f.R * f.risk; cash += f.pnl; curve.push({ t: e.t, eq: cash });
  }
  let openPnl = 0; for (const f of filled) { if (f.open) { f.size = f.size ?? cash * pct / 100; f.pnl = f.size * f.R * f.risk; openPnl += f.pnl; } }
  const equity = cash + openPnl; if (filled.some((f) => f.open)) curve.push({ t: Date.now(), eq: equity });
  let peak = start, maxDD = 0; for (const c of curve) { peak = Math.max(peak, c.eq); maxDD = Math.max(maxDD, (peak - c.eq) / peak * 100); }
  const done = filled.filter((f) => !f.open), wins = done.filter((f) => f.pnl > 0).length;
  filled.sort((a, b) => b.at - a.at).forEach((f) => trades.push({ coin: f.s.coin, chain: f.s.chain, setup: f.s.setup, at: f.s.signalAt, status: f.s.status + (f.s.tpHit ? ` · TP${f.s.tpHit}` : ''), size: f.size, R: f.R, pnl: f.pnl, open: f.open, pool: f.s.pool }));
  return { start, pct, equity, realized: cash - start, openPnl, retPct: (equity / start - 1) * 100, closedN: done.length, openN: filled.length - done.length, waitingN: waiting.length, wins, winRate: done.length ? wins / done.length : null, maxDD, curve, trades,
    avgR: done.length ? done.reduce((a, f) => a + f.R, 0) / done.length : null };
}

// near-miss forward log: how candidates below the 65 cut-off are doing against the same rules
export function fwdSummary(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((s) => s && typeof s === 'object'), by = new Map();
  for (const s of list) { const k = s.setup || 'Unknown'; if (!by.has(k)) by.set(k, { setup: k, n: 0, closed: 0, wins: 0, sum: 0 }); const g = by.get(k); g.n++; if (num(s.resultR) != null && s.status !== 'expired (no fill)') { g.closed++; g.sum += +s.resultR; if (+s.resultR > 0) g.wins++; } }
  const t = [...by.values()].map((g) => ({ ...g, win: g.closed ? g.wins / g.closed : null, avgR: g.closed ? g.sum / g.closed : null })).sort((a, b) => b.closed - a.closed);
  const all = t.reduce((a, g) => ({ n: a.n + g.n, closed: a.closed + g.closed, wins: a.wins + g.wins, sum: a.sum + g.sum }), { n: 0, closed: 0, wins: 0, sum: 0 });
  return { total: list.length, closed: all.closed, avgR: all.closed ? all.sum / all.closed : null, win: all.closed ? all.wins / all.closed : null, bySetup: t };
}
