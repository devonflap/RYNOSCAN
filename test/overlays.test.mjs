import { installMock } from './mock.mjs';
import { regimeFromPrices, fetchRegime, checkToken, applyOverlays } from '../docs/overlays.mjs';
installMock(globalThis);
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('PASS', m); };
const getCG = async p => (await fetch('https://api.coingecko.com/api/v3' + p)).json();
const R = await fetchRegime(getCG);
ok(R.sol && R.sol.level === 'Risk-off', 'falling SOL series is Risk-off: ' + R.sol?.level + ' ' + (R.sol?.why || []).join(', '));
ok(R.eth && R.eth.level === 'Risk-on', 'rising ETH series is Risk-on: ' + R.eth?.level);
ok(regimeFromPrices([[0, 1]]) === null, 'short history gives no regime');
const gj = async u => (await fetch(u)).json();
const res = [];
for (let i = 0; i < 40; i++) res.push(await checkToken({ net: 'solana', token: 'TokenAddr' + i }, gj));
ok(res.some(r => r.level === 'danger') && res.some(r => r.level === 'warn') && res.some(r => r.level === 'ok'), 'solana safety yields danger, warn and ok');
const ev = []; for (let i = 0; i < 40; i++) ev.push(await checkToken({ net: 'eth', token: '0xabc' + i }, gj));
ok(ev.some(r => r.level === 'danger') && ev.some(r => r.level === 'ok'), 'EVM safety yields danger and ok');
const rh = []; for (let i = 0; i < 12; i++) rh.push(await checkToken({ net: 'robinhood', token: '0xabc' + i }, gj)); ok(rh.every(r => r.level !== 'unchecked' && r.level !== 'ok') && rh.some(r => r.level === 'danger' && /top 10 wallets hold 50%/.test(r.flags[0])) && rh.some(r => r.level === 'warn'), 'robinhood with no GoPlus data: Blockscout holders decide the gate (top-10 over 30% is danger), and it is never called plain ok');
  ok(res.some(r => r.level === 'danger' && r.flags.some(f => /top 10 wallets hold 35%/.test(f))) && res.some(r => r.level === 'danger' && r.flags.some(f => /insider wallets/.test(f)) === false), 'solana: the full report\'s holder table trips the 30% top-10 gate (pools excluded from the count)');
ok((await checkToken({ net: 'solana', token: 'x' }, async () => { throw new Error('x'); })).level === 'unchecked', 'feed failure is unchecked, not safe');
// overlay behaviour
const mk = (o) => ({ sym: 'AAA', net: 'solana', token: 'T1', opp: 80, signal: 'Entry signal', ready: true, flags: [], pat: { ready: true }, ...o });
const a = mk({}), b = mk({ token: 'T2' }), c = mk({ token: 'T3', net: 'eth' });
const ex = applyOverlays([a, b, c], { safety: { 'solana|T1': { level: 'danger', flags: ['Freeze Authority still enabled'] }, 'solana|T2': { level: 'warn', flags: ['x'] } }, regime: R, regimeFilter: 'downgrade' });
ok(a.signal === 'No trade' && !a.ready && a.opp <= 40 && ex.length === 1, 'danger token is removed from bid-ready and from the list');
ok(b.opp === 77 && b.signal === 'Watch' && b.regime === 'Risk-off', 'warn token loses 3 points; risk-off downgrades in downgrade mode');
ok(c.signal === 'Entry signal' && c.regime === 'Risk-on', 'risk-on ETH leaves a bid-ready coin alone');
const d = mk({ token: 'T9' }); applyOverlays([d], { regime: R, regimeFilter: 'warn' });
ok(d.signal === 'Entry signal' && d.flags.some(f => /risk-off/.test(f)), 'warn mode keeps the signal and adds a flag');

{ // cooldown
  const { applyCooldown } = await import('../docs/overlays.mjs');
  const CH = { solana: 'Solana' }, now = Date.parse('2026-10-14T12:00:00Z');
  const rows = [{ sym: 'AAA', chain: 'solana', signal: 'Entry signal', opp: 80, ready: true, flags: [] }, { sym: 'BBB', chain: 'solana', signal: 'Entry signal', opp: 80, ready: true, flags: [] }, { sym: 'CCC', chain: 'solana', signal: 'Entry signal', opp: 80, ready: true, flags: [] }];
  const prev = [{ id: 'SOL:AAA', status: 'stopped out', closedAt: '2026-10-14T00:00Z' }, { id: 'SOL:BBB', status: 'stopped out', closedAt: '2026-10-10T00:00Z' }, { id: 'SOL:CCC', status: 'stopped after TP1', closedAt: '2026-10-14T00:00Z' }];
  const n = applyCooldown(rows, prev, 48, CH, now);
  const t = (name, c) => { console.log((c ? 'PASS ' : 'FAIL ') + name); if (!c) process.exitCode = 1; };
  t('recent stop-out is held back (Watch, opp -10, not bid-ready)', n === 1 && rows[0].signal === 'Watch' && rows[0].opp === 70 && !rows[0].ready);
  t('old stop-out and profitable exits are not held back', rows[1].signal === 'Entry signal' && rows[2].signal === 'Entry signal');
}

// ---- LP lock flag (RugCheck summary lpLockedPct, GoPlus lp_holders) ----
{
  const r1 = await checkToken({ net: 'solana', token: 'X' }, async () => ({ risks: [], lpLockedPct: 3 }), {});
  console.log(r1.level === 'warn' && /3% of liquidity/.test(r1.flags.join()) ? 'PASS low LP lock flagged' : 'FAIL LP lock ' + JSON.stringify(r1));
  const r2 = await checkToken({ net: 'solana', token: 'X' }, async () => ({ risks: [], lpLockedPct: 95 }), {});
  console.log(r2.level === 'ok' ? 'PASS locked LP is ok' : 'FAIL ' + JSON.stringify(r2));
  const r3 = await checkToken({ net: 'solana', token: 'X' }, async () => ({ risks: [] }), {});
  console.log(r3.level === 'ok' ? 'PASS missing LP field ignored' : 'FAIL ' + JSON.stringify(r3));
}
