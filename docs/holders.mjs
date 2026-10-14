// Holder parsing shared by the scanner (src/holders.mjs) and the dashboard's live lookup.
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
// token info response -> { holders, top10Pct, top30Pct } or null
export function parseInfo(j) {
  const h = j && j.data && j.data.attributes && j.data.attributes.holders; if (!h || typeof h !== 'object') return null;
  const holders = num(h.count); if (holders == null || holders <= 0) return null;
  const d = h.distribution_percentage || {}, t10 = num(d.top_10), n1130 = num(d['11_30']);
  return { holders: Math.round(holders), top10Pct: t10 != null ? +t10.toFixed(1) : null, top30Pct: t10 != null && n1130 != null ? +(t10 + n1130).toFixed(1) : null };
}
// history: [[epochMs, count], ...] oldest first. Growth = now vs the oldest reading that is 1 to 14 days old.
export function growth(hist, count, now) {
  if (!Array.isArray(hist) || !count) return { growPct: null, growDays: null };
  const old = hist.filter((x) => Array.isArray(x) && x[1] > 0 && now - x[0] >= 20 * 3600e3 && now - x[0] <= 14 * 86400e3).sort((a, b) => a[0] - b[0])[0];
  if (!old) return { growPct: null, growDays: null };
  return { growPct: +((count / old[1] - 1) * 100).toFixed(1), growDays: +((now - old[0]) / 86400e3).toFixed(1) };
}
