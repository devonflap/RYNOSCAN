// Bot simulator: what one account would have made trading the signals of EVERY paper book the way a real bot should.
// Sizing by risk, not by account share: each trade risks riskPct of the account at its first stop (a 20% stop buys a smaller position than a 4% stop).
// Limits a real meme bot needs, because stops can gap and rugs take the whole position:
//   per coin: total risk and total position value across all books in the same coin are capped (two setups in one coin dump together);
//   liquidity: no position bigger than liqPct of the pool, so it can get out;
//   total: open risk across everything is capped; and no new trades after the day's closed losses pass dayLossPct.
// The adaptive version only takes a book's signals while that book is working, judged ONLY on its trades that had closed before
// the new signal (walk-forward), so it never peeks at the future.
import { book } from './exits.mjs';

export const BOT_RULES = { start: 10000, riskPct: 1, coinRiskPct: 2, coinValuePct: 10, liqPct: 2, maxOpenRiskPct: 8, dayLossPct: 3, adaptMin: 8, adaptWindow: 20 };
export const BOT = {
  botAll: { label: 'Bot simulator · every book', short: 'Bot · all books', adaptive: false },
  botAdapt: { label: 'Bot simulator · only books that are working', short: 'Bot · adaptive', adaptive: true },
};
const ts = (x) => { const t = Date.parse(x || ''); return isFinite(t) ? t : null; };

// result of one closed position in R, independent of how big it was: (proceeds / entry - 1 - costs) / stop distance
export function unitR(p) {
  if (!p || p.open || p.waiting || !(p.entryPx > 0) || !(p.stop0 < p.entryPx)) return null;
  const sold = (p.fills || []).reduce((a, f) => a + f.frac * f.px, 0); if (!(sold > 0)) return null;
  return (sold / p.entryPx - 1 - (p.costPct || 0) / 100) / ((p.entryPx - p.stop0) / p.entryPx);
}
const riskOf = (h) => h.qty * h.remNow * Math.max(0, h.entryPx - (h.stop0 ?? h.entryPx));

export function botBook(positions, { cfg = BOT_RULES, adaptive = false, since = null, now = Date.now() } = {}) {
  const hist = (positions || []).filter((p) => p && !p.open && p.closedAt).map((p) => ({ src: p.src, t: ts(p.closedAt), R: unitR(p) })).filter((x) => x.R != null && x.t != null).sort((a, b) => a.t - b.t);
  const form = (src, t) => { const h = hist.filter((x) => x.src === src && x.t < t).slice(-cfg.adaptWindow); return h.length < cfg.adaptMin ? null : h.reduce((a, x) => a + x.R, 0) / h.length; };
  const sizeFn = (p, ctx) => {
    if (adaptive) { const f = form(p.src, ctx.t); if (f == null) return { size: 0, why: 'book not proven yet' }; if (f <= 0) return { size: 0, why: 'book not working lately' }; }
    if (ctx.dayPnl <= -cfg.dayLossPct / 100 * ctx.equity) return { size: 0, why: 'daily loss limit hit' };
    const unit = (p.entryPx - p.stop0) / p.entryPx; if (!(unit > 0 && unit < 1)) return { size: 0, why: 'no usable stop' };
    const want = ctx.equity * cfg.riskPct / 100 / unit; let size = want, cut = null;
    const same = ctx.held.filter((h) => p.pool && h.pool === p.pool), coinVal = same.reduce((a, h) => a + h.qty * h.remNow * h.entryPx, 0), coinRisk = same.reduce((a, h) => a + riskOf(h), 0), openRisk = ctx.held.reduce((a, h) => a + riskOf(h), 0);
    for (const [lim, why] of [[ctx.equity * cfg.coinValuePct / 100 - coinVal, 'coin value cap'], [(ctx.equity * cfg.coinRiskPct / 100 - coinRisk) / unit, 'coin risk cap'], [(ctx.equity * cfg.maxOpenRiskPct / 100 - openRisk) / unit, 'total risk cap'], [p.liq > 0 ? p.liq * cfg.liqPct / 100 : Infinity, 'liquidity cap']])
      if (size > lim) { size = Math.max(0, lim); cut = why; }
    if (size < 0.2 * want || size < 20) return { size: 0, why: cut || 'too small' };
    return { size, cut: size < want * 0.999 ? cut : null };
  };
  const b = book(positions, { start: cfg.start, pct: 0, slots: 999, since, now, sizeFn });
  // where the money came from
  const by = new Map(); for (const t of b.trades) { const k = t.src || '?'; if (!by.has(k)) by.set(k, { src: k, n: 0, closed: 0, pnl: 0, risk: 0 }); const g = by.get(k); g.n++; g.pnl += t.pnl; if (!t.open) g.closed++; g.risk += t.risk0 || 0; }
  b.bySource = [...by.values()].sort((a, c) => c.pnl - a.pnl); b.rules = cfg; b.adaptive = adaptive;
  // same coin held by more than one book right now
  const openBy = new Map(); for (const t of b.trades.filter((x) => x.open)) { const k = t.pool || t.coin; if (!openBy.has(k)) openBy.set(k, []); openBy.get(k).push(t); }
  b.stacked = [...openBy.values()].filter((a) => a.length > 1).map((a) => ({ coin: a[0].coin, chain: a[0].chain, books: a.map((t) => t.src), value: a.reduce((s, t) => s + t.value, 0), risk: a.reduce((s, t) => s + t.riskNow, 0) }));
  return b;
}
