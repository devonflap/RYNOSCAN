// Reality check: the bot's dry-run trades against the paper book that replays the same rules on candles (the "Bot rules" book).
// The paper replay sees every candle high and low, so a target touched for ten seconds counts as sold; the bot only sees the price
// once a minute, the way a person would. On the trades both took, the gap between them is how much the candle replay flatters
// results, and that is the discount to apply to every paper book before trusting it. Pure: no network, no clock.
import { statsBook, fromRun } from '../docs/exits.mjs';
import { bootstrap } from '../docs/evidence.mjs';
import { BOOKS } from '../docs/strategies.mjs';

export const REALITY = { book: 'exec', everyDays: 14, matchH: 3, minN: 10 };
const T = (x) => { const t = Date.parse(x || ''); return isFinite(t) ? t : null; }, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(2)), pc = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'), rr = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + 'R');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], day = (ms) => { const d = new Date(ms + 10 * 3600e3); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }, within = (t, spans) => (spans || []).find(([a, b]) => t >= T(a) && t <= (T(b) ?? Infinity));
// how far each side got: 0 nothing, 1 first target, 2 second target or rode free at 2x, 3 third target
const stageBot = (p) => Math.max(0, ...(p.sells || []).map((s) => (/ride free/.test(s.why) ? 2 : /^TP(\d)/.test(s.why) ? +s.why.match(/^TP(\d)/)[1] : 0)));
const stagePaper = (t) => Math.max(0, ...(t.fills || []).map((f) => (f.why === 'ridefree' ? 2 : /^tp(\d)$/.test(f.why || '') ? +f.why.slice(2) : 0)));
const dropKind = (why) => (/too late/.test(why) ? 'the bot saw the trigger too late' : /chasing|ran past/.test(why) ? 'price ran before the bot could buy' : /too wide/.test(why) ? 'stop too wide for the bot' : 'the bot cancelled the setup (it broke down or expired)');

// bot: { closed, positions, journal, gaps: [[fromIso, toIso]], blocks: [[fromIso, toIso|null, why]], startedAt }
// paperRows: lab.json rows. Returns the report object; reportText() turns it into the phone message.
export function realityCheck(bot, paperRows, { now = Date.now(), cfg = REALITY, lastAt = null } = {}) {
  const start = T(bot.startedAt) ?? now, rows = (paperRows || []).filter((x) => x && x.book === cfg.book);
  const paper = statsBook(rows.map((x) => fromRun(x)).filter(Boolean), { now }).trades.filter((t) => (T(t.entryAt) ?? 0) >= start);
  const mine = [...(bot.closed || []).map((p) => ({ ...p, open: false })), ...(bot.positions || []).map((p) => ({ ...p, open: true }))].filter((p) => (p.book || cfg.book) === cfg.book && (T(p.openedAt) ?? 0) >= start);
  // pair each bot trade with the paper trade on the same pool closest in time (within matchH hours); each paper trade used once
  const used = new Set(), pairs = [];
  for (const b of mine.sort((x, y) => T(x.openedAt) - T(y.openedAt))) { const tb = T(b.openedAt); let best = null;
    for (const p of paper) { if (used.has(p.key) || String(p.pool).toLowerCase() !== String(b.pool).toLowerCase()) continue; const d = Math.abs((T(p.entryAt) ?? 0) - tb); if (d <= cfg.matchH * 3600e3 && (!best || d < best.d)) best = { p, d }; }
    if (best) { used.add(best.p.key); pairs.push({ b, p: best.p }); } else b.unmatched = true; }
  const both = pairs.filter((x) => !x.b.open && !x.p.open).map(({ b, p }) => { const riskUsd = b.costUsd * (b.entry - b.stop0) / b.entry, bPct = (b.pnl / b.costUsd) * 100;
    return { coin: b.coin, at: b.openedAt, paperPct: p.pnlPct, botPct: bPct, paperR: p.R, botR: riskUsd > 0 ? b.pnl / riskUsd : null, entryGapPct: p.entryPx > 0 ? (b.entry / p.entryPx - 1) * 100 : null, paperStage: stagePaper(p), botStage: stageBot(b) }; });
  const gapPct = both.map((x) => x.paperPct - x.botPct), gapR = both.filter((x) => x.paperR != null && x.botR != null).map((x) => x.paperR - x.botR), bs = gapPct.length >= 5 ? bootstrap(gapPct, 4000, 13) : null;
  // paper trades the bot did not take, and why (offline > blocked > the bot's own decision > never saw it > trigger did not fire)
  const J = bot.journal || [], missed = {}, missList = [];
  for (const p of paper) { if (used.has(p.key)) continue; const tp = T(p.entryAt); if (tp > now - 15 * 60e3) continue;
    const near = J.filter((j) => String(j.pool).toLowerCase() === String(p.pool).toLowerCase() && T(j.at) != null), win = near.filter((j) => T(j.at) >= tp - 2 * 3600e3 && T(j.at) <= tp + 15 * 60e3);
    const blk = within(tp, bot.blocks), drop = win.find((j) => j.type === 'drop'), skip = win.find((j) => j.type === 'skip');
    const why = within(tp, bot.gaps) ? 'the bot was offline' : blk ? blk[2] : drop ? dropKind(drop.why || '') : skip ? 'position too small for the bot' : near.some((j) => j.type === 'setup' && T(j.at) <= tp && T(j.at) >= tp - 26 * 3600e3) ? "the bot was watching but its trigger didn't fire" : 'the bot never picked up the setup';
    missed[why] = (missed[why] || 0) + 1; missList.push({ coin: p.coin, at: p.entryAt, why }); }
  const botOnly = mine.filter((b) => b.unmatched && T(b.openedAt) <= now - 2 * 3600e3);
  const n = both.length, out = {
    at: new Date(now).toISOString().slice(0, 19) + 'Z', book: cfg.book, since: day(start), days: Math.max(1, Math.round((now - start) / 86400e3)), lastAt,
    shared: pairs.length, n, minN: cfg.minN, paperPct: r2(mean(both.map((x) => x.paperPct))), botPct: r2(mean(both.map((x) => x.botPct))), paperR: r2(mean(both.filter((x) => x.paperR != null).map((x) => x.paperR))), botR: r2(mean(both.filter((x) => x.botR != null).map((x) => x.botR))),
    gapPct: r2(mean(gapPct)), gapR: r2(mean(gapR)), lo: bs ? r2(bs.lo) : null, hi: bs ? r2(bs.hi) : null, entryGapPct: r2(mean(both.map((x) => x.entryGapPct).filter((x) => x != null))),
    paperFurther: both.filter((x) => x.paperStage > x.botStage).length, botFurther: both.filter((x) => x.botStage > x.paperStage).length,
    paperTrades: paper.length, missed, missList: missList.slice(-30), botOnly: botOnly.map((b) => ({ coin: b.coin, at: b.openedAt })), offlineH: r2((bot.gaps || []).filter(([a]) => T(a) >= start).reduce((s, [a, b]) => s + ((T(b) ?? now) - T(a)) / 3600e3, 0)),
    newSinceLast: lastAt ? both.filter((x) => T(x.at) > T(lastAt)).length : n, pairs: both.map((x) => ({ ...x, paperPct: r2(x.paperPct), botPct: r2(x.botPct), paperR: r2(x.paperR), botR: r2(x.botR), entryGapPct: r2(x.entryGapPct) })) };
  out.call = n < cfg.minN ? 'too few' : bs.lo > 0 ? 'paper flatters' : bs.hi < 0 ? 'bot does better' : 'no clear gap';
  return out;
}

export function reality(st, journal, paperRows, opts = {}) {
  return realityCheck({ closed: st.closed, positions: st.positions, journal, gaps: st.gaps, blocks: st.blocks, startedAt: st.startedAt }, paperRows, { ...opts, lastAt: st.realityAt ? new Date(st.realityAt).toISOString() : null });
}

export function reportText(r, nextMs = null) {
  const L = [`Bot vs the paper "${(BOOKS[r.book || 'exec'] || {}).short || r.book}" book, since ${r.since} (${r.days} day${r.days === 1 ? '' : 's'}).`];
  if (!r.shared && !r.paperTrades) L.push('Neither side has taken a trade yet, so there is nothing to compare.');
  else {
    L.push(`Same trades: ${r.shared} coin${r.shared === 1 ? '' : 's'} both took, ${r.n} closed in both${r.newSinceLast != null && r.lastAt ? ` (${r.newSinceLast} new since the last check)` : ''}.`);
    if (r.n) { L.push(`Paper: ${pc(r.paperPct)} a trade (${rr(r.paperR)}). Bot: ${pc(r.botPct)} a trade (${rr(r.botR)}).`);
      L.push(r.gapPct >= 0 ? `Gap: the paper replay looks ${Math.abs(r.gapPct).toFixed(1)}% a trade better (${Math.abs(r.gapR ?? 0).toFixed(2)}R)${r.lo != null ? `; 90% range ${pc(r.lo)} to ${pc(r.hi)}` : ''}.` : `Gap: the bot did ${Math.abs(r.gapPct).toFixed(1)}% a trade better than paper (${Math.abs(r.gapR ?? 0).toFixed(2)}R)${r.lo != null ? `; 90% range ${pc(r.lo)} to ${pc(r.hi)}` : ''}.`);
      const src = []; if (r.entryGapPct != null) src.push(`the bot paid ${Math.abs(r.entryGapPct).toFixed(1)}% ${r.entryGapPct >= 0 ? 'more' : 'less'} getting in`);
      if (r.paperFurther) src.push(`${r.paperFurther === 1 ? 'once' : r.paperFurther + ' times'} the paper booked a target the bot never reached (price only touched it briefly)`); if (r.botFurther) src.push(`${r.botFurther === 1 ? 'once' : r.botFurther + ' times'} the bot got further than the paper`);
      if (src.length) L.push(`Where it comes from: ${src.join('; ')}.`); }
    const ms = Object.entries(r.missed).sort((a, b) => b[1] - a[1]), nm = ms.reduce((a, [, v]) => a + v, 0);
    if (nm) L.push(`Missed: the paper took ${nm} the bot didn't (${ms.map(([k, v]) => `${v} because ${k}`).join(', ')}).`);
    if (r.botOnly.length) L.push(`The bot took ${r.botOnly.length} the paper didn't (${r.botOnly.slice(0, 5).map((x) => x.coin).join(', ')}).`);
    if (r.offlineH >= 1) L.push(`The bot was offline for about ${Math.round(r.offlineH)} hour${Math.round(r.offlineH) === 1 ? '' : 's'} in this time.`);
  }
  L.push(r.call === 'too few' ? `What it means: ${r.n} shared closed trade${r.n === 1 ? '' : 's'} so far, too few for a firm number (${r.minN} needed). Keep it running.`
    : r.call === 'paper flatters' ? `What it means: knock about ${Math.abs(r.gapPct).toFixed(1)}% (${Math.abs(r.gapR ?? 0).toFixed(2)}R) a trade off every paper book's average before trusting it.`
    : r.call === 'bot does better' ? 'What it means: the paper books are, if anything, cautious. Their results look believable.'
    : `What it means: no clear gap yet (the range runs from ${pc(r.lo)} to ${pc(r.hi)}). The paper results look realistic so far.`);
  L.push('Both sides are still simulated: real slippage only shows once real money is used.');
  if (nextMs) L.push(`Next check: ${day(nextMs)}.`);
  return L.join('\n');
}
