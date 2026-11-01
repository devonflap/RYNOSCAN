// the scanner's volume list (1 Nov): the Volume rider's rules on GitHub, for Ryan to trade by hand
import { volumeList, stageOf } from '../src/volume.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = 1800000000;
function chart() { const B = []; let t = T0, px = 1; for (let i = 0; i < 8; i++) { B.push([t, px, px * 1.02, px * 0.98, px, 2000]); t += 900; }
  for (let i = 0; i < 16; i++) { const n = 1 + (1.5 * (i + 1)) / 16; B.push([t, px, n * 1.01, px * 0.99, n, 40000]); px = n; t += 900; }
  for (let i = 0; i < 12; i++) { const n = 2.5 - (1 * (i + 1)) / 12; B.push([t, px, px * 1.005, n * 0.995, n, 15000]); px = n; t += 900; }
  for (let i = 0; i < 16; i++) { const c = i % 2 ? 1.65 * 0.98 : 1.5 * 1.02; B.push([t, px, 1.65, 1.5, c, 3000]); px = c; t += 900; } return { B, now: (t + 60) * 1000 }; }
const { B, now } = chart(), flat = B.map((b) => [b[0], 1, 1.01, 0.99, 1, 5000]);
const pool = (id, sym, h6) => ({ id: 'solana_' + id, attributes: { name: sym + ' / SOL', reserve_in_usd: 100000, volume_usd: { h1: h6 / 6, h6, h24: h6 * 3 } }, relationships: { base_token: { data: { id: 'solana_' + sym + 'M' } } } });
const page = { data: [pool('P1', 'HI', 900000), pool('P2', 'FLAT', 600000)], included: [{ id: 'solana_HIM', attributes: { symbol: 'HI', address: 'HIM', name: 'HI' } }, { id: 'solana_FLATM', attributes: { symbol: 'FLAT', address: 'FLATM', name: 'FLAT' } }] };
const prev = { seen: { OLD: { coin: 'OLD', chain: 'solana', token: 'OLDM', pair: 'OLD / SOL', first: new Date(now - 30 * 3600e3).toISOString(), last: new Date(now - 20 * 3600e3).toISOString(), h6max: 2e6 }, GONE: { coin: 'GONE', chain: 'solana', token: 'G', first: new Date(now - 80 * 3600e3).toISOString(), last: new Date(now - 60 * 3600e3).toISOString(), h6max: 1e6 } }, holders: { P1: [[now - 100 * 60e3, 1000]] } };
const fetchJson = async (u) => (u.includes('/robinhood/') ? { data: [] } : u.includes('_pools') || u.includes('pools?sort') ? page : u.includes('/P1/ohlcv') || u.includes('/OLD/ohlcv') ? { data: { attributes: { ohlcv_list: u.includes('/P1/') ? B : B } } } : u.includes('/ohlcv') ? { data: { attributes: { ohlcv_list: flat } } } : u.includes('/info') ? { data: { attributes: { holders: { count: 1080, distribution_percentage: { top_10: 21 } } } } } : null);
const r = await volumeList({ fetchJson, now, prev });
const hi = r.items.find((x) => x.coin === 'HI'), old = r.items.find((x) => x.coin === 'OLD'), fl = r.items.find((x) => x.coin === 'FLAT');
ok(r.listN === 2 && r.watchedN === 1 && !r.seen.GONE && r.seen.OLD && r.seen.P1, 'on the list now: HI and FLAT; OLD (on the list 20 hours ago) still watched; GONE (60 hours ago) dropped');
ok(hi && hi.status === 'setup' && hi.plan.stopPct > 5 && hi.plan.sells.length === 2 && hi.plan.sells[1].pct > hi.plan.sells[0].pct && hi.plan.moonbag === 30, `HI basing after its first dip: a setup with the plan (stop ${hi && hi.plan.stopPct}%, sells at +${hi && hi.plan.sells[0].pct}% and +${hi && hi.plan.sells[1].pct}%, 30% moonbag)`);
ok(old && old.status === 'setup' && !old.onList, 'OLD has left the list but is basing: shown as a setup (the reason the bot bought nothing)');
ok(fl && fl.status === 'waiting' && fl.stage === 'no run yet', 'FLAT never ran: waiting, "no run yet"');
ok(hi.holders === 1080 && hi.top10 === 21 && hi.holderGrowthPct === 8 && r.items[0].status === 'setup', 'holders for the coins basing: 1,080, top 10 at 21%, +8% since 100 minutes ago; setups listed first');
ok(stageOf('still running: no first dip yet') === 'running' && stageOf('gave back 95% of the run: broken, not a dip') === 'broken' && stageOf('not a base yet (40% range over 3 hours)') === 'dip, no base yet', 'each waiting coin says where it is up to');
process.exit(f);
