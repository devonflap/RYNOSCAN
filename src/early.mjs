// Early-1h experiment. The live rules judge 4h candles only after they close, so a reversal that confirms an hour into a candle is
// not called until up to 3 hours later. Here each coin is re-scored once with the still-forming 4h candle included (built from closed
// 1h bars only). If that version is fully bid-ready and the normal one is not, it is logged in the forward test as "<pattern> [early 1h]"
// and followed with the same fill and exit rules. The weekly gate report then compares early against confirmed trades, so the data
// says whether waiting for the 4h close costs good entries or saves you from fakeouts. It changes no live rule, score or call.
import { analyse, plan } from '../docs/core.mjs';
export const MIN_OPP = 50, MAX_NEW = 10, SUFFIX = ' [early 1h]';
const isOpen = (s) => s && (s.status === 'open' || s.status === 'waiting for entry');
export function candidates(rows, C, now = Date.now()) {
  const out = [];
  if (!C.RULES.v2) return out;
  for (const p of rows) {
    if (!p || !Array.isArray(p.h4f) || !p.tf || p.ready || p.lead === 'pattern') continue;
    const q = { ...p, tf: { ...p.tf } };
    try { q.h4 = p.h4f; q.tf['4h'] = analyse(p.h4f, 18); q.plan = plan(p.h4f); q.pats = C.detectPatterns(p.h4f).filter((x) => x.quality >= 50 && !(x.status === 'forming' && x.dist > 12)); C.scoreList([q], now); } catch { continue; }
    if (q.lead !== 'pattern' && q.ready && q.sp && q.opp != null && q.opp >= MIN_OPP) out.push(q);
  }
  return out;
}
// Returns new signals (not yet evaluated), tagged early1h:true, setup = "<pattern> [early 1h]".
export function pick(cands, existing, at, newSignal) {
  const have = new Set(existing.map((s) => s.signalId)), open = new Set(existing.filter(isOpen).map((s) => s.id + '|' + s.setup)), out = [];
  cands.sort((a, b) => b.opp - a.opp);
  for (const p of cands) {
    if (out.length >= MAX_NEW) break; const pl = p.sp;
    if (![pl.entryLow, pl.entryHigh, pl.stop, pl.tp1, pl.tp2, pl.tp3].every((v) => v != null && isFinite(+v))) continue;
    let sig; try { sig = newSignal(p, at); } catch { continue; }
    sig.setup = sig.setup + SUFFIX; sig.signalId = sig.signalId + '|' + sig.setup;
    if (have.has(sig.signalId) || open.has(sig.id + '|' + sig.setup)) continue;
    sig.forward = true; sig.early1h = true; out.push(sig); have.add(sig.signalId); open.add(sig.id + '|' + sig.setup);
  }
  return out;
}
export const baseOf = (setup) => String(setup || '').replace(SUFFIX, '');
