// RynoScan standalone scanner. Run: node src/scan.mjs
// Reads config/settings.json + config/mycoins.json, scans meme coins, writes docs/data/*.json,
// and (optionally) sends a phone alert through ntfy when something new appears.
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../docs/core.mjs';
import { discoverPools } from '../docs/pools.mjs';
import { makeApi } from './api.mjs';
import { checkToken, fetchRegime, applyOverlays } from '../docs/overlays.mjs';
import { debate, planView } from '../docs/panel.mjs';
import { pickMode, poolsFromTracked } from './lightpool.mjs';
import { enrich as enrichHolders } from './holders.mjs';
import { enrich as enrichSocial } from './social.mjs';
import * as shadow from './shadow.mjs';
import * as early from './early.mjs';
import { funnel, oneAway, compact as funnelCompact, appendHistory as funnelAppend } from './funnel.mjs';
import { due as digestDue, compose as digestCompose } from './digest.mjs';
import { simulate } from '../docs/paper.mjs';
import { pickCandidates, trim as trimFwd, MAX_EVAL } from './forward.mjs';
import * as D from '../docs/degen.mjs';
import { fetchWallets, loadSmart } from './wallets.mjs';

const OUT = process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? (Array.isArray(j) ? j : d) : (j && typeof j === 'object' && !Array.isArray(j) ? j : d); } catch { return d; } }; // wrong-shaped files fall back to the default
const settings = readJson('config/settings.json', {});
const mine = readJson('config/mycoins.json', { coins: [] });
const api = makeApi();
// what the weekly backtest learned: patterns proven by the data go live, patterns that keep losing are switched off
const learned0 = readJson(path.join(OUT, 'learned.json'), null), learned = learned0 && { ...learned0, promote: Array.isArray(learned0.promote) ? learned0.promote : [], demote: Array.isArray(learned0.demote) ? learned0.demote : [] };
try { C.applyLearned(learned); } catch { /* old core.mjs: ignore */ }
const cfg = {
  chains: settings.chains, safetyChecks: settings.safetyChecks !== false, regimeFilter: settings.regimeFilter ?? 'warn',
  extraPages: api.keyed ? (settings.extraPages ?? 0) : 0,
  minVolume: settings.minVolume ?? 250000, minLiquidity: settings.minLiquidity ?? 100000, minOpp: settings.minOpp ?? 65,
  maxPools: api.keyed ? (settings.maxPools ?? 120) : (settings.freeMaxPools ?? 60),
  cap: api.keyed ? (settings.cap ?? { solana: 70, robinhood: 50, eth: 20 }) : (settings.freeCap ?? { solana: 40, robinhood: 40, eth: 12 }),
};
const CHID = p => C.CH[p.chain].slice(0, 3).toUpperCase() + ':' + p.sym;
const t0 = Date.now();
const say = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
if (learned && (learned.promote?.length || learned.demote?.length)) say(`learned rules: promoted ${learned.promote.join(', ') || 'none'}; switched off ${learned.demote.join(', ') || 'none'}`);
say(`data plan: ${api.plan}, pace ${api.paceMs}ms, up to ${cfg.maxPools} pools, floor $${cfg.minVolume}/24h volume and $${cfg.minLiquidity} liquidity`);

fs.mkdirSync(OUT, { recursive: true });
// Two scheduled slots 30 minutes apart back each other up (GitHub sometimes skips one). If a scan already ran in the last
// scanGapMin minutes (40 by default, because scans now run hourly), the second scheduled run does nothing. Manual runs always scan.
if (process.env.GITHUB_EVENT_NAME === 'schedule' || process.env.RS_SOURCE === 'chain') {
  const lastMeta = readJson(path.join(OUT, 'meta.json'), null), ageMin = lastMeta && lastMeta.scannedAt ? (Date.now() - Date.parse(lastMeta.scannedAt)) / 60000 : Infinity;
  if (ageMin < (settings.scanGapMin ?? 40)) { say(`last scan was ${Math.round(ageMin)} min ago: nothing to do this slot`); process.exit(0); }
}
const prevSignals = readJson(path.join(OUT, 'signals.json'), []).filter(s => s && typeof s === 'object');
const prevSetups = readJson(path.join(OUT, 'setups.json'), []);
const lastMeta = readJson(path.join(OUT, 'meta.json'), null);
const monthKey = new Date().toISOString().slice(0, 7), usage0 = readJson(path.join(OUT, 'usage.json'), {}), usage = usage0.month === monthKey ? usage0 : { month: monthKey, calls: 0, runs: 0 };

// 1. which pools: a full scan discovers them on CoinGecko; an hourly light refresh rebuilds the tracked set from DexScreener (free)
let { mode, why } = pickMode({ env: process.env, meta: lastMeta, trackedCount: prevSetups.length, settings, usage });
say(`scan mode: ${mode} (${why})`);
let list = [], mineList = [];
if (mode === 'light') {
  const r = await poolsFromTracked(prevSetups, prevSignals, api.getJson, cfg); list = r.list; mineList = (lastMeta && lastMeta.mine) || [];
  say(`${list.length} tracked pools rebuilt from DexScreener (${r.fromDex} live, ${r.fromRow} from the saved row)`);
  if (list.length < 3) { say('light refresh found too few coins: running a full scan instead'); mode = 'full'; }
}
if (mode === 'full') {
  ({ list, mineList } = await discoverPools(api.get, cfg, mine.coins || [], m => api.log.push(m)));
  say(`${list.length} pools to scan`);
  if (list.length < 5) { console.error('Pool discovery returned almost nothing; data feed is probably down. Leaving the dashboard untouched.'); process.exit(1); }
}

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
// 3a. DexScreener paid boosts: a coin with an active boost is being promoted, which is not the same as organic demand
try {
  const boosted = new Set();
  for (const u of ['https://api.dexscreener.com/token-boosts/latest/v1', 'https://api.dexscreener.com/token-boosts/top/v1']) { const j = await api.getJson(u).catch(() => null); for (const b of Array.isArray(j) ? j : []) if (b.tokenAddress) boosted.add(String(b.chainId).toLowerCase() + '|' + String(b.tokenAddress).toLowerCase()); }
  const slug = { solana: 'solana', eth: 'ethereum', robinhood: 'robinhood' }; let nb = 0;
  for (const p of rows) if (p.token && boosted.has((slug[p.net] || p.net) + '|' + String(p.token).toLowerCase())) { p.caution = (p.caution ? p.caution + '; ' : '') + 'paid DexScreener boost active (promotion, not organic demand)'; nb++; }
  say(`dexscreener boosts: ${boosted.size} boosted tokens listed, ${nb} among scanned coins`);
} catch (e) { say('boost check skipped: ' + e.message); }
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
// a light scan can track only a few coins, so the minimum scales down with the list
if (scannedN === 0 || scoredN < (scannedN <= 8 ? Math.ceil(scannedN * 0.5) : Math.max(5, scannedN * 0.5))) { console.error(`Only ${scoredN}/${scannedN} pools could be scored (candle fetches failing). Leaving the dashboard untouched.`); process.exit(1); }
// cooldown: a coin that just stopped out is not re-signalled as an entry for cfg.cooldownHours
try { const { applyCooldown } = await import('../docs/overlays.mjs'); if (typeof applyCooldown !== 'function') throw new Error('overlays.mjs is the old version'); const nCool = applyCooldown(rows, prevSignals, settings.cooldownHours ?? 48, C.CH); if (nCool) say(`cooldown: ${nCool} coin(s) held back after a recent stop-out`); } catch (e) { say('cooldown skipped: ' + e.message); }
const kept = rows.filter(p => p.mine || (p.opp != null && p.opp > cfg.minOpp));
const at = new Date().toISOString().slice(0, 19) + 'Z';

// holder data (count, top-10 share, growth we measure ourselves). Cached; new lookups on full scans only. Record-only: never changes a score.
let hsStatus = 'off', hsLooked = 0, hsApplied = 0;
{ const hpath = path.join(OUT, 'holders-cache.json'), hcache = readJson(hpath, {}), now = Date.now();
  try {
    for (const k of Object.keys(hcache)) if (!hcache[k] || typeof hcache[k] !== 'object' || now - hcache[k].at > 15 * 86400e3) delete hcache[k];
    if (settings.holders !== false) {
      const res = await enrichHolders(allRows.filter(p => (p.opp != null && p.opp >= 50) || p.mine), { get: (u) => api.get(u).catch(() => null), netOf: (c) => C.NETOF[c], cfg: settings.holders || {}, cache: hcache, now, fetchNew: mode === 'full', sleep: (ms) => new Promise(r => setTimeout(r, ms)) });
      hsStatus = res.status; hsLooked = res.looked; hsApplied = res.applied; res.notes.forEach(say); say(`holders: ${hsStatus}, ${hsLooked} looked up, ${hsApplied} coins with holder data`);
      fs.writeFileSync(hpath, JSON.stringify(hcache));
    }
  } catch (e) { say('holders skipped: ' + (e.message || e)); hsStatus = 'error'; }
}

// social links from DexScreener (free, presence only). Record-only: never changes a score.
try { if (settings.social !== false) { const r = await enrichSocial(allRows.filter(p => (p.opp != null && p.opp >= 50) || p.mine), { getJson: api.getJson, sleep: api.sleep }); say(`social links: ${r.applied} of ${r.looked} coins checked`); } } catch (e) { say('social skipped: ' + (e.message || e)); }

// 4. signal log: check open signals, add new ones
const market = mode === 'full' ? C.marketRows(allRows) : readJson(path.join(OUT, 'chainvol.json'), []), all0 = market.find(m => m.chain === 'All' && m.daysAgo === 0);
const panelCtx = { learned, volRatio: all0 ? all0.ratio : null, btAvg: readJson(path.join(OUT, 'backtest.json'), {}).overall?.avgR ?? null, slipPct: settings.slipPct ?? 1.5 };
const opinion = (p) => { try { const row = C.toRow(p, at); row.rug = p.rug; row.rugFlags = p.rugFlags; row.regime = p.regime; return debate(planView(row), panelCtx); } catch { return null; } };
const volDay = all0 && all0.ratio != null ? (all0.ratio >= 1.15 ? 'Strong' : all0.ratio >= 0.85 ? 'Normal' : 'Weak') : null;
const evalOpts = { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder, fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 };
const evalOne = async (s) => { const j = await api.get(`/networks/${C.NETOF[String(s.chain).toLowerCase()] || String(s.chain).toLowerCase()}/pools/${s.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`); const raw = j?.data?.attributes?.ohlcv_list; return raw ? C.evaluate(s, raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)), at, evalOpts) : { ...s, checkedAt: at }; };
const log = [];
for (const s of prevSignals) {
  if (s.status === 'open' || s.status === 'waiting for entry') {
    const j = await api.get(`/networks/${C.NETOF[String(s.chain).toLowerCase()] || String(s.chain).toLowerCase()}/pools/${s.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
    const raw = j?.data?.attributes?.ohlcv_list;
    log.push(raw ? C.evaluate(s, raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)), at, { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder, fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 }) : { ...s, checkedAt: at });
  } else log.push(s);
}
for (const p of kept.filter(p => p.signal === 'Entry signal')) {
  const sig = C.newSignal(p, at); sig.volDay = volDay; const op = opinion(p); if (op) sig.panel = { verdict: op.verdict, net: op.net, bull: op.bullScore, bear: op.bearScore };
  if (log.some(s => s.signalId === sig.signalId)) continue;
  if (log.some(s => s.id === sig.id && (s.status === 'open' || s.status === 'waiting for entry'))) continue;
  log.push(sig);
}
log.sort((a, b) => String(b.signalAt || '').localeCompare(String(a.signalAt || '')));

// 4b. forward test of near-miss candidates (opp 40 to the cut-off): logged when they appear, followed with the same rules.
// Full scans only, so the extra candle calls stay small. Failure here never stops the scan.
let fwdN = 0;
let earlyNew = [];
if (mode === 'full') { try {
  const fwd0 = readJson(path.join(OUT, 'forward.json'), []).filter(s => s && typeof s === 'object'), fwd = []; let used = 0;
  for (const s of fwd0) { if ((s.status === 'open' || s.status === 'waiting for entry') && used < MAX_EVAL) { used++; try { fwd.push(await evalOne(s)); } catch { fwd.push(s); } } else fwd.push(s); }
  const fresh = pickCandidates(allRows, fwd, at, (p, t) => { const g = C.newSignal(p, t); g.volDay = volDay; return g; }, cfg.minOpp);
  let shN = 0; try { const sh = shadow.pick(shadow.candidates(allRows, C), fwd, at, (p, t) => { const g = C.newSignal(p, t); g.volDay = volDay; return g; }); fwd.push(...sh); shN = sh.length; } catch (e) { say('shadow tracking skipped: ' + (e.message || e)); }
  let earlyN = 0; try { const ec = early.candidates(allRows, C), ep = early.pick(ec, fwd, at, (p, t) => { const g = C.newSignal(p, t); g.volDay = volDay; return g; }); fwd.push(...ep); earlyN = ep.length; earlyNew = ep; } catch (e) { say('early-1h tracking skipped: ' + (e.message || e)); }
  if (earlyN) say(`early-1h: ${earlyN} early entries logged (${earlyNew.map(x => x.coin).join(', ')})`);
  if (shN) say(`shadow patterns: ${shN} background trades logged (${[...new Set(fwd.filter(x => x.shadow).map(x => x.setup))].join(', ')})`);
  fwd.push(...fresh); const keep = trimFwd(fwd); fs.writeFileSync(path.join(OUT, 'forward.json'), JSON.stringify(keep)); fwdN = fresh.length; say(`forward test: ${fresh.length} new candidates, ${keep.length} tracked`);
} catch (e) { say('forward test skipped: ' + (e.message || e)); } }

// 4c. Degen desk (high-risk paper account): follows volume surges and price action, and checks who is trading (wallet counts, optional watch-list).
// Tracks its own list in degen.json. Paper only: it never changes a score, a gate or the conservative desk.
let degenNew = [];
try {
  const dpath = path.join(OUT, 'degen.json'), smart = loadSmart(readJson), nowIso = at;
  let dl = readJson(dpath, []).filter(x => x && typeof x === 'object'), usedD = 0, usedW = 0; const dout = [];
  for (const s of dl) {
    if ((s.status === 'open' || s.status === 'waiting for entry') && usedD < 12) {
      usedD++; let r = s;
      try { const j = await api.get(`/networks/${s.net || C.NETOF[String(s.chain).toLowerCase()] || String(s.chain).toLowerCase()}/pools/${s.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`); const raw = j?.data?.attributes?.ohlcv_list; if (raw) r = D.evaluateDegen(s, raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)), nowIso); } catch { /* keep the old row */ }
      if (mode === 'full' && r.status === 'open' && usedW < 8) { usedW++; const w = await fetchWallets(api.get, s.net || C.NETOF[String(s.chain).toLowerCase()], s.pool, smart); if (w) { r = { ...r, wallet: w, walletVerdict: D.walletVerdict(w), walletHist: [...(r.walletHist || []), { t: nowIso, b: w.buyers, s: w.sellers, n: w.netUsd }].slice(-24) }; } }
      dout.push(r);
    } else dout.push(s);
  }
  // runner log: every coin the runners list showed or dropped, tracked as a paper trade so the learning step can find which numbers matter
  const rlPath = path.join(OUT, 'runnerlog.json'); let rl = readJson(rlPath, []).filter(x => x && typeof x === 'object'), runnerItems = null, controlItems = [];
  try {
    const openIdx = rl.map((x, i) => [x, i]).filter(([x]) => x.status === 'open' || x.status === 'waiting for entry').sort((a, b) => String(a[0].checkedAt).localeCompare(String(b[0].checkedAt))).slice(0, 30);
    for (const [x, i] of openIdx) { try { const j = await api.get(`/networks/${x.net}/pools/${x.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`); const raw = j?.data?.attributes?.ohlcv_list; if (!raw) continue; const bars = raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)); let r = D.evaluateDegen(x, bars, nowIso); if (r.status !== 'open' && r.status !== 'waiting for entry') r = { ...r, variants: D.exitVariants(x, bars, nowIso) }; rl[i] = r; } catch { /* keep */ } }
  } catch (e) { say('runner log evaluation skipped: ' + (e.message || e)); }
  if (mode === 'full' && settings.degen !== false) {
    const cands = D.candidates(allRows).slice(0, 8), rc = D.runnerCandidates(allRows, 20), wallets = new Map(); let wn = 0; const want = [];
    for (const c of [...cands.slice(0, 4), ...rc, ...cands.slice(4)]) if (!want.some(x => x.p.pool === c.p.pool)) want.push(c);
    const whPath = path.join(OUT, 'wallethist.json'), wh = readJson(whPath, {}), trends = new Map();
    for (const c of want) { if (wn >= 14) break; wn++; const w = await fetchWallets(api.get, c.p.net, c.p.pool, smart); if (w) { wallets.set(c.p.pool, w); const tr = D.walletTrend(wh[c.p.pool], w, nowIso); if (tr) trends.set(c.p.pool, tr); wh[c.p.pool] = [...(wh[c.p.pool] || []), { t: nowIso, b: w.buyers, s: w.sellers, n: w.netUsd }].slice(-24); } }
    try { const keep = Object.entries(wh).filter(([, a]) => a.length && Date.now() - Date.parse(a[a.length - 1].t) < 48 * 3600e3).slice(-200); fs.writeFileSync(whPath, JSON.stringify(Object.fromEntries(keep))); } catch { /* optional */ }
    try { const paperIds = new Set(dout.filter(x => x.status === 'open' || x.status === 'waiting for entry').map(x => x.id)); const items = D.buildRunners(rc, wallets, paperIds, trends); runnerItems = items; try { const skip = new Set(D.runnerCandidates(allRows, 100000).map(x => x.p.pool)); controlItems = D.buildRunners(D.controlSample(allRows, skip, 6, Date.parse(nowIso) / 36e5 | 0)); } catch { controlItems = []; } fs.writeFileSync(path.join(OUT, 'runners.json'), JSON.stringify({ at: nowIso, items })); say(`runners: ${items.length} high-risk high-reward coins listed${items[0] ? ' (top: ' + items[0].coin + ' ' + items[0].score + ')' : ''}`); } catch (e) { say('runners skipped: ' + (e.message || e)); }
    degenNew = D.pickNew(cands, dout, nowIso, wallets); dout.push(...degenNew);
    say(`degen desk: ${cands.length} runners met the volume and price rules, ${degenNew.length} new paper trades${degenNew.length ? ' (' + degenNew.map(x => x.coin).join(', ') + ')' : ''}`);
  }
  try {
    if (runnerItems) { const have = new Set(rl.map(x => x.signalId)); let nn = 0; for (const it of runnerItems) { const sg = D.runnerSignal(it, nowIso); if (have.has(sg.signalId) || nn >= 20) continue; rl.push(sg); have.add(sg.signalId); nn++; } let nc = 0; for (const it of controlItems) { const sg = D.runnerSignal(it, nowIso, undefined, { control: true }); if (have.has(sg.signalId)) continue; rl.push(sg); have.add(sg.signalId); nc++; } if (nc) say(`runner log: ${nc} random control coins added for comparison`); if (nn) say(`runner log: ${nn} runners added (${runnerItems.filter(x => x.vetoed.length).length} dropped by the risk rules, still tracked)`); }
    const isOpen = x => x.status === 'open' || x.status === 'waiting for entry'; fs.writeFileSync(rlPath, JSON.stringify([...rl.filter(x => !isOpen(x)).slice(-1500), ...rl.filter(isOpen)]));
  } catch (e) { say('runner log skipped: ' + (e.message || e)); }
  const closedKeep = dout.filter(x => !(x.status === 'open' || x.status === 'waiting for entry')).slice(-300), openKeep = dout.filter(x => x.status === 'open' || x.status === 'waiting for entry');
  fs.writeFileSync(dpath, JSON.stringify([...closedKeep, ...openKeep]));
} catch (e) { say('degen desk skipped: ' + (e.message || e)); }

// 5. export
const out = kept.map(p => { const r = C.toRow(p, at); if (p.rug) r.rug = p.rug; if (p.rugFlags) r.rugFlags = p.rugFlags; if (p.regime) r.regime = p.regime; if (p.hs) r.hs = p.hs; if (p.soc) r.soc = p.soc; if (p.zoneOrder && p.lead !== 'pattern') r.zoneOrder = 1; return r; });
const charts = kept.filter(C.chartWorthy).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (b.opp ?? 0) - (a.opp ?? 0)).slice(0, 32).map(C.toChart);
const meta = { scannedAt: at, mode, fullAt: mode === 'full' ? at : (lastMeta && lastMeta.fullAt) || at, refreshedN: scannedN, scannedN: mode === 'full' ? scannedN : (lastMeta && lastMeta.scannedN) || scannedN, scoredN: mode === 'full' ? scoredN : (lastMeta && lastMeta.scoredN) || scoredN, kept: out.length, minOpp: cfg.minOpp, seconds: Math.round((Date.now() - t0) / 1000), plan: api.plan, mine: mineList, regime, excluded, safetyOn: cfg.safetyChecks, regimeFilter: cfg.regimeFilter, hs: hsStatus, hsLooked, hsApplied };
try { meta.funnel = funnel(allRows, { minVolume: cfg.minVolume ?? settings.minVolume, minLiquidity: cfg.minLiquidity ?? settings.minLiquidity, maxPools: cfg.maxPools ?? settings.maxPools }); } catch (e) { say('gate funnel skipped: ' + (e.message || e)); }
const w = (f, d) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(d));
try { if (meta.funnel) { const fh = path.join(OUT, 'funnel-history.json'); fs.writeFileSync(fh, JSON.stringify(funnelAppend(readJson(fh, []), funnelCompact(meta.funnel, at), Date.now(), 14))); } } catch (e) { say('funnel history skipped: ' + (e.message || e)); }
if (cfg.safetyChecks) fs.writeFileSync(cachePath, JSON.stringify(cache));
w('setups.json', out); w('signals.json', log); w('charts.json', charts); if (mode === 'full') w('chainvol.json', market); w('meta.json', meta);
say(`wrote ${out.length} coins, ${charts.length} charts, ${log.length} logged signals`);

// 6. what changed since the last scan
const prevById = new Map(prevSetups.map(r => [r.id, r]));
const prevSigById = new Map(prevSignals.map(s => [s.signalId, s]));
const lines = [];
const all = market.find(m => m.chain === 'All' && m.daysAgo === 0);
const vr = all?.ratio, vlabel = vr == null ? 'n/a' : vr >= 1.15 ? 'Strong' : vr >= 0.85 ? 'Normal' : vr >= 0.6 ? 'Below normal' : 'Poor';
const brisbane = new Date(Date.now() + 10 * 3600e3).toISOString().slice(11, 16);
lines.push(`${mode === 'light' ? 'Hourly refresh' : 'Full scan'} ${brisbane} Brisbane: ${scannedN} ${mode === 'light' ? 'tracked coins refreshed' : 'scanned'}, ${scoredN} scored, ${out.length} above ${cfg.minOpp}. On-chain volume ${vlabel}${vr != null ? ` (${vr}x 7-day avg)` : ''}.`);
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
// a zone-order call (six quality gates, price above the zone) can be up to 8% above it: you rest a limit order rather than chase
const stillInZone = r => r.price != null && r.entryHigh != null && r.stop != null && r.price <= r.entryHigh * (r.zoneOrder ? 1.08 : 1.01) && r.price > r.stop;
const site = process.env.GITHUB_REPOSITORY ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0]}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '';
const h4close = (() => { const n = (Math.floor(Date.now() / 14400e3) + 1) * 14400e3; return new Date(n + 10 * 3600e3).toISOString().slice(11, 16); })();
const winTxt = ' Fill window 48h; the next 4h candle closes ' + h4close + ' Brisbane, so a signal can change until then.';
const maxPos = r => r.liquidity ? ` Max size about $${Math.round(r.liquidity * 0.01 / 10) * 10 || 10} (1% of liquidity).` : '';
const regTxt = r => r.regime === 'Risk-off' ? ' Market is risk-off, so size down.' : '';
const hitEvents = logChanges.filter(s => /TP|stopped|hit/.test(s.status) || (s.tpHit || 0) > (prevSigById.get(s.signalId)?.tpHit || 0));
const alertEntry = newEntry.filter(r => stillInZone(r) && fresh('E|' + r.id));
const alertHot = newWatch.filter(r => r.opp >= 75 && stillInZone(r) && fresh('W|' + r.id));
const alertHits = hitEvents.filter(s => fresh(`H|${s.signalId}|${s.status}|${s.tpHit}`));
if (topic && (alertEntry.length || alertHot.length || alertHits.length)) {
  const a = alertEntry[0], h = alertHot[0], pa = a ? opinion(kept.find(p => CHID(p) === a.id)) : h ? opinion(kept.find(p => CHID(p) === h.id)) : null, paTxt = pa ? ` Panel: ${pa.verdict} (bull ${pa.bullScore} vs bear ${pa.bearScore}). ${pa.why}` : '';
  const head = a ? `New bid-ready: ${a.coin} (${a.chain}), opp ${a.opp}. Buy ${a.entryLow}-${a.entryHigh}, stop ${a.stop} (${a.riskPct}% away).${maxPos(a)}${a.zoneOrder && a.price > a.entryHigh ? ` Price is ${((a.price / a.entryHigh - 1) * 100).toFixed(1)}% above the zone: rest a limit order at ${a.entryHigh}, do not chase.` : ''}${regTxt(a)}${paTxt}${winTxt}`
    : alertHits.length ? `Signal update: ${alertHits[0].coin} ${alertHits[0].status}`
    : `New watch: ${h.coin} (${h.chain}), opp ${h.opp}, entry ${h.entryLow}-${h.entryHigh}, stop ${h.stop}.${maxPos(h)}${regTxt(h)}${paTxt}${winTxt}`;
  try {
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: head + '\n\n' + text, headers: { Title: a ? `Bid-ready: ${a.coin}` : alertHits.length ? 'RynoScan signal update' : `Watch: ${h.coin}`, Priority: alertEntry.length ? 'high' : alertHits.length ? 'default' : 'low', Tags: alertEntry.length ? 'rotating_light,rhinoceros' : 'rhinoceros', ...(site ? { Click: site } : {}) } });
    say('alert sent: ' + r.status);
    if (r.ok) { const now = new Date().toISOString(); alertEntry.forEach(r => sent['E|' + r.id] = now); alertHot.forEach(r => sent['W|' + r.id] = now); alertHits.forEach(s => sent[`H|${s.signalId}|${s.status}|${s.tpHit}`] = now); }
  } catch (e) { say('alert failed: ' + e.message); }
} else if (topic) say('no alert: nothing new that is still inside its entry zone');

// one-gate-away alert: a coin that is exactly one gate from bid-ready, so you can rest a limit order ahead of time (low priority, once a day per coin and gate)
if (topic && !alertEntry.length && !alertHot.length) { try {
  const sg = x => (x == null ? '' : String(Number(Number(x).toPrecision(5))));
  const near = oneAway(allRows, { minOpp: 70, max: 2 }).filter(n => n.p.sp && fresh('N|' + CHID(n.p) + '|' + n.gate));
  if (near.length) {
    const body = near.map(n => `${n.p.sym} (${C.CH[n.p.chain]}) ${n.p.setupType}, opp ${n.p.opp}: one gate from bid-ready, waiting on ${n.label}. Entry ${sg(n.p.sp.entryLow)}-${sg(n.p.sp.entryHigh)}, stop ${sg(n.p.sp.stop)}. A limit order at ${sg(n.p.sp.entryHigh)} gets you in early.`).join('\n');
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: body + '\n\nOne gate away is not bid-ready: the rules still want every gate.', headers: { Title: `Close: ${near[0].p.sym} is one gate away`, Priority: 'low', Tags: 'rhinoceros,eyes', ...(site ? { Click: site } : {}) } });
    say('one-gate-away alert sent: ' + r.status); if (r.ok) { const now = new Date().toISOString(); near.forEach(n => sent['N|' + CHID(n.p) + '|' + n.gate] = now); }
  }
} catch (e) { say('one-gate-away alert skipped: ' + (e.message || e)); } }

// early-1h alert: unconfirmed, tracked experiment. Low priority, capped, once per coin per day. Turn off with "earlyAlert": false in config/settings.json.
if (topic && settings.earlyAlert !== false && earlyNew.length) { try {
  const sg = x => (x == null ? '' : String(Number(Number(x).toPrecision(5))));
  const ne = earlyNew.filter(x => fresh('E|' + x.signalId)).slice(0, 3);
  if (ne.length) {
    const body = ne.map(x => `${x.coin} (${x.chain}) ${String(x.setup).replace(' [early 1h]', '')}, opp ${x.opp}: every gate passes on the still-forming 4h candle. Entry ${sg(x.entryLow)}-${sg(x.entryHigh)}, stop ${sg(x.stop)}, TP1 ${sg(x.tp1)}.`).join('\n');
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: body + '\n\nEARLY, not confirmed: the 4h candle has not closed and it can still fail. Tracked as an experiment to test whether waiting costs entries.', headers: { Title: `Early: ${ne[0].coin} (4h candle still open)`, Priority: 'low', Tags: 'rhinoceros,hourglass_flowing_sand', ...(site ? { Click: site } : {}) } });
    say('early-1h alert sent: ' + r.status); if (r.ok) { const now = new Date().toISOString(); ne.forEach(x => sent['E|' + x.signalId] = now); }
  }
} catch (e) { say('early-1h alert skipped: ' + (e.message || e)); } }

// degen alert: paper trade only. Low priority, once per coin per day, max 2 per scan. Turn off with "degenAlert": false in config/settings.json.
if (topic && settings.degenAlert !== false && degenNew.length) { try {
  const sg = x => (x == null ? '' : String(Number(Number(x).toPrecision(5))));
  const nd = degenNew.filter(x => fresh('D|' + x.id)).slice(0, 2);
  if (nd.length) {
    const body = nd.map(x => `${x.coin} (${x.chain}): ${x.why.join(', ')}. ${x.walletVerdict}${x.wallet ? ` (${x.wallet.buyers} buyers vs ${x.wallet.sellers} sellers)` : ''}. Paper entry ~${sg(x.entryMid)}, stop ${sg(x.stop)}, half off at ${sg(x.tp1)}.`).join('\n');
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: body + '\n\nDEGEN paper trade: high risk, not a bid-ready call.', headers: { Title: `Degen runner: ${nd[0].coin}`, Priority: 'low', Tags: 'rhinoceros,fire', ...(site ? { Click: site } : {}) } });
    say('degen alert sent: ' + r.status); if (r.ok) { const now = new Date().toISOString(); nd.forEach(x => sent['D|' + x.id] = now); }
  }
} catch (e) { say('degen alert skipped: ' + (e.message || e)); } }

// safeguard 2: daily check-in (proves the scanner is alive) and a bid-ready digest at most every 6 hours, so a missed alert never hides a chart
if (topic) { try {
  const dd = digestDue({ now: Date.now(), bidCount: out.filter(r => r.signal === 'Entry signal').length, sent });
  const kind = dd.bid && !alertEntry.length ? 'bid' : dd.checkin ? 'checkin' : null, key = kind === 'bid' ? dd.bid : dd.checkin;
  if (kind) {
    let paper = null; try { paper = simulate(log, { start: 10000, pct: 5, since: readJson('docs/paper-config.json', {}).since }); } catch { /* optional */ }
    const m = digestCompose({ kind, rows: out, meta, paper, site, now: Date.now() });
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: m.body, headers: { Title: m.title, Priority: m.priority, Tags: 'rhinoceros', ...(site ? { Click: site } : {}) } });
    say(`${kind} digest sent: ${r.status}`); if (r.ok) { sent[key] = new Date().toISOString(); if (kind === 'bid' && dd.checkin) sent[dd.checkin] = sent[key]; }
  }
} catch (e) { say('digest skipped: ' + (e.message || e)); } }
fs.writeFileSync(alertsPath, JSON.stringify(sent));
const st = api.stats();
usage.calls += st.calls; usage.runs += 1; usage.last = { at, mode, calls: st.calls }; fs.writeFileSync(path.join(OUT, 'usage.json'), JSON.stringify(usage));
say(`done. ${mode} scan; CoinGecko calls this month: ${usage.calls} of ${settings.cgMonthlyLimit ?? 100000}. ${st.calls} data calls, ${st.n429} rate-limit hits, ${st.nErr} errors`);
