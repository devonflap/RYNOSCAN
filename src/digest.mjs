// Safeguard: a bid-ready digest and a daily check-in, so a missed alert never means a missed chart.
// Both go to the phone (ntfy) and are rate-limited by keys stored in alerts.json.
const bne = (now) => new Date(now + 10 * 3600e3);                         // Brisbane wall clock as a UTC date
export const bneDate = (now) => bne(now).toISOString().slice(0, 10);
export const bneHour = (now) => bne(now).getUTCHours();
const f = (v) => v == null ? '-' : String(v);

// Which digest keys are due this run? Returns { checkin: key|null, bid: key|null }
export function due({ now, bidCount, sent }) {
  const out = { checkin: null, bid: null }, h = bneHour(now);
  const ck = 'HB|' + bneDate(now); if (h >= 6 && h < 12 && !sent[ck]) out.checkin = ck;                // first scan after 6am Brisbane, once a day
  const bk = 'DG|' + Math.floor(now / (6 * 3600e3)); if (bidCount > 0 && h >= 6 && h < 22 && !sent[bk]) out.bid = bk; // at most every 6 hours, daytime only
  return out;
}
// rows: dashboard rows (setups.json shape). Returns { title, body } for the phone.
export function compose({ kind, rows, meta, paper, site, now }) {
  const bid = rows.filter((r) => r.signal === 'Entry signal').sort((a, b) => (b.opp ?? 0) - (a.opp ?? 0));
  const lines = [];
  if (kind === 'checkin') lines.push(`Scanner is alive. Last scan ${meta && meta.scannedAt ? meta.scannedAt.slice(11, 16) + ' UTC' : 'n/a'}; ${rows.length} coins above 65, ${bid.length} bid-ready.`);
  else lines.push(`${bid.length} bid-ready setup${bid.length === 1 ? '' : 's'} right now:`);
  for (const r of bid.slice(0, 5)) {
    const d = r.price != null && r.entryHigh ? (r.price / r.entryHigh - 1) * 100 : null, where = d == null ? '' : d <= 1 ? ' [IN ZONE]' : ` [${d.toFixed(1)}% above zone]`;
    lines.push(`${r.coin} (${r.chain}) opp ${f(r.opp)}${where}: buy ${f(r.entryLow)}-${f(r.entryHigh)}, stop ${f(r.stop)}, TP ${f(r.tp1)} / ${f(r.tp2)} / ${f(r.tp3)}`);
  }
  if (bid.length > 5) lines.push(`+${bid.length - 5} more on the dashboard.`);
  if (!bid.length && kind === 'checkin') lines.push('Nothing to trade yet. You will get a buzz when a setup is bid-ready.');
  if (paper && paper.closedN != null) lines.push(`Paper account: $${Math.round(paper.equity).toLocaleString('en')} (${paper.retPct >= 0 ? '+' : ''}${paper.retPct.toFixed(1)}%), ${paper.closedN} closed trades.`);
  lines.push('Charts, stops and targets are on the dashboard. Rule-based screen, not advice.');
  return { title: kind === 'checkin' ? 'RynoScan daily check-in' : `RynoScan: ${bid.length} bid-ready`, body: lines.join('\n'), priority: kind === 'bid' ? 'default' : 'low' };
}
