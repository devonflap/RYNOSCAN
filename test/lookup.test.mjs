// Runs the same steps the dashboard's "Check a coin" box runs, against the fake market.
import { installMock } from './mock.mjs';
import * as C from '../docs/core.mjs';
import { discoverPools } from '../docs/pools.mjs';
installMock(globalThis, {});
const GT = 'https://api.geckoterminal.com/api/v2';
const get = async (p) => { const r = await fetch(GT + p); return r.ok ? r.json() : null; };
const sample = await get('/networks/solana/pools?sort=h24_volume_usd_desc&page=1&include=base_token');
const sym = sample.included[0].attributes.symbol;
const { list } = await discoverPools(get, { onlyMine: true, cap: {}, maxPools: 0, minLiquidity: 0, minVolume: 0 }, [sym], () => {});
const p = list[0]; if (!p) throw new Error('lookup found nothing for ' + sym);
const j = await get(`/networks/${p.net}/pools/${p.pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base`);
if (!C.techFromRaw(p, j.data.attributes.ohlcv_list)) throw new Error('not scorable');
C.scoreList([p], Date.now());
await C.crossCheck([p], { getJson: async (u) => (await fetch(u)).json(), sleep: async () => {}, log: () => {} });
const row = C.toRow(p, new Date().toISOString()); C.toChart(p);
console.log('PASS lookup', sym, 'opp', row.opp, 'signal', row.signal, 'lists', list.length);
