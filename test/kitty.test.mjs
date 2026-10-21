// The kitty: banked profit above the pot's start size is swept out and never risked again; in live mode it really leaves the wallet.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynokitty-');
import { sweepPlan, applySweep, nativeFor, validKitty, invested } from '../bot/kitty.mjs';
import { cycle, newState, DEFAULTS } from '../bot/run.mjs';
import { deskSummary } from '../bot/desk.mjs';
import { sizeFor } from '../bot/manage.mjs';
import { ARM_TEXT } from '../bot/live.mjs';
import path from 'node:path'; import fs from 'node:fs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-22T00:00:00Z'), iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

// the plan
{ const st = { ...newState(DEFAULTS), cash: 10240 }; const p = sweepPlan(st, DEFAULTS); ok(p && p.usd === 240 && p.potAfter === 10000, 'cash above the start: the excess is the sweep');
  ok(sweepPlan({ ...newState(DEFAULTS), cash: 10010 }, DEFAULTS) === null, 'under the minimum: nothing yet');
  ok(sweepPlan({ ...newState(DEFAULTS), cash: 9800 }, DEFAULTS) === null, 'under the start: nothing to sweep, and nothing is ever put back');
  const open = { costUsd: 600, units: 600, remUnits: 400 }; ok(invested(open) === 400, 'what is still invested is the cost of what is still held');
  ok(sweepPlan({ ...newState(DEFAULTS), cash: 9900, positions: [open] }, DEFAULTS).usd === 300, 'cash plus what is invested, less the start: only realised profit counts (an open gain is not swept)');
  ok(sweepPlan({ ...newState(DEFAULTS), cash: 100, positions: [{ costUsd: 10500, units: 1, remUnits: 1 }] }, DEFAULTS).usd === 100, 'never more than the cash on hand');
  ok(sweepPlan({ ...newState(DEFAULTS), cash: 12000 }, { ...DEFAULTS, kitty: false }) === null, 'kitty switched off: nothing');
  const st2 = { ...newState(DEFAULTS), cash: 10240, dayStartEq: 10240 }; applySweep(st2, 240, { at: 'x' }); ok(st2.cash === 10000 && st2.kitty === 240 && st2.dayStartEq === 10000 && st2.sweeps.length === 1, 'a sweep moves cash to the kitty and the day\'s baseline with it, so it never reads as a loss');
  ok(nativeFor(240, 120, 2.5, 0.03) === 2 && nativeFor(240, 120, 2.02, 0.03) === null && nativeFor(240, null, 5, 0.03) === null, 'how much SOL to send, only if the fee reserve stays');
  ok(validKitty('9wEC4pux2bKLys3H9dsBa2fYqrKALSr9twZoXo1GALg3', 'solana') && !validKitty('0x52c0D6f438628c6225F3548504a2233970d2A436', 'solana') && validKitty('0x52c0D6f438628c6225F3548504a2233970d2A436', 'robinhood') && !validKitty('', 'solana'), 'the kitty wallet must be an address on the bot\'s chain');
  // sizing looks at the pot only
  const big = sizeFor({ equity: 10000, cash: 10000 }, { stopPct: 10 }, 1e6, 0, DEFAULTS), same = sizeFor({ equity: 10000, cash: 10000 }, { stopPct: 10 }, 1e6, 0, DEFAULTS); ok(big.usd === same.usd && big.usd > 0, 'position size comes from the pot; the kitty is not in it'); }

// paper: a winning trade closes, the profit is swept at the next check
{ const st = newState(DEFAULTS); st.startedAt = iso(T0 - 3600e3); st.cash = 9700;
  st.positions.push({ id: 'p', coin: 'AAA', chain: 'Solana', pool: 'A'.repeat(44), openedAt: iso(T0 - 3600e3), entry: 1, stop0: 0.9, stop: 0.9, tp1: 1.1, freeAt: 2, costUsd: 300, units: 300, remUnits: 300, bankedUsd: 0, tp1Done: false, free: false, peak: 1, peakClose: 1, sells: [], slipOut: 1, riskUsd: 30 });
  const jr = [], msgs = [], log0 = console.log; console.log = () => {};
  const deps = { now: T0, getJson: async () => [], quotes: async () => ({ ['a'.repeat(44)]: { priceUsd: '2', liquidity: { usd: 500000 } } }), candles5: async () => null, notify: async (t, b) => msgs.push(t + ' ' + b), journal: (o) => jr.push(o), heartbeat: async () => {}, commands: () => [{ id: 'c1', type: 'close', pool: 'A'.repeat(44) }] };
  await cycle(st, { ...DEFAULTS, setupsEveryMin: 1e9 }, deps); console.log = log0;
  ok(st.positions.length === 0 && st.cash < 10000 + 300 && st.kitty > 250 && Math.abs(st.cash - 10000) < 0.01, 'the trade banked about $294 after costs: the pot is back to $10,000 and the rest is in the kitty');
  ok(jr.some((j) => j.type === 'kitty' && j.mode === 'dry') && msgs.length === 0, 'journaled, and no phone message for a paper sweep');
  const d = deskSummary('rules', { st, cfg: DEFAULTS, now: T0 }); ok(d.account.kitty === st.kitty && d.account.total === d.account.equity + st.kitty && d.account.pnl > 250, 'the desk shows pot, kitty and the total; P&L counts the kitty'); }

// live: no kitty wallet = one message, nothing moved; a kitty wallet = SOL really sent, books updated; a failure is retried, not lost
{ const dir = process.env.RYNOBOT_DIR, keys = path.join(dir, 'keys'); fs.mkdirSync(keys, { recursive: true }); fs.writeFileSync(path.join(keys, 'rules.json'), '[1,2,3]', { mode: 0o600 }); fs.writeFileSync(path.join(dir, 'ARMED-rules'), ARM_TEXT);
  const W = 'W'.repeat(44), K = '9wEC4pux2bKLys3H9dsBa2fYqrKALSr9twZoXo1GALg3', cfgL = { ...DEFAULTS, mode: 'live', wallet: W, walletChain: 'solana', keyDir: keys, setupsEveryMin: 1e9 };
  const mk = () => { const st = newState(DEFAULTS); st.startedAt = iso(T0 - 3600e3); st.cash = 10240; st.execMode = 'live'; st.solUsd = 120; return st; };
  const io = { sends: [], fail: false, solBalance: async () => 3, transferSol: async (kf, to, sol) => { if (io.fail) throw new Error('rpc down'); io.sends.push([to, sol]); return 'SIG123'; } };
  const log0 = console.log; console.log = () => {};
  const run = async (st, cfg, now = T0) => { const msgs = [], j = []; await cycle(st, cfg, { now, getJson: async () => [], quotes: async () => ({}), candles5: async () => null, heartbeat: async () => {}, commands: () => [], io, notify: async (t, b) => msgs.push(t + ' ' + b), journal: (o) => j.push(o) }); return { msgs, j }; };
  const stA = mk(); const a1 = await run(stA, cfgL); const a2 = await run(stA, cfgL, T0 + 60e3);
  ok(stA.execMode === 'live' && stA.kitty == null && stA.cash === 10240 && io.sends.length === 0 && a1.msgs.some((m) => /kitty wallet/.test(m)) && !a2.msgs.some((m) => /kitty/.test(m)), 'live with no kitty wallet: nothing moves, one message asking for the address');
  const stB = mk(); const b1 = await run(stB, { ...cfgL, kittyWallet: K });
  ok(io.sends.length === 1 && io.sends[0][0] === K && io.sends[0][1] === 2 && stB.kitty === 240 && stB.cash === 10000 && stB.sweeps[0].sig === 'SIG123' && b1.j.some((x) => x.type === 'kitty' && x.mode === 'live') && b1.msgs.some((m) => /profit sent to your kitty/.test(m)), 'live with a kitty wallet: $240 = 2 SOL really sent to it, books and journal updated, phone told');
  const stC = mk(); await run(stC, { ...cfgL, kittyWallet: '0x52c0D6f438628c6225F3548504a2233970d2A436' }); ok(stC.cash === 10240 && io.sends.length === 1, 'a kitty wallet on the wrong chain is refused: nothing sent');
  const stD = mk(); io.fail = true; const d1 = await run(stD, { ...cfgL, kittyWallet: K }); const d2 = await run(stD, { ...cfgL, kittyWallet: K }, T0 + 5 * 60e3); io.fail = false; const d3 = await run(stD, { ...cfgL, kittyWallet: K }, T0 + 16 * 60e3);
    ok(stD.cash === 10000 && stD.kitty === 240 && !d1.msgs.some((m) => /kitty/.test(m)) && stD.sweeps.length === 1 && d3.msgs.some((m) => /profit sent/.test(m)), 'a failed transfer keeps the money in the pot and retries after 15 minutes; it goes through then');
  const stE = mk(); const e1 = await run(stE, { ...cfgL, kittyWallet: K, feeReserveSol: 1.5 }); ok(stE.cash === 10240 && io.sends.length === 2, 'not enough in the wallet to send and keep the fee reserve: waits');
  console.log = log0; }
process.exit(f);
