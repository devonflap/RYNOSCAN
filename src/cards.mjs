// THE CARD FINDER'S DAILY JOB (21 Nov). Pokémon (English and Japanese), One Piece and Dragon Ball singles, from tcgcsv.com: TCGplayer's market prices
// (raw, near mint, US dollars) refreshed once a day, and its daily price archives (from Feb 2024) for the history. The archives are kept
// between runs in GitHub's cache (data/cardarc, one small file per day: the three games only), so each run downloads one new day; the
// first run fills the last 3 weeks day by day and the 6 months before them week by week. Prices are shown in AUD at today's rate.
// Writes docs/cards/data/cards.json for the page (docs/cards/). Signals: src/cardsig.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CARD, stats, statusOf, horizonOf, newSetView, isDeal, dealScore } from './cardsig.mjs';
const BASE_GAMES = [{ id: 3, code: 'PK', name: 'Pokémon' }, { id: 68, code: 'OP', name: 'One Piece' }, { id: 85, code: 'PJ', name: 'Pokémon Japan' }];
let GAMES = BASE_GAMES; /* 21 Nov: plus every Dragon Ball category tcgcsv carries (Fusion World, Super, DBZ), looked up by name each run */
const BASE = 'https://tcgcsv.com', UA = 'RynoScan card finder (github.com/devonflap/RYNOSCAN)', ARC = process.env.CARD_ARC || 'data/cardarc', OUT = process.env.OUT_DIR || 'docs/cards/data';
const MIN_KEEP_USD = 20, DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), iso = (t) => new Date(t).toISOString().slice(0, 10);
async function getJ(u, tries = 4) { for (let a = 0; a < tries; a++) { try { const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch { /* retry */ } await sleep(1500 * (a + 1)); } return null; }
const ext = (p, k) => { const e = (p.extendedData || []).find((x) => x.name === k); return e ? String(e.value) : null; };
// one archive day -> { "pid|sub": usd } for the three games, saved small
async function archiveDay(day) { const f = path.join(ARC, `${day}.${GAMES.map((g) => g.id).join('-')}.json`); /* the file name carries the games in it, so adding a game refills the history */ if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* re-fetch */ } }
  const tmp = fs.mkdtempSync('/tmp/arc-'), a7 = path.join(tmp, 'a.7z');
  try { const r = await fetch(`${BASE}/archive/tcgplayer/prices-${day}.ppmd.7z`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120000) }); if (!r.ok) return null; fs.writeFileSync(a7, Buffer.from(await r.arrayBuffer()));
    execFileSync('7z', ['x', '-y', '-o' + tmp, a7, ...GAMES.map((g) => `${day}/${g.id}/*`), '-r'], { stdio: 'ignore' });
    const out = {}; for (const g of GAMES) { const d = path.join(tmp, day, String(g.id)); if (!fs.existsSync(d)) continue; for (const grp of fs.readdirSync(d)) { const pf = path.join(d, grp, 'prices'); if (!fs.existsSync(pf)) continue; let j; try { j = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch { continue; } for (const x of j.results || []) if (x.marketPrice >= MIN_KEEP_USD) out[x.productId + '|' + x.subTypeName] = +x.marketPrice.toFixed(2); } }
    fs.mkdirSync(ARC, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out)); return out; } catch (e) { console.log('archive ' + day + ': ' + e.message); return null; } finally { fs.rmSync(tmp, { recursive: true, force: true }); } }
export function sampleDays(now) { const days = new Set(); for (let i = 1; i <= 21; i++) days.add(iso(now - i * DAY)); for (let i = 28; i <= 182; i += 7) days.add(iso(now - i * DAY)); return [...days].sort(); }
async function main() { const now = Date.now(); fs.mkdirSync(OUT, { recursive: true });
  const cats = await getJ(`${BASE}/tcgplayer/categories`), db = ((cats && cats.results) || []).filter((c) => /dragon ?ball/i.test(c.name || c.displayName || '')).map((c) => ({ id: c.categoryId, code: 'DB', name: c.displayName || c.name }));
  GAMES = [...BASE_GAMES, ...db]; console.log('games: ' + GAMES.map((g) => `${g.name} (${g.id})`).join(', '));
  const fxj = await getJ('https://api.frankfurter.app/latest?from=USD&to=AUD'), fx = fxj && fxj.rates && fxj.rates.AUD > 1 ? fxj.rates.AUD : 1.53; console.log('USD to AUD ' + fx);
  // history from the archives
  const days = sampleDays(now), hist = {}; let got = 0; for (const d of days) { const a = await archiveDay(d); if (!a) continue; got++; const t = Date.parse(d + 'T12:00:00Z'); for (const [k, v] of Object.entries(a)) (hist[k] ||= []).push([t, v]); }
  console.log(`history: ${got} of ${days.length} archive days`);
  const tag = '.' + GAMES.map((g) => g.id).join('-') + '.json'; for (const f of fs.existsSync(ARC) ? fs.readdirSync(ARC) : []) if (f.slice(0, 10) < iso(now - 200 * DAY) || !f.endsWith(tag)) fs.rmSync(path.join(ARC, f));
  // today's prices, the sets and the cards
  const rows = [], upcoming = [], newSets = [];
  for (const g of GAMES) { const gj = await getJ(`${BASE}/tcgplayer/${g.id}/groups`); const groups = (gj && gj.results) || []; console.log(`${g.name}: ${groups.length} sets`);
    for (const grp of groups) { if (grp.isSupplemental) continue; const pub = Date.parse(grp.publishedOn || '') || null;
      const pj = await getJ(`${BASE}/tcgplayer/${g.id}/${grp.groupId}/prices`); await sleep(150); const prices = ((pj && pj.results) || []).filter((x) => x.marketPrice > 0 || x.midPrice > 0);
      const upcomingSet = pub && pub > now; if (!upcomingSet && !prices.some((x) => (x.marketPrice || 0) * fx >= 60) && !(pub && now - pub < CARD.newSetDays * DAY)) continue;
      const prj = await getJ(`${BASE}/tcgplayer/${g.id}/${grp.groupId}/products`); await sleep(150); const prods = new Map(((prj && prj.results) || []).filter((p) => ext(p, 'Number')).map((p) => [p.productId, p]));
      // a set's age: its release date, or how long its prices have been in the archives (some old sets carry a recent date)
      const inOld = prices.some((x) => { const h = hist[x.productId + '|' + x.subTypeName]; return h && h[0][0] < now - 150 * DAY; }), age = upcomingSet ? -Math.round((pub - now) / DAY) : Math.max(pub ? (now - pub) / DAY : 0, inOld ? 180 : 0);
      const cards = [];
      for (const x of prices) { const p = prods.get(x.productId); if (!p) continue; const usd = x.marketPrice || x.midPrice, k = x.productId + '|' + x.subTypeName;
        const series = [...(hist[k] || []), [now, usd]].map(([t, v]) => [t, +(v * fx).toFixed(2)]), s = stats(series, now);
        cards.push({ g: g.code, cat: g.code === 'DB' ? g.name : null, set: grp.name, setAbbr: grp.abbreviation || '', rel: pub ? iso(pub) : null, age: Math.round(age), name: p.name, num: ext(p, 'Number'), rar: ext(p, 'Rarity'), sub: x.subTypeName, img: (p.imageUrl || '').replace('_200w', '_400w'), url: p.url, aud: +(usd * fx).toFixed(2), low: x.lowPrice ? +(x.lowPrice * fx).toFixed(2) : null, thin: !!(x.lowPrice && x.marketPrice && x.lowPrice < 0.55 * x.marketPrice), s, series }); }
      if (upcomingSet) { if (pub - now < 120 * DAY) upcoming.push({ g: g.code, set: grp.name, abbr: grp.abbreviation, rel: iso(pub), days: Math.round((pub - now) / DAY), chase: cards.filter((c) => c.aud > 0).sort((a, b) => b.aud - a.aud).slice(0, 6).map(slim) }); continue; }
      if (age <= CARD.newSetDays && cards.some((c) => c.aud >= CARD.minAud)) { const v = newSetView(cards); /* only sets with a chase card worth A$100+ (no deck sets or mis-dated old kits) */ newSets.push({ g: g.code, set: grp.name, abbr: grp.abbreviation, rel: pub ? iso(pub) : null, age: Math.round(age), verdict: v.verdict, falling: v.falling, ready: v.ready, avgOff: +v.avgOff.toFixed(3), chase: v.chase.map(slim) }); }
      for (const c of cards) if (c.aud >= CARD.minAud * 0.6) rows.push(c); } }
  const deals = rows.filter((c) => c.age > CARD.newSetDays && isDeal(c)).sort((a, b) => dealScore(b) - dealScore(a)).slice(0, 250).map(slim);
  const out = { at: new Date(now).toISOString(), fx, band: [CARD.minAud, CARD.maxAud], historyDays: got, counts: { tracked: rows.length, deals: deals.length, newSets: newSets.length, upcoming: upcoming.length }, upcoming: upcoming.sort((a, b) => a.days - b.days), newSets: newSets.sort((a, b) => a.age - b.age), deals };
  fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify(out)); console.log(`cards: ${rows.length} tracked, ${deals.length} deals, ${newSets.length} new sets, ${upcoming.length} upcoming`); }
// what the page needs for one card: the numbers, the status, the hold length and a weekly price line
export function slim(c) { const s = c.s || {}, st = statusOf(c.s), sp = []; let last = 0; for (const p of c.series || []) if (p[0] - last >= 6.5 * DAY || p === c.series[c.series.length - 1]) { sp.push(Math.round(p[1])); last = p[0]; }
  return { g: c.g, cat: c.cat || null, set: c.set, abbr: c.setAbbr, rel: c.rel, age: c.age, name: c.name, num: c.num, rar: c.rar, sub: c.sub, img: c.img, url: c.url, aud: c.aud, low: c.low, thin: c.thin, erratic: !!s.erratic, ch7: r3(s.ch7), ch30: r3(s.ch30), off: r3(s.off), high: s.high != null ? Math.round(s.high) : null, highAt: s.highAt ? iso(s.highAt) : null, st: st.label, stKey: st.key, hz: horizonOf(c.age), sp }; }
const r3 = (x) => (x == null ? null : +x.toFixed(3));
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });
