// Background tracking of patterns that are NOT live (shadow or switched off). Every full scan, each scanned coin is re-scored with those
// patterns allowed; if one of them is the lead setup with a valid plan, it is logged in the forward test under its own name and followed
// with the same fill and exit rules as a real signal. The weekly learning loop then counts that evidence, so a pattern can earn its way
// live (or a live one can be switched off) from trades that were only watched in the background. Nothing here sends an alert or shows
// on the bid-ready list.
export const MIN_OPP = 50, MAX_NEW = 20;
const isOpen = (s) => s && (s.status === 'open' || s.status === 'waiting for entry');
// C: the core module (RULES, detectPatterns, scoreList). Returns scored clones whose lead setup is a not-live pattern.
export function candidates(rows, C, now = Date.now()) {
  const names = new Set([...(C.RULES.shadow || []), ...(C.RULES.off || [])]); names.delete('Bottom reversal'); const out = [];
  if (!names.size || !C.RULES.v2) return out;
  const was = C.RULES.allowShadow;
  try {
    C.RULES.allowShadow = true;
    for (const p of rows) {
      if (!p || !Array.isArray(p.h4) || p.h4.length < 45 || !p.tf) continue;
      const q = { ...p }; let pats; try { pats = C.detectPatterns(q.h4).filter((x) => x.quality >= 50 && !(x.status === 'forming' && x.dist > 12)); } catch { continue; }
      if (!pats.some((x) => names.has(x.name))) continue;
      q.pats = pats; try { C.scoreList([q], now); } catch { continue; }
      if (q.lead === 'pattern' && names.has(q.setupType) && q.sp && q.opp != null && q.opp >= MIN_OPP) out.push(q);
    }
  } finally { C.RULES.allowShadow = was; }
  return out;
}
// existing: forward list. Returns new signals (not yet evaluated), tagged shadow:true with the real pattern name as the setup.
export function pick(cands, existing, at, newSignal) {
  const key = (s) => s.id + '|' + s.setup, open = new Set(existing.filter(isOpen).map(key)), have = new Set(existing.map((s) => s.signalId)), out = [];
  cands.sort((a, b) => b.opp - a.opp);
  for (const p of cands) {
    if (out.length >= MAX_NEW) break; const pl = p.sp;
    if (![pl.entryLow, pl.entryHigh, pl.stop, pl.tp1, pl.tp2, pl.tp3].every((v) => v != null && isFinite(+v))) continue;
    let sig; try { sig = newSignal(p, at); } catch { continue; }
    sig.signalId = sig.signalId + '|' + sig.setup; if (have.has(sig.signalId) || open.has(key(sig))) continue;
    sig.forward = true; sig.shadow = true; out.push(sig); have.add(sig.signalId); open.add(key(sig));
  }
  return out;
}
