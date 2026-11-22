// one-off probe (22 Nov): Collector Crypt recent sales -> what buyers actually pay vs insured value, and buyback rates. Deleted after.
const UA = { 'user-agent': 'RynoScan card finder (github.com/devonflap/RYNOSCAN)', accept: 'application/json' };
const CC = 'https://api.collectorcrypt.com', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJ(u) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); return r.ok ? await r.json() : { err: r.status }; } catch (e) { return { err: e.message }; } }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(p * (s.length - 1))].toFixed(3) : null; };
for (const cat of ['Pokemon', 'One Piece', 'Dragon Ball', '']) { const L = await getJ(`${CC}/card-activity/recent-sales${cat ? '?category=' + encodeURIComponent(cat) : ''}`); await sleep(800);
  if (!Array.isArray(L)) { console.log(cat, JSON.stringify(L).slice(0, 200)); continue; }
  const bb = [], mk = [], mk100 = [], types = {}; let first = null, last = null;
  for (const s of L) { const ins = +(s.card && s.card.insuredValue), amt = +s.amount, to = (s.to && s.to.name) || '', from = (s.from && s.from.name) || ''; if (!(ins > 0 && amt > 0)) continue; const r = amt / ins;
    types[s.action + (to ? ' to ' + to : '')] = (types[s.action + (to ? ' to ' + to : '')] || 0) + 1; first = first || s.createdAt; last = s.createdAt;
    if (/buyback/i.test(to)) bb.push(r); else { mk.push(r); if (ins >= 65) mk100.push(r); } }
  console.log(`\n== ${cat || 'all'}: ${L.length} sales ${last} .. ${first}`); console.log('types', JSON.stringify(types).slice(0, 400));
  console.log(`buybacks n=${bb.length} ratio p10/median/p90 ${q(bb, 0.1)} ${q(bb, 0.5)} ${q(bb, 0.9)}`);
  console.log(`market sales n=${mk.length} ratio p10/p25/median/p75/p90 ${q(mk, 0.1)} ${q(mk, 0.25)} ${q(mk, 0.5)} ${q(mk, 0.75)} ${q(mk, 0.9)}; insured >= US$65: n=${mk100.length} median ${q(mk100, 0.5)} p25 ${q(mk100, 0.25)}`);
  if (cat === 'Pokemon') { console.log('sample keys: ' + Object.keys(L[0]).join(',')); console.log('card buyback flag sample: ' + L.slice(0, 40).map((s) => s.card && s.card.getBuybackOffer).join(' ')); } }
// is there a buyback quote for a card without signing in?
const one = await getJ(`${CC}/marketplace?step=5&cardType=Card&categories=Pokemon&insuredValueMin=100`); for (const c of (one.filterNFtCard || []).slice(0, 3)) { for (const p of [`marketplace/cards/${c.nftAddress}/buyback-offer`, `cards/publicNft/${c.nftAddress}/buyback`]) { const r = await getJ(`${CC}/${p}`); console.log(p.slice(0, 40), JSON.stringify(r).slice(0, 150)); await sleep(400); } }
