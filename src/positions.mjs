// Phone alerts for coins Ryan actually holds, and for bid-ready setups, from the free DexScreener feed (every watcher run, ~15 min).
// His positions live in config/positions/*.json, one small file per coin, created from the dashboard's "Get phone alerts" link
// (or by hand). Fields: { coin, chain, pool or token, entry?, stop?, tp1?, at }. Delete the file to stop the alerts.
// Checks:
//   volume dying  : last 6 hours traded under 35% (fading) / 20% (died) of the 24-hour pace. "Every launch dies; the question is
//                   whether you are still holding when volume goes." Skipped for pairs younger than a day (no 24h pace yet).
//   sellers       : the coin is 8%+ under the entry price and sellers lead the last hour (1.2x) and the last 5 minutes.
//   stop / target : price at or under the stop, or at or over TP1.
// Paper only for the scanner: these are messages to Ryan, nothing is traded.
import fs from 'node:fs';
import path from 'node:path';
export const VOL = { died: 0.2, fading: 0.35, minAgeH: 24, coolH: 12 };
const DS = { solana: 'solana', robinhood: 'robinhood', eth: 'ethereum', ethereum: 'ethereum' };
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);

export function loadPositions(dir = 'config/positions') {
  let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (j && (j.pool || j.token) && j.chain) out.push({ ...j, file: f, coin: j.coin || f.replace(/\.json$/, '') }); } catch { /* a broken file is skipped, not fatal */ } }
  return out;
}
// 6-hour volume against the 24-hour pace (24h / 4). null when there is no 24h volume.
export function volRatio(q) { const v = (q && q.volume) || {}, d = n(v.h24), s = n(v.h6); return d > 0 && s != null ? s / (d / 4) : null; }
const ageH = (q, now) => (q && q.pairCreatedAt ? (now - +q.pairCreatedAt) / 3600e3 : null);

// one DexScreener pair -> the alerts it deserves. it: position or setup; kind: 'pos' | 'bid'. sent: { key: isoTime } for cool-downs.
export function checkPair(it, q, kind, now = Date.now(), sent = {}, cfg = VOL) {
  if (!it || !q) return [];
  const out = [], id = String(it.pool || it.token || it.coin), price = n(q.priceUsd), cool = (k, h) => !sent[k] || now - Date.parse(sent[k]) > h * 3600e3;
  const add = (k, h, a) => { if (cool(k, h)) out.push({ key: k, ...a }); };
  const r = volRatio(q), age = ageH(q, now), pct = r == null ? null : Math.round(r * 100), entry = n(it.entry ?? it.entryHigh), pnl = entry && price ? ((price / entry - 1) * 100).toFixed(1) : null;
  const tail = `${price != null ? ` Price ${price}` : ''}${pnl != null ? ` (${pnl >= 0 ? '+' : ''}${pnl}% from entry)` : ''}.${q.url ? ' ' + q.url : ''}`;
  if (r != null && !(age != null && age < cfg.minAgeH)) {
    if (r < cfg.died) add(`V|${id}|died`, cfg.coolH, kind === 'pos'
      ? { t: `${it.coin}: volume has died, consider closing`, p: 'high', b: `The last 6 hours traded only ${pct}% of the 24-hour pace ($${Math.round(n(q.volume.h6)).toLocaleString('en')} vs $${Math.round(n(q.volume.h24) / 4).toLocaleString('en')} a 6h average). Volume leaving usually comes before the price follows.${tail}` }
      : { t: `${it.coin}: bid-ready setup lost its volume`, p: 'default', b: `The last 6 hours traded only ${pct}% of the 24-hour pace. A setup with no volume behind it rarely works: consider cancelling the order or skipping it.${tail}` });
    else if (kind === 'pos' && r < cfg.fading) add(`V|${id}|fading`, cfg.coolH, { t: `${it.coin}: volume fading`, p: 'default', b: `The last 6 hours traded ${pct}% of the 24-hour pace. Not dead yet (the close rule is under 20%), but watch it.${tail}` });
  }
  if (kind === 'pos' && price != null) {
    const t1 = (q.txns && q.txns.h1) || {}, t5 = (q.txns && q.txns.m5) || {}, b1 = +t1.buys || 0, s1 = +t1.sells || 0, b5 = +t5.buys || 0, s5 = +t5.sells || 0;
    if (entry && price <= entry * 0.92 && s1 > 0 && s1 >= 1.2 * b1 && s5 > b5) add(`S|${id}`, 6, { t: `${it.coin}: sellers have taken over`, p: 'high', b: `${s1} sells vs ${b1} buys in the last hour and ${s5} vs ${b5} in the last 5 minutes, while you are ${Math.abs(+pnl).toFixed(1)}% under your entry.${tail}` });
    const stop = n(it.stop), tp1 = n(it.tp1);
    if (stop && price <= stop) add(`X|${id}`, 24, { t: `${it.coin}: stop hit`, p: 'high', b: `Price ${price} is at or under your stop ${stop}.${tail}` });
    if (tp1 && price >= tp1) add(`T|${id}`, 24, { t: `${it.coin}: TP1 reached`, p: 'default', b: `Price ${price} reached TP1 ${tp1}. Your plan: sell a third and move the stop to entry.${tail}` });
  }
  return out;
}

// fetch the pairs for positions (by pool, or by token: the most liquid pair) and setups, then check them. Returns { alerts, rows }.
export async function positionScan(positions, setups, getJson, now = Date.now(), sent = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const byPool = {}, byTok = {}, pairs = new Map(), alerts = [], rows = [];
  for (const it of [...positions, ...setups]) { const c = DS[String(it.chain || it.net).toLowerCase()]; if (!c) continue; if (it.pool) (byPool[c] ||= new Set()).add(String(it.pool)); else if (it.token) (byTok[c] ||= new Set()).add(String(it.token)); }
  for (const [c, set] of Object.entries(byPool)) { const a = [...set]; for (let i = 0; i < a.length; i += 30) { try { const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${c}/${a.slice(i, i + 30).join(',')}`); for (const q of (j && j.pairs) || []) pairs.set('p|' + String(q.pairAddress).toLowerCase(), q); } catch { /* next run */ } await sleep(250); } }
  for (const [, set] of Object.entries(byTok)) { const a = [...set]; for (let i = 0; i < a.length; i += 30) { try { const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${a.slice(i, i + 30).join(',')}`); for (const q of (j && j.pairs) || []) { const k = 't|' + String(q.baseToken && q.baseToken.address).toLowerCase(), old = pairs.get(k); if (!old || (+(q.liquidity && q.liquidity.usd) || 0) > (+(old.liquidity && old.liquidity.usd) || 0)) pairs.set(k, q); } } catch { /* next run */ } await sleep(250); } }
  const find = (it) => pairs.get('p|' + String(it.pool || '').toLowerCase()) || pairs.get('t|' + String(it.token || '').toLowerCase()) || null;
  for (const it of positions) { const q = find(it); alerts.push(...checkPair(it, q, 'pos', now, sent)); rows.push({ coin: it.coin, chain: it.chain, file: it.file, price: q ? n(q.priceUsd) : null, volRatio: q ? (volRatio(q) == null ? null : +volRatio(q).toFixed(2)) : null, entry: n(it.entry), stop: n(it.stop), tp1: n(it.tp1) }); }
  for (const it of setups) alerts.push(...checkPair(it, find(it), 'bid', now, sent));
  return { alerts, rows };
}
