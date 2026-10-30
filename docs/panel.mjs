// RynoScan "three-voice panel": a bull, a bear and a neutral judge argue each setup from the same data the scanner already holds.
// It is rule-based on purpose: it costs nothing, runs on GitHub with no AI service, gives the same answer every time, and its verdicts can be
// logged and later scored against what actually happened (src/learn.mjs does that). The neutral voice is an evidence judge with veto power,
// not a mediator: a mediator with no data just splits the difference, while a judge that checks the track record and the hard safety rules
// stops two persuasive speakers from talking each other into a bad trade.
import { matchFilters, familyOf } from './features.mjs?v=207bcdf506';
const num = (v, d = 1) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(d));
const has = (v) => v != null && isFinite(Number(v));

// the plan a row is actually offering (pattern-led rows carry their plan in the pat* fields)
export function planView(r) {
  if (r && r.lead === 'pattern' && r.patName && r.patEntryLow != null)
    return { ...r, setupType: r.patName, entryLow: r.patEntryLow, entryHigh: r.patEntryHigh, stop: r.patStop, tp1: r.patTp1, tp2: r.patTp2, tp3: r.patTp3, rr1: r.patRr1, rr2: r.patRr2, rr3: r.patRr3, riskPct: r.patRisk, upsidePct: r.patUp, gatesPassed: r.patPassed, _pat: true, _ready: !!r.patReady };
  return { ...r, _ready: !!r.bidReady };
}

const BULL_REPLY = {
  stop: 'The stop sits below the structure: if it breaks, the idea is wrong. Size to the stop so a loss is a fixed, known amount.',
  slip: 'Rest a limit order at the top of the zone. Slippage mostly hurts market orders.',
  regime: 'Fair worry. Coins can decouple from SOL/ETH, but the rules do fail more in a falling market, so the bull concedes this one.',
  track: 'No track record is not a bad record. It means small size while the log builds, not a veto.',
  liquidity: 'Cap the position at about 1% of pool liquidity so exiting is not a problem.',
  safety: 'Flags are not honeypot-level danger; size down and read the contract.',
  chase: 'A resting limit order at the zone avoids chasing. If it never fills, nothing is lost.',
  sellers: 'Net selling can be the shakeout that precedes a reversal. Watch what the next 4h candle closes at.',
  knife: 'Valid for a falling coin; the daily RSI turning is the only thing separating this from a knife.',
  young: 'New coins have thin history, so the chart is shorter and the pattern less reliable: keep it small.',
  forming: 'A forming pattern is early by design; the entry only counts after the close above the trigger.',
};
const BEAR_REPLY = {
  gates: 'The gates are rules the scanner wrote. There is no evidence yet that passing them predicts profit.',
  vol: 'On meme coins a volume spike also marks blow-off tops and wash trading.',
  rr: 'Targets are projected, not promised. Thin meme markets gap past them or never reach them.',
  track: 'Small samples flatter everything. A hot streak at this size is noise.',
  buyers: '24h flow includes the move already made; the last hour matters more than the day.',
  pattern: 'Pattern quality is a geometry score, not a win rate.',
  zone: 'Being in the zone is a price fact, not a reason. Only the stop protects you.',
  conf: 'Both feeds read the same chain. Agreement is not independent proof.',
  div: 'Divergences are common in downtrends and often fail until price actually turns.',
  market: 'A good market lifts weak setups too; it says nothing about this one.',
  safety: 'A clean token check only rules out the obvious scams.',
  upside: 'Big projected upside on a micro-cap usually means a big stop distance or a fantasy target.',
};

export function debate(r0, ctx = {}) {
  const r = r0 && r0._ready !== undefined ? r0 : planView(r0 || {});
  if (!has(r.entryLow) || !has(r.stop)) return null;
  const L = ctx.learned, w = ctx.watch, volRatio = ctx.volRatio, btAvg = ctx.btAvg;
  const slipPct = ctx.slipPct ?? 1.5, setup = r.setupType || r.patName || 'Bottom reversal';
  const t = L && Array.isArray(L.setups) ? L.setups.find((x) => x.setup === setup) : null;
  const bull = [], bear = [], add = (a, id, wt, text) => a.push({ id, w: wt, text });
  const rp = has(r.riskPct) ? Number(r.riskPct) : null;
  // ----- bull: the strongest honest case for entering -----
  if (r.gatesPassed >= 7) add(bull, 'gates', 3, 'All 7 gates pass.'); else if (r.gatesPassed >= 6) add(bull, 'gates', 2, `${r.gatesPassed} of 7 gates pass.`);
  if (r.rvol4h >= 1.5) add(bull, 'vol', 2, `4h volume is ${num(r.rvol4h)}x its norm.`);
  if (r.buySell24h >= 1.2) add(bull, 'buyers', 1, `Buyers lead the last 24h (${num(r.buySell24h, 2)}).`);
  if (w && has(w.h1b) && has(w.h1s) && w.h1b > w.h1s * 1.2) add(bull, 'buyers', 1, `Buyers lead the last hour (${w.h1b} buys vs ${w.h1s} sells).`);
  if (r.rr2 >= 3) add(bull, 'rr', 2, `TP2 pays ${num(r.rr2)}R for 1R of risk.`); else if (r.rr2 >= 2) add(bull, 'rr', 1, `TP2 pays ${num(r.rr2)}R for 1R of risk.`);
  if (r.upsidePct >= 60) add(bull, 'upside', 1, `${num(r.upsidePct, 0)}% upside to TP3.`);
  if (r.conf >= 5) add(bull, 'conf', 1, `The second data feed agrees (${r.conf}/6 checks).`);
  if (r._pat && r.patQ >= 70) add(bull, 'pattern', 2, `Clean ${r.patName} (quality ${r.patQ}/100).`);
  if (r.gDivergence || r.div4h) add(bull, 'div', 1, 'Bullish RSI divergence on the chart.');
  if (t && t.verdict === 'proven') add(bull, 'track', 3, `${setup} has a proven record: ${num(t.avgR, 2)}R average over ${t.n} closed trades.`);
  else if (t && t.verdict === 'promising' && t.n >= 8) add(bull, 'track', 1, `${setup} is positive so far (${num(t.avgR, 2)}R over ${t.n} trades), not yet proven.`);
  if (w && w.state === 'in-zone') add(bull, 'zone', 2, 'Price is inside the buy zone right now.');
  if (has(volRatio) && volRatio >= 1.15) add(bull, 'market', 1, 'On-chain volume is strong today.');
  if (r.regime === 'Risk-on') add(bull, 'market', 1, 'The market backdrop for this chain is risk-on.');
  if (r.rug === 'ok') add(bull, 'safety', 1, 'Token safety checks are clean.');
  // ----- bear: the strongest honest case against -----
  if (rp != null && rp >= 15) add(bear, 'stop', 3, `The stop is ${num(rp)}% away: one loss is expensive.`); else if (rp != null && rp >= 8) add(bear, 'stop', 2, `The stop is ${num(rp)}% away.`);
  if (rp != null && rp > 0 && slipPct / rp >= 0.3) add(bear, 'slip', 2, `With about ${slipPct}% slippage and fees, costs eat ${num(slipPct / rp, 2)}R before the trade starts (stop only ${num(rp)}% away).`);
  if (r.regime === 'Risk-off') add(bear, 'regime', 2, 'The market is risk-off for this chain; reversals fail more often.');
  if (r.rug === 'warn') add(bear, 'safety', 2, 'Token flags: ' + (r.rugFlags || 'see contract') + '.'); else if (r.rug === 'unchecked') add(bear, 'safety', 1, 'The token was not checked by the safety feed.');
  if (has(r.liquidity) && r.liquidity < 120000) add(bear, 'liquidity', 2, `Liquidity is only $${Math.round(r.liquidity / 1000)}k: getting out is hard.`); else if (has(r.liquidity) && r.liquidity < 250000) add(bear, 'liquidity', 1, `Liquidity is modest ($${Math.round(r.liquidity / 1000)}k).`);
  if (has(r.chg7d) && r.chg7d < -25) add(bear, 'knife', 2, `Down ${num(Math.abs(r.chg7d), 0)}% in 7 days: still a falling knife.`);
  if (r.buySell24h != null && r.buySell24h < 0.9) add(bear, 'sellers', 2, `Sellers lead the last 24h (${num(r.buySell24h, 2)}).`);
  if (w && has(w.h1b) && has(w.h1s) && w.h1s > w.h1b * 1.5) add(bear, 'sellers', 1, `Sellers dominate the last hour (${w.h1s} sells vs ${w.h1b} buys).`);
  if (has(r.ageDays) && r.ageDays < 7) add(bear, 'young', 1, `Only ${num(r.ageDays, 0)} days old.`);
  // rules the learning loop found and validated on past trades (skip filters only; they can only make a verdict more cautious)
  { let hits = []; try { hits = matchFilters(r, L && L.filters); } catch { hits = []; } if (hits.length) add(bear, 'learned', 3, `Learned rule: ${hits[0].label.replace(/^Skip /, 'coins like this lose money: ')} (${hits[0].trades} past trades averaged ${num(hits[0].avgR, 2)}R).`); }
  if (!t) add(bear, 'track', 2, `No closed trades yet for ${setup}: it is unproven.`);
  else if (t.verdict === 'failing') add(bear, 'track', 3, `${setup} keeps losing: ${num(t.avgR, 2)}R average over ${t.n} closed trades.`);
  else if (t.verdict === 'weak') add(bear, 'track', 2, `${setup} is negative so far (${num(t.avgR, 2)}R over ${t.n} trades).`);
  else if (t.verdict === 'unproven') add(bear, 'track', 2, `Only ${t.n} closed trades for ${setup}: too few to call it an edge.`);
  if (has(btAvg) && btAvg < 0) add(bear, 'track', 1, `The latest backtest averages ${num(btAvg, 2)}R per trade.`);
  const dz = w && has(w.distPct) ? w.distPct : has(r.price) && has(r.entryHigh) ? (r.price / r.entryHigh - 1) * 100 : 0;
  if (dz > 3) add(bear, 'chase', 2, `Price is ${num(dz)}% above the zone: buying here is chasing.`);
  if (/boost/i.test(r.caution || '')) add(bear, 'safety', 1, 'A paid DexScreener boost is active: that is promotion, not organic demand.');
  if (r._pat && r.patStatus === 'forming') add(bear, 'forming', 1, 'The pattern has not broken out yet.');
  if (has(volRatio) && volRatio < 0.85) add(bear, 'market', 1, 'On-chain volume is below normal today.');
  const byW = (a, b) => b.w - a.w;
  bull.sort(byW); bear.sort(byW);
  const bw = bull.reduce((a, x) => a + x.w, 0), ew = bear.reduce((a, x) => a + x.w, 0), net = bw - ew;
  // ----- neutral: evidence judge with veto -----
  const evidence = !t ? 'none' : t.verdict;
  const veto = r.rug === 'danger' ? 'the token safety check found a serious problem' : w && w.state === 'invalid' ? 'price has already traded through the stop' : w && w.state === 'ran' ? 'price ran past TP1 without a fill' : w && has(w.liqChgPct) && w.liqChgPct <= -40 ? `liquidity is down ${Math.abs(w.liqChgPct)}% since the scan (possible rug)` : null;
  let verdict, tone, why;
  if (veto) { verdict = 'PASS'; tone = 'pass'; why = `Veto: ${veto}.`; }
  else if (evidence === 'failing') { verdict = 'PASS'; tone = 'pass'; why = `The data says ${setup} loses money, which outweighs this chart.`; }
  else if (!r._ready) { verdict = 'WAIT'; tone = 'wait'; why = 'Not bid-ready yet: the rules want every gate and a 4h close before an entry.' + (familyOf(setup) === 'Breakout / continuation' ? ' This is a breakout-type setup, where the breakout itself is the confirmation: a resting limit order near the breakout level or its retest is usually a better entry than waiting for another close.' : ''); }
  else if (dz > 3 || (w && w.state === 'far')) { verdict = 'WAIT'; tone = 'wait'; why = `Price is above the zone. Place a limit order at ${r.entryHigh} and let it come to you.`; }
  else if (net <= -2) { verdict = 'PASS'; tone = 'pass'; why = `The bear's case (${ew}) beats the bull's (${bw}).`; }
  else if (net >= 4 && evidence === 'proven') { verdict = 'ENTER'; tone = 'go'; why = `The bull's case (${bw}) clearly beats the bear's (${ew}) and ${setup} has a proven record.`; }
  else if (net >= 2) { verdict = 'SMALL'; tone = 'small'; why = evidence === 'proven' ? `The bull's case (${bw}) beats the bear's (${ew}). Standard small size.` : `The bull's case (${bw}) beats the bear's (${ew}), but ${setup} is unproven, so only a starter position.`; }
  else { verdict = 'WAIT'; tone = 'wait'; why = `Close call (bull ${bw}, bear ${ew}). Not enough edge to risk money.`; }
  const flip = [];
  if (verdict === 'WAIT' || verdict === 'SMALL') { if (!r._ready) flip.push('every gate passing after the next 4h close'); if (evidence === 'none' || evidence === 'unproven') flip.push(`${setup} building a record of 12+ closed trades`); if (r.regime === 'Risk-off') flip.push('the market turning risk-on'); if (dz > 3) flip.push('price pulling back into the zone'); }
  if (verdict === 'ENTER' || verdict === 'SMALL') flip.push(`a close below ${r.stop} or a liquidity drop would cancel it`);
  const rebut = [];
  if (bear[0] && BULL_REPLY[bear[0].id]) rebut.push({ by: 'Bull', to: 'Bear', text: BULL_REPLY[bear[0].id] });
  if (bull[0] && BEAR_REPLY[bull[0].id]) rebut.push({ by: 'Bear', to: 'Bull', text: BEAR_REPLY[bull[0].id] });
  return { verdict, tone, net, bullScore: bw, bearScore: ew, evidence, why, flip, bull: bull.slice(0, 4), bear: bear.slice(0, 4), rebut };
}
