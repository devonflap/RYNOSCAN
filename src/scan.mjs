// RynoScan standalone scanner. Run: node src/scan.mjs
// Reads config/settings.json + config/mycoins.json, scans meme coins, writes docs/data/*.json,
// and (optionally) sends a phone alert through ntfy when something new appears.
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../docs/core.mjs';
import { discoverPools } from '../docs/pools.mjs';
import { makeApi } from './api.mjs';
import { checkToken, fetchRegime, applyOverlays } from '../docs/overlays.mjs';

const OUT = process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = readJson('config/settings.json', {});
const mine = readJson('config/mycoins.json', { coins: [] });
const api = makeApi();
const cfg = {
  chains: settings.chains, safetyChecks: settings.safetyChecks !== false, regimeFilter: settings.regimeFilter ?? 'warn',
  extraPages: api.keyed ? (settings.extraPages ?? 0) : 0,
  minVolume: settings.minVolume ?? 250000, minLiquidity: settings.minLiquidity ?? 100000, minOpp: settings.minOpp ?? 65,
  maxPools: api.keyed ? (settings.maxPools ?? 120) : (settings.freeMaxPools ?? 60),
  cap: api.keyed ? (settings.cap ?? { solana: 70, robinhood: 50, eth: 20 }) : (settings.freeCap ?? { solana: 40, robinhood: 40, eth: 12 }),
};
const t0 = Date.now();
const say = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
say(`data plan: ${api.plan}, pace ${api.paceMs}ms, up to ${cfg.maxPools} pools, floor $${cfg.minVolume}/24h volume and $${cfg.minLiquidity} liquidity`);

fs.mkdirSync(OUT, { recursive: true });
// Two scheduled slots per hour back each other up (GitHub sometimes skips one). If a scan already ran in the last
// 40 minutes, the second scheduled run does nothing. Manual runs always scan.
if (process.env.GITHUB_EVENT_NAME === 'schedule') {
  const lastMeta = readJson(path.join(OUT, 'meta.json'), null), ageMin = lastMeta && lastMeta.scannedAt ? (Date.now() - Date.parse(lastMeta.scannedAt)) / 60000 : Infinity;
  if (ageMin < 40) { say(`last scan was ${Math.round(ageMin)} min ago: nothing to do this slot`); process.exit(0); }
}
const prevSignals = readJson(path.join(OUT, 'signals.json'), []);
const prevSetups = readJson(path.join(OUT, 'setups.json'), []);

// 1. discover pools
const { list, mineList } = await discoverPools(api.get, cfg, mine.coins || [], m => api.log.push(m));
say(`${list.length} pools to scan`);
if (list.length < 5) { console.error('Pool discovery returned almost nothing; data feed is probably down. Leaving the dashboard untouched.'); process.exit(1); }

// 2. candles + indicators + patterns
let done = 0;
for (const p of list) {
  const j = await api.get(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list;
  if (!raw) api.log.push('nofetch ' + p.sym); else C.techFromRaw(p, raw);
  if (++done % 20 === 0) say(`${done}/${list.length} pools`);
}

// 3. score, dedupe, second-opinion check
const now = Date.now();
C.scoreList(list, now);
let rows = C.sortRows(C.dedupeRows(list));
await C.crossCheck(rows, { getJson: api.getJson, sleep: api.sleep, log: m => api.log.push(m) });
// 3b. token safety (cached 24h) and SOL/ETH market regime, then re-rank
const cachePath = path.join(OUT, 'safety-cache.json');
const cache = readJson(cachePath, {});
const safety = {};
let regime = null;
if (cfg.safetyChecks) {
  const todo = rows.filter(p => p.opp != null && (p.mine || p.opp >= 55) && p.token);
  let fresh = 0;
  for (const p of todo) {
    const k = p.net + '|' + p.token, c = cache[k];
    if (c && Date.now() - Date.parse(c.at) < 24 * 3600e3 && c.level !== 'unchecked') { safety[k] = c; continue; }
    const r = await checkToken(p, api.getJson, settings);
    safety[k] = { ...r, at: new Date().toISOString() }; if (r.level !== 'unchecked') cache[k] = safety[k]; fresh++;
    await api.sleep(400);
  }
  for (const k of Object.keys(cache)) if (Date.now() - Date.parse(cache[k].at) > 7 * 86400e3) delete cache[k];
  say(`token safety: ${todo.length} checked (${fresh} fresh), ${Object.values(safety).filter(x => x.level === 'danger').length} dangerous, ${Object.values(safety).filter(x => x.level === 'unchecked').length} unchecked`);
}
if (cfg.regimeFilter !== 'off') { regime = await fetchRegime(api.getCG); say(`market regime: SOL ${regime.sol?.level ?? 'n/a'}, ETH ${regime.eth?.level ?? 'n/a'}`); }
const excluded = applyOverlays(rows, { safety, regime, regimeFilter: cfg.regimeFilter });
C.sortRows(rows);
const allRows = rows, scannedN = allRows.length, scoredN = allRows.filter(p => p.score != null).length;
if (scoredN < Math.max(5, scannedN * 0.5)) { console.error(`Only ${scoredN}/${scannedN} pools could be scored (candle fetches failing). Leaving the dashboard untouched.`); process.exit(1); }
// cooldown: a coin that just stopped out is not re-signalled as an entry for cfg.cooldownHours
try { const { applyCooldown } = await import('../docs/overlays.mjs'); if (typeof applyCooldown !== 'function') throw new Error('overlays.mjs is the old version'); const nCool = applyCooldown(rows, prevSignals, settings.cooldownHours ?? 48, C.CH); if (nCool) say(`cooldown: ${nCool} coin(s) held back after a recent stop-out`); } catch (e) { say('cooldown skipped: ' + e.message); }
const kept = rows.filter(p => p.mine || (p.opp != null && p.opp > cfg.minOpp));
const at = new Date().toISOString().slice(0, 19) + 'Z';

// 4. signal log: check open signals, add new ones
const log = [];
for (const s of prevSignals) {
  if (s.status === 'open' || s.status === 'waiting for entry') {
    const j = await api.get(`/networks/${C.NETOF[String(s.chain).toLowerCase()] || String(s.chain).toLowerCase()}/pools/${s.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
    const raw = j?.data?.attributes?.ohlcv_list;
    log.push(raw ? C.evaluate(s, raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)), at, { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder }) : { ...s, checkedAt: at });
  } else log.push(s);
}
for (const p of kept.filter(p => p.signal === 'Entry signal')) {
  const sig = C.newSignal(p, at);
  if (log.some(s => s.signalId === sig.signalId)) continue;
  if (log.some(s => s.id === sig.id && (s.status === 'open' || s.status === 'waiting for entry'))) continue;
  log.push(sig);
}
log.sort((a, b) => b.signalAt.localeCompare(a.signalAt));

// 5. export
const out = kept.map(p => { const r = C.toRow(p, at); if (p.rug) r.rug = p.rug; if (p.rugFlags) r.rugFlags = p.rugFlags; if (p.regime) r.regime = p.regime; return r; });
const charts = kept.filter(C.chartWorthy).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (b.opp ?? 0) - (a.opp ?? 0)).slice(0, 32).map(C.toChart);
const market = C.marketRows(allRows);
const meta = { scannedAt: at, scannedN, scoredN, kept: out.length, minOpp: cfg.minOpp, seconds: Math.round((Date.now() - t0) / 1000), plan: api.plan, mine: mineList, regime, excluded, safetyOn: cfg.safetyChecks, regimeFilter: cfg.regimeFilter };
const w = (f, d) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(d));
if (cfg.safetyChecks) fs.writeFileSync(cachePath, JSON.stringify(cache));
w('setups.json', out); w('signals.json', log); w('charts.json', charts); w('chainvol.json', market); w('meta.json', meta);
say(`wrote ${out.length} coins, ${charts.length} charts, ${log.length} logged signals`);

// 6. what changed since the last scan
const prevById = new Map(prevSetups.map(r => [r.id, r]));
const prevSigById = new Map(prevSignals.map(s => [s.signalId, s]));
const lines = [];
const all = market.find(m => m.chain === 'All' && m.daysAgo === 0);
const vr = all?.ratio, vlabel = vr == null ? 'n/a' : vr >= 1.15 ? 'Strong' : vr >= 0.85 ? 'Normal' : vr >= 0.6 ? 'Below normal' : 'Poor';
const brisbane = new Date(Date.now() + 10 * 3600e3).toISOString().slice(11, 16);
lines.push(`Scan ${brisbane} Brisbane: ${scannedN} scanned, ${scoredN} scored, ${out.length} above ${cfg.minOpp}. On-chain volume ${vlabel}${vr != null ? ` (${vr}x 7-day avg)` : ''}.`);
if (vlabel === 'Poor' || vlabel === 'Below normal') lines.push('On-chain volume is weak today, so keep trades at none or minimum.');
const fmt = r => `${r.coin} (${r.chain}) ${r.setupType}, opp ${r.opp}, checks ${r.conf ?? '-'}/6, stop ${r.riskPct}% away, upside ${r.upsidePct}%`;
const newEntry = out.filter(r => r.signal === 'Entry signal' && prevById.get(r.id)?.signal !== 'Entry signal');
const newWatch = out.filter(r => r.signal === 'Watch' && prevById.get(r.id)?.signal !== 'Watch' && prevById.get(r.id)?.signal !== 'Entry signal').slice(0, 5);
const droppedEntry = prevSetups.filter(r => r.signal === 'Entry signal' && out.find(o => o.id === r.id)?.signal !== 'Entry signal');
newEntry.forEach(r => lines.push(`NEW bid-ready: ${fmt(r)}. Entry ${r.entryLow}-${r.entryHigh}, stop ${r.stop}, TP ${r.tp1} / ${r.tp2} / ${r.tp3}.`));
droppedEntry.forEach(r => lines.push(`No longer bid-ready: ${r.coin} (${r.chain}).`));
newWatch.forEach(r => lines.push(`NEW watch: ${fmt(r)}${r.caution ? '; ' + r.caution : ''}.`));
const logChanges = log.filter(s => { const o = prevSigById.get(s.signalId); return o && (o.status !== s.status || o.tpHit !== s.tpHit); });
logChanges.forEach(s => lines.push(`Signal ${s.coin}: ${s.status}${s.tpHit ? ' (TP' + s.tpHit + ' hit)' : ''}${s.resultR != null ? `, result ${s.resultR}R` : s.openR != null ? `, open ${s.openR}R` : ''}.`));
if (regime) { const rs = [['SOL', regime.sol], ['ETH', regime.eth]].filter(x => x[1]).map(x => `${x[0]} ${x[1].level.toLowerCase()}`); if (rs.length) lines.push('Market: ' + rs.join(', ') + (Object.values(regime).some(x => x && x.level === 'Risk-off') ? '. Reversals fail more often in a falling market, so size down.' : '.')); }
if (excluded.length) lines.push(`Removed for token safety: ${excluded.slice(0, 6).join(', ')}.`);
if (lines.length === 1 || (lines.length === 2 && lines[1].startsWith('On-chain'))) lines.push('No new signals since the last scan.');
lines.push('Rule-based screen, not financial advice. Rules are untested until the log builds up.');
const text = lines.join('\n');
fs.writeFileSync(path.join(OUT, 'last-run.txt'), text + '\n');
console.log('\n' + text + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n');

// 7. phone alert (only for things worth a buzz, still actionable, and not repeated within 24h)
const topic = (process.env.NTFY_TOPIC || '').trim();
const alertsPath = path.join(OUT, 'alerts.json'), sent = readJson(alertsPath, {});
for (const k of Object.keys(sent)) if (Date.now() - Date.parse(sent[k]) > 3 * 86400e3) delete sent[k];
const fresh = key => !sent[key] || Date.now() - Date.parse(sent[key]) > 24 * 3600e3;
const stillInZone = r => r.price != null && r.entryHigh != null && r.stop != null && r.price <= r.entryHigh * 1.01 && r.price > r.stop;
const maxPos = r => r.liquidity ? ` Max size about $${Math.round(r.liquidity * 0.01 / 10) * 10 || 10} (1% of liquidity).` : '';
const regTxt = r => r.regime === 'Risk-off' ? ' Market is risk-off, so size down.' : '';
const hitEvents = logChanges.filter(s => /TP|stopped|hit/.test(s.status) || (s.tpHit || 0) > (prevSigById.get(s.signalId)?.tpHit || 0));
const alertEntry = newEntry.filter(r => stillInZone(r) && fresh('E|' + r.id));
const alertHot = newWatch.filter(r => r.opp >= 75 && stillInZone(r) && fresh('W|' + r.id));
const alertHits = hitEvents.filter(s => fresh(`H|${s.signalId}|${s.status}|${s.tpHit}`));
if (topic && (alertEntry.length || alertHot.length || alertHits.length)) {
  const a = alertEntry[0], h = alertHot[0];
  const head = a ? `New bid-ready: ${a.coin} (${a.chain}), opp ${a.opp}. Buy ${a.entryLow}-${a.entryHigh}, stop ${a.stop} (${a.riskPct}% away).${maxPos(a)}${regTxt(a)}`
    : alertHits.length ? `Signal update: ${alertHits[0].coin} ${alertHits[0].status}`
    : `New watch: ${h.coin} (${h.chain}), opp ${h.opp}, entry ${h.entryLow}-${h.entryHigh}, stop ${h.stop}.${maxPos(h)}${regTxt(h)}`;
  try {
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: head + '\n\n' + text, headers: { Title: 'RynoScan', Priority: alertEntry.length ? 'high' : 'default', Tags: 'rhinoceros' } });
    say('alert sent: ' + r.status);
    if (r.ok) { const now = new Date().toISOString(); alertEntry.forEach(r => sent['E|' + r.id] = now); alertHot.forEach(r => sent['W|' + r.id] = now); alertHits.forEach(s => sent[`H|${s.signalId}|${s.status}|${s.tpHit}`] = now); }
  } catch (e) { say('alert failed: ' + e.message); }
} else if (topic) say('no alert: nothing new that is still inside its entry zone');
fs.writeFileSync(alertsPath, JSON.stringify(sent));
const st = api.stats();
say(`done. ${st.calls} data calls, ${st.n429} rate-limit hits, ${st.nErr} errors`);
