// Alts desk and the meme "spot & chill" section: renders docs/data/alts.json (made by src/alts.mjs).
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmt = (x) => (x == null || !isFinite(x) ? '—' : x >= 1000 ? Math.round(x).toLocaleString('en') : x >= 10 ? x.toFixed(2) : x >= 1 ? x.toFixed(3) : x >= 0.001 ? x.toPrecision(3) : x.toPrecision(2));
const pc = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + Number(x).toFixed(1) + '%');
const STATE_CLS = { WATCH: 'mw-watch', DECISION: 'mw-decision', BID: 'mw-bid', INVALIDATED: 'mw-inval', NONE: 'mw-none' };

export function drawMwChart(cv, r, tf = '1d') {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 320, H = cv.clientHeight || 190; cv.width = W * dpr; cv.height = H * dpr;
  const intra = tf !== '1d' && r.tf && Array.isArray(r.tf[tf]) && r.tf[tf].length; /* 1h / 4h: the candles and the levels; the daily trendlines are drawn on the daily chart only */
  const g = cv.getContext('2d'); g.scale(dpr, dpr); const c = intra ? r.tf[tf] : r.candles || [], n = c.length; if (!n) return; const off = r.offset || 0, pad = { l: 6, r: 58, t: 10, b: 8 };
  let lo = Math.min(...c.map((x) => x[3])), hi = Math.max(...c.map((x) => x[2]));  [r.t1, r.t2, r.invalidation].forEach((v) => { if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); lo *= 0.985; hi *= 1.015;
  const x = (i) => pad.l + (i + 0.5) * (W - pad.l - pad.r) / n, y = (v) => pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b), bw = Math.max(2, (W - pad.l - pad.r) / n * 0.62);
  g.fillStyle = '#141414'; g.fillRect(0, 0, W, H); g.strokeStyle = '#2a2a2a'; g.lineWidth = 1;
  for (let k = 0; k < 5; k++) { const yy = pad.t + k * (H - pad.t - pad.b) / 4; g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke(); g.fillStyle = '#6a6a6a'; g.font = '10px sans-serif'; g.textAlign = 'left'; g.fillText(fmt(hi - (hi - lo) * k / 4), W - pad.r + 6, yy + 3); }
  const lvl = (v, col, lab) => { if (!(v > 0)) return; g.strokeStyle = col; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.font = 'bold 9.5px sans-serif'; g.textAlign = 'right'; g.fillText(lab, W - pad.r - 4, y(v) - 3); };
  lvl(r.invalidation, '#f8717199', 'INVAL'); lvl(r.t1, '#a8a8a899', 'T1'); lvl(r.t2, '#a8a8a899', 'T2'); if (intra) lvl(r.upperNow, '#fb923ccc', 'BID ABOVE (daily close)');
  if (r.fib && !intra) for (const [k, v] of Object.entries(r.fib)) if (v > lo && v < hi) lvl(v, '#a78bfa66', '0.' + k.slice(1));
  c.forEach((k, i) => { const up = k[4] >= k[1]; g.strokeStyle = g.fillStyle = up ? '#34d399' : '#f87171'; g.beginPath(); g.moveTo(x(i), y(k[2])); g.lineTo(x(i), y(k[3])); g.stroke(); const t = y(Math.max(k[1], k[4])), b = y(Math.min(k[1], k[4])); g.fillRect(x(i) - bw / 2, t, bw, Math.max(1, b - t)); });
  const line = (pts, col) => { if (!pts || pts.length < 2) return; const [a, b] = pts, m = (b[1] - a[1]) / (b[0] - a[0]), xa = a[0] - off, xb = n - 1 + 6; g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x(xa), y(a[1])); g.lineTo(x(xb), y(a[1] + m * (xb - xa))); g.stroke(); g.lineWidth = 1; };
  if (!intra) { line(r.upperPts, '#f87171'); line(r.lowerPts, '#34d399'); }
  if (!intra && r.lowerPts && r.lowerPts.length === 1) { g.strokeStyle = '#34d399'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x(r.lowerPts[0][0] - off), y(r.lowerPts[0][1])); g.lineTo(x(n + 5), y(r.lowerPts[0][1])); g.stroke(); }
  const last = c[n - 1][4]; g.fillStyle = last >= c[n - 1][1] ? '#34d399' : '#f87171'; g.fillRect(W - pad.r + 1, y(last) - 7, pad.r - 2, 14); g.fillStyle = '#111'; g.font = 'bold 10px sans-serif'; g.textAlign = 'left'; g.fillText(fmt(last), W - pad.r + 5, y(last) + 3.5);
}

export function mwCard(r, { meme = false } = {}) {
  const card = el('div', 'plan mw-card'), rrv = r.rPerUnit > 0 ? ((r.t2 - r.entry) / r.rPerUnit).toFixed(1) : '—';
  const top = el('div', 't'); const name = el('b', null, meme ? (r.coin || r.symbol) : r.symbol); const sub = el('span', 'meta', ` ${r.tf ? 'daily pattern' : '1D'} · ${r.pattern || 'no pattern'}${meme && r.chain ? ' · ' + r.chain : ''}`); top.append(name, sub);
  const right = el('span', 'score'); right.append('score ', el('b', null, String(r.score)), ' ', Object.assign(el('span', 'badge ' + (STATE_CLS[r.state] || 'mw-none'), r.state))); top.append(right); card.append(top);
  const cv = el('canvas', 'mw-cv'); let tf = '1d'; try { tf = localStorage.getItem('rynoAltsTf') || '1d'; } catch { /* storage off */ } if (tf !== '1d' && !(r.tf && r.tf[tf] && r.tf[tf].length)) tf = '1d';
  if (r.tf) { const bar = el('div', 'mw-tf'); for (const [k, lab] of [['1d', '1D'], ['4h', '4h'], ['1h', '1h']]) { if (k !== '1d' && !(r.tf[k] && r.tf[k].length)) continue; const b = el('button', 'chip' + (k === tf ? ' on' : ''), lab); b.type = 'button'; b.addEventListener('click', () => { tf = k; try { localStorage.setItem('rynoAltsTf', k); } catch { /* storage off */ } bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); cv._tf = tf; drawMwChart(cv, r, tf); }); bar.append(b); } card.append(bar); }
  card.append(cv); cv._r = r; cv._tf = tf;
  if (r.live && r.live.px > 0) card.append(el('div', 'mw-live', `now ${fmt(r.live.px)} (${String(r.live.at).slice(11, 16)} UTC) · ${r.live.toLinePct >= 0 ? 'above' : 'below'} the bid line by ${Math.abs(r.live.toLinePct)}% · ${r.live.toInvalPct}% over invalidation${r.state !== 'BID' && r.live.toLinePct > 0 ? ' · above the line intraday: the BID needs a DAILY close above it' : ''}`));
  const lv = el('div', 'mw-lv'); const box = (lab, val, cls) => { const d = el('div'); d.append(el('span', null, lab), Object.assign(el('b', cls, val))); return d; };
  lv.append(box('bid above', fmt(r.upperNow), 'mw-o'), box('invalidation', fmt(r.invalidation), 'mw-r'), box('T1 / T2', `${fmt(r.t1)} / ${fmt(r.t2)}`, 'mw-g'), box('R:R to T2', rrv)); card.append(lv);
  const meta = el('div', 'mw-meta'); const m = (lab, val, cls) => { const s = el('span', null, lab + ' '); s.append(Object.assign(el('b', cls, val))); return s; };
  meta.append(m('impulse', '+' + r.impulseGainPct + '%'), m('corr', r.corrBars + 'd'), m('retrace', r.retracePct + '%'), m('ATR7/21', String(r.compression)), m('through', Math.round((r.pctThrough || 0) * 100) + '%'), m('RS vs basket', pc(r.rsBasket), r.rsBasket >= 0 ? 'mw-g' : 'mw-r')); if (meme && r.fibLowAt) meta.append(m('low at fib', r.fibLowAt, r.fibLowAt === '0.786' || r.fibLowAt === '0.618' || r.fibLowAt === '0.886' ? 'mw-o' : '')); card.append(meta);
  card.append(el('div', 'mw-why', (r.reasons || []).join(' · ')));
  if (meme && r.deeper) card.append(el('div', 'caut', '⚠ ' + r.deeper));
  if (meme && r.pool) { const a = el('a', 'mw-link', 'DexScreener ↗'); a.href = `https://dexscreener.com/${r.net || r.chain}/${r.pool}`; a.target = '_blank'; a.rel = 'noopener'; card.append(a); }
  requestAnimationFrame(() => drawMwChart(cv, r, tf));
  return card;
}

function regimeStrip(d) {
  const reg = d.regime || {}, lab = reg.label || '—', cls = lab === 'BULL' ? 'mw-bid' : lab === 'OFF' ? 'mw-inval' : 'mw-decision';
  const s = el('div', 'mw-regime'); s.append(Object.assign(el('span', 'badge ' + cls, lab)), el('span', 'mw-note', reg.note || ''));
  const meta = el('div', 'mw-meta'); const m = (lab, val, cls) => { const x = el('span', null, lab + ' '); x.append(Object.assign(el('b', cls, val))); return x; };
  meta.append(m('BTC', fmt(reg.btc)), m('weekly support', fmt(reg.btcSupport)), m('basket 14d', pc(d.basketRet14), d.basketRet14 >= 0 ? 'mw-g' : 'mw-r'), m('BTC 14d', pc(d.btcRet14), d.btcRet14 >= 0 ? 'mw-g' : 'mw-r'), m('scanned', `${d.scored} of ${d.universe} alts`), m('updated', (d.at || '').replace('T', ' ').slice(0, 16) + ' UTC'));
  s.append(meta); return s;
}

// the desk's scoreboard (30 Oct): every BID booked on paper next to a random coin (docs/deskbook.mjs), one plain line
export function scoreLine(name, r) { if (!r || !r.bids) return `${name} scoreboard: starts with the next daily scan (every BID booked on paper, next to a random coin).`; const b = r.bids, x = r.random || {}; return b.n ? `${name} scoreboard: BIDs ${b.avg >= 0 ? '+' : ''}${b.avg}% a trade over ${b.n} (${b.win}% won); random coins the same days ${x.n ? (x.avg >= 0 ? '+' : '') + x.avg + '%' : '—'}${r.open ? `; ${r.open} open` : ''}${b.n < 30 ? '. Too few to judge yet.' : '.'}` : `${name} scoreboard: no BID closed yet${r.open ? ` (${r.open} open)` : ''}. Every BID is booked on paper, next to a random coin, and judged like every other book.`; }
export function drawAlts(d, root) {
  if (!root) return; root.innerHTML = '';
  if (!d || !Array.isArray(d.results)) { root.append(el('p', 'empty', 'No alts scan yet. Run the "RynoScan alts desk" workflow once (Actions tab); it then runs daily after the UTC close.')); return; }
  root.append(regimeStrip(d)); root.append(el('p', 'meta', scoreLine('Alts desk', d.record && d.record.alts)));
  const tabs = el('div', 'chips'), panes = {}, names = [['setups', 'Setups'], ['rs', 'Relative strength'], ['book', 'Spot book'], ['play', 'Playbook']];
  let cur = 'setups'; try { cur = localStorage.getItem('rynoAltsTab') || 'setups'; } catch { /* fine */ }
  names.forEach(([k, lab]) => { const b = el('button', 'chip' + (k === cur ? ' on' : ''), lab); b.type = 'button'; b.addEventListener('click', () => { cur = k; try { localStorage.setItem('rynoAltsTab', k); } catch { /* fine */ } tabs.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); Object.entries(panes).forEach(([pk, p]) => { p.hidden = pk !== k; }); if (k === 'setups') panes.setups.querySelectorAll('canvas').forEach((cv) => drawMwChart(cv, cv._r)); }); tabs.append(b); });
  root.append(tabs);
  // setups
  const live = d.results.filter((r) => r.state !== 'NONE' && r.score >= (d.minScore || 60)), grid = el('div', 'plans'); panes.setups = grid;
  if (!live.length) grid.append(el('p', 'empty', 'nothing worth a screen. comfy in spot.')); live.forEach((r) => { const c = mwCard(r); c.querySelector('canvas')._r = r; grid.append(c); });
  // relative strength
  const rsWrap = el('div', 'scroll'); panes.rs = rsWrap; const t = el('table', 'tbl'); t.innerHTML = '<thead><tr><th>coin</th><th class="n">vs basket 14d</th><th class="n">vs BTC 14d</th><th>state</th><th>pattern</th><th class="n">score</th><th>why not</th></tr></thead>';
  const tb = el('tbody'); [...d.results].sort((a, b) => b.rsBasket - a.rsBasket).slice(0, 60).forEach((r) => { const tr = el('tr'); const td = (txt, cls) => { const x = el('td', cls, txt); tr.append(x); return x; }; td(r.symbol).style.fontWeight = '700'; td(pc(r.rsBasket), 'n ' + (r.rsBasket >= 0 ? 'mw-g' : 'mw-r')); td(pc(r.rsBtc), 'n ' + (r.rsBtc >= 0 ? 'mw-g' : 'mw-r')); const sd = td(''); sd.append(Object.assign(el('span', 'badge ' + (STATE_CLS[r.state] || 'mw-none'), r.state))); td(r.pattern || '—'); td(r.score ? String(r.score) : '—', 'n'); td(r.state === 'NONE' ? (r.reasons || [])[0] || '' : '', 'mw-why'); tb.append(tr); }); t.append(tb); rsWrap.append(t);
  // book
  const book = el('div'); panes.book = book; const pos = d.positions || [];
  if (!pos.length) book.append(el('p', 'empty', 'no spot positions. add them to config/alts-positions.json on GitHub: [{"symbol":"ENA","entry":0.215,"invalidation":0.171}] — the art of doing nothing.'));
  else { const bt = el('table', 'tbl'); bt.innerHTML = '<thead><tr><th>coin</th><th class="n">entry</th><th class="n">stop</th><th class="n">R now</th><th class="n">held</th><th>clips</th></tr></thead>'; const bb = el('tbody');
    pos.forEach((q) => { const tr = el('tr'); const be = (q.stop ?? q.invalidation) >= q.entry; [[q.symbol, ''], [fmt(q.entry), 'n'], [fmt(q.stop ?? q.invalidation) + (be ? ' (BE)' : ''), 'n ' + (be ? 'mw-g' : '')], [((q.rMultiple ?? 0) >= 0 ? '+' : '') + (q.rMultiple ?? 0).toFixed(2) + 'R', 'n ' + ((q.rMultiple ?? 0) >= 0 ? 'mw-g' : 'mw-r')], [Math.round((q.size ?? 1) * 100) + '%', 'n'], [(q.clips || []).join(', ') || '—', '']].forEach(([v, c]) => tr.append(el('td', c, v))); bb.append(tr); }); bt.append(bb); book.append(el('div', 'scroll')).append(bt); }
  if ((d.positionEvents || []).length) { const ul = el('ul', 'note'); d.positionEvents.forEach((e) => { const li = el('li'); li.append(Object.assign(el('b', null, `${e[0]} · ${e[1]}`)), ' — ' + e[2]); ul.append(li); }); book.append(ul); }
  // playbook
  const play = el('div', 'mw-play'); panes.play = play; play.innerHTML = PLAYBOOK;
  Object.values(panes).forEach((p) => { p.hidden = true; root.append(p); }); panes[cur] ? (panes[cur].hidden = false) : (panes.setups.hidden = false);
}

export function drawMemeSetups(d, root) {
  if (!root) return; root.innerHTML = ''; if (d) root.append(el('p', 'meta', scoreLine('Spot & chill', d.record && d.record.memes)));
  const rows = d && Array.isArray(d.memes) ? d.memes.filter((r) => r.state !== 'NONE' && r.score >= (d.minScore || 60)) : [];
  if (!rows.length) { root.append(el('p', 'empty', d && d.memeNote ? `No meme coin is wedging or flagging on the daily right now (${d.memeNote}).` : 'No alts scan yet.')); return; }
  const grid = el('div', 'plans'); rows.forEach((r) => grid.append(mwCard(r, { meme: true }))); root.append(grid);
}

const PLAYBOOK = `
<h3>The idea</h3><p>Most of the money is made by sitting in a handful of quality spot positions through the HTF trend, buying only when a clean correction pattern <em>resolves</em>, and selling into momentum on the way up. One or two of these a year is enough if they're executed right. Everything else is observing.</p>
<p class="mw-q">"it's always you vs you · not trading into the weekly close · spot and chill"</p>
<h3>1 · Regime first</h3><ul><li><b>BULL</b>: BTC and the alt basket above their last weekly swing low and above the 20-day. Bids allowed.</li><li><b>BULL / CORRECTING</b>: structure intact, momentum off. Only bid clean HTF resolutions, no size, no leverage.</li><li><b>OFF</b>: weekly support lost. Reduce alt exposure. Nothing new.</li></ul>
<h3>2 · Impulse: the coin must have already moved</h3><p>A leg of at least +50% in the last 90 days (+100% for memes). We never bid the bottom; we bid the <em>second</em> move, after the market has shown its hand.</p>
<h3>3 · Compression: the correction must be a pattern</h3><ul><li><b>Falling wedge</b> (best): lower highs, lows falling slower than highs.</li><li><b>Bull flag</b>: parallel channel down.</li><li><b>Flat base / triangle</b>: highs falling, lows holding.</li><li>Retrace 20–75% of the impulse (80% for memes). Deeper and the leg is undone.</li><li>Range tightening: 7-day ATR under the 21-day. Quiet before the move.</li><li>Lines are drawn on touches, like on a chart, not regressions.</li></ul>
<h3>4 · Relative strength into the weekly close</h3><p>Every coin's 14-day return against the basket and BTC. The ones holding up while the market bleeds lead the next leg. Sunday evening: check it, don't trade it.</p>
<h3>5 · The trigger: "decision time"</h3><ul><li><b>WATCH</b>: pattern forming. Comfy in spot. Observe.</li><li><b>DECISION</b>: within 4% of the upper line or 70%+ through the wedge. Pay closer attention.</li><li><b>BID</b>: a <em>daily close</em> through the upper trendline, on volume. Entry is that close. Never on a Sunday.</li><li><b>INVALIDATED</b>: daily close under the pattern low. Structure gone, no bid, no excuses.</li></ul>
<h3>6 · Managing it: sell into momentum</h3><ul><li>Stop = invalidation. Size is whatever you can sit with when it hits.</li><li>+1R → <b>SL to BE</b>. Free trade; doing nothing is the job.</li><li><b>T1</b> the impulse high · <b>T2</b> entry + 0.618× the impulse · <b>T3</b> the full measured move. Clip 25% at each. The last 25% rides until the weekly structure breaks.</li><li>Regime flips to OFF → reduce, whatever the chart looks like.</li></ul>
<h3>Score (0–100)</h3><p>Pattern 20 · impulse 15 · healthy retrace 15 · compression 15 · relative strength 15 · maturity 10 · trigger 10 · reward:risk ≥ 2 to T2 +5. Under 60 isn't worth a screen.</p>
<h3>Routine</h3><p>One scan a day after the daily close. Alerts only on state changes and position events: a few a week at most. Sunday: the weekly close digest, then do nothing.</p>`;
