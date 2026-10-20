// RynoScan entry watcher. Runs every ~30 minutes between full scans. It does NOT rescan the market: it takes the entry zones
// the last scan produced and checks live prices (free DexScreener feed), then alerts when price is inside a zone, when a setup
// is invalidated, or when price ran past TP1 without a fill. Writes docs/data/watch.json (live prices for the dashboard).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pulseScan, updatePulse, flowScan } from './pulse.mjs';
import { loadPositions, positionScan } from './positions.mjs';

const OUT = process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? (Array.isArray(j) ? j : d) : (j && typeof j === 'object' && !Array.isArray(j) ? j : d); } catch { return d; } };
const DS = { solana: 'solana', robinhood: 'robinhood', eth: 'ethereum', ethereum: 'ethereum' };
const NETOF = { solana: 'solana', robinhood: 'robinhood', ethereum: 'eth', eth: 'eth' };

// state of a price against a plan: in-zone | near | below-stop | ran | far
export function classify(it, price) {
  if (!(price > 0) || !(it.entryHigh > 0) || !(it.stop > 0)) return 'unknown';
  if (price <= it.stop) return 'invalid';
  if (it.tp1 && price >= it.tp1) return 'ran';
  if (price <= it.entryHigh * 1.002) return 'in-zone';
  if (price <= it.entryHigh * 1.02) return 'near';
  return 'far';
}
// hours left of the 48h fill window
export const windowLeftH = (signalAt, now = Date.now()) => signalAt ? Math.max(0, 48 - (now - Date.parse(signalAt)) / 3600e3) : null;
export const brisbane = ms => new Date(ms + 10 * 3600e3).toISOString().slice(11, 16);
export const nextH4Close = (now = Date.now()) => (Math.floor(now / 14400e3) + 1) * 14400e3;

export function candidates(setups, signals, minOpp = 70) {
  const m = new Map();
  for (const s of signals) if (s.status === 'waiting for entry' && s.entryHigh) m.set(s.pool, { id: s.id, coin: s.coin, chain: s.chain, pool: s.pool, setup: s.setup, entryLow: s.entryLow, entryHigh: s.entryHigh, stop: s.stop, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, signalAt: s.signalAt, kind: 'signal' });
  for (let r of setups) {
    if (r.lead === 'pattern' && r.patName && r.patEntryLow != null) r = { ...r, setupType: r.patName, entryLow: r.patEntryLow, entryHigh: r.patEntryHigh, stop: r.patStop, tp1: r.patTp1, tp2: r.patTp2, tp3: r.patTp3 };
    if (!r.entryHigh || !r.stop) continue;
    const bid = r.signal === 'Entry signal', hot = r.signal === 'Watch' && (r.opp ?? 0) >= minOpp;
    if (!bid && !hot) continue;
    const prev = m.get(r.pool);
    m.set(r.pool, { id: r.id, coin: r.coin, chain: r.chain, pool: r.pool, token: r.token, setup: r.setupType, opp: r.opp, entryLow: r.entryLow, entryHigh: r.entryHigh, stop: r.stop, tp1: r.tp1, tp2: r.tp2, tp3: r.tp3, signalAt: prev?.signalAt || null, kind: bid ? 'bid' : 'watch', liquidity: r.liquidity ?? null, rug: r.rug ?? null });
  }
  return [...m.values()];
}

export async function fetchPrices(items, getJson, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const by = {};
  for (const it of items) { const n = NETOF[String(it.chain).toLowerCase()] || String(it.chain).toLowerCase(); (by[n] ||= []).push(it); }
  const px = {};
  for (const [n, arr] of Object.entries(by)) {
    const chainId = DS[n] || n;
    for (let i = 0; i < arr.length; i += 30) {
      try {
        const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${chainId}/${arr.slice(i, i + 30).map(p => p.pool).join(',')}`);
        for (const q of j.pairs || []) { const v = Number(q.priceUsd); if (v > 0) px[String(q.pairAddress).toLowerCase()] = { price: v, liq: q.liquidity?.usd ?? null, h1b: q.txns?.h1?.buys ?? null, h1s: q.txns?.h1?.sells ?? null, m5b: q.txns?.m5?.buys ?? null, m5s: q.txns?.m5?.sells ?? null, ch1: q.priceChange?.h1 ?? null }; }
      } catch { /* one chain failing must not stop the rest */ }
      await sleep(300);
    }
  }
  return px;
}

async function main() {
  const meta = readJson(path.join(OUT, 'meta.json'), null);
  if (!meta) { console.log('no scan data yet'); return; }
  const wpath = path.join(OUT, 'watch.json'), prev = readJson(wpath, { sent: {} }), sent = prev.sent && typeof prev.sent === 'object' && !Array.isArray(prev.sent) ? prev.sent : {};
  // two backup slots per half hour: skip if a watcher ran in the last 12 minutes
  if (process.env.GITHUB_EVENT_NAME === 'schedule' && prev.at && Date.now() - Date.parse(prev.at) < 12 * 60e3) { console.log('watcher ran recently, skipping'); return; }
  const items = candidates(readJson(path.join(OUT, 'setups.json'), []), readJson(path.join(OUT, 'signals.json'), []), 70);
  const getJson = async url => { const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const px = await fetchPrices(items, getJson);
  const now = Date.now(), nowIso = new Date(now).toISOString().slice(0, 19) + 'Z';
  const site = process.env.GITHUB_REPOSITORY ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0]}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '';
  const live = [], alerts = [];
  for (const it of items) {
    const d = px[String(it.pool).toLowerCase()] || null, price = d ? d.price : null, state = price == null ? 'unknown' : classify(it, price);
    const left = windowLeftH(it.signalAt, now);
    const liqChg = d && d.liq != null && it.liquidity ? +((d.liq / it.liquidity - 1) * 100).toFixed(0) : null;
    live.push({ id: it.id, coin: it.coin, kind: it.kind, price, state, h1b: d?.h1b ?? null, h1s: d?.h1s ?? null, m5b: d?.m5b ?? null, m5s: d?.m5s ?? null, liq: d?.liq ?? null, liqChgPct: liqChg, entryLow: it.entryLow, entryHigh: it.entryHigh, stop: it.stop, tp1: it.tp1, distPct: price && it.entryHigh ? +((price / it.entryHigh - 1) * 100).toFixed(1) : null, windowLeftH: left == null ? null : +left.toFixed(1) });
    const flow = d && d.h1b != null && d.h1s != null ? ` Last hour on DexScreener: ${d.h1b} buys / ${d.h1s} sells${d.h1s > d.h1b * 1.5 ? ' (sellers dominate: consider waiting for the 4h close)' : d.h1b > d.h1s * 1.2 ? ' (buyers lead)' : ''}.` : '';
    if (liqChg != null && liqChg <= -40 && (!sent[it.id + '|liq'] || now - Date.parse(sent[it.id + '|liq']) < 0 || now - Date.parse(sent[it.id + '|liq']) > 12 * 3600e3)) alerts.push({ key: it.id + '|liq', t: `${it.coin}: liquidity dropping`, p: 'high', b: `${it.coin} liquidity is down ${Math.abs(liqChg)}% since the last scan (now ${Math.round(d.liq).toLocaleString('en')} USD). Possible rug or liquidity pull: do not enter, and check any open position now.` });
    const pulled = liqChg != null && liqChg <= -40; // liquidity collapsing: never say buy
    const cool = { 'in-zone': pulled ? 0 : 6, near: pulled ? 0 : 12, invalid: 24, ran: it.kind === 'watch' ? 0 : 24 }[state]; if (!cool) continue;
    const key = `${it.id}|${state}`; if (sent[key] && now - Date.parse(sent[key]) < cool * 3600e3) continue;
    const zone = `${it.entryLow}-${it.entryHigh}`, win = left != null ? ` Fill window ${Math.round(left)}h left.` : '';
    const msg = {
      'in-zone': { t: `${it.coin}: price is IN the entry zone`, p: it.kind === 'watch' ? 'default' : 'high', b: `${it.coin} (${it.chain}) ${it.setup || ''} now ${price}. Buy zone ${zone}, stop ${it.stop}, TP1 ${it.tp1}.${win}${flow} ${it.kind === 'watch' ? 'This is a Watch setup, not bid-ready: smaller size or wait for the 4h close.' : ''}` },
      near: { t: `${it.coin}: approaching the entry zone`, p: 'low', b: `${it.coin} now ${price}, ${((price / it.entryHigh - 1) * 100).toFixed(1)}% above the top of the zone ${zone}. Place the limit order at ${it.entryHigh}, stop ${it.stop}.${win}` },
      invalid: { t: `${it.coin}: setup invalidated`, p: 'default', b: `${it.coin} traded through the stop ${it.stop} (now ${price}) before any fill. Do not buy this setup; cancel any resting order.` },
      ran: { t: `${it.coin}: ran without a fill, do not chase`, p: 'default', b: `${it.coin} is at ${price}, past TP1 ${it.tp1}, and never came back into ${zone}. The entry is gone; wait for a new setup.` },
    }[state];
    alerts.push({ key, ...msg });
  }
  // early-move checker on the free DexScreener feed (every watcher run, ~15 minutes)
  let pulse = prev.pulse && typeof prev.pulse === 'object' ? prev.pulse : { recent: [] };
  try { const uni = readJson(path.join(OUT, 'universe.json'), []); if (uni.length) { const hits = await pulseScan(uni, getJson); pulse = updatePulse(prev.pulse, hits, now); const st = readJson('config/settings.json', {});
      if (st.pulseAlert !== false) for (const h of pulse.fresh.slice(0, 2)) alerts.push({ key: 'P|' + h.pool, t: `Early move: ${h.coin} (${h.chain})`, p: 'default', b: `${h.why.join('. ')}. Price ${h.price}, liquidity $${h.liq.toLocaleString('en')}.${h.url ? ' ' + h.url : ''}\n\nEarly pulse book (paper-tested only): not a bid-ready call.` });
      console.log(`pulse: ${uni.length} coins checked, ${hits.length} moving now, ${pulse.fresh.length} new`); } } catch (e) { console.log('pulse skipped: ' + (e.message || e)); }
  // your positions (config/positions/*.json) and bid-ready setups: volume dying, sellers taking over, stop and TP1. "volumeAlert": false turns it off.
  let posRows = [];
  try { const st = readJson('config/settings.json', {}), pos = loadPositions(), bids = items.filter((it) => it.kind === 'bid');
    if (st.volumeAlert !== false && (pos.length || bids.length)) { const r = await positionScan(pos, bids, getJson, now, sent); alerts.push(...r.alerts); posRows = r.rows; console.log(`positions: ${pos.length} held, ${bids.length} bid-ready checked, ${r.alerts.length} alert(s)`); } } catch (e) { console.log('position checks skipped: ' + (e.message || e)); }
  // cut-on-sellers check for the "Degen · cut on sellers" paper book (paper only, no alert)
  let flow = prev.flow && Array.isArray(prev.flow.events) ? prev.flow : { events: [] };
  try { const open = readJson(path.join(OUT, 'lab.json'), []).filter((x) => x && x.book === 'degenFlow' && x.status === 'open' && !x.cut && +x.entryPx > 0);
    const done = new Set(flow.events.map((e) => e.lid)), ev = open.length ? (await flowScan(open.filter((x) => !done.has(x.lid)), getJson, nowIso)) : [];
    flow = { at: nowIso, events: [...flow.events.filter((e) => now - Date.parse(e.t) < 72 * 3600e3), ...ev].slice(-200) }; if (open.length) console.log(`cut-on-sellers: ${open.length} open positions checked, ${ev.length} would cut now`); } catch (e) { console.log('cut-on-sellers check skipped: ' + (e.message || e)); }
  // trade alerts (positions, pulse, bid-ready checks) reach the phone only with "phoneAlerts": "all" in config/settings.json; they still show on the dashboard
  const topic = readJson('config/settings.json', {}).phoneAlerts === 'all' ? (process.env.NTFY_TOPIC || '').trim() : '';
  if (alerts.length && !topic) console.log(`${alerts.length} trade alert(s) not sent: the phone gets health alerts only`);
  for (const a of alerts) {
    if (!topic) break;
    try {
      const h = { Title: a.t, Priority: a.p, Tags: a.p === 'high' ? 'rotating_light,rhinoceros' : 'rhinoceros' }; if (site) h.Click = site;
      const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: a.b, headers: h });
      console.log('alert', a.key, r.status); if (r.ok) sent[a.key] = new Date().toISOString();
    } catch (e) { console.log('alert failed', e.message); }
  }
  for (const k of Object.keys(sent)) if (now - Date.parse(sent[k]) > 3 * 86400e3) delete sent[k];
  const { fresh: _f, ...pulseOut } = pulse; fs.writeFileSync(wpath, JSON.stringify({ at: nowIso, scanAt: meta.scannedAt, items: live, sent, pulse: pulseOut, flow, positions: posRows }));
  console.log(`watched ${items.length} setups, ${live.filter(x => x.price).length} priced, ${alerts.length} alerts`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
