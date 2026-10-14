// Social presence from DexScreener's free pair data (the links a project has put on its listing: X, Telegram, website, Discord).
// This is presence only, not follower counts or influencer mentions (those need paid data). Record-only: shown on the card and
// tested by the learning loop; it never changes a score.
export const SLUG = { solana: 'solana', eth: 'ethereum', robinhood: 'robinhood' };
export function parsePair(q) {
  const i = q && q.info; if (!i) return null;
  const socials = Array.isArray(i.socials) ? i.socials : [], webs = Array.isArray(i.websites) ? i.websites : [];
  const find = (t) => { const s = socials.find((x) => x && String(x.type || x.platform || '').toLowerCase() === t); return s && s.url ? String(s.url) : null; };
  const x = find('twitter'), tg = find('telegram'), dc = find('discord'), web = webs[0] && webs[0].url ? String(webs[0].url) : null;
  const n = [x, tg, dc, web].filter(Boolean).length;
  return { x, tg, dc, web, n, level: n === 0 ? 'none' : n >= 3 ? 'full' : 'some' };
}
// pools: scored rows. getJson(url) -> JSON or null. Mutates p.soc. Returns { looked, applied }.
export async function enrich(pools, { getJson, sleep = async () => {}, max = 150 }) {
  const want = pools.filter((p) => p && p.token && SLUG[p.net || p.chain]).slice(0, max), by = {};
  let looked = 0, applied = 0;
  for (let i = 0; i < want.length; i += 30) {
    const batch = want.slice(i, i + 30); looked += batch.length;
    let j = null; try { j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${batch.map((p) => p.token).join(',')}`); } catch { j = null; }
    for (const q of (j && j.pairs) || []) { const s = parsePair(q), k = String(q.chainId).toLowerCase() + '|' + String(q.baseToken && q.baseToken.address).toLowerCase(); if (s && !by[k]) by[k] = s; }
    await sleep(250);
  }
  for (const p of want) { const s = by[SLUG[p.net || p.chain] + '|' + String(p.token).toLowerCase()]; if (s) { p.soc = s; applied++; } else if (Object.keys(by).length) { p.soc = { n: 0, level: 'none', x: null, tg: null, dc: null, web: null }; applied++; } }
  return { looked, applied };
}
