// Who is trading a pool: reads the pool's recent trades from the market-data feed (no extra key) and turns them into wallet counts.
// Optional watch-list of wallets you consider good traders: config/smartwallets.json  { "wallets": [ { "address": "...", "label": "name" } ] }.
// The feed does not say which wallets are profitable, so "good traders" only means the addresses you put in that file.
import { walletStats } from '../docs/degen.mjs';
export function parseTrades(j) {
  const d = j && Array.isArray(j.data) ? j.data : []; const out = [];
  for (const x of d) { const a = x && x.attributes; if (!a || !a.tx_from_address) continue; const ts = Date.parse(a.block_timestamp); out.push({ kind: a.kind, wallet: a.tx_from_address, usd: Number(a.volume_in_usd), ts: isFinite(ts) ? ts / 1000 : null }); }
  return out;
}
export async function fetchWallets(get, net, pool, smart = []) {
  try { const j = await get(`/networks/${net}/pools/${pool}/trades`); return walletStats(parseTrades(j), smart); } catch { return null; }
}
export function loadSmart(readJson, file = 'config/smartwallets.json') {
  const j = readJson(file, {}); const w = Array.isArray(j.wallets) ? j.wallets : []; return w.filter((x) => x && typeof x.address === 'string' && x.address.length >= 20).map((x) => ({ address: x.address.trim(), label: x.label ? String(x.label).slice(0, 24) : null }));
}
