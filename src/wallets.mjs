// Who is trading a pool: reads the pool's recent trades from the market-data feed (no extra key) and turns them into wallet counts.
// Optional watch-list of wallets you consider good traders: config/smartwallets.json  { "wallets": [ { "address": "...", "label": "name" } ] }.
// The feed does not say which wallets are profitable, so "good traders" only means the addresses you put in that file.
import { walletStats } from '../docs/degen.mjs';
export function parseTrades(j) {
  const d = j && Array.isArray(j.data) ? j.data : []; const out = [];
  for (const x of d) { const a = x && x.attributes; if (!a || !a.tx_from_address) continue; const ts = Date.parse(a.block_timestamp); out.push({ kind: a.kind, wallet: a.tx_from_address, usd: Number(a.volume_in_usd), ts: isFinite(ts) ? ts / 1000 : null }); }
  return out;
}
// Net buyers / net sellers in the trades on hand: wallet, net dollars. Used by the wallet scorecard (src/scorecard.mjs).
export function netFlows(trades, min = 150, cap = 30) {
  const m = new Map(); for (const t of trades || []) { if (!t || !t.wallet || !isFinite(t.usd)) continue; const x = m.get(t.wallet) || { b: 0, s: 0, k: 0 }; x.k++; if (t.kind === 'buy') x.b += t.usd; else if (t.kind === 'sell') x.s += t.usd; m.set(t.wallet, x); }
  const all = [...m].map(([w, x]) => [w, x.b - x.s, x]);
  return { buyers: all.filter(([, n, x]) => n >= min && x.b >= 2 * x.s).sort((a, b) => b[1] - a[1]).slice(0, cap).map(([w, n, x]) => [w, Math.round(n), x.k]),
    sellers: all.filter(([, n, x]) => -n >= min && x.s >= 2 * x.b).sort((a, b) => a[1] - b[1]).slice(0, cap).map(([w, n, x]) => [w, Math.round(-n), x.k]) };
}
export async function fetchWallets(get, net, pool, smart = []) {
  try { const j = await get(`/networks/${net}/pools/${pool}/trades`), tr = parseTrades(j), st = walletStats(tr, smart); if (st && typeof st === 'object') { const f = netFlows(tr);
      Object.defineProperty(st, 'netBuyers', { value: f.buyers, enumerable: false }); Object.defineProperty(st, 'netSellers', { value: f.sellers, enumerable: false }); } // not saved with the stats: addresses stay in the scorecard file only
    return st; } catch { return null; }
}
export function loadSmart(readJson, file = 'config/smartwallets.json') {
  const j = readJson(file, {}); const w = Array.isArray(j.wallets) ? j.wallets : []; return w.filter((x) => x && typeof x.address === 'string' && x.address.length >= 20).map((x) => ({ address: x.address.trim(), label: x.label ? String(x.label).slice(0, 24) : null }));
}
