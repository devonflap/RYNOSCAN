// Publishes each bot's trade record to the scanner's data folder on GitHub (docs/data/bots/<bot>.json), once an hour, so the council
// and the learning loop can read the bot's real fills, misses and passed-on setups. Needs a GitHub token with "Contents: read and write"
// on the RYNOSCAN repo only, stored as GITHUB_TOKEN in /etc/rynobot.env. Without a token this does nothing and the bot runs as before.
// Nothing private is published: no wallet addresses, no balances, no keys.
import { deskSummary } from './desk.mjs';
export const REPO = 'devonflap/RYNOSCAN';
export function publicRecord(d) {
  if (!d || !d.installed) return null; const strip = (p) => ({ coin: p.coin, chain: p.chain, pool: p.pool, setup: p.setup, kind: p.kind, mode: p.mode, execMode: p.execMode, openedAt: p.openedAt, closedAt: p.closedAt || null, entry: p.entry, stop0: p.stop0, exitAvg: p.exitAvg ?? null, costUsd: p.costUsd, pnl: p.pnl ?? null, pnlPct: p.pnlPct ?? null, R: p.R ?? null, why: p.why || null, heldH: p.heldH, meta: p.meta, peak: p.peak, trough: p.trough, moves: p.moves, sells: (p.sells || []).map((s) => ({ at: s.at, why: s.why, px: s.px, usd: s.usd, manual: !!s.manual })) });
  return { bot: d.name, at: new Date().toISOString().slice(0, 19) + 'Z', execMode: d.execMode, startedAt: d.account.startedAt, account: { start: d.account.start, equity: d.account.equity, kitty: d.account.kitty, pnlPct: d.account.pnlPct, maxDDPct: d.account.maxDDPct }, stats: d.stats, risk: { openRiskPct: d.risk.openRiskPct, blocked: d.risk.blocked }, filters: d.filters, open: d.open.map(strip), closed: d.closed.map(strip), passed: d.passed, passedSummary: d.passedSummary, missed: (d.missed || []).slice(0, 40), missedSummary: d.missedSummary || null, events: d.events.filter((e) => ['buy', 'sell', 'drop', 'skip', 'refused', 'filters', 'mode'].includes(e.type)).slice(0, 40), reality: d.reality };
}
export async function publish(name, record, { token = process.env.GITHUB_TOKEN, repo = REPO, fetcher = fetch } = {}) {
  if (!token || !record) return { skipped: !token ? 'no GITHUB_TOKEN' : 'nothing to publish' };
  const path = `docs/data/bots/${name}.json`, api = `https://api.github.com/repos/${repo}/contents/${path}`, h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'rynobot', 'content-type': 'application/json' };
  // GitHub answers 409 when the branch moved between reading the file and writing it (the hourly scan commits, and four bots publish in the
  // same minute), so read the sha and write again, a few times, with a short random pause
  let last = null; for (let tryN = 0; tryN < 4; tryN++) {
    let sha = null; try { const r = await fetcher(api, { headers: h, signal: AbortSignal.timeout(15000) }); if (r.ok) sha = (await r.json()).sha || null; } catch { /* new file */ }
    const body = { message: `bot ${name} ${record.at}`, content: Buffer.from(JSON.stringify(record)).toString('base64'), ...(sha ? { sha } : {}) };
    const r = await fetcher(api, { method: 'PUT', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); if (r.ok) return { ok: true, path, tries: tryN + 1 };
    last = 'GitHub ' + r.status + ' ' + (await r.text()).slice(0, 120); if (r.status !== 409 && r.status !== 422) break; await new Promise((res) => setTimeout(res, 1500 + Math.random() * 4000)); }
  throw new Error(last);
}
export const recordFor = (name, args) => publicRecord(deskSummary(name, args));
