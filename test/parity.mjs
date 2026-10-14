// Runs the ORIGINAL v10 browser scanner and the new standalone scanner on the same fake market
// and checks that every output (coins, charts, volume gauge, signal log) is identical.
import fs from 'node:fs'; import vm from 'node:vm'; import { execFileSync } from 'node:child_process'; import { installMock } from './mock.mjs';
const orig = fs.readFileSync(process.env.ORIG || '../ref/scanner_v10.js', 'utf8');
installMock(globalThis);
const prev = [{ signalId: 'SOL:OLD@2026-01-01', id: 'SOL:OLD', coin: 'OLD', chain: 'Solana', pool: 'solana_none', signalAt: new Date(Date.now() - 3600e3 * 30).toISOString().slice(0, 19) + 'Z', entryLow: 1, entryHigh: 1.1, entryMid: 1.05, stop: 0.9, tp1: 1.2, tp2: 1.3, tp3: 1.5, status: 'open', tpHit: 0 }];
const ctx = vm.createContext({ window: { PACE_MS: 1, PREV_SIGNALS: prev, EXTRA: ['solana:SXYZ3'] }, fetch: globalThis.fetch, setTimeout, Date, URL, URLSearchParams, console, AbortSignal });
vm.runInContext(orig, ctx);
const W = ctx.window; const t0 = Date.now();
while (W.SCAN.status === 'running') { await new Promise(r => setTimeout(r, 200)); if (Date.now() - t0 > 120000) throw new Error('original timed out'); }
if (W.SCAN.status !== 'done') throw new Error('original failed: ' + W.SCAN.err);
const E = W.EXPORT;
// new scanner in a temp folder with the same inputs (child process shares nothing, so install mock via --import)
const tmp = fs.mkdtempSync('/tmp/rs-'); fs.mkdirSync(tmp + '/data'); fs.writeFileSync(tmp + '/data/signals.json', JSON.stringify(prev));
fs.mkdirSync(tmp + '/config'); fs.writeFileSync(tmp + '/config/mycoins.json', JSON.stringify({ coins: ['solana:SXYZ3'] })); fs.copyFileSync('test/settings.parity.json', tmp + '/config/settings.json');
fs.writeFileSync(tmp + '/boot.mjs', `import {installMock} from '${process.cwd()}/test/mock.mjs'; installMock(globalThis);`);
execFileSync('node', ['--import', tmp + '/boot.mjs', process.cwd() + '/src/scan.mjs'], { cwd: tmp, env: { ...process.env, PACE_MS: '1', OUT_DIR: tmp + '/data' }, stdio: 'pipe' });
const N = f => JSON.parse(fs.readFileSync(tmp + '/data/' + f, 'utf8'));
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (['scannedAt', 'signalAt', 'checkedAt', 'ageDays', 'closedAt'].includes(k) ? undefined : v)));
let bad = 0; const eq = (name, a, b) => { const x = JSON.stringify(strip(a)), y = JSON.stringify(strip(b)); if (x === y) console.log('PASS', name, '(' + (Array.isArray(a) ? a.length : 1) + ' items)'); else { bad++; console.log('FAIL', name); const A = strip(a), B = strip(b); for (let i = 0; i < Math.max(A.length, B.length); i++) if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) { console.log(' first diff at', i, JSON.stringify(A[i])?.slice(0, 300), '\n   vs', JSON.stringify(B[i])?.slice(0, 300)); break; } } };
eq('coins (setups)', E.rows, N('setups.json')); eq('charts', E.charts, N('charts.json')); eq('volume gauge', E.market, N('chainvol.json')); eq('signal log', E.log, N('signals.json'));
console.log('kept', E.rows.length, 'scanned', E.scannedN, 'scored', E.scoredN, '| signals:', E.rows.filter(r => r.signal !== 'No trade').map(r => r.id + ':' + r.signal + ':' + r.opp).join(', '));
console.log(fs.readFileSync(tmp + '/data/last-run.txt', 'utf8'));
process.exit(bad ? 1 : 0);
