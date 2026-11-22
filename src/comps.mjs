// SOLD COMPS FOR GRADED SLABS (23 Nov, Ryan: "build it all into the card scanner", from the deals research). Collector Crypt's insured value
// is its own number (set "at its discretion", used for buybacks) and can be stale or inflated, so a slab is judged against what that exact
// card in that exact grade has actually SOLD for elsewhere: PokemonPriceTracker's graded sales (eBay + Fanatics Collect, by grader and
// grade, English and Japanese Pokémon). Needs Ryan's PokemonPriceTracker API key in GitHub Secrets (PPT_API_KEY); without it nothing runs
// and the page keeps using Collector Crypt's valuation, labelled as such. One Piece and Dragon Ball have no affordable graded source yet.
// Writes docs/cards/data/comps.json: per TCGplayer product id, its recent graded sales.
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.env.OUT_DIR || 'docs/cards/data', KEY = process.env.PPT_API_KEY, BASE = 'https://www.pokemonpricetracker.com/api/v2', DAY = 86400e3;
export const COMP = { credits: +(process.env.PPT_CREDITS || 95), perCard: 2, keepDays: 3, maxAgeDays: 180, halfLifeDays: 30 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "PSA 10", "CGC 9.5", "BGS 9.5" -> { co: 'PSA', g: 10 }
export function parseGrade(s) { const m = String(s || '').match(/\b(PSA|CGC|BGS|SGC|BECKETT|TAG|ACE)\b[^0-9]*(\d+(?:\.5)?)/i); return m ? { co: m[1].toUpperCase().replace('BECKETT', 'BGS'), g: +m[2] } : null; }
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
// FAIR VALUE of one card in one grade from its sold listings [{ p: USD, d: ms, co, g, bo, pr }]: exact grader and grade (and printing when
// known), last 180 days, odd sales trimmed (outside 0.5-2x the first median), then a recency-weighted median (half-life 30 days).
export function fairValue(sales, { co, g, printing = null, now = Date.now(), C = COMP } = {}) {
  const S = (sales || []).filter((x) => x && x.p > 0 && x.co === co && +x.g === +g && (!printing || !x.pr || x.pr === printing) && (!x.d || now - x.d <= C.maxAgeDays * DAY));
  if (!S.length) return null; const m0 = median(S.map((x) => x.p)), T = S.filter((x) => x.p >= m0 * 0.5 && x.p <= m0 * 2); if (!T.length) return null;
  const W = T.map((x) => ({ p: x.p, w: x.d ? Math.pow(0.5, (now - x.d) / DAY / C.halfLifeDays) : 0.25 })).sort((a, b) => a.p - b.p), tot = W.reduce((s, x) => s + x.w, 0);
  let acc = 0, fv = W[W.length - 1].p; for (const x of W) { acc += x.w; if (acc >= tot / 2) { fv = x.p; break; } }
  const n30 = T.filter((x) => x.d && now - x.d <= 30 * DAY).length, n90 = T.filter((x) => x.d && now - x.d <= 90 * DAY).length, last = Math.max(0, ...T.map((x) => x.d || 0)) || null;
  const conf = n90 >= 8 && last && now - last <= 30 * DAY ? 'high' : n90 >= 5 ? 'medium' : T.length >= 3 ? 'low' : 'none';
  return { usd: +fv.toFixed(2), n: T.length, n30, n90, last, conf }; }
// PokemonPriceTracker's card -> our compact sales list (field names read defensively: the docs don't name the sale-date field)
export function salesFrom(card) { const e = (card && (card.ebay || card.graded)) || {}, L = e.soldListings || e.sales || [];
  const when = (x) => { for (const k of ['soldDate', 'dateSold', 'date', 'endTime', 'endDate', 'soldAt', 'timestamp']) if (x[k]) { const t = Date.parse(x[k]); if (t) return t; } return null; };
  return (Array.isArray(L) ? L : []).map((x) => { const pg = parseGrade(`${x.gradingCompany || x.grader || ''} ${x.grade || ''}`); return pg && +x.price > 0 ? { p: +x.price, d: when(x), co: pg.co, g: pg.g, bo: !!x.bestOfferAccepted, pr: x.printing || null } : null; }).filter(Boolean); }
// summary per grade (when individual sales are missing): { psa10: { count, medianPrice, smartMarketPrice } } -> a fallback value
export function gradeSummary(card, co, g) { const s = card && (card.ebay || {}).salesByGrade; if (!s) return null; const k = `${co.toLowerCase()}${String(g).replace('.', '_')}`, k2 = `${co.toLowerCase()}${g}`, v = s[k] || s[k2]; if (!v) return null;
  const usd = +(v.smartMarketPrice || v.medianPrice || v.averagePrice || 0); return usd > 0 ? { usd, n: +v.count || 0, n30: null, n90: null, last: null, conf: (+v.count || 0) >= 8 ? 'medium' : (+v.count || 0) >= 3 ? 'low' : 'none', summary: true } : null; }
async function fetchCard(id, lang) { for (let a = 0; a < 3; a++) { const r = await fetch(`${BASE}/cards/${id}?includeEbay=true${lang ? '&language=' + lang : ''}`, { headers: { authorization: 'Bearer ' + KEY }, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (r && r.ok) { const j = await r.json(); return { card: j.data || j, used: +(r.headers.get('x-api-calls-consumed') || (j.metadata && j.metadata.apiCallsConsumed) || COMP.perCard) }; }
  if (r && r.status === 429) { const w = +(r.headers.get('retry-after') || 30); if (w > 120) return { stop: true }; await sleep(w * 1000); continue; } if (r && (r.status === 401 || r.status === 403)) return { stop: true, auth: true }; if (r && r.status === 404) return { card: null, used: 1 }; await sleep(2000); } return { card: null, used: 0 }; }
async function main() { if (!KEY) { console.log('PokemonPriceTracker key not set up yet (PPT_API_KEY): sold comps skipped'); return; }
  const f = path.join(OUT, 'comps.json'), old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { cards: {} }, cards = old.cards || {}, now = Date.now();
  const sl = JSON.parse(fs.readFileSync(path.join(OUT, 'slabs.json'), 'utf8')), want = new Map();
  // the Pokémon slabs the page is suggesting, dearest first (the credits go furthest where the money is)
  for (const r of [...(sl.buys || []), ...(sl.items || [])].sort((a, b) => b.aud - a.aud)) { const id = r.raw && r.raw.id && String(r.raw.id).split('|')[0]; if (!id || !/^P[KJ]$/.test(r.g) || want.has(id)) continue; want.set(id, r.g === 'PJ' ? 'japanese' : ''); }
  let credits = COMP.credits, got = 0, fresh = 0, shape = null;
  for (const [id, lang] of want) { const c = cards[id]; if (c && now - c.at < COMP.keepDays * DAY) { fresh++; continue; } if (credits < COMP.perCard) break;
    const r = await fetchCard(id, lang); if (r.stop) { console.log(r.auth ? 'PokemonPriceTracker refused the key: check PPT_API_KEY' : 'PokemonPriceTracker daily limit reached'); break; } credits -= r.used || COMP.perCard; await sleep(1100);
    if (!r.card) continue; if (!shape) shape = Object.keys(r.card.ebay || {}).join(','); const S = salesFrom(r.card).filter((x) => !x.d || now - x.d <= COMP.maxAgeDays * DAY);
    cards[id] = { at: now, name: r.card.name || null, sales: S, byGrade: (r.card.ebay && r.card.ebay.salesByGrade) || null }; got++; }
  for (const [id, c] of Object.entries(cards)) if (now - c.at > 30 * DAY) delete cards[id];
  fs.writeFileSync(f, JSON.stringify({ at: new Date(now).toISOString(), cards }));
  console.log(`sold comps: ${want.size} Pokémon cards wanted, ${fresh} still fresh, ${got} fetched, ${credits} credits left${shape ? ` (graded fields: ${shape})` : ''}`); }
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e.message); process.exit(1); });
