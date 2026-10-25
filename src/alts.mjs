// Alts desk (Market Watcher style, "timing beats time"): one scan a day after the UTC daily close.
//   alts  -> the top ~80 USDT spot pairs on Gate.io (free, no key, not geo-blocked on GitHub's runners), daily candles
//   memes -> the same rules over the scanner's meme universe on daily on-chain candles (CoinGecko on-chain, needs the key)
// Writes docs/data/alts.json. Phone alerts (ntfy) on state changes worth acting on, position events and a Sunday digest.
// Settings (config/settings.json): altsAlerts (default true), altsUniverse (number of pairs, default 80), altsMinScore (default 60).
// Spot book: config/alts-positions.json  [{"symbol":"ENA","entry":0.215,"invalidation":0.171}]
import fs from 'node:fs';
import path from 'node:path';
import { makeApi } from './api.mjs';
import { analyse, regime, basketIndex, managePositions, P, P_MEME } from '../docs/mw.mjs';

const outDir = () => process.env.OUT_DIR || 'docs/data';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = readJson('config/settings.json', {});
const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'USD1', 'USDE', 'PYUSD', 'XUSD', 'USDD', 'GUSD', 'EUR', 'TRY', 'BRL', 'WBTC', 'WBETH', 'STETH', 'WETH', 'PAXG', 'XAUT', 'BTC', 'ETH']);
const LEV = /(3L|3S|5L|5S|UP|DOWN|BULL|BEAR)$/;
const fmt = (x) => (x >= 1000 ? Math.round(x).toLocaleString('en') : x >= 10 ? x.toFixed(2) : +x.toPrecision(4));

export async function gateUniverse(api, n = 80) {
  const t = await api.getJson('https://api.gateio.ws/api/v4/spot/tickers'); if (!Array.isArray(t)) return [];
  return t.filter((x) => x.currency_pair.endsWith('_USDT')).map((x) => ({ sym: x.currency_pair.slice(0, -5), pair: x.currency_pair, qv: +x.quote_volume }))
    .filter((x) => !STABLES.has(x.sym) && !LEV.test(x.sym) && x.qv > 0).sort((a, b) => b.qv - a.qv).slice(0, n);
}
export async function gateDaily(api, pair, limit = 200) {
  const j = await api.getJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=1d&limit=${limit}`); if (!Array.isArray(j)) return [];
  const bars = j.map((c) => [+c[0], +c[5], +c[3], +c[4], +c[2], +c[1]]).filter((b) => b[4] > 0).sort((a, b) => a[0] - b[0]);
  if (bars.length && bars.at(-1)[0] + 86400 > Date.now() / 1000) bars.pop();     // drop the still-open candle: we trade daily closes
  return bars;
}
async function memeDaily(api, net, pool, limit = 120) {
  const j = await api.get(`/networks/${net}/pools/${pool}/ohlcv/day?aggregate=1&limit=${limit}&currency=usd&token=base`);
  const raw = j?.data?.attributes?.ohlcv_list; if (!Array.isArray(raw)) return [];
  const bars = raw.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]); if (bars.length && bars.at(-1)[0] + 86400 > Date.now() / 1000) bars.pop(); return bars;
}

// one book of results from a map sym -> bars; the basket is built from the coins themselves
export function scoreBook(bars, btcCloses, { p = P, keep = 90 } = {}) {
  const syms = Object.keys(bars).filter((s) => bars[s].length >= 40); if (!syms.length) return { results: [], basket: [], basketRet: 0, btcRet: 0 };
  const basket = basketIndex(syms.map((s) => bars[s].map((b) => b[4]))), w = p.rsWindow;
  const basketRet = basket.length > w ? basket.at(-1) / basket.at(-1 - w) - 1 : 0, btcRet = btcCloses.length > w ? btcCloses.at(-1) / btcCloses.at(-1 - w) - 1 : 0;
  const results = syms.map((s) => { const r = analyse(s, bars[s], { basketRet, btcRet, p }); const k = bars[s].slice(-keep); r.offset = bars[s].length - k.length;
    r.candles = k.map((b) => [new Date(b[0] * 1000).toISOString().slice(0, 10), b[1], b[2], b[3], b[4]]); return r; }).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return { results, basket, basketRet, btcRet };
}

export async function runAlts({ api = makeApi(), log = console.log, out = path.join(outDir(), 'alts.json'), topic = process.env.NTFY_TOPIC } = {}) {
  const t0 = Date.now(), nUni = settings.altsUniverse || 80, minScore = settings.altsMinScore || P.minScore;
  // ---- alts
  const uni = await gateUniverse(api, nUni); log(`alts: ${uni.length} pairs from Gate.io`);
  const bars = {}, btcBars = await gateDaily(api, 'BTC_USDT'); let k = 0;
  for (const u of uni) { try { const b = await gateDaily(api, u.pair); if (b.length >= 40) bars[u.sym] = b; } catch (e) { log(`${u.sym}: ${e.message}`); } if (++k % 20 === 0) log(`candles ${k}/${uni.length}`); await api.sleep(120); }
  const btc = btcBars.map((b) => b[4]), A = scoreBook(bars, btc), reg = A.basket.length >= 40 && btc.length >= 40 ? regime(btc.slice(-A.basket.length), A.basket) : { label: 'UNKNOWN', note: 'not enough history for a regime call' };
  // ---- memes: the scanner's universe on daily on-chain candles (needs the data key; skipped on the free feed)
  const memes = {}, memeNames = {}; let memeNote = '';
  if (api.keyed) { const u = readJson(path.join(outDir(), 'universe.json'), []).filter((x) => x && x.pool && x.net).slice(0, 60); let m = 0;
    for (const x of u) { try { const b = await memeDaily(api, x.net, x.pool); if (b.length >= 40) { memes[x.id || x.sym] = b; memeNames[x.id || x.sym] = x; } } catch (e) { log(`${x.sym}: ${e.message}`); } if (++m % 20 === 0) log(`meme candles ${m}/${u.length}`); }
    memeNote = `${Object.keys(memes).length} of ${u.length} meme coins have 40+ days of history`; }
  else memeNote = 'meme setups need the CoinGecko key (CG_API_KEY) for daily on-chain candles';
  const M = scoreBook(memes, btc, { p: P_MEME }); M.results.forEach((r) => { const x = memeNames[r.symbol]; if (x) { r.coin = x.sym; r.chain = x.chain; r.pool = x.pool; r.net = x.net; } });
  // ---- spot book
  const posPath = 'config/alts-positions.json', positions = readJson(posPath, []), events = managePositions(positions, A.results, reg);
  try { fs.writeFileSync(posPath, JSON.stringify(positions, null, 1)); } catch { /* read-only checkout: fine */ }
  // ---- alerts: only on a state change worth acting on; never a BID on a Sunday (the weekly close)
  const statePath = path.join(path.dirname(out), 'alts-state.json'), prev = readJson(statePath, {}), next = {}, sunday = new Date().getUTCDay() === 0, sent = [];
  const firstRun = !Object.keys(prev).length, alertsOn = topic && settings.altsAlerts !== false;   // a first run (or a reset state file) would ping every coin at once: send only the digest
  const push = async (title, body, prio = 'default', tags = '') => { if (!alertsOn) return; try { const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body, headers: { Title: title, Priority: prio, Tags: tags } }); if (r.ok) sent.push(title); } catch (e) { log('ntfy: ' + e.message); } };
  for (const r of A.results) { next[r.symbol] = r.state; const was = prev[r.symbol]; if (r.state === was || r.score < minScore || firstRun) continue;
    if (r.state === 'BID' && sunday) { r.reasons.push('weekly close: not trading into it, re-check Monday'); continue; }
    if (r.state === 'DECISION') await push(`${r.symbol} · decision time`, `${r.pattern}, ${r.distToUpperPct > 0 ? '+' : ''}${r.distToUpperPct}% from the line, ${Math.round(r.pctThrough * 100)}% through. bid on a daily close above ${fmt(r.upperNow)}. invalidation ${fmt(r.invalidation)}. score ${r.score}`, 'default', 'hourglass');
    else if (r.state === 'BID') await push(`${r.symbol} · BID, wedge resolved`, `close ${fmt(r.lastClose)} through ${fmt(r.upperNow)} (${r.pattern}). invalidation ${fmt(r.invalidation)} · T1 ${fmt(r.t1)} · T2 ${fmt(r.t2)} · T3 ${fmt(r.t3)}. regime ${reg.label}. spot only, a size you can sit with.`, 'high', 'rocket');
    else if (r.state === 'INVALIDATED' && was) await push(`${r.symbol} · invalidated`, 'closed under the pattern low. structure gone: no bid, do nothing.', 'low', 'x'); }
  for (const r of M.results) { const key = 'M:' + r.symbol; next[key] = r.state; if (r.state === prev[key] || r.score < minScore || sunday || firstRun) continue;
    if (r.state === 'BID') await push(`${r.coin || r.symbol} (meme) · BID, ${r.pattern} resolved`, `daily close ${fmt(r.lastClose)} through ${fmt(r.upperNow)}. invalidation ${fmt(r.invalidation)} · T1 ${fmt(r.t1)} · T2 ${fmt(r.t2)}. meme rules: small size, clip 20% into strength, moonbag the rest.`, 'high', 'rocket'); }
  for (const [sym, kind, msg] of events) await push(`${sym} · ${kind}`, msg, kind === 'OUT' || kind === 'SL TO BE' ? 'high' : 'default', 'moneybag');
  if (sunday || firstRun) { const top = A.results.filter((r) => r.state !== 'NONE' && r.score >= minScore).slice(0, 6), rs = [...A.results].sort((a, b) => b.rsBasket - a.rsBasket).slice(0, 5);
    await push('weekly close check', `regime ${reg.label}. relative strength: ${rs.map((r) => `${r.symbol} ${r.rsBasket > 0 ? '+' : ''}${Math.round(r.rsBasket)}%`).join(', ')}. setups: ${top.map((r) => `${r.symbol} (${r.state.toLowerCase()})`).join(', ') || 'none'}. not trading into the close.`, 'default', 'calendar'); }
  fs.writeFileSync(statePath, JSON.stringify(next));
  const result = { at: new Date().toISOString().slice(0, 19) + 'Z', seconds: Math.round((Date.now() - t0) / 1000), regime: reg, basketRet14: +(A.basketRet * 100).toFixed(1), btcRet14: +(A.btcRet * 100).toFixed(1),
    universe: uni.length, scored: A.results.length, minScore, results: A.results, memes: M.results, memeNote, positions, positionEvents: events, alerts: sent, alertsOn: !!alertsOn };
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result));
  log(`regime ${reg.label}: ${reg.note}`); for (const r of A.results.filter((r) => r.state !== 'NONE').slice(0, 12)) log(`${r.symbol.padEnd(7)} ${r.state.padEnd(11)} ${r.pattern.padEnd(18)} ${r.score}  ${r.reasons.at(-1)}`);
  log(`memes: ${memeNote}; ${M.results.filter((r) => r.state !== 'NONE').length} with a setup. alerts sent: ${sent.length}`);
  return result;
}
if (process.argv[1] && process.argv[1].endsWith('alts.mjs')) runAlts().catch((e) => { console.error(e); process.exit(1); });
