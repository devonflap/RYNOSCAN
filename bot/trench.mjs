import { solanaHolderGate } from '../docs/overlays.mjs';
// THE TRENCHER (paper only, never live): a pump.fun "trench extractor". New launches on the pump.fun bonding curve, watched live from the
// free PumpPortal feed (wss://pumpportal.fun/api/data: every new token and every buy and sell on it, no key, no account). The play: get in
// in the first minutes once real buyers have shown up, then sell INTO the buyers as the bids come (clips at 1.5x, 2.2x and 3.5x), dump the
// lot the moment sellers take over or the chart goes quiet, never hold past an hour. Most launches die inside ten minutes; this bot
// exists to learn what separates the ones that do not, not to be careful. Loose gates on purpose. Rugs are data.
//
// 23 Oct rebuild (it never fired: every launch aged out at 12 minutes without a dozen buyers, which is what happens when the per-coin
// trade messages never arrive). Three lanes now, so no single feed can silence it:
//   LAUNCH (feed): PumpPortal launches with their live trades, as before, when the trades arrive
//   LAUNCH (DexScreener): the same launches, 2-20 minutes old, judged on DexScreener's counts (buys and sells in 5 minutes, volume,
//     market cap) whenever the feed has no trades for them; works whether or not PumpPortal sends trades
//   TRENDING: what is hot on pump.fun right now: GeckoTerminal's trending pools (5-minute and 1-hour) and new pools on the pump.fun and
//     PumpSwap exchanges, judged on DexScreener: buyers in control in the last 5 minutes, real volume in the hour, up but not vertical.
//     (Fomo, the app, has no public data feed; its trending coins are pump.fun and PumpSwap coins and show up here when they move.)
// The feed now counts what it receives (launches and trades in the last hour) and the bot says so hourly, and alerts if launches keep
// coming with no trades at all.
//
// How it fits the rest of RynoBot: the feed is turned into DexScreener-shaped quotes (priceUsd, txns.m5/h1, volume, liquidity) so the
// ordinary engine runs it: setups (trenchSetup), the market entry, the ladder exits with the dump cut, giveback, seller cut and a "dead
// chart" rule, the desk, the journal, the council. Nothing here can place an order: pump.fun orders are not even implemented.
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
export const TRENCH = { minAgeMin: 0.5, maxAgeMin: 12, minBuyers: 12, minBuys60: 4, buySellX: 1.5, minMcapSol: 30, maxMcapSol: 150, devMaxPct: 8, topBuyerMaxPct: 25, deadMin: 4, supply: 1e9, watchMin: 20, maxTokens: 400 };
// the DexScreener judge for launches (2-20 minutes old): 25+ buys in 5 minutes, buys 1.4x sells, $4k+ traded in 5 minutes, still early ($7k-$80k)
export const DSLAUNCH = { minAgeMin: 2, maxAgeMin: 20, minBuys5: 25, buySellX5: 1.4, minVol5: 4000, minMcapUsd: 7000, maxMcapUsd: 80000, everySec: 60, perCall: 30, callsPerCycle: 2 };
// the trending lane: under 3 days old, 30+ buys in 5 minutes and 1.3x the sells, $50k+ traded in the hour, up 10-300% in the hour and still
// going in the last 5 minutes, $20k-$20m market cap; one trade per coin per 6 hours
export const TREND = { maxAgeH: 72, minBuys5: 30, buySellX5: 1.3, minVolH1: 50000, minH1Pct: 10, maxH1Pct: 300, minMcapUsd: 20000, maxMcapUsd: 2e7, coolH: 6, everySec: 120, dexes: ['pump-fun', 'pumpswap'],
  pages: ['trending_pools?duration=5m&page=1', 'trending_pools?duration=5m&page=2', 'trending_pools?duration=1h&page=1', 'new_pools?page=1', 'new_pools?page=2'] };
// a bonding-curve pair on DexScreener often has no liquidity figure; a fifth of the market cap is about what the curve holds early on
// (marked as an estimate: it only feeds the cost model, the gates use the market cap)
export function fixLiq(q) { if (q && !(q.liquidity && +q.liquidity.usd > 0) && (!q.dexId || String(q.dexId) === 'pumpfun')) { /* only a bonding curve is estimated: a traded pool showing $0 really is empty (Rockstar, 24 Oct) */ const mc = +(q.marketCap || q.fdv) || 0; if (mc > 0) q.liquidity = { usd: mc * 0.2, estimated: true }; } return q; }
const m5of = (q) => { const t = (q && q.txns && q.txns.m5) || {}; return { b: +t.buys || 0, s: +t.sells || 0 }; };
export function dsLaunchSetup(q, ageMin, cfg = DSLAUNCH) {
  if (!q || !(+q.priceUsd > 0)) return null; if (ageMin < cfg.minAgeMin || ageMin > cfg.maxAgeMin) return null; const { b, s } = m5of(q), v5 = +(q.volume && q.volume.m5) || 0, mc = +(q.marketCap || q.fdv) || 0, c5 = n(q.priceChange && q.priceChange.m5);
  if (b < cfg.minBuys5 || b < cfg.buySellX5 * Math.max(1, s) || v5 < cfg.minVol5) return null; if (mc < cfg.minMcapUsd) return null; if (mc > cfg.maxMcapUsd) return { dead: `market cap $${Math.round(mc / 1000)}k: no longer early` }; if (c5 != null && c5 <= 0) return null;
  return { price: +q.priceUsd, why: [`${ageMin.toFixed(0)} minutes old, ${b} buys vs ${s} sells in 5 minutes`, `$${Math.round(v5 / 1000)}k traded in 5 minutes`, `market cap $${Math.round(mc / 1000)}k${c5 != null ? `, ${c5 >= 0 ? '+' : ''}${c5}% in 5 minutes` : ''}`] };
}
export function trendSetup(q, nowMs, cfg = TREND) {
  if (!q || !(+q.priceUsd > 0)) return null; const ageH = q.pairCreatedAt ? (nowMs - +q.pairCreatedAt) / 3600e3 : null; if (ageH != null && ageH > cfg.maxAgeH) return null; if (cfg.minAgeH > 0 && (ageH == null || ageH < cfg.minAgeH)) return null; /* too young for this trencher: looked at again next round */
  { const m5 = n(q.priceChange && q.priceChange.m5); if (cfg.maxM5Pct != null && m5 != null && m5 > cfg.maxM5Pct) return null; } /* no chasing: already up too much in 5 minutes; looked at again next round */
  const { b, s } = m5of(q), vh = +(q.volume && q.volume.h1) || 0, mc = +(q.marketCap || q.fdv) || 0, pc = q.priceChange || {}, c5 = n(pc.m5), c1 = n(pc.h1);
  if (b < cfg.minBuys5 || b < cfg.buySellX5 * Math.max(1, s) || vh < cfg.minVolH1) return null; if (c1 == null || c1 < cfg.minH1Pct) return null; if (c5 != null && c5 <= 0) return null;
  if (cfg.maxBuySellX5 != null && b > cfg.maxBuySellX5 * Math.max(1, s)) return null; /* a pile-in (buys more than maxBuySellX5 the sells in 5 minutes): the trench council's confirmed worst slice, looked at again next round */
  if (c1 > cfg.maxH1Pct) return { dead: `up ${Math.round(c1)}% in the hour: vertical` }; if (mc < cfg.minMcapUsd || mc > cfg.maxMcapUsd) return null;
  return { price: +q.priceUsd, why: [`trending on ${q.dexId === 'pumpswap' ? 'PumpSwap' : 'pump.fun'}: ${b} buys vs ${s} sells in 5 minutes`, `$${Math.round(vh / 1000)}k traded in the hour, +${Math.round(c1)}% in the hour${c5 != null ? `, +${c5}% in 5 minutes` : ''}`, `market cap $${mc >= 1e6 ? (mc / 1e6).toFixed(1) + 'm' : Math.round(mc / 1000) + 'k'}${ageH != null ? `, ${ageH < 1 ? Math.round(ageH * 60) + ' minutes' : ageH.toFixed(0) + ' hours'} old` : ''}`] };
}

// one token's running tally from the feed events (pure: feed messages in, tally out)
export function newToken(ev, nowSec) { return { mint: ev.mint, name: ev.name || '', symbol: ev.symbol || ev.name || ev.mint.slice(0, 6), createdAt: nowSec, dev: ev.traderPublicKey || null, devTokens: n(ev.initialBuy) || 0, vSol: n(ev.vSolInBondingCurve) || 0, vTok: n(ev.vTokensInBondingCurve) || 0, mcapSol: n(ev.marketCapSol) || 0, trades: [], buyers: {}, lastAt: nowSec, migrated: false, dead: false }; }
export function onTrade(tok, ev, nowSec) {
  if (!tok) return; const sol = n(ev.solAmount) || 0, buy = ev.txType === 'buy'; tok.vSol = n(ev.vSolInBondingCurve) ?? tok.vSol; tok.vTok = n(ev.vTokensInBondingCurve) ?? tok.vTok; tok.mcapSol = n(ev.marketCapSol) ?? tok.mcapSol; tok.lastAt = nowSec;
  tok.trades.push([nowSec, buy ? 1 : 0, sol, ev.traderPublicKey || '']); if (tok.trades.length > 2000) tok.trades = tok.trades.slice(-1500);
  if (buy && ev.traderPublicKey) tok.buyers[ev.traderPublicKey] = (tok.buyers[ev.traderPublicKey] || 0) + sol;
}
export const priceSol = (tok) => (tok && tok.vTok > 0 ? tok.vSol / tok.vTok : 0);
// a DexScreener-shaped quote so the engine (entries, ladder exits, desk) needs nothing special
export function quoteFor(tok, nowSec, solUsd) {
  const px = priceSol(tok), w = (sec) => tok.trades.filter((t) => t[0] >= nowSec - sec), cnt = (ts) => ({ buys: ts.filter((t) => t[1]).length, sells: ts.filter((t) => !t[1]).length }), m5 = w(300), h1 = w(3600);
  const vol = (ts) => ts.reduce((a, t) => a + t[2], 0) * solUsd; const m5p = tok.trades.filter((t) => t[0] <= nowSec - 300).slice(-1)[0];
  return { priceUsd: String(px * solUsd), priceNative: String(px), baseToken: { address: tok.mint, symbol: tok.symbol }, chainId: 'solana', pairAddress: tok.mint, url: 'https://pump.fun/coin/' + tok.mint, txns: { m5: cnt(m5), h1: cnt(h1) }, volume: { m5: vol(m5), h1: vol(h1), h24: vol(h1) }, liquidity: { usd: tok.vSol * solUsd }, priceChange: { m5: m5p ? null : null }, lastTradeSec: tok.lastAt, ageMin: (nowSec - tok.createdAt) / 60, pump: true };
}
// the entry gates (loose on purpose): a launch between minAgeMin and maxAgeMin old, real distinct buyers, buyers over sellers in the last two
// minutes, still early on the curve, the dev not holding the bag, no single buyer dominating, and buying still going on this minute
export function trenchSetup(tok, nowSec, cfg = TRENCH) {
  if (!tok || tok.dead || tok.migrated) return null; const age = (nowSec - tok.createdAt) / 60; if (age < cfg.minAgeMin) return null; if (age > cfg.maxAgeMin) return { dead: `${age.toFixed(0)} minutes old: past the window` };
  const px = priceSol(tok); if (!(px > 0)) return null; const buyers = Object.keys(tok.buyers).length, last120 = tok.trades.filter((t) => t[0] >= nowSec - 120), b2 = last120.filter((t) => t[1]).length, s2 = last120.length - b2, b60 = tok.trades.filter((t) => t[0] >= nowSec - 60 && t[1]).length;
  if (buyers < cfg.minBuyers) return null; if (b60 < cfg.minBuys60) return null; if (b2 < cfg.buySellX * Math.max(1, s2)) return null;
  if (tok.mcapSol < cfg.minMcapSol) return null; if (tok.mcapSol > cfg.maxMcapSol) return { dead: `market cap ${tok.mcapSol.toFixed(0)} SOL: no longer early` };
  const devPct = (tok.devTokens / cfg.supply) * 100; if (devPct > cfg.devMaxPct) return { dead: `the dev bought ${devPct.toFixed(0)}% of the supply at launch` };
  const bought = Object.values(tok.buyers), tot = bought.reduce((a, x) => a + x, 0), top = Math.max(...bought); if (tot > 0 && (top / tot) * 100 > cfg.topBuyerMaxPct) return { dead: `one wallet is ${Math.round((top / tot) * 100)}% of the buying` };
  return { price: px, buyers, b2, s2, b60, mcapSol: tok.mcapSol, devPct: +devPct.toFixed(1), why: [`${buyers} different buyers in ${age.toFixed(1)} minutes`, `${b2} buys vs ${s2} sells in the last 2 minutes, ${b60} buys this minute`, `market cap ${tok.mcapSol.toFixed(0)} SOL, dev holds ${devPct.toFixed(1)}%`] };
}
// the feed: a reconnecting websocket client that keeps the token tallies; events can also be pushed in by tests (feed.push(ev, nowSec))
export function trenchFeed({ url = 'wss://pumpportal.fun/api/data', cfg = TRENCH, log = console.log, WS = globalThis.WebSocket } = {}) {
  const tokens = new Map(); let ws = null, stopped = false, msgs = 0, lastMsgAt = 0, lastTradeAt = 0, subs = new Set(); const seen = { create: [], trade: [] }, mark = (k, t) => { const a = seen[k]; a.push(t); if (a.length > 5000 || (a.length && t - a[0] > 3600)) { while (a.length && t - a[0] > 3600) a.shift(); if (a.length > 5000) a.splice(0, a.length - 5000); } };
  const push = (ev, nowSec = Math.floor(Date.now() / 1000)) => { msgs++; lastMsgAt = nowSec; if (!ev || !ev.mint) return;
    if (ev.txType === 'create') { mark('create', nowSec); if (tokens.size >= cfg.maxTokens) { const oldest = [...tokens.values()].sort((a, b) => a.createdAt - b.createdAt)[0]; if (oldest) { tokens.delete(oldest.mint); unsub(oldest.mint); } } tokens.set(ev.mint, newToken(ev, nowSec)); sub(ev.mint); }
    else if (ev.txType === 'buy' || ev.txType === 'sell') { mark('trade', nowSec); lastTradeAt = nowSec; onTrade(tokens.get(ev.mint), ev, nowSec); }
    else if (ev.txType === 'migrate') { const t = tokens.get(ev.mint); if (t) t.migrated = true; } };
  const send = (o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch { /* reconnect handles it */ } };
  const sub = (mint) => { subs.add(mint); send({ method: 'subscribeTokenTrade', keys: [mint] }); }, unsub = (mint) => { subs.delete(mint); send({ method: 'unsubscribeTokenTrade', keys: [mint] }); };
  const connect = () => { if (stopped || !WS) return; try { ws = new WS(url); } catch (e) { log('trench feed: ' + e.message); setTimeout(connect, 15000); return; }
    ws.onopen = () => { log('trench feed: connected'); send({ method: 'subscribeNewToken' }); send({ method: 'subscribeMigration' }); if (subs.size) send({ method: 'subscribeTokenTrade', keys: [...subs] }); };
    ws.onmessage = (m) => { try { push(JSON.parse(typeof m.data === 'string' ? m.data : String(m.data))); } catch { /* not json */ } };
    ws.onclose = () => { if (!stopped) setTimeout(connect, 5000); }; ws.onerror = (e) => { log('trench feed error: ' + (e && e.message || 'socket error')); }; };
  // forget tokens past the watch window that we are not in; mark quiet ones dead
  const prune = (nowSec, held = new Set()) => { for (const [k, t] of tokens) { if (held.has(k)) continue; if (nowSec - t.createdAt > cfg.watchMin * 60 || (t.migrated && nowSec - t.lastAt > 600)) { tokens.delete(k); unsub(k); } } };
  return { tokens, push, connect, prune, stop: () => { stopped = true; try { ws && ws.close(); } catch { /* closed */ } }, stats: (nowSec = Math.floor(Date.now() / 1000)) => ({ tokens: tokens.size, msgs, lastMsgAt, lastTradeAt, connected: !!(ws && ws.readyState === 1), creates1h: seen.create.filter((t) => nowSec - t <= 3600).length, trades1h: seen.trade.filter((t) => nowSec - t <= 3600).length }), quotes: (items, nowSec, solUsd) => { const out = {}; for (const it of items) { const t = tokens.get(it.pool); if (t && solUsd > 0 && !t.migrated && t.trades.length && nowSec - t.lastAt < 600) out[String(it.pool).toLowerCase()] = quoteFor(t, nowSec, solUsd); } return out; } }; // the feed prices a launch only while its own trades keep arriving (after a migration, or with no trades, DexScreener prices it)
}
// setups for the engine, from all three lanes. The feed lane needs the feed's trades; the DexScreener lanes need G (getJson) and Q (quotes).
export async function trenchSetupsIn(st, cfg, feed, { J, now, nowIso, solUsd, G = null, Q = null }) {
  const nowSec = Math.floor(now / 1000); let newN = 0; const T = (st.trench ||= { expired: 0, feedSetups: 0, dsSetups: 0, trendSetups: 0, hourAt: now }); const maxNew = cfg.trenchMaxNew || 3;
  feed.prune(nowSec, new Set([...st.positions.map((p) => p.pool), ...Object.keys(st.setups)]));
  for (const s of Object.values(st.setups)) if (!s.dropped && s.src === 'feed' && !feed.tokens.has(s.pool)) { s.dropped = true; s.dropWhy = 'launch gone from the feed'; J({ type: 'drop', coin: s.coin, pool: s.pool, why: 'launch gone from the feed' }); }
  const add = (key, o, lane) => { st.setups[key] = { chain: 'solana', kind: lane === 'trend' ? 'trend' : 'trench', opp: null, mults: cfg.mults, shares: cfg.shares, expireH: cfg.signalMaxAgeH || 0.1, at: nowIso, src: lane, ...o, zoneLow: o.price, zoneHigh: o.price, stop: +(o.price * (1 - ((lane === 'trend' ? cfg.trendCfg && cfg.trendCfg.fixedStopPct : null) || cfg.fixedStopPct || 35) / 100)).toPrecision(6) }; delete st.setups[key].price; T[lane === 'trend' ? 'trendSetups' : lane === 'ds' ? 'dsSetups' : 'feedSetups']++; newN++;
    J({ type: 'setup', coin: o.coin, pool: o.pool, kind: st.setups[key].kind, lane, zoneLow: o.price, zoneHigh: o.price, stop: st.setups[key].stop, why: o.why }); };
  const L = new Set(cfg.lanes || ['feed', 'ds', 'trend']); /* each trencher's own lanes */
  // 1. the feed lane (only launches whose trades arrive)
  for (const t of L.has('feed') ? feed.tokens.values() : []) { if (newN >= maxNew) break; if (st.setups[t.mint] || (st.seen || {})[t.mint] || !t.trades.length) continue; const r = trenchSetup(t, nowSec, cfg); if (!r) continue;
    (st.seen ||= {})[t.mint] = now; if (r.dead) { if (/past the window/.test(r.dead)) T.expired++; else J({ type: 'skip', coin: t.symbol, pool: t.mint, why: r.dead }); continue; }
    add(t.mint, { pool: t.mint, coin: t.symbol, token: t.mint, price: r.price * solUsd, why: r.why, buyers: r.buyers, mcapSol: r.mcapSol, devPct: r.devPct, liq0: t.vSol * solUsd, url: 'https://pump.fun/coin/' + t.mint }, 'feed'); }
  for (const t of feed.tokens.values()) if (!t.trades.length && !(st.seen || {})[t.mint] && nowSec - t.createdAt > cfg.maxAgeMin * 60) { (st.seen ||= {})[t.mint] = now; T.expired++; }
  // 2. the DexScreener launch lane: launches 2-20 minutes old with no feed trades, checked in batches of 30, each at most once a minute
  const D = cfg.dsLaunch; if (D && L.has('ds') && G && newN < maxNew) { const due = [...feed.tokens.values()].filter((t) => !t.trades.length && !st.setups[t.mint] && !(st.dsSeen || {})[t.mint] && (nowSec - t.createdAt) / 60 >= D.minAgeMin && (nowSec - t.createdAt) / 60 <= D.maxAgeMin && nowSec - (t.dsAt || 0) >= D.everySec).sort((a, b) => b.createdAt - a.createdAt);
    for (let c = 0; c < D.callsPerCycle && c * D.perCall < due.length && newN < maxNew; c++) { const batch = due.slice(c * D.perCall, (c + 1) * D.perCall); for (const t of batch) t.dsAt = nowSec;
      let j = null; try { j = await G('https://api.dexscreener.com/latest/dex/tokens/' + batch.map((t) => t.mint).join(',')); } catch (e) { console.log('trench dexscreener: ' + e.message); break; }
      for (const t of batch) { if (newN >= maxNew) break; const q = ((j && j.pairs) || []).filter((p) => p.chainId === 'solana' && p.baseToken && p.baseToken.address === t.mint).sort((a, b) => (+(b.volume && b.volume.m5) || 0) - (+(a.volume && a.volume.m5) || 0))[0]; if (!q) continue; fixLiq(q);
        const r = dsLaunchSetup(q, (nowSec - t.createdAt) / 60, D); if (!r) continue; (st.dsSeen ||= {})[t.mint] = now; if (r.dead) continue;
        add(q.pairAddress, { pool: q.pairAddress, coin: t.symbol, token: t.mint, price: r.price, why: r.why, liq0: q.liquidity.usd, url: q.url || 'https://pump.fun/coin/' + t.mint }, 'ds'); } } }
  // 3. the trending lane: GeckoTerminal's trending and new pools on pump.fun and PumpSwap, judged on DexScreener
  const R = cfg.trend; if (R && L.has('trend') && G && Q && newN < maxNew && now - (st.trendAt || 0) >= R.everySec * 1000) { st.trendAt = now; st.trendSeen ||= {}; const cands = new Map();
    for (const p of R.pages) { try { const j = await G('https://api.geckoterminal.com/api/v2/networks/solana/' + p); for (const d of (j && j.data) || []) { const dex = d.relationships && d.relationships.dex && d.relationships.dex.data && d.relationships.dex.data.id; if (R.dexes.length && !R.dexes.includes(dex)) continue; const pool = (d.id || '').split('_').slice(1).join('_') || (d.attributes || {}).address; if (pool && !cands.has(pool)) cands.set(pool, { pool, chain: 'solana', coin: String((d.attributes || {}).name || '').split(' / ')[0] || pool.slice(0, 6) }); } } catch (e) { console.log('trench trending ' + p + ': ' + e.message); } }
    st.trendCands = [...cands.values()].slice(0, 120); /* the random control's pool: what was trending at this moment */
    const fresh = [...cands.values()].filter((c) => !st.setups[c.pool] && !st.positions.some((p) => p.pool === c.pool) && now - (st.trendSeen[c.pool] || 0) >= R.coolH * 3600e3);
    const qs = fresh.length ? await Q(fresh).catch(() => ({})) : {}; T.trendChecked = fresh.length;
    for (const c of fresh) { if (newN >= maxNew) break; const q = qs[String(c.pool).toLowerCase()]; if (!q) continue; fixLiq(q); const r = trendSetup(q, now, R); if (!r || r.dead) continue;
      st.trendSeen[c.pool] = now; add(c.pool, { pool: c.pool, coin: (q.baseToken && q.baseToken.symbol) || c.coin, token: q.baseToken && q.baseToken.address, price: r.price, why: r.why, liq0: q.liquidity.usd, url: q.url }, 'trend'); }
    for (const [k, t] of Object.entries(st.trendSeen)) if (now - t > 2 * R.coolH * 3600e3) delete st.trendSeen[k]; }
  for (const [k, t] of Object.entries(st.dsSeen || {})) if (now - t > 3600e3) delete st.dsSeen[k];
  // once an hour, the bot says what it saw (so a silent feed shows up on the desk, not as a mystery)
  if (now - (T.hourAt || 0) >= 3600e3) { const fs = feed.stats(nowSec); J({ type: 'feed', why: `last hour: ${fs.creates1h} launches and ${fs.trades1h} trades from PumpPortal; ${T.feedSetups} setups from the feed, ${T.dsSetups} from DexScreener launches, ${T.trendSetups} trending; ${T.expired} launches aged out without qualifying` }); st.trench = { expired: 0, feedSetups: 0, dsSetups: 0, trendSetups: 0, hourAt: now, last: { ...fs, ...T, at: nowIso } }; }
}

// THE HOLDER READ (24 Oct, from the pump.fun extractor research: devs and their bundled wallets took $579M against $31.5M for the snipers,
// so who already holds the supply matters more than who is buying). One RugCheck report per shot: the top 10 wallets (pools left out)
// over 30%, the wallets RugCheck tags as insiders over 10% (the median dev bundle), or one linked wallet network over 15% (Bubblemaps'
// MYSTERY/LIBRA pattern: the supply split across fresh wallets) marks the coin as held by the extractors. Every way records it; B-clean
// trades only the clean ones, so the shotgun on flagged coins vs clean coins is the filter's real cost or saving.
export const HOLD = { top10MaxPct: 30, insiderMaxPct: 10, networkMaxPct: 15 };
export function trenchHolderRead(rep, cfg = HOLD) {
  const g = solanaHolderGate(rep, { top10MaxPct: cfg.top10MaxPct, insiderMaxPct: cfg.insiderMaxPct, taxMaxPct: 5 });
  if (g.top10 == null) return { clean: null, why: ['RugCheck has no holder table yet'], top10: null, insider: null, net: null };
  const why = [...g.danger], sup = +(rep.token && rep.token.supply) || 0, nets = Array.isArray(rep.insiderNetworks) ? rep.insiderNetworks : [];
  const pcts = sup > 0 ? nets.map((x) => ((+x.tokenAmount || 0) / sup) * 100).filter((x) => x >= 0 && x <= 100) : [], net = pcts.length ? +Math.max(...pcts).toFixed(1) : null;
  if (net != null && net > cfg.networkMaxPct) why.push(`one linked wallet network holds ${net}% (gate ${cfg.networkMaxPct}%)`);
  return { clean: !why.length, why, top10: g.top10, insider: g.insider, net, insiders: +rep.graphInsidersDetected || 0 };
}
// the extractors leaving (rule 11 of the research: out when the insiders or the top cluster start selling): the insider wallets' share
// down a fifth or more since the entry, or the top 10's share down a fifth or more (they only fall when the big holders sell or split)
export function holdersLeaving(h0, h) {
  if (!h0 || !h || h.top10 == null) return null;
  if (h0.insider >= 2 && h.insider != null && h.insider <= h0.insider * 0.8) return `insider wallets sold: ${h0.insider}% of the supply at the entry, ${h.insider}% now`;
  if (h0.top10 >= 10 && h.top10 <= h0.top10 * 0.8) return `the top 10 holders are selling: ${h0.top10}% of the supply at the entry, ${h.top10}% now`;
  return null;
}
