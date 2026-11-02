// THE PERPS PLANNER on the page (1 Nov): search or pick a ticker, and the plan is built live from Gate.io's USDT perpetual charts (free,
// read straight from the page): a limit entry at real support, the stop past it, TPs at the next levels, and the money at your margin,
// leverage and loss limit. Settings are remembered on this phone only. The maths lives in perps.mjs (tested).
import { planTrade, sizeTrade, ticket, outcomes, pnlAt, fx, PERP } from './perps.mjs?v=d28fa405ea';
const GATE = 'https://api.gateio.ws/api/v4/futures/usdt';
const $ = (id) => document.getElementById(id), el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = { get: (k, d) => { try { const v = localStorage.getItem('rp-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('rp-' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
const S = { side: store.get('side', 'long'), margin: store.get('margin', 100), lev: store.get('lev', 5), sym: store.get('sym', 'UNI'), contracts: null };
async function getJ(u) { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const bars = (j) => (Array.isArray(j) ? j.map((b) => (Array.isArray(b) ? [+b[0], +b[5], +b[3], +b[4], +b[2], +b[1]] : [+b.t, +b.o, +b.h, +b.l, +b.c, +b.v])).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]) : []);
async function contracts() { if (S.contracts) return S.contracts; try { const j = await getJ(GATE + '/contracts'); S.contracts = new Map(j.filter((c) => /_USDT$/.test(c.name) && !c.in_delisting).map((c) => [c.name.replace(/_USDT$/, ''), c])); } catch { S.contracts = new Map(); } return S.contracts; }
export async function initPlanner({ desk = null } = {}) {
  const host = $('planOut'), form = $('planForm'); if (!host || !form) return;
  const C = await contracts(), dl = $('planList'); if (dl) dl.replaceChildren(...[...C.keys()].sort().map((k) => { const o = el('option'); o.value = k; return o; }));
  // quick picks: the Alts desk's live setups that trade as perps, then the big names
  const picks = $('planPicks'); if (picks) { const deskSyms = ((desk && desk.results) || []).filter((r) => r.state === 'DECISION' || r.state === 'WATCH').sort((a, b) => b.score - a.score).map((r) => r.symbol), base = ['BTC', 'ETH', 'SOL', 'UNI', 'LINK', 'AAVE', 'HYPE'];
    picks.replaceChildren(...[...new Set([...deskSyms, ...base])].filter((s) => !C.size || C.has(s)).slice(0, 14).map((s) => { const b = el('button', 'chip', s); b.type = 'button'; if (deskSyms.includes(s)) b.title = 'An Alts desk setup right now'; b.onclick = () => { $('planQ').value = s; run(s); }; return b; })); }
  // controls
  const side = $('planSide'), levs = $('planLev'); const paint = () => { side.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.dataset.v === S.side)); levs.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', +b.dataset.v === +S.lev)); const mc = $('planMarginChips'); if (mc) mc.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', +b.dataset.v === +S.margin)); };
  side.querySelectorAll('.chip').forEach((b) => { b.onclick = () => { S.side = b.dataset.v; store.set('side', S.side); paint(); run(S.sym); }; });
  levs.querySelectorAll('.chip').forEach((b) => { b.onclick = () => { S.lev = +b.dataset.v; store.set('lev', S.lev); paint(); if (S.last) draw(S.last); }; });
  { const mc = $('planMarginChips'); if (mc) mc.querySelectorAll('.chip').forEach((b) => { b.onclick = () => { S.margin = +b.dataset.v; store.set('margin', S.margin); $('planMargin').value = S.margin; paint(); if (S.last) draw(S.last); }; }); }
  for (const [id, k] of [['planMargin', 'margin']]) { const i = $(id); i.value = S[k]; i.onchange = () => { const v = Math.max(0, +i.value || 0); S[k] = v; store.set(k, v); paint(); if (S.last) draw(S.last); }; }
  form.onsubmit = (e) => { e.preventDefault(); const q = String($('planQ').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(USDT|USD|PERP)$/, ''); if (q) run(q); };
  $('planQ').value = S.sym; paint(); run(S.sym); scanDesk();
  // SETUPS NOW (1 Nov: "make it work as a scanner"): every alt on the desk with a perpetual, through the same planner on its daily chart,
  // ranked A first and then by how close the price is to the limit entry. Tap one for the full plan on the live 4-hour and daily charts.
  function scanDesk() { const box = $('planScan'); if (!box || !desk || !Array.isArray(desk.results)) return; const rows = [];
    for (const side of ['long', 'short']) for (const r of desk.results) { if (C.size && !C.has(r.symbol)) continue; const daily = (r.candles || []).map((c, i) => [i * 86400, +c[1], +c[2], +c[3], +c[4], 0]); if (daily.length < 30) continue;
      const c = C.get(r.symbol), price = c && +c.mark_price > 0 ? +c.mark_price : r.lastClose, p = planTrade({ daily, h4: [], price, side }); if (p.none || p.grade === 'C') continue;
      rows.push({ sym: r.symbol, side, grade: p.grade, away: Math.abs(price - p.entry) / price * 100, entry: p.entry, stopPct: p.stopPct, rr2: p.rr2, trend: p.trend.label }); }
    rows.sort((a, b) => (a.grade > b.grade ? 1 : a.grade < b.grade ? -1 : 0) || a.away - b.away); box.replaceChildren();
    if (!rows.length) { box.append(el('p', 'meta', 'No A or B setups on the desk right now. Search any ticker above.')); return; }
    /* 2 Nov: fits a phone: grade and side in the coin cell, short price figures, A setups first and B behind a button */
    const nA = rows.filter((x) => x.grade === 'A').length, nB = rows.length - nA, f4 = (x) => Number(Number(x).toPrecision(4)).toString();
    const table = (list) => { const t = el('table', 'tbl'); t.style.fontSize = '.8rem'; const th = el('thead'), hr = el('tr'); for (const h of ['Coin', 'Limit', 'Away', 'Stop', 'TP2']) hr.append(el('th', null, h)); th.append(hr); t.append(th); const tb = el('tbody');
      for (const x of list) { const r = el('tr'), c0 = el('td'), a = el('a', 'mw-name', x.sym); a.href = '#planner'; a.onclick = (e) => { e.preventDefault(); if (S.side !== x.side) { S.side = x.side; store.set('side', S.side); paint(); } $('planQ').value = x.sym; run(x.sym); $('planOut').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        const gr = el('b', null, x.grade + ' '); gr.style.color = x.grade === 'A' ? 'var(--ok)' : 'var(--warn)'; const sd = el('span', 'meta', x.side === 'long' ? ' long' : ' short'); sd.style.color = x.side === 'long' ? 'var(--ok)' : 'var(--bad)'; c0.append(gr, a, sd);
        r.append(c0, el('td', 'n', f4(x.entry)), el('td', 'n', x.away.toFixed(1) + '%'), el('td', 'n', '−' + x.stopPct.toFixed(1) + '%'), el('td', 'n', x.rr2 + 'R')); for (const td of r.children) td.style.padding = '7px 5px'; tb.append(r); }
      t.append(tb); const w = el('div'); w.style.overflowX = 'auto'; w.append(t); return w; };
    box.append(el('p', 'meta', `${nA} A setup${nA === 1 ? '' : 's'} across the desk's ${desk.results.length} alts, closest to its limit first (daily chart; tap a coin for the full plan).`));
    const A = rows.filter((x) => x.grade === 'A'); if (A.length) box.append(table(A.slice(0, 12))); else box.append(el('p', 'meta', 'No A setups right now.'));
    if (nB) { const d = el('details', 'fold'); d.append(el('summary', null, `${nB} B setups (half size or wait)`), table(rows.filter((x) => x.grade === 'B').slice(0, 25))); box.append(d); } }
  async function run(sym) { S.sym = sym; store.set('sym', sym); host.replaceChildren(el('p', 'meta', `Reading ${sym} from Gate.io…`));
    const c = C.get(sym); if (C.size && !c) { host.replaceChildren(el('p', 'warnline', `${sym} has no USDT perpetual on Gate.io. Check the ticker (e.g. UNI, LINK, HYPE).`)); return; }
    try { const name = sym + '_USDT', [d, h] = await Promise.all([getJ(`${GATE}/candlesticks?contract=${name}&interval=1d&limit=300`), getJ(`${GATE}/candlesticks?contract=${name}&interval=4h&limit=300`)]);
      let price = c && +c.mark_price > 0 ? +c.mark_price : 0; try { const tk = await getJ(`${GATE}/tickers?contract=${name}`); const t0 = Array.isArray(tk) ? tk[0] : tk; if (t0 && +t0.mark_price > 0) price = +t0.mark_price; else if (t0 && +t0.last > 0) price = +t0.last; } catch { /* the contract list price will do */ }
      const D = bars(d), H = bars(h); if (!(price > 0) && D.length) price = D[D.length - 1][4];
      S.last = { sym, D, H, price, mmr: c && +c.maintenance_rate > 0 ? +c.maintenance_rate : PERP.mmr, funding: c && c.funding_rate != null ? +c.funding_rate : null, maxLevX: c && +c.leverage_max > 0 ? +c.leverage_max : null, deskRow: ((desk && desk.results) || []).find((r) => r.symbol === sym) || null, at: Date.now() };
      draw(S.last); } catch (e) { host.replaceChildren(el('p', 'warnline', `Couldn't read ${sym} from Gate.io (${e.message}). Try again in a minute.`)); } }
  function draw(x) { const p = planTrade({ daily: x.D, h4: x.H, price: x.price, side: S.side }); host.replaceChildren();
    const head = el('p', 'meta', `${x.sym} perpetual ${fx(x.price)} · ${p.trend ? p.trend.label : '—'}${p.trend && p.trend.ch30 != null ? ` · ${p.trend.ch30 >= 0 ? '+' : ''}${p.trend.ch30}% in 30 days` : ''}${x.funding != null ? ` · funding ${(x.funding * 100).toFixed(4)}% per 8h` : ''}${x.deskRow && x.deskRow.state !== 'NONE' ? ` · Alts desk: ${x.deskRow.state} (${x.deskRow.pattern})` : ''}`); host.append(head);
    if (p.none) { host.append(el('p', 'warnline', `No ${S.side}: ${p.none}.`)); chart(host, x, null); return; }
    const s = sizeTrade(p, { margin: S.margin, lev: S.lev, mmr: x.mmr }); S.ticket = ticket(x.sym, p, s);
    const g = el('div', 'bb-block'), v = el('h3', null, p.verdict); v.style.color = p.grade === 'A' ? 'var(--ok)' : p.grade === 'B' ? 'var(--warn)' : 'var(--bad)'; g.append(v);
    const pct = (px) => { const d = ((px - p.entry) / p.entry) * 100; return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'; };
    const t = el('table', 'tbl'), tb = el('tbody'), row = (k, px, extra) => { const r = el('tr'); const ex = el('td', null, extra || ''); ex.style.whiteSpace = 'normal'; ex.style.minWidth = '9em'; const k0 = el('td', null, k); k0.style.whiteSpace = 'normal'; r.append(k0, el('td', 'n', fx(px)), el('td', 'n', px === p.entry ? '' : pct(px)), ex); tb.append(r); };
    row(`Entry (limit ${S.side === 'long' ? 'buy' : 'sell'})`, p.entry, `${((Math.abs(x.price - p.entry) / x.price) * 100).toFixed(1)}% from the price: wait for it`);
    row('Stop loss', p.stop, `−$${s.lossAtStop.toFixed(0)} (${s.lossPctMargin}% of the margin)`);
    s.tps.forEach((q, i) => row(`TP${i + 1} · close ${q.share}%`, q.px, `${q.r}R · +$${q.usd.toFixed(0)}${i === 0 ? ' · then stop to entry' : ''}${q.from !== 'level' ? ` · ${q.from}` : ''}`));
    row(`Liquidation at ${S.lev}x`, s.liq, s.warn.some((w) => /BEFORE/.test(w)) ? 'BEFORE the stop!' : `${s.liqPct}% away`);
    t.append(tb); const wrap = el('div'); wrap.style.overflowX = 'auto'; wrap.append(t); g.append(wrap);
    g.append(el('p', null, `Position $${s.notional.toFixed(0)} (${fx(s.qty)} ${x.sym}) on $${S.margin} margin at ${S.lev}x. All three TPs: +$${s.tps[s.tps.length - 1].total.toFixed(0)} (${s.tps[s.tps.length - 1].roe}% on the margin). Stopped out: −$${s.lossAtStop.toFixed(0)}. Safe leverage for this stop: ${Math.min(s.maxLev, x.maxLevX || 100, 20)}x at most.${x.funding != null ? ` Funding: about $${Math.abs(s.notional * x.funding).toFixed(2)} every 8 hours (${(S.side === 'long') === (x.funding > 0) ? 'you pay' : 'you receive'}).` : ''}`));
    // what you'll make: every way it can play out, and any price you type
    const mk = el('div', 'bb-block'); mk.append(el('h3', null, `What you'll make on $${S.margin} at ${S.lev}x`)); const ot = el('table', 'tbl'), ob = el('tbody');
    for (const o of outcomes(p, s)) { const r = el('tr'), v = el('td', 'n', (o.usd >= 0 ? '+$' : '−$') + Math.abs(o.usd).toFixed(2)); v.style.color = o.usd >= 0 ? 'var(--ok)' : 'var(--bad)'; v.style.fontWeight = '700'; const k = el('td', null, o.k); k.style.whiteSpace = 'normal'; r.append(k, v, el('td', 'n', (o.pctMargin >= 0 ? '+' : '') + o.pctMargin + '%')); ob.append(r); }
    ot.append(ob); mk.append(ot);
    const wf = el('form', 'lookup'), wi = el('input'), wr = el('p', 'meta', 'Type any price to see the profit or loss on the whole position if you closed it all there.'); wi.type = 'number'; wi.inputMode = 'decimal'; wi.step = 'any'; wi.placeholder = 'Close price, e.g. ' + fx(p.tps[1] ? p.tps[1].px : p.entry); wi.setAttribute('aria-label', 'Close price');
    const wb = el('button', null, 'Work it out'); wb.type = 'submit'; wf.append(wi, wb); wf.onsubmit = (e) => { e.preventDefault(); const q = pnlAt(p, s, +wi.value); if (!q) { wr.textContent = 'Type a price.'; return; } wr.textContent = q.liquidated ? `At ${fx(+wi.value)} the position is liquidated first: you lose the whole $${S.margin} margin.` : `Closed at ${fx(+wi.value)} (${q.movePct >= 0 ? '+' : ''}${q.movePct}% from the entry): ${q.usd >= 0 ? '+$' : '−$'}${Math.abs(q.usd).toFixed(2)}, ${q.pctMargin >= 0 ? '+' : ''}${q.pctMargin}% on your margin.`; wr.style.color = q.usd >= 0 ? 'var(--ok)' : 'var(--bad)'; };
    mk.append(wf, wr); g.append(mk);
    for (const w of s.warn) g.append(el('p', 'warnline', w));
    g.append(el('p', 'meta', p.why.join(' · ')));
    const cp = el('button', 'chip', 'Copy the order'); cp.type = 'button'; cp.onclick = async () => { try { await navigator.clipboard.writeText(S.ticket); cp.textContent = 'Copied'; } catch { const ta = el('textarea'); ta.value = S.ticket; document.body.append(ta); ta.select(); try { document.execCommand('copy'); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy failed'; } ta.remove(); } setTimeout(() => { cp.textContent = 'Copy the order'; }, 2000); };
    const bar = el('div', 'chips'); bar.append(cp); const tv = el('a', 'chip', 'TradingView'); tv.href = `https://www.tradingview.com/chart/?symbol=GATEIO:${x.sym}USDT.P`; tv.target = '_blank'; tv.rel = 'noopener'; bar.append(tv); g.append(bar);
    host.append(g); chart(host, x, p, s); }
  function chart(host, x, p, s) { const H = x.H.length ? x.H.slice(-120) : x.D.slice(-90); if (!H.length) return; const cv = el('canvas'); cv.style.width = '100%'; cv.style.height = '260px'; host.append(cv);
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 340, Hh = 260; cv.width = W * dpr; cv.height = Hh * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const lines = p ? [[p.entry, '#e8e5df', 'entry'], [p.stop, '#f05a62', 'stop'], ...p.tps.map((t, i) => [t.px, '#3fb37f', 'TP' + (i + 1)]), ...(s ? [[s.liq, '#9945ff', 'liq']] : [])] : [];
    let lo = Math.min(...H.map((b) => b[3])), hi = Math.max(...H.map((b) => b[2])); for (const [v] of lines) if (v > 0 && v < hi * 1.6 && v > lo * 0.5) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = (hi - lo) * 0.05; lo -= pad; hi += pad; const y = (v) => Hh - 14 - ((v - lo) / (hi - lo)) * (Hh - 24), bw = (W - 56) / H.length;
    H.forEach((b, i) => { const cx = 4 + i * bw + bw / 2, up = b[4] >= b[1]; g.strokeStyle = g.fillStyle = up ? '#3fb37f' : '#f05a62'; g.beginPath(); g.moveTo(cx, y(b[2])); g.lineTo(cx, y(b[3])); g.stroke(); const t = Math.min(y(b[1]), y(b[4])); g.fillRect(cx - Math.max(1, bw * 0.35), t, Math.max(2, bw * 0.7), Math.max(1, Math.abs(y(b[1]) - y(b[4])))); });
    g.font = '10px system-ui'; for (const [v, col, lab] of lines) { if (!(v > lo && v < hi)) continue; g.strokeStyle = col; g.setLineDash(lab === 'entry' ? [] : [4, 3]); g.beginPath(); g.moveTo(0, y(v)); g.lineTo(W - 52, y(v)); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.fillText(lab, W - 50, y(v) + 3); }
    g.fillStyle = '#9aa0a8'; g.fillText(x.H.length ? '4-hour candles' : 'daily candles', 4, 10); }
}
