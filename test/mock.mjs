// Deterministic fake market for offline tests: pool lists, hourly candles, search and the second-opinion feed.
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const NETS = ['solana', 'eth', 'robinhood'];
const COUNT = { solana: 48, eth: 16, robinhood: 40 };
const lerp = (a, b, t) => a + (b - a) * t;
function closes(seed, type, N = 1000) {
  const R = rng(seed), out = []; let p = 1;
  const seg = (to, n, vol) => { const from = p; for (let i = 1; i <= n; i++) { p = lerp(from, to, i / n) * (1 + (R() - 0.5) * vol); out.push(p); } };
  const walk = (n, drift, vol) => { for (let i = 0; i < n; i++) { p *= 1 + drift + (R() - 0.5) * vol; out.push(p); } };
  if (type === 0) walk(N, 0, 0.04);
  else if (type === 1) { walk(N - 160, 0.0005, 0.03); seg(p * 0.45, 110, 0.02); seg(p * 1.25, 50, 0.025); }
  else if (type === 2) { walk(N - 330, 0, 0.03); seg(p * 0.5, 80, 0.02); seg(p * 0.75, 70, 0.02); seg(p * 0.5, 70, 0.02); seg(p * 0.78, 70, 0.02); seg(p * 0.84, 40, 0.02); }
  else if (type === 3) { walk(N - 200, 0.0006, 0.035); seg(p * 1.5, 30, 0.02); for (let i = 0; i < 6; i++) { seg(p * 0.97, 12, 0.012); seg(p * 1.01, 12, 0.012); } }
  else { walk(N - 120, -0.0004, 0.045); seg(p * 0.6, 100, 0.03); seg(p * 0.7, 20, 0.03); }
  while (out.length < N) out.unshift(out[0]); return out.slice(-N);
}
export function installMock(g = globalThis, opts = {}) {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const pools = {};
  for (const n of NETS) {
    pools[n] = [];
    for (let i = 0; i < COUNT[n]; i++) {
      const sd = hash(n + i), R = rng(sd);
      const sym = (n[0] + 'XYZ' + i).toUpperCase().replace(/[^A-Z0-9]/g, '');
      pools[n].push({ id: n + '_pool_' + i, addr: n === 'solana' ? 'So' + sd.toString(36).padEnd(40, 'a') + i : '0x' + sd.toString(16).padStart(8, '0').repeat(5) + i.toString(16).padStart(2, '0'),
        tokenAddr: 'tok' + sd, sym, name: sym + ' Coin', type: i % 5, price: 0.001 + R() * 2, liq: 60000 + Math.exp(R() * Math.log(40)) * 80000, v24: 90000 * Math.exp(R() * Math.log(80)),
        ch24: (R() - 0.5) * 40, ageDays: 5 + R() * 200 });
    }
  }
  const find = (net, addr) => pools[net]?.find(p => p.addr.toLowerCase() === String(addr).toLowerCase());
  const asPool = p => ({ id: p.id, attributes: { address: p.addr, name: p.sym + ' / SOL', base_token_price_usd: String(p.price), reserve_in_usd: String(p.liq), fdv_usd: String(p.liq * 20), volume_usd: { h24: String(p.v24), h1: String(p.v24 / 24 * 1.2) },
      price_change_percentage: { h24: String(p.ch24) }, pool_created_at: new Date((now - p.ageDays * 86400) * 1000).toISOString(),
      transactions: { h1: { buys: 30, sells: 24, buyers: 20, sellers: 18 }, h24: { buys: 700, sells: 620, buyers: 400, sellers: 380 } } },
    relationships: { base_token: { data: { id: p.tokenAddr } } } });
  const included = ps => ps.map(p => ({ id: p.tokenAddr, attributes: { symbol: p.sym, name: p.name, address: p.tokenAddr } }));
  const calls = { gt: 0, dex: 0 };
  g.__mockCalls = calls;
  const json = (o, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => o });
  g.fetch = async (url, init) => {
    url = String(url);
    if (opts.fail429 && !g.__did429 && url.includes('/ohlcv/')) { g.__did429 = true; return json({}, 429); }
    if (url.includes('dexscreener.com')) {
      calls.dex++; const m = url.match(/pairs\/(\w+)\/(.+)$/); const net = { ethereum: 'eth' }[m[1]] || m[1];
      const pairs = m[2].split(',').map(a => find(net, a)).filter(Boolean).map(p => ({ pairAddress: p.addr, chainId: m[1], priceUsd: String(p.price), baseToken: { address: p.tokenAddr, symbol: p.sym, name: p.name }, fdv: p.liq * 20, pairCreatedAt: Date.now() - p.ageDays * 864e5, volume: { h24: p.v24 * 1.05, h1: p.v24 / 24 }, txns: { h1: { buys: 30, sells: 22 } }, liquidity: { usd: p.liq }, priceChange: { h6: p.ch24 / 4 },
        marketCap: p.liq * 20, info: { socials: p.type % 2 ? [{}] : [], websites: [{}] } }));
      return json({ pairs });
    }
    if (url.includes('ntfy.sh')) { (g.__ntfy = g.__ntfy || []).push({ url, body: init && init.body }); console.log('[mock ntfy] ' + String(init && init.body).split('\n')[0]); return json({}, 200); }
    if (url.includes('rugcheck.xyz')) {
      const t = url.match(/tokens\/([^/]+)\//)[1], h = hash(t) % 7;
      if (/\/report$/.test(url)) return json({ mintAuthority: null, freezeAuthority: null, topHolders: h === 2 ? [{ owner: 'w1', pct: 20 }, { owner: 'w2', pct: 15 }, { owner: 'pool', pct: 40 }] : [{ owner: 'w1', pct: 4, insider: h === 5 }, { owner: 'w2', pct: 3 }], markets: [{ pubkey: 'pool', lp: { lpLockedPct: h === 3 ? 5 : 100 } }] });
      return json({ risks: h === 0 ? [{ name: 'Freeze Authority still enabled', level: 'danger' }] : h === 1 ? [{ name: 'Low amount of LP Providers', level: 'warn' }] : [] });
    }
    if (url.includes('gopluslabs.io')) { const t = url.split('contract_addresses=')[1].toLowerCase(), h = hash(t) % 6; if (url.includes('/4663?')) return json({ result: {} }); return json({ result: { [t]: { is_honeypot: h === 0 ? '1' : '0', sell_tax: '0.01', is_mintable: h === 1 ? '1' : '0' } } }); }
    if (url.includes('blockscout.com/api/v2/tokens/')) { const t = url.split('/tokens/')[1].split('/')[0], h = hash(t) % 3; return json({ items: [{ address: { hash: '0x1', is_contract: false }, value: h === 0 ? '500' : '50', token: { total_supply: '1000' } }, { address: { hash: '0xpool', is_contract: true }, value: '300', token: { total_supply: '1000' } }] }); }
    if (url.includes('/coins/') && url.includes('market_chart')) {
      const down = url.includes('/solana/'), prices = [], T = Date.now(); for (let i = 0; i < 60 * 24; i++) { const f = i / (60 * 24); prices.push([T - (60 * 24 - i) * 3600e3, 100 * (down ? 1.3 - 0.5 * f : 0.8 + 0.5 * f) * (1 + 0.01 * Math.sin(i / 5))]); }
      return json({ prices });
    }
    calls.gt++;
    const u = new URL(url.replace(/^https:\/\/(pro-api|api)\.(coingecko|geckoterminal)\.com\/(api\/v[23]\/(onchain)?)?/, 'https://x/'));
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'networks' && parts[2] === 'pools' && parts[4] === 'ohlcv') {
      const p = find(parts[1], parts[3]); if (!p) return json({}, 404);
      const c = closes(hash(p.addr), p.type), list = [];
      for (let i = 0; i < c.length; i++) { const R = rng(hash(p.addr) + i), o = i ? c[i - 1] : c[0], cl = c[i], hi = Math.max(o, cl) * (1 + R() * 0.01), lo = Math.min(o, cl) * (1 - R() * 0.01);
        list.push([now - (c.length - 1 - i) * 3600, o * p.price, hi * p.price, lo * p.price, cl * p.price, (R() + 0.2) * p.v24 / 24 * (i > c.length - 8 ? 1.8 : 1)]); }
      return json({ data: { attributes: { ohlcv_list: list.reverse() } } });
    }
    if (parts[0] === 'networks' && parts[2] === 'pools') {
      const ps = pools[parts[1]].slice().sort((a, b) => b.v24 - a.v24); const page = Number(u.searchParams.get('page') || 1);
      const sel = ps.slice((page - 1) * 20, page * 20); return json({ data: sel.map(asPool), included: included(sel) });
    }
    if (parts[0] === 'networks' && parts[2] === 'trending_pools') {
      const ps = pools[parts[1]].slice().sort((a, b) => b.ch24 - a.ch24); const page = Number(u.searchParams.get('page') || 1);
      const sel = ps.slice((page - 1) * 10, page * 10); return json({ data: sel.map(asPool), included: included(sel) });
    }
    if (parts[0] === 'search' && parts[1] === 'pools') {
      const q = u.searchParams.get('query').toLowerCase(), net = u.searchParams.get('network');
      const sel = (pools[net] || []).filter(p => p.sym.toLowerCase() === q || p.tokenAddr.toLowerCase() === q || p.addr.toLowerCase() === q);
      return json({ data: sel.map(asPool), included: included(sel) });
    }
    return json({}, 404);
  };
  return { pools };
}
