// Runs the review council on the data files and writes docs/data/council.json. Called at the end of every scan; also runnable on its own:
//   node src/councilrun.mjs            (uses docs/data)
import fs from 'node:fs';
import path from 'node:path';
import { council } from '../docs/council.mjs';
const rd = (dir, f, d) => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return Array.isArray(d) ? (Array.isArray(j) ? j : d) : j && typeof j === 'object' ? j : d; } catch { return d; } };
export async function runCouncil(dir = process.env.OUT_DIR || 'docs/data', { now = Date.now(), topic = '', site = '' } = {}) {
  const since = rd('docs', 'paper-config.json', {}).since || null, prev = rd(dir, 'council.json', {});
  const c = council({ signals: rd(dir, 'signals.json', []), degen: rd(dir, 'degen.json', []), lab: rd(dir, 'lab.json', []), learned: rd(dir, 'learned.json', null), wscore: rd(dir, 'walletscore.json', null), since, history: prev.history || [], now });
  // phone alert only when a book is newly called a bot candidate (rare by design)
  const before = new Set(((prev.books || []).filter((b) => b.call === 'bot candidate')).map((b) => b.key)), fresh = c.books.filter((b) => b.call === 'bot candidate' && !before.has(b.key));
  if (fresh.length && topic) { try { const h = { Title: 'RynoScan council: bot candidate', Priority: 'high', Tags: 'rhinoceros,scales' }; if (site) h.Click = site;
    await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: `${c.final.answer}\n\nPaper-tested only. Nothing trades real money unless you set it up yourself.`, headers: h }); } catch { /* optional */ } }
  fs.writeFileSync(path.join(dir, 'council.json'), JSON.stringify(c));
  return c;
}
if (process.argv[1] && process.argv[1].endsWith('councilrun.mjs')) runCouncil().then((c) => { console.log('Council: ' + c.final.headline); console.log(c.final.answer); for (const h of c.hats) console.log(`- ${h.name}: ${h.headline}`); }).catch((e) => console.log('council: ' + (e.message || e)));
