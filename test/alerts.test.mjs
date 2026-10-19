// Position and bid-ready alerts (volume dying, sellers, stop, TP1), regime sizing, buyer spikes, shadow score and score calibration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPair, volRatio, loadPositions, positionScan } from '../src/positions.mjs';
import { botBook, regimeOf, REGIME_SIZE } from '../docs/botsim.mjs';
import { buyerSpike, spikeSetup, BOOKS } from '../docs/strategies.mjs';
import { scoreV2, FEATS } from '../docs/features.mjs';
import { spearman } from '../docs/evidence.mjs';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const NOW = Date.parse('2026-10-20T06:00:00Z'), old = NOW - 5 * 864e5;
const pair = (o = {}) => ({ pairAddress: 'P1', priceUsd: String(o.px ?? 1), url: 'https://dexscreener.com/solana/p1', pairCreatedAt: o.created ?? old, volume: { h6: o.h6 ?? 30000, h24: o.h24 ?? 100000 }, txns: { h1: { buys: o.b1 ?? 50, sells: o.s1 ?? 40 }, m5: { buys: o.b5 ?? 5, sells: o.s5 ?? 4 } }, liquidity: { usd: 200000 } });
const pos = { coin: 'AAA', chain: 'solana', pool: 'P1', entry: 1, stop: 0.8, tp1: 1.5 };

// volume dying
ok(Math.abs(volRatio(pair()) - 1.2) < 1e-9 && volRatio({ volume: {} }) === null, 'volume ratio: 6h volume against the 24h pace (24h / 4)');
{ const a = checkPair(pos, pair({ h6: 4000 }), 'pos', NOW); ok(a.length === 1 && a[0].key === 'V|P1|died' && a[0].p === 'high' && /consider closing/.test(a[0].t) && /16% of the 24-hour pace/.test(a[0].b), 'your position: volume under 20% of pace -> close alert'); }
{ const a = checkPair(pos, pair({ h6: 8000 }), 'pos', NOW); ok(a.length === 1 && a[0].key === 'V|P1|fading', 'your position: under 35% -> fading warning'); }
ok(checkPair({ ...pos, kind: 'bid' }, pair({ h6: 8000 }), 'bid', NOW).length === 0 && /cancelling the order/.test(checkPair(pos, pair({ h6: 4000 }), 'bid', NOW)[0].b), 'bid-ready setup: only the died alert, with "cancel the order"');
ok(checkPair(pos, pair({ h6: 4000, created: NOW - 10 * 3600e3 }), 'pos', NOW).length === 0, 'a pair younger than a day has no 24h pace yet: no volume alert');
ok(checkPair(pos, pair({ h6: 4000 }), 'pos', NOW, { 'V|P1|died': new Date(NOW - 3600e3).toISOString() }).length === 0, 'cool-down: the same alert is not repeated within 12 hours');
// sellers, stop, TP1
{ const a = checkPair(pos, pair({ px: 0.9, b1: 20, s1: 40, b5: 1, s5: 6 }), 'pos', NOW); ok(a.some((x) => x.key === 'S|P1' && /40 sells vs 20 buys/.test(x.b) && /10.0% under your entry/.test(x.b)), 'sellers took over while 8%+ under entry'); }
ok(!checkPair(pos, pair({ px: 1.05, b1: 20, s1: 40, b5: 1, s5: 6 }), 'pos', NOW).some((x) => x.key === 'S|P1'), 'sellers leading while in profit: no seller alert');
ok(checkPair(pos, pair({ px: 0.79 }), 'pos', NOW).some((x) => x.key === 'X|P1' && x.p === 'high') && checkPair(pos, pair({ px: 1.6 }), 'pos', NOW).some((x) => x.key === 'T|P1'), 'stop hit and TP1 reached alerts');
// position files and the scan
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-')); fs.writeFileSync(path.join(dir, 'solana-aaa.json'), JSON.stringify(pos)); fs.writeFileSync(path.join(dir, 'bad.json'), '{oops'); fs.writeFileSync(path.join(dir, 'tok.json'), JSON.stringify({ coin: 'BBB', chain: 'solana', token: 'T2', entry: 2 }));
  const P = loadPositions(dir); ok(P.length === 2 && P.find((x) => x.coin === 'AAA').file === 'solana-aaa.json', 'position files load; a broken file is skipped');
  const calls = []; const r = await positionScan(P, [{ coin: 'CCC', chain: 'Solana', pool: 'P3', kind: 'bid' }], async (u) => { calls.push(u); return u.includes('/tokens/') ? { pairs: [{ ...pair({ h6: 1000 }), pairAddress: 'X', baseToken: { address: 'T2' }, liquidity: { usd: 5000 } }, { ...pair(), pairAddress: 'Y', baseToken: { address: 'T2' }, liquidity: { usd: 90000 } }] } : { pairs: [pair({ h6: 4000 }), { ...pair({ h6: 1000 }), pairAddress: 'P3' }] }; }, NOW, {}, async () => {});
  ok(calls.length === 2 && r.rows.length === 2 && r.alerts.some((a) => a.key === 'V|P1|died') && r.alerts.some((a) => a.key === 'V|P3|died' && /bid-ready/.test(a.t)) && !r.alerts.some((a) => /BBB/.test(a.t)), 'one call per chain for pools, one for tokens; a token uses its most liquid pair'); }

// regime sizing
ok(regimeOf({ sol: 'Risk-off', vol: 'Strong' }) === 'bear' && regimeOf({ sol: 'Risk-on', vol: 'Strong' }) === 'mania' && regimeOf({ sol: 'Risk-on', vol: 'Normal' }) === 'bull' && regimeOf({ sol: 'Neutral', vol: 'Weak' }) === 'bear' && regimeOf({ sol: 'Neutral', vol: 'Normal' }) === 'neutral' && regimeOf(null) === null, 'market regime: bear, neutral, bull, mania');
{ const mk = (i, mkt) => ({ key: 'k' + i, src: 'risky', coin: 'C' + i, pool: 'p' + i, at: new Date(NOW + i * 36e5).toISOString(), entryAt: new Date(NOW + i * 36e5).toISOString(), entryPx: 1, stop0: 0.8, fills: [{ t: new Date(NOW + i * 36e5 + 6e5).toISOString(), px: 1.1, frac: 1 }], rem: 0, open: false, closedAt: new Date(NOW + i * 36e5 + 6e5).toISOString(), liq: 1e7, mkt });
  const P = [mk(0, { sol: 'Risk-off', vol: 'Normal' }), mk(1, { sol: 'Risk-on', vol: 'Strong' })], a = botBook(P, { now: NOW + 1e8 }), b = botBook(P, { regime: true, now: NOW + 1e8 });
  const sz = (bb, k) => bb.trades.find((t) => t.key === k).size; ok(Math.abs(sz(b, 'k0') / sz(a, 'k0') - REGIME_SIZE.bear) < 0.02 && Math.abs(sz(b, 'k1') / sz(a, 'k1') - REGIME_SIZE.mania) < 0.05 && b.byRegime.bear.n === 1, 'regime bot: half size in a bear, 1.5x in a mania, same trades'); }

// buyer spikes (unique wallets, GeckoTerminal)
{ const p = { buyers1: 60, buyers24: 240, sellers1: 30, vacc: 3, ch1: 8, ch24: 40, liq: 120000, v24: 400000, price: 1 };
  ok(buyerSpike(p) === 6 && buyerSpike({ buyers1: 5 }) === null, 'spike = last-hour unique buyers against the 24h hourly average');
  const s = spikeSetup(p); ok(s && s.spike === 6 && /60 wallets bought in the last hour, 6x/.test(s.why[0]), 'spike entry: new wallets arriving, buyers lead, price not run yet');
  ok(spikeSetup({ ...p, ch1: 45 }) === null && spikeSetup({ ...p, ch24: 220 }) === null, 'already priced (up 45% in the hour or 220% in a day): no entry');
  ok(spikeSetup({ ...p, sellers1: 55 }) === null && spikeSetup({ ...p, buyers1: 20, buyers24: 100 }) === null, 'sellers keeping up, or too few wallets: no entry');
  ok(BOOKS.spike && BOOKS.spike.group === 'scalp', 'buyer spike book registered');
  ok(FEATS.find((x) => x[0] === 'New-wallet spike (last hour)')[1]({ bspk: 5 }) === 'spiking (4x+)', 'learning loop slices signals by new-wallet spike'); }

// shadow score and score calibration
ok(scoreV2({ pq: 90, gp: 7, rvol: 2.5, rr2: 2 }) === 97 && scoreV2({ pq: 90, gp: 7, rvol: 2.5, rr2: 4 }) === 87 && scoreV2({ pq: 50 }) === null, 'shadow score v2: quality, gates and volume; stretched reward-to-risk costs 10');
ok(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) === 1 && spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) === -1 && spearman([1, 2], [1, 2]) === null, 'rank correlation');
{ const { learn } = await import('../src/learn.mjs'); const sigs = Array.from({ length: 40 }, (_, i) => ({ setup: 'Bottom reversal', chain: 'Solana', signalAt: '2026-10-21T00:00:00Z', status: i % 2 ? 'all targets hit' : 'stopped out', resultR: (i % 10) / 5 - 0.9, opp: 50 + i, pq: 50 + (i % 10) * 5, gp: 7, rvol: 1.5, opp2: (i % 10) * 10 }));
  const L = learn(sigs); ok(L.calibration.v2New.n === 40 && L.calibration.v2New.rho === 1 && /Score check/.test(L.insights[0]), 'learning loop checks whether the score ranks results, and judges v2 only on new trades'); }
process.exit(f);
