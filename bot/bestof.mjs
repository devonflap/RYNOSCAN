// THE BEST-OF BOT (25 Oct, the head council's own bot; paper only, never live). It has no signals of its own: it watches the other bots'
// books on this server and copies, at its own price a few seconds later, only the trades of the ways (bot + variant) that have EARNED it:
// 15+ closed trades, making money per $100 overall AND on both the older and the newer half of their trades. Until a way has 15 trades,
// a way the backtests proved (the base breakout held a week: +16.8% a trade over 428, on both halves) stands in on the backtest's word.
// It exits when the bot it copied sells (all, or the same share), with that trade's own stop as a safety. The list is re-read hourly and
// every change goes in the journal, so the best-of book shows whether the council's picks beat the bots it picks from.
export const BEST = { everyMin: 60, minN: 15, maxAgeMin: 10, sources: ['trench', 'trenchbonus', 'breakout', 'basebreak', 'bottoms'],
  seeds: [{ bot: 'basebreak', variant: 'H-hold', why: 'the runner backtest: 24-hour bases broken on volume, held a week, +16.8% a trade over 428, on both halves' }] };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null), r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
// every way's record, from the source bots' closed trades
export function rankWays(states, B = BEST) { const out = [];
  for (const bot of B.sources) { const st = states[bot]; if (!st) continue; const W = {};
    for (const t of st.closed || []) { if (!(t.costUsd > 0) || t.pnl == null) continue; (W[t.variant || (t.meta && t.meta.variant) || '-'] ||= []).push(t); }
    const keys = new Set([...Object.keys(W), ...B.seeds.filter((s) => s.bot === bot).map((s) => s.variant)]);
    for (const variant of keys) { const T = (W[variant] || []).slice().sort((a, b) => Date.parse(a.closedAt || 0) - Date.parse(b.closedAt || 0)), p = T.map((t) => (t.pnl / t.costUsd) * 100), h = Math.floor(p.length / 2);
      const per100 = r1(avg(p)), older = r1(avg(p.slice(0, h))), newer = r1(avg(p.slice(h))), seed = B.seeds.find((s) => s.bot === bot && s.variant === variant);
      const earned = T.length >= B.minN && per100 > 0 && older > 0 && newer > 0, onSeed = !!seed && T.length < B.minN;
      out.push({ bot, variant, n: T.length, per100, older, newer, ok: earned || onSeed, why: earned ? `${T.length} trades, ${per100 >= 0 ? '+' : ''}${per100}% per $100 (older half ${older >= 0 ? '+' : ''}${older}%, newer ${newer >= 0 ? '+' : ''}${newer}%)` : onSeed ? `on the backtest's word until it has ${B.minN} trades of its own (${T.length} so far): ${seed.why}` : T.length < B.minN ? `${T.length} trades: not enough to judge` : `${T.length} trades, ${per100 >= 0 ? '+' : ''}${per100}% per $100 (older ${older}%, newer ${newer}%): not earned` }); } }
  return out.sort((a, b) => (b.ok - a.ok) || ((b.per100 ?? -1e9) - (a.per100 ?? -1e9))); }
const short = (x) => (x.ok ? `${x.bot} ${x.variant}` : null);
// each cycle: re-rank hourly; new trades by an earned way (opened in the last few minutes) become setups at this bot's own price
export function bestSetupsIn(st, cfg, { readState, J, now, nowIso }) {
  const B = { ...BEST, ...(cfg.best || {}) }, states = Object.fromEntries(B.sources.map((b) => [b, readState(b)]));
  if (!st.best || now - (st.bestAt || 0) > B.everyMin * 60e3) { const before = new Set((st.best || []).filter((x) => x.ok).map(short)); st.best = rankWays(states, B); st.bestAt = now; const after = new Set(st.best.filter((x) => x.ok).map(short));
    for (const x of st.best) { const k = short(x) || `${x.bot} ${x.variant}`; if (x.ok && !before.has(k)) J({ type: 'best', side: 'added', way: k, why: x.why }); if (!x.ok && before.has(k)) J({ type: 'best', side: 'dropped', way: k, why: x.why }); } }
  const ok = new Set(st.best.filter((x) => x.ok).map(short)), seen = (st.mirrored ||= {}), first = !st.mirrorStarted; st.mirrorStarted = true;
  for (const bot of B.sources) { const s0 = states[bot]; if (!s0) continue;
    for (const p of s0.positions || []) { const key = bot + ':' + p.id; if (seen[key]) continue; seen[key] = now; if (first) continue; /* first look: what was already open is not copied */
      const variant = p.variant || (p.meta && p.meta.variant) || '-'; if (!ok.has(`${bot} ${variant}`)) continue;
      if (now - Date.parse(p.openedAt || 0) > B.maxAgeMin * 60e3 || !(p.remUnits > 0) || !(p.entry > 0)) continue;
      if (st.positions.some((x) => x.pool === p.pool)) continue; const stop = +(p.stop0 || p.stop) > 0 && +(p.stop0 || p.stop) < p.entry ? +(p.stop0 || p.stop) : +(p.entry * 0.5).toPrecision(6), sk = `${p.pool}@${bot}:${variant}`;
      st.setups[sk] = { pool: p.pool, coin: p.coin, chain: p.chain, token: p.token || (p.meta && p.meta.token) || null, kind: 'best', setup: `Best-of: copies ${bot} ${variant}`, opp: null, zoneLow: p.entry, zoneHigh: p.entry, stop, mults: [], shares: [], expireH: B.maxAgeMin / 60, at: nowIso, liq0: (p.meta && p.meta.liq0) || 0, url: p.url, mirrorOf: { bot, id: p.id, variant },
        why: [`${bot} ${variant} just bought ${p.coin}`, (st.best.find((x) => short(x) === `${bot} ${variant}`) || {}).why || ''] };
      J({ type: 'setup', coin: p.coin, pool: p.pool, kind: 'best', why: st.setups[sk].why }); } }
  for (const [k, t] of Object.entries(seen)) if (now - t > 14 * 86400e3) delete seen[k]; }
// the mirror exit: the copied trade sold all (out too) or part (the same share, from what this copy still holds)
export function mirrorExit(pos, src) { const m = pos.meta && pos.meta.mirrorOf; if (!m || !src) return null; const sp = (src.positions || []).find((x) => x.id === m.id);
  if (!sp) { const c = (src.closed || []).find((x) => x.id === m.id), last = c && (c.sells || []).slice(-1)[0]; return { all: true, why: `${m.bot} ${m.variant} sold ${pos.coin}${last && last.why ? ` (${last.why})` : ''}: the copy is out too` }; }
  const theirs = sp.units > 0 ? sp.remUnits / sp.units : 1, mine = pos.units > 0 ? pos.remUnits / pos.units : 1; if (theirs < mine - 0.02) { const frac = (mine - theirs) / mine, last = (sp.sells || []).slice(-1)[0]; return { all: false, frac, why: `${m.bot} ${m.variant} sold part${last && last.why ? ` (${last.why})` : ''}: the copy sells the same share` }; }
  return null; }
// a partial sale at the current price (the mirror's "same share")
export function sellPart(pos0, q, nowSec, frac, why, slipPct = 1) { const pos = { ...pos0, sells: [...(pos0.sells || [])] }, price = +(q && q.priceUsd), actions = []; if (!(price > 0) || !(pos.remUnits > 0)) return { pos, actions };
  const u = pos.remUnits * Math.min(1, Math.max(0, frac)), px = price * (1 - (pos.slipOut ?? slipPct) / 100), usd = u * px; pos.remUnits -= u; if (pos.remUnits < pos.units * 1e-6) pos.remUnits = 0; pos.bankedUsd += usd;
  const a = { why, units: u, usd: +usd.toFixed(2), px: +px.toPrecision(6), all: pos.remUnits <= 1e-12, at: new Date(nowSec * 1000).toISOString().slice(0, 19) + 'Z' }; pos.sells.push(a); actions.push(a); return { pos, actions }; }
