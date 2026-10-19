// Weekly report to the phone: which gates to keep or relax, which gates bottleneck the search. Never fails the run.
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.env.OUT_DIR || 'docs/data';
export function compose(L) {
  if (!L || !(L.gates || L.runners || (L.books && L.books.length))) return null;
  const G = L.gates || { summary: [], scans: 0 }, lines = [];
  lines.push(...(G.summary || []));
  const top = (k) => (G[k] || []).filter((r) => r.failPct != null).slice(0, 3).map((r) => `${r.label} ${r.failPct}%`).join(', ');
  if (G.scans) { if (top('reversal')) lines.push('Reversal gates failing most: ' + top('reversal') + '.'); if (top('breakout')) lines.push('Breakout gates failing most: ' + top('breakout') + '.'); }
  if (L.runners && L.runners.summary) lines.push(...L.runners.summary);
  if (L.edge && L.edge.headline) lines.push('Edge: ' + L.edge.headline);
  if (L.books && L.books.length) { lines.push('Paper books: ' + L.books.map((b) => `${b.short} ${b.retPct >= 0 ? '+' : ''}${b.retPct.toFixed(1)}% (${b.closed} closed${b.avgR != null ? ', ' + (b.avgR >= 0 ? '+' : '') + b.avgR + 'R a trade' : ''})`).join(', ') + '. Judge a book only after 30 closed trades.');
    const ed = L.books.filter((b) => b.verdict === 'edge'), pr = L.books.filter((b) => b.verdict === 'promising');
    if (ed.length) lines.unshift('EDGE CANDIDATE: ' + ed.map((b) => `${b.short} averages ${b.avgR >= 0 ? '+' : ''}${b.avgR}R a trade over ${b.closed} trades (90% range ${b.lo} to ${b.hi}R)`).join('; ') + '. Confirm it on the next 30 trades before risking real money.');
    else if (pr.length) lines.push('Promising but not proven: ' + pr.map((b) => `${b.short} (${b.closed} trades)`).join(', ') + '.'); }
  lines.push('Report only: nothing was switched off or changed.');
  return { title: 'RynoScan weekly gate report', body: lines.join('\n') };
}
// one line per paper book: return since the fresh start and how many trades have closed
export async function bookSummary(dir = OUT) {
  const { book, fromSignal, fromRun } = await import('../docs/exits.mjs'), { BOOKS } = await import('../docs/strategies.mjs'), { evidence } = await import('../docs/evidence.mjs'), { botBook, BOT } = await import('../docs/botsim.mjs');
  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } }, since = (() => { try { return JSON.parse(fs.readFileSync('docs/paper-config.json', 'utf8')).since; } catch { return null; } })();
  const sig = rd('signals.json', []), dg = rd('degen.json', []), lab = rd('lab.json', []), out = [], allPos = [];
  for (const [k, B] of Object.entries(BOOKS)) { const P = k === 'bid' ? sig.map(fromSignal) : k === 'degen' ? dg.map((x) => fromRun(x, 'degen')) : lab.filter((x) => x && x.book === k).map((x) => fromRun(x)); P.filter(Boolean).forEach((x) => allPos.push({ ...x, src: k })); const b = book(P.filter(Boolean), { pct: B.pct, slots: B.slots, since }); if (b.closedN || b.openN) { const e = evidence(b); out.push({ key: k, short: B.short, retPct: b.retPct, closed: b.closedN, verdict: e.verdict, avgR: e.avgR, lo: e.lo, hi: e.hi }); } }
  for (const [k, B] of Object.entries(BOT)) { const b = botBook(allPos, { adaptive: B.adaptive, since }); if (b.closedN || b.openN) { const e = evidence(b); out.push({ key: k, short: B.short, retPct: b.retPct, closed: b.closedN, verdict: e.verdict, avgR: e.avgR, lo: e.lo, hi: e.hi }); } }
  return out;
}
async function main() {
  let L = null; try { L = JSON.parse(fs.readFileSync(path.join(OUT, 'learned.json'), 'utf8')); } catch {}
  try { L = L || {}; L.books = await bookSummary(); } catch (e) { console.log('weekly: paper books skipped ' + (e.message || e)); }
  const m = compose(L); if (!m) { console.log('weekly: no gate report yet'); return; }
  console.log(m.title + '\n' + m.body);
  const topic = (process.env.NTFY_TOPIC || '').trim(); if (!topic) return;
  try { await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: m.body, headers: { Title: m.title, Priority: 'default', Tags: 'rhinoceros,bar_chart' } }); } catch (e) { console.log('weekly: ntfy failed ' + (e.message || e)); }
}
if (process.argv[1] && process.argv[1].endsWith('weekly.mjs')) main().catch((e) => console.log('weekly: ' + e.message));
