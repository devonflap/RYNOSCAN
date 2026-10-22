// RynoBot: always-on DRY-RUN trading bots for a small server (or any computer that stays on). One process per bot (--bot <name>):
//   rules     the scanner's bid-ready and worth-watching setups, bought on the 5-minute trigger, managed with the exit stack (bot/manage.mjs)
//   breakout  Breakout retest setups exactly as the backtest traded them (limit at the top of the retest zone; thirds at TP1/TP2/TP3,
//             break-even after TP1, 7 days), filtered by the bot tuner (docs/tuner.mjs): hints that held on new trades switch on by themselves
// Every minute each bot works out the exact order it WOULD place and manages that paper position. Nothing is ever bought or sold: there
// are no keys and no wallet anywhere in this code.
//   node bot/run.mjs --bot breakout     run forever (systemd keeps each bot alive on a server, see bot/README.md; default bot: rules)
//   node bot/run.mjs --once    one cycle, then exit          node bot/run.mjs --check   test the data feeds and ntfy, then exit
// Kill switch for new entries: create bot/STOP (every bot) or bot/STOP-<name> (one bot); open positions are still managed.
// Every 14 days it also sends a reality check (bot/reality.mjs): its own trades against the paper "Bot rules" book on the same coins.
//   node bot/run.mjs --reality   print that reality check now          node bot/run.mjs --status   account, open positions, last trades
// Phone: by default only problems (with a note when they clear), the reality check, and a restart notice. Would-be trades go to the
// server log and bot/journal.jsonl ("tradeAlerts": true in bot/config.json sends them to the phone too). A heartbeat goes to a
// silent second topic (<your topic>-hb) every 30 minutes; the GitHub watchdog tells your phone if it stops.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidates } from '../src/watch.mjs';
import { BOT, decideEntry, sizeFor, openPosition, managePosition, pnlOf, decideLimit, openLadder, manageLadder, openMomentum, manageMomentum, costPct, closeNow } from './manage.mjs';
import { reality, reportText, REALITY } from './reality.mjs';
import { recordFor, publish } from './publish.mjs';
import { LIVE, liveCheck, buy as liveBuy, sell as liveSell, reconcile, defaultIo, keyPath } from './live.mjs';
import { evmBuy, evmSell, evmIo } from './evm.mjs';
import { KITTY, sweepPlan, applySweep, nativeFor, validKitty } from './kitty.mjs';
import { keepsAll, labelOf, TUNE } from '../docs/tuner.mjs';
import { rangeSetup, ignitionSetup, runnerSetups, RANGE, IGN } from './setups.mjs';

const DIR0 = path.dirname(fileURLToPath(import.meta.url)), dirNow = () => process.env.RYNOBOT_DIR || DIR0; // RYNOBOT_DIR: tests
// each bot: where its setups come from, how it enters and exits, and which paper book its reality check compares against
// retired rulebooks (kept so old state files, tests and the paper twins still load; not run as services): the first "Bot rules" bot
// (-0.51R a trade over 18) and the degen study bot (its exits are tested by the paper Degen · study exits book instead)
export const RETIRED = {
  rules: { name: 'rules', label: 'RynoBot', source: 'setups', entry: 'trigger', exit: 'stack', realityBook: 'exec' },
  degen: { name: 'degen', label: 'RynoBot Degen', source: 'degen', entry: 'market', exit: 'stack', realityBook: 'degenStudy', minOpp: 0, degenMaxAgeH: 2, minLiqUsd: 50000, maxStopPct: 45, minStopPct: 40, fixedStopPct: 40, tp1R: 1e9, rideFreeAt: 2, giveback: 0.5, noFollowH: 1e9, volDied: 0, sellersLoss: 2, maxHoldH: 168, maxOpen: 8, maxOpenRiskPct: 8, riskPct: 1 },
};
export const BOTS = {
  // high risk, high reward: the scanner's runners (3 of 4 checks, no risk rule, 2 new a scan) bought on sight. Ryan's clips on the way up:
  // 20% out at +50%, +100%, +150% and +200%, 10% at +300%, the last 10% is a moonbag trailing 45% off its high; stop 20%; the seller cut
  runner: { name: 'runner', label: 'RynoBot Runner', source: 'runners', entry: 'market', exit: 'ladder', realityBook: 'riskyClip', minOpp: 0, minLiqUsd: 100000, fixedStopPct: 20, minStopPct: 20, maxStopPct: 20, mults: [1.5, 2, 2.5, 3, 4], shares: [0.2, 0.2, 0.2, 0.2, 0.1], moonTrail: 0.45, beAfterFirst: false, flowCut: true, noFollowH: 24, boostTighten: 0.15, minAgeH: 24, maxLiqPct: 0.5, sellersLoss: 0.08, sellersX: 1.2, maxHoldH: 168, maxOpen: 6, maxOpenRiskPct: 3, riskPct: 0.5, maxPosPct: 10, runnerMaxNew: 2, runnerMinPassed: 3, signalMaxAgeH: 2, chaseLimitPct: 15 },
  breakout: { name: 'breakout', label: 'RynoBot Breakout', source: 'breakouts', entry: 'limit', exit: 'ladder', realityBook: 'brkBot', tuneKey: 'breakout', autoTune: true, minOpp: 50, maxStopPct: 35, maxHoldH: 168, minAgeH: 24, smaHalve: true },
  // the Monday-range trade on the previous UTC day's range: sweep the low, close back inside, 15-minute structure break, limit at the order block, everything out at the range high (3R to 8R only)
  range: { name: 'range', label: 'RynoBot Range', source: 'range', entry: 'limit', exit: 'ladder', realityBook: null, minOpp: 0, minLiqUsd: 100000, maxStopPct: 25, maxHoldH: 48, maxOpen: 4, maxOpenRiskPct: 3, riskPct: 0.75, maxPosPct: 10, minAgeH: 24, ...RANGE, scanPerCycle: 4, scanEveryMin: 60, maxGtPerMin: 10 },
  // the same runner strategy with an earlier trigger (Cashmore's Ignition Rider on memes): an hourly candle closes +5% on 12x the median hourly volume, buyers leading, not already up 150% in a day; stop at the candle's low; the same clips and moonbag (exit: 'momentum' switches to the trail-and-90%-out exit instead)
  ignition: { name: 'ignition', label: 'RynoBot Runner · ignition', source: 'ignition', entry: 'market', exit: 'ladder', mults: [1.5, 2, 2.5, 3, 4], shares: [0.2, 0.2, 0.2, 0.2, 0.1], moonTrail: 0.45, beAfterFirst: false, flowCut: true, sellersLoss: 0.08, sellersX: 1.2, noFollowH: 24, boostTighten: 0.15, maxLiqPct: 0.5, realityBook: null, minOpp: 0, minLiqUsd: 50000, minStopPct: 3, maxStopPct: 30, maxHoldH: 168, maxOpen: 6, maxOpenRiskPct: 6, maxPosPct: 1, riskPct: 1, ...IGN, scanPerCycle: 4, scanEveryMin: 60, maxGtPerMin: 10, signalMaxAgeH: 1, chaseLimitPct: 10 },
};
export const filesFor = (name = 'rules') => { const x = name === 'rules' ? '' : '-' + name, DIR = dirNow(); return { cfg: path.join(DIR, 'config.json'), state: path.join(DIR, `state${x}.json`), journal: path.join(DIR, `journal${x}.jsonl`), stopAll: path.join(DIR, 'STOP'), stop: path.join(DIR, 'STOP-' + name), reality: path.join(DIR, `reality${x}.json`), cmd: path.join(DIR, `cmd-${name}.jsonl`) }; };
export const DEFAULTS = { site: 'https://devonflap.github.io/RYNOSCAN/data/', mode: 'dry', enabled: true, accountUsd: 10000, pollSec: 60, setupsEveryMin: 10, minOpp: 65, signals: ['bid', 'watch'], nearZonePct: 10, maxGtPerMin: 20, summaryHourBrisbane: 20, realityEveryDays: 7, minLiqUsd: 100000, coolH: 24, tradeAlerts: false, dailySummary: false, heartbeatMin: 30, publish: false, publishMin: 60, regimeDial: true, dial: { 'Risk-off': 0.5, Neutral: 1, 'Risk-on': 1.25 }, ...KITTY, ...BOT, ...LIVE, ...RETIRED.rules };
const DS = { solana: 'solana', robinhood: 'robinhood', ethereum: 'ethereum', eth: 'ethereum' }, GT = { solana: 'solana', robinhood: 'robinhood', ethereum: 'eth', eth: 'eth' };
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wr = (f, o) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, f); };
const isoNow = () => new Date().toISOString().slice(0, 19) + 'Z', bne = (ms = Date.now()) => new Date(ms + 10 * 3600e3), dayKey = (ms) => bne(ms).toISOString().slice(0, 10);
const fmt = (x) => (x == null ? '—' : Number(Number(x).toPrecision(5)).toString()), usd = (x) => '$' + Math.round(x).toLocaleString('en');
// shared settings in bot/config.json apply to every bot; "bots": { "breakout": { ... } } overrides one bot
export function loadConfig(name = 'rules') { const { bots, ...shared } = rd(filesFor(name).cfg, {}); const def = BOTS[name] || RETIRED[name]; if (!def) throw new Error('unknown bot: ' + name + ' (bots: ' + Object.keys(BOTS).join(', ') + ')'); return { ...DEFAULTS, ...shared, ...def, ...((bots && bots[name]) || {}) }; }
export function newState(cfg) { return { cash: cfg.accountUsd, start: cfg.accountUsd, setups: {}, seen: {}, positions: [], closed: [], days: {}, setupsAt: 0, gtAt: {}, summaryDay: null, startedAt: null, lastCycleAt: 0, gaps: [], blocks: [], realityAt: 0 }; }
const readJournal = (F) => { try { return fs.readFileSync(F.journal, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const saveReality = (F, r) => { const o = rd(F.reality, { history: [] }); o.latest = r; o.history = [...(o.history || []), { at: r.at, n: r.n, paperPct: r.paperPct, botPct: r.botPct, gapPct: r.gapPct, gapR: r.gapR, call: r.call }].slice(-100); wr(F.reality, o); };

async function getJson(url, ms = 20000) { const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); }
async function heartbeat(msg) { const topic = (process.env.NTFY_TOPIC || '').trim(); if (!topic) return; try { await fetch('https://ntfy.sh/' + encodeURIComponent(topic + '-hb'), { method: 'POST', body: msg, headers: { Title: 'hb', Priority: 'min', Tags: 'heartbeat' }, signal: AbortSignal.timeout(15000) }); } catch (e) { console.log('heartbeat failed: ' + e.message); } }
// health: one phone alert once a problem has lasted afterMin minutes, and one when it clears. bad: false, or a short reason.
export async function health(st, key, bad, now, N, { afterMin, title, text }, label = 'RynoBot') {
  const h = (st.health ||= {}), cur = h[key], mins = cur ? Math.round((now - cur.since) / 60000) : 0;
  if (bad) { if (!cur) { h[key] = { since: now, alerted: false, why: String(bad) }; return; } cur.why = String(bad);
    if (!cur.alerted && now - cur.since >= afterMin * 60e3) { cur.alerted = true; await N(`${label} problem: ${title}`, text(mins, cur.why), 'high'); } return; }
  if (cur) { if (cur.alerted) await N(`${label}: ${title} back to normal`, `Fixed itself after about ${mins} minutes. Nothing for you to do.`); delete h[key]; }
}
async function notify(title, body, priority = 'default') {
  const topic = (process.env.NTFY_TOPIC || '').trim(); console.log(`[${isoNow()}] ${title}\n  ${body.replace(/\n/g, '\n  ')}`);
  if (!topic) return; try { await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body, headers: { Title: title, Priority: priority, Tags: 'robot,rhinoceros' } }); } catch (e) { console.log('ntfy failed: ' + e.message); }
}
const journalTo = (F) => (o) => { try { fs.appendFileSync(F.journal, JSON.stringify({ at: isoNow(), ...o }) + '\n'); } catch { /* best effort */ } };

// DexScreener quotes for many pools (free, batched 30 per call)
async function quotes(items) {
  const by = {}, out = {}; for (const it of items) { const c = DS[String(it.chain).toLowerCase()]; if (c && it.pool) (by[c] ||= new Set()).add(it.pool); }
  for (const [c, set] of Object.entries(by)) { const a = [...set]; for (let i = 0; i < a.length; i += 30) { try { const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${c}/${a.slice(i, i + 30).join(',')}`); for (const q of (j && j.pairs) || []) out[String(q.pairAddress).toLowerCase()] = q; } catch (e) { console.log('quotes: ' + e.message); } } }
  return out;
}
// GeckoTerminal candles of any size (hour, or minutes aggregated): [[t, o, h, l, c, v]] oldest first; same call budget as the 5-minute ones
export async function candlesGT(chain, pool, { tf = 'hour', agg = 1, limit = 100 } = {}, cfg = DEFAULTS) {
  const now = Date.now(); gtCalls = gtCalls.filter((t) => now - t < 60e3); if (gtCalls.length >= cfg.maxGtPerMin) return null; gtCalls.push(now);
  const net = GT[String(chain).toLowerCase()]; if (!net) return null;
  try { const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}&currency=usd&token=base`); const raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list; return Array.isArray(raw) ? raw.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]) : null; } catch { return null; }
}
// GeckoTerminal 5-minute candles (free, about 30 calls a minute): [[t, o, h, l, c, v]] oldest first
let gtCalls = [];
async function candles5(chain, pool, cfg) {
  const now = Date.now(); gtCalls = gtCalls.filter((t) => now - t < 60e3); if (gtCalls.length >= cfg.maxGtPerMin) return null; gtCalls.push(now);
  const net = GT[String(chain).toLowerCase()]; if (!net) return null;
  try { const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=5&limit=150&currency=usd&token=base`); const raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list; return Array.isArray(raw) ? raw.map((r) => r.map(Number)).sort((a, b) => a[0] - b[0]) : null; } catch (e) { console.log('candles: ' + e.message); return null; }
}

export async function cycle(st, cfg, deps = {}) {
  const F = filesFor(cfg.name), Q = deps.quotes || quotes, C5 = deps.candles5 || ((c, p) => candles5(c, p, cfg)), CH = deps.candlesH || ((c, p, limit) => candlesGT(c, p, { tf: 'hour', limit }, cfg)), C15 = deps.candles15 || ((c, p, limit) => candlesGT(c, p, { tf: 'minute', agg: 15, limit }, cfg)), N = deps.notify || notify, J = deps.journal || journalTo(F), G = deps.getJson || getJson;
  const NM = cfg.label || 'RynoBot', H = (key, bad, o) => health(st, key, bad, now, N, o, NM);
  const now = deps.now || Date.now(), nowSec = now / 1000, nowIso = new Date(now).toISOString().slice(0, 19) + 'Z';
  const TN = cfg.tradeAlerts ? N : async (t, b) => console.log(`[${nowIso}] ${t}\n  ${b.replace(/\n/g, '\n  ')}`); // would-be trades: log only unless tradeAlerts
  // 5-minute candles: one fetch per coin per closed candle (45 seconds after each close), kept in memory only
  if (!st._c5) Object.defineProperty(st, '_c5', { value: new Map(), enumerable: false });
  let c5t = 0, c5g = 0; const slot = Math.floor((nowSec - 45) / 300), C5c = async (c, p) => { const k = String(p).toLowerCase(), hit = st._c5.get(k); if (hit && hit.slot === slot) return hit.bars; c5t++; const b = await C5(c, p); if (b) { c5g++; st._c5.set(k, { slot, bars: b }); } return b; };
  // offline spells (server down, bot restarted) are remembered so the reality check can tell "bot was offline" from a real miss
  st.startedAt ||= nowIso; st.gaps ||= []; st.blocks ||= [];
  // execution mode: dry unless the live checks all pass (quote mode needs only a token address per setup and a wallet for the sizes)
  { const why = cfg.mode === 'live' ? liveCheck(cfg, { dir: path.dirname(F.stop) }) : null, mode = cfg.mode === 'live' && !why ? 'live' : cfg.mode === 'quote' ? 'quote' : 'dry';
    if (st.execMode !== mode) { J({ type: 'mode', mode, why: why || null }); if (!(st.execMode == null && mode === 'dry' && !why)) await N(`${NM}: now in ${mode === 'live' ? 'LIVE' : mode === 'quote' ? 'rehearsal (real quotes, nothing sent)' : 'dry-run'} mode`, why ? `Live was asked for but refused: ${why}. Staying in dry run.` : mode === 'live' ? `Real orders from wallet ${cfg.wallet}. Per order at most $${cfg.liveMaxUsd}, in total $${cfg.liveMaxOpenUsd}. Pause from the desk or touch bot/STOP-${cfg.name} to stop new buys.` : 'Nothing is sent to the market.', mode === 'live' ? 'high' : 'default'); st.execMode = mode; } }
  if (st.execMode === 'live' && now - (st.reconAt || 0) > 3600e3) { try { const io = deps.io || defaultIo(cfg), solUsd = st.solUsd || null; const bal = await io.solBalance(cfg.wallet); if (solUsd > 0) { const rc = reconcile(bal, solUsd, st, cfg); st.recon = { ...rc, at: nowIso }; if (!rc.ok || rc.lowSol) await N(`${NM} problem: wallet check`, rc.lowSol ? `Only ${rc.walletSol} SOL left: under the fee reserve, new buys will be refused. Top the wallet up.` : `The wallet holds $${rc.walletUsd} but the bot's books say $${rc.botCash} cash (drift $${rc.driftUsd}). Check the journal for a failed or partial order.`, 'high'); } st.reconAt = now; } catch (e) { console.log('wallet check: ' + e.message); } } const held0 = new Set(st.positions.map((p) => p.pool));
  if (st.lastCycleAt && now - st.lastCycleAt > Math.max(5 * 60e3, cfg.pollSec * 5e3)) { st.gaps.push([new Date(st.lastCycleAt).toISOString().slice(0, 19) + 'Z', nowIso]); st.gaps = st.gaps.slice(-300); }
  // 1. setups from the scanner. rules: bid-ready and worth-watching with a zone and an invalidation (24 hours). breakout: Breakout retests (48 hours)
  if (now - (st.setupsAt || 0) > cfg.setupsEveryMin * 60e3) {
    try { if (cfg.regimeDial) { try { const m = await G(cfg.site + 'meta.json'), rg = m && m.regime && m.regime.sol, lv = rg && rg.level; let mult = lv ? (cfg.dial[lv] ?? 1) : 1; if (cfg.smaHalve && rg && rg.aboveSma20 === false) mult = Math.min(mult, 0.5); /* edge report: breakouts fail in down regimes; below the 20-day average, half size */ if (st.dial !== mult) { J({ type: 'dial', regime: lv || 'unknown', mult }); st.dial = mult; st.dialWhy = lv ? `SOL ${lv.toLowerCase()}: ${m.regime.sol.why.slice(0, 2).join(', ')}` : 'no regime yet'; } } catch (e) { console.log('dial: ' + e.message); } }
      if (cfg.source === 'breakouts') await breakoutSetups(st, cfg, { G, J, N, now, nowIso }); else if (cfg.source === 'degen') await degenSetups(st, cfg, { G, J, now, nowIso }); else if (cfg.source === 'runners') await runnerSetupsIn(st, cfg, { G, J, now, nowIso }); else if (cfg.source === 'range' || cfg.source === 'ignition') { /* found from candles below, every cycle */ } else { const [setups, signals] = await Promise.all([G(cfg.site + 'setups.json'), G(cfg.site + 'signals.json').catch(() => [])]);
      // the same setups the paper "Bot rules" book takes (src/scan.mjs): bid-ready or worth watching scored over minOpp, $100k+ liquidity,
      // no rug danger, and one setup per coin per 24 hours (so a stopped-out coin is not bought straight back)
      for (const it of candidates(Array.isArray(setups) ? setups : [], Array.isArray(signals) ? signals : [], cfg.minOpp)) {
        if (!cfg.signals.includes(it.kind) || !it.pool || !(it.entryLow > 0) || !(it.stop > 0) || st.setups[it.pool]) continue;
        if (!((it.opp ?? 0) > cfg.minOpp) || (it.liquidity != null && it.liquidity < cfg.minLiqUsd) || it.rug === 'danger') continue;
        if (now - ((st.seen || {})[it.pool] || 0) < cfg.coolH * 3600e3) continue; (st.seen ||= {})[it.pool] = now;
        st.setups[it.pool] = { pool: it.pool, coin: it.coin, chain: it.chain, token: it.token || null, kind: it.kind, setup: it.setup, opp: it.opp, zoneLow: +it.entryLow, zoneHigh: +it.entryHigh, stop: +it.stop, at: nowIso, liq0: +it.liquidity || 0 }; J({ type: 'setup', coin: it.coin, pool: it.pool, kind: it.kind, zoneLow: +it.entryLow, zoneHigh: +it.entryHigh, stop: +it.stop }); } }
      st.setupsAt = now; await H('scanner', false, { title: 'scanner data' }); } catch (e) { console.log('setups: ' + e.message); st.setupsAt = now - Math.max(0, cfg.setupsEveryMin - 2) * 60e3;
      await H('scanner', e.message || 'error', { afterMin: 30, title: 'scanner data', text: (m, why) => `Can't read the scanner's setups from the dashboard for ${m} minutes (${why}).\nNo new setups are coming in; open positions are still managed.\nIf the dashboard won't load either, GitHub Pages is down and it comes back by itself.` }); }
  }
  for (const [k, s] of Object.entries(st.setups)) if (now - Date.parse(s.at) > ((s.expireH || 24) + 1) * 3600e3 || s.dropped) { if (s.lastPx > 0 && !held0.has(s.pool)) (st.passed ||= []).push({ coin: s.coin, chain: s.chain, pool: s.pool, at: nowIso, px0: s.lastPx, zoneHigh: s.zoneHigh, stop: s.stop, why: s.dropWhy || (s.dropped ? 'dropped' : 'no trigger before it expired'), hi: s.lastPx, last: s.lastPx }); delete st.setups[k]; }
  st.passed = (st.passed || []).filter((x) => now - Date.parse(x.at) < 3 * 86400e3).slice(-80);
  for (const [k, t] of Object.entries(st.seen || {})) if (now - t > 2 * cfg.coolH * 3600e3) delete st.seen[k];
  // 1b. bots that find their own setups from candles (range, ignition): a few coins of the scanner's universe each cycle, each coin about once an hour
  if (cfg.source === 'range' || cfg.source === 'ignition') { try { if (!st.universe || now - (st.universeAt || 0) > 3600e3) { const u = await G(cfg.site + 'universe.json'); if (Array.isArray(u)) { st.universe = u.map((x) => ({ pool: x.pool, chain: x.chain, coin: x.sym, net: x.net })); st.universeAt = now; } }
      st.scanAt ||= {}; const due = (st.universe || []).filter((c) => c.pool && GT[String(c.chain).toLowerCase()] && now - (st.scanAt[c.pool] || 0) >= (cfg.scanEveryMin || 60) * 60e3 && !st.setups[c.pool] && !held0.has(c.pool) && now - ((st.seen || {})[c.pool] || 0) >= cfg.coolH * 3600e3).sort((a, b) => (st.scanAt[a.pool] || 0) - (st.scanAt[b.pool] || 0)).slice(0, cfg.scanPerCycle || 8);
      const qd = due.length ? await Q(due).catch(() => ({})) : {}; let found = 0;
      for (const c of due) { st.scanAt[c.pool] = now; const qq = qd[String(c.pool).toLowerCase()], liq = +(qq && qq.liquidity && qq.liquidity.usd) || 0; if (qq && liq < cfg.minLiqUsd) continue;
        if (cfg.source === 'ignition') { const b = await CH(c.chain, c.pool, 721); if (!b) continue; const r = ignitionSetup(b, qq, nowSec, cfg); if (!r || r.dead) { if (r && r.dead) J({ type: 'skip', coin: c.coin, pool: c.pool, why: r.dead }); continue; }
          (st.seen ||= {})[c.pool] = now; st.setups[c.pool] = { pool: c.pool, coin: c.coin, chain: c.chain, token: qq && qq.baseToken && qq.baseToken.address || null, kind: 'ignition', setup: 'Ignition candle', opp: null, zoneLow: r.zoneLow, zoneHigh: r.zoneHigh, stop: r.stop, trigVol: r.trigVol, mults: cfg.mults || null, shares: cfg.shares || null, volX: r.volX, retPct: r.retPct, ch24: r.ch24, why: r.why, expireH: cfg.signalMaxAgeH || 1, at: new Date(r.trigAt * 1000 + 3600e3).toISOString().slice(0, 19) + 'Z', liq0: liq }; J({ type: 'setup', coin: c.coin, pool: c.pool, kind: 'ignition', zoneLow: r.zoneLow, zoneHigh: r.zoneHigh, stop: r.stop, why: r.why }); found++; }
        else { const b = await CH(c.chain, c.pool, 60); if (!b) continue; const pre = rangeSetup(b, null, nowSec, cfg); if (!pre || pre.dead) continue; const b15 = await C15(c.chain, c.pool, 100); if (!b15) continue; const r = rangeSetup(b, b15, nowSec, cfg); if (!r || r.dead) { if (r && r.dead) J({ type: 'skip', coin: c.coin, pool: c.pool, why: r.dead }); continue; }
          (st.seen ||= {})[c.pool] = now; st.setups[c.pool] = { pool: c.pool, coin: c.coin, chain: c.chain, token: qq && qq.baseToken && qq.baseToken.address || null, kind: 'range', setup: 'Range sweep and reclaim', opp: null, zoneLow: r.zoneLow, zoneHigh: r.zoneHigh, stop: r.stop, tp1: r.tp1, rr: r.rr, rangeHi: r.rangeHi, rangeLo: r.rangeLo, discount: r.discount, why: r.why, expireH: r.expireH, at: nowIso, liq0: liq }; J({ type: 'setup', coin: c.coin, pool: c.pool, kind: 'range', zoneLow: r.zoneLow, zoneHigh: r.zoneHigh, stop: r.stop, tp1: r.tp1, why: r.why }); found++; } }
      if (due.length) await H('candles', false, { title: 'hourly candles' }); } catch (e) { console.log('candle scan: ' + e.message); } }
  // 2. prices for everything we watch or hold
  const held = new Set(st.positions.map((p) => p.pool)), watchList = Object.values(st.setups).filter((s) => !held.has(s.pool));
  for (const x of st.passed || []) if (!x.done && now - Date.parse(x.at) >= 24 * 3600e3) x.done = true;
  const following = (st.passed || []).filter((x) => !x.done), items = [...watchList, ...st.positions, ...following], q = await Q(items);
  for (const x of following) { const y = q[String(x.pool).toLowerCase()]; if (y && +y.priceUsd > 0) { x.last = +y.priceUsd; x.hi = Math.max(x.hi || 0, x.last); x.lo = Math.min(x.lo ?? x.last, x.last); } }
  await H('prices', items.length && !Object.keys(q || {}).length ? 'no prices returned' : false, { afterMin: st.positions.length ? 15 : 30, title: 'prices', text: (m) => `Can't get prices from DexScreener for ${m} minutes${st.positions.length ? `, so the ${st.positions.length} open position${st.positions.length === 1 ? ' is' : 's are'} not being checked` : ''}.\nUsually a DexScreener outage that clears by itself. If it lasts hours, run on the server: node bot/run.mjs --check` });
  for (const s of watchList) { const x = q[String(s.pool).toLowerCase()]; if (x && +x.priceUsd > 0) { s.lastPx = +x.priceUsd; s.lastAt = nowIso; if (+x.priceNative > 0) st.solUsd = +x.priceUsd / +x.priceNative; } }
  // commands from the desk (bot/cmd-<name>.jsonl, written by bot/dash.mjs): each is done once, then recorded in the journal
  const cmds = deps.commands ? deps.commands() : readCommands(F); st.cmdDone ||= [];
  for (const c of cmds) { if (!c || !c.id || st.cmdDone.includes(c.id)) continue; st.cmdDone = [...st.cmdDone, c.id].slice(-200);
    if (c.type === 'cancel') { const s = Object.values(st.setups).find((x) => x.pool === c.pool); if (s) { s.dropped = true; s.dropWhy = 'cancelled by hand from the desk'; J({ type: 'drop', coin: s.coin, pool: s.pool, why: 'cancelled by hand from the desk', manual: true }); } }
    else if (c.type === 'close') { const p = st.positions.find((x) => x.pool === c.pool && !x.closeNow); if (p) p.closeNow = true; } }
  // 3. manage open positions first (exits never wait behind entries)
  for (let i = 0; i < st.positions.length; i++) {
    let pos = st.positions[i]; const qq = q[String(pos.pool).toLowerCase()]; if (!qq) continue;
    let r; if (pos.closeNow) r = closeNow(pos, qq, nowSec, cfg); else if (pos.mode === 'ladder') r = manageLadder(pos, qq, nowSec, cfg);
    else if (pos.mode === 'momentum') { if (!st.gtAt[pos.id] || now - st.gtAt[pos.id] > 60 * 60e3) { const b = await CH(pos.chain, pos.pool, 6); if (b) { pos.bars1h = b.filter((x) => x[0] + 3600 <= nowSec).slice(-3); st.gtAt[pos.id] = now; } } r = manageMomentum(pos, qq, pos.bars1h || null, nowSec, cfg); }
    else { let closes = null; if (!st.gtAt[pos.id] || now - st.gtAt[pos.id] > 5 * 60e3) { const b = await C5c(pos.chain, pos.pool); if (b) { closes = b.filter((x) => x[0] + 300 <= nowSec).map((x) => [x[0], x[4]]); st.gtAt[pos.id] = now; } } r = managePosition(pos, qq, closes, nowSec, cfg); }
    pos = st.positions[i] = r.pos; if (+qq.priceUsd > 0) { pos.lastPx = +qq.priceUsd; pos.lastAt = nowIso; }
    if (pos.execMode && pos.execMode !== 'dry' && r.actions.length) { // the market decides the exit fill; a refused exit keeps the position and shouts
      const solUsd = qq.priceNative > 0 ? +qq.priceUsd / +qq.priceNative : null, kept = []; let bankedBack = 0, unitsBack = 0;
      for (const a of r.actions) { const paperUsd = a.usd; const m = !(solUsd > 0) ? { refused: 'no base-coin price' } : pos.evm ? await (deps.evmSell || evmSell)({ cfg, io: deps.evmIo || await evmIo(cfg, pos.execMode === 'live' ? keyPath(cfg.name, cfg.keyDir) : null), token: pos.token, units: a.units, decimals: pos.decimals ?? 18, expectedPx: +qq.priceUsd, ethUsd: solUsd, mode: pos.execMode, taker: cfg.wallet || '0x0000000000000000000000000000000000000001' }) : await (deps.liveSell || liveSell)({ cfg, io: deps.io || defaultIo(cfg), mint: pos.mint, units: a.units, decimals: pos.decimals || 9, expectedPx: +qq.priceUsd, solUsd, mode: pos.execMode, keyFile: keyPath(cfg.name, cfg.keyDir), pubkey: cfg.wallet });
        if (m.refused) { J({ type: 'refused', coin: pos.coin, pool: pos.pool, why: 'exit: ' + m.refused, wanted: a.why }); await N(`${NM} problem: could not sell ${pos.coin}`, `${a.why}: ${m.refused}.\nThe position is still open; the bot keeps trying each check. If it keeps failing, sell by hand.`, 'high'); unitsBack += a.units; bankedBack += a.usd; continue; }
        pos.bankedUsd += m.fill.usd - paperUsd; a.usd = m.fill.usd; a.px = m.fill.px; a.sig = m.fill.sig; a.market = m.why; kept.push(a); }
      if (unitsBack > 0) { pos.remUnits += unitsBack; pos.bankedUsd -= bankedBack; if (pos.closeNow) pos.closeNow = false; pos.sells = pos.sells.filter((x) => kept.includes(x)); }
      r.actions = kept; }
    for (const a of r.actions) { st.cash += a.usd; const pnl = a.all ? pnlOf(pos, 0) : null;
      if (a.all) { st.days[dayKey(now)] = (st.days[dayKey(now)] || 0) + pnl; }
      J({ type: 'sell', coin: pos.coin, pool: pos.pool, ...a, pnl });
      await TN(`${NM} (${pos.execMode === 'live' ? 'LIVE' : pos.execMode === 'quote' ? 'rehearsal' : 'dry run'}): SELL ${a.all ? 'ALL ' : ''}${pos.coin}`, `${pos.execMode === 'live' ? 'Sold' : 'Would sell'} ${usd(a.usd)} of ${pos.coin} at ~${fmt(a.px)}: ${a.why}.${a.all ? `\nTrade result: ${pnl >= 0 ? '+' : ''}${usd(pnl)} (${((pnl / pos.costUsd) * 100).toFixed(1)}%).` : pos.free ? '\nNow riding free: the stake is back, the rest cannot lose money.' : pos.tp1Done ? `\nStop now at ${fmt(pos.stop)}.` : ''}${a.market ? '\nMarket: ' + a.market : ''}${pos.url ? '\n' + pos.url : ''}\n${pos.execMode === 'live' ? 'LIVE: real order.' : pos.execMode === 'quote' ? 'REHEARSAL: real quote, nothing sent.' : 'DRY RUN: no order was placed.'}`, a.all && pnl < 0 ? 'high' : 'default'); }
    if (pos.remUnits <= 1e-12) { const pnl = pnlOf(pos, 0); st.closed.push({ ...pos, closedAt: nowIso, pnl, R: pos.riskUsd > 0 ? +(pnl / pos.riskUsd).toFixed(2) : null, exitAvg: pos.units > 0 ? +(pos.bankedUsd / pos.units).toPrecision(6) : null }); st.positions.splice(i, 1); i--; }
  }
  st.closed = st.closed.slice(-500);
  // 4. entries: only setups near their zone get 5-minute candles; the trigger decides
  const stopFile = fs.existsSync(F.stop) || fs.existsSync(F.stopAll), eq = equity(st, q);
  if (st.dayKey !== dayKey(now)) { st.dayKey = dayKey(now); st.dayStartEq = eq; } // the day's loss counts open positions too, not only what has been sold
  const dayLoss = Math.min(st.days[dayKey(now)] || 0, eq - (st.dayStartEq ?? eq));
  const blockWhy = cfg.enabled === false ? 'new buys were switched off' : stopFile ? 'new buys were switched off (STOP file)' : dayLoss <= -(cfg.dailyLossPct / 100) * st.start ? 'the daily loss limit was hit' : st.positions.length >= cfg.maxOpen ? `all ${cfg.maxOpen} position slots were full` : null, canBuy = !blockWhy;
  { const last = st.blocks[st.blocks.length - 1], openSpan = last && last[1] == null; if (openSpan && last[2] !== blockWhy) last[1] = nowIso; if (blockWhy && !(openSpan && last[2] === blockWhy)) st.blocks.push([nowIso, null, blockWhy]); st.blocks = st.blocks.slice(-300); }
  if (canBuy) for (const s of watchList) {
    const qq = q[String(s.pool).toLowerCase()], price = qq ? +qq.priceUsd : null; if (!(price > 0)) continue;
    let d; if (cfg.entry === 'limit') d = decideLimit(s, price, nowSec, cfg);
    else if (cfg.entry === 'market') { const age = nowSec - Date.parse(s.at) / 1000, maxAge = cfg.signalMaxAgeH || cfg.degenMaxAgeH || 2, chase = cfg.chaseLimitPct || 15, stop = cfg.fixedStopPct ? +(price * (1 - cfg.fixedStopPct / 100)).toPrecision(6) : +s.stop, stopPct = +((1 - stop / price) * 100).toFixed(1);
      d = age > maxAge * 3600 ? { act: 'drop', why: `signal is over ${maxAge} hour${maxAge === 1 ? '' : 's'} old` } : price > s.zoneHigh * (1 + chase / 100) ? { act: 'drop', why: `price already ${chase}%+ over the signal price: no chasing` } : price < s.stop ? { act: 'drop', why: 'price is already under the signal\'s stop' } : stopPct > (cfg.maxStopPct || 45) ? { act: 'drop', why: `stop would be ${stopPct.toFixed(0)}% away: too wide` } : stopPct < (cfg.minStopPct || 0) && !cfg.fixedStopPct ? { act: 'drop', why: `stop only ${stopPct}% away: too tight to survive noise` } : { act: 'buy', price, stop, stopPct, kind: `market on the ${s.kind} signal`, why: [s.kind === 'degen' ? 'degen runner, bought on sight' : s.kind === 'runner' ? 'runner, bought on sight' : 'ignition candle, bought at the next check', ...(s.why || []).slice(0, 3)] }; }
    else { if (price > s.zoneHigh * (1 + cfg.nearZonePct / 100) || price < s.stop) continue; const b = await C5c(s.chain, s.pool); if (!b) continue; d = decideEntry(s, b, price, nowSec, cfg); }
    if (!d) continue; d = { ...d };
    if (d.act === 'drop') { s.dropped = true; s.dropWhy = d.why; J({ type: 'drop', coin: s.coin, pool: s.pool, why: d.why }); continue; }
    // survivor gate (edge report: 79% of launches never trade after day one): a pool younger than minAgeH is not traded
    const ageH = qq.pairCreatedAt ? (now - +qq.pairCreatedAt) / 3600e3 : null; if (cfg.minAgeH > 0 && ageH != null && ageH < cfg.minAgeH) { s.dropped = true; s.dropWhy = 'too young'; J({ type: 'drop', coin: s.coin, pool: s.pool, why: `pool is ${ageH.toFixed(1)} hours old (under ${cfg.minAgeH})` }); continue; }
    // the pool must still be there: liquidity can be pulled between the scan and the fill
    const liq = +(qq.liquidity && qq.liquidity.usd) || 0; if (liq < cfg.minLiqUsd) { s.dropped = true; s.dropWhy = 'liquidity too thin at buy time'; J({ type: 'drop', coin: s.coin, pool: s.pool, why: `liquidity is now $${Math.round(liq / 1000)}k (under $${Math.round(cfg.minLiqUsd / 1000)}k)` }); continue; }
    if (s.liq0 > 0 && liq < s.liq0 * (1 - cfg.liqDropPct / 100)) { s.dropped = true; s.dropWhy = 'liquidity being pulled'; J({ type: 'drop', coin: s.coin, pool: s.pool, why: `liquidity fell ${Math.round((1 - liq / s.liq0) * 100)}% since the setup: likely being pulled` }); continue; }
    // size on the real loss at the stop, with price impact for this pool's size: from the fill (price plus costs) to the stop less costs. Two passes, because the cost depends on the size.
    const openRisk = st.positions.reduce((a, p) => a + (p.free ? 0 : Math.max(0, p.remUnits * (p.entry - p.stop * (1 - (p.slipOut ?? cfg.slipPct) / 100)))), 0);
    const dial = cfg.regimeDial ? (st.dial ?? 1) : 1, dcfg = { ...cfg, riskPct: cfg.riskPct * dial };
    let riskPct = +((1 - (d.stop * (1 - cfg.slipPct / 100)) / (d.price * (1 + cfg.slipPct / 100))) * 100).toFixed(2), sz = sizeFor({ equity: eq, cash: st.cash }, { stopPct: riskPct }, liq, openRisk, dcfg);
    { const c = costPct(sz.usd, liq, cfg); riskPct = +((1 - (d.stop * (1 - c.outPct / 100)) / (d.price * (1 + c.inPct / 100))) * 100).toFixed(2); sz = sizeFor({ equity: eq, cash: st.cash }, { stopPct: riskPct }, liq, openRisk, dcfg); }
    if (sz.usd < 10) { J({ type: 'skip', coin: s.coin, why: 'size too small (' + (sz.cut || 'limits') + ')' }); s.dropped = true; s.dropWhy = 'size too small (' + (sz.cut || 'limits') + ')'; continue; }
    // quote (rehearsal) and live: the market's own quote decides the fill; live also sends it. Dry: paper fill from the DexScreener price.
    let mkt = null; if (st.execMode !== 'dry') {
      if (!s.token) { J({ type: 'skip', coin: s.coin, why: 'no token address for a market quote' }); s.dropped = true; continue; }
      const openUsd = st.positions.reduce((a, p) => a + p.remUnits * (p.lastPx || p.entry), 0), usdCap = Math.min(sz.usd, cfg.liveMaxUsd, Math.max(0, cfg.liveMaxOpenUsd - openUsd)); if (usdCap < 10) { J({ type: 'skip', coin: s.coin, why: `live caps: $${usdCap.toFixed(0)} left under liveMaxOpenUsd $${cfg.liveMaxOpenUsd}` }); s.dropped = true; continue; }
      const isRh = /robinhood/i.test(s.chain), baseUsd = qq.priceNative > 0 ? +qq.priceUsd / +qq.priceNative : null; if (!(baseUsd > 0)) { J({ type: 'skip', coin: s.coin, why: 'no base-coin price in the quote' }); continue; }
      if ((isRh ? 'robinhood' : 'solana') !== (cfg.walletChain || 'solana') && st.execMode === 'live') { J({ type: 'skip', coin: s.coin, why: `this bot's wallet is on ${cfg.walletChain || 'solana'}, the coin is on ${s.chain}` }); s.dropped = true; continue; }
      const r = isRh ? await (deps.evmBuy || evmBuy)({ cfg, io: deps.evmIo || await evmIo(cfg, st.execMode === 'live' ? keyPath(cfg.name, cfg.keyDir) : null), token: s.token, usd: usdCap, expectedPx: d.price, ethUsd: baseUsd, mode: st.execMode, taker: cfg.wallet || '0x0000000000000000000000000000000000000001', log: console.log })
        : await (deps.liveBuy || liveBuy)({ cfg, io: deps.io || defaultIo(cfg), mint: s.token, usd: usdCap, expectedPx: d.price, solUsd: baseUsd, mode: st.execMode, keyFile: keyPath(cfg.name, cfg.keyDir), pubkey: cfg.wallet, log: console.log });
      if (r.refused) { J({ type: 'refused', coin: s.coin, pool: s.pool, why: r.refused, quoted: r.quoted || null }); await N(`${NM}: order refused`, `${s.coin}: ${r.refused}.${st.execMode === 'live' ? ' No money moved.' : ''}`, 'default'); s.dropped = true; s.dropWhy = 'order refused: ' + r.refused; continue; }
      mkt = r; sz.usd = r.fill.usd; sz.riskUsd = +(r.fill.usd * riskPct / 100).toFixed(2); d = { ...d, price: r.fill.px }; }
    const ladder = cfg.exit === 'ladder', mom = cfg.exit === 'momentum', pos = { ...(mom ? openMomentum({ ...s, url: qq.url }, d, sz.usd, nowIso, { ...cfg, slipPct: mkt ? 0 : cfg.slipPct }, mkt ? 0 : liq) : ladder ? openLadder({ ...s, url: qq.url }, d, sz.usd, nowIso, { ...cfg, slipPct: mkt ? 0 : cfg.slipPct }, mkt ? 0 : liq) : openPosition({ ...s, url: qq.url }, d, sz.usd, nowIso, { ...cfg, slipPct: mkt ? 0 : cfg.slipPct }, mkt ? 0 : liq)), ...(mkt ? { units: mkt.fill.units, remUnits: mkt.fill.units, entry: mkt.fill.px, token: s.token, mint: s.token, decimals: mkt.fill.decimals || null, execMode: st.execMode, sig: mkt.fill.sig, route: mkt.fill.route, venue: mkt.fill.venue || null, evm: /robinhood/i.test(s.chain), slipOut: 0 } : {}), setup: s.setup, kind: d.kind, book: cfg.realityBook, riskUsd: sz.riskUsd, lastPx: price, lastAt: nowIso,
      meta: { opp: s.opp ?? null, signal: s.kind, ageH: ageH != null ? +ageH.toFixed(1) : null, zoneLow: s.zoneLow, zoneHigh: s.zoneHigh, rr2: s.rr2 ?? null, rr: s.rr ?? null, rangeLo: s.rangeLo ?? null, rangeHi: s.rangeHi ?? null, discount: s.discount ?? null, retPct: s.retPct ?? null, volX: s.volX ?? null, ch24: s.ch24 ?? null, checks: s.checks || null, riskPct: s.riskPct ?? null, volDay: s.volDay ?? null, stopPct: d.stopPct, why: d.why, setupAt: s.at, liq0: s.liq0 || null, trigPx: d.trigPx ?? null, trigAt: d.trigAt ?? null, quotePx: price, liq, impactPct: costPct(sz.usd, liq, cfg).impactPct, costInPct: +costPct(sz.usd, liq, cfg).inPct.toFixed(2) } }; st.positions.push(pos); st.cash -= sz.usd; s.dropped = true;
    J({ type: 'buy', coin: s.coin, pool: s.pool, usd: sz.usd, entry: pos.entry, stop: pos.stop, why: d.why, mode: st.execMode, sig: mkt ? mkt.fill.sig : null, market: mkt ? mkt.why : null, dial });
    const plan = mom ? `Stop at the ignition candle's low. Once up 30%: trail 25% off the high, 90% out when it hits (or on a red, faded hour); the 10% moonbag trails 45% for up to 7 days.` : ladder ? (pos.targets.length === 1 ? `Everything out at the range high ${fmt(pos.targets[0])}; cancelled at the stop; out after ${cfg.maxHoldH} hours.` : `Targets: ${pos.shares ? pos.targets.map((t, i) => `${Math.round(pos.shares[i] * 100)}% at ${fmt(t)}`).join(', ') : `a third at ${fmt(pos.targets[0])} (stop to break-even), a third at ${fmt(pos.targets[1])}, the rest at ${fmt(pos.targets[2])}`}; out after ${Math.round(cfg.maxHoldH / 24)} days.`)
      : `TP1 ${fmt(pos.tp1)} (+1R): sell a third, stop to break-even.\nRide free at ${fmt(pos.freeAt)} (2x): sell enough to get the stake back.\nThen out on a 5-minute close 50% under the best close, or after 72 hours.`;
    await TN(`${NM} (${st.execMode === 'live' ? 'LIVE' : st.execMode === 'quote' ? 'rehearsal' : 'dry run'}): BUY ${s.coin}`, `${st.execMode === 'live' ? 'Bought' : 'Would buy'} ${usd(sz.usd)} of ${s.coin} (${s.chain}) at ~${fmt(d.price)} (limit ${fmt(d.price * 1.01)}; pool $${Math.round(liq / 1000)}k, costs about ${costPct(sz.usd, liq, cfg).inPct.toFixed(1)}% each way).\nStop ${fmt(pos.stop)} (${d.stopPct}% under the price; ${riskPct}% loss at the stop after costs, risk ${usd(sz.riskUsd)}).\n${plan}\nWhy: ${s.setup || 'setup'} (${s.kind === 'bid' ? 'bid-ready' : s.kind === 'brk' ? `reward to risk ${s.rr2 ?? '?'}R to TP2` : 'worth watching'}), ${d.why.join(', ')}${sz.cut ? ` · size cut by the ${sz.cut}` : ''}${dial !== 1 ? ` · size x${dial} (${st.dialWhy || 'market dial'})` : ''}.${mkt ? '\nMarket: ' + mkt.why : ''}${qq.url ? '\n' + qq.url : ''}\n${st.execMode === 'live' ? 'LIVE: real order, tx ' + (mkt.fill.sig || '') : st.execMode === 'quote' ? 'REHEARSAL: real quote, nothing sent.' : 'DRY RUN: no order was placed.'}`, 'high');
    if (st.positions.length >= cfg.maxOpen) break;
  }
  if (c5t) await H('candles', c5g ? false : 'no candles returned', { afterMin: 30, title: '5-minute candles', text: (m) => `Can't get 5-minute candles from GeckoTerminal for ${m} minutes.\nNo new entries can trigger, and the after-2x giveback exit is paused (stops and targets still work on the live price).\nUsually a GeckoTerminal outage or rate limit that clears by itself.` });
  // 5. daily summary (off by default: the heartbeat proves it's alive)
  if (cfg.dailySummary && bne(now).getUTCHours() >= cfg.summaryHourBrisbane && st.summaryDay !== dayKey(now)) { st.summaryDay = dayKey(now); const today = st.closed.filter((p) => dayKey(Date.parse(p.closedAt)) === dayKey(now)), e = equity(st, q);
    await N(`${NM} (dry run): daily summary`, `Paper account ${usd(e)} (started ${usd(st.start)}, ${((e / st.start - 1) * 100).toFixed(1)}%).\nToday: ${today.length} closed (${today.filter((p) => p.pnl > 0).length} won), ${usd(today.reduce((a, p) => a + p.pnl, 0))}.\nOpen: ${st.positions.map((p) => p.coin + (p.free ? ' (riding free)' : '')).join(', ') || 'none'}. Watching ${Object.keys(st.setups).length} setups.${stopFile ? '\nNew entries are OFF (a STOP file exists).' : ''}`); }
  // 6. reality check every realityEveryDays days: the bot's trades against the paper "Bot rules" book on the same coins
  const every = cfg.realityBook ? (cfg.realityEveryDays || 14) * 86400e3 : 0, since = st.realityAt || Date.parse(st.startedAt);
  if (every > 0 && now - since >= every && now - (st.realityTryAt || 0) > 3600e3) { st.realityTryAt = now;
    try { const rows = await G(cfg.site + 'lab.json', 60000), r = reality(st, (deps.readJournal || (() => readJournal(F)))(), Array.isArray(rows) ? rows : [], { now, cfg: { ...REALITY, book: cfg.realityBook || 'exec' } }); st.realityAt = now;
      (deps.saveReality || ((x) => saveReality(F, x)))(r); J({ type: 'reality', n: r.n, gapPct: r.gapPct, gapR: r.gapR, call: r.call });
      await N(`${NM} (dry run): reality check`, reportText(r, now + every)); } catch (e) { console.log('reality check: ' + e.message); } }
  // 6a. the kitty: banked profit above the pot's start size is swept out (paper books; in live mode the SOL or ETH really moves to your kitty wallet)
  { const sw = sweepPlan(st, cfg); if (sw) { if (st.execMode !== 'live') { applySweep(st, sw.usd, { at: nowIso, mode: st.execMode || 'dry' }); J({ type: 'kitty', usd: sw.usd, kitty: st.kitty, mode: st.execMode || 'dry' }); console.log(`[${nowIso}] ${NM}: swept $${sw.usd} of banked profit to the kitty (now $${st.kitty}); pot back to $${sw.potAfter}`); }
      else if (!validKitty(cfg.kittyWallet, cfg.walletChain)) { if (!st.kittyWarned) { st.kittyWarned = true; await N(`${NM}: profit waiting for a kitty wallet`, `$${sw.usd} of banked profit is sitting in the trading pot. ${cfg.kittyWallet ? 'The kittyWallet in config does not look like an address on ' + (cfg.walletChain || 'solana') + '. Fix it' : 'Add'} "kittyWallet": "<your Phantom's public address on ${cfg.walletChain || 'solana'}>" to this bot's config and it will be sent there (and out of harm's way) at the next check.`); } }
      else if (now - (st.sweepTryAt || 0) > 15 * 60e3) { st.sweepTryAt = now; try { const isRh = /robinhood/i.test(cfg.walletChain || ''), nativeUsd = st.solUsd || null, io = isRh ? (deps.evmIo || await evmIo(cfg, keyPath(cfg.name, cfg.keyDir))) : (deps.io || defaultIo(cfg));
          const bal = isRh ? Number(await io.ethBalance(cfg.wallet)) / 1e18 : await io.solBalance(cfg.wallet), amt = nativeFor(sw.usd, nativeUsd, bal, isRh ? (cfg.ethReserve ?? 0.002) : (cfg.feeReserveSol || LIVE.feeReserveSol));
          if (amt == null) throw new Error(!(nativeUsd > 0) ? 'no base-coin price yet' : `wallet holds ${bal.toFixed(4)}, not enough to send ${(sw.usd / nativeUsd).toFixed(4)} and keep the fee reserve`);
          const sig = isRh ? await io.transferEth(cfg.kittyWallet, amt) : await io.transferSol(keyPath(cfg.name, cfg.keyDir), cfg.kittyWallet, amt); applySweep(st, sw.usd, { at: nowIso, mode: 'live', native: amt, sig }); J({ type: 'kitty', usd: sw.usd, kitty: st.kitty, mode: 'live', native: amt, sig });
          await N(`${NM}: profit sent to your kitty`, `$${sw.usd} (${amt} ${isRh ? 'ETH' : 'SOL'}) sent from the bot's wallet to ${cfg.kittyWallet.slice(0, 6)}…${cfg.kittyWallet.slice(-4)}. Kitty total $${st.kitty}. The pot is back to $${sw.potAfter}.`); await H('kitty', false, { title: 'sending profit to the kitty' }); }
        catch (e) { console.log('kitty sweep: ' + e.message); await H('kitty', e.message, { afterMin: 120, title: 'sending profit to the kitty', text: (m, why) => `Can't send banked profit to the kitty wallet (${why}). The profit stays in the bot's wallet and the sweep is retried every 15 minutes; the bot trades on.` }); } } } }
  // equity curve every 5 minutes (the desk dashboard draws it)
  if (now - (st.eqAt || 0) >= 5 * 60e3) { st.eq = [...(st.eq || []), [now, +equity(st, q).toFixed(2)]].slice(-5000); st.eqAt = now; }
  // 6b. publish this bot's record to the scanner once an hour (only with a GitHub token on the server)
  if (cfg.publish === true && (deps.token ?? process.env.GITHUB_TOKEN) && now - (st.pubAt || 0) >= (cfg.publishMin || 60) * 60e3) { st.pubAt = now; try { const rec = recordFor(cfg.name, { st, cfg, journal: (deps.readJournal || (() => readJournal(F)))().slice(-200), now }); const r = await (deps.publish || publish)(cfg.name, rec, { token: deps.token ?? process.env.GITHUB_TOKEN, fetcher: deps.fetcher }); if (r.ok) st.pubOk = nowIso; await H('publish', false, { title: 'publishing to the scanner' }); } catch (e) { console.log('publish: ' + e.message); await H('publish', e.message, { afterMin: 180, title: 'publishing to the scanner', text: (m, why) => `Can't publish the bot's record to GitHub for ${m} minutes (${why}).\nThe bot trades on; the council just does not see its fills. Check the GITHUB_TOKEN in /etc/rynobot.env (Contents: read and write on RYNOSCAN).` }); } }
  // 7. heartbeat to the silent <topic>-hb topic; the GitHub watchdog alerts the phone if these stop
  if (cfg.heartbeatMin > 0 && now - (st.hbAt || 0) >= cfg.heartbeatMin * 60e3) { st.hbAt = now; await (deps.heartbeat || heartbeat)(`hb:${cfg.name || 'rules'} ${nowIso} open=${st.positions.length} watching=${Object.keys(st.setups).length}`); }
  st.lastCycleAt = now;
  return st;
}
// Breakout retest setups from the scanner (breakouts.json), filtered like the paper twin ("Breakout retest · bot filters"): $100k+ liquidity,
// no rug danger, score over minOpp, stop no wider than maxStopPct, one per coin per 24 hours, and the tuner's active filters (council.json).
// the scanner's runners list (runners.json) for the runner bot: the paper Risky book's rule, 3 of 4 checks and no risk rule, 2 new per scan
async function runnerSetupsIn(st, cfg, { G, J, now, nowIso }) {
  const r = await G(cfg.site + 'runners.json'), at = r && r.at ? Date.parse(r.at) : now; if (st.runnersAt === at) return; st.runnersAt = at;
  for (const x of runnerSetups(r && r.items, { minPassed: cfg.runnerMinPassed || 3, maxNew: cfg.runnerMaxNew || 2, minLiqUsd: cfg.minLiqUsd })) {
    if (st.setups[x.pool] || now - ((st.seen || {})[x.pool] || 0) < cfg.coolH * 3600e3) continue; (st.seen ||= {})[x.pool] = now;
    st.setups[x.pool] = { pool: x.pool, coin: x.coin, chain: x.chain, token: x.token, kind: 'runner', setup: 'Runner (3 of 4 checks)', opp: x.opp, zoneLow: x.price, zoneHigh: x.price, stop: +(x.price * 0.8).toPrecision(6), mults: cfg.mults, shares: cfg.shares, why: x.why, checks: x.checks, expireH: cfg.signalMaxAgeH || 2, at: new Date(at).toISOString().slice(0, 19) + 'Z', liq0: x.liq };
    J({ type: 'setup', coin: x.coin, pool: x.pool, kind: 'runner', zoneLow: x.price, zoneHigh: x.price, stop: st.setups[x.pool].stop, why: x.why }); }
}
// the degen desk's new paper trades (degen.json) become setups for the degen bot: one per coin per 24 hours
async function degenSetups(st, cfg, { G, J, now, nowIso }) {
  const rows = await G(cfg.site + 'degen.json'); for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.pool || st.setups[r.pool] || !(r.entryMid > 0) || !(r.stop > 0)) continue; if (now - Date.parse(r.signalAt) > (cfg.degenMaxAgeH || 2) * 3600e3 || !['waiting for entry', 'open'].includes(r.status)) continue;   // still open on the degen desk, up to a day old; the entry rule refuses anything 15%+ above the signal price or under its stop
    if ((r.liq ?? 0) < cfg.minLiqUsd) continue; if (now - ((st.seen || {})[r.pool] || 0) < cfg.coolH * 3600e3) continue; (st.seen ||= {})[r.pool] = now;
    st.setups[r.pool] = { pool: r.pool, coin: r.coin, chain: r.chain, token: r.token || null, kind: 'degen', setup: 'Degen runner', opp: r.score ?? null, zoneLow: +r.entryMid, zoneHigh: +r.entryMid, stop: +r.stop, why: Array.isArray(r.why) ? r.why : [], expireH: cfg.degenMaxAgeH || 24, at: r.signalAt || nowIso, liq0: +r.liq || 0 };
    J({ type: 'setup', coin: r.coin, pool: r.pool, kind: 'degen', zoneLow: +r.entryMid, zoneHigh: +r.entryMid, stop: +r.stop }); }
}
function readCommands(F) { try { const lines = fs.readFileSync(F.cmd, 'utf8').split('\n').filter(Boolean); fs.writeFileSync(F.cmd, '', { mode: 0o664 }); return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
async function breakoutSetups(st, cfg, { G, J, N, now, nowIso }) {
  const [rows, council] = await Promise.all([G(cfg.site + 'breakouts.json'), cfg.autoTune ? G(cfg.site + 'council.json').catch(() => null) : null]);
  const t = council && council.botTuning && council.botTuning[cfg.tuneKey], start = (TUNE[cfg.tuneKey] || { start: [] }).start, active = cfg.autoTune && t && Array.isArray(t.active) ? t.active : start;
  if (st.filters && JSON.stringify(st.filters) !== JSON.stringify(active)) { const on = active.filter((k) => !st.filters.includes(k)), off = st.filters.filter((k) => !active.includes(k));
    J({ type: 'filters', active, on, off }); await N(`${cfg.label}: filters changed`, `The bot tuner changed which setups this bot takes, because new trades confirmed it.${on.length ? `\nOn: ${on.map(labelOf).join('; ')}.` : ''}${off.length ? `\nOff: ${off.map(labelOf).join('; ')}.` : ''}\nNow active: ${active.length ? active.map(labelOf).join('; ') : 'no filters'}.\nSizing, stops and targets did not change. Dry run.`); }
  st.filters = active;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.pool || st.setups[r.pool] || !(r.zoneHigh > 0) || !(r.stop > 0) || !(r.tp1 > r.zoneHigh)) continue;
    if (!((r.opp ?? 0) >= cfg.minOpp) || (r.liquidity ?? 0) < cfg.minLiqUsd || r.rug === 'danger' || !(r.riskPct <= cfg.maxStopPct) || !keepsAll(active, r)) continue;
    if (now - Date.parse(r.at || nowIso) > (r.expireH || 48) * 3600e3) continue;
    if (now - ((st.seen || {})[r.pool] || 0) < cfg.coolH * 3600e3) continue; (st.seen ||= {})[r.pool] = now;
    st.setups[r.pool] = { pool: r.pool, coin: r.coin, chain: r.chain, token: r.token || null, kind: 'brk', setup: 'Breakout retest', opp: r.opp, zoneLow: +r.zoneLow, zoneHigh: +r.zoneHigh, stop: +r.stop, tp1: +r.tp1, tp2: +r.tp2 || null, tp3: +r.tp3 || null, rr2: r.rr2, riskPct: r.riskPct, volDay: r.volDay, expireH: r.expireH || 48, at: r.at || nowIso, liq0: +r.liquidity || 0 };
    J({ type: 'setup', coin: r.coin, pool: r.pool, kind: 'brk', zoneLow: +r.zoneLow, zoneHigh: +r.zoneHigh, stop: +r.stop, filters: active });
  }
}
export function equity(st, q = {}) { return st.cash + st.positions.reduce((a, p) => { const x = q[String(p.pool).toLowerCase()], px = x ? +x.priceUsd : p.entry; return a + p.remUnits * (px > 0 ? px : 0); }, 0); }

async function main() {
  const args = process.argv.slice(2), bi = args.indexOf('--bot'), name = bi >= 0 ? args[bi + 1] : 'rules', cfg = loadConfig(name), F = filesFor(name), NM = cfg.label;
  if (!['dry', 'quote', 'live'].includes(cfg.mode)) { console.error(`${NM}: "mode" must be dry, quote or live in bot/config.json.`); process.exit(1); }
  if (cfg.mode === 'live') { const why = liveCheck(cfg, { dir: path.dirname(F.stop) }); if (why) console.error(`${NM}: live was asked for but refused (${why}). Running in dry-run mode.`); }
  if (args.includes('--check')) { let ok = true; try { const f = cfg.source === 'breakouts' ? 'breakouts.json' : 'setups.json', s = await getJson(cfg.site + f); console.log(`scanner data (${NM}): ${Array.isArray(s) ? s.length : 0} setups in ${f}`); } catch (e) { ok = false; console.log('scanner data FAILED: ' + e.message); }
    try { const q = await getJson('https://api.dexscreener.com/latest/dex/search?q=SOL'); console.log('DexScreener: ok (' + ((q.pairs || []).length) + ' pairs)'); } catch (e) { ok = false; console.log('DexScreener FAILED: ' + e.message); }
    try { const g = await getJson('https://api.geckoterminal.com/api/v2/networks'); console.log('GeckoTerminal: ok (' + ((g.data || []).length) + ' networks)'); } catch (e) { ok = false; console.log('GeckoTerminal FAILED: ' + e.message); }
    console.log(process.env.NTFY_TOPIC ? 'ntfy topic: set' : 'ntfy topic: NOT set (alerts only go to the log)'); process.exit(ok ? 0 : 1); }
  if (args.includes('--reset')) { const tag = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); for (const f of [F.state, F.journal, F.reality]) if (fs.existsSync(f)) fs.renameSync(f, f + '.old-' + tag); console.log(`${NM}: paper account reset. The old files were kept with .old-${tag} on the end. It starts again with $${cfg.accountUsd.toLocaleString('en')} when the service restarts: systemctl restart rynobot@${name}`); process.exit(0); }
  let st = rd(F.state, null) || newState(cfg);
  // a bot that has not traded yet takes the configured account size (so changing accountUsd needs no reset)
  if (st.start !== cfg.accountUsd && !st.positions.length && !st.closed.length) { st.cash = st.start = cfg.accountUsd; st.eq = []; st.eqAt = 0; }
  if (args.includes('--status')) { const q = await quotes(st.positions).catch(() => ({})), e = equity(st, q), wins = st.closed.filter((p) => p.pnl > 0).length;
    console.log(`${NM}: paper account ${usd(e)} (started ${usd(st.start)}, ${((e / st.start - 1) * 100).toFixed(1)}%) since ${st.startedAt || 'not started'}.\nClosed ${st.closed.length} (${wins} won), total ${usd(st.closed.reduce((a, p) => a + p.pnl, 0))}. Kitty ${usd(st.kitty || 0)} (swept profit, not at risk). Watching ${Object.keys(st.setups).length} setups.`);
    if (st.filters) console.log(`  filters: ${st.filters.length ? st.filters.map(labelOf).join('; ') : 'none'}`);
    for (const p of st.positions) { const x = q[String(p.pool).toLowerCase()], px = x ? +x.priceUsd : null; console.log(`  open ${p.coin}: in at ${fmt(p.entry)}, now ${fmt(px)}, ${px ? ((pnlOf(p, px) / p.costUsd) * 100).toFixed(1) + '%' : '?'}${p.free ? ' (riding free)' : ''}`); }
    for (const p of st.closed.slice(-10).reverse()) console.log(`  closed ${p.coin} ${p.closedAt}: ${p.pnl >= 0 ? '+' : ''}${usd(p.pnl)} (${((p.pnl / p.costUsd) * 100).toFixed(1)}%), ${(p.sells[p.sells.length - 1] || {}).why || ''}`);
    for (const [k, v] of Object.entries(st.health || {})) console.log(`  problem: ${k} since ${new Date(v.since).toISOString().slice(0, 16)} (${v.why})`);
    process.exit(0); }
  if (args.includes('--reality')) { const rows = await getJson(cfg.site + 'lab.json', 60000), r = reality(st, readJournal(F), Array.isArray(rows) ? rows : [], { cfg: { ...REALITY, book: cfg.realityBook || 'exec' } }); console.log(reportText(r)); process.exit(0); }
  if (!args.includes('--once')) await notify(`${NM} started (dry run)`, `Account ${usd(st.cash)} cash, ${st.positions.length} open. Checks every ${cfg.pollSec}s. Nothing is ever bought or sold for real.\nYour phone only hears from it if something breaks, when the reality check is ready every ${cfg.realityEveryDays} days, or when it restarts.${cfg.tradeAlerts ? ' Would-be trades are sent too.' : ' Would-be trades stay in the server log (node bot/run.mjs --status).'}`);
  let errN = 0, errAlerted = false;
  for (;;) {
    try { st = await cycle(st, cfg); wr(F.state, st); if (errAlerted) await notify(`${NM}: running normally again`, `Recovered after ${errN} failed checks in a row. Nothing for you to do.`); errN = 0; errAlerted = false; }
    catch (e) { errN++; console.log('cycle failed: ' + (e.stack || e.message)); if (errN === 5) { errAlerted = true; await notify(`${NM} problem: keeps failing`, `The last 5 checks in a row failed: ${String(e.message || e).slice(0, 200)}\nOn the server run: journalctl -u rynobot@${name} -n 50 and send me what it says.`, 'high'); } }
    if (args.includes('--once')) break;
    await new Promise((r) => setTimeout(r, cfg.pollSec * 1000));
  }
}
if (process.argv[1] && process.argv[1].endsWith(path.join('bot', 'run.mjs'))) main();
