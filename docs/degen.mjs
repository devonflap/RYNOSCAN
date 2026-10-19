// Degen desk: the high-risk paper account. It chases volume and price action instead of waiting for a chart pattern, and watches who is trading
// (wallet distribution, how many wallets are buying versus selling, optional watch-list of known good wallets). Paper money only.
// Shared by the scanner (Node) and the dashboard (browser). Nothing here touches the main scanner rules, scores or alerts.
export const DEGEN = { start: 10000, pct: 10, slots: 8, stopPct: 0.20, tpMult: 2, trailPct: 0.30, slipPct: 3, maxHours: 72, maxNew: 3, minLiq: 50000, minV24: 250000, minVacc: 2.5, minBs1: 1.15, minCh24: 10, maxCh24: 400, sizeUsd: 1000 };
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
const r4 = (x) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(5));
const sameAddr = (a, b) => !!a && !!b && (a === b || String(a).toLowerCase() === String(b).toLowerCase());

// trades: [{kind:'buy'|'sell', wallet, usd, ts}]. smart: [{address,label}]
export function walletStats(trades, smart = []) {
  const T = (Array.isArray(trades) ? trades : []).filter((t) => t && t.wallet && (t.kind === 'buy' || t.kind === 'sell') && isFinite(+t.usd));
  if (!T.length) return null;
  const w = new Map(); let buyUsd = 0, sellUsd = 0, tmin = Infinity, tmax = -Infinity;
  for (const t of T) { const g = w.get(t.wallet) || { buy: 0, sell: 0 }; if (t.kind === 'buy') { g.buy += +t.usd; buyUsd += +t.usd; } else { g.sell += +t.usd; sellUsd += +t.usd; } w.set(t.wallet, g); const ts = num(t.ts); if (ts != null) { tmin = Math.min(tmin, ts); tmax = Math.max(tmax, ts); } }
  let buyers = 0, sellers = 0, both = 0, onlyBuy = 0, onlySell = 0; const vols = [];
  for (const g of w.values()) { if (g.buy > 0) buyers++; if (g.sell > 0) sellers++; if (g.buy > 0 && g.sell > 0) both++; else if (g.buy > 0) onlyBuy++; else onlySell++; vols.push(g.buy + g.sell); }
  vols.sort((a, b) => b - a); const tot = buyUsd + sellUsd, top3 = vols.slice(0, 3).reduce((a, b) => a + b, 0);
  const smartIn = [], smartOut = [];
  for (const s of smart || []) { for (const [addr, g] of w) if (sameAddr(addr, s.address)) { if (g.buy > g.sell) smartIn.push(s.label || addr.slice(0, 6)); else if (g.sell > g.buy) smartOut.push(s.label || addr.slice(0, 6)); } }
  return { trades: T.length, wallets: w.size, buyers, sellers, both, onlyBuy, onlySell, buyUsd: Math.round(buyUsd), sellUsd: Math.round(sellUsd), netUsd: Math.round(buyUsd - sellUsd), top3Share: tot > 0 ? +(top3 / tot).toFixed(2) : null,
    spanMin: isFinite(tmax - tmin) && tmax > tmin ? Math.round((tmax - tmin) / 60) : null, smartIn, smartOut };
}
export const walletVerdict = (w) => (!w ? 'wallets unchecked' : w.smartIn.length ? 'smart wallets buying' : w.buyers >= w.sellers * 1.2 && (w.top3Share == null || w.top3Share <= 0.6) ? 'wallets leaning in' : w.sellers >= w.buyers * 1.2 ? 'wallets leaning out' : 'wallets mixed');

// rows: scored pool rows from the scanner. Returns candidates sorted best first: { p, score, why[] }
export function candidates(rows, cfg = DEGEN) {
  const out = [];
  for (const p of rows || []) {
    if (!p || !(num(p.price) > 0) || p.rug === 'danger') continue;
    const liq = num(p.liq) ?? 0, v24 = num(p.v24) ?? 0, vacc = num(p.vacc), bs1 = num(p.bs1), ch = num(p.ch24), rv = p.tf && p.tf['4h'] ? num(p.tf['4h'].rvol) : null;
    if (liq < cfg.minLiq || v24 < cfg.minV24 || ch == null || ch < cfg.minCh24 || ch > cfg.maxCh24) continue;
    const surge = Math.max(vacc ?? 0, rv ?? 0); if (surge < cfg.minVacc) continue;
    if (bs1 == null || bs1 < cfg.minBs1) continue;
    const why = [`volume ${surge.toFixed(1)}x normal`, `up ${ch.toFixed(0)}% in 24h`, `buyers lead ${bs1.toFixed(2)}x`]; let score = Math.min(surge, 8) + Math.min(ch / 40, 4) + Math.min((bs1 - 1) * 4, 3);
    if (num(p.ageD) != null && p.ageD < 3) { why.push('new launch'); score += 1.5; }
    if (p.hs && num(p.hs.growPct) != null && p.hs.growPct > 0) { why.push(`holders +${p.hs.growPct}%`); score += 1; }
    if (p.hs && num(p.hs.top10) != null && p.hs.top10 > 70) { why.push(`top 10 hold ${Math.round(p.hs.top10)}%`); score -= 2; }
    out.push({ p, score: +score.toFixed(2), why });
  }
  return out.sort((a, b) => b.score - a.score);
}
// Wallet gate: leaning out, or a few wallets doing most of the volume, rejects the candidate. Unchecked wallets do not reject.
export function walletOk(w) { if (!w) return true; if (w.sellers >= w.buyers * 1.2 && !w.smartIn.length) return false; if (w.top3Share != null && w.top3Share > 0.7 && !w.smartIn.length) return false; return true; }

export function makeSignal(c, at, wallet, cfg = DEGEN) {
  const p = c.p, px = +p.price, chain = p.chain, id = String(chain).slice(0, 3).toUpperCase() + ':' + p.sym, F = px * (1 + cfg.slipPct / 100);
  return { signalId: id + '@' + at.slice(0, 13), id, coin: p.sym, chain: { solana: 'Solana', eth: 'Ethereum', robinhood: 'Robinhood' }[chain] || chain, pool: p.pool, net: p.net, setup: 'Degen runner', desk: 'degen', signalAt: at, priceAtSignal: r4(px),
    entryLow: r4(F), entryHigh: r4(F), entryMid: r4(F), stop: r4(F * (1 - cfg.stopPct)), tp1: r4(F * cfg.tpMult), tp2: null, tp3: null, status: 'waiting for entry', tpHit: 0, resultR: null, openR: null, closedAt: null, checkedAt: at,
    why: c.why, score: c.score, liq: Math.round(p.liq), v24: Math.round(p.v24), ageD: p.ageD ?? null, hs: p.hs ? { holders: p.hs.holders ?? null, top10: p.hs.top10 ?? null, growPct: p.hs.growPct ?? null } : null, wallet: wallet || null, walletVerdict: walletVerdict(wallet), walletHist: wallet ? [{ t: at, b: wallet.buyers, s: wallet.sellers, n: wallet.netUsd }] : [] };
}
export function pickNew(cands, existing, at, wallets = new Map(), cfg = DEGEN) {
  const openN = existing.filter((s) => s.status === 'open' || s.status === 'waiting for entry').length, out = [], have = new Set(existing.map((s) => s.signalId)), recent = new Set(existing.filter((s) => Date.now() - Date.parse(s.signalAt) < 24 * 3600e3 || s.status === 'open' || s.status === 'waiting for entry').map((s) => s.id));
  for (const c of cands) {
    if (out.length >= cfg.maxNew || openN + out.length >= cfg.slots) break;
    const w = wallets.get(c.p.pool) || null; if (!walletOk(w)) continue;
    const sig = makeSignal(c, at, w, cfg); if (have.has(sig.signalId) || recent.has(sig.id)) continue; out.push(sig); have.add(sig.signalId); recent.add(sig.id);
  }
  return out;
}
// bars: hourly [t,o,h,l,c,v] ascending (seconds). Entry: the open of the first hour after the signal plus slippage. Stop 20% below entry, half sold at 2x, the rest trails 30% below its high
// (never below break-even), everything sold after 72 hours. If one hour touches both the stop and the target, the stop is assumed to come first.
export function evaluateDegen(s, bars, at, cfg = DEGEN) {
  const t0 = Date.parse(s.signalAt) / 1000, B = (Array.isArray(bars) ? bars : []).filter((b) => b && b[0] >= t0 && [b[1], b[2], b[3], b[4]].every((v) => isFinite(+v) && +v > 0));
  if (!B.length) return { ...s, checkedAt: at };
  // Realistic cost: besides the flat slippage, buying and selling a $1,000 position moves the price by about size / liquidity each way (thin coins cost more).
  const liq = num(s.liq), imp = liq && liq > 0 ? Math.min(0.5, (cfg.sizeUsd || 0) / liq) : 0, eff = (x) => x * (1 - imp);
  const F = +B[0][1] * (1 + cfg.slipPct / 100 + imp), stop = F * (1 - cfg.stopPct), T = F * cfg.tpMult, risk = cfg.stopPct; let hit = 0, hi = F, status = 'open', exit = null, closedAt = null, last = F;
  const ret = (ex) => (hit ? 0.5 * (eff(T) / F - 1) + 0.5 * (eff(ex) / F - 1) : eff(ex) / F - 1);
  for (const b of B) {
    const [t, o, h, l, c] = b.map(Number); last = c;
    if (t > B[0][0] + cfg.maxHours * 3600) { exit = c; status = 'time exit (72 hours)'; closedAt = t; break; }
    if (!hit) { if (l <= stop) { exit = Math.min(stop, o); status = 'stopped out'; closedAt = t; break; } if (h >= T) { hit = 1; hi = Math.max(F, h); } }
    else { hi = Math.max(hi, h); const trail = Math.max(F, hi * (1 - cfg.trailPct)); if (l <= trail) { exit = Math.min(trail, o); status = 'trailed out after 2x'; closedAt = t; break; } }
    hi = Math.max(hi, h);
  }
  const base = { ...s, slipUsed: +(cfg.slipPct + imp * 100).toFixed(1), entryLow: r4(F), entryHigh: r4(F), entryMid: r4(F), stop: r4(stop), tp1: r4(T), tpHit: hit, checkedAt: at, peakMult: r4(hi / F) };
  if (exit != null) return { ...base, status, resultR: +(ret(exit) / risk).toFixed(2), retPct: +(ret(exit) * 100).toFixed(1), peakPct: +((hi / F - 1) * 100).toFixed(0), openR: null, closedAt: new Date(closedAt * 1000).toISOString().slice(0, 16) + 'Z' };
  return { ...base, status: 'open', resultR: null, openR: +(ret(last) / risk).toFixed(2), openRet: +(ret(last) * 100).toFixed(1), peakPct: +((hi / F - 1) * 100).toFixed(0), closedAt: null };
}

// ---- High risk, high reward runners: a ranked list shown next to the bid-ready charts. Looser than the degen paper desk (risks are shown, not rejected). ----
export const RUNNER = { exitUsd: 1000, maxExitPct: 4, minLiq: 30000, minV24: 250000, minSurge: 1.8, minCh24: 5, minBs1: 1.0 };
export function runnerScore(p, wallet) {
  const parts = [], flags = [], add = (k, pts, note) => { if (pts > 0) parts.push({ k, pts: Math.round(pts), note }); };
  const vacc = num(p.vacc), rv = p.tf && p.tf['4h'] ? num(p.tf['4h'].rvol) : null, surge = Math.max(vacc ?? 0, rv ?? 0), bs1 = num(p.bs1), ch = num(p.ch24), liq = num(p.liq) ?? 0, v24 = num(p.v24) ?? 0, fdv = num(p.fdv);
  add('Volume', Math.min(25, surge * 5), `${surge.toFixed(1)}x its normal volume`);
  if (bs1 != null) add('Buyers', Math.min(15, Math.max(0, (bs1 - 1) * 30)), `buyers lead sellers ${bs1.toFixed(2)}x`);
  if (ch != null) add('Momentum', ch >= 10 && ch <= 150 ? 10 : ch > 150 && ch <= 400 ? 5 : ch >= 5 ? 4 : 0, `${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% in 24h`);
  if (wallet) {
    let w = 0; const ratio = wallet.buyers / Math.max(1, wallet.sellers); w += Math.min(12, Math.max(0, (ratio - 1) * 8)); if (wallet.netUsd > 0) w += 5; if (wallet.top3Share != null && wallet.top3Share <= 0.45) w += 4; if (wallet.smartIn && wallet.smartIn.length) w += 4;
    add('Wallets', Math.min(25, w), `${wallet.buyers} wallets buying vs ${wallet.sellers} selling, net ${wallet.netUsd >= 0 ? '+' : '−'}$${Math.abs(wallet.netUsd).toLocaleString('en')}${wallet.smartIn && wallet.smartIn.length ? ', smart wallets in: ' + wallet.smartIn.join(', ') : ''}`);
    if (wallet.sellers >= wallet.buyers * 1.2) flags.push('more wallets selling than buying'); if (wallet.top3Share != null && wallet.top3Share > 0.6) flags.push(`3 wallets make ${Math.round(wallet.top3Share * 100)}% of the volume`); if (wallet.smartOut && wallet.smartOut.length) flags.push('smart wallets selling: ' + wallet.smartOut.join(', '));
  } else flags.push('wallet activity not checked yet');
  if (p.hs) { let h = 0; if (num(p.hs.growPct) != null && p.hs.growPct > 0) h += Math.min(10, p.hs.growPct); if (num(p.hs.top10) != null && p.hs.top10 < 50) h += 5; add('Holders', Math.min(15, h), `${p.hs.holders != null ? Number(p.hs.holders).toLocaleString('en') + ' holders' : 'holders'}${num(p.hs.growPct) != null ? `, ${p.hs.growPct >= 0 ? '+' : ''}${p.hs.growPct}% growth` : ''}${num(p.hs.top10) != null ? `, top 10 hold ${Math.round(p.hs.top10)}%` : ''}`); if (num(p.hs.top10) != null && p.hs.top10 > 70) flags.push(`top 10 wallets hold ${Math.round(p.hs.top10)}%`); }
  const turn = liq > 0 ? v24 / liq : null; let lp = 0; if (turn != null && turn >= 0.5 && turn <= 8) lp += 5; if (fdv && liq && fdv / liq < 30) lp += 5; add('Liquidity', lp, `$${Math.round(liq).toLocaleString('en')} liquidity, ${turn != null ? turn.toFixed(1) + 'x daily turnover' : ''}`);
  const age = num(p.ageD); if (age != null) add('New launch', age < 3 ? 5 : age < 14 ? 2 : 0, `${age.toFixed(1)} days old`);
  if (p.soc && num(p.soc.n) != null) add('Socials', p.soc.n >= 2 ? 5 : p.soc.n === 1 ? 2 : 0, `${p.soc.n} social link${p.soc.n === 1 ? '' : 's'} listed`);
  if (ch != null && ch > 250) flags.push(`already up ${ch.toFixed(0)}%, may be late`); if (liq < 75000) flags.push('thin liquidity, hard to exit'); if (age != null && age < 1) flags.push('under a day old'); if (fdv && liq && fdv / liq > 60) flags.push('valuation far above liquidity');
  if (p.rug === 'warn' || p.rug === 'caution') flags.push('token safety check flagged: ' + (p.rugFlags || p.rug)); else if (!p.rug || p.rug === 'unchecked') flags.push('token safety not checked'); if (p.soc && p.soc.n === 0) flags.push('no social links');
  const score = Math.min(100, parts.reduce((a, x) => a + x.pts, 0));
  return { score, tier: score >= 70 ? 'Strong runner' : score >= 50 ? 'Runner' : 'Watch', parts, flags };
}
export function runnerCandidates(rows, n = 12, cfg = RUNNER) {
  const out = [];
  for (const p of rows || []) {
    if (!p || !(num(p.price) > 0) || p.rug === 'danger') continue;
    const vacc = num(p.vacc), rv = p.tf && p.tf['4h'] ? num(p.tf['4h'].rvol) : null, surge = Math.max(vacc ?? 0, rv ?? 0), bs1 = num(p.bs1), ch = num(p.ch24);
    if ((num(p.liq) ?? 0) < cfg.minLiq || (num(p.v24) ?? 0) < cfg.minV24 || surge < cfg.minSurge || ch == null || ch < cfg.minCh24 || bs1 == null || bs1 < cfg.minBs1) continue;
    out.push({ p, pre: surge * 5 + Math.min(ch / 20, 5) + (bs1 - 1) * 10 });
  }
  return out.sort((a, b) => b.pre - a.pre).slice(0, n);
}
// The four checks shown on each card. ok: true / false, or null when the data is not there yet.
export function runnerChecks(p, wallet) {
  const vacc = num(p.vacc), rv = p.tf && p.tf['4h'] ? num(p.tf['4h'].rvol) : null, surge = Math.max(vacc ?? 0, rv ?? 0), bs1 = num(p.bs1), g = p.hs ? num(p.hs.growPct) : null;
  return [{ k: 'Volume surge', ok: surge >= 2.5, note: `${surge.toFixed(1)}x normal (needs 2.5x)` }, { k: 'Buyers leading', ok: bs1 == null ? null : bs1 >= 1.15, note: bs1 == null ? 'no data' : `${bs1.toFixed(2)}x (needs 1.15x)` },
    { k: 'Wallets leaning in', ok: wallet ? wallet.buyers >= wallet.sellers * 1.2 && wallet.netUsd > 0 : null, note: wallet ? `${wallet.buyers} buying vs ${wallet.sellers} selling, net ${wallet.netUsd >= 0 ? '+' : '−'}$${Math.abs(wallet.netUsd).toLocaleString('en')}` : 'not checked yet' },
    { k: 'Holders growing', ok: g == null ? null : g > 0, note: g == null ? 'no holder history yet' : `${g >= 0 ? '+' : ''}${g}%` }];
}
// Risk rules that drop a coin from the list (it is still logged, so the data can show whether the rules help).
export function runnerVeto(p, wallet) {
  const r = [], liq = num(p.liq) ?? 0, ch = num(p.ch24), fdv = num(p.fdv);
  if (wallet && wallet.sellers >= wallet.buyers * 1.2 && !(wallet.smartIn && wallet.smartIn.length)) r.push('more wallets selling than buying');
  if (wallet && wallet.top3Share != null && wallet.top3Share > 0.6 && !(wallet.smartIn && wallet.smartIn.length)) r.push(`3 wallets make ${Math.round(wallet.top3Share * 100)}% of the volume`);
  if (wallet && wallet.smartOut && wallet.smartOut.length) r.push('smart wallets selling');
  if (p.rug === 'warn' || p.rug === 'caution') r.push('token safety check flagged');
  if (p.hs && num(p.hs.top10) != null && p.hs.top10 > 80) r.push(`top 10 wallets hold ${Math.round(p.hs.top10)}%`);
  if (liq < 50000) r.push('liquidity under $50k');
  if (liq > 0 && RUNNER.exitUsd / liq * 100 > RUNNER.maxExitPct) r.push(`selling $${RUNNER.exitUsd.toLocaleString('en')} would move the price about ${(RUNNER.exitUsd / liq * 100).toFixed(1)}%`);
  { const v = num(p.v24); if (v != null && liq > 0 && v / liq > 60) r.push(`daily volume is ${Math.round(v / liq)}x the pool, a pump or wash-trading sign`); }
  if (ch != null && ch > 400) r.push(`already up ${Math.round(ch)}%`);
  if (fdv && liq && fdv / liq > 150) r.push('valuation far above liquidity');
  return r;
}
// hist: [{t,b,s,n}] earlier wallet snapshots of one pool. Compares now with the oldest snapshot that is 45 minutes to 8 hours old (a trend that is known BEFORE entry).
export function walletTrend(hist, w, nowIso) {
  if (!w || !Array.isArray(hist)) return null; const now = Date.parse(nowIso), ratio = (b, s) => b / Math.max(1, s);
  const old = hist.filter((h) => h && isFinite(Date.parse(h.t)) && now - Date.parse(h.t) >= 45 * 60e3 && now - Date.parse(h.t) <= 8 * 3600e3).sort((a, b) => Date.parse(a.t) - Date.parse(b.t))[0]; if (!old) return null;
  const d = ratio(w.buyers, w.sellers) - ratio(old.b, old.s); return { delta: +d.toFixed(2), hours: +((now - Date.parse(old.t)) / 3600e3).toFixed(1), label: d > 0.3 ? 'buying picking up' : d < -0.3 ? 'selling picking up' : 'steady' };
}
// A random sample of coins that meet the same size floors but are NOT on the runners list: the yardstick for "is the list better than picking blindly?"
export function controlSample(rows, excludePools = new Set(), n = 8, seed = 1, cfg = RUNNER) {
  const pool = (rows || []).filter((p) => p && num(p.price) > 0 && p.rug !== 'danger' && (num(p.liq) ?? 0) >= cfg.minLiq && (num(p.v24) ?? 0) >= cfg.minV24 && !excludePools.has(p.pool));
  let x = seed | 0; const rnd = () => { x = (x + 0x6D2B79F5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n).map((p) => ({ p }));
}
export function buildRunners(cands, wallets = new Map(), paperIds = new Set(), trends = new Map()) {
  return cands.map(({ p }) => { const w = wallets.get(p.pool) || null, r = runnerScore(p, w), checks = runnerChecks(p, w), passed = checks.filter((c) => c.ok === true).length, veto = runnerVeto(p, w), id = String(p.chain).slice(0, 3).toUpperCase() + ':' + p.sym;
    return { id, coin: p.sym, chain: { solana: 'Solana', eth: 'Ethereum', robinhood: 'Robinhood' }[p.chain] || p.chain, pool: p.pool, net: p.net, price: r4(p.price), score: r.score, parts: r.parts, flags: r.flags, checks, passed, vetoed: veto, tier: veto.length ? 'Dropped' : passed >= 4 ? 'Strong' : passed >= 3 ? 'Runner' : 'Watch', regime: p.regime || null,
      m: { ch24: num(p.ch24), surge: r4(Math.max(num(p.vacc) ?? 0, p.tf && p.tf['4h'] ? num(p.tf['4h'].rvol) ?? 0 : 0)), bs1: num(p.bs1), exitPct: num(p.liq) > 0 ? +(RUNNER.exitUsd / num(p.liq) * 100).toFixed(1) : null, liq: Math.round(num(p.liq) ?? 0), v24: Math.round(num(p.v24) ?? 0), ageD: num(p.ageD), fdv: num(p.fdv), soc: p.soc && num(p.soc.n) != null ? p.soc.n : null },
      hs: p.hs ? { holders: p.hs.holders ?? null, top10: p.hs.top10 ?? null, growPct: p.hs.growPct ?? null } : null, wallet: w, walletVerdict: walletVerdict(w), trend: trends.get(p.pool) || null, paper: paperIds.has(id) };
  }).sort((a, b) => (a.vetoed.length ? 1 : 0) - (b.vetoed.length ? 1 : 0) || b.passed - a.passed || b.score - a.score);
}
// One logged paper trade per coin per UTC day for every runner shown OR dropped, with the numbers that were true at that moment. The learning step later works out which numbers mattered.
export function runnerSignal(r, at, cfg = DEGEN, opts = {}) {
  const F = +r.price * (1 + cfg.slipPct / 100), w = r.wallet, m = r.m || {}, hs = r.hs || {};
  return { signalId: r.id + '@' + at.slice(0, 10) + (opts.control ? '|c' : ''), control: !!opts.control, liq: m.liq ?? null, id: r.id, coin: r.coin, chain: r.chain, pool: r.pool, net: r.net, setup: 'Runner', desk: 'runnerlog', signalAt: at, entryLow: r4(F), entryHigh: r4(F), entryMid: r4(F), stop: r4(F * (1 - cfg.stopPct)), tp1: r4(F * cfg.tpMult), status: 'waiting for entry', tpHit: 0, resultR: null, openR: null, closedAt: null, checkedAt: at,
    listed: !opts.control && !r.vetoed.length, vetoed: opts.control ? [] : r.vetoed, passed: r.passed,
    f: { surge: m.surge ?? null, ch24: m.ch24 ?? null, bs1: m.bs1 ?? null, liq: m.liq ?? null, ageD: m.ageD ?? null, fdvLiq: m.fdv && m.liq ? +(m.fdv / m.liq).toFixed(1) : null, soc: m.soc ?? null, holdG: hs.growPct ?? null, top10: hs.top10 ?? null, wB: w ? w.buyers : null, wS: w ? w.sellers : null, wNet: w ? w.netUsd : null, top3: w ? w.top3Share : null, smart: w ? (w.smartIn || []).length : null, wTrend: r.trend ? r.trend.delta : null, regime: r.regime, hour: +at.slice(11, 13), score: r.score } };
}
// Same trade replayed under other exit rules, so the report can say which exit works best on these coins. Returns { name: returnPct }.
export const EXIT_VARIANTS = { 'stop 15%': { stopPct: 0.15 }, 'stop 25%': { stopPct: 0.25 }, 'trail 20%': { trailPct: 0.2 }, 'trail 40%': { trailPct: 0.4 }, 'sell half at 3x': { tpMult: 3 }, 'sell half at 1.5x': { tpMult: 1.5 } };
export function exitVariants(s, bars, at) { const out = {}; for (const [k, o] of Object.entries(EXIT_VARIANTS)) { const r = evaluateDegen({ ...s, status: 'waiting for entry' }, bars, at, { ...DEGEN, ...o }); if (r.retPct != null) out[k] = r.retPct; } return out; }
