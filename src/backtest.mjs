// RynoScan backtest: replays the chart rules over the last ~40 days of hourly candles for the coins the scanner
// currently follows, then walks every signal forward with the same exit rules (fill within 48h, a third sold at each
// TP, stop to breakeven after TP1, 7-day time exit) and reports results in R. Run: node src/backtest.mjs
import { runnerReport } from './runnerlearn.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../docs/core.mjs';
import { discoverPools } from '../docs/pools.mjs';
import { makeApi } from './api.mjs';
import { learn } from './learn.mjs';

const OUT = process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? (Array.isArray(j) ? j : d) : (j && typeof j === 'object' && !Array.isArray(j) ? j : d); } catch { return d; } };
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
const VARIANTS = { 'Breakeven after TP1 (current)': { tp1Stop: 0 }, 'Stop half a risk below entry after TP1': { tp1Stop: 0.5 }, 'Keep the original stop until TP2': { tp1Stop: 1 }, 'Breakeven after TP1, then stop at TP1 after TP2': { tp1Stop: 0, ladder: true } };
const DEFAULT_OFF = [...C.RULES.off], DEFAULT_SHADOW = [...C.RULES.shadow], isLive = n => !DEFAULT_OFF.includes(n) && !DEFAULT_SHADOW.includes(n);
C.RULES.allowShadow = true; C.RULES.off = []; // the replay measures every pattern, including candidates and switched-off ones, so the learner can see them
const signals = [], nmRows = []; let coins = 0, cuts = 0, i = 0;
for (const p0 of list) {
  const j = await api.get(`/networks/${p0.net}/pools/${p0.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list; if (!raw || raw.length < WARM + TAIL + 24) { if (++i % 20 === 0) say(`${i}/${list.length}`); continue; }
  const h1 = raw.slice().sort((a, b) => a[0] - b[0]).map(b => b.map(Number)); coins++;
  let busyUntil = 0, nmBusy = 0;
  for (let k = WARM; k < h1.length - TAIL; k++) {
    const t = h1[k][0]; if (!STEP_OK(t) || t < busyUntil) continue; cuts++;
    const hist = h1.slice(0, k + 1), l24 = hist.slice(-24), l4 = hist.slice(-4);
    const upV = a => a.reduce((s, b) => s + (b[4] >= b[1] ? b[5] : 0), 0), dnV = a => a.reduce((s, b) => s + (b[4] < b[1] ? b[5] : 0), 0);
    const p = { ...p0, price: hist[k][4], v24: l24.reduce((s, b) => s + b[5], 0), v1: hist[k][5], ch24: (hist[k][4] / l24[0][1] - 1) * 100, fdv: null,
      created: new Date((t - 30 * 86400) * 1000).toISOString(), b1: upV(l4), s1: dnV(l4) || 1e-9, b24: upV(l24), s24: dnV(l24) || 1e-9, buyers24: upV(l24), sellers24: dnV(l24), flags: [] };
    if (!C.techFromRaw(p, hist)) continue;
    C.scoreList([p], t * 1000);
    const at = new Date(t * 1000).toISOString().slice(0, 19) + 'Z', endAt = new Date(h1[h1.length - 1][0] * 1000).toISOString();
    if (p.signal !== 'Entry signal' || !p.sp || !p.sp.entryMid) {
      // near-misses: coins the filter rejected (opp 50+, valid plan), replayed with the same fill and exit rules, one per coin per 24h.
      // This gives the gate study and the filter audit accepted-versus-rejected trades from the same method in one run instead of weeks of waiting.
      if (p.sp && p.sp.entryMid && p.opp != null && p.opp >= 50 && t >= nmBusy) { try {
        const g = C.newSignal(p, at); if (g.miss) { const r = C.evaluate(g, h1, endAt, { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder, fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 });
          nmRows.push({ source: 'backtest-nm', setup: 'Near-miss: ' + g.setup, setupBase: g.setup, chain: C.CH[p0.chain], at, coin: p0.sym, resultR: r.resultR, status: r.status, riskPct: p.sp.riskPct, opp: g.opp, miss: g.miss, gp: g.gp, conf: g.conf, zr: g.zr, rr2: g.rr2, pq: g.pq, rvol: g.rvol, mfeR: r.mfeR, maeR: r.maeR }); nmBusy = t + 24 * 3600; } } catch { /* skip */ } }
      continue;
    }
    const sg = C.newSignal(p, at);
    const exitOpts = { tp1Stop: settings.exitTp1Stop ?? 0, ladder: !!settings.exitLadder, fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 };
    const res = C.evaluate(sg, h1, endAt, exitOpts), opt = C.evaluate(sg, h1, endAt, { ...exitOpts, fillAt: 'mid', slipPct: 0 });
    const variants = {}; for (const [name, o] of Object.entries(VARIANTS)) variants[name] = C.evaluate(sg, h1, endAt, { ...exitOpts, ...o }).resultR;
    signals.push({ variants, optR: opt.resultR, miss: sg.miss, gp: sg.gp, conf: sg.conf, zr: sg.zr, rr2: sg.rr2, pq: sg.pq, rvol: sg.rvol, mfeR: res.mfeR, maeR: res.maeR, coin: p0.sym, chain: C.CH[p0.chain], setup: p.setupType, at, status: res.status, tpHit: res.tpHit, resultR: res.resultR, baseOpp: p.opp, riskPct: p.sp.riskPct });
    busyUntil = res.closedAt ? Date.parse(res.closedAt) / 1000 : h1[h1.length - 1][0] + 1;
    if (res.status === 'stopped out') busyUntil += (settings.cooldownHours ?? 48) * 3600; // cooldown after a stop-out
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
const exitVariants = Object.keys(VARIANTS).map(name => ({ name, ...stat(signals.filter(s => isLive(s.setup) && s.variants && s.variants[name] != null).map(s => ({ ...s, resultR: s.variants[name], tpHit: s.tpHit, status: s.status }))) }));
const types = [...new Set(signals.map(s => s.setup))];
const result = { at: new Date().toISOString().slice(0, 19) + 'Z', coins, cuts, days: Math.round((1000 - WARM - TAIL) / 24), overall: stat(signals.filter(s => isLive(s.setup))), byType: types.map(t => ({ setup: t, candidate: !isLive(t), ...stat(signals.filter(s => s.setup === t)) })).sort((a, b) => b.closed - a.closed),
  exitVariants, fill: { fillAt: settings.fillAt ?? 'mid', slipPct: settings.slipPct ?? 0 },
  optimistic: stat(signals.filter(s => isLive(s.setup)).map(s => ({ ...s, resultR: s.optR }))),
  byChain: [...new Set(signals.map(s => s.chain))].map(c => ({ chain: c, ...stat(signals.filter(s => s.chain === c && isLive(s.setup))) })),
  notes: ['Replays the chart rules only. Buyer/seller balance is approximated from candle volume and age/liquidity are assumed, so real signals are a little stricter than these.',
    'Covers about 17 days of signals (the data feed gives 1000 hourly candles, 8 days are kept for exits), on coins that are active today, which flatters the results (survivorship).',
    'Treat it as a sanity check on which setups to trust, not a forecast. Fewer than about 30 closed signals in a row means no conclusion.'],
  all: signals.map(s => ({ source: 'backtest', miss: s.miss, gp: s.gp, conf: s.conf, zr: s.zr, rr2: s.rr2, pq: s.pq, rvol: s.rvol, mfeR: s.mfeR, maeR: s.maeR, setup: s.setup, chain: s.chain, at: s.at, coin: s.coin, resultR: s.resultR, status: s.status, riskPct: s.riskPct, opp: s.baseOpp })),
  sample: signals.slice(-40).map(({ variants, optR, ...r }) => r) };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'backtest.json'), JSON.stringify(result));
{ const live = readJson(path.join(OUT, 'signals.json'), []).map(s => ({ source: 'live', gp: s.gp, conf: s.conf, miss: s.miss, zr: s.zr, liq: s.liq, age: s.age, rvol: s.rvol, bs: s.bs, rr2: s.rr2, pq: s.pq, mfeR: s.mfeR, maeR: s.maeR, setup: s.setup, chain: s.chain, at: s.signalAt, coin: s.coin, resultR: s.resultR, status: s.status, riskPct: s.entryHigh && s.stop ? +((s.entryMid - s.stop) / s.entryMid * 100).toFixed(1) : null, opp: s.opp ?? s.score, verdict: s.panel?.verdict, regime: s.regime, volDay: s.volDay, hsD7: s.hsD7, soc: s.soc }));
  const fwd = readJson(path.join(OUT, 'forward.json'), []).map(s => ({ setup: s.shadow || s.early1h ? (s.setup || 'Unknown') : 'Near-miss: ' + (s.setup || 'Unknown'), source: s.early1h ? 'early1h' : s.shadow ? 'shadow' : 'near-miss', early1h: !!s.early1h, gp: s.gp, conf: s.conf, miss: s.miss, zr: s.zr, liq: s.liq, age: s.age, rvol: s.rvol, bs: s.bs, rr2: s.rr2, pq: s.pq, mfeR: s.mfeR, maeR: s.maeR, setupBase: s.setup || 'Unknown', chain: s.chain, at: s.signalAt, coin: s.coin, resultR: s.resultR, status: s.status, riskPct: s.entryHigh && s.stop ? +((s.entryMid - s.stop) / s.entryMid * 100).toFixed(1) : null, opp: s.opp ?? s.score, regime: s.regime, volDay: s.volDay, hsD7: s.hsD7, soc: s.soc }));
  const L = learn([...result.all, ...nmRows, ...live, ...fwd], { off: DEFAULT_OFF, shadow: DEFAULT_SHADOW }, new Date(), { funnelHistory: readJson(path.join(OUT, 'funnel-history.json'), []) }); try { L.runners = runnerReport(readJson(path.join(OUT, 'runnerlog.json'), []), new Date(), { lockFrom: readJson(path.resolve('config/study.json'), {}).lockedFrom, fills: readJson(path.resolve('config/livefills.json'), {}).fills }); } catch (e) { console.log('runner study skipped: ' + (e.message || e)); } fs.writeFileSync(path.join(OUT, 'learned.json'), JSON.stringify(L)); console.log('learned:', JSON.stringify({ promote: L.promote, demote: L.demote, insights: L.insights })); }
console.log(JSON.stringify({ overall: result.overall, byType: result.byType }, null, 1));
say(`done: ${coins} coins, ${cuts} checkpoints, ${signals.length} signals, ${api.stats().calls} data calls`);
