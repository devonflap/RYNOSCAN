// Weekly report to the phone: which gates to keep or relax, which gates bottleneck the search. Never fails the run.
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.env.OUT_DIR || 'docs/data';
export function compose(L) {
  if (!L || !L.gates) return null;
  const G = L.gates, lines = [];
  lines.push(...(G.summary || []));
  const top = (k) => (G[k] || []).filter((r) => r.failPct != null).slice(0, 3).map((r) => `${r.label} ${r.failPct}%`).join(', ');
  if (G.scans) { if (top('reversal')) lines.push('Reversal gates failing most: ' + top('reversal') + '.'); if (top('breakout')) lines.push('Breakout gates failing most: ' + top('breakout') + '.'); }
  if (L.edge && L.edge.headline) lines.push('Edge: ' + L.edge.headline);
  lines.push('Report only: nothing was switched off or changed.');
  return { title: 'RynoScan weekly gate report', body: lines.join('\n') };
}
async function main() {
  let L = null; try { L = JSON.parse(fs.readFileSync(path.join(OUT, 'learned.json'), 'utf8')); } catch {}
  const m = compose(L); if (!m) { console.log('weekly: no gate report yet'); return; }
  console.log(m.title + '\n' + m.body);
  const topic = (process.env.NTFY_TOPIC || '').trim(); if (!topic) return;
  try { await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: m.body, headers: { Title: m.title, Priority: 'default', Tags: 'rhinoceros,bar_chart' } }); } catch (e) { console.log('weekly: ntfy failed ' + (e.message || e)); }
}
if (process.argv[1] && process.argv[1].endsWith('weekly.mjs')) main().catch((e) => console.log('weekly: ' + e.message));
