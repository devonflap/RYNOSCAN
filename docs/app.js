// RynoScan dashboard. Reads data/*.json written by src/scan.mjs (no build step, no libraries).
import * as C from './core.mjs';
import { discoverPools } from './pools.mjs';
import { checkToken, applyOverlays } from './overlays.mjs';

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
const PATS = ['Bull flag', 'Inverse H&S', 'Cup & handle', 'Falling wedge', 'Double bottom', 'Trend pullback'];

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
  for (let g = 0; g <= 4; g++) { const v = lo + (hi - lo) * g / 4; svg.append(sv('line', { x1: 0, x2: pw, y1: y(v), y2: y(v), stroke: '#7daaff', 'stroke-opacity': .1 })); }
  const clip = (v) => v != null && v >= lo && v <= hi;
  if (r.entryLow != null && r.entryHigh != null) {
    const a = y(Math.min(hi, Number(r.entryHigh))), b = y(Math.max(lo, Number(r.entryLow)));
    svg.append(sv('rect', { x: 0, y: a, width: pw, height: Math.max(2, b - a), fill: '#38e1f8', 'fill-opacity': .16 }));
  }
  const labs = [];
  const line = (v, color, label, dash) => { if (v == null) return; v = Number(v); const inR = clip(v), yy = y(Math.min(hi, Math.max(lo, v)));
    svg.append(sv('line', { x1: 0, x2: pw, y1: yy, y2: yy, stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': dash || '', 'stroke-opacity': inR ? .95 : .5 }));
    labs.push({ y: yy, color, label: label + (inR ? '' : v > hi ? ' ↑' : ' ↓') }); };
  line(r.stop, '#f87171', 'STOP'); line(r.tp1, '#6ee7b7', 'TP1'); line(r.tp2, '#34d399', 'TP2'); line(r.tp3, '#10b981', 'TP3');
  if (r.entryHigh != null) line(r.entryHigh, '#38e1f8', 'ENTRY', '4 3');
  if (r.price != null) line(r.price, '#eaf1ff', 'NOW', '2 3');
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
    ov.pts.forEach((p) => { if (p[0] >= 0) svg.append(sv('circle', { cx: x(p[0]), cy: y(Number(p[1])), r: 3.6, fill: '#a78bfa', stroke: '#050d22' })); });
  }
  svg.append(sv('text', { x: 2, y: H - 2, fill: '#9db4e3', 'font-size': 9.5 }, `last ${n} four-hour candles · volume below`));
  return svg;
}
const lvVal = (r, label) => ({ STOP: r.stop, TP1: r.tp1, TP2: r.tp2, TP3: r.tp3, ENTRY: r.entryHigh })[label.replace(/ [↑↓]/, '')];

// ---------- coin card ----------
function takeLine(r) {
  const pos = [], neg = [];
  if (r.rvol4h != null && r.rvol4h >= 1.3) pos.push(`volume is ${num(r.rvol4h)}x its norm`);
  if (r.conf != null) (r.conf >= 5 ? pos : neg).push(`market data ${r.conf >= 5 ? 'confirms it' : 'only partly agrees'} (${r.conf}/6)`);
  if (r.buySell24h != null) (r.buySell24h >= 1 ? pos : neg).push(`${r.buySell24h >= 1 ? 'buyers' : 'sellers'} lead 24h (${num(r.buySell24h, 2)})`);
  if (r.caution) neg.push(r.caution);
  return { pos, neg };
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
function card(r, cr) {
  const c = el('article', 'plan'), t = el('div', 't');
  const h = el('div'); h.append(el('b', null, r.coin), el('span', 'meta', `  ${r.chain} · ${r.setupType || r.patName || 'Bottom reversal'}${r.mine ? ' · your search' : ''}`));
  t.append(h, el('span', 'badge ' + r._cls, r._lab)); c.append(t);
  const sc = el('div', 'score'); sc.append('Opportunity ', el('b', null, r.opp != null ? r.opp : '—'), `· gates ${r.gatesPassed ?? '—'}/7`, `· risk to stop ${r.riskPct != null ? num(r.riskPct) + '%' : '—'}`, `· upside to TP3 ${r.upsidePct != null ? '+' + num(r.upsidePct, 0) + '%' : '—'}`);
  c.append(sc);
  if (cr && r.entryLow != null) c.append(candleChart(r, cr));
  if (r.entryLow != null && r.stop != null) c.append(levels(r));
  else c.append(el('p', 'caut', r.noTradeWhy || r.scanState || 'No valid trade plan on the current 4h chart: no clean stop that pays at least 2R.'));
    const g = el('div', 'gates'); r._g.forEach(([k, lab]) => g.append(el('span', 'g ' + (r[k] ? 'y' : 'n'), (r[k] ? '✓ ' : '✗ ') + lab))); c.append(g);
  if (r.rug === 'ok') c.append(el('p', 'ok-line', '✓ Token checks clear (no mint/freeze control, honeypot or tax flags found)'));
  else if (r.rug === 'warn') c.append(el('p', 'caut', 'Token flags: ' + (r.rugFlags || 'see contract')));
  else if (r.rug === 'unchecked' || (r.rug == null && S.meta && S.meta.safetyOn)) c.append(el('p', 'caut', 'Token not checked by the safety feed: look at the contract and top holders yourself before buying.'));
  if (r.regime === 'Risk-off') c.append(el('p', 'caut', 'Market is risk-off for this chain: reversals fail more often. Size down.'));
  const { pos, neg } = takeLine(r);
  if (pos.length) c.append(el('p', 'meta', 'For: ' + pos.join('; ') + '.'));
  if (neg.length) c.append(el('p', 'caut', 'Against: ' + neg.join('; ') + '.'));
  if (r.missing && !r.bidReady && !(r._pat && r.patReady)) c.append(el('p', 'caut', 'Still needs: ' + r.missing.split(',').filter(Boolean).join(', ')));
  const f = el('div', 'facts');
  [['24h volume', usd(r.vol24h)], ['Liquidity', usd(r.liquidity)], ['24h change', pct(r.chg24h)], ['RSI 1h / 4h', `${num(r.rsi1h, 0)} / ${num(r.rsi4h, 0)}`], ['Buyers / sellers', `${r.buyers24h ?? '—'} / ${r.sellers24h ?? '—'}`], ['Age', r.ageDays != null ? num(r.ageDays, 0) + ' d' : '—']]
    .forEach(([k, v]) => { const d = el('div'); d.append(k, el('b', null, v)); f.append(d); });
  c.append(f);
  if (r.flags) c.append(el('p', 'caut', 'Flags: ' + r.flags));
  return c;
}

// ---------- main ----------
const S = { setups: [], signals: [], charts: new Map(), vol: [], meta: null, bt: null, patFilter: 'All', volChain: 'All' };
const openCount = () => S.signals.filter((s) => s.status === 'open' || s.status === 'waiting for entry').length;
function fill(host, rows, mk, empty) {
  host.replaceChildren();
  if (!rows.length) { host.append(el('p', 'empty', empty)); return; }
  rows.forEach((r) => host.append(card(r, S.charts.get(r.id))));
}
const byOpp = (a, b) => (b.opp ?? 0) - (a.opp ?? 0);

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
  rows.forEach((d, i) => { const h = (d.volUsd / mx) * (H - 30), st = volState(d.ratio)[1], col = { strong: '#34d399', normal: '#38e1f8', below: '#fbbf24', poor: '#f87171', na: '#9db4e3' }[st];
    const r_ = sv('rect', { x: pad + i * bw + 2, y: H - 18 - h, width: bw - 4, height: h, rx: 3, fill: col, 'fill-opacity': d.daysAgo === 0 ? .95 : .55 }); r_.append(sv('title', {}, `${d.daysAgo === 0 ? 'Last 24h' : d.daysAgo + ' d ago'}: ${usd(d.volUsd)}`)); svg.append(r_);
    if (i % 2 === 0 || d.daysAgo === 0) svg.append(sv('text', { x: pad + i * bw + bw / 2, y: H - 4, 'text-anchor': 'middle', fill: '#9db4e3', 'font-size': 9 }, d.daysAgo === 0 ? 'now' : '-' + d.daysAgo + 'd')); });
  const by_ = H - 18 - (k.now.baseline7d / mx) * (H - 30);
  svg.append(sv('line', { x1: pad, x2: W, y1: by_, y2: by_, stroke: '#eaf1ff', 'stroke-dasharray': '5 4', 'stroke-opacity': .7 }), sv('text', { x: 2, y: by_ + 3, fill: '#9db4e3', 'font-size': 9 }, '7d avg'));
  host.append(svg);
}

function tiles(rows) {
  const t = $('tiles'); t.replaceChildren();
  const bid = rows.filter((r) => r.bidReady), watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch');
  const pats = rows.filter((r) => r.patName && r.patScore >= 45), bots = rows.filter((r) => r.bottomed);
  const closed = S.signals.filter((s) => s.resultR != null && s.status !== 'expired (no fill)'), wins = closed.filter((s) => s.resultR > 0).length;
  const avg = closed.length ? closed.reduce((a, s) => a + Number(s.resultR), 0) / closed.length : null;
  [['Bid-ready', bid.length, 'all 7 gates pass', '#34d399'], ['Worth watching', watch.length, 'close to bid-ready', '#fbbf24'], ['Chart patterns', pats.length, `${pats.filter((r) => r.patReady).length} bid-ready`, '#a78bfa'], ['Bottomed out', bots.length, 'turning up from oversold', '#38e1f8'],
    ['Open positions', `${openCount()}`, 'signals still open or waiting', '#38e1f8'],
    ['Signal log', closed.length ? `${Math.round(wins / closed.length * 100)}%` : '—', closed.length ? `win rate · avg ${rr(avg)} · ${closed.length} closed` : 'no closed signals yet', '#38a1ff']]
    .forEach(([l, v, n, c]) => { const d = el('div', 'tile'); d.style.setProperty('--c', c); d.append(el('div', 'lbl', l), el('div', 'big', v), el('div', 'nt', n)); t.append(d); });
}

function draw() {
  const rows = S.setups, bid = rows.filter((r) => r.bidReady).map(viewAuto).sort(byOpp);
  const watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch').map(viewAuto).sort(byOpp);
  tiles(rows);
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
  list.sort((a, b) => (b.patReady || b.bidReady ? 1 : 0) - (a.patReady || a.bidReady ? 1 : 0) || byOpp(a, b));
  fill($('patList'), list.slice(0, 24), null, 'No coins match this filter in the latest scan.');
  // log
  const tb = $('logTbl').tBodies[0]; tb.replaceChildren();
  if (!S.signals.length) { const tr = el('tr'); const td = el('td', null, 'No bid-ready signals logged yet.'); td.colSpan = 7; tr.append(td); tb.append(tr); }
  S.signals.forEach((s) => { const tr = el('tr'); const res = s.resultR != null ? s.resultR : s.openR; const c7 = el('td', 'n ' + (res > 0 ? 'pos' : res < 0 ? 'neg' : ''), res == null ? '—' : rr(res) + (s.resultR == null ? ' (open)' : ''));
    tr.append(el('td', null, (s.signalAt || '').slice(0, 16).replace('T', ' ')), el('td', null, `${s.coin} · ${s.chain}`), el('td', null, s.setup || '—'), el('td', null, `${fp(s.entryLow)}–${fp(s.entryHigh)}`), el('td', null, fp(s.stop)),
      el('td', null, s.status + (s.tpHit ? ` · TP${s.tpHit} hit` : '')), c7); tb.append(tr); });
  // all coins
  const ab = $('allTbl').tBodies[0]; ab.replaceChildren();
  rows.slice().sort(byOpp).forEach((r) => { const v = viewAuto(r), tr = el('tr');
    tr.append(el('td', null, r.coin), el('td', null, r.chain), el('td', null, v._lab), el('td', null, v.setupType || '—'), el('td', 'n', r.opp ?? '—'), el('td', 'n', r.conf != null ? r.conf + '/6' : '—'), el('td', 'n', (v.gatesPassed ?? '—') + '/7'),
      el('td', 'n', v.riskPct != null ? num(v.riskPct) : '—'), el('td', 'n', v.upsidePct != null ? num(v.upsidePct, 0) : '—'), el('td', 'n', usd(r.vol24h)), el('td', 'n', usd(r.liquidity))); ab.append(tr); });
  drawVolume();
}

function header() {
  const m = S.meta, rows = S.setups;
  if (!m) { $('take').textContent = 'No scan has run yet. Run the scanner once (see README) and this page fills in.'; $('sub').textContent = ''; return; }
  const bid = rows.filter((r) => r.bidReady), watch = rows.filter((r) => !r.bidReady && r.signal === 'Watch');
  const allv = S.vol.filter((d) => d.chain === 'All' && d.daysAgo === 0)[0], st = allv ? volState(allv.ratio) : null;
  const top = [...bid, ...watch].sort(byOpp).slice(0, 3).map((r) => { const v = viewAuto(r); return `${r.coin} (${v._lab.toLowerCase()}, opp ${r.opp}, ${v.upsidePct != null ? '+' + num(v.upsidePct, 0) + '% to TP3' : 'no plan'})`; }).join('; ');
  $('take').textContent = `${st ? `On-chain volume is ${st[0].toLowerCase()} today. ` : ''}${bid.length ? bid.length + ' bid-ready.' : 'Nothing is bid-ready.'} ${watch.length} worth watching.${top ? ' Best: ' + top + '.' : ''}`;
  const next = new Date(Date.parse(m.scannedAt) + 4 * 3600e3);
  const rg = m.regime ? [['SOL', m.regime.sol], ['ETH', m.regime.eth]].filter((x) => x[1]) : [], off = rg.filter((x) => x[1].level === 'Risk-off');
  let bn = $('regBanner'); if (!bn) { bn = el('p', 'banner'); bn.id = 'regBanner'; $('sub').after(bn); }
  bn.hidden = !rg.length; bn.className = 'banner' + (off.length ? '' : ' ok');
  bn.textContent = off.length ? `Market risk-off: ${off.map((x) => x[0] + ' (' + x[1].why.slice(0, 2).join(', ') + ')').join('; ')}. Reversals fail more often in a falling market, so size down or wait.` : `Market backdrop: ${rg.map((x) => x[0] + ' ' + x[1].level.toLowerCase()).join(', ')}.`;
  $('sub').textContent = `Last scan ${brisbane(m.scannedAt)} (${ago(m.scannedAt)}) · ${m.scoredN} of ${m.scannedN} coins scored, ${m.kept} above ${m.minOpp} · scans hourly, 6am–10pm Brisbane`;
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
async function lookup(q) {
  const out = $('lookupOut'); out.replaceChildren(); const ql = q.toLowerCase();
  const hits = S.setups.filter((r) => r.coin.toLowerCase() === ql || r.name?.toLowerCase() === ql || r.pool?.toLowerCase() === ql || r.id.toLowerCase() === ql);
  if (hits.length) { hits.forEach((r) => out.append(card(viewAuto(r), S.charts.get(r.id)))); return; }
  out.append(el('p', 'empty', `“${q}” is not above 65 in the latest scan, so I am scoring it live with the same rules…`));
  try {
    const log = [], { list } = await discoverPools(gget, { onlyMine: true, cap: {}, maxPools: 0, minLiquidity: 0, minVolume: 0 }, [q], (m) => log.push(m));
    const p = list[0]; if (!p) { out.replaceChildren(el('p', 'caut', `Could not find “${q}” on Solana, Robinhood Chain or Ethereum. Try the contract address, or prefix the chain, e.g. solana:BONK.`)); return; }
    const j = await gget(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
    const raw = j?.data?.attributes?.ohlcv_list;
    if (!raw || !C.techFromRaw(p, raw)) { out.replaceChildren(el('p', 'caut', `${p.sym} on ${C.CH[p.chain]} has fewer than 22 hours of candles, so it is too new to score safely.`)); return; }
    C.scoreList([p], Date.now());
    await C.crossCheck([p], { getJson: async (u) => (await fetch(u)).json(), sleep, log: () => {} });
    const sf = await checkToken(p, async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    applyOverlays([p], { safety: { [p.net + '|' + p.token]: sf }, regime: null });
    const row = C.toRow(p, new Date().toISOString()); row.rug = p.rug; row.rugFlags = p.rugFlags; if (sf.level === 'danger') row.noTradeWhy = 'token safety: ' + sf.flags[0]; const cr = p.h4 ? C.toChart(p) : null;
    out.replaceChildren(el('p', 'note', 'Live score, not part of the saved scan. Opportunity under 65 is not something the scanner would list.')); out.append(card(viewAuto(row), cr));
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
  const xw = $('btExitWrap'), xb = $('btExit').tBodies[0]; xb.replaceChildren();
  if (b.exitVariants && b.exitVariants.length) { xw.hidden = false; b.exitVariants.forEach((x) => { const tr = el('tr'); tr.append(el('td', null, x.name), el('td', 'n', x.closed), el('td', 'n', x.winRate != null ? Math.round(x.winRate * 100) + '%' : '—'), el('td', 'n ' + (x.avgR > 0 ? 'pos' : 'neg'), x.avgR != null ? rr(x.avgR) : '—'), el('td', 'n', x.profitFactor ?? '—')); xb.append(tr); }); } else xw.hidden = true;
  const ul = $('btNotes'); ul.replaceChildren(); b.notes.forEach((n) => ul.append(el('li', null, n)));
}
// ---------- data loading ----------
const store = { get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: fine */ } } };
function guessRepo() { const saved = store.get('rynoRepo'); if (saved) return saved; const m = location.hostname.match(/^([^.]+)\.github\.io$/), p = location.pathname.split('/').filter(Boolean)[0]; return m && p ? m[1] + '/' + p : ''; }
async function loadAll() {
  const [setups, signals, charts, vol, meta, bt] = await Promise.all([getJ('setups.json', []), getJ('signals.json', []), getJ('charts.json', []), getJ('chainvol.json', []), getJ('meta.json', null), getJ('backtest.json', null)]);
  S.setups = setups; S.signals = signals; S.charts = new Map(charts.map((c) => [c.id, c])); S.vol = vol; S.meta = meta; S.bt = bt;
  header(); draw(); fearGreed(); drawBacktest(); stamp();
}
// ---------- boot ----------
function stamp() {
  const u = $('updated'), m = S.meta; if (!u) return;
  if (!m || !m.scannedAt) { u.textContent = 'Last updated: no scan yet'; return; }
  const t = new Date(m.scannedAt), mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  const ago = mins < 2 ? 'just now' : mins < 90 ? mins + ' min ago' : mins < 2880 ? Math.round(mins / 60) + ' hours ago' : Math.round(mins / 1440) + ' days ago';
  let when; try { when = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(t) + ' Brisbane time'; } catch { when = t.toLocaleString(); }
  u.textContent = `Last updated: ${when} (${ago})`; u.classList.toggle('stale', mins > 180);
}
// ---------- refresh ----------
let refreshing = false;
async function refresh(manual) {
  if (refreshing) return; refreshing = true; const b = $('refreshBtn'); if (b) { b.disabled = true; b.textContent = 'Refreshing…'; }
  const before = S.meta ? S.meta.scannedAt : null;
  try { await loadAll(); } catch { /* keep what is on screen */ }
  if (b) { b.disabled = false; b.textContent = 'Refresh'; }
  if (manual) { const u = $('refreshNote'); if (u) { const fresh = S.meta && S.meta.scannedAt !== before; u.textContent = fresh ? 'New scan loaded.' : 'Already the latest scan.'; setTimeout(() => { u.textContent = ''; }, 6000); } }
  refreshing = false;
}
(async () => {
  await loadAll(); stamp(); setInterval(stamp, 60000);
  const b = $('refreshBtn'); if (b) b.addEventListener('click', () => refresh(true));
  setInterval(() => { if (!document.hidden) refresh(false); }, 5 * 60000);          // quiet refresh every 5 minutes
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.meta && Date.now() - Date.parse(S.meta.scannedAt) > 20 * 60000) refresh(false); }); // coming back to the tab
})();
