// Bot tuner: the learning loop finds hints about a pattern ("works best when ...", "does worst when ..."); the tuner turns each hint
// into a bot filter and tracks it on trades that came AFTER it was found. A filter is switched on only when it has held out of sample,
// and a starting filter is switched off when new trades show it hurts. Backtest replays are where hints come from (hindsight, and
// coins that are still active today), so they never confirm a hint by themselves.
// Only ever changes WHICH setups a bot takes. Never sizing, risk limits, entries or exits. Pure: no network, no clock.
import { FEATS } from './features.mjs?v=207bcdf506';
import { statsBook, fromRun } from './exits.mjs?v=207bcdf506';
import { pDiff, bhQ } from './evidence.mjs?v=207bcdf506';

export const TUNE = {
  breakout: { pattern: 'Breakout retest', book: 'brk', start: ['Reward to risk (TP2)|3R+|only'], from: '2026-10-21T00:00:00Z', minKept: 10, minRemoved: 8, minDiff: 0.3, maxQ: 0.1, minKeepShare: 0.2 },
};
const FN = new Map(FEATS), T = (x) => { const t = Date.parse(x || ''); return isFinite(t) ? t : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null), r2 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(2));
export const parseKey = (k) => { const [feat, bucket, side] = String(k || '').split('|'); return { feat, bucket, side }; };
export const filterKey = (feat, bucket, side) => `${feat}|${bucket}|${side}`;
// does this filter keep the setup? An "only" filter needs the value (unknown is skipped); a "skip" filter keeps unknowns.
export function keeps(key, row) { const { feat, bucket, side } = parseKey(key), fn = FN.get(feat); if (!fn) return true; const v = fn(row || {}); if (v == null) return side !== 'only'; return side === 'only' ? v === bucket : v !== bucket; }
export const keepsAll = (keys, row) => (keys || []).every((k) => keeps(k, row));
export function labelOf(key) { const { feat, bucket, side } = parseKey(key), f = feat ? feat[0].toLowerCase() + feat.slice(1) : ''; return `${side === 'only' ? 'only when' : 'skip when'} ${f} is ${bucket}`; }

// one filter on a set of trades [{ R, ...features }]: trades where the feature is unknown are left out of both sides
export function split(key, trades) {
  const { feat } = parseKey(key), fn = FN.get(feat), known = (trades || []).filter((t) => fn && fn(t) != null && isFinite(t.R)), K = known.filter((t) => keeps(key, t)), X = known.filter((t) => !keeps(key, t));
  const kR = mean(K.map((t) => t.R)), xR = mean(X.map((t) => t.R)), p = K.length >= 3 && X.length >= 3 ? pDiff(K.map((t) => t.R), X.map((t) => t.R)) : 1;
  return { kept: K.length, removed: X.length, keptR: r2(kR), removedR: r2(xR), diff: kR != null && xR != null ? r2(kR - xR) : null, p: +p.toFixed(4) };
}

// hints: [{ feat, bucket, side }] from the learning loop's pattern dossier. inSample: backtest rows. forward: trades tracked as they happened.
// prev: the last result (keeps when each candidate was first seen). Returns the candidates with their evidence and the active filter list.
export function tune({ cfg, hints = [], inSample = [], forward = [], prev = null, now = Date.now() }) {
  const nowIso = new Date(now).toISOString().slice(0, 19) + 'Z', old = new Map(((prev && prev.candidates) || []).map((c) => [c.key, c])), keys = new Set([...cfg.start, ...old.keys()]);
  for (const h of hints) if (h && h.feat && h.bucket && FN.has(h.feat)) keys.add(filterKey(h.feat, h.bucket, h.side === 'skip' ? 'skip' : 'only'));
  const fwd = forward.filter((t) => isFinite(t.R) && (T(t.at) ?? 0) >= T(cfg.from)), cands = [];
  for (const key of keys) {
    const o = old.get(key), since = o ? o.since : nowIso < cfg.from ? cfg.from : nowIso, origin = cfg.start.includes(key) ? 'start' : 'hint', f = split(key, fwd.filter((t) => (T(t.at) ?? 0) >= T(since)));
    cands.push({ key, label: labelOf(key), origin, since, status: 'testing', inSample: split(key, inSample), forward: f });
  }
  // luck check: a filter is only called once the gap between kept and removed trades is big enough AND unlikely to be luck across
  // every filter being tested at the same time (Benjamini-Hochberg). Roughly a 0.7R gap at the minimum sample, less as trades build up.
  const ready = cands.filter((c) => c.forward.kept >= cfg.minKept && c.forward.removed >= cfg.minRemoved), qs = bhQ(ready.map((c) => c.forward.p));
  ready.forEach((c, i) => { c.forward.q = +qs[i].toFixed(4); const d = c.forward.diff, sure = c.forward.q <= cfg.maxQ;
    c.status = d >= cfg.minDiff && sure ? 'confirmed' : d <= -cfg.minDiff && sure ? 'rejected' : Math.abs(d) >= cfg.minDiff ? (d > 0 ? 'leaning better' : 'leaning worse') : 'unclear'; });
  let active = cands.filter((c) => (c.origin === 'start' && c.status !== 'rejected') || c.status === 'confirmed').map((c) => c.key);
  // never let the filters together leave almost nothing to trade: drop the newest confirmations until enough trades are kept
  const share = (ks) => (fwd.length ? fwd.filter((t) => keepsAll(ks, t)).length / fwd.length : 1), held = [];
  while (active.length && fwd.length >= 10 && share(active) < cfg.minKeepShare) { const c = cands.filter((x) => active.includes(x.key) && x.origin !== 'start').sort((a, b) => String(b.since).localeCompare(String(a.since)))[0]; if (!c) break; active = active.filter((k) => k !== c.key); held.push(c.key); c.held = true; }
  const was = (prev && prev.active) || cfg.start, on = active.filter((k) => !was.includes(k)), off = was.filter((k) => !active.includes(k));
  return { at: nowIso, pattern: cfg.pattern, candidates: cands.sort((a, b) => (a.origin === 'start' ? -1 : 0) - (b.origin === 'start' ? -1 : 0) || String(a.since).localeCompare(String(b.since))), active, on, off, held, forwardN: fwd.length, keepShare: r2(share(active)), changedAt: on.length || off.length ? nowIso : (prev && prev.changedAt) || null };
}

// the trades the tuner learns from, oldest source last: the paper book that mirrors the bot, then live signals, then the scanner's own
// forward tracking (near-misses and shadow patterns). The same coin on the same day counts once.
export function forwardTrades({ pattern, book, lab = [], signals = [], forward = [], now = Date.now() }) {
  const out = [], seen = new Set(), add = (t) => { const k = `${String(t.coin).toUpperCase()}|${String(t.at).slice(0, 10)}`; if (seen.has(k) || !isFinite(t.R)) return; seen.add(k); out.push(t); };
  const rows = lab.filter((x) => x && x.book === book), byKey = new Map(rows.map((x) => [x.lid, x]));
  for (const t of statsBook(rows.map((x) => fromRun(x)).filter(Boolean), { now }).trades) { if (t.open || t.R == null) continue; const x = byKey.get(t.key) || {}; add({ src: 'paper', coin: x.coin, at: x.signalAt, R: t.R, chain: x.chain, rr2: x.rr2 ?? null, riskPct: x.riskPct ?? null, volDay: x.volDay ?? null }); }
  const rp = (s) => (s.entryMid && s.stop ? +((s.entryMid - s.stop) / s.entryMid * 100).toFixed(1) : null);
  for (const s of signals) if (s && s.setup === pattern && s.resultR != null) add({ src: 'live', coin: s.coin, at: s.signalAt, R: +s.resultR, chain: s.chain, rr2: s.rr2 ?? null, riskPct: rp(s), volDay: s.volDay ?? null });
  for (const s of forward) if (s && s.setup === pattern && s.resultR != null) add({ src: s.shadow ? 'shadow' : 'near-miss', coin: s.coin, at: s.signalAt, R: +s.resultR, chain: s.chain, rr2: s.rr2 ?? null, riskPct: rp(s), volDay: s.volDay ?? null });
  return out;
}

// a short plain-English summary for the council and the weekly report
export function tuneText(t) {
  if (!t) return null; const on = t.candidates.filter((c) => t.active.includes(c.key)), testing = t.candidates.filter((c) => !t.active.includes(c.key) && c.status !== 'rejected');
  const f = (c) => `${c.label} (${c.forward.kept}/${c.forward.removed} new trades kept/removed${c.forward.diff != null ? `, ${c.forward.diff >= 0 ? '+' : ''}${c.forward.diff}R` : ''})`;
  return `${t.pattern} bot filters on: ${on.length ? on.map((c) => c.label).join('; ') : 'none'}. Testing on new trades: ${testing.length ? testing.map(f).join('; ') : 'nothing'}. ${t.forwardN} trades since ${String(TUNE.breakout.from).slice(0, 10)}.${t.on.length ? ` Switched on: ${t.on.map(labelOf).join(', ')}.` : ''}${t.off.length ? ` Switched off: ${t.off.map(labelOf).join(', ')}.` : ''}`;
}
