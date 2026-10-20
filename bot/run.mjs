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
import { BOT, decideEntry, sizeFor, openPosition, managePosition, pnlOf, decideLimit, openLadder, manageLadder } from './manage.mjs';
import { reality, reportText, REALITY } from './reality.mjs';
import { keepsAll, labelOf, TUNE } from '../docs/tuner.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// each bot: where its setups come from, how it enters and exits, and which paper book its reality check compares against
export const BOTS = {
  rules: { name: 'rules', label: 'RynoBot', source: 'setups', entry: 'trigger', exit: 'stack', realityBook: 'exec' },
  breakout: { name: 'breakout', label: 'RynoBot Breakout', source: 'breakouts', entry: 'limit', exit: 'ladder', realityBook: 'brkBot', tuneKey: 'breakout', autoTune: true, minOpp: 50, maxStopPct: 35, maxHoldH: 168 },
};
export const filesFor = (name = 'rules') => { const x = name === 'rules' ? '' : '-' + name; return { cfg: path.join(DIR, 'config.json'), state: path.join(DIR, `state${x}.json`), journal: path.join(DIR, `journal${x}.jsonl`), stopAll: path.join(DIR, 'STOP'), stop: path.join(DIR, 'STOP' + x), reality: path.join(DIR, `reality${x}.json`) }; };
export const DEFAULTS = { site: 'https://devonflap.github.io/RYNOSCAN/data/', mode: 'dry', enabled: true, accountUsd: 1000, pollSec: 60, setupsEveryMin: 10, minOpp: 65, signals: ['bid', 'watch'], nearZonePct: 10, maxGtPerMin: 20, summaryHourBrisbane: 20, realityEveryDays: 14, minLiqUsd: 100000, coolH: 24, tradeAlerts: false, dailySummary: false, heartbeatMin: 30, ...BOT, ...BOTS.rules };
const DS = { solana: 'solana', robinhood: 'robinhood', ethereum: 'ethereum', eth: 'ethereum' }, GT = { solana: 'solana', robinhood: 'robinhood', ethereum: 'eth', eth: 'eth' };
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wr = (f, o) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, f); };
const isoNow = () => new Date().toISOString().slice(0, 19) + 'Z', bne = (ms = Date.now()) => new Date(ms + 10 * 3600e3), dayKey = (ms) => bne(ms).toISOString().slice(0, 10);
const fmt = (x) => (x == null ? '—' : Number(Number(x).toPrecision(5)).toString()), usd = (x) => '$' + Math.round(x).toLocaleString('en');
// shared settings in bot/config.json apply to every bot; "bots": { "breakout": { ... } } overrides one bot
export function loadConfig(name = 'rules') { const { bots, ...shared } = rd(filesFor(name).cfg, {}); if (!BOTS[name]) throw new Error('unknown bot: ' + name + ' (bots: ' + Object.keys(BOTS).join(', ') + ')'); return { ...DEFAULTS, ...shared, ...BOTS[name], ...((bots && bots[name]) || {}) }; }
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
// GeckoTerminal 5-minute candles (free, about 30 calls a minute): [[t, o, h, l, c, v]] oldest first
let gtCalls = [];
async function candles5(chain, pool, cfg) {
  const now = Date.now(); gtCalls = gtCalls.filter((t) => now - t < 60e3); if (gtCalls.length >= cfg.maxGtPerMin) return null; gtCalls.push(now);
  const net = GT[String(chain).toLowerCase()]; if (!net) return null;
  try { const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=5&limit=150&currency=usd&token=base`); const raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list; return Array.isArray(raw) ? raw.map((r) => r.map(Number)).sort((a, b) => a[0] - b[0]) : null; } catch (e) { console.log('candles: ' + e.message); return null; }
}

export async function cycle(st, cfg, deps = {}) {
  const F = filesFor(cfg.name), Q = deps.quotes || quotes, C5 = deps.candles5 || ((c, p) => candles5(c, p, cfg)), N = deps.notify || notify, J = deps.journal || journalTo(F), G = deps.getJson || getJson;
  const NM = cfg.label || 'RynoBot', H = (key, bad, o) => health(st, key, bad, now, N, o, NM);
  const now = deps.now || Date.now(), nowSec = now / 1000, nowIso = new Date(now).toISOString().slice(0, 19) + 'Z';
  const TN = cfg.tradeAlerts ? N : async (t, b) => console.log(`[${nowIso}] ${t}\n  ${b.replace(/\n/g, '\n  ')}`); // would-be trades: log only unless tradeAlerts
  // 5-minute candles: one fetch per coin per closed candle (45 seconds after each close), kept in memory only
  if (!st._c5) Object.defineProperty(st, '_c5', { value: new Map(), enumerable: false });
  let c5t = 0, c5g = 0; const slot = Math.floor((nowSec - 45) / 300), C5c = async (c, p) => { const k = String(p).toLowerCase(), hit = st._c5.get(k); if (hit && hit.slot === slot) return hit.bars; c5t++; const b = await C5(c, p); if (b) { c5g++; st._c5.set(k, { slot, bars: b }); } return b; };
  // offline spells (server down, bot restarted) are remembered so the reality check can tell "bot was offline" from a real miss
  st.startedAt ||= nowIso; st.gaps ||= []; st.blocks ||= [];
  if (st.lastCycleAt && now - st.lastCycleAt > Math.max(5 * 60e3, cfg.pollSec * 5e3)) { st.gaps.push([new Date(st.lastCycleAt).toISOString().slice(0, 19) + 'Z', nowIso]); st.gaps = st.gaps.slice(-300); }
  // 1. setups from the scanner. rules: bid-ready and worth-watching with a zone and an invalidation (24 hours). breakout: Breakout retests (48 hours)
  if (now - (st.setupsAt || 0) > cfg.setupsEveryMin * 60e3) {
    try { if (cfg.source === 'breakouts') await breakoutSetups(st, cfg, { G, J, N, now, nowIso }); else { const [setups, signals] = await Promise.all([G(cfg.site + 'setups.json'), G(cfg.site + 'signals.json').catch(() => [])]);
      // the same setups the paper "Bot rules" book takes (src/scan.mjs): bid-ready or worth watching scored over minOpp, $100k+ liquidity,
      // no rug danger, and one setup per coin per 24 hours (so a stopped-out coin is not bought straight back)
      for (const it of candidates(Array.isArray(setups) ? setups : [], Array.isArray(signals) ? signals : [], cfg.minOpp)) {
        if (!cfg.signals.includes(it.kind) || !it.pool || !(it.entryLow > 0) || !(it.stop > 0) || st.setups[it.pool]) continue;
        if (!((it.opp ?? 0) > cfg.minOpp) || (it.liquidity != null && it.liquidity < cfg.minLiqUsd) || it.rug === 'danger') continue;
        if (now - ((st.seen || {})[it.pool] || 0) < cfg.coolH * 3600e3) continue; (st.seen ||= {})[it.pool] = now;
        st.setups[it.pool] = { pool: it.pool, coin: it.coin, chain: it.chain, kind: it.kind, setup: it.setup, opp: it.opp, zoneLow: +it.entryLow, zoneHigh: +it.entryHigh, stop: +it.stop, at: nowIso }; J({ type: 'setup', coin: it.coin, pool: it.pool, kind: it.kind, zoneLow: +it.entryLow, zoneHigh: +it.entryHigh, stop: +it.stop }); } }
      st.setupsAt = now; await H('scanner', false, { title: 'scanner data' }); } catch (e) { console.log('setups: ' + e.message); st.setupsAt = now - Math.max(0, cfg.setupsEveryMin - 2) * 60e3;
      await H('scanner', e.message || 'error', { afterMin: 30, title: 'scanner data', text: (m, why) => `Can't read the scanner's setups from the dashboard for ${m} minutes (${why}).\nNo new setups are coming in; open positions are still managed.\nIf the dashboard won't load either, GitHub Pages is down and it comes back by itself.` }); }
  }
  for (const [k, s] of Object.entries(st.setups)) if (now - Date.parse(s.at) > ((s.expireH || 24) + 1) * 3600e3 || s.dropped) delete st.setups[k];
  for (const [k, t] of Object.entries(st.seen || {})) if (now - t > 2 * cfg.coolH * 3600e3) delete st.seen[k];
  // 2. prices for everything we watch or hold
  const held = new Set(st.positions.map((p) => p.pool)), watchList = Object.values(st.setups).filter((s) => !held.has(s.pool));
  const items = [...watchList, ...st.positions], q = await Q(items);
  await H('prices', items.length && !Object.keys(q || {}).length ? 'no prices returned' : false, { afterMin: st.positions.length ? 15 : 30, title: 'prices', text: (m) => `Can't get prices from DexScreener for ${m} minutes${st.positions.length ? `, so the ${st.positions.length} open position${st.positions.length === 1 ? ' is' : 's are'} not being checked` : ''}.\nUsually a DexScreener outage that clears by itself. If it lasts hours, run on the server: node bot/run.mjs --check` });
  // 3. manage open positions first (exits never wait behind entries)
  for (let i = 0; i < st.positions.length; i++) {
    let pos = st.positions[i]; const qq = q[String(pos.pool).toLowerCase()]; if (!qq) continue;
    let r; if (pos.mode === 'ladder') r = manageLadder(pos, qq, nowSec, cfg);
    else { let closes = null; if (!st.gtAt[pos.id] || now - st.gtAt[pos.id] > 5 * 60e3) { const b = await C5c(pos.chain, pos.pool); if (b) { closes = b.filter((x) => x[0] + 300 <= nowSec).map((x) => [x[0], x[4]]); st.gtAt[pos.id] = now; } } r = managePosition(pos, qq, closes, nowSec, cfg); }
    pos = st.positions[i] = r.pos;
    for (const a of r.actions) { st.cash += a.usd; const pnl = a.all ? pnlOf(pos, 0) : null;
      if (a.all) { st.days[dayKey(now)] = (st.days[dayKey(now)] || 0) + pnl; }
      J({ type: 'sell', coin: pos.coin, pool: pos.pool, ...a, pnl });
      await TN(`${NM} (dry run): SELL ${a.all ? 'ALL ' : ''}${pos.coin}`, `Would sell ${usd(a.usd)} of ${pos.coin} at ~${fmt(a.px)}: ${a.why}.${a.all ? `\nTrade result: ${pnl >= 0 ? '+' : ''}${usd(pnl)} (${((pnl / pos.costUsd) * 100).toFixed(1)}%).` : pos.free ? '\nNow riding free: the stake is back, the rest cannot lose money.' : pos.tp1Done ? `\nStop now at ${fmt(pos.stop)}.` : ''}${pos.url ? '\n' + pos.url : ''}\nDRY RUN: no order was placed.`, a.all && pnl < 0 ? 'high' : 'default'); }
    if (pos.remUnits <= 1e-12) { st.closed.push({ ...pos, closedAt: nowIso, pnl: pnlOf(pos, 0) }); st.positions.splice(i, 1); i--; }
  }
  st.closed = st.closed.slice(-500);
  // 4. entries: only setups near their zone get 5-minute candles; the trigger decides
  const stopFile = fs.existsSync(F.stop) || fs.existsSync(F.stopAll), dayLoss = st.days[dayKey(now)] || 0, eq = equity(st, q);
  const blockWhy = cfg.enabled === false ? 'new buys were switched off' : stopFile ? 'new buys were switched off (STOP file)' : dayLoss <= -(cfg.dailyLossPct / 100) * st.start ? 'the daily loss limit was hit' : st.positions.length >= cfg.maxOpen ? `all ${cfg.maxOpen} position slots were full` : null, canBuy = !blockWhy;
  { const last = st.blocks[st.blocks.length - 1], openSpan = last && last[1] == null; if (openSpan && last[2] !== blockWhy) last[1] = nowIso; if (blockWhy && !(openSpan && last[2] === blockWhy)) st.blocks.push([nowIso, null, blockWhy]); st.blocks = st.blocks.slice(-300); }
  if (canBuy) for (const s of watchList) {
    const qq = q[String(s.pool).toLowerCase()], price = qq ? +qq.priceUsd : null; if (!(price > 0)) continue;
    let d; if (cfg.entry === 'limit') d = decideLimit(s, price, nowSec, cfg);
    else { if (price > s.zoneHigh * (1 + cfg.nearZonePct / 100) || price < s.stop) continue; const b = await C5c(s.chain, s.pool); if (!b) continue; d = decideEntry(s, b, price, nowSec, cfg); }
    if (!d) continue;
    if (d.act === 'drop') { s.dropped = true; J({ type: 'drop', coin: s.coin, pool: s.pool, why: d.why }); continue; }
    // size on the real loss at the stop: from the fill (price plus entry slippage) down to the stop less exit slippage, so a stop costs 1% of the account, not 1.3%+
    const sl = cfg.slipPct / 100, riskPct = +((1 - (d.stop * (1 - sl)) / (price * (1 + sl))) * 100).toFixed(2);
    const openRisk = st.positions.reduce((a, p) => a + (p.free ? 0 : Math.max(0, p.remUnits * (p.entry - p.stop * (1 - sl)))), 0), sz = sizeFor({ equity: eq, cash: st.cash }, { stopPct: riskPct }, +(qq.liquidity && qq.liquidity.usd) || 0, openRisk, cfg);
    if (sz.usd < 10) { J({ type: 'skip', coin: s.coin, why: 'size too small (' + (sz.cut || 'limits') + ')' }); s.dropped = true; continue; }
    const ladder = cfg.exit === 'ladder', pos = { ...(ladder ? openLadder({ ...s, url: qq.url }, d, sz.usd, nowIso, cfg) : openPosition({ ...s, url: qq.url }, d, sz.usd, nowIso, cfg)), setup: s.setup, kind: d.kind, book: cfg.realityBook }; st.positions.push(pos); st.cash -= sz.usd; s.dropped = true;
    J({ type: 'buy', coin: s.coin, pool: s.pool, usd: sz.usd, entry: pos.entry, stop: pos.stop, why: d.why });
    const plan = ladder ? `Targets: a third at ${fmt(pos.targets[0])} (stop to break-even), a third at ${fmt(pos.targets[1])}, the rest at ${fmt(pos.targets[2])}; out after ${Math.round(cfg.maxHoldH / 24)} days.`
      : `TP1 ${fmt(pos.tp1)} (+1R): sell a third, stop to break-even.\nRide free at ${fmt(pos.freeAt)} (2x): sell enough to get the stake back.\nThen out on a 5-minute close 50% under the best close, or after 72 hours.`;
    await TN(`${NM} (dry run): BUY ${s.coin}`, `Would buy ${usd(sz.usd)} of ${s.coin} (${s.chain}) at ~${fmt(price)} (limit ${fmt(price * 1.01)}).\nStop ${fmt(pos.stop)} (${d.stopPct}% under the price; ${riskPct}% loss at the stop after slippage, risk ${usd(sz.riskUsd)}).\n${plan}\nWhy: ${s.setup || 'setup'} (${s.kind === 'bid' ? 'bid-ready' : s.kind === 'brk' ? `reward to risk ${s.rr2 ?? '?'}R to TP2` : 'worth watching'}), ${d.why.join(', ')}${sz.cut ? ` · size cut by the ${sz.cut}` : ''}.${qq.url ? '\n' + qq.url : ''}\nDRY RUN: no order was placed.`, 'high');
    if (st.positions.length >= cfg.maxOpen) break;
  }
  if (c5t) await H('candles', c5g ? false : 'no candles returned', { afterMin: 30, title: '5-minute candles', text: (m) => `Can't get 5-minute candles from GeckoTerminal for ${m} minutes.\nNo new entries can trigger, and the after-2x giveback exit is paused (stops and targets still work on the live price).\nUsually a GeckoTerminal outage or rate limit that clears by itself.` });
  // 5. daily summary (off by default: the heartbeat proves it's alive)
  if (cfg.dailySummary && bne(now).getUTCHours() >= cfg.summaryHourBrisbane && st.summaryDay !== dayKey(now)) { st.summaryDay = dayKey(now); const today = st.closed.filter((p) => dayKey(Date.parse(p.closedAt)) === dayKey(now)), e = equity(st, q);
    await N(`${NM} (dry run): daily summary`, `Paper account ${usd(e)} (started ${usd(st.start)}, ${((e / st.start - 1) * 100).toFixed(1)}%).\nToday: ${today.length} closed (${today.filter((p) => p.pnl > 0).length} won), ${usd(today.reduce((a, p) => a + p.pnl, 0))}.\nOpen: ${st.positions.map((p) => p.coin + (p.free ? ' (riding free)' : '')).join(', ') || 'none'}. Watching ${Object.keys(st.setups).length} setups.${stopFile ? '\nNew entries are OFF (a STOP file exists).' : ''}`); }
  // 6. reality check every realityEveryDays days: the bot's trades against the paper "Bot rules" book on the same coins
  const every = (cfg.realityEveryDays || 14) * 86400e3, since = st.realityAt || Date.parse(st.startedAt);
  if (every > 0 && now - since >= every && now - (st.realityTryAt || 0) > 3600e3) { st.realityTryAt = now;
    try { const rows = await G(cfg.site + 'lab.json', 60000), r = reality(st, (deps.readJournal || (() => readJournal(F)))(), Array.isArray(rows) ? rows : [], { now, cfg: { ...REALITY, book: cfg.realityBook || 'exec' } }); st.realityAt = now;
      (deps.saveReality || ((x) => saveReality(F, x)))(r); J({ type: 'reality', n: r.n, gapPct: r.gapPct, gapR: r.gapR, call: r.call });
      await N(`${NM} (dry run): reality check`, reportText(r, now + every)); } catch (e) { console.log('reality check: ' + e.message); } }
  // 7. heartbeat to the silent <topic>-hb topic; the GitHub watchdog alerts the phone if these stop
  if (cfg.heartbeatMin > 0 && now - (st.hbAt || 0) >= cfg.heartbeatMin * 60e3) { st.hbAt = now; await (deps.heartbeat || heartbeat)(`hb:${cfg.name || 'rules'} ${nowIso} open=${st.positions.length} watching=${Object.keys(st.setups).length}`); }
  st.lastCycleAt = now;
  return st;
}
// Breakout retest setups from the scanner (breakouts.json), filtered like the paper twin ("Breakout retest · bot filters"): $100k+ liquidity,
// no rug danger, score over minOpp, stop no wider than maxStopPct, one per coin per 24 hours, and the tuner's active filters (council.json).
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
    st.setups[r.pool] = { pool: r.pool, coin: r.coin, chain: r.chain, kind: 'brk', setup: 'Breakout retest', opp: r.opp, zoneLow: +r.zoneLow, zoneHigh: +r.zoneHigh, stop: +r.stop, tp1: +r.tp1, tp2: +r.tp2 || null, tp3: +r.tp3 || null, rr2: r.rr2, riskPct: r.riskPct, volDay: r.volDay, expireH: r.expireH || 48, at: r.at || nowIso };
    J({ type: 'setup', coin: r.coin, pool: r.pool, kind: 'brk', zoneLow: +r.zoneLow, zoneHigh: +r.zoneHigh, stop: +r.stop, filters: active });
  }
}
export function equity(st, q = {}) { return st.cash + st.positions.reduce((a, p) => { const x = q[String(p.pool).toLowerCase()], px = x ? +x.priceUsd : p.entry; return a + p.remUnits * (px > 0 ? px : 0); }, 0); }

async function main() {
  const args = process.argv.slice(2), bi = args.indexOf('--bot'), name = bi >= 0 ? args[bi + 1] : 'rules', cfg = loadConfig(name), F = filesFor(name), NM = cfg.label;
  if (cfg.mode !== 'dry') { console.error('RynoBot: live trading is not built. It stays in dry-run mode until the dry run has 2-4 weeks of results worth trusting. Set "mode": "dry" in bot/config.json.'); process.exit(1); }
  if (args.includes('--check')) { let ok = true; try { const f = cfg.source === 'breakouts' ? 'breakouts.json' : 'setups.json', s = await getJson(cfg.site + f); console.log(`scanner data (${NM}): ${Array.isArray(s) ? s.length : 0} setups in ${f}`); } catch (e) { ok = false; console.log('scanner data FAILED: ' + e.message); }
    try { const q = await getJson('https://api.dexscreener.com/latest/dex/search?q=SOL'); console.log('DexScreener: ok (' + ((q.pairs || []).length) + ' pairs)'); } catch (e) { ok = false; console.log('DexScreener FAILED: ' + e.message); }
    try { const g = await getJson('https://api.geckoterminal.com/api/v2/networks'); console.log('GeckoTerminal: ok (' + ((g.data || []).length) + ' networks)'); } catch (e) { ok = false; console.log('GeckoTerminal FAILED: ' + e.message); }
    console.log(process.env.NTFY_TOPIC ? 'ntfy topic: set' : 'ntfy topic: NOT set (alerts only go to the log)'); process.exit(ok ? 0 : 1); }
  let st = rd(F.state, null) || newState(cfg);
  if (args.includes('--status')) { const q = await quotes(st.positions).catch(() => ({})), e = equity(st, q), wins = st.closed.filter((p) => p.pnl > 0).length;
    console.log(`${NM}: paper account ${usd(e)} (started ${usd(st.start)}, ${((e / st.start - 1) * 100).toFixed(1)}%) since ${st.startedAt || 'not started'}.\nClosed ${st.closed.length} (${wins} won), total ${usd(st.closed.reduce((a, p) => a + p.pnl, 0))}. Watching ${Object.keys(st.setups).length} setups.`);
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
