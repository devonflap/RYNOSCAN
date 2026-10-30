// Strategy lab: every paper approach in one place (which coins it buys, how it sizes, how it exits).
// This registry is also the blueprint for a future trading bot: a bot would read the same entry rule and exit profile and place real orders.
// Today everything here is paper money only.
import { PROFILES } from './exits.mjs?v=46588e22b3';
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
const r6 = (x) => (x == null || !isFinite(x) ? null : +(+x).toPrecision(6));

// group: which tab shows the book. same: books that share their entries (so only the exits differ and they compare directly).
export const BOOKS = {
  bid: { group: 'cons', label: 'Bid-ready setups', short: 'Bid-ready', entry: 'Every bid-ready call from the main rules (all 7 gates pass), limit order in the entry zone, 48 hours to fill.', exits: 'Thirds sold at TP1, TP2 and TP3, stop to break-even after TP1, 7-day time limit.', pct: 5, slots: 10 },
  risky: { group: 'cons', label: 'Risky coins, careful rules', short: 'Risky coins', profile: 'consRisky', entry: 'High-risk runners that pass at least 3 of the 4 checks and no risk rule, at most 2 new per scan.', pct: 4, slots: 6, maxNew: 2 },
  riskyRyan: { group: 'cons', same: 'risky', label: "Risky coins, Ryan's setup", short: 'Risky · Ryan', profile: 'riskyRyan', entry: 'Same coins and times as the Risky coins book.', pct: 4, slots: 6 },
  riskyPick: { group: 'cons', same: 'risky', label: "Risky coins, Claude's setup", short: 'Risky · Claude', profile: 'riskyPick', entry: 'Same coins and times as the Risky coins book.', pct: 4, slots: 6 },
  riskyClip: { group: 'cons', same: 'risky', label: "Risky coins, Ryan's clips (the runner bot's exits)", short: 'Risky · clips', profile: 'riskyClip', entry: 'Same coins and times as the Risky coins book. Started 22 Oct: the runner bot\'s exact exits, its paper twin.', pct: 4, slots: 6 },
  riskyFront: { group: 'cons', same: 'risky', label: 'Risky coins, front-loaded clips (edge report)', short: 'Risky · front', profile: 'riskyFront', entry: 'Same coins and times as the Risky coins book. Started 22 Oct: the challenger to Ryan\'s clips, most of the position off in the first leg, because 80% of promoted coins give back 70% within a week.', pct: 4, slots: 6 },
  randomCtl: { group: 'control', label: 'Random entries (baseline to beat)', short: 'Random baseline', profile: 'consRisky', entry: 'Two random liquid coins per full scan ($50k+ liquidity, $250k+ daily volume, safety check not failed), no signal at all. Same exits as the Risky coins book. Any book whose entries matter must beat this.', pct: 4, slots: 6, maxNew: 2, noBot: true },
  degen: { group: 'degen', same: 'degen', label: 'Degen desk (current exits)', short: 'Degen current', profile: 'degen', entry: 'Volume surge of 2.5x or more, up 10% to 400% in 24 hours, buyers leading, $50k+ liquidity, wallets not leaning out.', pct: 10, slots: 8 },
  degenLadder: { group: 'degen', same: 'degen', label: 'Degen · ladder (bank on the way up)', short: 'Degen ladder', profile: 'ladder', entry: 'Same coins and times as the degen desk.', pct: 10, slots: 8 },
  degenMoon: { group: 'degen', same: 'degen', label: 'Degen · moonbag', short: 'Degen moonbag', profile: 'moon', entry: 'Same coins and times as the degen desk.', pct: 10, slots: 8 },
  degenStudy: { group: 'degen', same: 'degen', label: 'Degen · study exits', short: 'Degen study', profile: 'study', entry: 'Same coins and times as the degen desk, run with the study exits (40% floor, ride free at 2x, 50% giveback on 15-minute closes). Started 20 Oct.', pct: 10, slots: 8 },
  degenStudyTrail: { group: 'degen', same: 'degen', label: 'Degen · study exits, 35% giveback', short: 'Degen study 35%', profile: 'studyTrail', entry: 'Same coins and times as the degen desk. Started 22 Oct: the study exits with the giveback tightened from 50% to 35%, after the first four runners all gave back 45-55% of their peak before the 50% line.', pct: 10, slots: 8 },
  degenStudyBE: { group: 'degen', same: 'degen', label: 'Degen · study exits, protected', short: 'Degen study BE', profile: 'studyBE', entry: 'Same coins and times as the degen desk. Started 22 Oct: the study exits plus a stop to break-even once the trade has shown +30% and the seller cut, after three study losers peaked +25% to +45% before stopping out at -40%.', pct: 10, slots: 8 },
  degenFlow: { group: 'degen', same: 'degen', label: 'Degen · cut on sellers', short: 'Degen cut-on-sellers', profile: 'degenFlow', entry: 'Same coins and times as the degen desk. Started 19 Oct: tests whether getting out early when sellers take over cuts losses without cutting the runners.', pct: 10, slots: 8 },
  fibPull: { group: 'play', label: 'First Fib pullback (playbook)', short: 'Fib pullback', profile: 'fibPull', entry: 'A coin that ran 50% or more to a new high in the last 2 days (1-hour candles, wick to wick). Limit buy at the 0.5 retracement of that run, or 0.618 if price is already below 0.5; cancelled if it makes a new high first or after 48 hours.', pct: 6, slots: 6, maxNew: 3 },
  patInside: { group: 'play', label: 'Inside the pattern (playbook)', short: 'Inside pattern', profile: 'patInside', entry: 'A forming falling wedge, bull flag, double bottom, inverse H&S or cup & handle on the 4h chart. Limit buy in the lower third of the pattern (third touch, right shoulder, handle, second bottom); cancelled if it breaks out first or after 72 hours.', pct: 5, slots: 6, maxNew: 3 },
  proven: { group: 'play', label: 'Follow proven wallets', short: 'Proven wallets', profile: 'proven', entry: 'Two or more wallets from the wallet scorecard are net buyers in the last 24 hours and no risk rule fires. Buys the next hourly open.', pct: 5, slots: 6, maxNew: 3 },
  pulse: { group: 'scalp', label: 'Early pulse (15-minute checker)', short: 'Early pulse', profile: 'pulse', entry: 'Checked every ~15 minutes on DexScreener: 5-minute volume at least 2.5x the last hour pace, the last hour 1.5x the 6-hour pace, price up 1.5%+ in 5 minutes and 3% to 60% in the hour (not vertical), buyers at least 1.3x sellers, no paid boost, $50k+ liquidity. Buys the next 5-minute open after the check.', pct: 5, slots: 6 },
  pulseFlush: { group: 'scalp', same: 'pulse', entryVariant: true, label: 'Early pulse · buy the flush', short: 'Pulse flush', profile: 'pulseFlush', entry: 'Same early-move alerts as Early pulse, but instead of buying straight away it bids 6% lower and waits up to 3 hours for a dip ("buy the flush, not the candle"). Cancelled if price runs 25% without dipping. Compared signal by signal with Early pulse, counting a missed fill as 0%.', pct: 5, slots: 6 },
  spike: { group: 'scalp', label: 'Buyer spike (early, hourly)', short: 'Buyer spike', profile: 'spike', entry: 'New wallets arriving before the price has run: unique buyers in the last hour at least 3x the 24-hour hourly average (GeckoTerminal), at least 25 of them and 1.3x more buyers than sellers, last-hour volume 2x its pace, price up 0% to 30% in the hour and under 150% in 24 hours (not already priced), $50k+ liquidity, no risk rule. Checked on full scans; buys the next hourly open.', pct: 5, slots: 6, maxNew: 3 },
  // execution test (20 Oct): the scanner's setups (bid-ready and worth-watching, with a zone and an invalidation) traded three ways
  execZone: { group: 'exec', label: 'Zone limit (baseline for the bot rules)', short: 'Zone limit', profile: 'exec', entry: 'Every bid-ready or worth-watching setup: a limit order at the top of the entry zone as soon as it is called (how the bid-ready list works today), 24 hours to fill. Same exit stack as the trigger book, so the two compare entries only.', pct: 5, slots: 10, maxNew: 6 },
  exec: { group: 'exec', same: 'execZone', entryVariant: true, trigger: true, maxWatch: 20, label: 'Bot rules · 5-minute trigger', short: 'Bot rules', profile: 'exec', entry: 'Same setups, but no buy until a 5-minute candle confirms inside the zone: a flush below the zone that closes back above it, or a bounce in the zone, on at least 1.5x (flush) or 2x (bounce) normal volume, closing in the upper half of its range and no more than 3% above the zone (no chasing). Buys the next 5-minute open. Stop under the flush low, at least 5% and at most 20% away. Setup dropped if a candle closes under its invalidation or after 24 hours without a trigger.', pct: 5, slots: 10 },
  execStudy: { group: 'exec', same: 'exec', trigger: true, label: 'Bot rules · 5-minute trigger, study exits', short: 'Trigger + study exits', profile: 'study', entry: 'Same trigger entries as the bot rules book, run with the study exits (40% floor, ride free at 2x, 50% giveback on 15-minute closes).', pct: 5, slots: 10 },
  brk: { group: 'brk', label: 'Breakout retest · as backtested', short: 'Breakout as backtested', profile: 'brk', entry: 'Every Breakout retest the scanner sees with a valid plan (score 50+, $100k+ liquidity, no rug danger), bid-ready or not, exactly as the backtest traded it: a limit order at the top of the retest zone, 48 hours to fill. One per coin per 24 hours.', pct: 5, slots: 20, maxNew: 6 },
  brkBot: { group: 'brk', label: 'Breakout retest · bot filters', short: 'Breakout bot filters', profile: 'brk', entry: 'The same setups after the Breakout bot filters (the tuner\'s active list, starting with reward to risk to TP2 of 3R or more) and stops up to 35%. This is the paper twin of the Breakout bot.', pct: 5, slots: 20 },
  brkTrig: { group: 'brk', same: 'brk', entryVariant: true, trigger: true, trigCfg: { maxStopPct: 40, expireH: 48 }, label: 'Breakout retest · 5-minute trigger', short: 'Breakout + trigger', profile: 'brk', entry: 'The same setups, but no buy until a 5-minute candle confirms the retest (a flush that closes back above the zone, or a bounce on 2x volume). Same plan stop and targets, so it tests the entry only: the pattern loses mostly on entries that never work.', pct: 5, slots: 20 },
  scalpBreak: { group: 'scalp', label: 'Scalper · breakout', short: 'Scalp breakout', profile: 'scalpBreak', entry: '5-minute candle closes above the last hour\'s high on at least 2x normal volume, near the top of its range, uptrend on the 20-candle average, not already stretched.', pct: 5, slots: 4, maxNew: 3 },
};
for (const k of Object.keys(BOOKS)) if (BOOKS[k].profile) BOOKS[k].exits = PROFILES[BOOKS[k].profile].label;
export const DEGEN_COPIES = ['degenLadder', 'degenMoon', 'degenFlow', 'degenStudy', 'degenStudyTrail', 'degenStudyBE']; // Degen tight and Scalper dip-buy removed 19 Oct (they duplicated other books)

// Exit rules compared on every logged runner (Learn tab, runner study). Same entries, only the exit differs.
const DP = PROFILES.degen;
export const EXIT_SET = {
  'stop 15%': { ...DP, stopPct: 0.15 }, 'stop 25%': { ...DP, stopPct: 0.25 }, 'trail 20%': { ...DP, trailPct: 0.2 }, 'trail 40%': { ...DP, trailPct: 0.4 },
  'sell half at 3x': { ...DP, ladder: [[3, 0.5]] }, 'sell half at 1.5x': { ...DP, ladder: [[1.5, 0.5]] },
  'ladder 1.5x/2x/3x, trail 35%': PROFILES.ladder, 'moonbag 2x/4x, trail 45%': PROFILES.moon, 'tight: 12% stop, half at 1.3x': PROFILES.tight, 'careful: 10% stop, +15%/+30%, 24h': PROFILES.consRisky, 'tiers: half at 2x, 25% at 3x, trail 35%': PROFILES.proven, "Ryan's ladder: +69% / +150% / +260%, stop 20%": PROFILES.riskyRyan, "Ryan's ladder, stop 15%": { ...PROFILES.riskyRyan, stopPct: 0.15 }, "Ryan's ladder, stop 25%": { ...PROFILES.riskyRyan, stopPct: 0.25 }, "Claude's ladder: +40% / 2x / 3x, trail 35%": PROFILES.riskyPick, "Ryan's clips: 20% at +50/+100/+150/+200%, 10% at +300%, trail 45%": PROFILES.riskyClip, 'Front-loaded clips: 40% at +50%, then 20/20/10, trail 45%': PROFILES.riskyFront,
  // loss reducers (19 Oct): get out early when the chart shows sellers in control, or when the trade never gets going
  'cut on a heavy selling candle (8%+ down)': { ...DP, sellCandle: { volX: 2, lowPct: 0.25, dropPct: 0.05, lossPct: 0.08, look: 12 } },
  'cut if no follow-through in 8 hours': { ...DP, noFollow: { h: 8, upPct: 0.10 } },
  'both cuts together': { ...DP, sellCandle: { volX: 2, lowPct: 0.25, dropPct: 0.05, lossPct: 0.08, look: 12 }, noFollow: { h: 8, upPct: 0.10 } },
  // from the "six bot desk" thread: close when volume dies (last 6 hours under 20% of the 24-hour pace)
  'out when volume dies (6h under 20% of the 24h pace)': { ...DP, volDeath: { ratio: 0.2 } },
  'study: stop 40%, ride free at 2x, 50% giveback on closes': { ...PROFILES.study, barSec: 3600 },
  'study with a 20% stop': { ...PROFILES.study, stopPct: 0.20, barSec: 3600 },
  "thread's rule: no price stop, hold until volume dies (7 days max)": { ...DP, stopPct: 0.95, ladder: [], trailPct: null, trailFrom: null, beAfterFirst: false, volDeath: { ratio: 0.2 }, maxHours: 168 },
};
export const EXIT_SET_HOURS = Math.max(...Object.values(EXIT_SET).map((p) => p.maxHours));

// A lab row: one paper trade for one book. lid is unique per book.
export function labRow(book, src, at, extra = {}) {
  const px = num(src.price ?? src.priceAtSignal ?? src.entryMid), id = src.id || (String(src.chain).slice(0, 3).toUpperCase() + ':' + (src.coin || src.sym));
  return { lid: book + '|' + (src.signalId || id + '@' + at.slice(0, 16)), book, profile: BOOKS[book].profile, id, coin: src.coin || src.sym, chain: src.chain, pool: src.pool, net: src.net, setup: BOOKS[book].short, signalAt: src.signalAt || at,
    priceAtSignal: r6(px), liq: num(src.liq ?? (src.m && src.m.liq)), status: 'waiting for entry', checkedAt: at, why: extra.why || src.why || null, from: src.signalId || null, ...extra };
}

// new-wallet spike: unique buyers in the last hour against the 24-hour hourly average (GeckoTerminal counts unique wallets, so bot spam
// of many small trades from one wallet does not inflate it the way DexScreener's transaction counts can)
export function buyerSpike(p) { const b1 = num(p && p.buyers1), b24 = num(p && p.buyers24); return b1 != null && b24 > 0 ? +(b1 / (b24 / 24)).toFixed(2) : null; }
export const SPIKE = { minSpike: 3, minBuyers: 25, buyerLead: 1.3, minVacc: 2, ch1Min: 0, ch1Max: 30, ch24Max: 150, minLiq: 50000, minV24: 100000 };
export function spikeSetup(p, cfg = SPIKE) {
  const sp = buyerSpike(p), b1 = num(p && p.buyers1) || 0, s1 = num(p && p.sellers1) || 0, ch1 = num(p && p.ch1), ch24 = num(p && p.ch24), vacc = num(p && p.vacc);
  if (sp == null || sp < cfg.minSpike || b1 < cfg.minBuyers || b1 < cfg.buyerLead * s1 || !(vacc >= cfg.minVacc) || ch1 == null || ch1 < cfg.ch1Min || ch1 > cfg.ch1Max || (ch24 != null && ch24 > cfg.ch24Max)) return null;
  if ((num(p.liq) || 0) < cfg.minLiq || (num(p.v24) || 0) < cfg.minV24 || p.rug === 'danger') return null;
  return { spike: sp, why: [`${b1} wallets bought in the last hour, ${sp}x the usual hourly number`, `${b1} buyers vs ${s1} sellers`, `volume ${vacc}x its pace`, `price ${ch1 >= 0 ? '+' : ''}${ch1}% in the hour, ${ch24 != null ? (ch24 >= 0 ? '+' : '') + ch24 + '% in 24h' : ''}`] };
}

// ---------- execution trigger on 5-minute candles ----------
// setup: { zoneLow, zoneHigh, stop (the setup's invalidation) }, from: setup time (ISO). bars: 5-minute [t,o,h,l,c,v] ascending.
// Only candles that have closed by nowSec count. Returns null (still waiting), { dead, why } (setup gone), { pending } (triggered on the
// last closed candle, the fill is the next open) or { at, px, stop, kind, why } (filled at the next 5-minute open).
// Breakout retest setup (shared by the paper books, the dashboard's breakouts.json and the Breakout bot): the pattern's own plan,
// with the fields the bot filters use (reward to risk to TP2, stop distance, chain, the market's volume day).
export const BRK = { name: 'Breakout retest', minOpp: 50, minLiq: 100000, expireH: 48 };
export function brkSetup(p, volDay = null, cfg = BRK) {
  const sp = p && p.sp; if (!p || p.setupType !== cfg.name || !sp || !sp.valid || !(sp.entryLow > 0) || !(sp.entryHigh >= sp.entryLow) || !(sp.stop > 0) || !(sp.stop < sp.entryHigh) || !(sp.tp1 > sp.entryHigh)) return null;
  if (!(p.opp >= cfg.minOpp) || (p.liq || 0) < cfg.minLiq || p.rug === 'danger' || (p.price > 0 && p.price <= sp.stop)) return null; // already through its stop: broken, not a setup
  const mid = sp.entryMid || (sp.entryLow + sp.entryHigh) / 2;
  return { zoneLow: r6(sp.entryLow), zoneHigh: r6(sp.entryHigh), stop: r6(sp.stop), tp1: r6(sp.tp1), tp2: r6(sp.tp2), tp3: r6(sp.tp3), rr2: sp.rr2 != null ? +(+sp.rr2).toFixed(2) : null, riskPct: sp.riskPct != null ? +(+sp.riskPct).toFixed(1) : +((mid - sp.stop) / mid * 100).toFixed(1), volDay: volDay || null, opp: p.opp ?? null, expireH: cfg.expireH };
}
export const TRIG = { flushLook: 6, volLook: 12, volFlush: 1.5, volBounce: 2, upper: 0.5, chasePct: 3, minStopPct: 5, maxStopPct: 20, expireH: 24 };
export function execTrigger(setup, bars, nowSec, from, cfg = TRIG) {
  const zl = num(setup && setup.zoneLow), zh = num(setup && setup.zoneHigh), inv = num(setup && setup.stop), t0 = Date.parse(from || '') / 1000;
  if (!(zl > 0) || !(zh >= zl) || !isFinite(t0)) return { dead: true, why: 'invalid setup' };
  const all = (bars || []).map((b) => b.slice(0, 6).map(Number)).filter((b) => b.every((x) => isFinite(x)) && b[0] + 300 <= nowSec);
  const start = all.findIndex((b) => b[0] >= t0); if (start < 0) return nowSec - t0 > (setup.expireH || cfg.expireH) * 3600 ? { dead: true, why: 'expired (no trigger in 24 hours)' } : null;
  for (let k = start; k < all.length; k++) {
    const [t, o, h, l, c, v] = all[k];
    if (t > t0 + (setup.expireH || cfg.expireH) * 3600) return { dead: true, why: 'expired (no trigger in 24 hours)' };
    if (inv > 0 && c < inv) return { dead: true, why: 'cancelled (setup broke before a trigger)' };
    if (k < cfg.volLook) continue;
    const prev = all.slice(k - cfg.volLook, k), avgV = prev.reduce((a, b) => a + b[5], 0) / prev.length, win = all.slice(Math.max(start, k - cfg.flushLook + 1), k + 1), flushLow = Math.min(...win.map((b) => b[3]));
    const rng = h - l, upperOk = rng > 0 && (c - l) / rng >= cfg.upper, green = c > o, noChase = c <= zh * (1 + cfg.chasePct / 100);
    let kind = null;
    if (flushLow < zl && c > zl && green && upperOk && noChase && avgV > 0 && v >= cfg.volFlush * avgV) kind = 'flush and reclaim';
    else if (Math.min(...all.slice(Math.max(start, k - 2), k + 1).map((b) => b[3])) <= zh && c >= zl && green && rng > 0 && (c - l) / rng >= 0.6 && noChase && avgV > 0 && v >= cfg.volBounce * avgV) kind = 'bounce in the zone';
    if (!kind) continue;
    if (k + 1 >= all.length) return { pending: true, kind, px: r6(c), flushLow: r6(flushLow), at: new Date((t + 300) * 1000).toISOString().slice(0, 19) + 'Z', vol: +(v / avgV).toFixed(1) };
    const px = all[k + 1][1], stop = Math.min(flushLow * 0.99, px * (1 - cfg.minStopPct / 100)), stopPct = (1 - stop / px) * 100;
    if (stopPct > cfg.maxStopPct) continue; // the flush was too deep to risk from here
    return { at: new Date((t + 300) * 1000).toISOString().slice(0, 19) + 'Z', px: r6(px), stop: r6(stop), kind, stopPct: +stopPct.toFixed(1),
      why: [`${kind} on the 5-minute chart`, `volume ${(v / avgV).toFixed(1)}x normal`, `stop ${stopPct.toFixed(1)}% under the entry`] };
  }
  return nowSec - t0 > (setup.expireH || cfg.expireH) * 3600 ? { dead: true, why: 'expired (no trigger in 24 hours)' } : null;
}

// "buy the flush, not the candle": a limit 6% under the alert price instead of buying the spike
export function flushPlan(px, dip = 0.06) { const p = num(px); if (!(p > 0)) return null; const L0 = p * (1 - dip);
  return { limit: r6(L0), stop: r6(L0 * 0.9), targets: [[r6(L0 * 1.2), 0.3], [r6(L0 * 1.5), 0.3]], expireH: 3, cancelAbove: r6(p * 1.25), cancelWhy: 'cancelled (ran without a dip)' }; }

// ---------- scalp rules on 5-minute candles ----------
const ema = (v, n) => { const k = 2 / (n + 1), o = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o.push(e); } return o; };
function rsi(c, n = 14) { const o = Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
  if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
// bars: 5-minute [t,o,h,l,c,v] ascending. Only candles that have closed by nowSec count, and the trigger candle must have closed in the last 10 minutes
// (the scan decides once an hour, so a trigger from earlier would already be stale).
export function scalpSignals(bars, nowSec, row = {}) {
  const B = (bars || []).map((b) => b.slice(0, 6).map(Number)).filter((b) => b.every((x) => isFinite(x)) && b[0] + 300 <= nowSec);
  if (B.length < 40) return [];
  const k = B.length - 1, b = B[k]; if (nowSec - (b[0] + 300) > 600) return [];
  const C = B.map((x) => x[4]), E = ema(C, 20), R = rsi(C, 14), avgV = B.slice(k - 24, k).reduce((a, x) => a + x[5], 0) / 24, [, o, h, l, c, v] = b, rng = h - l, out = [];
  const prevHi = Math.max(...B.slice(k - 12, k).map((x) => x[2]));
  if (c > prevHi && avgV > 0 && v >= 2 * avgV && rng > 0 && (c - l) / rng >= 0.6 && c <= E[k] * 1.06 && E[k] > E[k - 6] && c / B[k - 12][1] - 1 <= 0.25)
    out.push({ book: 'scalpBreak', why: [`5m close ${((c / prevHi - 1) * 100).toFixed(1)}% above the last hour's high`, `volume ${(v / avgV).toFixed(1)}x normal`, 'uptrend on the 20-candle average'] });
  if ((num(row.ch24) ?? 0) > 0 && l <= E[k] * 0.95 && R[k] != null && R[k] < 30 && avgV > 0 && v >= 1.5 * avgV && rng > 0 && c >= l + 0.5 * rng && E[k] >= E[Math.max(0, k - 12)] * 0.97)
    out.push({ book: 'scalpDip', why: [`flushed ${((1 - l / E[k]) * 100).toFixed(1)}% below the 20-candle average`, `RSI ${R[k].toFixed(0)}`, `volume ${(v / avgV).toFixed(1)}x normal`, 'closed off its low'] });
  return out;
}
// Which coins the scalper looks at: liquid enough to get in and out, ranked by how hard volume is running right now.
export function scalpCandidates(rows, n = 6, skipPools = new Set()) {
  return (rows || []).filter((p) => p && num(p.price) > 0 && p.rug !== 'danger' && (num(p.liq) ?? 0) >= 150000 && (num(p.v24) ?? 0) >= 750000 && !skipPools.has(p.pool))
    .sort((a, b) => (num(b.vacc) ?? 0) - (num(a.vacc) ?? 0)).slice(0, n);
}

// ---------- lifecycle phase (from the playbooks: too early, sweet spot, fading) ----------
export function lifecycle(p) {
  const age = num(p && p.ageD); if (age != null && age < 3) return 'new (under 3 days)';
  const dv = p && Array.isArray(p.dv) ? p.dv : null, prev = dv ? Math.max(...dv.slice(1, 7)) : null;
  if ((dv && prev > 0 && dv[0] < 0.4 * prev && (num(p.ch7d) ?? 0) < 0) || (num(p.ch7d) ?? 0) < -50) return 'fading';
  return 'sweet spot';
}

// ---------- first Fibonacci pullback (hourly candles, wick to wick) ----------
// The run: lowest low in the last 7 days before the highest high, the high made in the last 48 hours, at least +50%.
// Still a FIRST pullback: nothing since the high has traded below the 0.618 level. Limit at 0.5 (or 0.618 if price is already under 0.5).
// Stop 7% under the 0.786 level (memes overshoot). Targets: the old high, the 1.272 and 1.618 extensions of the run.
export function fibSetup(h1, nowSec, minGain = 0.5) {
  const B = (h1 || []).filter((b) => b && +b[0] + 3600 <= nowSec).slice(-168); if (B.length < 24) return null;
  let ih = 0; for (let i = 0; i < B.length; i++) if (+B[i][2] >= +B[ih][2]) ih = i;
  if (B.length - 1 - ih > 48) return null; let il = 0; for (let i = 0; i <= ih; i++) if (+B[i][3] < +B[il][3]) il = i;
  const H = +B[ih][2], L = +B[il][3]; if (!(L > 0) || H / L - 1 < minGain || ih - il < 4) return null;
  const lv = (x) => H - x * (H - L), after = B.slice(ih + 1), lowAfter = after.length ? Math.min(...after.map((b) => +b[3])) : H, c = +B[B.length - 1][4];
  if (lowAfter < lv(0.618)) return null; // already went deeper than the golden zone: not a clean first pullback
  let limit = null, lvl = null; if (c > lv(0.5) * 1.01) { limit = lv(0.5); lvl = '0.5'; } else if (c > lv(0.618) * 1.01) { limit = lv(0.618); lvl = '0.618'; } else return null;
  const stop = lv(0.786) * 0.93, ext = (x) => L + x * (H - L);
  return { limit: r6(limit), stop: r6(stop), targets: [[r6(H), 0.3], [r6(ext(1.272)), 0.3], [r6(ext(1.618)), 0.2]], expireH: 48, cancelAbove: r6(H * 1.02), cancelWhy: 'cancelled (new high before the pullback)',
    hiAt: new Date(B[ih][0] * 1000).toISOString().slice(0, 13), gain: +((H / L - 1) * 100).toFixed(0), why: [`ran ${((H / L - 1) * 100).toFixed(0)}% in ${ih - il} hours`, `limit at the ${lvl} retrace`, `stop under 0.786`] };
}

// ---------- inside the pattern (4h patterns that are still forming) ----------
export const INSIDE = ['Falling wedge', 'Bull flag', 'Double bottom', 'Inverse H&S', 'Cup & handle'];
export function insideSetup(p) {
  const price = num(p && (p.lastClose ?? p.price)), out = [];
  for (const q of (p && p.pats) || []) {
    if (!INSIDE.includes(q.name) || q.status !== 'forming' || !(q.quality >= 55) || !q.plan) continue;
    const trig = +q.trigger, sb = +q.stopBase, stop = +(q.plan.stopStruct ?? q.plan.stop), H = +q.H, rng = trig - sb; if (!(rng > 0) || !(stop < sb) || !(price > 0) || price >= trig) continue;
    let limit = sb + 0.33 * rng; if (price < limit) limit = price; if (!(limit > stop)) continue;
    if ((trig - limit) / (limit - stop) < 0.8) continue; // too little room to the breakout line for the risk
    out.push({ name: q.name, quality: q.quality, plan: { limit: r6(limit), stop: r6(stop), targets: [[r6(trig), 0.5], [r6(trig + 0.5 * H), 0.25], [r6(trig + H), 0.25]], expireH: 72, cancelAbove: r6(trig), cancelWhy: 'cancelled (broke out before the entry filled)' },
      why: [`${q.name} forming (quality ${q.quality})`, `bid the lower third, breakout line ${r6(trig)}`] });
  }
  return out.sort((a, b) => b.quality - a.quality);
}
