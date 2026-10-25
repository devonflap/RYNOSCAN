// Market Watcher engine: "timing beats time". HTF spot setups on daily candles.
// regime -> impulse -> compression (wedge / flag / base) -> relative strength -> daily-close trigger -> sell into momentum.
// Pure functions, no I/O. Shared by src/alts.mjs (the daily job) and the dashboard. Bars are [t, o, h, l, c, v] oldest first.

export const P = {
  impulseLookback: 90, impulseMinGain: 0.5, corrMinBars: 6, corrMaxBars: 60, retraceMin: 0.2, retraceMax: 0.75,
  compressRatio: 0.85, decisionZone: 0.04, breakoutVolMult: 1.3, invalBuffer: 0.02, rsWindow: 14, minScore: 60,
};
// meme coins move more and correct deeper; same rules, looser numbers
export const P_MEME = { ...P, impulseMinGain: 1.0, retraceMax: 0.8, corrMaxBars: 45, corrMinBars: 4, invalBuffer: 0.04 };

const sma = (x, n) => x.map((_, i) => (i + 1 < n ? NaN : x.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
function atr(h, l, c, n) { const tr = h.map((_, i) => (i ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])) : h[i] - l[i])); return sma(tr, n); }
const argmax = (a, s = 0, e = a.length) => { let k = s; for (let i = s + 1; i < e; i++) if (a[i] > a[k]) k = i; return k; };
const argmin = (a, s = 0, e = a.length) => { let k = s; for (let i = s + 1; i < e; i++) if (a[i] < a[k]) k = i; return k; };
const max = (a, s = 0, e = a.length) => a[argmax(a, s, e)], min = (a, s = 0, e = a.length) => a[argmin(a, s, e)];
const r6 = (x) => +(+x).toPrecision(6);

export function analyse(symbol, bars, { basketRet = 0, btcRet = 0, p = P } = {}) {
  const o = bars.map((b) => +b[1]), h = bars.map((b) => +b[2]), l = bars.map((b) => +b[3]), c = bars.map((b) => +b[4]), v = bars.map((b) => +b[5]);
  const hasVol = v.some((x) => x > 0), n = c.length;
  const s = { symbol, state: 'NONE', pattern: '', score: 0, lastClose: c[n - 1], reasons: [], upperPts: [], lowerPts: [] };
  if (n < 40) { s.reasons.push('not enough history'); return s; }

  // relative strength
  const w = p.rsWindow, ret = c[n - 1] / c[n - 1 - w] - 1;
  s.rsBasket = +((ret - basketRet) * 100).toFixed(1); s.rsBtc = +((ret - btcRet) * 100).toFixed(1);

  // 1. impulse: the highest high in the lookback and the lowest low before it
  const lb = Math.min(p.impulseLookback, n), hiIdx = argmax(h, n - lb, n), loIdx = argmin(l, n - lb, hiIdx + 1);
  const impLow = l[loIdx], impHigh = h[hiIdx], gain = impHigh / impLow - 1;
  Object.assign(s, { impulseLow: impLow, impulseHigh: impHigh, impulseGainPct: +(gain * 100).toFixed(1) });
  if (gain < p.impulseMinGain) { s.reasons.push(`no impulse leg (+${Math.round(gain * 100)}% < ${Math.round(p.impulseMinGain * 100)}%)`); return s; }

  // 2. correction window
  const corrBars = n - 1 - hiIdx; s.corrBars = corrBars;
  if (corrBars < p.corrMinBars) { s.reasons.push('still in the impulse: nothing to buy yet'); return s; }
  if (corrBars > p.corrMaxBars) { s.reasons.push('correction too old, structure stale'); return s; }
  const corrLow = min(l, hiIdx, n), retrace = (impHigh - corrLow) / (impHigh - impLow); s.retracePct = +(retrace * 100).toFixed(1);
  if (retrace > p.retraceMax) { s.reasons.push(`retraced ${Math.round(retrace * 100)}%: the impulse is mostly undone`); return s; }

  // 3. trendlines, drawn on touches the way a chartist draws them
  //    upper: swing high -> the touch in the back 60% of the correction that keeps every later high under the line
  const start = hiIdx + Math.max(2, Math.floor(corrBars * 0.4)); let up = null, upPts = [hiIdx];
  { let bestQ = -1, bestM = -Infinity; for (let q = start; q < n; q++) if (h[q] < impHigh) { const m = (h[q] - impHigh) / (q - hiIdx); if (m > bestM) { bestM = m; bestQ = q; } }
    if (bestQ < 0) { s.reasons.push('no lower high yet: cannot draw the upper trendline'); return s; }
    up = [bestM, impHigh - bestM * hiIdx]; upPts = [hiIdx, bestQ]; }
  //    lower: if the pattern low is recent, run the line from an earlier correction low DOWN to it (a wedge); else from the low forward
  let lo, loPts; { const loI = argmin(l, hiIdx, n), late = (loI - hiIdx) / Math.max(corrBars, 1) >= 0.5 && n - 1 - loI <= 8;
    if (late && loI - hiIdx >= 4) { let bq = -1, bm = -Infinity; for (let q = hiIdx + 2; q < loI - 1; q++) { const m = (l[q] - l[loI]) / (q - loI); if (m > bm) { bm = m; bq = q; } } if (bq < 0) { bq = hiIdx + 1; bm = (l[bq] - l[loI]) / (bq - loI); } lo = [bm, l[loI] - bm * loI]; loPts = [bq, loI]; }
    else if (loI + 2 < n) { let bq = -1, bm = Infinity; for (let q = loI + 2; q < n; q++) { const m = (l[q] - l[loI]) / (q - loI); if (m < bm) { bm = m; bq = q; } } lo = [bm, l[loI] - bm * loI]; loPts = [loI, bq]; }
    else { lo = [0, l[loI]]; loPts = [loI]; } }
  s.upperPts = upPts.map((i) => [i, h[i]]); s.lowerPts = loPts.map((i) => [i, l[i]]);
  const lineAt = (L, x) => L[0] * x + L[1]; s.upperNow = r6(lineAt(up, n - 1)); s.lowerNow = r6(lineAt(lo, n - 1));
  const upS = up[0] / c[n - 1], loS = lo[0] / c[n - 1];
  if (upS >= 0) { s.reasons.push('no lower highs: not a correction pattern'); return s; }
  if (loS > 0.001) s.pattern = 'triangle (rising lows)';
  else if (Math.abs(loS) <= 0.001) s.pattern = 'flat base';
  else if (loS > upS * 0.75) s.pattern = 'falling wedge';
  else if (loS >= upS * 1.25) s.pattern = 'bull flag';
  else { s.reasons.push('lows falling faster than highs: expanding, not compressing'); return s; }
  if (up[0] !== lo[0]) { const apex = (lo[1] - up[1]) / (up[0] - lo[0]); s.pctThrough = +Math.min(1, Math.max(0, (n - 1 - hiIdx) / Math.max(apex - hiIdx, 1))).toFixed(2); } else s.pctThrough = 0;

  // 4. compression
  const a7 = atr(h, l, c, 7)[n - 1], a21 = atr(h, l, c, 21)[n - 1]; s.compression = a21 ? +(a7 / a21).toFixed(2) : 1;

  // 5. trigger
  const dist = c[n - 1] / s.upperNow - 1; s.distToUpperPct = +(dist * 100).toFixed(1);
  s.invalidation = r6(corrLow * (1 - p.invalBuffer));
  let volOk = true; if (hasVol && n >= 21) { const avg = v.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20; volOk = v[n - 1] >= p.breakoutVolMult * avg; }
  if (c[n - 1] < s.invalidation) { s.state = 'INVALIDATED'; s.reasons.push('closed under the pattern low'); }
  else if (c[n - 1] > s.upperNow && volOk) { s.state = 'BID'; s.reasons.push('daily close through the upper trendline' + (hasVol ? ' on volume' : '')); }
  else if (c[n - 1] > s.upperNow) { s.state = 'DECISION'; s.reasons.push('poked through the line but volume is thin: wait for confirmation'); }
  else if (Math.abs(dist) <= p.decisionZone || s.pctThrough >= 0.7) { s.state = 'DECISION'; s.reasons.push('pressing the upper trendline / near the apex'); }
  else { s.state = 'WATCH'; s.reasons.push(`${s.pattern} forming, ${corrBars}d into the correction`); }

  // 6. levels: measured move off the breakout
  const entry = s.state === 'BID' ? c[n - 1] : s.upperNow; s.entry = r6(entry); const r = entry - s.invalidation; s.rPerUnit = r6(r);
  s.t1 = r6(impHigh); s.t2 = r6(entry + (impHigh - impLow) * 0.618); s.t3 = r6(entry + (impHigh - impLow));

  // score: the things he actually weights
  let sc = s.pattern === 'falling wedge' ? 20 : s.pattern === 'bull flag' ? 14 : 10;
  sc += Math.floor(Math.min(2, Math.max(0.5, gain)) / 2 * 15);
  sc += retrace >= 0.3 && retrace <= 0.62 ? 15 : retrace < 0.3 ? 8 : 4;
  sc += s.compression < p.compressRatio ? 15 : 5;
  sc += Math.floor((Math.min(10, Math.max(-10, s.rsBasket)) + 10) / 2) + 5;
  sc += s.pctThrough >= 0.6 ? 10 : 5;
  sc += s.state === 'BID' ? 10 : s.state === 'DECISION' ? 6 : 2;
  if (r > 0 && (s.t2 - entry) / r >= 2) sc += 5;
  s.score = Math.min(100, sc);
  return s;
}

// Bull regime = BTC and the alt basket above their last weekly-scale swing low; momentum = above the 20-day.
export function regime(btc, basket) {
  const swingLow = (x, n = 10, minAge = 10) => { for (let i = x.length - 1 - minAge; i > n; i--) { let ok = true; for (let k = i - n; k <= i + n; k++) if (x[k] < x[i]) { ok = false; break; } if (ok) return x[i]; } return Math.min(...x); };
  const bSup = swingLow(btc), kSup = swingLow(basket), b20 = sma(btc, 20).at(-1), k20 = sma(basket, 20).at(-1);
  const structure = btc.at(-1) > bSup && basket.at(-1) > kSup, momentum = btc.at(-1) > b20 && basket.at(-1) > k20;
  const label = structure && momentum ? 'BULL' : structure ? 'BULL / CORRECTING' : 'OFF';
  const note = { BULL: 'uptrend structure, momentum on: bids allowed', 'BULL / CORRECTING': 'uptrend structure, now correcting: only bid clean HTF resolutions, no size', OFF: 'structure lost: reduce alt exposure, do nothing' }[label];
  return { label, note, btc: btc.at(-1), btcSupport: bSup, btcSma20: b20, basket: basket.at(-1), basketSupport: kSup, basketSma20: k20 };
}

// equal-weight basket index from a map of symbol -> closes (all the same length)
export function basketIndex(closesList) {
  const L = Math.min(...closesList.map((c) => c.length)); const out = new Array(L).fill(0);
  for (const c of closesList) { const s = c.slice(-L); for (let i = 0; i < L; i++) out[i] += s[i] / s[0]; }
  return out.map((x) => x / closesList.length);
}

// "spot & chill" book: stop to BE at +1R, 25% clips at T1/T2/T3, out under the stop. Mutates positions; returns events.
export function managePositions(positions, results, reg) {
  const by = new Map(results.map((r) => [r.symbol, r])), events = [];
  for (const p of positions) {
    const r = by.get(p.symbol); if (!r || !(p.entry > 0) || !(p.invalidation > 0)) continue;
    const px = r.lastClose, R = p.entry - p.invalidation; if (R <= 0) continue;
    const rr = (px - p.entry) / R; p.clips ??= []; p.size ??= 1; p.stop ??= p.invalidation; p.rMultiple = +rr.toFixed(2);
    if (px < p.stop) { if (p.size > 0) events.push([p.symbol, 'OUT', `closed ${px} under the stop ${p.stop}: out, do nothing`]); p.size = 0; continue; }
    if (rr >= 1 && p.stop < p.entry) { p.stop = p.entry; events.push([p.symbol, 'SL TO BE', `+1R reached (${px}). stop moved to entry ${p.entry}. free trade now, just riding`]); }
    for (const [k, lvl] of [['t1', r.t1], ['t2', r.t2], ['t3', r.t3]]) if (px >= lvl && !p.clips.includes(k) && p.size > 0) { p.clips.push(k); p.size = +(p.size - 0.25).toFixed(2); events.push([p.symbol, `SELL INTO MOMENTUM (${k.toUpperCase()})`, `${px} hit ${k.toUpperCase()} ${lvl}. clip 25% here, keep selling into strength. ${Math.round(p.size * 100)}% left`]); }
    if (reg && reg.label === 'OFF' && p.size > 0) events.push([p.symbol, 'REGIME OFF', 'TOTAL lost weekly support: reduce alt exposure']);
  }
  return events;
}
