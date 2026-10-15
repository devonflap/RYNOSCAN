// RynoScan dashboard. Reads data/*.json written by src/scan.mjs (no build step, no libraries).
import * as C from './core.mjs';
import { discoverPools } from './pools.mjs';
import { checkToken, applyOverlays } from './overlays.mjs';
import { debate } from './panel.mjs';
import { simulate, fwdSummary } from './paper.mjs';
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
function drawPaper() {
  const host = $('paperOut'); if (!host) return; host.replaceChildren();
  const p = simulate(S.signals, { start: 10000, pct: 5 }), cls = p.retPct > 0 ? 'pos' : p.retPct < 0 ? 'neg' : '';
  const grid = el('div', 'vgrid');
  const cellp = (k, v, c) => { const d = el('div', 'vcell'); d.append(el('div', 'l', k), el('div', 'v ' + (c || ''), v)); grid.append(d); };
  cellp('Account now', usd0(p.equity), cls); cellp('Return', pct(p.retPct, 1), cls); cellp('Banked', usd0(p.realized), p.realized >= 0 ? 'pos' : 'neg'); cellp('Open (marked)', usd0(p.openPnl), p.openPnl >= 0 ? 'pos' : 'neg');
  cellp('Closed trades', `${p.closedN}` + (p.winRate != null ? ` · ${Math.round(p.winRate * 100)}% won` : '')); cellp('Worst drawdown', p.closedN ? '−' + p.maxDD.toFixed(1) + '%' : '—');
  host.append(grid);
  if (!p.trades.length) host.append(el('p', 'empty', 'No bid-ready signal has filled yet, so nothing has been traded. Waiting for entry: ' + p.waitingN + '.'));
  else {
    if (p.curve.length >= 2) {
      const W = 640, H = 130, P = 44, pts = p.curve, lo = Math.min(...pts.map((c) => c.eq), p.start), hi = Math.max(...pts.map((c) => c.eq), p.start), sp = hi - lo || 1, x = (i) => P + (W - P - 8) * i / (pts.length - 1), y = (v) => 10 + (H - 24) * (1 - (v - lo) / sp);
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': 'Paper account value over time' });
      svg.append(sv('line', { x1: P, x2: W - 8, y1: y(p.start), y2: y(p.start), stroke: '#ececec', 'stroke-opacity': .5, 'stroke-dasharray': '4 4' }), sv('text', { x: 2, y: y(p.start) + 3, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(p.start)));
      svg.append(sv('text', { x: 2, y: 12, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(hi)), sv('text', { x: 2, y: H - 14, fill: '#a9a9a9', 'font-size': 9.5 }, usd0(lo)));
      svg.append(sv('polyline', { points: pts.map((c, i) => `${x(i)},${y(c.eq)}`).join(' '), fill: 'none', stroke: p.equity >= p.start ? '#34d399' : '#f87171', 'stroke-width': 2.2 }));
      host.append(svg);
    }
    const tbl = el('table', 'tbl'), th = el('tr'); ['Opened', 'Coin', 'Setup', 'Position', 'Result', 'P&L'].forEach((h, i) => th.append(el('th', i > 2 ? 'n' : null, h))); const hd = el('thead'); hd.append(th); tbl.append(hd);
    const tb = el('tbody'); p.trades.slice(0, 15).forEach((t) => { const tr = el('tr'); tr.append(el('td', null, (t.at || '').slice(5, 16).replace('T', ' ')), coinCell({ coin: t.coin, chain: t.chain, pool: t.pool }, true), el('td', null, t.setup || '—'), el('td', 'n', usd0(t.size)), el('td', 'n', `${rr(t.R)}${t.open ? ' (open)' : ''}`), el('td', 'n ' + (t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : ''), (t.pnl >= 0 ? '+' : '') + usd0(t.pnl))); tb.append(tr); });
    tbl.append(tb); const sc = el('div', 'scroll'); sc.append(tbl); host.append(sc);
  }
  const f = fwdSummary(S.fwd);
  { const sh = (Array.isArray(S.fwd) ? S.fwd : []).filter((x) => x && x.shadow), cl = sh.filter((x) => x.resultR != null && x.status !== 'expired (no fill)'); if (sh.length) host.append(el('p', 'meta', `Background tracking of candidate patterns that are not live: ${sh.length} logged, ${cl.length} closed. Their results feed the learning loop, which can switch a pattern on once the data supports it.`)); }
  host.append(el('p', 'meta', f.total ? `Near-miss forward test (setups scoring 40 to 65, not shown as trades): ${f.total} logged, ${f.closed} closed` + (f.avgR != null ? `, ${rr(f.avgR)} average, ${Math.round(f.win * 100)}% won.` : '.') + ' Used by the learning loop to check whether the 65 cut-off is in the right place.' : 'Near-miss forward test: collecting. Setups scoring 40 to 65 are logged on each full scan and followed with the same rules.'));
}

// ---------- main ----------
const S = { fwd: [], setups: [], signals: [], charts: new Map(), vol: [], meta: null, bt: null, watch: new Map(), watchAt: null, learned: null, usage: null, patFilter: 'All', volChain: 'All', chain: 'All', sort: 'opp' };
const openCount = () => S.signals.filter((s) => s.status === 'open' || s.status === 'waiting for entry').length;
function fill(host, rows, mk, empty) {
  host.replaceChildren();
  if (!rows.length) { host.append(el('p', 'empty', empty)); return; }
  rows.forEach((r) => host.append(card(r, S.charts.get(r.id))));
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
  const pats = rows.filter((r) => r.patName && r.patScore >= 45), bots = rows.filter((r) => r.bottomed);
  const closed = S.signals.filter((s) => s.resultR != null && s.status !== 'expired (no fill)'), wins = closed.filter((s) => s.resultR > 0).length;
  const avg = closed.length ? closed.reduce((a, s) => a + Number(s.resultR), 0) / closed.length : null;
  [['Bid-ready', bid.length, 'all 7 gates pass', '#34d399'], ['Worth watching', watch.length, 'close to bid-ready', '#ee6a4b'], ['Chart patterns', pats.length, `${pats.filter((r) => r.patReady).length} bid-ready`, '#a78bfa'], ['Bottomed out', bots.length, 'turning up from oversold', '#e0e1e0'],
    ['Open positions', `${openCount()}`, 'signals still open or waiting', '#e0e1e0'],
    ['Signal log', closed.length ? `${Math.round(wins / closed.length * 100)}%` : '—', closed.length ? `win rate · avg ${rr(avg)} · ${closed.length} closed` : 'no closed signals yet', '#a8a8a8']]
    .forEach(([l, v, n, c]) => { const d = el('div', 'tile'); d.style.setProperty('--c', c); d.append(el('div', 'lbl', l), el('div', 'big', v), el('div', 'nt', n)); t.append(d); });
}

function draw() {
  const rows = S.setups.filter(chainOk), bid = rows.filter((r) => r.bidReady).map(viewAuto).sort(cmp());
  const watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch').map(viewAuto).sort(cmp());
  tiles(S.setups); controls();
  $('bidEmpty').hidden = bid.length > 0; $('bidEmpty').textContent = 'Nothing is bid-ready right now. That is a valid answer: no coin has passed all 7 gates, so the rules say wait.';
  fill($('bidList'), bid, null, ''); if (!bid.length) $('bidList').replaceChildren();
  fill($('watchList'), watch, null, 'Nothing is close to bid-ready right now.');
  // patterns + bottoms
  const chips = $('patChips'); chips.replaceChildren();
  const cnt = (n) => n === 'All' ? rows.filter((r) => r.patName && r.patScore >= 45).length + rows.filter((r) => r.bottomed && !(r.patName && r.patScore >= 45)).length : n === 'Bottomed out' ? rows.filter((r) => r.bottomed).length : rows.filter((r) => r.patName === n && r.patScore >= 45).length;
  ['All', ...PATS, 'Bottomed out'].forEach((n) => { const b = el('button', 'chip' + (S.patFilter === n ? ' on' : ''), `${n} (${cnt(n)})`); b.type = 'button'; b.onclick = () => { S.patFilter = n; draw(); }; chips.append(b); });
  let list = [];
  const pv = rows.filter((r) => r.patName && r.patScore >= 45).map((r) => patView(r)), bv = rows.filter((r) => r.bottomed).map(botView);
  if (S.patFilter === 'All') list = [...pv, ...bv.filter((b) => !pv.some((p) => p.id === b.id))]; else if (S.patFilter === 'Bottomed out') list = bv; else list = pv.filter((r) => r.patName === S.patFilter);
  list.sort((a, b) => (b.patReady || b.bidReady ? 1 : 0) - (a.patReady || a.bidReady ? 1 : 0) || cmp()(a, b));
  fill($('patList'), list.slice(0, 24), null, 'No coins match this filter in the latest scan.');
  // log
  const tb = $('logTbl').tBodies[0]; tb.replaceChildren();
  if (!S.signals.length) { const tr = el('tr'); const td = el('td', null, 'No bid-ready signals logged yet.'); td.colSpan = 7; tr.append(td); tb.append(tr); }
  S.signals.forEach((s) => { const tr = el('tr'); const res = s.resultR != null ? s.resultR : s.openR; const c7 = el('td', 'n ' + (res > 0 ? 'pos' : res < 0 ? 'neg' : ''), res == null ? '—' : rr(res) + (s.resultR == null ? ' (open)' : ''));
    tr.append(el('td', null, (s.signalAt || '').slice(0, 16).replace('T', ' ')), coinCell(s), el('td', null, s.setup || 'Setup not recorded'), el('td', null, `${fp(s.entryLow)}–${fp(s.entryHigh)}`), el('td', null, fp(s.stop)),
      el('td', null, s.status + (s.tpHit ? ` · TP${s.tpHit} hit` : '')), c7); tb.append(tr); });
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
  const closed = S.signals.filter((s) => s.resultR != null && s.status !== 'expired (no fill)'), avg = closed.length ? closed.reduce((a, s) => a + Number(s.resultR), 0) / closed.length : null;
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
  const c = S.signals.filter((s) => s.resultR != null && s.status !== 'expired (no fill)').sort((a, b) => String(a.closedAt || a.signalAt).localeCompare(String(b.closedAt || b.signalAt)));
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
    (!L.promote.length && !L.demote.length ? 'No setup has earned or lost its place yet. Candidate patterns are tracked silently and only go live once their results clear zero with a 90% confidence interval. ' : '') + `Overall ${t.n} closed trades, ${rr(t.avgR)} average.`;
  const lab = { proven: 'Proven', failing: 'Failing', promising: 'Promising', weak: 'Weak', unproven: 'Unproven' };
  L.setups.forEach((x) => { const tr = el('tr'); tr.append(el('td', null, x.setup + (x.live ? '' : ' (candidate, not live)')), el('td', 'n', x.n), el('td', 'n', Math.round(x.winRate * 100) + '%'), el('td', 'n ' + (x.avgR > 0 ? 'pos' : 'neg'), rr(x.avgR)),
    el('td', 'n', x.lo90 != null ? `${rr(x.lo90)} to ${rr(x.hi90)}` : '—'), el('td', 'v-' + x.verdict, lab[x.verdict] + (x.need ? ` (needs ~${x.need} more)` : ''))); tb.append(tr); });
  (L.insights || []).forEach((i) => ul.append(el('li', null, i)));
  drawEdge(L); drawAnalysts(L);
  if (L.best && L.best.length) ul.append(el('li', null, 'Best trades so far: ' + L.best.map((b) => `${b.coin} ${b.setup} ${rr(b.resultR)}`).join(' · ')));
}
// ---------- data loading ----------
const store = { get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: fine */ } } };
function guessRepo() { const saved = store.get('rynoRepo'); if (saved) return saved; const m = location.hostname.match(/^([^.]+)\.github\.io$/), p = location.pathname.split('/').filter(Boolean)[0]; return m && p ? m[1] + '/' + p : ''; }
async function loadAll() {
  const [setups, signals, charts, vol, meta, bt, watch, learned, usage, fwd] = await Promise.all([getJ('setups.json', []), getJ('signals.json', []), getJ('charts.json', []), getJ('chainvol.json', []), getJ('meta.json', null), getJ('backtest.json', null), getJ('watch.json', null), getJ('learned.json', null), getJ('usage.json', null), getJ('forward.json', [])]);
  const arr = (x) => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []), obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
  S.setups = arr(setups); S.signals = arr(signals); S.fwd = arr(fwd); S.charts = new Map(arr(charts).filter((c) => c.id != null).map((c) => [c.id, c])); S.vol = arr(vol); S.usage = obj(usage) ? usage : null; S.meta = obj(meta) && meta.scannedAt ? meta : null; S.bt = obj(bt) && Array.isArray(bt.byType) && bt.overall ? bt : null;
  S.learned = obj(learned) && Array.isArray(learned.setups) ? { ...learned, promote: Array.isArray(learned.promote) ? learned.promote : [], demote: Array.isArray(learned.demote) ? learned.demote : [], insights: Array.isArray(learned.insights) ? learned.insights : [], total: obj(learned.total) || {} } : null; try { C.applyLearned(learned); } catch { /* ignore */ }
  S.watch = new Map(arr(watch && watch.items).filter((w) => w.id != null).map((w) => [w.id, w])); S.watchAt = watch && watch.at && watch.scanAt === (meta && meta.scannedAt) ? watch.at : (watch && watch.at) || null;
  if (S.live && S.meta && S.live.at > Date.parse(S.meta.scannedAt)) { const m = S.live; S.setups = S.setups.map((r) => m.fresh.get(r.id) || r).filter((r) => r.mine || r.opp == null || r.opp > (S.meta.minOpp ?? 65) || !m.fresh.has(r.id)); m.charts.forEach((c, id) => S.charts.set(id, c)); }
  header(); verdict(); draw(); fearGreed(); drawBacktest(); drawLearn(); try { drawPaper(); } catch { /* keep the page alive */ } stamp();
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
