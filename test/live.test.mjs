// Live execution layer, exercised against a fake market: arming checks, token safety, honeypot test, slippage limits, quote (rehearsal)
// fills, live fills with confirmation, refused exits, reconciliation. No network, no key, no money.
import fs from 'node:fs'; process.env.RYNOBOT_DIR = fs.mkdtempSync('/tmp/rynolive-');
import { liveCheck, ARM_TEXT, quotedBuy, quotedSell, acceptable, mintSafety, reconcile, buy, sell, SOL, LIVE, USDC_MINT, nativeUsd, baseOf } from '../bot/live.mjs';
import { cycle, newState, DEFAULTS, filesFor, loadConfig as loadConfigFor } from '../bot/run.mjs';
import path from 'node:path';
const out = console.log; let f = 0; const ok = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); if (!c) f = 1; };
const T0 = Date.parse('2026-10-22T00:00:00Z') / 1000, M = 300, iso = (s) => new Date(s * 1000).toISOString().slice(0, 19) + 'Z';

// arming: every reason live is refused
{ const dir = process.env.RYNOBOT_DIR, keys = path.join(dir, 'keys'); fs.mkdirSync(keys); const cfg = { name: 'rules', mode: 'live', wallet: 'W'.repeat(44), keyDir: keys, liveMaxUsd: 50, liveMaxOpenUsd: 300 };
  ok(liveCheck({ ...cfg, mode: 'dry' }, { dir }) === null, 'dry mode never needs anything');
  ok(/no wallet/.test(liveCheck({ ...cfg, wallet: null }, { dir })), 'live without a wallet address: refused');
  ok(/no key file/.test(liveCheck(cfg, { dir })), 'live without the key file: refused');
  const kf = path.join(keys, 'rules.json'); fs.writeFileSync(kf, '[1,2,3]', { mode: 0o644 }); ok(/readable by others/.test(liveCheck(cfg, { dir })), 'a key file others can read: refused');
  fs.chmodSync(kf, 0o600); ok(/not armed/.test(liveCheck(cfg, { dir })), 'not armed: refused');
  fs.writeFileSync(path.join(dir, 'ARMED-rules'), 'yes please'); ok(/not armed/.test(liveCheck(cfg, { dir })), 'the armed file must contain the exact sentence');
  fs.writeFileSync(path.join(dir, 'ARMED-rules'), ARM_TEXT + '\n'); ok(liveCheck(cfg, { dir }) === null, 'wallet, protected key, armed, caps: live allowed');
  ok(/not bsc/.test(liveCheck({ ...cfg, walletChain: 'bsc' }, { dir })) && liveCheck({ ...cfg, walletChain: 'robinhood' }, { dir }) === null, 'Solana and Robinhood chain allowed, others refused'); }

// pure helpers
{ const q = { inAmount: String(0.5e9), outAmount: String(1000e6), priceImpactPct: '0.004', routePlan: [{ swapInfo: { label: 'Raydium' } }] };
  const b = quotedBuy(q, 200, 6); ok(b.usd === 100 && b.units === 1000 && b.px === 0.1 && b.impactPct === 0.4 && b.route === 'Raydium', 'a buy quote in dollars: 0.5 SOL at $200 buys 1,000 tokens at $0.10');
  const s = quotedSell({ inAmount: String(1000e6), outAmount: String(0.45e9), priceImpactPct: '0.01' }, 200, 6); ok(s.usd === 90 && s.px === 0.09, 'a sell quote in dollars');
  ok(acceptable(0.1, 0.102, 'buy').ok && !acceptable(0.1, 0.104, 'buy').ok && acceptable(0.1, 0.092, 'sell').ok && !acceptable(0.1, 0.089, 'sell').ok, '3% tolerance on buys, 9% on exits (a stop must still get out)');
  ok(!mintSafety({ freezeAuthority: 'X', mintAuthority: null, decimals: 6 }).ok && !mintSafety({ freezeAuthority: null, mintAuthority: 'X', decimals: 6 }).ok && mintSafety({ freezeAuthority: null, mintAuthority: null, decimals: 6 }).decimals === 6 && !mintSafety(null).ok, 'token safety: no freeze authority, no mint authority');
  const rc = reconcile(2, 200, { cash: 395 }, LIVE); ok(rc.walletUsd === 400 && rc.driftUsd === 5 && rc.ok && !rc.lowSol && reconcile(0.01, 200, { cash: 2 }, LIVE).lowSol, 'reconciliation: wallet against the books, and the fee reserve'); }

// a fake market
const mk = (o = {}) => { const calls = []; const io = { calls,
  mintInfo: async (m) => (o.mint || { freezeAuthority: null, mintAuthority: null, decimals: 6 }),
  solBalance: async () => o.sol ?? 5,
  quote: async (inMint, outMint, amount, slip) => { calls.push(['quote', inMint === SOL ? 'buy' : 'sell', amount, slip]); if (o.noRoute) throw new Error('no route'); if (inMint === SOL) { const sol = amount / 1e9, usd = sol * 200, px = o.buyPx ?? 0.1; return { inAmount: String(amount), outAmount: String(Math.floor((usd / px) * 1e6)), priceImpactPct: String(o.impact ?? 0.005), routePlan: [{ swapInfo: { label: 'Raydium' } }] }; }
    const units = amount / 1e6, px = o.sellPx ?? 0.098; return { inAmount: String(amount), outAmount: String(Math.floor((units * px / 200) * 1e9)), priceImpactPct: '0.006', routePlan: [{ swapInfo: { label: 'Raydium' } }] }; },
  swapTx: async (q, pk) => { calls.push(['swapTx', pk]); return 'dGVzdA=='; }, send: async (tx, kf) => { calls.push(['send', kf]); if (o.sendFail) throw new Error('transaction failed on chain'); return 'SIG' + calls.length; },
  tokenBalance: async () => (io.tbN = (io.tbN || 0) + 1) === 1 ? (o.before ?? 0) : o.held ?? null }; return io; }; // the first read is the balance before the buy
const base = { cfg: { ...LIVE }, mint: 'M'.repeat(44), usd: 50, expectedPx: 0.1, solUsd: 200, keyFile: '/k', pubkey: 'P'.repeat(44) };

// buys
{ const io = mk(); const r = await buy({ ...base, io, mode: 'quote' }); ok(r.fill && r.fill.rehearsal && r.fill.sig === null && r.fill.usd === 50 && Math.abs(r.fill.units - 500) < 1e-6 && /rehearsal/.test(r.why) && !io.calls.some((c) => c[0] === 'send'), 'quote mode: the real quote is booked as the fill, nothing is sent');
  ok(io.calls.filter((c) => c[0] === 'quote' && c[1] === 'sell').length === 1, 'every buy also asks for a sell quote (honeypot test)');
  const r2 = await buy({ ...base, io: mk({ held: 498 }), mode: 'live' }); ok(r2.fill && /^SIG/.test(r2.fill.sig) && r2.fill.units === 498 && /tx SIG/.test(r2.why), 'live: sent, confirmed, and what the wallet gained is what the position holds');
  const r3 = await buy({ ...base, io: mk({ before: 120, held: 618 }), mode: 'live' }); ok(r3.fill && r3.fill.units === 498, 'a wallet already holding 120 (dust, or an earlier entry): the fill is the 498 this buy added, not all 618');
  ok(/freeze authority/.test((await buy({ ...base, io: mk({ mint: { freezeAuthority: 'F', decimals: 6 } }), mode: 'live' })).refused), 'a token with a freeze authority is refused');
  ok(/honeypot/.test((await buy({ ...base, io: mk({ sellPx: 0.03 }), mode: 'live' })).refused), 'a token that sells back for less than half: refused as a honeypot');
  ok(/worse than expected/.test((await buy({ ...base, io: mk({ buyPx: 0.105 }), mode: 'live' })).refused), 'a quote 5% worse than the expected price is refused (limit 3%)');
  ok(/wallet has 0.100 SOL/.test((await buy({ ...base, io: mk({ sol: 0.1 }), mode: 'live' })).refused), 'not enough SOL for the order plus the fee reserve: refused before quoting');
  ok(/no quote/.test((await buy({ ...base, io: mk({ noRoute: true }), mode: 'live' })).refused), 'no route: refused');
  let threw = null; try { await buy({ ...base, io: mk({ sendFail: true }), mode: 'live' }); } catch (e) { threw = e.message; } ok(/failed on chain/.test(threw), 'a failed transaction surfaces as an error (the bot journals it and keeps the setup)'); }
// sells
{ const r = await sell({ ...base, io: mk(), units: 500, decimals: 6, expectedPx: 0.1, mode: 'quote' }); ok(r.fill && r.fill.rehearsal && r.fill.px === 0.098 && r.fill.usd === 49, 'quote mode exit: the quoted price');
  ok(/worse than the live price/.test((await sell({ ...base, io: mk({ sellPx: 0.085 }), units: 500, decimals: 6, expectedPx: 0.1, mode: 'live' })).refused), 'an exit quote 15% under the live price is refused (limit 9%) and the position stays'); }

// the bot in quote mode end to end: the market quote becomes the fill, exits use quotes, a refused exit keeps the position
{ const cfg = { ...DEFAULTS, mode: 'quote', setupsEveryMin: 0, slipPct: 1 }, st = newState(cfg), jr = [], msgs = [], log0 = console.log; console.log = () => {};
  const T = T0, mkb = (i, o, h, l, c, v) => [T + i * M, o, h, l, c, v], b0 = Array.from({ length: 14 }, (_, i) => mkb(i, 1.05, 1.06, 1.04, 1.05, 100)), flush = [...b0, mkb(14, 1.05, 1.05, 0.97, 0.98, 120), mkb(15, 0.98, 1.03, 0.97, 1.02, 200)];
  const q = (px) => ({ priceUsd: String(px), priceNative: String(px / 200), quoteToken: { symbol: 'SOL', address: SOL }, txns: { h1: { buys: 50, sells: 40 }, m5: { buys: 5, sells: 4 } }, volume: { h6: 30000, h24: 100000 }, pairCreatedAt: (T - 5 * 86400) * 1000, liquidity: { usd: 500000 } });
  const setupsJson = [{ id: 'SOL:AAA', coin: 'AAA', chain: 'Solana', pool: 'P1', token: 'M'.repeat(44), signal: 'Watch', opp: 80, setupType: 'Falling wedge', entryLow: 1.0, entryHigh: 1.04, stop: 0.9, tp1: 1.2, liquidity: 500000 }];
  let sellRefuse = false; const io = mk({ buyPx: 1.03 }); io.quote = async (inMint, outMint, amount, slip) => { if (inMint === SOL) { const usd = (amount / 1e9) * 200; return { inAmount: String(amount), outAmount: String(Math.floor((usd / 1.03) * 1e6)), priceImpactPct: '0.004', routePlan: [] }; } if (sellRefuse) return { inAmount: String(amount), outAmount: String(Math.floor(((amount / 1e6) * 0.5 / 200) * 1e9)), priceImpactPct: '0.1' }; return { inAmount: String(amount), outAmount: String(Math.floor(((amount / 1e6) * 0.97 * 0.97 / 200) * 1e9)), priceImpactPct: '0.006' }; };
  const deps = (ms, price) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('setups.json') ? setupsJson : []), quotes: async () => ({ p1: q(price) }), candles5: async () => flush, notify: async (t, b) => msgs.push(t + ' | ' + b), journal: (o) => jr.push(o), heartbeat: async () => {}, io });
  await cycle(st, cfg, deps(T - 30, 1.05)); ok(st.execMode === 'quote' && msgs.some((m) => /rehearsal/.test(m)), 'quote mode announced once: real quotes, nothing sent');
  st.setups.P1.at = iso(T - 60); await cycle(st, cfg, deps(T + 16 * M + 30, 1.025)); const p = st.positions[0];
  ok(p && p.execMode === 'quote' && Math.abs(p.entry - 1.03) < 1e-6 && p.sig === null && jr.some((j) => j.type === 'buy' && /rehearsal/.test(j.market)), 'the position is booked at the market\'s quoted price (1.03), not the DexScreener price, and nothing was sent');
  sellRefuse = true; await cycle(st, cfg, deps(T + 17 * M, 0.95)); ok(st.positions.length === 1 && jr.some((j) => j.type === 'refused' && /exit/.test(j.why)) && msgs.some((m) => /could not sell AAA/.test(m)), 'the stop fires but the exit quote is terrible: refused, position kept, phone told');
  sellRefuse = false; await cycle(st, cfg, deps(T + 18 * M, 0.95)); console.log = log0; const c = st.closed[0];
  ok(st.positions.length === 0 && c && Math.abs(c.sells[0].px - 0.97 * 0.97) < 1e-6 && c.sells[0].sig === null, 'next check the exit quote is fine: closed at the quoted price'); }
// live asked for but not armed: the bot stays dry and says so once
{ const cfg = { ...DEFAULTS, mode: 'live', wallet: 'W'.repeat(44), setupsEveryMin: 1e9 }, st = newState(cfg), msgs = [], log0 = console.log; console.log = () => {};
  await cycle(st, cfg, { now: T0 * 1000, getJson: async () => [], quotes: async () => ({}), candles5: async () => null, notify: async (t, b) => msgs.push(t + ' | ' + b), journal: () => {}, heartbeat: async () => {} }); console.log = log0;
  ok(st.execMode === 'dry' && msgs.length === 1 && /Live was asked for but refused/.test(msgs[0]), 'live without the key and the armed file: dry run, with one message saying why'); }
// publishing the bot's record to the scanner, and the council reading it
{ const { publicRecord, publish } = await import('../bot/publish.mjs'); const { council } = await import('../docs/council.mjs'); const { deskSummary } = await import('../bot/desk.mjs');
  const st = newState(DEFAULTS); st.startedAt = iso(T0); st.execMode = 'quote'; st.closed.push({ coin: 'AAA', chain: 'Solana', pool: 'p1', openedAt: iso(T0), closedAt: iso(T0 + 3600), entry: 1, stop0: 0.9, costUsd: 100, units: 100, bankedUsd: 110, pnl: 10, R: 1, sells: [{ why: 'TP1', px: 1.1, usd: 110, at: iso(T0 + 3600) }], meta: { trigPx: 1, quotePx: 1.01 } });
  const rec = publicRecord(deskSummary('rules', { st, cfg: { ...DEFAULTS, wallet: 'SECRET' }, now: T0 * 1000 + 7200e3 }));
  ok(rec.bot === 'rules' && rec.execMode === 'quote' && rec.closed.length === 1 && rec.closed[0].R === 1 && !JSON.stringify(rec).includes('SECRET'), 'the public record carries the trades and never the wallet');
  const calls = []; const fetcher = async (u, o = {}) => { calls.push([o.method || 'GET', u]); return { ok: true, json: async () => ({ sha: 'abc' }), text: async () => '' }; };
  const r = await publish('rules', rec, { token: 't', fetcher }); ok(r.ok && calls[1][0] === 'PUT' && /docs\/data\/bots\/rules.json/.test(calls[1][1]), 'published to docs/data/bots/rules.json with the file\'s current sha');
  ok((await publish('rules', rec, { token: '', fetcher })).skipped === 'no GITHUB_TOKEN', 'no token: nothing happens');
  { let n = 0; const f2 = async (u, o) => { if (!o || !o.method) return { ok: true, json: async () => ({ sha: 'abc' + n }) }; n++; return n < 3 ? { ok: false, status: 409, text: async () => 'is at X but expected Y' } : { ok: true, json: async () => ({}) }; };
    const r2 = await publish('rules', rec, { token: 't', fetcher: f2 }); ok(r2.ok && r2.tries === 3, 'a 409 (the branch moved under us) is retried with a fresh sha until it lands');
    let m = 0; const f3 = async (u, o) => (!o || !o.method ? { ok: true, json: async () => ({ sha: 'x' }) } : (m++, { ok: false, status: 401, text: async () => 'bad credentials' })); let err = null; try { await publish('rules', rec, { token: 't', fetcher: f3 }); } catch (e) { err = e.message; } ok(/401/.test(err) && m === 1, 'any other error is reported at once, not retried'); }
  const c = council({ botRecs: { rules: rec }, now: T0 * 1000 + 7200e3 }), live = c.hats.find((h) => h.key === 'live');
  ok(live && /rules bot \(rehearsal quotes\): 1 closed, \+1\.00R/.test(live.headline), 'the council\'s Bot desk hat reads the record');
  const cfg = { ...DEFAULTS, publish: true, setupsEveryMin: 1e9 }, st2 = newState(cfg), pubs = [], log0 = console.log; console.log = () => {};
  const deps = (ms) => ({ now: ms, getJson: async () => [], quotes: async () => ({}), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {}, token: 't', publish: async (name, record) => { pubs.push(name); return { ok: true }; } });
  await cycle(st2, cfg, deps(T0 * 1000)); await cycle(st2, cfg, deps(T0 * 1000 + 30 * 60e3)); await cycle(st2, cfg, deps(T0 * 1000 + 61 * 60e3)); console.log = log0;
  ok(pubs.length === 2, 'the bot publishes once an hour when publish is on');
  const st3 = newState(DEFAULTS); let tried = 0; console.log = () => {}; await cycle(st3, { ...DEFAULTS, setupsEveryMin: 1e9 }, { ...deps(T0 * 1000), publish: async () => { tried++; return { ok: true }; } }); console.log = log0; ok(tried === 0, 'publish off by default: a token alone never publishes (tests must never write to the repo)'); }
// per-order slippage tolerance from the quote's own impact
{ const { toleranceBps } = await import('../bot/live.mjs');
  ok(toleranceBps(0.1, 'buy') === 70 && toleranceBps(0.05, 'buy') === 60 && toleranceBps(2, 'buy') === 300 && toleranceBps(2, 'sell') === 450 && toleranceBps(10, 'sell') === 900, 'tolerance = 2x impact + 0.5%, floor 0.5%, capped at 3% (buys) / 9% (exits)');
  const io = mk(); const r = await buy({ ...base, io, mode: 'quote' }); ok(r.fill.tolPct === 1.5 && io.calls.filter((c) => c[0] === 'quote' && c[1] === 'buy').pop()[3] === 150, 'the order is re-quoted at its own tolerance (0.5% impact -> 1.5%), not a flat 3%'); }
// the degen bot: buys the degen desk's runners on sight with the study exits
{ const cfg = { ...loadConfigFor('degen'), setupsEveryMin: 0, slipPct: 0, degenMaxAgeH: 24 }, st = newState(cfg), jr = [], log0 = console.log; console.log = () => {};   // the wider window, to exercise the no-chasing guard
  const rows = [{ coin: 'RUN', chain: 'Solana', pool: 'r'.repeat(44), token: 'T'.repeat(44), signalAt: iso(T0 - 600), status: 'waiting for entry', entryMid: 1, stop: 0.8, liq: 200000, why: ['3x volume'] }, { coin: 'OLD', chain: 'Solana', pool: 'o'.repeat(44), signalAt: iso(T0 - 30 * 3600), status: 'open', entryMid: 1, stop: 0.8, liq: 200000 }, { coin: 'RAN', chain: 'Solana', pool: 'q'.repeat(44), signalAt: iso(T0 - 4 * 3600), status: 'open', entryMid: 1, stop: 0.8, liq: 200000 }];
  const qq = (px) => ({ priceUsd: String(px), priceNative: String(px / 200), txns: { h1: { buys: 5, sells: 50 }, m5: { buys: 0, sells: 9 } }, volume: { h6: 100, h24: 100000 }, pairCreatedAt: (T0 - 5 * 86400) * 1000, liquidity: { usd: 200000 } });
  const deps = (ms, px, closes) => ({ now: ms * 1000, getJson: async (u) => (u.endsWith('degen.json') ? rows : []), quotes: async () => ({ ['r'.repeat(44)]: qq(px), ['q'.repeat(44)]: qq(1.3) }), candles5: async () => closes || null, notify: async () => {}, journal: (o) => jr.push(o), heartbeat: async () => {} });
  await cycle(st, cfg, deps(T0, 1.05)); const p = st.positions[0];
  ok(!st.setups['o'.repeat(44)] && st.positions.length === 1 && p && p.coin === 'RUN' && jr.some((j) => j.type === 'drop' && j.coin === 'RAN' && /15%/.test(j.why)) && Math.abs(p.stop / p.entry - 0.6) < 0.01 && Math.abs(p.remUnits * (p.entry - p.stop) - 100) < 1, 'buys the fresh runner on sight with a 40% stop sized to 1% of the account; the day-old one is ignored and the 4-hour-old one that already ran 30% is not chased');
  await cycle(st, cfg, deps(T0 + 3600, 0.9)); ok(st.positions.length === 1, 'sellers taking over and volume dying do not sell: the study exits are deliberately bare');
  await cycle(st, cfg, deps(T0 + 7 * 3600, 0.95)); ok(st.positions.length === 1, 'no "no follow-through" exit either');
  await cycle(st, cfg, deps(T0 + 8 * 3600, 2.2)); ok(st.positions.length === 1 && p === st.positions[0] || st.positions[0].free, 'ride free at 2x');
  const c5 = [[T0 + 8 * 3600, 2.2], [T0 + 8 * 3600 + 300, 1.0]].map(([t, c]) => [t, c, c, c, c, 100]); await cycle(st, cfg, deps(T0 + 8 * 3600 + 900, 1.0, c5)); console.log = log0;
  ok(st.positions.length === 0 && st.closed[0] && /giveback/.test(st.closed[0].sells.slice(-1)[0].why) && st.closed[0].pnl > 0, 'then out on a 5-minute close 50% under the best close, in profit'); }
// the BTC and ETH bots sit in USDC: orders go USDC -> cbBTC and back to USDC; the issuer's mint authority does not refuse cbBTC
{ const CB = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', calls = [];
  const io = { mintInfo: async () => ({ mintAuthority: 'COINBASE', freezeAuthority: 'COINBASE', decimals: 8 }), tokenBalance: async (pk, m) => (m === USDC_MINT ? 500 : 0.0005), solBalance: async () => 0.1,
    quote: async (inM, outM, amount) => { calls.push([inM, outM, amount]); return inM === USDC_MINT ? { inAmount: String(amount), outAmount: String(Math.round(amount / 1e6 / 100000 * 1e8)), priceImpactPct: '0.0001', routePlan: [] } : { inAmount: String(amount), outAmount: String(Math.round(amount / 1e8 * 99900 * 1e6)), priceImpactPct: '0.0001', routePlan: [] }; },
    swapTx: async () => 'TX', send: async () => 'SIG' };
  const cfg = { ...LIVE, baseMint: USDC_MINT, liveSlipPct: 0.5 };
  const b = await buy({ cfg, io, mint: CB, usd: 50, expectedPx: 100000, solUsd: null, mode: 'live', keyFile: 'k', pubkey: 'P' });
  ok(b.fill && calls[0][0] === USDC_MINT && calls[0][1] === CB && calls[0][2] === 50e6 && Math.abs(b.fill.px - 100000) < 1 && Math.abs(b.fill.usd - 50) < 0.01, 'a $50 BTC buy spends 50 USDC (not SOL), at $100,000 a coin, and the Coinbase mint authority does not block it');
  const s = await sell({ cfg, io, mint: CB, units: 0.0005, decimals: 8, expectedPx: 100000, solUsd: null, mode: 'live', keyFile: 'k', pubkey: 'P' }); ok(s.fill && calls.at(-1)[1] === USDC_MINT && Math.abs(s.fill.usd - 49.95) < 0.01, 'the sale goes back to USDC: the pot sits in dollars between trades');
  ok(/USDC/.test((await buy({ cfg, io: { ...io, tokenBalance: async () => 10 }, mint: CB, usd: 50, expectedPx: 100000, solUsd: null, mode: 'live', keyFile: 'k', pubkey: 'P' })).refused || ''), 'not enough USDC in the wallet: refused');
  ok(/authority/.test((await buy({ cfg, io, mint: 'MEMEmint1111111111111111111111111111111111', usd: 50, expectedPx: 1, solUsd: 200, mode: 'quote', keyFile: 'k', pubkey: 'P' })).refused || ''), 'a meme coin with a mint authority is still refused (only the named issuers are trusted)');
  ok(baseOf({}, 150).mint === SOL && baseOf({ baseMint: USDC_MINT }, 150).px === 1, 'other bots still pay in SOL'); }
// the SOL price is never read off a pair quoted in USDC (that would size a $50 order as 50 SOL)
{ const now = Date.now(), usdcPair = { priceUsd: '100000', priceNative: '100000', quoteToken: { symbol: 'USDC', address: USDC_MINT } }, solPair = { priceUsd: '0.002', priceNative: '0.00001', quoteToken: { symbol: 'SOL', address: SOL } };
  ok(nativeUsd(solPair, {}, false, now) === 200 && nativeUsd(usdcPair, {}, false, now) === null && nativeUsd(usdcPair, { solUsd: 180, solUsdAt: now - 60e3 }, false, now) === 180 && nativeUsd(usdcPair, { solUsd: 180, solUsdAt: now - 3600e3 }, false, now) === null, 'SOL price: from a SOL-quoted pair, or the bot\'s own fresh SOL price; never 1 from a USDC pair; a stale price refuses the order'); }
// a refused sell changes nothing (review 24 Oct): TP1 is tried again next check, the stop stays put, earlier sells are kept
{ const cfg = { ...loadConfigFor('runner'), mode: 'quote', setupsEveryMin: 0, slipPct: 0, liveScan: false }, st = newState(cfg); st.execMode = 'quote'; st.solUsd = 200; st.solUsdAt = Date.now();
  const earlier = { why: 'an earlier sell', units: 1, usd: 2, px: 2, all: false, at: iso(T0) };
  st.positions.push({ id: 'R@1', mode: 'ladder', coin: 'RFS', chain: 'solana', pool: 'RF', token: 'M'.repeat(44), decimals: 6, execMode: 'quote', openedAt: iso(T0), entry: 1, stop0: 0.8, stop: 0.8, R: 0.2, targets: [2, 3, 4, 5], shares: [0.2, 0.2, 0.2, 0.2], hits: 0, units: 100, remUnits: 100, costUsd: 100, bankedUsd: 0, peak: 1, sells: [earlier], riskUsd: 20, lastPx: 1.9 });
  const log0 = console.log; console.log = () => {}; let refuse = true;
  const deps = { now: (T0 + 60) * 1000, getJson: async () => [], quotes: async () => ({ rf: { priceUsd: '2.05', priceNative: '0.01025', quoteToken: { symbol: 'SOL', address: SOL }, liquidity: { usd: 1e6 }, txns: {} } }), candles5: async () => null, notify: async () => {}, journal: () => {}, heartbeat: async () => {},
    liveSell: async (o) => (refuse ? { refused: 'exit quote 40% worse than the live price' } : { fill: { usd: o.units * 2.05, px: 2.05, sig: null }, why: 'quoted' }) };
  await cycle(st, cfg, deps); const p = st.positions[0]; console.log = log0;
  ok(p && p.hits === 0 && p.remUnits === 100 && p.stop === 0.8 && p.sells.length === 1 && p.sells[0] === earlier || (p && p.sells.length === 1 && p.sells[0].why === 'an earlier sell'), 'TP1 refused: nothing changed (no clip counted, units and stop as they were, the earlier sell still in the history)');
  refuse = false; console.log = () => {}; await cycle(st, cfg, { ...deps, now: (T0 + 120) * 1000 }); console.log = log0; const p2 = st.positions[0];
  ok(p2 && p2.hits === 1 && Math.abs(p2.remUnits - 80) < 1e-9 && p2.sells.length === 2, 'next check the quote is fine: TP1 is taken then, as it should be'); }
process.exit(f);
