// RynoScan dashboard. Reads data/*.json written by src/scan.mjs (no build step, no libraries).
import * as C from './core.mjs';
import { discoverPools } from './pools.mjs';
import { checkToken, applyOverlays } from './overlays.mjs';
import { debate } from './panel.mjs';
import { simulate, fwdSummary } from './paper.mjs';
import { book, fromSignal, fromRun, PROFILES } from './exits.mjs';
import { BOOKS } from './strategies.mjs';
import { evidence, exitHint } from './evidence.mjs';
import { botBook, BOT, BOT_RULES } from './botsim.mjs';
import { parseInfo } from './holders.mjs';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const sv = (tag, attrs = {}, txt) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt != null) e.textContent = txt; return e; };

// ---------- formatting ----------
const fp = (v) => {
  if (v == null || v === '' || !isFinite(+v)) return '—'; v = +v;
  if (v >= 1000) return '$' + v.toLocaleString('en', { maximumFractionDigits: 0 });
  if (v >= 1) return '$' + v.toFixed(v >= 100 ? 2 : 3);
  if (v === 0) return '$0';
  const z = Math.min(12, Math.max(0, -Math.floor(Math.log10(v))) + 3);
  return '$' + v.toFixed(z);
};
const usd = (v) => v == null ? '—' : '$' + Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const pct = (v, d = 1) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const num = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d);
const rr = (v) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
const brisbane = (iso) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' Brisbane';

// ---------- data ----------
const getJ = async (f, d) => { try { const r = await fetch('data/' + f + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); } catch { return d; } };
const GATES = [['gDivergence', 'Bullish divergence'], ['gRsiFlip', 'RSI flipping up'], ['gVolume', 'Volume confirms'], ['gBuyers', 'Buyers in control'], ['gZone', 'Price in entry zone'], ['gStructure', 'Structure turning up'], ['gSafe', 'Safe to size']];
const PGATES = [['pShape', 'Clean pattern shape'], ['pBrk', 'Broke out, not chased'], ['pVolume', 'Volume on breakout'], ['pBuyers', 'Buyers in control'], ['pRoom', 'Not overextended'], ['pSafe', 'Safe to size'], ['pReward', 'Pays at least 2R']];
const PATS = ['Bull flag', 'Inverse H&S', 'Cup & handle', 'Falling wedge', 'Double bottom', 'Trend pullback', 'Ascending triangle', 'Base breakout', 'Breakout retest', 'Liquidity sweep reclaim', 'Volume breakout'];
const DEX = { Solana: 'solana', Ethereum: 'ethereum', Robinhood: 'robinhood' };

// A row can be shown through three lenses: as scored (auto), as its chart pattern, or as a bottom reversal.
function viewAuto(r) {
  if (r.lead === 'pattern' && r.patName && r.patEntryLow != null) return patView(r, true);
  return { ...r, _g: GATES, _lab: r.bidReady ? 'Bid-ready' : r.signal === 'Watch' ? 'Watch' : 'No trade', _cls: r.bidReady ? 'b-entry' : r.signal === 'Watch' ? 'b-watch' : 'b-none' };
}
function patView(r, auto) {
  const ready = r.patReady, lab = ready ? 'Bid-ready' : r.patStatus === 'breakout' ? 'Broke out' : 'Forming';
  return { ...r, _g: PGATES, setupType: r.patName, entryLow: r.patEntryLow, entryHigh: r.patEntryHigh, stop: r.patStop, tp1: r.patTp1, tp2: r.patTp2, tp3: r.patTp3, rr1: r.patRr1, rr2: r.patRr2, rr3: r.patRr3, riskPct: r.patRisk, upsidePct: r.patUp, planValid: 1, gatesPassed: r.patPassed, missing: r.patMissing,
    _pat: true, _lab: auto && !ready && r.signal === 'Watch' ? 'Watch' : lab, _cls: ready ? 'b-entry' : (auto && r.signal === 'Watch') || r.patStatus === 'breakout' ? 'b-watch' : 'b-none' };
}
function botView(r) { return { ...r, _g: GATES, _bot: true, _lab: 'Bottomed out', _cls: 'b-bot' }; }

// ---------- candle chart with levels ----------
function candleChart(r, cr) {
  const bars = cr.bars.split(';').map((s) => s.split(' ').map(Number)), vols = cr.vol.split(' ').map(Number), n = bars.length;
  const W = 640, H = 300, PR = 74, VH = 46, T = 8, B = 16, pw = W - PR, ph = H - VH - T - B;
  const lv = [r.stop, r.entryLow, r.entryHigh, r.tp1, r.tp2, r.tp3].filter((v) => v != null).map(Number);
  const ov = r._bot ? null : cr.pat;
  const ovy = ov ? [...ov.lines.flatMap((l) => [l[1], l[3]]), ...ov.pts.map((p) => p[1])].map(Number) : [];
  // keep the view on the candles if a level is absurdly far away (cap at 3x the candle range)
  const cLo = Math.min(...bars.map((b) => b[2])), cHi = Math.max(...bars.map((b) => b[1]));
  let lo = Math.min(cLo, ...lv, ...ovy), hi = Math.max(cHi, ...lv, ...ovy);
  const span = cHi - cLo || cHi * 0.1; lo = Math.max(lo, cLo - span * 1.2); hi = Math.min(hi, cHi + span * 2.2);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const y = (v) => T + ph * (1 - (v - lo) / (hi - lo)), step = pw / n, x = (i) => (i + 0.5) * step, bw = Math.max(1.5, step * 0.62);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': `${r.coin} 4h chart with entry, stop and targets` });
  for (let g = 0; g <= 4; g++) { const v = lo + (hi - lo) * g / 4; svg.append(sv('line', { x1: 0, x2: pw, y1: y(v), y2: y(v), stroke: '#bdbdbd', 'stroke-opacity': .1 })); }
  const clip = (v) => v != null && v >= lo && v <= hi;
  if (r.entryLow != null && r.entryHigh != null) {
    const a = y(Math.min(hi, Number(r.entryHigh))), b = y(Math.max(lo, Number(r.entryLow)));
    svg.append(sv('rect', { x: 0, y: a, width: pw, height: Math.max(2, b - a), fill: '#e0e1e0', 'fill-opacity': .16 }));
  }
  const labs = [];
  const line = (v, color, label, dash) => { if (v == null) return; v = Number(v); const inR = clip(v), yy = y(Math.min(hi, Math.max(lo, v)));
    svg.append(sv('line', { x1: 0, x2: pw, y1: yy, y2: yy, stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': dash || '', 'stroke-opacity': inR ? .95 : .5 }));
    labs.push({ y: yy, color, label: label + (inR ? '' : v > hi ? ' ↑' : ' ↓') }); };
  line(r.stop, '#f87171', 'STOP'); line(r.tp1, '#6ee7b7', 'TP1'); line(r.tp2, '#34d399', 'TP2'); line(r.tp3, '#10b981', 'TP3');
  if (r.entryHigh != null) line(r.entryHigh, '#e0e1e0', 'ENTRY', '4 3');
  if (r.price != null) line(r.price, '#ececec', 'NOW', '2 3');
  labs.sort((a, b) => a.y - b.y); for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 11) labs[i].y = labs[i - 1].y + 11;
  labs.forEach((l) => svg.append(sv('text', { x: pw + 4, y: l.y + 3, fill: l.color, 'font-size': 10 }, `${l.label} ${fp(l.label.startsWith('NOW') ? r.price : lvVal(r, l.label))}`)));
  const vmax = Math.max(...vols, 1);
  bars.forEach((b, i) => {
    const up = b[3] >= b[0], c = up ? '#34d399' : '#f87171', yy = (v) => y(Math.min(hi, Math.max(lo, v)));
    const g = sv('g'); g.append(sv('title', {}, `O ${fp(b[0])}  H ${fp(b[1])}  L ${fp(b[2])}  C ${fp(b[3])}  vol ${usd(vols[i])}`));
    g.append(sv('line', { x1: x(i), x2: x(i), y1: yy(b[1]), y2: yy(b[2]), stroke: c, 'stroke-width': 1 }));
    g.append(sv('rect', { x: x(i) - bw / 2, y: Math.min(yy(b[0]), yy(b[3])), width: bw, height: Math.max(1, Math.abs(yy(b[0]) - yy(b[3]))), fill: c }));
    const vh = vols[i] / vmax * (VH - 6); g.append(sv('rect', { x: x(i) - bw / 2, y: H - B - vh, width: bw, height: vh, fill: c, 'fill-opacity': .45 }));
    svg.append(g);
  });
  if (ov) {
    ov.lines.forEach((l) => { let [x0, y0, x1, y1] = l.map((v, i) => i === 4 ? v : Number(v));
      if (x0 < 0) { const f = (0 - x0) / (x1 - x0 || 1); y0 = y0 + (y1 - y0) * f; x0 = 0; }
      svg.append(sv('line', { x1: x(x0), y1: y(y0), x2: x(x1), y2: y(y1), stroke: '#a78bfa', 'stroke-width': 1.6, 'stroke-dasharray': '5 3' })); });
    ov.pts.forEach((p) => { if (p[0] >= 0) svg.append(sv('circle', { cx: x(p[0]), cy: y(Number(p[1])), r: 3.6, fill: '#a78bfa', stroke: '#141414' })); });
  }
  svg.append(sv('text', { x: 2, y: H - 2, fill: '#a9a9a9', 'font-size': 9.5 }, `last ${n} four-hour candles · volume below`));
  return svg;
}
const lvVal = (r, label) => ({ STOP: r.stop, TP1: r.tp1, TP2: r.tp2, TP3: r.tp3, ENTRY: r.entryHigh })[label.replace(/ [↑↓]/, '')];

// ---------- price ladder: stop -> entry zone -> targets, with the live price ----------
function ladder(r) {
  const lv = [r.stop, r.entryLow, r.entryHigh, r.tp1, r.tp2, r.tp3].map(Number); if (lv.some((v) => !isFinite(v))) return null;
  const now = isFinite(+r.price) ? +r.price : +r.entryHigh, lo = Math.min(...lv, now), hi = Math.max(...lv, now), W = 640, H = 78, P = 14;
  const x = (v) => P + (W - 2 * P) * ((v - lo) / (hi - lo || 1)), yb = 40;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch ladder-svg', role: 'img', 'aria-label': `${r.coin} price ladder` });
  svg.append(sv('line', { x1: x(lv[0]), x2: x(lv[5]), y1: yb, y2: yb, stroke: '#bdbdbd', 'stroke-opacity': .35, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  svg.append(sv('rect', { x: x(lv[0]), y: yb - 4, width: Math.max(2, x(lv[1]) - x(lv[0])), height: 8, fill: '#f87171', 'fill-opacity': .55, rx: 2 }));
  svg.append(sv('rect', { x: x(lv[1]), y: yb - 8, width: Math.max(4, x(lv[2]) - x(lv[1])), height: 16, fill: '#e0e1e0', 'fill-opacity': .85, rx: 3 }));
  const mark = (v, col, lab, up) => { svg.append(sv('line', { x1: x(v), x2: x(v), y1: yb - 10, y2: yb + 10, stroke: col, 'stroke-width': 2 })); svg.append(sv('text', { x: x(v), y: up ? yb - 16 : yb + 24, fill: col, 'font-size': 10, 'text-anchor': 'middle' }, lab)); };
  mark(lv[0], '#f87171', 'STOP', false); mark(lv[3], '#6ee7b7', 'TP1', true); mark(lv[4], '#34d399', 'TP2', true); mark(lv[5], '#10b981', 'TP3', true);
  svg.append(sv('text', { x: (x(lv[1]) + x(lv[2])) / 2, y: yb - 16, fill: '#e0e1e0', 'font-size': 10, 'text-anchor': 'middle' }, 'BUY'));
  svg.append(sv('polygon', { points: `${x(now)},${yb + 12} ${x(now) - 5},${yb + 21} ${x(now) + 5},${yb + 21}`, fill: '#ececec' }));
  svg.append(sv('text', { x: x(now), y: yb + 33, fill: '#ececec', 'font-size': 10, 'text-anchor': 'middle' }, 'NOW'));
  return svg;
}
// live entry status from the 30-minute watcher (falls back to the scan price)
function entryLine(r) {
  const w = S.watch.get(r.id); if (!w || w.price == null || r.entryHigh == null) return null;
  const old = S.watchAt && Date.now() - Date.parse(S.watchAt) > 2 * 3600e3 ? ` (price from ${ago(S.watchAt)})` : '';
  const flow = w.h1b != null && w.h1s != null ? ` 1h flow: ${w.h1b} buys / ${w.h1s} sells.` : '', d = (w.price / Number(r.entryHigh) - 1) * 100, win = w.windowLeftH != null ? ` Fill window: ${Math.round(w.windowLeftH)}h left.` : '';
  const m = { 'in-zone': ['y', `In the buy zone now (${fp(w.price)}). Rest a limit order at ${fp(r.entryHigh)} or better.`], near: ['w', `${d.toFixed(1)}% above the top of the zone. Place the limit order at ${fp(r.entryHigh)} now so it fills on the dip.`],
    far: ['n', `${d.toFixed(1)}% above the zone. Wait for a pullback; do not chase.`], invalid: ['n', `Price is through the stop (${fp(r.stop)}). This setup is dead, do not buy.`], ran: ['n', `Price ran past TP1 without a fill. The entry is gone, do not chase.`] }[w.state];
  return m ? { cls: m[0], txt: m[1] + win + flow + old } : null;
}
function planText(r) {
  const p = Number(r.price), d = (v) => v == null ? '' : ` (${pct((Number(v) / p - 1) * 100)})`;
  return [`${r.coin} (${r.chain}) · ${r.setupType || 'Bottom reversal'} · opportunity ${r.opp ?? '—'}`, `Buy limit: ${fp(r.entryLow)} – ${fp(r.entryHigh)} (rest the order at the top, ${fp(r.entryHigh)})`, `Stop (sell all): ${fp(r.stop)}${d(r.stop)}`,
    `TP1: ${fp(r.tp1)}${d(r.tp1)} · sell a third, move stop to entry`, `TP2: ${fp(r.tp2)}${d(r.tp2)} · sell a third`, `TP3: ${fp(r.tp3)}${d(r.tp3)} · sell the rest`, `Risk to stop: ${r.riskPct != null ? num(r.riskPct) + '%' : '—'} · max size about 1% of liquidity (${usd(r.liquidity)})`,
    'Fill window 48h, time exit 7 days. Rule-based screen, not advice.'].join('\n');
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { try { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch { return false; } } }
// positions the person marked as entered; stored only in this browser
const POS = { get() { try { return JSON.parse(store.get('rynoPos') || '{}'); } catch { return {}; } }, set(o) { store.set('rynoPos', JSON.stringify(o)); } };

// holder info: count, growth measured by RynoScan between its own readings, and how concentrated the top wallets are
function holderLine(r) {
  const h = r.hs; if (!h || h.holders == null) return null;
  const parts = [`Holders: ${Number(h.holders).toLocaleString('en')}`], bad = [];
  if (h.growPct != null) { parts.push(`${pct(h.growPct)} over ${h.growDays} day${h.growDays >= 1.5 ? 's' : ''}`); if (h.growPct < 0) bad.push('holder count is falling'); else if (h.growPct >= 10) parts.push('growing fast'); }
  if (h.top10Pct != null) { parts.push(`top 10 wallets hold ${h.top10Pct}%`); if (h.top10Pct >= 50) bad.push('very concentrated: a few wallets can dump on you'); else if (h.top10Pct >= 35) bad.push('fairly concentrated'); }
  return { cls: bad.length ? 'caut' : 'meta', txt: parts.join(' · ') + (bad.length ? ' (' + bad.join('; ') + ')' : '') + '. Shown for your judgement; it does not change the score.' };
}
function socialLine(r) {
  const o = r.soc; if (!o) return null;
  const parts = [], a = (t, u) => u && parts.push({ t, u });
  a('X', o.x); a('Telegram', o.tg); a('Discord', o.dc); a('Website', o.web);
  return { none: o.n === 0, parts, txt: o.n === 0 ? 'Socials: no X, Telegram or website on the listing (nobody is vouching for it)' : 'Socials:' };
}
// ---------- coin card ----------
function takeLine(r) {
  const pos = [], neg = [];
  if (r.rvol4h != null && r.rvol4h >= 1.3) pos.push(`volume is ${num(r.rvol4h)}x its norm`);
  if (r.conf != null) (r.conf >= 5 ? pos : neg).push(`market data ${r.conf >= 5 ? 'confirms it' : 'only partly agrees'} (${r.conf}/6)`);
  if (r.buySell24h != null) (r.buySell24h >= 1 ? pos : neg).push(`${r.buySell24h >= 1 ? 'buyers' : 'sellers'} lead 24h (${num(r.buySell24h, 2)})`);
  if (r.caution) neg.push(r.caution);
  return { pos, neg };
}
function trackLine(r) {
  const L = S.learned; if (!L || !L.setups) return null; const t = L.setups.find((x) => x.setup === (r.setupType || r.patName));
  if (!t) return { cls: 'n', txt: 'Track record: no closed trades yet for this setup type.' };
  const v = { proven: ['y', 'proven'], failing: ['bad', 'failing'], promising: ['w', 'promising, not proven'], weak: ['n', 'weak'], unproven: ['n', 'too few trades to judge'] }[t.verdict];
  return { cls: v[0], txt: `Track record, ${t.setup}: ${Math.round(t.winRate * 100)}% won, ${rr(t.avgR)} average over ${t.n} closed trades (${v[1]}).` };
}
// bull vs bear vs neutral judge, from the same data the card shows
function panelCtx(r) { const al = S.vol.find((d) => d.chain === 'All' && d.daysAgo === 0); return { learned: S.learned, watch: S.watch.get(r.id), volRatio: al ? al.ratio : null, btAvg: S.bt && S.bt.overall ? S.bt.overall.avgR : null }; }
function opinionBox(r) {
  let d; try { d = debate(r, panelCtx(r)); } catch { d = null; } if (!d) return null;
  const box = el('details', 'opinion t-' + d.tone), sm = el('summary'); sm.append(el('b', null, 'Opinion: ' + d.verdict), el('span', 'meta', `  bull ${d.bullScore} vs bear ${d.bearScore} · ${d.why}`)); box.append(sm);
  const voice = (name, cls, pts, empty) => { const v = el('div', 'voice ' + cls); v.append(el('b', null, name)); if (!pts.length) v.append(el('p', 'meta', empty)); pts.forEach((x) => v.append(el('p', null, '• ' + x.text))); return v; };
  box.append(voice('🐂 Bull', 'v-bull', d.bull, 'Could not find a strong reason to buy.'), voice('🐻 Bear', 'v-bear', d.bear, 'Could not find a strong reason to avoid it.'));
  if (d.rebut.length) { const rb = el('div', 'voice v-reb'); rb.append(el('b', null, 'Rebuttals')); d.rebut.forEach((x) => rb.append(el('p', null, `${x.by} to ${x.to}: ${x.text}`))); box.append(rb); }
  const nj = el('div', 'voice v-neu'); nj.append(el('b', null, '⚖️ Neutral judge'), el('p', null, `${d.why} Evidence on this setup: ${d.evidence === 'none' ? 'no closed trades yet' : d.evidence}.`)); if (d.flip.length) nj.append(el('p', 'meta', 'What would change this: ' + d.flip.join('; ') + '.')); box.append(nj);
  return box;
}
function levels(r) {
  const t = el('table', 'lv'), p = Number(r.price), d = (v) => v == null ? '—' : pct((Number(v) / p - 1) * 100);
  const row = (lab, val, ext, cls) => { const tr = el('tr', cls); tr.append(el('td', null, lab), el('td', 'n', val), el('td', 'n', ext)); t.append(tr); };
  row('Now', fp(r.price), '');
  row('Entry zone', `${fp(r.entryLow)} – ${fp(r.entryHigh)}`, '');
  row('Stop (sell all)', fp(r.stop), `${d(r.stop)}`, 'stop');
  row('TP1 · sell ⅓, stop to entry', fp(r.tp1), `${d(r.tp1)} · ${rr(r.rr1).replace('+', '')}`, 'tp');
  row('TP2 · sell ⅓', fp(r.tp2), `${d(r.tp2)} · ${rr(r.rr2).replace('+', '')}`, 'tp');
  row('TP3 · sell the rest', fp(r.tp3), `${d(r.tp3)} · ${rr(r.rr3).replace('+', '')}`, 'tp');
  return t;
}

// ---------- live chart: DexScreener link, refresh, embedded live chart ----------
const dexUrl = (chain, pool) => `https://dexscreener.com/${DEX[chain] || String(chain).toLowerCase()}/${pool}`;
const dexLink = (r, cls, txt) => { const a = el('a', cls, txt); if (r.pool) { a.href = dexUrl(r.chain, r.pool); a.target = '_blank'; a.rel = 'noopener'; a.title = 'Open the full live chart on DexScreener'; } return a; };
const clock = (d = new Date()) => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const LIVE = new Set(); // every plan card currently on the page, so one price poll can update them all
// What the live price and candles say about each level: touched, breached, or still ahead.
function levelStatus(r, price, hi, lo) {
  const out = [], p = Number(price); if (!isFinite(p)) return out;
  const hiV = isFinite(+hi) ? Math.max(+hi, p) : p, loV = isFinite(+lo) ? Math.min(+lo, p) : p;
  if (r.stop != null) out.push({ k: 'STOP', v: Number(r.stop), hit: p <= Number(r.stop), touched: loV <= Number(r.stop) });
  [['TP1', r.tp1], ['TP2', r.tp2], ['TP3', r.tp3]].forEach(([k, v]) => { if (v != null) out.push({ k, v: Number(v), hit: p >= Number(v), touched: hiV >= Number(v) }); });
  return out;
}
function levelStrip(r, price, hi, lo) {
  const w = el('div', 'lstrip'), p = Number(price);
  if (r.entryLow != null) { const inz = p >= Number(r.entryLow) && p <= Number(r.entryHigh); const e = el('span', 'lchip ent' + (inz ? ' hit' : ''), `ENTRY ${fp(r.entryLow)}–${fp(r.entryHigh)}${inz ? ' · price in zone' : ''}`); w.append(e); }
  levelStatus(r, price, hi, lo).forEach((l) => {
    const d = isFinite(p) ? (l.v / p - 1) * 100 : null;
    const note = l.hit ? (l.k === 'STOP' ? ' · price through it' : ' · price above it') : l.touched ? ' · touched since scan' : d != null ? ' · ' + pct(d) : '';
    w.append(el('span', 'lchip ' + (l.k === 'STOP' ? 'stp' : 'tp') + (l.hit ? ' hit' : l.touched ? ' tch' : ''), `${l.k} ${fp(l.v)}${note}`));
  });
  return w;
}
// Pull fresh 1h candles, rebuild the 4h chart including the forming candle, and keep the pattern overlay lined up.
async function freshChart(r, cr) {
  const net = C.NETOF[String(r.chain).toLowerCase()], j = net && r.pool ? await gget(`/networks/${net}/pools/${r.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`) : null;
  const raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list; if (!raw) return null;
  const h1 = C.cleanBars(raw); if (h1.length < 8) return null;
  const h4 = C.resample(h1, 14400); if (h4.length < 5) return null;
  const n0 = cr ? cr.bars.split(';').length : 60, t0 = cr && cr.t0 != null ? cr.t0 : null;
  const shift = t0 != null ? h4.filter((b) => b[0] > t0).length : 0, k = h4.slice(-n0), s5 = (x) => +(+x).toPrecision(5);
  const pat = cr && cr.pat ? { ...cr.pat, lines: cr.pat.lines.map((l) => [l[0] - shift, l[1], l[2] - shift, l[3], l[4]]), pts: cr.pat.pts.map((q) => [q[0] - shift, q[1]]) } : null;
  const last = h4[h4.length - 1], lastH1 = h1[h1.length - 1];
  const since = t0 != null ? h4.filter((b) => b[0] > t0) : [];
  return { cr: { id: cr && cr.id, t0, bars: k.map((b) => [b[1], b[2], b[3], b[4]].map(s5).join(' ')).join(';'), vol: k.map((b) => Math.round(b[5])).join(' '), pat, live: true },
    price: lastH1[4], hi: since.length ? Math.max(...since.map((b) => b[2])) : last[2], lo: since.length ? Math.min(...since.map((b) => b[3])) : last[3] };
}
// The part of a card that moves with the market: ladder, chart, level strip and table. Re-rendered in place.
function chartBox(r, cr0) {
  const box = el('div', 'cbox'), st = { cr: cr0, hi: null, lo: null, at: null, src: null, busy: false, frame: null };
  const head = el('div', 'chead'), note = el('span', 'meta chnote'), rf = el('button', 'act sm', '↻ Refresh chart'), lv = el('button', 'act sm', '▶ Live chart here');
  rf.type = lv.type = 'button'; head.append(rf, lv, dexLink(r, 'act sm', 'DexScreener ↗'), note);
  const body = el('div', 'cbody'), embed = el('div', 'cembed'); embed.hidden = true;
  const paint = () => {
    body.replaceChildren();
    if (st.at) body.append(levelStrip(r, r.price, st.hi, st.lo));
    const ld = ladder(r); if (ld) body.append(ld);
    if (st.cr) body.append(candleChart(r, st.cr)); body.append(levels(r));
    note.textContent = st.at ? `${st.src === 'candles' ? 'Chart' : 'Price'} refreshed ${clock(st.at)}` : '';
  };
  const reg = { r, box, setPrice(p) { if (!isFinite(+p) || +p <= 0) return; r.price = +p; st.at = new Date(); st.src = st.src || 'price'; if (st.cr && st.cr.live) st.cr = bump(st.cr, +p); if (box.isConnected) paint(); } };
  const bump = (cr, p) => { const b = cr.bars.split(';'), x = b[b.length - 1].split(' ').map(Number); x[1] = Math.max(x[1], p); x[2] = Math.min(x[2], p); x[3] = p; b[b.length - 1] = x.map((v) => +v.toPrecision(5)).join(' '); return { ...cr, bars: b.join(';') }; };
  rf.onclick = async () => {
    if (st.busy) return; st.busy = true; rf.disabled = true; rf.textContent = 'Refreshing…';
    try {
      const f = await freshChart(r, st.cr);
      if (f) { st.cr = f.cr; st.hi = f.hi; st.lo = f.lo; r.price = f.price; st.at = new Date(); st.src = 'candles'; paint(); }
      else { note.textContent = 'Could not reach the chart feed just now (rate limit?). Try again in a minute.'; }
    } catch { note.textContent = 'Refresh failed. Try again in a minute.'; }
    st.busy = false; rf.disabled = false; rf.textContent = '↻ Refresh chart';
  };
  lv.onclick = () => {
    if (!r.pool) return;
    if (!st.frame) {
      const fr = document.createElement('iframe'); fr.className = 'dexframe'; fr.loading = 'lazy'; fr.title = `${r.coin} live chart on DexScreener`; fr.referrerPolicy = 'no-referrer';
      fr.src = `${dexUrl(r.chain, r.pool)}?embed=1&theme=dark&trades=0&info=0&interval=240`;
      const cap = el('p', 'meta', 'Live DexScreener chart. The strip and the 4h chart above carry your entry, stop and targets; DexScreener cannot draw them on its own chart. Use ↻ to re-check them against the live price. If the frame stays blank, tap DexScreener ↗.');
      st.frame = fr; embed.append(cap, fr);
    }
    embed.hidden = !embed.hidden; lv.textContent = embed.hidden ? '▶ Live chart here' : '■ Hide live chart';
  };
  paint(); box.append(head, body, embed); reg.box = box; LIVE.add(reg); box.reg = reg;
  return box;
}
// one batched price poll for every plan card on screen (DexScreener, 30 pools per call)
let pollBusy = false;
async function pollPrices() {
  if (pollBusy || document.hidden) return; pollBusy = true;
  try {
    const by = new Map(); for (const g of [...LIVE]) { if (!g.box.isConnected) { LIVE.delete(g); continue; } const k = DEX[g.r.chain] || String(g.r.chain).toLowerCase(); if (!g.r.pool) continue; if (!by.has(k)) by.set(k, new Map()); const m = by.get(k), a = m.get(g.r.pool.toLowerCase()) || []; a.push(g); m.set(g.r.pool.toLowerCase(), a); }
    for (const [chain, m] of by) { const pools = [...m.keys()];
      for (let i = 0; i < pools.length; i += 30) {
        try { const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pools.slice(i, i + 30).join(',')}`); if (!res.ok) continue; const j = await res.json();
          for (const p of (j && j.pairs) || []) { const gs = m.get(String(p.pairAddress || '').toLowerCase()); const px = Number(p.priceUsd); if (gs && px > 0) gs.forEach((g) => g.setPrice(px)); } } catch { /* next tick */ }
      } }
  } finally { pollBusy = false; }
}
setInterval(pollPrices, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(pollPrices, 500); });
function coinCell(s, bare) { const td = el('td'); if (s.pool) { td.append(dexLink(s, 'coinlink', s.coin + ' ↗')); if (!bare) td.append(` · ${s.chain}`); } else td.textContent = bare ? s.coin : `${s.coin} · ${s.chain}`; return td; }
function card(r, cr) {
  const c = el('article', 'plan'), t = el('div', 't');
  const h = el('div'); const tl = dexLink(r, 'coinlink'); tl.append(el('b', null, r.coin), el('span', 'ext', ' ↗')); h.append(r.pool ? tl : el('b', null, r.coin), el('span', 'meta', `  ${r.chain} · ${r.setupType || r.patName || 'Bottom reversal'}${r.mine ? ' · your search' : ''}`));
  t.append(h, el('span', 'badge ' + r._cls, r._lab)); c.append(t);
  const sc = el('div', 'score'); sc.append('Opportunity ', el('b', null, r.opp != null ? r.opp : '—'), `· gates ${r.gatesPassed ?? '—'}/7`, `· risk to stop ${r.riskPct != null ? num(r.riskPct) + '%' : '—'}`, `· upside to TP3 ${r.upsidePct != null ? '+' + num(r.upsidePct, 0) + '%' : '—'}`);
  c.append(sc);
  const tr_ = trackLine(r); if (tr_) c.append(el('p', 'track ' + tr_.cls, tr_.txt));
  const el_ = r.entryLow != null && r.stop != null ? entryLine(r) : null; if (el_) c.append(el('p', 'eline ' + el_.cls, el_.txt));
  if (r.entryLow != null && r.stop != null) c.append(chartBox(r, cr && r.entryLow != null ? cr : null));
  if (r.entryLow != null && r.stop != null) {
    const bar = el('div', 'acts'), cp = el('button', 'act', 'Copy trade plan'); cp.type = 'button';
    cp.onclick = async () => { const ok = await copyText(planText(r)); cp.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { cp.textContent = 'Copy trade plan'; }, 2000); };
    const en = el('button', 'act' + (POS.get()[r.id] ? ' on' : ''), POS.get()[r.id] ? 'Entered ✓ (tap to undo)' : 'Mark as entered'); en.type = 'button';
    en.onclick = () => { const o = POS.get(); if (o[r.id]) delete o[r.id]; else o[r.id] = { at: new Date().toISOString(), coin: r.coin, chain: r.chain, entryLow: r.entryLow, entryHigh: r.entryHigh, stop: r.stop, tp1: r.tp1, tp2: r.tp2, tp3: r.tp3 }; POS.set(o); en.className = 'act' + (o[r.id] ? ' on' : ''); en.textContent = o[r.id] ? 'Entered ✓ (tap to undo)' : 'Mark as entered'; verdict(); };
    bar.append(cp, en); c.append(bar);
  }
  else c.append(el('p', 'caut', r.noTradeWhy || r.scanState || 'No valid trade plan on the current 4h chart: no clean stop that pays at least 2R.'));
  // what matters stays on the card; the rest folds into "Details"
  const ob = r.entryLow != null && r.stop != null ? opinionBox(r) : null; if (ob) c.append(ob);
  if (r.rug === 'warn') c.append(el('p', 'caut', 'Token flags: ' + (r.rugFlags || 'see contract')));
  if (r.regime === 'Risk-off') c.append(el('p', 'caut', 'Market is risk-off for this chain: reversals fail more often. Size down.'));
  if (r.missing && !r.bidReady && !(r._pat && r.patReady)) c.append(el('p', 'caut', 'Still needs: ' + r.missing.split(',').filter(Boolean).join(', ')));
  { const hl = holderLine(r); if (hl) c.append(el('p', hl.cls, hl.txt.replace(/ Shown for your judgement[^.]*\./, ''))); }
  { const sl = socialLine(r); if (sl) { const p = el('p', sl.none ? 'caut' : 'meta', sl.txt + (sl.none ? '.' : ' ')); sl.parts.forEach((x, i) => { if (i) p.append(' · '); const a = el('a', '', x.t); if (/^https?:\/\//i.test(x.u)) { a.href = x.u; a.target = '_blank'; a.rel = 'noopener noreferrer'; } p.append(a); }); c.append(p); } }
  const more = el('details', 'more'), ms = el('summary', null, `Details · ${r._g.filter(([k]) => r[k]).length}/${r._g.length} checks · facts`); more.append(ms);
  const g = el('div', 'gates'); r._g.forEach(([k, lab]) => g.append(el('span', 'g ' + (r[k] ? 'y' : 'n'), (r[k] ? '✓ ' : '✗ ') + lab))); more.append(g);
  if (r.rug === 'ok') more.append(el('p', 'ok-line', '✓ Token checks clear (no mint/freeze control, honeypot or tax flags found)'));
  else if (r.rug === 'unchecked' || (r.rug == null && S.meta && S.meta.safetyOn)) more.append(el('p', 'caut', 'Token not checked by the safety feed: look at the contract and top holders yourself before buying.'));
  const { pos, neg } = takeLine(r);
  if (pos.length) more.append(el('p', 'meta', 'For: ' + pos.join('; ') + '.'));
  if (neg.length) more.append(el('p', 'caut', 'Against: ' + neg.join('; ') + '.'));
  const f = el('div', 'facts');
  [['24h volume', usd(r.vol24h)], ['Holders', r.hs && r.hs.holders != null ? Number(r.hs.holders).toLocaleString('en') + (r.hs.growPct != null ? ` (${pct(r.hs.growPct, 0)})` : '') : '—'], ['Liquidity', usd(r.liquidity)], ['24h change', pct(r.chg24h)], ['RSI 1h / 4h', `${num(r.rsi1h, 0)} / ${num(r.rsi4h, 0)}`], ['Buyers / sellers', `${r.buyers24h ?? '—'} / ${r.sellers24h ?? '—'}`], ['Age', r.ageDays != null ? num(r.ageDays, 0) + ' d' : '—']]
    .forEach(([k, v]) => { const d = el('div'); d.append(k, el('b', null, v)); f.append(d); });
  more.append(f);
  if (r.flags) more.append(el('p', 'caut', 'Flags: ' + r.flags));
  c.append(more);
  return c;
}


// ---------- paper trading: $10,000, 5% of the account on every bid-ready setup ----------
const usd0 = (v) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en');
const fpx = (v) => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); return '$' + (a >= 100 ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : a >= 1 ? v.toFixed(3) : a >= 0.0001 ? String(Number(v.toPrecision(3))) : v.toFixed(8).replace(/0+$/, '')); };
const usdS = (v) => (v < 0 ? '−$' : '+$') + Math.abs(v).toLocaleString('en', { maximumFractionDigits: 0 });
const whenS = (iso) => { const d = new Date(iso); return isFinite(d) ? d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'; };
function deskView(host, p, o) {
  const gain = p.equity - p.start, cls = gain > 0 ? 'pos' : gain < 0 ? 'neg' : '';
  const chips = el('div', 'dk-chips'); chips.append(el('span', 'dk-chip ok', 'Paper money only · nothing is traded for real'), el('span', 'dk-chip', o.sizing), el('span', 'dk-chip', `${p.openN} open · ${p.waitingN} waiting`)); if (p.skipped) chips.append(el('span', 'dk-chip', `${p.skipped} skipped (${p.skipWhy && Object.keys(p.skipWhy).length ? Object.entries(p.skipWhy).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(', ') : 'all slots full'})`)); host.append(chips);
  const hero = el('div', 'dk-hero');
  const stat = (k, v, sub, c) => { const d = el('div', 'dk-stat'); d.append(el('div', 'dk-k', k), el('div', 'dk-v ' + (c || ''), v), el('div', 'dk-s', sub)); hero.append(d); return d; };
  stat('Desk value', '$' + p.equity.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 'cash plus open positions at the latest price', cls);
  { const d = stat('Gain since day one', usdS(gain), `peak value $${Math.round(p.peakEq).toLocaleString('en')}${p.belowPeakPct > 0.05 ? `, now ${p.belowPeakPct.toFixed(1)}% below it` : ', at its peak'}`, cls); d.querySelector('.dk-v').append(el('span', 'dk-pct', ' ' + pct(p.retPct, 1))); }
  stat('Started with', '$' + p.start.toLocaleString('en', { minimumFractionDigits: 2 }), p.firstAt ? 'first trade ' + whenS(p.firstAt) : 'paper money');
  host.append(hero);
  const hero2 = el('div', 'dk-hero dk-hero2'), st2 = (k, v, sub, c) => { const d = el('div', 'dk-stat'); d.append(el('div', 'dk-k', k), el('div', 'dk-v ' + (c || ''), v), el('div', 'dk-s', sub)); hero2.append(d); };
  st2('Closed trades', usdS(p.realized), `${p.closedN} closed${p.winRate != null ? ' · ' + Math.round(p.winRate * 100) + '% won' : ''}`, p.realized > 0 ? 'pos' : p.realized < 0 ? 'neg' : '');
  st2('Open trades', usdS(p.openPnl), `${usd0(p.openBanked)} already banked · ${usd0(p.openValue)} still held`, p.openPnl > 0 ? 'pos' : p.openPnl < 0 ? 'neg' : '');
  st2('At risk now', p.openRisk > 0.5 ? '−' + usd0(p.openRisk) : '$0', p.openN ? 'if every open stop hit from here' : 'nothing open');
  st2('Worst drawdown', p.closedN ? '−' + p.maxDD.toFixed(1) + '%' : '—', p.losingRun ? `longest losing run ${p.losingRun}` : 'from the highest value');
  host.append(hero2);
  host.append(el('p', p.check ? 'dk-ok' : 'dk-bad', p.check ? '✓ Self-check passed: cash plus open positions equals the desk value.' : '✗ Self-check failed: the figures above do not add up.'));
  const open = p.trades.filter((t) => t.open);
  host.append(el('div', 'dk-h', `OPEN POSITIONS  ${open.length} open · ${usdS(p.openPnl)} open ${p.openPnl >= 0 ? 'profit' : 'loss'}`));
  if (!open.length) host.append(el('p', 'empty', p.trades.length ? 'No position is open right now.' : 'Nothing has been bought yet.' + (p.waitingN ? ' Waiting for entry: ' + p.waitingN + '.' : '')));
  open.forEach((t) => { const c = el('div', 'dk-trade'), L = el('div', 'dk-l'), nm = el('div', 'dk-nm');
    if (t.pool) nm.append(dexLink({ coin: t.coin, chain: t.chain, pool: t.pool }, 'coinlink', t.coin)); else nm.append(t.coin); nm.append(el('span', 'dk-tag', t.chain));
    const soldPct = Math.round((1 - t.rem) * 100), badge = t.locked != null && t.locked >= 0 && soldPct > 0 ? 'PROFIT LOCKED' : soldPct > 0 ? `${soldPct}% SOLD` : t.pnl >= 0 ? 'IN PROFIT' : 'UNDER WATER';
    L.append(nm, el('div', 'dk-meta', t.setup || '—'), el('span', 'dk-badge ' + (t.pnl >= 0 ? 'up' : 'down'), badge));
    const M = el('div', 'dk-m'); M.append(el('div', 'dk-pnl ' + (t.pnl >= 0 ? 'pos' : 'neg'), usdS(t.pnl)), el('div', 'dk-meta', `${pct(t.pnlPct, 1)} P&L`));
    const G = el('div', 'dk-g'); const kv = (k, v, sub) => { const d = el('div'); d.append(el('div', 'dk-k', k), el('div', 'dk-kv', v)); if (sub) d.append(el('div', 'dk-meta', sub)); G.append(d); };
    const move = t.entryPx && t.nowPx ? (t.nowPx / t.entryPx - 1) * 100 : null;
    kv('Position size', usd0(t.size), `${t.sharePct.toFixed(1)}% of the start · ${since0(t.entryAt)}`);
    kv('Entry', fpx(t.entryPx), 'fill after slippage');
    kv('Now', fpx(t.nowPx), move != null ? pct(move, 1) + ' vs entry' : '');
    kv('Banked', usd0(t.banked), soldPct ? `${soldPct}% of the position sold` : 'nothing sold yet');
    kv('Current risk', t.riskNow > 0.5 ? '−' + usd0(t.riskNow) : '$0', `if the stop at ${fpx(t.stopNow)} hits${t.locked != null ? ', the trade ' + (t.locked >= 0 ? 'still makes ' + usdS(t.locked) : 'ends at ' + usdS(t.locked)) : ''}`);
    kv('Position value', usd0(t.value), `${100 - soldPct}% still held`);
    kv('P&L', usdS(t.pnl), `${pct(t.pnlPct, 1)} · banked plus value minus cost`);
    { const lad = el('div', 'dk-chips dk-wide'); (t.ladder || []).forEach(([m, fr], i) => { const done = i < (t.tpHit || 0); lad.append(el('span', 'dk-chip ' + (done ? 'ok' : ''), `${done ? '✓' : '○'} ${Math.round(fr * 100)}% at ${Math.round(m * 100) / 100}x${t.entryPx ? ' (' + fpx(t.entryPx * m) + ')' : ''}`)); }); if (t.trailPct) lad.append(el('span', 'dk-chip', `after the first sale the rest trails ${Math.round(t.trailPct * 100)}% below the high`)); if (lad.childNodes.length) G.append(lad); }
    if (o.extra) o.extra(t, G);
    c.append(L, M, G); host.append(c); });
  if (p.waiting.length) { host.append(el('div', 'dk-h', `WAITING FOR ENTRY  ${p.waiting.length}`)); const u = el('div', 'dk-wait');
    p.waiting.slice(0, 12).forEach((w) => { const r = el('div', 'dk-wrow'); r.append(el('b', null, w.coin), el('span', 'dk-tag', w.chain), el('span', 'dk-meta', `${w.setup || ''} · ${w.entryLow != null && w.entryHigh != null && w.entryLow !== w.entryHigh ? 'buy ' + fpx(w.entryLow) + ' to ' + fpx(w.entryHigh) + (w.stop ? ' · stop ' + fpx(w.stop) : '') : 'buys at the next candle open'} · called ${whenS(w.at)}`)); u.append(r); }); host.append(u); }
  if (p.curve.length >= 2) {
    const W = 640, H = 130, P = 44, pts = p.curve, lo = Math.min(...pts.map((c) => c.eq), p.start), hi = Math.max(...pts.map((c) => c.eq), p.start), sp = hi - lo || 1, x = (i) => P + (W - P - 8) * i / (pts.length - 1), y = (v) => 10 + (H - 24) * (1 - (v - lo) / sp);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': 'Paper account value over time' });
    svg.append(sv('line', { x1: P, x2: W - 8, y1: y(p.start), y2: y(p.start), stroke: '#ececec', 'stroke-opacity': .5, 'stroke-dasharray': '4 4' }), sv('text', { x: 2, y: y(p.start) + 3, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(p.start)));
    svg.append(sv('text', { x: 2, y: 12, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(hi)), sv('text', { x: 2, y: H - 14, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(lo)));
    svg.append(sv('polyline', { points: pts.map((c, i) => `${x(i)},${y(c.eq)}`).join(' '), fill: 'none', stroke: p.equity >= p.start ? '#34d399' : '#f87171', 'stroke-width': 2.2 }));
    host.append(el('div', 'dk-h', 'DESK VALUE OVER TIME'), svg);
  }
  host.append(el('div', 'dk-h', 'MORE DETAIL  click a row to open it'));
  const fold = (title, sub, build) => { const d = el('details', 'dk-fold'), sm = el('summary'); sm.append(el('b', null, title), el('span', 'dk-meta', ' ' + sub)); d.append(sm); build(d); host.append(d); };
  const done = p.trades.filter((t) => !t.open);
  fold('Closed trades', `${done.length} closed · ${usdS(p.realized)}${p.winRate != null ? ' · ' + Math.round(p.winRate * 100) + '% won' : ''}${p.avgRet != null ? ' · ' + pct(p.avgRet, 1) + ' average per trade' : ''}`, (d) => {
    if (!done.length) { d.append(el('p', 'empty', 'Nothing has closed yet.')); return; }
    const tbl = el('table', 'tbl'), th = el('tr'); ['Opened', 'Coin', 'Size', 'Entry', 'Avg exit', 'Sold for', 'P&L', 'How it ended'].forEach((h, i) => th.append(el('th', i > 1 && i < 7 ? 'n' : null, h))); const hd = el('thead'); hd.append(th); tbl.append(hd);
    const tb = el('tbody'); done.slice(0, 60).forEach((t) => { const tr = el('tr'); tr.append(el('td', null, (t.at || '').slice(5, 16).replace('T', ' ')), coinCell({ coin: t.coin, chain: t.chain, pool: t.pool }, true), el('td', 'n', usd0(t.size)), el('td', 'n', fpx(t.entryPx)), el('td', 'n', fpx(t.exitAvg)), el('td', 'n', usd0(t.banked)), el('td', 'n ' + (t.pnl >= 0 ? 'pos' : 'neg'), `${usdS(t.pnl)} (${pct(t.pnlPct, 0)})`), el('td', null, t.status || '—')); tb.append(tr); });
    tbl.append(tb); const sc = el('div', 'scroll'); sc.append(tbl); d.append(sc); });
  if (p.bySetup.length > 1) fold('By setup', 'which setups made or lost the money', (d) => { const u = el('ul', 'note'); p.bySetup.forEach((g) => u.append(el('li', null, `${g.setup}: ${usdS(g.pnl)} over ${g.n} trade${g.n === 1 ? '' : 's'} (${g.closed} closed${g.closed ? ', ' + Math.round(g.wins / g.closed * 100) + '% won' : ''}).`))); d.append(u); });
  fold('How this book works', 'entries, exits, sizing and what it leaves out', (d) => { const u = el('ul', 'note'); o.notes.forEach((t) => u.append(el('li', null, t))); d.append(u); });
}
const since0 = (iso) => { const t = Date.parse(iso || ''); if (!isFinite(t)) return ''; const h = (Date.now() - t) / 3600e3; return 'opened ' + (h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago'); };
// ---- live price action for the runners (hourly candles from the scan, refreshed in this page from the free GeckoTerminal feed) ----
const RT = { tf: '1h' };
function aggBars(bars, tf) { if (tf !== '4h') return bars; const g = new Map(); for (const b of bars) { const k = Math.floor(b[0] / 14400); const x = g.get(k); if (!x) g.set(k, [k * 14400, b[1], b[2], b[3], b[4]]); else { x[2] = Math.max(x[2], b[2]); x[3] = Math.min(x[3], b[3]); x[4] = b[4]; } } return [...g.values()]; }
function candleSvg(bars, ref) {
  const W = 320, H = 120, P = 4, n = bars.length; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'rn-svg'); svg.setAttribute('role', 'img');
  if (n < 3) return svg; const hi = Math.max(...bars.map((b) => b[2]), ref || 0), lo = Math.min(...bars.map((b) => b[3]), ref || Infinity), y = (v) => P + (H - 2 * P) * (1 - (v - lo) / (hi - lo || 1)), step = (W - 2 * P) / n, w = Math.max(1.5, step * 0.62);
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
  if (ref) mk('line', { x1: P, x2: W - P, y1: y(ref), y2: y(ref), stroke: '#9a9a9a', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .7 });
  bars.forEach((b, i) => { const x = P + step * (i + 0.5), up = b[4] >= b[1], col = up ? '#34d399' : '#f87171'; mk('line', { x1: x, x2: x, y1: y(b[2]), y2: y(b[3]), stroke: col, 'stroke-width': 1 }); mk('rect', { x: x - w / 2, y: Math.min(y(b[1]), y(b[4])), width: w, height: Math.max(1, Math.abs(y(b[1]) - y(b[4]))), fill: col }); });
  return svg;
}
function paintRunner(pool) {
  const o = S.rcards.get(pool); if (!o) return; const bars = o.bars, last = bars.length ? bars[bars.length - 1][4] : null, r = o.r, ref = +r.price || null;
  o.live.replaceChildren();
  if (last != null && ref) { const d = (last / ref - 1) * 100; o.live.append(el('span', 'rn-dot' + (o.liveAt ? ' on' : '')), document.createTextNode(`${o.liveAt ? 'Live' : 'At scan'} ${fp(last)} · ${d >= 0 ? '+' : ''}${d.toFixed(1)}% since the scan priced it at ${fp(ref)}${o.liveAt ? ' · updated ' + new Date(o.liveAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''}`)); }
  else o.live.append(document.createTextNode('No price history for this coin yet.'));
  o.ch.replaceChildren(); const agg = aggBars(bars, RT.tf); o.ch.append(candleSvg(agg, ref));
  o.ch.append(el('div', 'dk-meta', `${RT.tf === '4h' ? '4-hour' : 'Hourly'} candles, last ${agg.length}. Dashed line = price when the scan listed it.`));
}
const RNET = { solana: 'solana', ethereum: 'ethereum', robinhood: 'robinhood' };
let rliveTimer = null, rliveBusy = false, rliveIdx = 0, rliveBackoff = 0;
async function runnerLiveTick() {
  if (rliveBusy || document.hidden) return; const sec = $('runners'); if (!sec) return; const rc = sec.getBoundingClientRect(); if (rc.bottom < -200 || rc.top > innerHeight + 400) return;
  if (rliveBackoff > Date.now()) return; const ids = [...S.rcards.keys()]; if (!ids.length) return; rliveBusy = true;
  try { const pool = ids[rliveIdx++ % ids.length], o = S.rcards.get(pool), net = (o.r.net || '').toLowerCase(); if (!net) return;
    const res = await fetch(`${GT}/networks/${net}/pools/${pool}/ohlcv/hour?aggregate=1&limit=72&currency=usd&token=base`, { headers: { accept: 'application/json;version=20230302' } });
    if (res.status === 429) { rliveBackoff = Date.now() + 60000; return; } if (!res.ok) return; const j = await res.json(), raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list;
    if (Array.isArray(raw) && raw.length > 3) { o.bars = raw.slice().sort((a, b) => a[0] - b[0]).map((q) => q.slice(0, 5).map(Number)); o.liveAt = Date.now(); paintRunner(pool); } } catch { /* keep the scan's chart */ } finally { rliveBusy = false; }
}
function startRunnerLive() { if (rliveTimer) return; rliveTimer = setInterval(runnerLiveTick, 5000); setTimeout(runnerLiveTick, 800); }
const shortW = (w) => String(w).slice(0, 4) + '…' + String(w).slice(-4);
function drawScorecard() {
  let box = $('wsBox'); if (!box) { const l = $('runList'); if (!l || !l.parentNode) return; box = el('div'); box.id = 'wsBox'; l.parentNode.append(box); } box.replaceChildren(); const W = S.wscore; if (!W) return;
  const E = Array.isArray(W.early) ? W.early : [];
  box.append(el('div', 'dk-h', `EARLY MOVERS  trending in the last 1h or 6h, not on the runners list yet${W.at ? ' · ' + whenS(W.at) : ''}`));
  if (!E.length) box.append(el('p', 'empty', 'None on the last full scan.'));
  else { const u = el('div', 'dk-wait'); E.slice(0, 10).forEach((e) => { const r = el('div', 'dk-wrow'); r.append(dexLink({ coin: e.coin, chain: e.chain, pool: e.pool }, 'coinlink', e.coin), el('span', 'dk-tag', e.chain),
      el('span', 'dk-meta', `${e.provenIn ? '★ ' + e.provenIn + ' proven buying · ' : ''}${e.provenOut ? e.provenOut + ' proven selling · ' : ''}24h ${e.ch24 != null ? pct(e.ch24, 0) : '—'} · volume ${e.vacc != null ? e.vacc.toFixed(1) + 'x normal' : '—'} · ${e.buyers} buyers vs ${e.sellers} sellers · liquidity ${usd0(e.liq)} · ${e.phase || ''}${e.veto && e.veto.length ? ' · risk: ' + e.veto[0] : ''}`)); u.append(r); }); box.append(u); }
  const d = el('details', 'dk-fold'), sm = el('summary'), P = Array.isArray(W.proven) ? W.proven : [];
  sm.append(el('b', null, 'Wallet scorecard'), el('span', 'dk-meta', ` ${P.length} proven wallet${P.length === 1 ? '' : 's'} · ${W.resolved} of ${W.episodes} coin-days have an outcome${W.base != null ? ' · average run rate ' + Math.round(W.base * 100) + '%' : ''}${W.bots ? ' · ' + W.bots + ' bot wallets ignored' : ''}`)); d.append(sm);
  const u = el('ul', 'note'); [W.rule, 'Built only from what the scanner sees: each full scan reads the recent trades of the runners and early movers and remembers who was buying. No X, no paid feed.', 'Proven wallets count as smart wallets everywhere: buying shows as ★ on a runner, selling drops it from the list (they may be using buyers as exit liquidity). The "Follow proven wallets" paper book tests whether copying them pays.', 'Expect nothing for the first 2 to 3 weeks: a wallet needs at least 3 coins with a known outcome before it can be judged.'].forEach((t) => u.append(el('li', null, t))); d.append(u);
  if (P.length) { const t = el('table', 'tbl'), h = el('tr'); ['Wallet', 'Coins', 'Ran', 'Run rate (smoothed)', 'Avg peak'].forEach((x, i) => h.append(el('th', i ? 'n' : null, x))); const hd = el('thead'); hd.append(h); t.append(hd); const tb = el('tbody');
    P.slice(0, 25).forEach((r) => { const tr = el('tr'), td = el('td', null, shortW(r.w)); td.title = r.w; tr.append(td, el('td', 'n', String(r.n)), el('td', 'n', String(r.wins)), el('td', 'n', Math.round(r.est * 100) + '%'), el('td', 'n', '+' + r.avgPeak + '%')); tb.append(tr); }); t.append(tb); const sc = el('div', 'scroll'); sc.append(t); d.append(sc); }
  else if (Array.isArray(W.candidates) && W.candidates.length) d.append(el('p', 'meta', 'Closest so far: ' + W.candidates.slice(0, 5).map((r) => `${shortW(r.w)} ${r.wins} of ${r.n}`).join(' · ') + '.'));
  box.append(d);
}
function drawRunners() {
  const prevC = S.rcards || new Map(); S.rcards = new Map(); startRunnerLive(); { let ctl = $('runCtl'); if (!ctl) { ctl = el('p', 'dk-meta'); ctl.id = 'runCtl'; const l = $('runList'); if (l && l.parentNode) l.parentNode.insertBefore(ctl, l); } ctl.replaceChildren(document.createTextNode('Chart candles: ')); ['1h', '4h'].forEach((k) => { const b = el('button', 'dk-tab' + (RT.tf === k ? ' on' : ''), k); b.type = 'button'; b.addEventListener('click', () => { RT.tf = k; S.rcards.forEach((_, pool) => paintRunner(pool)); ctl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.textContent === k)); }); ctl.append(b); }); ctl.append(document.createTextNode(' Prices refresh live in this page while the section is on screen.')); }
    const host = $('runList'), em = $('runEmpty'); if (!host) return; host.replaceChildren(); const R = S.runners, all = R && Array.isArray(R.items) ? R.items : [], items = all.filter((r) => !(r.vetoed && r.vetoed.length)), dropped = all.filter((r) => r.vetoed && r.vetoed.length);
  em.hidden = false;
  if (!all.length) { em.textContent = 'No coin is showing a high-volume run with buyers leading right now. This fills on each full scan.'; return; }
  em.textContent = 'As of ' + whenS(R.at) + '. ' + items.length + ' coin' + (items.length === 1 ? '' : 's') + ' listed' + (dropped.length ? ', ' + dropped.length + ' dropped by the risk rules.' : '.');
  const full = items.filter((r) => r.passed >= 3 || (r.proven && r.proven.in)), slim = items.filter((r) => !full.includes(r));
  if (!full.length) host.append(el('p', 'empty', 'No runner passes 3 or 4 of the checks right now. The weaker ones are listed below.'));
  full.forEach((r) => { const c = el('div', 'plan'), t = el('div', 't'), nm = el('b'); nm.append(dexLink({ coin: r.coin, chain: r.chain, pool: r.pool }, 'coinlink', r.coin)); nm.append(el('span', 'dk-tag', r.chain)); t.append(nm, el('span', 'badge ' + (r.passed >= 4 ? 'pos' : ''), `${r.tier} · ${r.passed} of 4 checks`)); c.append(t);
    { const live = el('p', 'dk-meta rn-live'), ch = el('div', 'rn-chart'); c.append(live, ch); { const pv = prevC.get(r.pool); S.rcards.set(r.pool, { r, live, ch, bars: pv && pv.liveAt ? pv.bars : Array.isArray(r.bars) ? r.bars : [], liveAt: pv && pv.liveAt ? pv.liveAt : null }); } paintRunner(r.pool); }
    const ck = el('div', 'dk-chips'); (r.checks || []).forEach((x) => ck.append(el('span', 'dk-chip ' + (x.ok === true ? 'ok' : x.ok === false ? 'no' : ''), (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '? ') + x.k)));
    if (r.proven && r.proven.in) ck.append(el('span', 'dk-chip ok', `★ ${r.proven.in} proven wallet${r.proven.in === 1 ? '' : 's'} buying`)); if (r.proven && r.proven.out) ck.append(el('span', 'dk-chip no', `${r.proven.out} proven wallet${r.proven.out === 1 ? '' : 's'} selling`)); if (r.phase) ck.append(el('span', 'dk-chip', r.phase)); if (r.fresh) ck.append(el('span', 'dk-chip', 'trending 1h/6h')); c.append(ck);
    const dd = el('details', 'dk-fold rn-more'), ds = el('summary', null, 'Numbers'); dd.append(ds); const u = el('ul', 'note'); (r.checks || []).forEach((x) => u.append(el('li', null, `${x.k}: ${x.note}`))); const m = r.m || {}; u.append(el('li', null, `24h ${m.ch24 != null ? (m.ch24 >= 0 ? '+' : '') + m.ch24.toFixed(0) + '%' : '—'} · liquidity ${usd0(m.liq || 0)}${m.ageD != null ? ' · ' + m.ageD.toFixed(1) + ' days old' : ''}${r.hs && r.hs.holders != null ? ' · ' + Number(r.hs.holders).toLocaleString('en') + ' holders' : ''}${r.hs && r.hs.top10 != null ? ', top 10 hold ' + Math.round(r.hs.top10) + '%' : ''}${r.paper ? ' · in the degen paper desk' : ''}`)); dd.append(u); c.append(dd);
    if (r.flags && r.flags.length) c.append(el('p', 'caut', 'Watch out: ' + r.flags.join(' · '))); host.append(c); });
  if (slim.length) { const d = el('details', 'dk-fold dk-wide-d'), sm = el('summary'); sm.append(el('b', null, 'Also on the list'), el('span', 'dk-meta', ` ${slim.length} coin${slim.length === 1 ? '' : 's'} passing 2 or fewer checks`)); d.append(sm); const u = el('div', 'dk-wait');
    slim.forEach((r) => { const m = r.m || {}, w = el('div', 'dk-wrow'); w.append(dexLink({ coin: r.coin, chain: r.chain, pool: r.pool }, 'coinlink', r.coin), el('span', 'dk-tag', r.chain), el('span', 'dk-meta', `${r.passed} of 4 checks · 24h ${m.ch24 != null ? pct(m.ch24, 0) : '—'} · volume ${m.surge != null ? (+m.surge).toFixed(1) + 'x' : '—'} · liquidity ${usd0(m.liq || 0)}${r.phase ? ' · ' + r.phase : ''}`)); u.append(w); }); d.append(u); host.append(d); }
  if (dropped.length) { const d = el('details', 'dk-fold dk-wide-d'), sm = el('summary'); sm.append(el('b', null, 'Dropped by the risk rules'), el('span', 'dk-meta', ` ${dropped.length} coin${dropped.length === 1 ? '' : 's'} still being tracked to test whether the rules help`)); d.append(sm); const u = el('ul', 'note'); dropped.forEach((r) => u.append(el('li', null, `${r.coin} (${r.chain}): ${r.vetoed.join(', ')}`))); d.append(u); host.append(d); }
}
const CONS_NOTES = ['Every bid-ready call is paper-bought with 5% of the desk value at that moment. A call only becomes a trade when the price dips into its entry zone; if that does not happen within 48 hours it is dropped and uses no money.',
  'Results are the signal log\'s own figures: stops, the three targets, a 7-day time exit and the fill slippage you set are already inside them. "Now (est.)" is worked back from the open result, not a live quote.',
  'Not modelled: gas, exit liquidity and price impact. On thin new launches the real price you get can be much worse than a paper fill, so a few big paper winners overstate what real money would have made.',
  'Until 30 or more trades have closed, a good run can be luck. Judge the rules on the Learn tab, not on a couple of runners.'];
const DEGEN_NOTES = ['High risk on purpose. A runner is paper-bought with 10% of the desk when its volume is at least 2.5x normal, it is up 10% to 400% in 24 hours, buyers are leading and it has at least $50k of liquidity. It does not wait for a chart pattern or a 4h close, so it will often buy near the top.',
  'Exits: stop 20% below entry. Half is sold at 2x and the rest trails 30% below its high (never below break-even). Everything is sold after 72 hours. Entry is the next hourly open plus 3% slippage. If one hour touches both the stop and the target, the stop is assumed to hit first.',
  'Wallet check: it counts the wallets buying and selling in the pool\'s recent trades and how much of the volume the top 3 wallets make. Leaning out or a few wallets doing most of the volume rejects the runner. The feed does not say which wallets are good traders, so "smart wallets" only means addresses you add to config/smartwallets.json.',
  'Not modelled: gas, real exit liquidity and price impact. Rugs and honeypots can make a real exit impossible, which paper money never feels. Treat this desk as a way to measure the strategy, not as a promise.'];
// ---------- paper books ----------
const SCALP_NOTES = ['The scalper decides once an hour, when the scan runs, using 5-minute candles. A trigger only counts if its candle closed in the last 10 minutes, and the buy is the next 5-minute open. A real scalping bot would watch every minute, so this tests the rules at a slow pace.',
  'Costs are the whole game in scalping: each buy and sell pays 1% slippage and fees plus the price impact of a $500 order on the pool. With targets of 4% to 8%, a round trip costs a big share of the win. That is deliberate, so the result is honest.',
  'Only liquid coins are scalped: $150k+ liquidity and $750k+ daily volume, safety check not failed, ranked by how hard volume is running. Up to 4 open per scalper. Paused automatically if the monthly data allowance passes 85%.'];
const RISKY_NOTES = ['Careful rules on risky coins: the same high-risk runners list, but a small position, a tight 10% stop and profits taken early. Up to 6 open, 4% of the desk each.',
  'Entry is the next hourly open after the coin was listed, plus 3% slippage and price impact. Exits: 40% sold at +15%, 30% at +30%, the stop moves to break-even after the first sale and the rest trails 10% below its high; anything left is sold after 24 hours. If one hour touches both the stop and a target, the stop is assumed first.',
  'Not modelled: gas, real exit liquidity on a crash, rugs and honeypots. Judge it only after 30 or more closed trades.'];
function bookPositions(key) { return key === 'bid' ? S.signals.map(fromSignal).filter(Boolean) : key === 'degen' ? S.degen.map((x) => fromRun(x, 'degen')).filter(Boolean) : (S.lab || []).filter((x) => x.book === key).map((x) => fromRun(x)).filter(Boolean); }
function bookData(key) {
  const since = S.paperCfg && S.paperCfg.since || null;
  if (BOT[key]) return botBook(Object.keys(BOOKS).flatMap((k) => bookPositions(k).map((p) => ({ ...p, src: k }))), { adaptive: BOT[key].adaptive, since });
  const B = BOOKS[key], opt = { start: 10000, pct: B.pct, slots: B.slots, since };
  if (key === 'bid') return book(S.signals.map(fromSignal).filter(Boolean), opt);
  if (key === 'degen') return book(S.degen.map((x) => fromRun(x, 'degen')).filter(Boolean), opt);
  return book((S.lab || []).filter((x) => x.book === key).map((x) => fromRun(x)).filter(Boolean), opt);
}
const PLAY_NOTES = ['Limit orders: many will expire or be cancelled when price runs without pulling back. Those use no money and do not count as trades; that is the price of not chasing.', 'Fills pay 2% slippage plus the price impact of a $1,000 order. On the candle a limit fills, only the stop is checked, never a target.', 'Not modelled: gas, real exit liquidity, rugs and honeypots. Judge a book only after 30 or more closed trades.'];
function bookNotes(key) { const B = BOOKS[key]; return key === 'bid' ? CONS_NOTES : key === 'degen' ? DEGEN_NOTES : key === 'risky' ? RISKY_NOTES : B.group === 'play' ? ['Entry: ' + B.entry, 'Exits: ' + B.exits + '.', ...PLAY_NOTES] : B.group === 'scalp' ? ['Entry: ' + B.entry, 'Exits: ' + B.exits + '.', ...SCALP_NOTES] : ['Entry: ' + B.entry, 'Exits: ' + B.exits + '.', 'Same coins, same entry times and the same 3% slippage and price impact as the degen desk, so the only difference is how it takes profit. Compare them on the Compare tab.', 'Not modelled: gas, real exit liquidity, rugs and honeypots.']; }
const degenExtra = (t, G) => { const sg = t.sig || {}, w = sg.wallet; if (sg.why && sg.why.length) G.append(el('div', 'dk-meta dk-wide', 'Why it was bought: ' + sg.why.join(' · ') + (sg.phase ? ' · ' + sg.phase : '')));
  if (sg.walletVerdict || w) G.append(el('div', 'dk-meta dk-wide', (sg.walletVerdict ? sg.walletVerdict + ': ' : '') + (w ? `${w.buyers} buyers vs ${w.sellers} sellers · top 3 wallets ${w.top3Share != null ? Math.round(w.top3Share * 100) + '%' : '—'} of volume · net ${usdS(w.netUsd)}` : 'wallets not checked yet') + (sg.walletHist && sg.walletHist.length > 1 ? ` (${sg.walletHist.length} checks)` : ''))); };
function showBook(box, key) { const B = BOOKS[key], P0 = bookData(key), ev = evidence(P0); box.append(el('p', 'dk-meta', `${B.label}. Entry: ${B.entry} Exits: ${B.exits}.`));
  { const v = el('div', 'dk-chips'); v.append(el('span', 'dk-chip ' + (VCLS[ev.verdict] || ''), 'Verdict: ' + ev.label)); if (ev.avgR != null) v.append(el('span', 'dk-chip', `${rr(ev.avgR)} a trade${ev.lo != null ? ` (90% range ${rr(ev.lo)} to ${rr(ev.hi)})` : ''}`)); if (ev.bySol && ev.bySol.length) v.append(el('span', 'dk-chip', 'SOL market at entry: ' + ev.bySol.map((x) => `${x.k} ${rr(x.avgR)} (${x.n})`).join(' · '))); if (ev.byVol && ev.byVol.length) v.append(el('span', 'dk-chip', 'Volume day: ' + ev.byVol.map((x) => `${x.k} ${rr(x.avgR)} (${x.n})`).join(' · '))); box.append(v); const hnt = exitHint(ev); if (hnt) box.append(el('p', 'tip', 'Exit check: ' + hnt)); }
  deskView(box, P0, { sizing: `${B.pct}% of the desk per trade · up to ${B.slots} open`, notes: bookNotes(key), extra: key === 'bid' ? null : degenExtra }); }
function subTabs(host, list, cur, set) { const bar = el('div', 'dk-tabs dk-sub'); list.forEach(([k, t]) => { const b = el('button', 'dk-tab' + (cur === k ? ' on' : ''), t); b.type = 'button'; b.addEventListener('click', () => { set(k); try { drawPaper(); } catch { /* keep going */ } }); bar.append(b); }); host.append(bar); }
const VCLS = { edge: 'ok', promising: 'ok', 'no edge': 'no', losing: 'no' };
const bookLabel = (k) => (BOOKS[k] || BOT[k] || {}).label || k, bookShort = (k) => (BOOKS[k] || BOT[k] || {}).short || k;
function drawEdgeBoard(box, keys, data, EV) {
  box.append(el('div', 'dk-h', 'EDGE BOARD  every book measured in R: profit divided by what the first stop would have lost'));
  const t = el('table', 'tbl dk-cmp'), h = el('tr'); ['Book', 'Closed', 'Avg R', '90% range', 'Chance > 0', 'Last 14 days', 'Minus best trade', '+1% cost', 'Days to 30', 'Verdict'].forEach((x, i) => h.append(el('th', i ? 'n' : null, x))); const hd = el('thead'); hd.append(h); t.append(hd); const tb = el('tbody');
  keys.slice().sort((a, b) => (EV.get(b).n >= 10) - (EV.get(a).n >= 10) || (EV.get(b).avgR ?? -9) - (EV.get(a).avgR ?? -9)).forEach((k) => { const e = EV.get(k), tr = el('tr', 'dk-row' + (k === S.labPick ? ' on' : '')); tr.title = 'Open this book below';
    const cR = (v) => el('td', 'n ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : ''), v == null ? '—' : rr(v));
    tr.append(el('td', null, bookLabel(k)), el('td', 'n', String(e.n)), cR(e.avgR), el('td', 'n', e.lo != null ? `${rr(e.lo)} to ${rr(e.hi)}` : '—'), el('td', 'n', e.pPos != null ? Math.round(e.pPos * 100) + '%' : '—'), e.recentN ? cR(e.recentR) : el('td', 'n', '—'), cR(e.exBestR), cR(e.stressR), el('td', 'n', e.n >= 30 ? 'done' : e.etaDays != null ? '~' + e.etaDays : '—'));
    const vd = el('td', 'n'); vd.append(el('span', 'dk-chip ' + (VCLS[e.verdict] || ''), e.label)); tr.append(vd); tr.addEventListener('click', () => { if (BOT[k]) { S.deskTab = 'bot'; S.botSub = k; } else S.labPick = k; drawPaper(); }); tb.append(tr); });
  t.append(tb); const sc = el('div', 'scroll'); sc.append(t); box.append(sc);
  box.append(el('p', 'meta', 'How to read it: an edge candidate needs 30+ closed trades, a 90% range entirely above zero, a positive average without its single best trade, and a positive average when every trade pays 1% more in costs (+1% cost). Last 14 days shows whether it still works now, because meme setups rotate. Days to 30 is the estimate at the pace so far. The two bot rows trade every book through one risk-sized account (Bot sim tab).'));
}
const foldBox = (host, title, sub) => { const d = el('details', 'dk-fold'), sm = el('summary'); sm.append(el('b', null, title), el('span', 'dk-meta', ' ' + sub)); d.append(sm); host.append(d); return d; };
function showBot(box, key) {
  const R = BOT_RULES, p = bookData(key), ev = evidence(p), sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  box.append(el('p', 'tip', `${BOT[key].label}. One $${R.start.toLocaleString('en')} account takes the signals of all ${Object.keys(BOOKS).length} books the way a real bot should: every trade risks ${R.riskPct}% of the account at its first stop, so a wide stop buys a small position and a tight stop a bigger one.${BOT[key].adaptive ? ` It only takes a book's signals while that book's last ${R.adaptWindow} closed trades average above zero (at least ${R.adaptMin} needed), judged only on trades that closed before the signal, so it never peeks ahead.` : ''}`));
  const v = el('div', 'dk-chips'); [`${R.riskPct}% risk a trade`, `per coin: ${R.coinRiskPct}% risk and ${R.coinValuePct}% of the account at most`, `no more than ${R.liqPct}% of a pool's liquidity`, `${R.maxOpenRiskPct}% total open risk`, `stops for the day after -${R.dayLossPct}%`].forEach((t) => v.append(el('span', 'dk-chip', t)));
  v.append(el('span', 'dk-chip ' + (VCLS[ev.verdict] || ''), 'Verdict: ' + ev.label)); box.append(v);
  const ul = el('ul', 'note'); ul.append(el('li', null, `${p.takenN} trades taken, ${sum(p.cutWhy)} made smaller by a limit${sum(p.cutWhy) ? ' (' + Object.entries(p.cutWhy).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''}, ${p.skipped} skipped${p.skipped ? ' (' + Object.entries(p.skipWhy).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''}.`));
  if (p.stacked && p.stacked.length) ul.append(el('li', null, 'Same coin from more than one book right now: ' + p.stacked.map((x) => `${x.coin} (${x.books.map(bookShort).join(' + ')}, ${usd0(x.value)} held, ${usd0(x.risk)} at risk)`).join('; ') + '. The per-coin limits keep these together under one cap.'));
  box.append(ul);
  if (p.bySource && p.bySource.length) { const t = el('table', 'tbl'), h = el('tr'); ['Signals from', 'Trades', 'Closed', 'P&L', 'Risked at entry'].forEach((x, i) => h.append(el('th', i ? 'n' : null, x))); const hd = el('thead'); hd.append(h); t.append(hd); const tb = el('tbody');
    p.bySource.forEach((g) => { const tr = el('tr'); tr.append(el('td', null, bookLabel(g.src)), el('td', 'n', String(g.n)), el('td', 'n', String(g.closed)), el('td', 'n ' + (g.pnl > 0 ? 'pos' : g.pnl < 0 ? 'neg' : ''), usdS(g.pnl)), el('td', 'n', usd0(g.risk))); tb.append(tr); }); t.append(tb);
    const f = foldBox(box, 'Where the money came from', 'P&L by the book that gave the signal'); const sc = el('div', 'scroll'); sc.append(t); f.append(sc); }
  deskView(box, p, { sizing: `${R.riskPct}% of the account at risk per trade · sized by stop distance`, notes: ['Open positions below are what a live bot would be holding now, with the stop it would have resting and the targets it would sell into.', 'Sizing by risk means a stop-out costs about the same everywhere (about -1R), so the results compare fairly with the edge board.', 'Paper only. A live bot would also need a wallet only it can use, a kill switch, rug and honeypot checks before every buy, and alerts on every order. Private keys belong only in your own secret store.', 'Not modelled: gas, real exit liquidity in a crash, rugs and honeypots.'], extra: degenExtra });
}
function drawCompare(box) {
  const keys = Object.keys(BOOKS), data = new Map(keys.map((k) => [k, bookData(k)])), pick = S.labPick && BOOKS[S.labPick] ? S.labPick : 'degen';
  const bk = Object.keys(BOT); bk.forEach((k) => data.set(k, bookData(k))); const EV = new Map([...keys, ...bk].map((k) => [k, evidence(data.get(k))]));
  drawEdgeBoard(box, [...keys, ...bk], data, EV);
  const f1 = foldBox(box, 'Dollar results per book', 'desk P&L, win rate, drawdown and losing runs at each book\'s own size');
  f1.append(el('p', 'tip', 'Every paper approach side by side, each with its own $10,000. The four degen books buy exactly the same coins at the same times, so the only difference between them is how they take profit and where the stop sits. That makes them a fair test of exits. Rankings mean little until a book has 30 or more closed trades.'));
  const tbl = el('table', 'tbl dk-cmp'), th = el('tr'); ['Book', 'Closed / open', 'Won', 'Avg per trade', 'Desk P&L', 'Worst drawdown', 'Losing run', 'Best / worst', 'Evidence'].forEach((h, i) => th.append(el('th', i ? 'n' : null, h))); const hd = el('thead'); hd.append(th); tbl.append(hd);
  const tb = el('tbody'), grp = (t) => { const tr = el('tr', 'dk-grp'), td = el('td', null, t); td.colSpan = 9; tr.append(td); tb.append(tr); };
  const row = (k) => { const p = data.get(k), B = BOOKS[k], tr = el('tr', 'dk-row' + (k === pick ? ' on' : '')), g = p.equity - p.start; tr.title = 'Open this book below';
    tr.append(el('td', null, B.label), el('td', 'n', `${p.closedN} / ${p.openN}`), el('td', 'n', p.winRate != null ? Math.round(p.winRate * 100) + '%' : '—'), el('td', 'n ' + (p.avgRet > 0 ? 'pos' : p.avgRet < 0 ? 'neg' : ''), pct(p.avgRet, 1)), el('td', 'n ' + (g > 0 ? 'pos' : g < 0 ? 'neg' : ''), `${usdS(g)} (${pct(p.retPct, 1)})`),
      el('td', 'n', p.closedN ? '−' + p.maxDD.toFixed(1) + '%' : '—'), el('td', 'n', p.closedN ? String(p.losingRun) : '—'), el('td', 'n', p.closedN ? `${pct(p.best, 0)} / ${pct(p.worst, 0)}` : '—'), el('td', 'n', p.closedN >= 30 ? 'enough to judge' : `${p.closedN} of 30`));
    tr.addEventListener('click', () => { S.labPick = k; drawPaper(); }); tb.append(tr); };
  grp('Same degen coins, different exits'); keys.filter((k) => BOOKS[k].same === 'degen').forEach(row);
  grp('Playbook setups: buy the pullback, not the pump'); ['fibPull', 'patInside', 'proven'].forEach(row);
  grp('Conservative'); ['bid', 'risky'].forEach(row); grp('Scalpers (5-minute candles)'); ['scalpBreak', 'scalpDip'].forEach(row);
  tbl.append(tb); const sc = el('div', 'scroll'); sc.append(tbl); f1.append(sc);
  const dg = keys.filter((k) => BOOKS[k].same === 'degen').map((k) => [k, data.get(k)]).filter(([, p]) => p.closedN >= 30).sort((a, b) => b[1].retPct - a[1].retPct);
  f1.append(el('p', 'meta', dg.length >= 2 ? `Best degen exit so far: ${BOOKS[dg[0][0]].label} at ${pct(dg[0][1].retPct, 1)}, against ${pct(data.get('degen').retPct, 1)} for the current exits. Check it holds on the next 30 trades before switching.` : 'No degen exit has 30 closed trades yet, so no exit can be called better. Keep collecting.'));
  // position size: same trades booked at different sizes
  { const sizes = [5, 10, 20, 30], P = pick === 'bid' ? S.signals.map(fromSignal).filter(Boolean) : pick === 'degen' ? S.degen.map((x) => fromRun(x, 'degen')).filter(Boolean) : (S.lab || []).filter((x) => x.book === pick).map((x) => fromRun(x)).filter(Boolean);
    const f2 = foldBox(box, 'What if this book risked more?', `${BOOKS[pick].short}: the same trades at 5%, 10%, 20% and 30% of the desk`);
    const t2 = el('table', 'tbl'), h2 = el('tr'); ['Size per trade', 'Desk value now', 'Return', 'Worst drawdown', 'Skipped (no cash or slots)'].forEach((h, i) => h2.append(el('th', i ? 'n' : null, h))); const d2 = el('thead'); d2.append(h2); t2.append(d2); const b2 = el('tbody');
    sizes.forEach((sz) => { const q = book(P, { start: 10000, pct: sz, slots: BOOKS[pick].slots, since: S.paperCfg && S.paperCfg.since || null }), tr = el('tr'); tr.append(el('td', null, sz + '% of the desk' + (sz === BOOKS[pick].pct ? ' (current)' : '')), el('td', 'n', usd0(q.equity)), el('td', 'n ' + (q.retPct > 0 ? 'pos' : q.retPct < 0 ? 'neg' : ''), pct(q.retPct, 1)), el('td', 'n', q.closedN ? '−' + q.maxDD.toFixed(1) + '%' : '—'), el('td', 'n', String(q.skipped))); b2.append(tr); });
    t2.append(b2); const s2 = el('div', 'scroll'); s2.append(t2); f2.append(s2);
    f2.append(el('p', 'meta', 'Bigger size multiplies the wins and the drawdowns by about the same amount; it does not create an edge. If the book is losing, more size loses faster. A common rule is to size so the worst run of losses seen so far, plus a few more, would cost no more than a quarter of the desk.')); }
  { const ex = S.learned && S.learned.runners && Array.isArray(S.learned.runners.exits) ? S.learned.runners.exits : []; const f3 = foldBox(box, 'Exit rules on every logged runner', 'bigger sample, from the weekly study');
    if (ex.length) { const u = el('ul', 'note'); ex.slice(0, 11).forEach((x) => u.append(el('li', null, `${x.name}: ${pct(x.avgRet, 1)} average over ${x.n} trades`))); f3.append(u); } else f3.append(el('p', 'empty', 'Fills in once 8 or more logged runners have had 7 days to play out under every exit rule and the weekly backtest has run.')); }
  box.append(el('div', 'dk-h', `OPEN BOOK  ${BOOKS[pick].label}  (click a row above to switch)`)); showBook(box, pick);
  const fd = el('details', 'dk-fold'), fs = el('summary'); fs.append(el('b', null, 'From paper to an auto-trading bot'), el('span', 'dk-meta', ' what has to be true first')); fd.append(fs);
  const u = el('ul', 'note'); ['Every book here is written as an entry rule plus an exit profile in one file (docs/strategies.mjs and docs/exits.mjs). A bot would run the same rules and place real orders instead of paper fills, so whatever wins here is what a bot would trade.',
    'Before any real money: a book needs 30+ closed trades, a positive result that survives the extra-cost test, and the same result in the locked test period. Then a small live test with the real-fills log, to measure what paper misses.',
    'A live bot also needs things paper never does: a wallet only it can use with a small balance, hard daily loss limits, a kill switch, rug and honeypot checks before every buy, and alerts for every order. Private keys would live only in your own secret store, never in this repo or a chat.'].forEach((t) => u.append(el('li', null, t))); fd.append(u); box.append(fd);
}
function drawPaper() {
  const host = $('paperOut'); if (!host) return; host.replaceChildren();
  const since = S.paperCfg && S.paperCfg.since || null, tab = ['cons', 'degen', 'play', 'scalp', 'bot', 'lab'].includes(S.deskTab) ? S.deskTab : 'cons';
  const bar = el('div', 'dk-tabs'); [['cons', 'Conservative'], ['degen', 'Degen'], ['play', 'Playbook'], ['scalp', 'Scalper'], ['bot', 'Bot sim'], ['lab', 'Compare all']].forEach(([k, t]) => { const b = el('button', 'dk-tab' + (tab === k ? ' on' : ''), t); b.type = 'button'; b.addEventListener('click', () => { S.deskTab = k; try { drawPaper(); } catch { /* keep going */ } }); bar.append(b); });
  host.append(bar); if (since) host.append(el('p', 'dk-meta dk-since', 'Every book started fresh on ' + whenS(since) + '. Older paper trades are hidden.'));
  const box = el('div'); host.append(box);
  if (tab === 'cons') { const sub = S.consSub === 'risky' ? 'risky' : 'bid'; subTabs(box, [['bid', 'Bid-ready setups'], ['risky', 'Risky coins']], sub, (k) => { S.consSub = k; }); showBook(box, sub); }
  else if (tab === 'degen') { showBook(box, 'degen'); box.append(el('p', 'meta', 'The same coins are also run with three other exit plans (ladder, moonbag, tight). See them side by side on the Compare all tab.')); }
  else if (tab === 'play') { const sub = ['fibPull', 'patInside', 'proven'].includes(S.playSub) ? S.playSub : 'fibPull'; subTabs(box, [['fibPull', 'Fib pullback'], ['patInside', 'Inside the pattern'], ['proven', 'Proven wallets']], sub, (k) => { S.playSub = k; }); showBook(box, sub); }
  else if (tab === 'bot') { const sub = BOT[S.botSub] ? S.botSub : 'botAll'; subTabs(box, [['botAll', 'Every book'], ['botAdapt', 'Only books that are working']], sub, (k) => { S.botSub = k; }); showBot(box, sub); }
  else if (tab === 'scalp') { const sub = S.scalpSub === 'scalpDip' ? 'scalpDip' : 'scalpBreak'; subTabs(box, [['scalpBreak', 'Breakout'], ['scalpDip', 'Dip-buy']], sub, (k) => { S.scalpSub = k; }); showBook(box, sub); }
  else drawCompare(box);
  const f = fwdSummary(S.fwd);
  { const sh = (Array.isArray(S.fwd) ? S.fwd : []).filter((x) => x && x.shadow), cl = sh.filter((x) => x.resultR != null && x.status !== 'expired (no fill)'); if (sh.length) host.append(el('p', 'meta', `Background tracking of candidate patterns that are not live: ${sh.length} logged, ${cl.length} closed. Report only; nothing is switched on or off automatically.`)); }
  host.append(el('p', 'meta', f.total ? `Near-miss forward test (setups scoring 40 to 65, not shown as trades): ${f.total} logged, ${f.closed} closed` + (f.avgR != null ? `, ${rr(f.avgR)} average, ${Math.round(f.win * 100)}% won.` : '.') + ' Used by the learning loop to check whether the 65 cut-off is in the right place.' : 'Near-miss forward test: collecting. Setups scoring 40 to 65 are logged on each full scan and followed with the same rules.'));
}

// ---------- main ----------
const S = { runners: null, degen: [], paperCfg: null, deskTab: 'cons', fwd: [], setups: [], signals: [], charts: new Map(), vol: [], meta: null, bt: null, watch: new Map(), watchAt: null, learned: null, usage: null, patFilter: 'All', volChain: 'All', chain: 'All', sort: 'opp' };
// Signal log, tiles and results follow the same fresh start as the paper desks: signals before the reset date are hidden unless the toggle is on.
const logRows = () => { const since = S.paperCfg && S.paperCfg.since; return S.showOld || !since ? S.signals : S.signals.filter((s) => String(s.signalAt || '') >= since); };
const openCount = () => logRows().filter((s) => s.status === 'open' || s.status === 'waiting for entry').length;
function fill(host, rows, mk, empty, limit = 0, key = null) {
  host.replaceChildren();
  if (!rows.length) { host.append(el('p', 'empty', empty)); return; }
  const more = limit && rows.length > limit && !(S.more && S.more[key]);
  (more ? rows.slice(0, limit) : rows).forEach((r) => host.append(card(r, S.charts.get(r.id))));
  if (limit && rows.length > limit) { const b = el('button', 'dk-tab more-btn', more ? `Show all ${rows.length}` : 'Show fewer'); b.type = 'button'; b.addEventListener('click', () => { S.more = { ...(S.more || {}), [key]: !(S.more && S.more[key]) }; draw(); }); host.append(b); }
}
const byOpp = (a, b) => (b.opp ?? 0) - (a.opp ?? 0);
const distZone = (r) => { const w = S.watch.get(r.id), p = w && w.price != null ? w.price : Number(r.price); return r.entryHigh ? Math.max(0, (p / Number(r.entryHigh) - 1) * 100) : 1e9; };
const cmp = () => S.sort === 'dist' ? (a, b) => distZone(a) - distZone(b) || byOpp(a, b) : S.sort === 'risk' ? (a, b) => (a.riskPct ?? 1e9) - (b.riskPct ?? 1e9) : S.sort === 'up' ? (a, b) => (b.upsidePct ?? -1) - (a.upsidePct ?? -1) : S.sort === 'holders' ? (a, b) => (b.hs?.holders ?? -1) - (a.hs?.holders ?? -1) : S.sort === 'growth' ? (a, b) => (b.hs?.growPct ?? -1e9) - (a.hs?.growPct ?? -1e9) : byOpp;
const chainOk = (r) => S.chain === 'All' || r.chain === S.chain;

function volState(r) { return r == null ? ['—', 'na'] : r >= 1.15 ? ['Strong', 'strong'] : r >= 0.85 ? ['Normal', 'normal'] : r >= 0.6 ? ['Below normal', 'below'] : ['Poor', 'poor']; }
function drawVolume() {
  const by = {}; S.vol.forEach((d) => (by[d.chain] = by[d.chain] || []).push(d));
  const order = ['All', 'Solana', 'Robinhood', 'Ethereum'].filter((c) => by[c]);
  const grid = $('volGrid'), host = $('volChart'); grid.replaceChildren(); host.replaceChildren();
  if (!order.length) { $('volPill').textContent = '—'; $('volTip').textContent = 'Volume gauge appears after the first scan.'; return; }
  const info = {}; order.forEach((c) => { const rows = by[c].slice().sort((a, b) => b.daysAgo - a.daysAgo); const now = rows[rows.length - 1]; info[c] = { rows, now, st: volState(now.ratio) }; });
  const a = info.All || info[order[0]];
  $('volPill').textContent = `${a.st[0]} · ${Math.round((a.now.ratio ?? 0) * 100)}% of normal`; $('volPill').className = 'pill p-' + a.st[1];
  const tips = { poor: 'Tip: on-chain volume is poor today. Keep trades to none, or one small position at most; thin markets give false reversals and stops that slip.',
    below: 'Tip: on-chain volume is below normal today. Keep trades to a minimum, size down, and only act on a bid-ready coin with strong volume of its own.',
    normal: 'On-chain volume is about normal today, so signals can be traded at your usual (small) size.',
    strong: 'On-chain volume is strong today. Reversals are more likely to follow through, which is the best time to act on bid-ready coins.' };
  const others = order.filter((c) => c !== 'All').map((c) => `${c} ${info[c].st[0].toLowerCase()} (${Math.round((info[c].now.ratio ?? 0) * 100)}%)`).join(', ');
  $('volTip').textContent = (tips[a.st[1]] || '') + (others ? ' By chain: ' + others + '.' : '');
  order.forEach((c) => { const b = el('button', 'vcell chip' + (c === S.volChain ? ' on' : '')); b.type = 'button';
    const l = el('div', 'l', c === 'All' ? 'All scanned coins' : c), v = el('div', 'v', Math.round((info[c].now.ratio ?? 0) * 100) + '%');
    b.append(l, v, el('div', 'l', `${info[c].st[0]} · ${usd(info[c].now.volUsd)} in 24h · ${info[c].now.coins} coins`)); b.style.textAlign = 'left';
    b.onclick = () => { S.volChain = c; drawVolume(); }; grid.append(b); });
  const k = info[S.volChain] || a, rows = k.rows, W = 640, H = 150, pad = 28, mx = Math.max(...rows.map((d) => d.volUsd), k.now.baseline7d, 1), bw = (W - pad) / rows.length;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch' });
  rows.forEach((d, i) => { const h = (d.volUsd / mx) * (H - 30), st = volState(d.ratio)[1], col = { strong: '#34d399', normal: '#e0e1e0', below: '#ee6a4b', poor: '#f87171', na: '#a9a9a9' }[st];
    const r_ = sv('rect', { x: pad + i * bw + 2, y: H - 18 - h, width: bw - 4, height: h, rx: 3, fill: col, 'fill-opacity': d.daysAgo === 0 ? .95 : .55 }); r_.append(sv('title', {}, `${d.daysAgo === 0 ? 'Last 24h' : d.daysAgo + ' d ago'}: ${usd(d.volUsd)}`)); svg.append(r_);
    if (i % 2 === 0 || d.daysAgo === 0) svg.append(sv('text', { x: pad + i * bw + bw / 2, y: H - 4, 'text-anchor': 'middle', fill: '#a9a9a9', 'font-size': 9 }, d.daysAgo === 0 ? 'now' : '-' + d.daysAgo + 'd')); });
  const by_ = H - 18 - (k.now.baseline7d / mx) * (H - 30);
  svg.append(sv('line', { x1: pad, x2: W, y1: by_, y2: by_, stroke: '#ececec', 'stroke-dasharray': '5 4', 'stroke-opacity': .7 }), sv('text', { x: 2, y: by_ + 3, fill: '#a9a9a9', 'font-size': 9 }, '7d avg'));
  host.append(svg);
}

function tiles(rows) {
  const t = $('tiles'); t.replaceChildren();
  const bid = rows.filter((r) => r.bidReady), watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch');
  const RN = S.runners && Array.isArray(S.runners.items) ? S.runners.items.filter((x) => !(x.vetoed && x.vetoed.length)) : [], strong = RN.filter((x) => x.passed >= 3).length;
  const E = S.wscore && Array.isArray(S.wscore.early) ? S.wscore.early : [], starred = E.filter((e) => e.provenIn > 0).length;
  let open = 0, best = null, edges = 0; try { for (const k of Object.keys(BOOKS)) { const p = bookData(k), ev = evidence(p); open += p.openN; if (ev.verdict === 'edge') edges++; if (ev.n >= 10 && (!best || ev.avgR > best.ev.avgR)) best = { k, ev }; } } catch { /* keep the strip */ }
  const tile = (l, v, n, c, go) => { const d = el('a', 'tile'); d.href = go; d.style.setProperty('--c', c); d.append(el('div', 'lbl', l), el('div', 'big' + (typeof v === 'number' ? '' : ' txt'), String(v)), el('div', 'nt', n)); if (go === '#paper-lab') { d.href = '#paper'; d.addEventListener('click', () => { S.deskTab = 'lab'; try { drawPaper(); } catch { /* ignore */ } }); } t.append(d); };
  tile('Bid-ready', bid.length, 'all 7 gates pass', '#34d399', '#bid');
  tile('Runners', RN.length, `${strong} with 3+ of 4 checks`, '#ee6a4b', '#runners');
  tile('Early movers', E.length, starred ? `★ ${starred} with proven wallets buying` : 'trending in the last 1–6 hours', '#a78bfa', '#wsBox');
  tile('Worth watching', watch.length, 'one or two gates away', '#e0e1e0', '#plans');
  tile('Paper trades open', open, `across ${Object.keys(BOOKS).length} books`, '#a8a8a8', '#paper');
  tile('Edge board', edges ? `${edges} candidate${edges > 1 ? 's' : ''}` : 'no edge yet', best ? `best: ${BOOKS[best.k].short} ${rr(best.ev.avgR)} a trade (${best.ev.n} closed)` : 'no book has 10 closed trades yet', edges ? '#34d399' : '#d64227', '#paper-lab');
}

function draw() {
  const rows = S.setups.filter(chainOk), bid = rows.filter((r) => r.bidReady).map(viewAuto).sort(cmp());
  const watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch').map(viewAuto).sort(cmp());
  tiles(S.setups); controls();
  $('bidEmpty').hidden = bid.length > 0; $('bidEmpty').textContent = 'Nothing is bid-ready right now. That is a valid answer: no coin has passed all 7 gates, so the rules say wait.';
  fill($('bidList'), bid, null, ''); if (!bid.length) $('bidList').replaceChildren();
  fill($('watchList'), watch, null, 'Nothing is close to bid-ready right now.', 4, 'watch');
  // patterns + bottoms
  const chips = $('patChips'); chips.replaceChildren();
  const cnt = (n) => n === 'All' ? rows.filter((r) => r.patName && r.patScore >= 45).length + rows.filter((r) => r.bottomed && !(r.patName && r.patScore >= 45)).length : n === 'Bottomed out' ? rows.filter((r) => r.bottomed).length : rows.filter((r) => r.patName === n && r.patScore >= 45).length;
  ['All', ...PATS, 'Bottomed out'].forEach((n) => { const b = el('button', 'chip' + (S.patFilter === n ? ' on' : ''), `${n} (${cnt(n)})`); b.type = 'button'; b.onclick = () => { S.patFilter = n; draw(); }; chips.append(b); });
  let list = [];
  const pv = rows.filter((r) => r.patName && r.patScore >= 45).map((r) => patView(r)), bv = rows.filter((r) => r.bottomed).map(botView);
  if (S.patFilter === 'All') list = [...pv, ...bv.filter((b) => !pv.some((p) => p.id === b.id))]; else if (S.patFilter === 'Bottomed out') list = bv; else list = pv.filter((r) => r.patName === S.patFilter);
  list.sort((a, b) => (b.patReady || b.bidReady ? 1 : 0) - (a.patReady || a.bidReady ? 1 : 0) || cmp()(a, b));
  fill($('patList'), list.slice(0, 24), null, 'No coins match this filter in the latest scan.', 6, 'pats');
  drawLogPanel();
  rChart();
  // all coins
  const ab = $('allTbl').tBodies[0]; ab.replaceChildren();
  rows.slice().sort(byOpp).forEach((r) => { const v = viewAuto(r), tr = el('tr');
    tr.append(coinCell(r, true), el('td', null, r.chain), el('td', null, v._lab), el('td', null, v.setupType || '—'), el('td', 'n', r.opp ?? '—'), el('td', 'n', r.conf != null ? r.conf + '/6' : '—'), el('td', 'n', (v.gatesPassed ?? '—') + '/7'),
      el('td', 'n', v.riskPct != null ? num(v.riskPct) : '—'), el('td', 'n', v.upsidePct != null ? num(v.upsidePct, 0) : '—'), el('td', 'n', usd(r.vol24h)), el('td', 'n', usd(r.liquidity)), el('td', 'n', r.hs && r.hs.holders != null ? Number(r.hs.holders).toLocaleString('en') + (r.hs.growPct != null ? ` (${pct(r.hs.growPct, 0)})` : '') : '—')); ab.append(tr); });
  drawVolume();
}

function controls() {
  const host = $('ctl'); if (!host) return; host.replaceChildren();
  const chains = ['All', ...new Set(S.setups.map((r) => r.chain))];
  chains.forEach((c) => { const b = el('button', 'chip' + (S.chain === c ? ' on' : ''), c); b.type = 'button'; b.onclick = () => { S.chain = c; draw(); }; host.append(b); });
  const sel = el('select', 'sortsel'); sel.setAttribute('aria-label', 'Sort');
  [['opp', 'Sort: opportunity'], ['dist', 'Sort: closest to entry'], ['risk', 'Sort: lowest risk'], ['up', 'Sort: highest upside'], ['holders', 'Sort: most holders'], ['growth', 'Sort: holder growth']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (S.sort === v) o.selected = true; sel.append(o); });
  sel.onchange = () => { S.sort = sel.value; draw(); }; host.append(sel);
}
// the one-glance answer at the top: act or wait
function verdict() {
  const sec = $('verdict'), h = $('vTop'); if (!sec || !h) return; h.replaceChildren();
  if (!S.meta) { sec.hidden = true; return; } sec.hidden = false;
  const rows = S.setups, bid = rows.filter((r) => r.bidReady).map(viewAuto).sort(cmpDist()), watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch').map(viewAuto).sort(cmpDist());
  const reg = S.meta.regime ? [['SOL', S.meta.regime.sol], ['ETH', S.meta.regime.eth]].filter((x) => x[1]) : [], off = reg.some((x) => x[1].level === 'Risk-off');
  const closed = logRows().filter((s) => s.resultR != null && s.status !== 'expired (no fill)'), avg = closed.length ? closed.reduce((a, s) => a + Number(s.resultR), 0) / closed.length : null;
  sec.className = 'card verdict ' + (bid.length ? 'go' : 'wait');
  const top = bid[0] || null;
  h.append(el('div', 'vh', bid.length ? `${bid.length} BID-READY` : 'WAIT: nothing is bid-ready'));
  if (top) { const l = entryLine(top); h.append(el('p', 'vl', `${top.coin} (${top.chain}) · ${top.setupType} · buy ${fp(top.entryLow)}–${fp(top.entryHigh)} · stop ${fp(top.stop)} (${num(top.riskPct)}% away) · TP1 ${fp(top.tp1)}`)); if (l) h.append(el('p', 'eline ' + l.cls, l.txt)); let pd = null; try { pd = debate(top, panelCtx(top)); } catch { /* ignore */ } if (pd) h.append(el('p', 'meta', `Panel verdict: ${pd.verdict} (bull ${pd.bullScore} vs bear ${pd.bearScore}). ${pd.why}`)); }
  else if (watch.length) h.append(el('p', 'vl', 'Closest to a buy zone: ' + watch.slice(0, 3).map((r) => `${r.coin} (${distZone(r) < 0.05 ? 'in zone' : num(distZone(r)) + '% above'}, opp ${r.opp})`).join(' · ')));
  if (reg.length) { const rb = el('p', 'banner' + (off ? '' : ' ok')); rb.textContent = off ? `Market risk-off: ${reg.filter((x) => x[1].level === 'Risk-off').map((x) => x[0] + ' (' + (x[1].why || []).slice(0, 2).join(', ') + ')').join('; ')}. Reversals fail more often in a falling market, so size down or wait.` : `Market backdrop: ${reg.map((x) => x[0] + ' ' + x[1].level.toLowerCase()).join(', ')}.`; h.append(rb); }
  const ctx = [];
  ctx.push(closed.length ? `Rules so far: ${rr(avg)} average over ${closed.length} closed signals${closed.length < 30 ? ' (too few to trust)' : ''}` : 'Rules so far: no closed signals yet, treat as unproven');
  h.append(el('p', 'meta', ctx.join(' · ')));
  const pos = POS.get(), ids = Object.keys(pos);
  try { zonePane(bid, watch); } catch { /* keep going */ }
  if (ids.length) { const box = el('div', 'pos'); box.append(el('b', null, 'Your positions')); ids.forEach((id) => { const q = pos[id], w = S.watch.get(id), row = S.setups.find((r) => r.id === id), now = w && w.price != null ? w.price : row ? row.price : null;
    const st = now == null ? 'no live price' : now <= Number(q.stop) ? 'THROUGH STOP: exit' : q.tp3 && now >= Number(q.tp3) ? 'at TP3' : q.tp2 && now >= Number(q.tp2) ? 'past TP2' : q.tp1 && now >= Number(q.tp1) ? 'past TP1: stop to entry' : 'open';
    const d = el('div', 'prow'); d.append(el('span', null, `${q.coin}: now ${fp(now)} · stop ${fp(q.stop)} · TP1 ${fp(q.tp1)} · ${st}`)); const x = el('button', 'act', 'Remove'); x.type = 'button'; x.onclick = () => { const o = POS.get(); delete o[id]; POS.set(o); verdict(); draw(); }; d.append(x); box.append(d); }); h.append(box); }
}
const cmpDist = () => (a, b) => distZone(a) - distZone(b) || byOpp(a, b);
// running total of R across closed signals
function rChart() {
  const host = $('rChart'); if (!host) return; host.replaceChildren();
  const c = logRows().filter((s) => s.resultR != null && s.status !== 'expired (no fill)').sort((a, b) => String(a.closedAt || a.signalAt).localeCompare(String(b.closedAt || b.signalAt)));
  if (c.length < 2) { host.append(el('p', 'meta', 'The running-R chart appears once two signals have closed.')); return; }
  let t = 0; const pts = [0, ...c.map((s) => (t += Number(s.resultR)))], W = 640, H = 130, P = 26, lo = Math.min(...pts, 0), hi = Math.max(...pts, 0), x = (i) => P + (W - P - 6) * i / (pts.length - 1), y = (v) => 8 + (H - 24) * (1 - (v - lo) / (hi - lo || 1));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': 'Running total of R across closed signals' });
  svg.append(sv('line', { x1: P, x2: W - 6, y1: y(0), y2: y(0), stroke: '#ececec', 'stroke-opacity': .5, 'stroke-dasharray': '4 4' }), sv('text', { x: 2, y: y(0) + 3, fill: '#a9a9a9', 'font-size': 9 }, '0R'));
  svg.append(sv('polyline', { points: pts.map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: t >= 0 ? '#34d399' : '#f87171', 'stroke-width': 2.2 }));
  c.forEach((s, i) => { const k = sv('circle', { cx: x(i + 1), cy: y(pts[i + 1]), r: 3.4, fill: Number(s.resultR) > 0 ? '#34d399' : '#f87171' }); k.append(sv('title', {}, `${s.coin} ${rr(s.resultR)}`)); svg.append(k); });
  svg.append(sv('text', { x: W - 6, y: H - 2, fill: '#a9a9a9', 'font-size': 9.5, 'text-anchor': 'end' }, `running total ${rr(t)} over ${c.length} closed signals`));
  host.append(svg);
}

function zonePane(bid, watch) {
  const host = $('zonePane'); if (!host) return; host.replaceChildren();
  const list = [...bid, ...watch].sort(cmpDist()).slice(0, 8);
  if (!list.length) { host.append(el('p', 'empty', 'No coin is close to a buy zone right now. The scanner keeps looking and will buzz your phone when one lines up.')); return; }
  host.append(el('p', 'meta', 'Each coin below has a valid plan. Place the limit order at the top of the buy zone; do not chase price above it.'));
  list.forEach((r) => {
    const d = distZone(r), w = S.watch.get(r.id), p = w && w.price != null ? w.price : Number(r.price);
    const state = r.stop != null && p <= Number(r.stop) ? ['bad', 'through stop'] : d < 0.05 ? ['y', 'in zone now'] : d <= 3 ? ['w', num(d) + '% above'] : ['n', num(d) + '% above'];
    const row = el('div', 'zrow'), l = el('div', 'zl'), a = el('a', 'coinlink'); a.append(el('b', null, r.coin)); if (r.pool) { a.href = dexUrl(r.chain, r.pool); a.target = '_blank'; a.rel = 'noopener'; }
    l.append(r.pool ? a : el('b', null, r.coin), el('span', 'meta', `  ${r.chain} · ${r.setupType || 'Bottom reversal'} · opp ${r.opp}`));
    const m = el('div', 'zm', `buy ${fp(r.entryLow)}–${fp(r.entryHigh)} · stop ${fp(r.stop)} · TP1 ${fp(r.tp1)} · now ${fp(p)}`);
    row.append(l, el('span', 'badge z-' + state[0], r.bidReady ? 'Bid-ready · ' + state[1] : 'Watch · ' + state[1]), m); host.append(row);
  });
}
function header() {
  const m = S.meta, host = $('scanPane'); if (!host) return; host.replaceChildren();
  if (!m) { host.append(el('p', 'empty', 'No scan has run yet. Run the scanner once (see README) and this page fills in.')); return; }
  const rows = S.setups, bid = rows.filter((r) => r.bidReady), watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch'), pats = rows.filter((r) => r.patName && r.patScore >= 45);
  const line = (k, v) => { const d = el('div', 'srow'); d.append(el('span', 'meta', k), el('b', null, v)); host.append(d); };
  line('Last scan', `${brisbane(m.scannedAt)} (${ago(m.scannedAt)})`);
  line('Type', m.mode === 'light' ? `Hourly refresh of ${m.refreshedN} tracked coins (last full discovery scan ${m.fullAt ? ago(m.fullAt) : 'n/a'})` : 'Full discovery scan');
  line('Coins scored', `${m.scoredN} of ${m.scannedN}, ${m.kept} above ${m.minOpp}`);
  line('Right now', `${bid.length} bid-ready · ${watch.length} worth watching · ${pats.length} chart patterns`);
  line('Schedule', 'hourly, 24 hours a day, full discovery every 4 hours' + (S.watchAt ? `, entry prices checked ${ago(S.watchAt)}` : ''));
  if (S.usage && S.usage.calls != null) line('Data use this month', `${Math.round(S.usage.calls / 1000)}k of ${Math.round((m.cgLimit || 100000) / 1000)}k calls`);
  const nx = new Date(Date.parse(m.scannedAt) + 4 * 3600e3); if (m.mode !== 'light') line('Next full scan', brisbane(nx.toISOString()));
  if (m.hsApplied) line('Holder data', `${m.hsApplied} coins`);
  if (m.funnel && m.funnel.inPlay != null) { const f = m.funnel, top = (g, n) => g.gates.filter((x) => x.fail > 0).slice(0, 3).map((x) => `${x.label} ${x.fail}/${n}`).join(' · ') || 'none';
    line('Coins worth a look', `${f.inPlay} scoring 50+ · ${f.ready} bid-ready${f.zoneOrder ? ` (${f.zoneOrder} as resting-limit calls)` : ''} · ${f.oneAway} one gate away`);
    if (f.reversal.coins) line('Reversal setups blocked by', top(f.reversal, f.reversal.coins));
    if (f.breakout.coins) line('Breakout setups blocked by', top(f.breakout, f.breakout.coins));
    if (f.floors && f.floors.minVolume != null) line('Discovery floors', `$${Math.round(f.floors.minVolume / 1000)}k 24h volume, $${Math.round(f.floors.minLiquidity / 1000)}k liquidity, up to ${f.floors.maxPools} pools. Lower them in config/settings.json to widen the net (more candidates, more junk).`); }
  // the market-risk banner lives with the verdict; the market tab shows the trend tiles
}

async function fearGreed() {
  const g = $('fgGrid'); g.replaceChildren();
  const cell = (l, v, n) => { const d = el('div', 'vcell'); d.append(el('div', 'l', l), el('div', 'v', v)); if (n) d.append(el('div', 'l', n)); g.append(d); };
  try { const j = await (await fetch('https://api.alternative.me/fng/?limit=2')).json(), a = j.data[0], b = j.data[1]; cell('Crypto Fear & Greed', a.value, `${a.value_classification}${b ? ' · yesterday ' + b.value : ''}`); } catch { cell('Crypto Fear & Greed', '—', 'unavailable'); }
  const al = S.vol.find((d) => d.chain === 'All' && d.daysAgo === 0); if (al) cell('On-chain volume vs 7-day avg', Math.round((al.ratio ?? 0) * 100) + '%', volState(al.ratio)[0]);
  if (S.meta && S.meta.regime) for (const [k, v] of [['SOL', S.meta.regime.sol], ['ETH', S.meta.regime.eth]]) if (v) cell(k + ' trend', v.level, `${pct(v.chg7)} 7d · ${v.why.length ? v.why[0] : 'above 20-day avg, 4h trend up'}`);
  const bid = S.setups.filter((r) => r.bidReady).length; cell('Bid-ready coins', String(bid), 'of ' + S.setups.length + ' above 65');
}

// ---------- Check a coin ----------
const GT = 'https://api.geckoterminal.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gget(path, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try { const r = await fetch(GT + path, { headers: { accept: 'application/json;version=20230302' } });
      if (r.status === 429) { await sleep(2500 * i); continue; } if (!r.ok) return null; return await r.json(); } catch { await sleep(1200 * i); }
  } return null;
}
// score one coin live in this browser with the same rules as the scanner (free public feeds; nothing is saved)
async function scoreLive(q) {
  const { list } = await discoverPools(gget, { onlyMine: true, cap: {}, maxPools: 0, minLiquidity: 0, minVolume: 0 }, [q], () => {});
  const p = list[0]; if (!p) return { err: 'notfound' };
  const j = await gget(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list;
  if (!raw || !C.techFromRaw(p, raw)) return { err: 'young', p };
  C.scoreList([p], Date.now());
  await C.crossCheck([p], { getJson: async (u) => (await fetch(u)).json(), sleep, log: () => {} });
  const sf = await checkToken(p, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  applyOverlays([p], { safety: { [p.net + '|' + p.token]: sf }, regime: null });
  const row = C.toRow(p, new Date().toISOString()); row.rug = p.rug; row.rugFlags = p.rugFlags; if (sf.level === 'danger') row.noTradeWhy = 'token safety: ' + sf.flags[0];
  try { const ij = p.token ? await gget(`/networks/${p.net}/tokens/${p.token}/info`) : null, hi = parseInfo(ij); if (hi) row.hs = hi; } catch { /* optional */ }
  return { p, row, cr: p.h4 ? C.toChart(p) : null };
}
async function lookup(q) {
  const out = $('lookupOut'); out.replaceChildren(); const ql = q.toLowerCase();
  const hits = S.setups.filter((r) => r.coin.toLowerCase() === ql || r.name?.toLowerCase() === ql || r.pool?.toLowerCase() === ql || r.id.toLowerCase() === ql);
  if (hits.length) { hits.forEach((r) => out.append(card(viewAuto(r), S.charts.get(r.id)))); return; }
  out.append(el('p', 'empty', `“${q}” is not above 65 in the latest scan, so I am scoring it live with the same rules…`));
  try {
    const res = await scoreLive(q);
    if (res.err === 'notfound') { out.replaceChildren(el('p', 'caut', `Could not find “${q}” on Solana, Robinhood Chain or Ethereum. Try the contract address, or prefix the chain, e.g. solana:BONK.`)); return; }
    if (res.err === 'young') { out.replaceChildren(el('p', 'caut', `${res.p.sym} on ${C.CH[res.p.chain]} has fewer than 22 hours of candles, so it is too new to score safely.`)); return; }
    out.replaceChildren(el('p', 'note', 'Live score, not part of the saved scan. Opportunity under 65 is not something the scanner would list.')); out.append(card(viewAuto(res.row), res.cr));
  } catch (e) { out.replaceChildren(el('p', 'caut', 'Live lookup failed (' + (e.message || e) + '). The free data feed may be rate-limiting; try again in a minute.')); }
}
$('lookupForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('lookupQ').value.trim(); if (q) lookup(q); });


// ---------- signal log & results (audit trail) ----------
const LF = { q: '', setup: 'All', state: 'All', cost: 0 };
const logKind = (s) => (s.kind === 'replay' ? 'Replay' : s.kind === 'near-miss' ? 'Near-miss' : 'Live');
const logWhy = (s) => { const st = s.status || ''; if (st === 'expired (no fill)') return 'never reached the entry zone'; if (st === 'waiting for entry') return 'waiting for price to reach the entry zone'; if (st === 'open') return s.tpHit ? `open, TP${s.tpHit} already hit` : 'open, no target hit yet';
  if (st === 'stopped out') return 'stopped out before any target'; if (st.startsWith('stopped after TP')) return 'hit ' + st.replace('stopped after ', '') + ', then stopped at breakeven'; if (st.startsWith('time exit')) return 'sold at the 7-day time limit'; if (st.startsWith('closed')) return st; return st || '—'; };
const logState = (s) => (s.status === 'expired (no fill)' ? 'never filled' : s.status === 'open' || s.status === 'waiting for entry' ? 'open' : 'closed');
function drawLogPanel() {
  const sec = $('log'); if (!sec) return; const since = S.paperCfg && S.paperCfg.since, hid = S.signals.length - (since ? S.signals.filter((s) => String(s.signalAt || '') >= since).length : S.signals.length);
  let bar = $('logBar'); if (!bar) { bar = el('div'); bar.id = 'logBar'; const t = $('rChart'); if (t) sec.insertBefore(bar, t); } bar.replaceChildren();
  const all = logRows(), net = (s) => Number(s.resultR) - LF.cost, closed = all.filter((s) => logState(s) === 'closed' && s.resultR != null), wins = closed.filter((s) => net(s) > 0).length, avg = closed.length ? closed.reduce((a, s) => a + net(s), 0) / closed.length : null;
  const h = el('p', 'tip'); h.textContent = closed.length ? `${closed.length} of 30 closed live signals (30 needed before reading results) · win rate ${Math.round(wins / closed.length * 100)}% · average ${rr(avg)}${LF.cost ? ' after ' + LF.cost + 'R cost per trade' : ''}.` : `0 of 30 closed live signals (30 needed before reading results). Nothing has closed yet, so there is no result to judge.`; bar.append(h);
  const b = S.bt && S.bt.overall, ctx = []; if (b) ctx.push(`Backtest replay (not live): ${b.closed} closed, average ${b.avgR != null ? rr(b.avgR) : '—'}. Only the live line above is real.`);
  const sol = S.meta && S.meta.regime && S.meta.regime.sol; if (sol && sol.chg7 != null) ctx.push(`For context, SOL moved ${pct(sol.chg7)} over the last 7 days (a market move in %, not comparable with R, but a rising market flatters any long-only strategy).`);
  const rc = S.learned && S.learned.runners && S.learned.runners.control; if (rc && rc.comment) ctx.push('Runners list against random coins: ' + rc.comment);
  ctx.forEach((t) => bar.append(el('p', 'meta', t)));
  if (since && (hid > 0 || S.showOld)) { const p = el('p', 'meta'); p.append(`Showing signals since the fresh start on ${whenS(since)}. `); const bt = el('button', 'dk-tab', S.showOld ? 'Hide earlier signals' : `Show ${hid} earlier signal${hid === 1 ? '' : 's'}`); bt.type = 'button'; bt.addEventListener('click', () => { S.showOld = !S.showOld; draw(); drawPaper(); }); p.append(bt); bar.append(p); }
  // filters, cost and download
  const tools = el('div', 'dk-tabs'), mk = (tag, a) => Object.assign(document.createElement(tag), a);
  const q = mk('input', { type: 'search', placeholder: 'Coin', value: LF.q, className: 'dk-in' }), su = mk('select', { className: 'dk-in' }), st = mk('select', { className: 'dk-in' }), co = mk('select', { className: 'dk-in', title: 'Extra cost per trade to subtract (gas and exit slippage are not in the log)' });
  ['All', ...new Set(all.map((s) => s.setup || 'Setup not recorded'))].forEach((x) => su.append(mk('option', { value: x, textContent: x === 'All' ? 'All setups' : x, selected: LF.setup === x })));
  [['All', 'All states'], ['open', 'Open'], ['closed', 'Closed'], ['never filled', 'Never filled']].forEach(([v, t]) => st.append(mk('option', { value: v, textContent: t, selected: LF.state === v })));
  [[0, 'No extra cost'], [0.1, 'Subtract 0.1R per trade'], [0.2, 'Subtract 0.2R per trade'], [0.3, 'Subtract 0.3R per trade']].forEach(([v, t]) => co.append(mk('option', { value: v, textContent: t, selected: LF.cost === v })));
  const dl = el('button', 'dk-tab', 'Download CSV'); dl.type = 'button';
  q.addEventListener('input', () => { LF.q = q.value; drawLogTable(); }); su.addEventListener('change', () => { LF.setup = su.value; drawLogTable(); }); st.addEventListener('change', () => { LF.state = st.value; drawLogTable(); }); co.addEventListener('change', () => { LF.cost = Number(co.value); drawLogPanel(); });
  dl.addEventListener('click', () => { const rows = logFiltered(), head = ['signalAt', 'coin', 'chain', 'setup', 'kind', 'state', 'entryLow', 'entryHigh', 'stop', 'status', 'tpHit', 'resultR', 'openR', 'why'], esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = [head.join(','), ...rows.map((s) => head.map((k) => esc(k === 'kind' ? logKind(s) : k === 'state' ? logState(s) : k === 'why' ? logWhy(s) : s[k])).join(','))].join('\n'); try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'rynoscan-signal-log.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch { /* download not available */ } });
  tools.append(q, su, st, co, dl); bar.append(tools);
  drawLogTable();
}
const logFiltered = () => logRows().filter((s) => (!LF.q || String(s.coin || s.id || '').toLowerCase().includes(LF.q.toLowerCase())) && (LF.setup === 'All' || (s.setup || 'Setup not recorded') === LF.setup) && (LF.state === 'All' || logState(s) === LF.state));
function drawLogTable() {
  const tb = $('logTbl') && $('logTbl').tBodies[0]; if (!tb) return; tb.replaceChildren(); const rows = logFiltered();
  if (!rows.length) { const tr = el('tr'), td = el('td', null, S.signals.length ? 'No signals match this filter.' : 'No bid-ready signals logged yet.'); td.colSpan = 9; tr.append(td); tb.append(tr); return; }
  const px = (s) => { const r = S.setups.find((x) => x.id === s.id); return r && r.price != null ? +r.price : null; };
  [['open', 'Open'], ['closed', 'Closed'], ['never filled', 'Never filled (no money used)']].forEach(([k, label]) => {
    const g = rows.filter((s) => logState(s) === k).sort((a, b) => String(b.signalAt || '').localeCompare(String(a.signalAt || ''))); if (!g.length) return;
    const hr = el('tr', 'dk-grp'), hd = el('td', null, `${label} (${g.length})`); hd.colSpan = 9; hr.append(hd); tb.append(hr);
    g.forEach((s) => { const tr = el('tr'); let res = s.resultR != null ? Number(s.resultR) - LF.cost : s.openR != null ? Number(s.openR) : null;
      const c7 = el('td', 'n ' + (res > 0 ? 'pos' : res < 0 ? 'neg' : ''), res == null ? '—' : rr(res) + (s.resultR == null ? ' (open)' : '')); let now = '—';
      if (k === 'open') { const p = px(s); if (p) { const ent = (+s.entryLow + +s.entryHigh) / 2; now = `${fp(p)} · ${((p / ent - 1) * 100).toFixed(1)}% vs entry · ${((p / +s.stop - 1) * 100).toFixed(1)}% above stop`; } }
      tr.append(el('td', null, (s.signalAt || '').slice(0, 16).replace('T', ' ')), coinCell(s), el('td', null, s.setup || 'Setup not recorded'), el('td', null, logKind(s)), el('td', null, `${fp(s.entryLow)}–${fp(s.entryHigh)}`), el('td', null, fp(s.stop)), el('td', null, now), el('td', null, logWhy(s)), c7); tb.append(tr); }); });
}
// ---------- backtest ----------
function drawBacktest() {
  const b = S.bt; if (!b) return;
  const o = b.overall, tb = $('btTbl').tBodies[0]; tb.replaceChildren();
  const row = (name, s) => { const tr = el('tr'); tr.append(el('td', null, name), el('td', 'n', s.signals), el('td', 'n', s.closed), el('td', 'n', s.winRate != null ? Math.round(s.winRate * 100) + '%' : '—'), el('td', 'n ' + (s.avgR > 0 ? 'pos' : s.avgR < 0 ? 'neg' : ''), s.avgR != null ? rr(s.avgR) : '—'), el('td', 'n', s.medianR != null ? rr(s.medianR) : '—'), el('td', 'n', s.profitFactor != null ? s.profitFactor : '—'), el('td', 'n', s.tp1Rate != null ? Math.round(s.tp1Rate * 100) + '%' : '—')); tb.append(tr); };
  row('All setups', o); b.byType.forEach((t) => row(t.setup + (t.closed < 8 ? ' (too few)' : ''), t));
  const v = o.closed < 30 ? `Only ${o.closed} closed signals in the replay, which is too few to conclude anything. Treat every setup as unproven and keep size small.`
    : o.avgR > 0.1 && o.profitFactor > 1.3 ? `On this replay the rules came out ahead: ${Math.round(o.winRate * 100)}% winners, average ${rr(o.avgR)} per trade, profit factor ${o.profitFactor}. That is encouraging, not proof; see the caveats below.`
    : `On this replay the rules did not show a clear edge (average ${rr(o.avgR)} per trade, profit factor ${o.profitFactor ?? '—'}). Trade smaller than usual and favour the setups with the best rows below.`;
  $('btVerdict').textContent = `${v} Replay of ${b.coins} coins over about ${b.days} days, run ${(b.at || '').slice(0, 10)}.`;
  { let lim = $('btLimits'); if (!lim) { lim = el('p', 'meta'); lim.id = 'btLimits'; $('btVerdict').after(lim); } lim.textContent = `How this replay can mislead: it only replays coins that are trending today and are about 25+ days old, so dead and rugged coins never appear; and it cannot re-run the token-safety, holder and social checks for past dates. Live results are usually worse than the replay.${(b.at || '') < '2026-10-19' ? ' This report is from before the 19 Oct fix: it filled trades on the candle that created the signal, which flattered it. Run the backtest again for a fair number.' : ''}`; }
  const rl = $('btReal'); if (rl) { rl.textContent = b.fill && b.optimistic ? `Fills assumed: ${b.fill.fillAt === 'high' ? 'limit order resting at the top of the zone' : 'zone midpoint'}, ${b.fill.slipPct}% round-trip slippage and fees. Average ${rr(o.avgR)} per trade here, against ${rr(b.optimistic.avgR)} with optimistic fills and no slippage.` : ''; }
  const xw = $('btExitWrap'), xb = $('btExit').tBodies[0]; xb.replaceChildren();
  if (b.exitVariants && b.exitVariants.length) { xw.hidden = false; b.exitVariants.forEach((x) => { const tr = el('tr'); tr.append(el('td', null, x.name), el('td', 'n', x.closed), el('td', 'n', x.winRate != null ? Math.round(x.winRate * 100) + '%' : '—'), el('td', 'n ' + (x.avgR > 0 ? 'pos' : 'neg'), x.avgR != null ? rr(x.avgR) : '—'), el('td', 'n', x.profitFactor ?? '—')); xb.append(tr); }); } else xw.hidden = true;
  const ul = $('btNotes'); ul.replaceChildren(); b.notes.forEach((n) => ul.append(el('li', null, n)));
}
function drawEdge(L) {
  const box = $('edgeBox'); if (!box) return; box.replaceChildren(); const E = L && L.edge; if (!E) return;
  const h = el('h3', null, 'Edge report'), p = el('p', 'tip ' + (E.status === 'edge-candidate' ? 'pos' : E.status === 'negative' ? 'neg' : ''), E.headline); box.append(h, p);
  const sec = (title, items, fmt) => { if (!items || !items.length) return; box.append(el('h4', null, title)); const u = el('ul', 'note'); items.forEach((x) => u.append(el('li', null, fmt(x)))); box.append(u); };
  sec('Rules the scanner is applying now (found by the data, re-tested weekly)', E.filters, (x) => `${x.label}: ${x.trades} past trades averaged ${rr(x.avgR)}. Matching coins get a strong warning in the panel.`);
  if (E.tested) box.append(el('p', 'meta', `${E.tested} possible rules were tried. Because that many were tried, some look good by pure luck, so every rule is corrected for it and must also hold on older and newer trades.`));
  sec('What each pattern needs', E.patterns, (x) => `${x.setup}${x.live ? '' : ' (background tracking)'}: ${x.comment}`);
  sec('What winners had in common', E.profiles, (x) => `${x.setup} (${x.wins} wins, ${x.losses} losses): ${x.comment}`);
  sec('Candidate rules, checked on older and newer trades', E.rules, (x) => `${x.rule}: ${x.trades} trades averaged ${rr(x.avgR)} against ${rr(x.keepAvgR)} for the rest (${x.gain > 0 ? '+' : ''}${x.gain}R if skipped). ${x.status}.`);
  if (E.exits && E.exits.rows) { box.append(el('h4', null, `Exit study (${E.exits.n} tracked trades, current exits average ${rr(E.exits.actualAvgR)})`)); const u = el('ul', 'note'); E.exits.rows.forEach((x) => u.append(el('li', null, `Take all profit at ${x.target}R: ${rr(x.avgR)} average, ${x.reachPct}% of trades got that far.`))); box.append(u); box.append(el('p', 'meta', 'An estimate that ignores exit slippage. It shows where the money is made or given back, and is not applied automatically.')); }
  if (E.gates && E.gates.length) sec('Gate study: does waiting for confirmation pay?', E.gates, (x) => `${x.family}: confirmed ${x.confirmed.n} trades (${x.confirmed.avgR != null ? rr(x.confirmed.avgR) : '—'}), early ${x.early.n} trades (${x.early.avgR != null ? rr(x.early.avgR) : '—'}). ${x.comment}`);
  sec('What to do next', E.next, (x) => x);
}
function drawGates(L) {
  const box = $('gateBox'); if (!box) return; box.replaceChildren(); const G = L && L.gates; if (!G) return;
  box.append(el('h3', null, 'Gate report'), el('p', 'meta', `Which gates earn their place and which ones block searches. Based on ${G.scans} scans of history and tracked trades. Report only: no rule is changed.`));
  if (G.summary && G.summary.length) { const u = el('ul', 'note'); G.summary.forEach((x) => u.append(el('li', null, x))); box.append(u); }
  const tag = { keep: ' - KEEP', relax: ' - CONSIDER RELAXING' };
  [['reversal', 'Reversal gates'], ['breakout', 'Breakout gates']].forEach(([k, t]) => { const rows = G[k] || []; if (!rows.length) return; box.append(el('h4', null, t)); const u = el('ul', 'note');
    rows.forEach((r) => u.append(el('li', null, `${r.label}${tag[r.verdict] || ''}: ${r.failPct != null ? `fails for ${r.failPct}% of coins, sole blocker ${r.solePerScan || 0} per scan. ` : ''}${r.comment}`))); box.append(u); });
  if (G.filter) box.append(el('h4', null, 'Does the filter keep you out of garbage?'), el('p', 'note', `${G.filter.comment} Accepted: ${G.filter.accepted.n} trades. Rejected: ${G.filter.rejected.n} trades.`));
  if (G.early) box.append(el('h4', null, 'Early entry experiment (1h, forming 4h candle)'), el('p', 'note', `${G.early.comment} Early: ${G.early.early.n} trades. Confirmed: ${G.early.confirmed.n} trades.`));
  (G.notes || []).forEach((n) => box.append(el('p', 'meta', n)));
}
function drawRunnerStudy(L) {
  const box = $('runnerBox'); if (!box) return; box.replaceChildren(); const Rr = L && L.runners; if (!Rr) return;
  box.append(el('h3', null, 'Runner study'), el('p', 'meta', `Every coin on the runners list (and every one the risk rules dropped) is logged as a paper trade with the numbers at that moment. ${Rr.logged} logged, ${Rr.closed} closed. Report only: nothing is changed automatically.`));
  const u = el('ul', 'note'); (Rr.summary || []).forEach((x) => u.append(el('li', null, x))); box.append(u);
  if (Rr.checks && Rr.checks.length) { box.append(el('h4', null, 'Does passing more checks help?')); const c = el('ul', 'note'); Rr.checks.forEach((x) => c.append(el('li', null, `${x.passed} of 4 checks: ${x.n} trades averaged ${pct(x.avgRet, 1)}`))); box.append(c); }
  if (Rr.findings && Rr.findings.length) { box.append(el('h4', null, `Numbers that separated winners from losers (${Rr.tested} tested)`)); const f = el('ul', 'note'); Rr.findings.forEach((x) => f.append(el('li', null, `${x.feature} ${x.bucket}: ${x.n} trades averaged ${pct(x.avgRet, 1)} against ${pct(x.restAvgRet, 1)} for the rest${x.reliable ? ' - reliable' : ' - hint only'}`))); box.append(f); }
  if (Rr.control && (Rr.control.n || Rr.control.listedN)) { box.append(el('h4', null, 'Against random coins')); box.append(el('p', 'meta', `${Rr.control.comment} Random coins closed: ${Rr.control.n}${Rr.control.avgRet != null ? ', average ' + pct(Rr.control.avgRet, 1) : ''}.`)); }
  if (Rr.oos) { box.append(el('h4', null, `Locked test from ${Rr.oos.lockedFrom}`)); box.append(el('p', 'meta', `Rules are found only on the ${Rr.oos.discovery} trades before the lock date and judged only on the ${Rr.oos.test} trades after it.`)); if (Rr.oos.rules.length) { const o = el('ul', 'note'); Rr.oos.rules.forEach((x) => o.append(el('li', null, `${x.feature} ${x.bucket}: found at ${pct(x.found, 1)} difference, later ${x.held == null ? 'too few trades (' + x.n + ') to judge' : pct(x.testDiff, 1) + (x.held ? ' - held' : ' - did not hold')}`))); box.append(o); } }
  if (Rr.risk) { box.append(el('h4', null, 'Risk and position size')); box.append(el('p', 'meta', `Listed runners at ${Rr.risk.sizePct}% per trade: worst drawdown ${Rr.risk.maxDrawdownPct}%, longest losing run ${Rr.risk.longestLosingStreak}, account ${pct(Rr.risk.endEquityPct, 1)}. Suggested size about ${Rr.risk.suggestedSizePct}% per trade.`)); }
  if (Rr.rolling && Rr.rolling.length) { box.append(el('h4', null, 'Week by week')); const w = el('ul', 'note'); Rr.rolling.forEach((x) => w.append(el('li', null, `${x.feature} ${x.bucket}: pointed the same way in ${x.held} of ${x.weeks} weeks`))); box.append(w); }
  if (Rr.fills) { box.append(el('h4', null, 'Real fills against paper')); box.append(el('p', 'meta', `${Rr.fills.n} real trades logged: entry ${Rr.fills.entryGapPct}% worse, exit ${Rr.fills.exitGapPct ?? '?'}% worse, fees ${Rr.fills.feePct ?? '?'}% (total ${Rr.fills.totalCostPct}%).`)); }
  if (Rr.exits && Rr.exits.length) { box.append(el('h4', null, 'Exit study on the same trades')); const e = el('ul', 'note'); Rr.exits.forEach((x) => e.append(el('li', null, `${x.name}: ${pct(x.avgRet, 1)} average (${x.n} trades)`))); box.append(e); }
  (Rr.notes || []).forEach((n) => box.append(el('p', 'meta', n)));
}
function drawAnalysts(L) {
  const box = $('analystBox'); if (!box) return; box.replaceChildren(); const A = L && Array.isArray(L.analysts) ? L.analysts : []; if (!A.length) return;
  box.append(el('h3', null, 'Pattern analysts'), el('p', 'meta', 'One analyst per chart pattern: how it has done, how it loses, where it works and where it does not, and what to do with it. Items marked reliable passed a luck test; the rest are hints.'));
  const li = (u, t) => u.append(el('li', null, t)), cond = (c) => `${c.text} (${c.n} trades, ${rr(c.avgR)} against ${rr(c.restAvgR)} otherwise)${c.reliable ? ' - reliable' : ' - hint'}`;
  A.forEach((d) => { const det = el('details', 'card fold'), sm = el('summary', null, `${d.setup}${d.live ? '' : ' (background tracking)'}: ${d.n} trades, ${d.avgR != null ? rr(d.avgR) : '—'}`); det.append(sm); det.append(el('p', 'tip', d.headline)); const u = el('ul', 'note');
    li(u, 'Recommendation: ' + d.recommendation);
    if (d.loses) li(u, 'How it loses: ' + d.loses.comment);
    d.conditions.best.forEach((c) => li(u, 'Works best when ' + cond(c))); d.conditions.avoid.forEach((c) => li(u, 'Does worst when ' + cond(c)));
    if (d.quality) li(u, 'Pattern quality: ' + d.quality.comment);
    if (d.exit) li(u, 'Exit: ' + d.exit.comment);
    if (d.recent) li(u, 'Recent form: ' + d.recent.comment);
    det.append(u); box.append(det); });
}
function drawLearn() {
  const L = S.learned, tb = $('learnTbl') && $('learnTbl').tBodies[0]; if (!tb) return; tb.replaceChildren();
  const tip = $('learnTip'), ul = $('learnIns'); ul.replaceChildren();
  if (!L || !L.setups || !L.setups.length) { tip.textContent = 'Nothing learned yet. This fills after the first weekly backtest.'; return; }
  const t = L.total; tip.textContent = (L.promote.length ? `Promoted to live by the data: ${L.promote.join(', ')}. ` : '') + (L.demote.length ? `Flagged as failing by the data (still running, alerts unchanged): ${L.demote.join(', ')}. ` : '') +
    (!L.promote.length && !L.demote.length ? 'Every pattern is running live and alerting. The data only reports on them: nothing is switched off or on automatically. ' : '') + `Overall ${t.n} closed trades, ${rr(t.avgR)} average.`;
  const lab = { proven: 'Proven', failing: 'Failing', promising: 'Promising', weak: 'Weak', unproven: 'Unproven' };
  L.setups.forEach((x) => { const tr = el('tr'); tr.append(el('td', null, x.setup + (x.live ? '' : ' (candidate, not live)')), el('td', 'n', x.n), el('td', 'n', Math.round(x.winRate * 100) + '%'), el('td', 'n ' + (x.avgR > 0 ? 'pos' : 'neg'), rr(x.avgR)),
    el('td', 'n', x.lo90 != null ? `${rr(x.lo90)} to ${rr(x.hi90)}` : '—'), el('td', 'v-' + x.verdict, lab[x.verdict] + (x.need ? ` (needs ~${x.need} more)` : ''))); tb.append(tr); });
  (L.insights || []).forEach((i) => ul.append(el('li', null, i)));
  drawEdge(L); drawGates(L); drawRunnerStudy(L); drawAnalysts(L);
  if (L.best && L.best.length) ul.append(el('li', null, 'Best trades so far: ' + L.best.map((b) => `${b.coin} ${b.setup} ${rr(b.resultR)}`).join(' · ')));
}
// ---------- data loading ----------
const store = { get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: fine */ } } };
function guessRepo() { const saved = store.get('rynoRepo'); if (saved) return saved; const m = location.hostname.match(/^([^.]+)\.github\.io$/), p = location.pathname.split('/').filter(Boolean)[0]; return m && p ? m[1] + '/' + p : ''; }
async function loadAll() {
  const [setups, signals, charts, vol, meta, bt, watch, learned, usage, fwd, degen, lab, wscore, runners] = await Promise.all([getJ('setups.json', []), getJ('signals.json', []), getJ('charts.json', []), getJ('chainvol.json', []), getJ('meta.json', null), getJ('backtest.json', null), getJ('watch.json', null), getJ('learned.json', null), getJ('usage.json', null), getJ('forward.json', []), getJ('degen.json', []), getJ('lab.json', []), getJ('walletscore.json', null), getJ('runners.json', null)]);
  const arr = (x) => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []), obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
  S.degen = arr(degen); S.lab = arr(lab); S.wscore = obj(wscore); S.runners = obj(runners) && Array.isArray(runners.items) ? runners : null; try { const r = await fetch('paper-config.json', { cache: 'no-store' }); S.paperCfg = r.ok ? await r.json() : null; } catch { S.paperCfg = null; } S.setups = arr(setups); S.signals = arr(signals); S.fwd = arr(fwd); S.charts = new Map(arr(charts).filter((c) => c.id != null).map((c) => [c.id, c])); S.vol = arr(vol); S.usage = obj(usage) ? usage : null; S.meta = obj(meta) && meta.scannedAt ? meta : null; S.bt = obj(bt) && Array.isArray(bt.byType) && bt.overall ? bt : null;
  S.learned = obj(learned) && Array.isArray(learned.setups) ? { ...learned, promote: Array.isArray(learned.promote) ? learned.promote : [], demote: Array.isArray(learned.demote) ? learned.demote : [], insights: Array.isArray(learned.insights) ? learned.insights : [], total: obj(learned.total) || {} } : null; try { C.applyLearned(learned); } catch { /* ignore */ }
  S.watch = new Map(arr(watch && watch.items).filter((w) => w.id != null).map((w) => [w.id, w])); S.watchAt = watch && watch.at && watch.scanAt === (meta && meta.scannedAt) ? watch.at : (watch && watch.at) || null;
  if (S.live && S.meta && S.live.at > Date.parse(S.meta.scannedAt)) { const m = S.live; S.setups = S.setups.map((r) => m.fresh.get(r.id) || r).filter((r) => r.mine || r.opp == null || r.opp > (S.meta.minOpp ?? 65) || !m.fresh.has(r.id)); m.charts.forEach((c, id) => S.charts.set(id, c)); }
  header(); verdict(); draw(); fearGreed(); drawBacktest(); drawLearn(); try { drawRunners(); } catch { /* keep the page alive */ } try { drawScorecard(); } catch { /* keep the page alive */ } try { drawPaper(); } catch { /* keep the page alive */ } stamp();
}
// ---------- boot ----------
function stamp() {
  const u = $('updated'), m = S.meta; if (!u) return;
  if (!m || !m.scannedAt) { u.textContent = 'Last updated: no scan yet'; return; }
  const t = new Date(m.scannedAt), mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  const ago = mins < 2 ? 'just now' : mins < 90 ? mins + ' min ago' : mins < 2880 ? Math.round(mins / 60) + ' hours ago' : Math.round(mins / 1440) + ' days ago';
  let when; try { when = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(t) + ' Brisbane time'; } catch { when = t.toLocaleString(); }
  u.textContent = `Last updated: ${when} (${ago})`; u.classList.toggle('stale', mins > 120);
  // health: GitHub sometimes skips scheduled runs; say so when a run is overdue during the Brisbane day (7am-10pm)
  const hl = $('health'); if (hl) { const bh = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', hour12: false }).format(new Date())) % 24, day = true, wm = S.watchAt ? Math.round((Date.now() - Date.parse(S.watchAt)) / 60000) : null, issues = [];
    if (day && mins > 110) issues.push(`the last scan is ${Math.round(mins / 60 * 10) / 10} h old (it should run every hour)`);
    if (day && wm != null && wm > 100) issues.push(`entry prices were last checked ${Math.round(wm / 60 * 10) / 10} h ago (should be every 30 minutes)`); else if (day && wm == null && mins > 110) issues.push('the entry watcher has not reported yet');
    const sh = $('setupHint'); if (sh) { const need = []; sh.hidden = !need.length; sh.textContent = need.length ? 'Reminder: finish setting up ' + need.join(', ') + '. GitHub repo → Settings → Secrets and variables → Actions.' : ''; }
    hl.hidden = !issues.length; hl.textContent = issues.length ? 'Schedule warning: ' + issues.join('; ') + '. GitHub may have skipped runs; open the Actions tab and run it manually.' : ''; }
}


// ---------- verdict side tabs ----------
function wireTabs() {
  const tabs = [...document.querySelectorAll('.vtab')]; if (!tabs.length) return;
  const show = (k) => { tabs.forEach((t) => { const on = t.dataset.tab === k; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }); document.querySelectorAll('.vpane').forEach((p) => { p.hidden = p.id !== 'pane-' + k; }); try { store.set('rynoTab', k); } catch { /* optional */ } };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  let k = 'zone'; try { k = store.get('rynoTab') || 'zone'; } catch { /* default */ } show(tabs.some((t) => t.dataset.tab === k) ? k : 'zone');
}

// ---------- feature sidebar: highlight the section in view; Overview items pick a pane and scroll to the card ----------
function wireSide() {
  const items = [...document.querySelectorAll('.sitem[data-sec]')]; if (!items.length) return;
  const secs = items.map((a) => ({ a, s: document.getElementById(a.dataset.sec) }));
  let tick = false; const mark = () => { tick = false; let cur = null, best = -1e9; for (const x of secs) { if (!x.s || x.s.hidden) continue; const t = x.s.getBoundingClientRect().top; if (t <= 140 && t > best) { best = t; cur = x; } } if (window.scrollY < 200) cur = null; secs.forEach((x) => x.a.classList.toggle('cur', x === cur)); };
  window.addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(mark); } }, { passive: true }); mark();
  document.querySelectorAll('.side .vtab').forEach((b) => b.addEventListener('click', () => { const v = $('verdict'); if (v && !v.hidden) v.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
}
// ---------- tidy: fold the explanatory notes, and the hidden rhino menu ----------
function tidy() {
  document.querySelectorAll('.card > p.note').forEach((p) => { const d = el('details', 'about'), s = el('summary', null, 'ⓘ About this section'); p.replaceWith(d); d.append(s, p); });
  const rh = $('rhino'), menu = $('rmenu'); if (!rh || !menu) return;
  const close = () => { menu.hidden = true; rh.setAttribute('aria-expanded', 'false'); };
  rh.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; rh.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('rScanNow').addEventListener('click', () => { close(); liveScan(); });
}

// ---------- scan now: re-score the tracked coins in this browser (no GitHub needed) ----------
S.live = null; let liveBusy = false;
const CHSLUG = { Solana: 'solana', Ethereum: 'ethereum', Robinhood: 'robinhood' };
async function liveScan() {
  if (liveBusy) return; const note = $('refreshNote'), item = $('rScanNow'); liveBusy = true; if (item) item.disabled = true;
  const say = (t) => { if (note) note.textContent = t; if (item) item.textContent = t; };
  try {
    const rows = S.setups.filter((r) => r.pool && r.token && CHSLUG[r.chain]).sort(byOpp).slice(0, 20); let done = 0, failed = 0, dropped = 0;
    if (!rows.length) { say('Nothing to re-score yet'); return; }
    const fresh = new Map(), charts = new Map();
    for (const r of rows) {
      say(`Scanning live ${done + 1} of ${rows.length}…`);
      try {
        const res = await scoreLive(`${CHSLUG[r.chain]}:${r.token}`);
        if (res.row) { const nr = { ...r, ...res.row, hs: { ...(r.hs || {}), ...(res.row.hs || {}) }, regime: r.regime, mine: r.mine }; fresh.set(r.id, nr); if (res.cr) charts.set(r.id, { ...res.cr, id: r.id }); } else failed++;
      } catch { failed++; }
      done++; if (done % 4 === 0 || done === rows.length) { applyLive(fresh, charts); }
      await sleep(4500); // stays inside the free feed limit of about 30 calls a minute (3 calls per coin)
    }
    dropped = [...fresh.values()].filter((x) => x.opp == null || x.opp <= (S.meta ? S.meta.minOpp : 65)).length;
    S.live = { at: Date.now(), fresh, charts }; applyLive(fresh, charts, true);
    say(`Live scan ${clock()}: ${fresh.size} re-scored${failed ? `, ${failed} unavailable (feed busy)` : ''}${dropped ? `, ${dropped} now below 65` : ''}. Not saved to the log.`);
  } catch (e) { say('Live scan failed: ' + (e.message || e)); }
  finally { liveBusy = false; if (item) { item.disabled = false; item.textContent = 'Scan now (live, in this page)'; } }
}
// put re-scored rows into the page; rows that fall to 65 or below drop off, as in a normal scan
function applyLive(fresh, charts, final) {
  const min = S.meta ? S.meta.minOpp : 65;
  S.setups = S.setups.map((r) => fresh.get(r.id) || r).filter((r) => r.mine || r.opp == null || r.opp > min || !fresh.has(r.id));
  charts.forEach((c, id) => S.charts.set(id, c)); LIVE.clear(); draw(); verdict();
}
// ---------- refresh ----------
let refreshing = false;
async function refresh(manual) {
  if (refreshing) return; refreshing = true; const b = $('refreshBtn'); if (b) { b.disabled = true; b.textContent = 'Refreshing…'; }
  const before = S.meta ? S.meta.scannedAt : null;
  try { await loadAll(); } catch { /* keep what is on screen */ }
  if (b) { b.disabled = false; b.textContent = 'Reload data'; }
  if (manual) { const u = $('refreshNote'); if (u) { const fresh = S.meta && S.meta.scannedAt !== before; u.textContent = fresh ? 'New scan loaded.' : 'Already the latest scan.'; setTimeout(() => { u.textContent = ''; }, 6000); } }
  refreshing = false;
}
(async () => {
  tidy(); wireTabs(); wireSide(); await loadAll(); stamp(); setInterval(stamp, 60000);
  const b = $('refreshBtn'); if (b) b.addEventListener('click', () => refresh(true));
  setInterval(() => { if (!document.hidden) refresh(false); }, 5 * 60000);          // quiet refresh every 5 minutes
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.meta && Date.now() - Date.parse(S.meta.scannedAt) > 20 * 60000) refresh(false); }); // coming back to the tab
})();
