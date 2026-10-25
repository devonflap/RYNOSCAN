// The copy bot (24 Oct): proven wallets' fresh buys copied on paper, three ways; the mirror exit follows the wallet out.
import fs0 from 'node:fs'; process.env.RYNOBOT_DIR = fs0.mkdtempSync('/tmp/rynocopy-');
import { evmEvents, solEvents, provenFrom, bestPair, chainOfWallet } from '../bot/copy.mjs';
import { cycle, newState, loadConfig } from '../bot/run.mjs';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = 1800000000, iso = (t) => new Date(t * 1000).toISOString(), W = '0xf42b73d2e4d3912eade2a5f7ab39b54064c2acec', TK = '0x1111111111111111111111111111111111111111';

ok(chainOfWallet(W) === 'robinhood' && chainOfWallet('2b2N2p7xCS9ibDqxwYgXpDSTniJwwye7n93WYuzmr74s') === 'solana' && chainOfWallet('nope') === null, 'wallet chains: 0x on Robinhood chain, base58 on Solana');
const tr = (side, token = TK, sym = 'GLOAM', t = T0, tx = 'tx1') => ({ token: { address_hash: token, symbol: sym, type: 'ERC-20' }, from: { hash: side === 'buy' ? '0xpool' : W }, to: { hash: side === 'buy' ? W : '0xpool' }, timestamp: iso(t), transaction_hash: tx });
const ev = evmEvents(W, { items: [tr('buy'), tr('sell', TK, 'GLOAM', T0, 'tx2'), tr('buy', '0xweth', 'WETH')] });
ok(ev.length === 2 && ev[0].side === 'buy' && ev[1].side === 'sell' && ev.every((e) => e.token === TK), 'Blockscout transfers: a token in is a buy, out is a sell; WETH is the money, not the trade');
const sx = solEvents('WAL', { blockTime: T0, meta: { err: null, preTokenBalances: [{ owner: 'WAL', mint: 'MEME', uiTokenAmount: { uiAmount: 0 } }], postTokenBalances: [{ owner: 'WAL', mint: 'MEME', uiTokenAmount: { uiAmount: 5000 } }, { owner: 'WAL', mint: 'So11111111111111111111111111111111111111112', uiTokenAmount: { uiAmount: 1 } }] } }, 'sig1');
ok(sx.length === 1 && sx[0].side === 'buy' && sx[0].token === 'MEME' && solEvents('WAL', { meta: { err: { x: 1 } } }, 's').length === 0, 'Solana: the wallet\'s token balance going up is a buy (SOL itself ignored); failed transactions ignored');
ok(provenFrom({ proven: [{ w: W, copyPct: 18.5, n: 11, wins: 6 }, { w: '0x9c97ee995ee9d19f5afbb2bd979c6ede03000e7f', copyPct: 86.9, cherry: true }, { w: '0x370a7e2d300c14d79d4a7ee07aaca46c4b3012cf', copyPct: -2 }] }).length === 1, 'only proven wallets with a positive copyable return, never a one-lucky-trade wallet');
ok(bestPair({ pairs: [{ chainId: 'robinhood', baseToken: { address: TK }, liquidity: { usd: 1e5 }, pairAddress: 'A' }, { chainId: 'robinhood', baseToken: { address: TK }, liquidity: { usd: 5e5 }, pairAddress: 'B' }, { chainId: 'base', baseToken: { address: TK }, liquidity: { usd: 9e9 }, pairAddress: 'C' }] }, TK, 'robinhood').pairAddress === 'B', 'the deepest pair on the wallet\'s own chain');

// through the bot
{ const cfg = { ...loadConfig('copy'), slipPct: 0 }; let items = [tr('buy', '0x2222222222222222222222222222222222222222', 'OLD', T0 - 60, 'old')], px = 1;
  const pair = () => ({ chainId: 'robinhood', dexId: 'uniswap', pairAddress: '0xPOOL', baseToken: { address: TK, symbol: 'GLOAM' }, quoteToken: { symbol: 'WETH' }, priceUsd: String(px), liquidity: { usd: 300000 }, marketCap: 2e6, txns: { m5: { buys: 10, sells: 8 }, h1: { buys: 80, sells: 70 } }, volume: { h1: 50000 }, pairCreatedAt: (T0 - 60 * 86400) * 1000, url: 'u' });
  const G = async (u) => (u.includes('walletscore') ? { proven: [{ w: W, n: 11, wins: 6, copyPct: 18.5 }] } : u.includes('blockscout') ? { items } : u.includes('/tokens/') ? { pairs: [pair()] } : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async (its) => Object.fromEntries(its.map((i) => [String(i.pool).toLowerCase(), pair()])), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {} }), log0 = console.log;
  const run = async (st, sec) => { console.log = () => {}; await cycle(st, cfg, deps(sec)); console.log = log0; };
  const st = newState(cfg); await run(st, T0); ok(!Object.keys(st.setups).length && !st.positions.length, 'first look at a wallet: what it bought before the bot was watching is not copied');
  items = [tr('buy', TK, 'GLOAM', T0 + 50, 'new'), ...items]; await run(st, T0 + 60); await run(st, T0 + 120);
  const ways = st.positions.map((p) => p.variant).sort().join();
  ok(ways === 'L-ladder,M-mirror,T-24h' && st.positions.every((p) => Math.abs(p.costUsd - 100) < 1 && p.meta.copyOf[0] === W), 'a fresh buy by a proven wallet: copied three ways, $100 each, each remembering whom it copied');
  items = [tr('sell', TK, 'GLOAM', T0 + 170, 'out'), ...items]; px = 1.1; await run(st, T0 + 180); await run(st, T0 + 240);
  const M = st.closed.find((p) => p.variant === 'M-mirror'); ok(M && /the wallet sold/.test(M.sells.at(-1).why) && st.positions.length === 2, 'the wallet sells: the mirror copy is out with it; the 24-hour and ladder copies stay');
  items = [tr('buy', TK, 'GLOAM', T0 + 290, 'again'), ...items]; await run(st, T0 + 300); ok(!Object.keys(st.setups).filter((k) => !st.setups[k].dropped).length, 'the same coin again the same day: not copied twice'); }

// a painted or thin market is never copied, whoever bought it
{ const cfg = { ...loadConfig('copy'), slipPct: 0 }; let items = []; const thin = { chainId: 'robinhood', pairAddress: '0xTHIN', baseToken: { address: TK, symbol: 'X' }, quoteToken: { symbol: 'WETH' }, priceUsd: '1', liquidity: { usd: 8000 }, marketCap: 1e6, txns: { h1: { buys: 50, sells: 40 } }, volume: { h1: 20000 } };
  const G = async (u) => (u.includes('walletscore') ? { proven: [{ w: W, n: 11, wins: 6, copyPct: 18.5 }] } : u.includes('blockscout') ? { items } : u.includes('/tokens/') ? { pairs: [thin] } : []);
  const deps = (sec) => ({ now: sec * 1000, getJson: G, quotes: async () => ({ '0xthin': thin }), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {} }), log0 = console.log;
  const st = newState(cfg); console.log = () => {}; await cycle(st, cfg, deps(T0)); items = [tr('buy', TK, 'X', T0 + 50, 'n')]; await cycle(st, cfg, deps(T0 + 60)); await cycle(st, cfg, deps(T0 + 120)); console.log = log0;
  ok(!st.positions.length, 'a proven wallet buying an $8k pool: not copied (under the $30k liquidity floor)'); }
// the scorecard's list decides who is followed: a newly proven wallet is added at the next hourly read, one that drops off is no longer copied
{ const { copySetupsIn } = await import('../bot/copy.mjs'); let list = [{ w: W, n: 11, wins: 6, copyPct: 18.5 }]; const W2 = '0x0ec4e45f9ce3020024c0418a74cd31fbc487038f', jr = [];
  const G = async (u) => (u.includes('walletscore') ? { proven: list } : { items: [] }), st = { positions: [], setups: {} }, go = (t) => copySetupsIn(st, { site: '', copy: {} }, { G, J: (o) => jr.push(o), now: t * 1000, nowIso: iso(t) });
  await go(T0); list = [...list, { w: W2, n: 7, wins: 3, copyPct: 18.8 }]; await go(T0 + 600); ok(st.proven.length === 1, 'between the hourly reads the list stays as it was');
  await go(T0 + 3700); ok(st.proven.map((x) => x.w).join() === [W, W2].join() && jr.some((j) => j.side === 'added' && /newly proven/.test(j.why)), 'a wallet the scorecard newly proves is followed from the next hourly read, and the journal says so');
  list = [list[1]]; await go(T0 + 7400); ok(st.proven.length === 1 && st.proven[0].w === W2 && jr.some((j) => j.side === 'dropped'), 'a wallet that drops off the proven list is no longer copied'); }
// Blockscout refusing the server (25 Oct, HTTP 403): the same moves read from the chain's own RPC
{ const { rpcEvents, copySetupsIn, TRANSFER } = await import('../bot/copy.mjs'); const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
  const logs = [{ address: TK, topics: [TRANSFER, pad('0x00000000000000000000000000000000000000aa'), pad(W)], transactionHash: 'h1' }, { address: TK, topics: [TRANSFER, pad(W), pad('0x00000000000000000000000000000000000000aa')], transactionHash: 'h2' }, { address: TK, topics: [TRANSFER, pad(W), pad('0x00000000000000000000000000000000000000aa'), '0x01'], transactionHash: 'nft' }];
  const ev = rpcEvents(W, logs.map((l) => ({ ...l, blockNumber: '0x10' })), { 16: T0 }); ok(ev.length === 2 && ev[0].side === 'buy' && ev[1].side === 'sell' && ev[0].at === iso(T0) && ev[0].token === TK.toLowerCase(), 'chain logs: a Transfer to the wallet is a buy, from it a sell, dated by its block; NFT transfers ignored');
  ok(rpcEvents(W, [{ address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', topics: [TRANSFER, pad('0x00000000000000000000000000000000000000aa'), pad(W)], transactionHash: 'h3', blockNumber: '0x10' }], { 16: T0 }).length === 0, 'WETH coming in (the wallet sold something) is not a buy');
  let got = []; const erpc = async (m, p) => (m === 'eth_blockNumber' ? '0x100000' : m === 'eth_getBlockByNumber' ? { timestamp: '0x' + (T0 + 50).toString(16) } : p[0].topics[2] ? got : []); const G = async (u) => { if (u.includes('walletscore')) return { proven: [{ w: W, n: 11, wins: 6, copyPct: 18.5 }] }; if (u.includes('blockscout')) throw new Error('HTTP 403'); if (u.includes('/tokens/')) return { pairs: [{ chainId: 'robinhood', pairAddress: '0xP', baseToken: { address: TK, symbol: 'GLOAM' }, priceUsd: '1', liquidity: { usd: 1e5 }, url: 'u' }] }; return []; };
  const st = { positions: [], setups: {} }, jr = [], go = (t) => copySetupsIn(st, { site: '', copy: {}, mults: [], shares: [] }, { G, erpc, J: (o) => jr.push(o), now: t * 1000, nowIso: iso(t) });
  await go(T0); got = [{ address: TK, topics: [TRANSFER, pad('0x00000000000000000000000000000000000000aa'), pad(W)], transactionHash: 'new', blockNumber: '0xffff0' }]; await go(T0 + 60);
  ok(Object.values(st.setups).length === 1 && jr.some((j) => /Blockscout refused/.test(j.why || '')), 'Blockscout says 403: the wallet\'s fresh buy is still seen, from the chain itself, and the journal says so'); }
process.exit(f);
