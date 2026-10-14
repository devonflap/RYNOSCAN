// Safeguard: a second, independent workflow that checks the scan is running and restarts it if not.
// decide() is pure so it can be tested; the CLI at the bottom is what the workflow calls.
import fs from 'node:fs';
export const STALE_MIN = 95;
export function decide({ scannedAt, now = Date.now(), running = 0 }) {
  const t = Date.parse(scannedAt || ''), age = isFinite(t) ? Math.round((now - t) / 60000) : null;
  if (running > 0) return { action: 'ok', age, reason: 'a scan is already running or queued' };
  if (age == null) return { action: 'restart', age, reason: 'no readable last-scan time' };
  if (age > STALE_MIN) return { action: 'restart', age, reason: `last scan is ${age} minutes old` };
  return { action: 'ok', age, reason: `last scan ${age} minutes ago` };
}
if (process.argv[1] && process.argv[1].endsWith('watchdog.mjs')) {
  let at = null; try { at = JSON.parse(fs.readFileSync(process.env.META || 'docs/data/meta.json', 'utf8')).scannedAt; } catch { /* missing */ }
  const d = decide({ scannedAt: at, running: Number(process.env.RUNNING || 0) });
  console.log(`watchdog: ${d.action} (${d.reason})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `action=${d.action}\nage=${d.age ?? 'unknown'}\nreason=${d.reason}\n`);
}
