// CACHE STAMP (30 Oct, Ryan: "the update didn't work on the scanner, I just checked on my phone"). Phones keep the page's code for a while,
// so every file the page loads gets ?v=<fingerprint of all the page code>. Change any page file and every link changes with it, so the
// phone has to fetch the new code. Run `node src/stamp.mjs` before pushing page changes; `--check` exits 1 if a stamp is out of date
// (the tests run it, so a stale stamp can't be pushed by mistake).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const CODE = () => readdirSync(DOCS).filter((f) => /\.(mjs|js|css)$/.test(f)).sort();
const strip = (s) => s.replace(/(\.(?:mjs|js|css))\?v=[0-9a-z]+/g, '$1');
export function fingerprint() { const h = createHash('sha256'); for (const f of CODE()) h.update(f + '\0' + strip(readFileSync(join(DOCS, f), 'utf8'))); h.update(strip(readFileSync(join(DOCS, 'index.html'), 'utf8'))); return h.digest('hex').slice(0, 10); }
// every relative import of a page file, static or dynamic, and the index page's script and stylesheet links
const stampText = (s, v) => s.replace(/(['"])(\.\/[\w.-]+\.(?:mjs|js|css))(?:\?v=[0-9a-z]+)?\1/g, (_, q, p) => `${q}${p}?v=${v}${q}`)
  .replace(/((?:src|href)=")([\w.-]+\.(?:mjs|js|css))(?:\?v=[0-9a-z]+)?"/g, (_, a, p) => `${a}${p}?v=${v}"`);
export function stamp({ check = false } = {}) { const v = fingerprint(), stale = [];
  for (const f of [...CODE().filter((x) => /\.(mjs|js)$/.test(x)), 'index.html']) { const p = join(DOCS, f), s = readFileSync(p, 'utf8'), t = stampText(s, v); if (t !== s) { stale.push(f); if (!check) writeFileSync(p, t); } }
  return { v, stale }; }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { const check = process.argv.includes('--check'), r = stamp({ check });
  if (check && r.stale.length) { console.error(`page stamp out of date in ${r.stale.join(', ')}: run node src/stamp.mjs`); process.exit(1); }
  console.log(check ? `page stamp ${r.v} is current` : `page stamped ${r.v}${r.stale.length ? ` (${r.stale.length} files updated)` : ' (no change)'}`); }
