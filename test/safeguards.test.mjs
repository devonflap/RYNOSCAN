import { decide, STALE_MIN } from '../src/watchdog.mjs';
import { due, compose, bneDate } from '../src/digest.mjs';
import { enrich, parseInfo, growth } from '../src/holders.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const U = (s) => Date.parse(s);
// watchdog: Brisbane = UTC+10. 02:00Z = 12:00 Brisbane (day), 14:00Z = 00:00 Brisbane (night)
{ const now = U('2026-10-14T02:00:00Z');
  ok(decide({ scannedAt: '2026-10-14T01:15:00Z', now }).action === 'ok', 'watchdog: 45 min old is fine');
  const d = decide({ scannedAt: '2026-10-14T00:10:00Z', now }); ok(d.action === 'restart' && d.age === 110, 'watchdog: 110 min old in the day restarts: ' + d.reason);
  ok(decide({ scannedAt: '2026-10-14T00:10:00Z', now, running: 1 }).action === 'ok', 'watchdog: no restart while a scan is running');
  ok(decide({ scannedAt: null, now }).action === 'restart' && decide({ scannedAt: 'junk', now }).action === 'restart', 'watchdog: unreadable time restarts');
  ok(decide({ scannedAt: '2026-10-13T05:00:00Z', now: U('2026-10-14T14:00:00Z') }).action === 'restart', 'watchdog: now also restarts overnight (24h)');
  ok(STALE_MIN === 95 && decide({ scannedAt: '2026-10-14T00:26:00Z', now }).action === 'ok', 'watchdog: threshold 95 minutes'); }
// digest timing
{ const morning = U('2026-10-13T21:30:00Z') /* 07:30 Brisbane 14th */, sent = {};
  let d = due({ now: morning, bidCount: 0, sent }); ok(d.checkin === 'HB|2026-10-14' && d.bid === null, 'digest: morning check-in due even with no setups');
  d = due({ now: morning, bidCount: 2, sent }); ok(d.checkin && d.bid, 'digest: both due with setups');
  ok(due({ now: morning, bidCount: 2, sent: { 'HB|2026-10-14': 'x', [d.bid]: 'x' } }).checkin === null, 'digest: check-in once per day');
  ok(due({ now: morning, bidCount: 2, sent: { [d.bid]: 'x' } }).bid === null, 'digest: bid digest once per 6h window');
  ok(due({ now: U('2026-10-14T14:30:00Z'), bidCount: 3, sent: {} }).bid === null, 'digest: nothing at night'); }
{ const rows = [{ coin: 'AAA', chain: 'Solana', signal: 'Entry signal', opp: 80, price: 1.0, entryLow: .95, entryHigh: 1.02, stop: .9, tp1: 1.1, tp2: 1.2, tp3: 1.4 }, { coin: 'BBB', chain: 'Solana', signal: 'Watch', opp: 70 }];
  const m = compose({ kind: 'bid', rows, meta: { scannedAt: '2026-10-14T01:00:00Z' }, paper: { equity: 10100, retPct: 1, closedN: 3 }, site: '', now: 0 });
  ok(m.body.includes('AAA') && !m.body.includes('BBB') && m.body.includes('IN ZONE') && m.body.includes('Paper account: $10,100'), 'digest: lists only bid-ready, shows zone and paper account');
  ok(compose({ kind: 'checkin', rows: [], meta: null, paper: null, site: '', now: 0 }).body.includes('Nothing to trade yet'), 'digest: empty check-in is still sent'); }
// holders (free on-chain token info + our own growth history)
{ const info = (n, t10, t1130) => ({ data: { attributes: { holders: { count: n, distribution_percentage: { top_10: t10, '11_30': t1130, rest: 10 } } } } });
  const pi = parseInfo(info(1200, 31.234, 12.1)); ok(pi.holders === 1200 && pi.top10Pct === 31.2 && pi.top30Pct === 43.3, 'holders: parsed count and concentration');
  ok(parseInfo(null) === null && parseInfo({}) === null && parseInfo({ data: { attributes: { holders: { count: 0 } } } }) === null && parseInfo({ data: { attributes: { holders: 'x' } } }) === null, 'holders: junk and zero are rejected');
  const D = 86400e3, now = 1.8e12;
  ok(growth([[now - 5 * D, 1000]], 1100, now).growPct === 10 && growth([[now - 5 * D, 1000]], 1100, now).growDays === 5, 'holders: growth vs a 5-day-old reading');
  ok(growth([[now - 3600e3, 1000]], 1100, now).growPct === null, 'holders: a reading under a day old gives no growth');
  ok(growth([[now - 30 * D, 1000]], 1100, now).growPct === null && growth(null, 5, now).growPct === null, 'holders: too old or missing history gives no growth');
  const calls = []; const get = async (path) => { calls.push(path); return path.includes('/BAD/') ? null : info(2000, 20, 10); };
  const pools = [{ chain: 'solana', token: 'A', opp: 80, signal: 'Entry signal' }, { chain: 'solana', token: 'BAD', opp: 70 }, { chain: 'solana', token: 'B', opp: 60 }, { chain: 'ethereum', token: 'C', opp: 99 }, { chain: 'solana', opp: 90 }, { chain: 'nowhere', token: 'D', opp: 99 }];
  const netOf = (c) => ({ solana: 'solana', ethereum: 'eth' })[c], cache = {};
  const e = await enrich(pools, { get, netOf, cache, cfg: { maxPerScan: 3 }, now });
  ok(e.looked === 3 && pools.find((p) => p.token === 'A').hs.holders === 2000 && !pools.find((p) => p.token === 'D').hs && !pools.find((p) => p.token === 'BAD').hs, 'holders: capped per scan, best first, unknown chain and missing token skipped');
  ok(calls[0].includes('/networks/solana/tokens/A/info'), 'holders: token info path');
  const e2 = await enrich(pools, { get, netOf, cache, now: now + 7 * D, cfg: {} }); ok(pools.find((p) => p.token === 'A').hs.growPct === 0 && pools.find((p) => p.token === 'A').hs.growDays === 7, 'holders: a week later growth is computed from our own history: ' + JSON.stringify(pools[0].hs));
  const n0 = calls.length, e3 = await enrich(pools, { get, netOf, cache, now: now + 7 * D + 1000, fetchNew: false }); ok(calls.length === n0 && e3.applied >= 2, 'holders: light scan uses the cache, no calls');
  const none = await enrich(Array.from({ length: 8 }, (_, i) => ({ chain: 'solana', token: 'X' + i, opp: 80 })), { get: async () => null, netOf, cache: {}, now }); ok(none.status === 'unavailable', 'holders: feed with no holder data is reported, not crashed');
  const thr = await enrich([{ chain: 'solana', token: 'T', opp: 80 }], { get: async () => { throw new Error('x'); }, netOf, cache: {}, now }); ok(thr.applied === 0, 'holders: a throwing feed is contained'); }
