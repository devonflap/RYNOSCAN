// RynoScan backtest: replays the chart rules over the last ~40 days of hourly candles for the coins the scanner
// currently follows, then walks every signal forward with the same exit rules (fill within 48h, a third sold at each
// TP, stop to breakeven after TP1, 7-day time exit) and reports results in R. Run: node src/backtest.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../docs/core.mjs';
import { discoverPools } from '../docs/pools.mjs';
import { makeApi } from './api.mjs';

const OUT = process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = readJson(process.env.SETTINGS_FILE || 'config/settings.json', {});
const api = makeApi();
const cfg = {
  minVolume: settings.minVolume ?? 100000, minLiquidity: settings.minLiquidity ?? 100000, chains: settings.chains,
  extraPages: api.keyed ? (settings.extraPages ?? 0) : 0,
  maxPools: Math.min(api.keyed ? (settings.backtestPools ?? 150) : 40, api.keyed ? (settings.maxPools ?? 200) : (settings.freeMaxPools ?? 60)),
  cap: api.keyed ? (settings.cap ?? { solana: 70, robinhood: 50, eth: 20 }) : (settings.freeCap ?? { solana: 40, robinhood: 40, eth: 12 }),
};
const t0 = Date.now(); const say = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
say(`backtest: plan ${api.plan}, up to ${cfg.maxPools} coins`);
const { list } = await discoverPools(api.get, cfg, [], m => api.log.push(m));
const WARM = 384, TAIL = 192, STEP_OK = t => (t + 3600) % 14400 === 0; // 4h candle just closed
const signals = []; let coins = 0, cuts = 0, i = 0;
for (const p0 of list) {
  const j = await api.get(`/networks/${p0.net}/pools/${p0.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list; if (!raw || raw.length < WARM + TAIL + 24) { if (++i % 20 === 0) say(`${i}/${list.length}`); continue; }
  const h1 = raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)); coins++;
  let busyUntil = 0;
  for (let k = WARM; k < h1.length - TAIL; k++) {
    const t = h1[k][0]; if (!STEP_OK(t) || t < busyUntil) continue; cuts++;
    const hist = h1.slice(0, k + 1), l24 = hist.slice(-24), l4 = hist.slice(-4);
    const upV = a => a.reduce((s, b) => s + (b[4] >= b[1] ? b[5] : 0), 0), dnV = a => a.reduce((s, b) => s + (b[4] < b[1] ? b[5] : 0), 0);
    const p = { ...p0, price: hist[k][4], v24: l24.reduce((s, b) => s + b[5], 0), v1: hist[k][5], ch24: (hist[k][4] / l24[0][1] - 1) * 100, fdv: null,
      created: new Date((t - 30 * 86400) * 1000).toISOString(), b1: upV(l4), s1: dnV(l4) || 1e-9, b24: upV(l24), s24: dnV(l24) || 1e-9, buyers24: upV(l24), sellers24: dnV(l24), flags: [] };
    if (!C.techFromRaw(p, hist)) continue;
    C.scoreList([p], t * 1000);
    if (p.signal !== 'Entry signal' || !p.sp || !p.sp.entryMid) continue;
    const at = new Date(t * 1000).toISOString().slice(0, 19) + 'Z';
    const res = C.evaluate(C.newSignal(p, at), h1, new Date(h1[h1.length - 1][0] * 1000).toISOString());
    signals.push({ coin: p0.sym, chain: C.CH[p0.chain], setup: p.setupType, at, status: res.status, tpHit: res.tpHit, resultR: res.resultR, baseOpp: p.opp, riskPct: p.sp.riskPct });
    busyUntil = res.closedAt ? Date.parse(res.closedAt) / 1000 : h1[h1.length - 1][0] + 1;
  }
  if (++i % 20 === 0) say(`${i}/${list.length} coins, ${signals.length} signals so far`);
}
const stat = (rows) => {
  const closed = rows.filter(s => s.resultR != null && s.status !== 'expired (no fill)'), R = closed.map(s => s.resultR).sort((a, b) => a - b);
  const wins = closed.filter(s => s.resultR > 0), gain = wins.reduce((a, s) => a + s.resultR, 0), loss = closed.filter(s => s.resultR <= 0).reduce((a, s) => a - s.resultR, 0);
  return { signals: rows.length, noFill: rows.filter(s => s.status === 'expired (no fill)').length, closed: closed.length, winRate: closed.length ? +(wins.length / closed.length).toFixed(3) : null,
    avgR: closed.length ? +(R.reduce((a, b) => a + b, 0) / closed.length).toFixed(2) : null, medianR: closed.length ? R[Math.floor(R.length / 2)] : null, profitFactor: loss > 0 ? +(gain / loss).toFixed(2) : null,
    tp1Rate: closed.length ? +(closed.filter(s => s.tpHit >= 1).length / closed.length).toFixed(3) : null };
};
const types = [...new Set(signals.map(s => s.setup))];
const result = { at: new Date().toISOString().slice(0, 19) + 'Z', coins, cuts, days: Math.round((1000 - WARM - TAIL) / 24), overall: stat(signals), byType: types.map(t => ({ setup: t, ...stat(signals.filter(s => s.setup === t)) })).sort((a, b) => b.closed - a.closed),
  byChain: [...new Set(signals.map(s => s.chain))].map(c => ({ chain: c, ...stat(signals.filter(s => s.chain === c)) })),
  notes: ['Replays the chart rules only. Buyer/seller balance is approximated from candle volume and age/liquidity are assumed, so real signals are a little stricter than these.',
    'Covers about 17 days of signals (the data feed gives 1000 hourly candles, 8 days are kept for exits), on coins that are active today, which flatters the results (survivorship).',
    'Treat it as a sanity check on which setups to trust, not a forecast. Fewer than about 30 closed signals in a row means no conclusion.'],
  sample: signals.slice(-40) };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'backtest.json'), JSON.stringify(result));
console.log(JSON.stringify({ overall: result.overall, byType: result.byType }, null, 1));
say(`done: ${coins} coins, ${cuts} checkpoints, ${signals.length} signals, ${api.stats().calls} data calls`);
