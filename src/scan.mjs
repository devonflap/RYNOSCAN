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
import * as L from '../docs/strategies.mjs';
import { scoreV2, rowToSig } from '../docs/features.mjs';
import * as SCO from './scorecard.mjs';
import { runExit, PROFILES, statsBook, fromRun, flowCutEvent, missStep } from '../docs/exits.mjs';
import { evidence } from '../docs/evidence.mjs';
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
  freshTrending: settings.freshTrending !== false, freshExtra: settings.freshExtra ?? 12,
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
const barsMap = new Map(), H1 = new Map(), M5 = new Map(); // H1/M5: candles fetched this run, shared by every step below so one pool is fetched once
let done = 0;
for (const p of list) {
  const j = await api.get(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list;
  if (!raw) api.log.push('nofetch ' + p.sym); else { try { H1.set(String(p.pool).toLowerCase(), raw.slice().sort((x, y) => x[0] - y[0]).map(q => q.map(Number))); } catch { /* optional */ } C.techFromRaw(p, raw); try { barsMap.set(p.pool, raw.slice().sort((x, y) => x[0] - y[0]).slice(-72).map(q => q.slice(0, 5).map(Number))); } catch { /* chart is optional */ } }
  if (++done % 20 === 0) say(`${done}/${list.length} pools`);
}

async function hourBars(net, pool) { const k = String(pool).toLowerCase(); if (H1.has(k)) return H1.get(k); const j = await api.get(`/networks/${net}/pools/${pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`); const raw = j?.data?.attributes?.ohlcv_list; const b = Array.isArray(raw) && raw.length ? raw.slice().sort((x, y) => x[0] - y[0]).map(q => q.map(Number)) : null; if (b) H1.set(k, b); return b; }
async function m5Bars(net, pool) { const k = String(pool).toLowerCase(); if (M5.has(k)) return M5.get(k); const j = await api.get(`/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=5&limit=300&currency=usd&token=base`); const raw = j?.data?.attributes?.ohlcv_list; const b = Array.isArray(raw) && raw.length ? raw.slice().sort((x, y) => x[0] - y[0]).map(q => q.map(Number)) : null; M5.set(k, b); return b; }
const netOf = (s) => s.net || C.NETOF[String(s.chain).toLowerCase()] || String(s.chain).toLowerCase();

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
// DexScreener readings at the moment of the call (last-hour volume pace, last-hour buyers vs sellers) and whether the 15-minute early-move
// checker flagged the coin in the 6 hours before. Record-only: they never change a score; the learning loop tests whether they matter.
const pulseSeen = (() => { const wj = readJson(path.join(OUT, 'watch.json'), {}), m = new Map(); for (const h of (wj.pulse && Array.isArray(wj.pulse.recent) ? wj.pulse.recent : [])) { const t = h && h.pool ? Date.parse(h.at) : NaN; if (isFinite(t) && !(m.get(h.pool) > t)) m.set(h.pool, t); } return { m, live: !!(wj.pulse && wj.pulse.at && Date.now() - Date.parse(wj.pulse.at) < 3 * 3600e3) }; })();
const pulseAgo = (pool) => { const t = pulseSeen.m.get(pool); return t != null && Date.now() - t >= 0 && Date.now() - t < 6 * 3600e3 ? +((Date.now() - t) / 3600e3).toFixed(1) : null; };
const tagSig = (g, p) => { g.volDay = volDay; if (p && p.dsx) { g.acc1 = p.dsx.acc1; g.br1 = p.dsx.br1; } if (p && p.hs && p.hs.top10Pct != null) g.top10 = p.hs.top10Pct; { const bs = L.buyerSpike(p); if (bs != null) g.bspk = bs; const o2 = scoreV2(g); if (o2 != null) g.opp2 = o2; } if (pulseSeen.live && p) g.pulse = pulseAgo(p.pool) != null; return g; };
const mktTag = { sol: regime && regime.sol ? regime.sol.level : null, vol: volDay ?? null }; // market at entry, stored on every paper trade so results can be split by market
const evalOpts = { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder, fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 };
const evalOne = async (s) => { const b = await hourBars(netOf(s), s.pool); return b ? C.evaluate(s, b, at, evalOpts) : { ...s, checkedAt: at }; };
const log = [];
for (const s of prevSignals) {
  if (s.status === 'open' || s.status === 'waiting for entry') {
    const b = await hourBars(netOf(s), s.pool);
    log.push(b ? C.evaluate(s, b, at, evalOpts) : { ...s, checkedAt: at });
  } else log.push(s);
}
for (const p of kept.filter(p => p.signal === 'Entry signal')) {
  const sig = tagSig(C.newSignal(p, at), p); const op = opinion(p); if (op) sig.panel = { verdict: op.verdict, net: op.net, bull: op.bullScore, bear: op.bearScore };
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
  const fresh = pickCandidates(allRows, fwd, at, (p, t) => tagSig(C.newSignal(p, t), p), cfg.minOpp);
  let shN = 0; try { const sh = shadow.pick(shadow.candidates(allRows, C), fwd, at, (p, t) => tagSig(C.newSignal(p, t), p)); fwd.push(...sh); shN = sh.length; } catch (e) { say('shadow tracking skipped: ' + (e.message || e)); }
  let earlyN = 0; try { const ec = early.candidates(allRows, C), ep = early.pick(ec, fwd, at, (p, t) => tagSig(C.newSignal(p, t), p)); fwd.push(...ep); earlyN = ep.length; earlyNew = ep; } catch (e) { say('early-1h tracking skipped: ' + (e.message || e)); }
  if (earlyN) say(`early-1h: ${earlyN} early entries logged (${earlyNew.map(x => x.coin).join(', ')})`);
  if (shN) say(`shadow patterns: ${shN} background trades logged (${[...new Set(fwd.filter(x => x.shadow).map(x => x.setup))].join(', ')})`);
  fwd.push(...fresh); const keep = trimFwd(fwd); fs.writeFileSync(path.join(OUT, 'forward.json'), JSON.stringify(keep)); fwdN = fresh.length; say(`forward test: ${fresh.length} new candidates, ${keep.length} tracked`);
} catch (e) { say('forward test skipped: ' + (e.message || e)); } }

// Dead pools: a trade whose pool stops giving fresh candles (rugged, delisted, migrated) used to stay open forever (blocking the queue
// that picks which rows to re-check) or drop out of the results after 48 hours (which flattered every book). Now every miss is counted,
// but only while the data feed itself is working; after MISS_MAX misses in a row an entered trade is closed by deadExit (half the last price).
const MISS_MAX = 6, feedOk = () => { const s = api.stats(); return s.calls < 10 || s.nErr / s.calls < 0.3; };
const freshBars = (b, barSec = 3600) => Array.isArray(b) && b.length > 0 && Date.now() / 1000 - +b[b.length - 1][0] < (barSec === 300 ? 2 : 6) * 3600;
const onMiss = (x, nowI) => missStep(x, nowI, { feedOk: feedOk(), maxMiss: MISS_MAX });
let deadN = 0;

// 4c. Degen desk (high-risk paper account): follows volume surges and price action, and checks who is trading (wallet counts, optional watch-list).
// Tracks its own list in degen.json. Paper only: it never changes a score, a gate or the conservative desk.
let degenNew = [];
try {
  const dpath = path.join(OUT, 'degen.json'), smartCfg = loadSmart(readJson), nowIso = at;
  // wallet scorecard: wallets that keep buying coins before they run become "proven" and count as smart wallets everywhere below
  const wsPath = path.join(OUT, 'wallets.json'); let wEps = SCO.trim(readJson(wsPath, []).filter(x => x && typeof x === 'object' && x.id)), sc = SCO.score(wEps), earlyItems = [], wsDirty = false;
  const smart = [...smartCfg, ...sc.proven.map(r => ({ address: r.w, label: `proven ${r.wins}/${r.n}` }))];
  const noteEp = (p, w) => { if (w && w.netBuyers) { SCO.record(wEps, { pool: p.pool, net: p.net, coin: p.sym || p.coin, chain: p.chain, px: p.price, t: nowIso, buyers: w.netBuyers, sellers: w.netSellers }); wsDirty = true; } };
  let dl = readJson(dpath, []).filter(x => x && typeof x === 'object'), usedD = 0, usedW = 0; const dout = [];
  const dueD = new Set(dl.map((s, i) => [s, i]).filter(([s]) => s.status === 'open' || s.status === 'waiting for entry').sort((a, b) => String(a[0].checkedAt).localeCompare(String(b[0].checkedAt))).slice(0, 12).map(([, i]) => i)); // least recently checked first, so a dead pool cannot hog the slots
  for (const [di, s] of dl.entries()) {
    if (dueD.has(di)) {
      usedD++; let r = s, b = null;
      try { b = await hourBars(netOf(s), s.pool); } catch { /* counted as a miss */ }
      if (b) r = D.evaluateDegen(s, b, nowIso); if (freshBars(b)) r = { ...r, miss: 0 }; else if (r.status === 'open' || r.status === 'waiting for entry') { r = onMiss(r, nowIso); if (r.dead) deadN++; }
      if (mode === 'full' && r.status === 'open' && usedW < 8) { usedW++; const w = await fetchWallets(api.get, s.net || C.NETOF[String(s.chain).toLowerCase()], s.pool, smart); if (w) { r = { ...r, wallet: w, walletVerdict: D.walletVerdict(w), walletHist: [...(r.walletHist || []), { t: nowIso, b: w.buyers, s: w.sellers, n: w.netUsd, p: r.lastPx ?? null }].slice(-24) }; } }
      dout.push(r);
    } else dout.push(s);
  }
  // runner log: every coin the runners list showed or dropped, tracked as a paper trade so the learning step can find which numbers matter
  const rlPath = path.join(OUT, 'runnerlog.json'); let rl = readJson(rlPath, []).filter(x => x && typeof x === 'object'), runnerItems = null, controlItems = [];
  try {
    const vDue = (x) => Date.parse(x.signalAt) + (L.EXIT_SET_HOURS + 2) * 3600e3 <= Date.now(), rlOpen = (x) => x.status === 'open' || x.status === 'waiting for entry'; // exit comparison waits until the longest rule (7 days) has played out, so no rule is judged early
    const openIdx = rl.map((x, i) => [x, i]).filter(([x]) => rlOpen(x) || (!x.variants && x.retPct != null && vDue(x))).sort((a, b) => String(a[0].checkedAt).localeCompare(String(b[0].checkedAt))).slice(0, 30);
    for (const [x, i] of openIdx) { try { let bars = null; try { bars = await hourBars(netOf(x), x.pool); } catch { /* miss */ } if (!bars) { if (rlOpen(x)) { rl[i] = onMiss(x, nowIso); if (rl[i].dead) deadN++; } continue; } let r = rlOpen(x) ? D.evaluateDegen(x, bars, nowIso) : x; if (!rlOpen(r) && !r.variants && vDue(r)) r = { ...r, variants: D.exitVariants(x, bars, nowIso) }; if (rlOpen(r)) { if (freshBars(bars)) r = { ...r, miss: 0 }; else { r = onMiss(r, nowIso); if (r.dead) deadN++; } } rl[i] = r; } catch { /* keep */ } }
  } catch (e) { say('runner log evaluation skipped: ' + (e.message || e)); }
  if (mode === 'full' && settings.degen !== false) {
    const cands = D.candidates(allRows).slice(0, 8), rc = D.runnerCandidates(allRows, 20), wallets = new Map(); let wn = 0; const want = [];
    for (const c of [...cands.slice(0, 4), ...rc, ...cands.slice(4)]) if (!want.some(x => x.p.pool === c.p.pool)) want.push(c);
    const whPath = path.join(OUT, 'wallethist.json'), wh = readJson(whPath, {}), trends = new Map();
    for (const c of want) { if (wn >= 14) break; wn++; const w = await fetchWallets(api.get, c.p.net, c.p.pool, smart); if (w) { wallets.set(c.p.pool, w); noteEp(c.p, w); const tr = D.walletTrend(wh[c.p.pool], w, nowIso); if (tr) trends.set(c.p.pool, tr); wh[c.p.pool] = [...(wh[c.p.pool] || []), { t: nowIso, b: w.buyers, s: w.sellers, n: w.netUsd }].slice(-24); } }
    try { const keep = Object.entries(wh).filter(([, a]) => a.length && Date.now() - Date.parse(a[a.length - 1].t) < 48 * 3600e3).slice(-200); fs.writeFileSync(whPath, JSON.stringify(Object.fromEntries(keep))); } catch { /* optional */ }
    // early movers: coins trending in the last 1h/6h that the runner rules have not picked up; read their buyers too (feeds the scorecard and the early list)
    try { if (usage.calls <= 0.85 * (settings.cgMonthlyLimit ?? 100000)) { const ex = allRows.filter(p => p.fresh && !wallets.has(p.pool) && (p.liq || 0) >= 50000 && (p.v24 || 0) >= 150000 && p.rug !== 'danger' && p.price > 0).sort((a, b) => (b.vacc || 0) - (a.vacc || 0)).slice(0, 8);
      for (const p of ex) { const w = await fetchWallets(api.get, p.net, p.pool, smart); if (!w) continue; wallets.set(p.pool, w); noteEp(p, w); const pi = SCO.provenIn(w, sc);
        earlyItems.push({ id: String(p.chain).slice(0, 3).toUpperCase() + ':' + p.sym, coin: p.sym, chain: C.CH[p.chain] || p.chain, pool: p.pool, net: p.net, price: p.price, liq: Math.round(p.liq || 0), v24: Math.round(p.v24 || 0), ch24: p.ch24, vacc: p.vacc, ageD: p.ageD, phase: L.lifecycle(p), provenIn: pi.in, provenOut: pi.out, buyers: w.buyers, sellers: w.sellers, veto: D.runnerVeto(p, w) }); }
      earlyItems.sort((a, b) => b.provenIn - a.provenIn || (b.vacc || 0) - (a.vacc || 0)); } } catch (e) { say('early movers skipped: ' + (e.message || e)); }
    try { const paperIds = new Set(dout.filter(x => x.status === 'open' || x.status === 'waiting for entry').map(x => x.id)); const items = D.buildRunners(rc, wallets, paperIds, trends); runnerItems = items; const rowOf = new Map(allRows.map(p => [p.pool, p])); for (const it of items) { it.bars = barsMap.get(it.pool) || null; const p = rowOf.get(it.pool); it.phase = p ? L.lifecycle(p) : null; it.fresh = !!(p && p.fresh); it.proven = SCO.provenIn(wallets.get(it.pool), sc); } try { const skip = new Set(D.runnerCandidates(allRows, 100000).map(x => x.p.pool)); controlItems = D.buildRunners(D.controlSample(allRows, skip, 6, Date.parse(nowIso) / 36e5 | 0)); } catch { controlItems = []; } fs.writeFileSync(path.join(OUT, 'runners.json'), JSON.stringify({ at: nowIso, items, early: earlyItems })); say(`runners: ${items.length} high-risk high-reward coins listed${items[0] ? ' (top: ' + items[0].coin + ' ' + items[0].score + ')' : ''}`); } catch (e) { say('runners skipped: ' + (e.message || e)); }
    degenNew = D.pickNew(cands, dout, nowIso, wallets); degenNew.forEach(x => { x.mkt = mktTag; }); dout.push(...degenNew);
    say(`degen desk: ${cands.length} runners met the volume and price rules, ${degenNew.length} new paper trades${degenNew.length ? ' (' + degenNew.map(x => x.coin).join(', ') + ')' : ''}`);
  }
  try {
    if (runnerItems) { const have = new Set(rl.map(x => x.signalId)); let nn = 0; for (const it of runnerItems) { const sg = D.runnerSignal(it, nowIso); if (have.has(sg.signalId) || nn >= 20) continue; rl.push(sg); have.add(sg.signalId); nn++; } let nc = 0; for (const it of controlItems) { const sg = D.runnerSignal(it, nowIso, undefined, { control: true }); if (have.has(sg.signalId)) continue; rl.push(sg); have.add(sg.signalId); nc++; } if (nc) say(`runner log: ${nc} random control coins added for comparison`); if (nn) say(`runner log: ${nn} runners added (${runnerItems.filter(x => x.vetoed.length).length} dropped by the risk rules, still tracked)`); }
    const isOpen = x => x.status === 'open' || x.status === 'waiting for entry'; fs.writeFileSync(rlPath, JSON.stringify([...rl.filter(x => !isOpen(x)).slice(-1500), ...rl.filter(isOpen)]));
  } catch (e) { say('runner log skipped: ' + (e.message || e)); }
  const topic0 = (process.env.NTFY_TOPIC || '').trim();
  // 4d. Strategy lab: more paper books. The degen desk's own coins replayed with other exits, careful rules on risky coins, and two scalpers.
  try {
    const labPath = path.join(OUT, 'lab.json'), since = readJson(path.resolve('docs/paper-config.json'), {}).since || null, sinceT = since ? Date.parse(since) : 0, isOpenL = (x) => x.status === 'open' || x.status === 'waiting for entry';
    let lab = readJson(labPath, []).filter(x => x && typeof x === 'object' && x.lid && L.BOOKS[x.book]); const have = new Set(lab.map(x => x.lid)), nAdd = { copies: 0, risky: 0, scalp: 0 };
    const newRows = []; const add = (row) => { if (have.has(row.lid)) return false; newRows.push(row); if (!row.mkt && Date.now() - Date.parse(row.signalAt) < 3 * 3600e3) row.mkt = mktTag; lab.push(row); have.add(row.lid); return true; };
    for (const s of dout) { if (!(Date.parse(s.signalAt) >= sinceT)) continue; for (const b of L.DEGEN_COPIES) if (add(L.labRow(b, s, s.signalAt, { why: s.why, liq: s.liq, mkt: s.mkt || null }))) nAdd.copies++; }
    for (const r of rl) { if (r.control || !r.listed || (r.passed ?? 0) < 3 || !(Date.parse(r.signalAt) >= sinceT)) continue; for (const bk of ['risky', 'riskyRyan', 'riskyPick']) if (add(L.labRow(bk, r, r.signalAt, { liq: r.liq ?? (r.f && r.f.liq), passed: r.passed }))) nAdd.risky++; }
    const limit = settings.cgMonthlyLimit ?? 100000, rowByPool = new Map(allRows.map(p => [p.pool, p])), chainName = (c) => C.CH[c] || c, nowS = Date.now() / 1000;
    const openOf = (bk) => lab.filter(x => x.book === bk && isOpenL(x)), recentCoin = (bk, pool, h) => lab.some(x => x.book === bk && x.pool === pool && (isOpenL(x) || Date.now() - Date.parse(x.signalAt) < h * 3600e3));
    const srcOf = (p) => ({ id: String(p.chain).slice(0, 3).toUpperCase() + ':' + p.sym, coin: p.sym, chain: chainName(p.chain), pool: p.pool, net: p.net, price: p.price, liq: p.liq });
    // playbook: first Fib pullback after a run to a new high (hourly candles already fetched this run)
    { const dAt = new Date().toISOString().slice(0, 19) + 'Z'; let k = 0;
      for (const p of allRows) { if (k >= L.BOOKS.fibPull.maxNew || openOf('fibPull').length >= L.BOOKS.fibPull.slots) break; if (!(p.price > 0) || p.rug === 'danger' || (p.liq || 0) < 50000 || (p.v24 || 0) < 250000 || D.runnerVeto(p, null).length) continue;
        const f = L.fibSetup(H1.get(String(p.pool).toLowerCase()), nowS); if (!f || recentCoin('fibPull', p.pool, 24)) continue;
        const r = L.labRow('fibPull', { ...srcOf(p), signalId: p.pool + '@' + f.hiAt }, dAt, { why: f.why, plan: { limit: f.limit, stop: f.stop, targets: f.targets, expireH: f.expireH, cancelAbove: f.cancelAbove, cancelWhy: f.cancelWhy }, phase: L.lifecycle(p), fresh: !!p.fresh });
        if (add(r)) { nAdd.fib = (nAdd.fib || 0) + 1; k++; } } }
    // playbook: buy inside forming patterns (4h), not the breakout
    { const dAt = new Date().toISOString().slice(0, 19) + 'Z'; let k = 0;
      for (const p of allRows) { if (k >= L.BOOKS.patInside.maxNew || openOf('patInside').length >= L.BOOKS.patInside.slots) break; if (!(p.price > 0) || p.rug === 'danger' || (p.liq || 0) < 50000 || D.runnerVeto(p, null).length || recentCoin('patInside', p.pool, 48)) continue;
        const s0 = L.insideSetup(p)[0]; if (!s0) continue;
        if (add(L.labRow('patInside', { ...srcOf(p), signalId: p.pool + '|' + s0.name + '@' + dAt.slice(0, 13) }, dAt, { why: s0.why, plan: s0.plan, pattern: s0.name, phase: L.lifecycle(p), fresh: !!p.fresh }))) { nAdd.inside = (nAdd.inside || 0) + 1; k++; } } }
    // early pulse: hits from the 15-minute checker (saved by the entry watcher in watch.json) become paper trades
    { const wj = readJson(path.join(OUT, 'watch.json'), {}), rec = wj && wj.pulse && Array.isArray(wj.pulse.recent) ? wj.pulse.recent : [];
      for (const h of rec.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) { if (!h || !h.pool || !h.at || Date.now() - Date.parse(h.at) > 20 * 3600e3) continue; if (openOf('pulse').length >= L.BOOKS.pulse.slots) break;
        const hs = { id: h.id, coin: h.coin, chain: C.CH[h.chain] || h.chain, pool: h.pool, net: h.net, price: h.price, liq: h.liq, signalId: h.pool + '@' + h.at.slice(0, 16) }, ph = rowByPool.get(h.pool) ? L.lifecycle(rowByPool.get(h.pool)) : null;
        if (add(L.labRow('pulse', hs, h.at, { why: h.why, phase: ph }))) nAdd.pulse = (nAdd.pulse || 0) + 1;
        const fp = L.flushPlan(h.price); if (fp && openOf('pulseFlush').length < L.BOOKS.pulseFlush.slots) add(L.labRow('pulseFlush', hs, h.at, { why: [...(h.why || []).slice(0, 1), `bid ${fp.limit} (6% under the alert price) and wait for a dip`], plan: fp, phase: ph })); } }
    // buyer spike: new wallets arriving before the price has run (full scans only: unique buyers come from GeckoTerminal)
    if (mode === 'full') { const dAt = new Date().toISOString().slice(0, 19) + 'Z'; let k = 0;
      for (const p of allRows.filter(p => p.price > 0 && L.buyerSpike(p) != null).sort((a, b) => L.buyerSpike(b) - L.buyerSpike(a))) { if (k >= L.BOOKS.spike.maxNew || openOf('spike').length >= L.BOOKS.spike.slots) break;
        if (recentCoin('spike', p.pool, 24) || D.runnerVeto(p, null).length) continue; const s0 = L.spikeSetup(p); if (!s0) continue;
        if (add(L.labRow('spike', { ...srcOf(p), signalId: p.pool + '@' + dAt.slice(0, 13) }, dAt, { why: s0.why, spike: s0.spike, phase: L.lifecycle(p), fresh: !!p.fresh }))) { nAdd.spike = (nAdd.spike || 0) + 1; k++; } } }
    // random-entry baseline: two random liquid coins per full scan, same exits as the Risky coins book
    if (mode === 'full') { const dAt = new Date().toISOString().slice(0, 19) + 'Z'; let x = (Date.parse(dAt) / 36e5) | 0; const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
      const pool3 = allRows.filter(p => p.price > 0 && p.rug !== 'danger' && (p.liq || 0) >= 50000 && (p.v24 || 0) >= 250000 && !recentCoin('randomCtl', p.pool, 24)); let k = 0;
      while (pool3.length && k < L.BOOKS.randomCtl.maxNew && openOf('randomCtl').length < L.BOOKS.randomCtl.slots) { const p = pool3.splice(Math.floor(rnd() * pool3.length), 1)[0];
        if (add(L.labRow('randomCtl', { ...srcOf(p), signalId: p.pool + '@' + dAt.slice(0, 13) }, dAt, { why: ['picked at random (baseline)'], phase: L.lifecycle(p) }))) { nAdd.random = (nAdd.random || 0) + 1; k++; } } }
    // follow proven wallets: 2+ proven wallets net buying and no risk rule
    if (mode === 'full') { const dAt = new Date().toISOString().slice(0, 19) + 'Z'; let k = 0;
      const pool2 = [...(runnerItems || []).filter(it => !it.vetoed.length && it.proven && it.proven.in >= 2).map(it => ({ p: rowByPool.get(it.pool), pi: it.proven })), ...earlyItems.filter(e => e.provenIn >= 2 && !e.veto.length).map(e => ({ p: rowByPool.get(e.pool), pi: { in: e.provenIn } }))];
      for (const { p, pi } of pool2) { if (!p || k >= L.BOOKS.proven.maxNew || openOf('proven').length >= L.BOOKS.proven.slots || recentCoin('proven', p.pool, 24)) continue;
        if (add(L.labRow('proven', { ...srcOf(p), signalId: p.pool + '@' + dAt.slice(0, 13) }, dAt, { why: [`${pi.in} proven wallets net buying`], phase: L.lifecycle(p), fresh: !!p.fresh }))) { nAdd.proven = (nAdd.proven || 0) + 1; k++; } } }
    if (settings.scalper !== false && usage.calls <= 0.85 * limit) {
      const openPools = new Set(lab.filter(x => isOpenL(x) && L.BOOKS[x.book].group === 'scalp').map(x => x.pool)), cands = L.scalpCandidates(allRows, 6, openPools);
      for (const p of cands) { let bars = null; try { bars = await m5Bars(p.net, p.pool); } catch { /* skip */ } if (!bars) continue; const dAt = new Date().toISOString().slice(0, 19) + 'Z';
        for (const sg of L.scalpSignals(bars, Date.now() / 1000, p)) { if (!L.BOOKS[sg.book]) continue; if (lab.filter(x => x.book === sg.book && isOpenL(x)).length >= L.BOOKS[sg.book].slots) continue;
          const chain = { solana: 'Solana', eth: 'Ethereum', robinhood: 'Robinhood' }[p.chain] || p.chain; if (add(L.labRow(sg.book, { id: String(p.chain).slice(0, 3).toUpperCase() + ':' + p.sym, coin: p.sym, chain, pool: p.pool, net: p.net, price: p.price, liq: p.liq }, dAt, { why: sg.why }))) nAdd.scalp++; } }
    } else if (settings.scalper !== false) say('scalper paused: monthly data allowance is over 85% used');
    const byPool = new Map(); for (const x of lab.filter(isOpenL).sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)))) { const k = (PROFILES[x.profile] && PROFILES[x.profile].barSec === 300 ? 'm5|' : 'h1|') + String(x.pool).toLowerCase(); if (!byPool.has(k)) byPool.set(k, []); byPool.get(k).push(x); }
    let fetched = 0, evald = 0; const idx = new Map(lab.map((x, i) => [x.lid, i]));
    // cut-on-sellers book: wallet reads the degen desk records each full scan, plus the watcher's 15-minute DexScreener checks
    const degBySig = new Map(dout.map(x => [x.signalId, x])), wj0 = readJson(path.join(OUT, 'watch.json'), {}), flowEv = wj0.flow && Array.isArray(wj0.flow.events) ? wj0.flow.events : [];
    const withCut = (x, r, bars, nowI) => { const FP = PROFILES[x.profile]; if (!FP || !FP.flowCut || !(r.entryPx > 0)) return r;
      const cut = x.cut || flowCutEvent([...((degBySig.get(x.from) || {}).walletHist || []), ...flowEv.filter(e => e.lid === x.lid)], bars, r.entryPx, r.entryAt, FP.flowCut, FP.barSec);
      if (!cut) return r; const r2 = runExit({ ...x, cut }, bars, nowI, FP); return r2.status === 'open' || /^cut/.test(r2.status) ? { ...r2, cut } : r2; };
    for (const [k, rows] of byPool) { const m5 = k.startsWith('m5|'), key = k.slice(3), cached = m5 ? M5.has(key) : H1.has(key); if (!cached) { if (fetched >= 20) continue; fetched++; }
      let bars = null; try { bars = m5 ? await m5Bars(netOf(rows[0]), rows[0].pool) : await hourBars(netOf(rows[0]), rows[0].pool); } catch { /* next scan */ }
      const nowI = new Date().toISOString().slice(0, 19) + 'Z';
      for (const x of rows) { const i = idx.get(x.lid); if (!bars) { lab[i] = onMiss(x, nowI); if (lab[i].dead) deadN++; continue; }
        const r = withCut(x, runExit(x, bars, nowI, PROFILES[x.profile]), bars, nowI); evald++; let y = r.status === 'waiting for entry' ? { ...x, checkedAt: nowI, ...(Date.now() - Date.parse(x.signalAt) > 48 * 3600e3 ? { status: 'no data' } : {}) } : { ...x, ...r };
        if (isOpenL(y)) { if (freshBars(bars, m5 ? 300 : 3600)) y.miss = 0; else { y = onMiss(y, nowI); if (y.dead) deadN++; } } lab[i] = y; } }
    fs.writeFileSync(labPath, JSON.stringify([...lab.filter(x => !isOpenL(x)).slice(-3000), ...lab.filter(isOpenL)]));
    // books that have earned the edge verdict (luck-corrected, consistent, beating the random baseline): every new trade they open goes to the phone
    try { const since = readJson(path.resolve('docs/paper-config.json'), {}).since || null, tests = Object.keys(L.BOOKS).length + 2, evOf = (k) => evidence(statsBook(lab.filter(x => x.book === k).map(x => fromRun(x)).filter(Boolean), { since }), { tests });
      const base = evOf('randomCtl'), edgeBooks = Object.keys(L.BOOKS).filter(k => k !== 'bid' && k !== 'degen' && k !== 'randomCtl').filter(k => { const e = evOf(k); return e.verdict === 'edge' && !(base.n >= 30 && e.avgR <= base.avgR + 0.1); });
      const fresh = newRows.filter(r => edgeBooks.includes(r.book));
      if (fresh.length) { say(`edge books: ${edgeBooks.join(', ')}; ${fresh.length} new trade(s) sent to the phone`);
        if (topic0 && settings.edgeAlert !== false) { const body = fresh.slice(0, 5).map(r => `${L.BOOKS[r.book].short}: ${r.coin} (${r.chain})${r.plan ? ` limit ${r.plan.limit}, stop ${r.plan.stop}` : ' at the next hourly open'}${r.why && r.why.length ? ' · ' + r.why[0] : ''}`).join('\n');
          await fetch('https://ntfy.sh/' + encodeURIComponent(topic0), { method: 'POST', body: body + '\n\nThis book has 30+ paper trades with a luck-corrected edge. Still paper-tested only: size small.', headers: { Title: 'RynoScan edge book signal', Priority: 'high', Tags: 'rhinoceros,dart' } }).catch(() => null); } }
    } catch (e) { say('edge-book alerts skipped: ' + (e.message || e)); }
    say(`strategy lab: ${lab.filter(isOpenL).length} open or waiting, ${evald} re-checked, new: ${nAdd.copies} degen exit copies, ${nAdd.risky} risky-coin trades, ${nAdd.scalp} scalps, ${nAdd.fib || 0} Fib pullbacks, ${nAdd.inside || 0} inside-pattern, ${nAdd.proven || 0} proven-wallet, ${nAdd.random || 0} random baseline, ${nAdd.pulse || 0} early pulse, ${nAdd.spike || 0} buyer spike${deadN ? `; ${deadN} dead pool${deadN === 1 ? '' : 's'} closed at half the last price` : ''}`);
  } catch (e) { say('strategy lab skipped: ' + (e.message || e)); }
  // wallet scorecard: resolve episodes that are 72+ hours old (what the coin did next), then save
  try { let rs = 0, fetchedS = 0; for (const ep of wEps) { if (ep.out || Date.now() - Date.parse(ep.t) < (SCO.SC.horizonH + 1) * 3600e3) continue; if (rs >= 25) break; const cached = H1.has(String(ep.pool).toLowerCase()); if (!cached) { if (fetchedS >= 15) continue; fetchedS++; }
      let bars = null; try { bars = await hourBars(ep.net, ep.pool); } catch { /* next scan */ } const o = bars ? SCO.resolve(ep, bars) : null; if (o) { ep.out = o; rs++; wsDirty = true; } else if (Date.now() - Date.parse(ep.t) > 10 * 864e5) { ep.out = { na: true }; wsDirty = true; } }
    if (wsDirty) { wEps = SCO.trim(wEps); fs.writeFileSync(wsPath, JSON.stringify(wEps)); }
    const sc2 = SCO.score(wEps); fs.writeFileSync(path.join(OUT, 'walletscore.json'), JSON.stringify(SCO.summary(sc2, earlyItems.slice(0, 12), nowIso)));
    say(`wallet scorecard: ${sc2.episodes} coin-days logged, ${sc2.resolved} with an outcome, ${sc2.wallets} wallets scored, ${sc2.proven.length} proven${sc2.base != null ? `, base run rate ${Math.round(sc2.base * 100)}%` : ''}${rs ? `, ${rs} outcomes added` : ''}`);
  } catch (e) { say('wallet scorecard skipped: ' + (e.message || e)); }
  const closedKeep = dout.filter(x => !(x.status === 'open' || x.status === 'waiting for entry')).slice(-300), openKeep = dout.filter(x => x.status === 'open' || x.status === 'waiting for entry');
  fs.writeFileSync(dpath, JSON.stringify([...closedKeep, ...openKeep]));
} catch (e) { say('degen desk skipped: ' + (e.message || e)); }

// 5. export
const out = kept.map(p => { const r = C.toRow(p, at); if (p.rug) r.rug = p.rug; if (p.rugFlags) r.rugFlags = p.rugFlags; if (p.regime) r.regime = p.regime; if (p.hs) r.hs = p.hs; if (p.soc) r.soc = p.soc; if (p.zoneOrder && p.lead !== 'pattern') r.zoneOrder = 1; if (p.dsx) r.dsx = p.dsx; { const bs = L.buyerSpike(p); if (bs != null) r.bspk = bs; const o2 = scoreV2(rowToSig(r)); if (o2 != null) r.opp2 = o2; } if (pulseSeen.live) { const pa = pulseAgo(p.pool); r.pulse = pa != null; if (pa != null) r.pulseH = pa; } return r; });
const charts = kept.filter(C.chartWorthy).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (b.opp ?? 0) - (a.opp ?? 0)).slice(0, 32).map(C.toChart);
if (mode === 'full') { try { fs.writeFileSync(path.join(OUT, 'universe.json'), JSON.stringify(allRows.filter(p => p.price > 0 && p.rug !== 'danger' && (p.liq || 0) >= 50000).slice(0, 300).map(p => ({ pool: p.pool, net: p.net, chain: p.chain, sym: p.sym, id: String(p.chain).slice(0, 3).toUpperCase() + ':' + p.sym })))); } catch (e) { say('universe skipped: ' + (e.message || e)); } }
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
// review council: six rule-based reviewers with different hats read every paper book, argue, and the chair gives one final answer (paper only)
try { const { runCouncil } = await import('./councilrun.mjs'); const cr = await runCouncil(OUT, { topic, site }); say(`council: ${cr.final.headline}`); } catch (e) { say('council skipped: ' + (e.message || e)); }
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
