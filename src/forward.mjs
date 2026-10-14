// Forward test of near-miss candidates. Every full scan, coins that have a valid plan and opportunity 50-65 (below the
// dashboard cut-off) are logged with their entry/stop/targets and followed with the same fill and exit rules as real signals.
// Because they are logged when they appear, coins that later die or rug stay in the sample, which the backtest cannot do (survivorship).
export const MIN_OPP = 50, MAX_NEW = 25, MAX_EVAL = 40, KEEP_CLOSED = 600;
const isOpen = (s) => s && (s.status === 'open' || s.status === 'waiting for entry');

// rows: scored pools (p.sp = plan, p.opp, p.setupType); returns new candidate signals (not yet evaluated)
export function pickCandidates(rows, existing, at, newSignal, cutoff) {
  const have = new Set(existing.map((s) => s.signalId)), openIds = new Set(existing.filter(isOpen).map((s) => s.id)), out = [];
  const pool = rows.filter((p) => p && p.sp && p.opp != null && p.opp >= MIN_OPP && p.opp <= cutoff && p.signal !== 'Entry signal');
  pool.sort((a, b) => b.opp - a.opp);
  for (const p of pool) {
    if (out.length >= MAX_NEW) break;
    const pl = p.sp; if (![pl.entryLow, pl.entryHigh, pl.stop, pl.tp1, pl.tp2, pl.tp3].every((v) => v != null && isFinite(+v))) continue;
    let sig; try { sig = newSignal(p, at); } catch { continue; }
    if (have.has(sig.signalId) || openIds.has(sig.id)) continue;
    sig.forward = true; out.push(sig); have.add(sig.signalId); openIds.add(sig.id);
  }
  return out;
}
// keep every open candidate, the newest KEEP_CLOSED finished ones
export function trim(list) {
  const open = list.filter(isOpen), done = list.filter((s) => !isOpen(s)).sort((a, b) => String(b.signalAt || '').localeCompare(String(a.signalAt || ''))).slice(0, KEEP_CLOSED);
  return [...open, ...done].sort((a, b) => String(b.signalAt || '').localeCompare(String(a.signalAt || '')));
}
