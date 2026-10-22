// THE TRENCHER (paper only, never live): a pump.fun "trench extractor". New launches on the pump.fun bonding curve, watched live from the
// free PumpPortal feed (wss://pumpportal.fun/api/data: every new token and every buy and sell on it, no key, no account). The play: get in
// in the first minutes once real buyers have shown up, then sell INTO the buyers as the bids come (clips at 1.5x, 2.2x and 3.5x), dump the
// lot the moment sellers take over or the chart goes quiet, never hold past an hour. Most launches die inside ten minutes; this bot
// exists to learn what separates the ones that do not, not to be careful. Loose gates on purpose. Rugs are data.
//
// How it fits the rest of RynoBot: the feed is turned into DexScreener-shaped quotes (priceUsd, txns.m5/h1, volume, liquidity) so the
// ordinary engine runs it: setups (trenchSetup), the market entry, the ladder exits with the dump cut, giveback, seller cut and a "dead
// chart" rule, the desk, the journal, the council. Nothing here can place an order: pump.fun orders are not even implemented.
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
export const TRENCH = { minAgeMin: 0.5, maxAgeMin: 12, minBuyers: 12, minBuys60: 4, buySellX: 1.5, minMcapSol: 30, maxMcapSol: 150, devMaxPct: 8, topBuyerMaxPct: 25, deadMin: 4, supply: 1e9, watchMin: 20, maxTokens: 400 };

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
  const tokens = new Map(); let ws = null, stopped = false, msgs = 0, lastMsgAt = 0, subs = new Set();
  const push = (ev, nowSec = Math.floor(Date.now() / 1000)) => { msgs++; lastMsgAt = nowSec; if (!ev || !ev.mint) return;
    if (ev.txType === 'create') { if (tokens.size >= cfg.maxTokens) { const oldest = [...tokens.values()].sort((a, b) => a.createdAt - b.createdAt)[0]; if (oldest) { tokens.delete(oldest.mint); unsub(oldest.mint); } } tokens.set(ev.mint, newToken(ev, nowSec)); sub(ev.mint); }
    else if (ev.txType === 'buy' || ev.txType === 'sell') onTrade(tokens.get(ev.mint), ev, nowSec);
    else if (ev.txType === 'migrate') { const t = tokens.get(ev.mint); if (t) t.migrated = true; } };
  const send = (o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch { /* reconnect handles it */ } };
  const sub = (mint) => { subs.add(mint); send({ method: 'subscribeTokenTrade', keys: [mint] }); }, unsub = (mint) => { subs.delete(mint); send({ method: 'unsubscribeTokenTrade', keys: [mint] }); };
  const connect = () => { if (stopped || !WS) return; try { ws = new WS(url); } catch (e) { log('trench feed: ' + e.message); setTimeout(connect, 15000); return; }
    ws.onopen = () => { log('trench feed: connected'); send({ method: 'subscribeNewToken' }); send({ method: 'subscribeMigration' }); if (subs.size) send({ method: 'subscribeTokenTrade', keys: [...subs] }); };
    ws.onmessage = (m) => { try { push(JSON.parse(typeof m.data === 'string' ? m.data : String(m.data))); } catch { /* not json */ } };
    ws.onclose = () => { if (!stopped) setTimeout(connect, 5000); }; ws.onerror = (e) => { log('trench feed error: ' + (e && e.message || 'socket error')); }; };
  // forget tokens past the watch window that we are not in; mark quiet ones dead
  const prune = (nowSec, held = new Set()) => { for (const [k, t] of tokens) { if (held.has(k)) continue; if (nowSec - t.createdAt > cfg.watchMin * 60 || (t.migrated && nowSec - t.lastAt > 600)) { tokens.delete(k); unsub(k); } } };
  return { tokens, push, connect, prune, stop: () => { stopped = true; try { ws && ws.close(); } catch { /* closed */ } }, stats: () => ({ tokens: tokens.size, msgs, lastMsgAt, connected: !!(ws && ws.readyState === 1) }), quotes: (items, nowSec, solUsd) => { const out = {}; for (const it of items) { const t = tokens.get(it.pool); if (t && solUsd > 0) out[String(it.pool).toLowerCase()] = quoteFor(t, nowSec, solUsd); } return out; } };
}
// setups from the feed for the engine: one per launch, bought on sight by the market entry (cfg.signalMaxAgeH keeps it to minutes)
export function trenchSetupsIn(st, cfg, feed, { J, now, nowIso, solUsd }) {
  const nowSec = Math.floor(now / 1000); let newN = 0; feed.prune(nowSec, new Set(st.positions.map((p) => p.pool)));
  for (const t of feed.tokens.values()) { if (newN >= (cfg.trenchMaxNew || 3)) break; if (st.setups[t.mint] || (st.seen || {})[t.mint]) continue; const r = trenchSetup(t, nowSec, cfg); if (!r) continue;
    (st.seen ||= {})[t.mint] = now; if (r.dead) { J({ type: 'skip', coin: t.symbol, pool: t.mint, why: r.dead }); continue; } newN++;
    const pxUsd = r.price * solUsd; st.setups[t.mint] = { pool: t.mint, coin: t.symbol, chain: 'solana', token: t.mint, kind: 'trench', setup: 'Trench launch', opp: null, zoneLow: pxUsd, zoneHigh: pxUsd, stop: +(pxUsd * (1 - (cfg.fixedStopPct || 35) / 100)).toPrecision(6), mults: cfg.mults, shares: cfg.shares, why: r.why, buyers: r.buyers, mcapSol: r.mcapSol, devPct: r.devPct, expireH: cfg.signalMaxAgeH || 0.1, at: nowIso, liq0: t.vSol * solUsd, url: 'https://pump.fun/coin/' + t.mint };
    J({ type: 'setup', coin: t.symbol, pool: t.mint, kind: 'trench', zoneLow: pxUsd, zoneHigh: pxUsd, stop: st.setups[t.mint].stop, why: r.why }); }
}
