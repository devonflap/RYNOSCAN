// Live execution for Solana (Jupiter swaps), built to be exercised long before any money moves.
// Three modes, set per bot in bot/config.json:
//   dry    paper fills from DexScreener prices (default)
//   quote  REHEARSAL: every buy and sell asks the real market for a quote (Jupiter) and books the quoted fill, but sends nothing.
//          This measures the real slippage and routing for this bot's sizes with zero risk, and is the step before live.
//   live   sends the swap, waits for confirmation, reads the wallet to confirm what was really bought or sold.
// Live also needs: the file bot/ARMED-<bot> with the exact text below, the bot's wallet key file on the server, and the caps
// (liveMaxUsd per order, liveMaxOpenUsd in total). Every order is journaled with its transaction signature.
// The io object is injectable so all of this is unit tested without a network or a key.
import fs from 'node:fs';
import path from 'node:path';
export const ARM_TEXT = 'I understand this bot will spend real money from its own wallet';
export const SOL = 'So11111111111111111111111111111111111111112', LAMPORTS = 1e9, USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// custodial tokens: their issuer keeps the mint (and usually the freeze) authority by design, because that is how it mints and burns
// against the real asset it holds. The meme-coin safety check (no mint or freeze authority) would refuse them on every order, so these
// named mints, and only these, skip that one check. Everything else (honeypot test, slippage, caps, arming) still applies.
export const TRUSTED_MINTS = { cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: 'cbBTC (Coinbase)', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'WETH (Wormhole Portal)', [USDC_MINT]: 'USDC (Circle)' };
// what the bot pays with and is paid in: SOL by default; a bot with baseMint USDC sits in dollars between trades (the BTC and ETH bots)
export function baseOf(cfg, solUsd) { return cfg && cfg.baseMint === USDC_MINT ? { mint: USDC_MINT, dec: 6, px: 1, sym: 'USDC' } : { mint: SOL, dec: 9, px: solUsd, sym: 'SOL' }; }
export const LIVE = { liveMaxUsd: 50, liveMaxOpenUsd: 300, liveSlipPct: 3, exitSlipX: 3, minSlipPct: 0.5, priorityMaxLamports: 2000000, feeReserveSol: 0.03, jupQuote: 'https://lite-api.jup.ag/swap/v1/quote', jupSwap: 'https://lite-api.jup.ag/swap/v1/swap', rpc: 'https://api.mainnet-beta.solana.com', keyDir: '/etc/rynobot/keys', confirmMs: 60000 };

export const keyPath = (name, dir = LIVE.keyDir) => path.join(dir, name + '.json');
export function armed(name, dir) { try { return fs.readFileSync(path.join(dir, 'ARMED-' + name), 'utf8').trim() === ARM_TEXT; } catch { return false; } }
// can this bot trade live right now? Returns null when it may, otherwise the reason it may not (the bot then stays in dry mode and says so).
export function liveCheck(cfg, { dir, keyFile = keyPath(cfg.name, cfg.keyDir || LIVE.keyDir), wallet = cfg.wallet } = {}) {
  if (cfg.mode !== 'live') return null;
  if (!['solana', 'robinhood'].includes(cfg.walletChain || 'solana')) return `live trading is built for Solana and Robinhood chain; not ${cfg.walletChain}`;
  if (!wallet) return 'no wallet address in bot/config.json';
  if (!fs.existsSync(keyFile)) return `no key file at ${keyFile} (run: node bot/wallet.mjs create --bot ${cfg.name})`;
  try { const st = fs.statSync(keyFile); if (st.mode & 0o077) return `key file ${keyFile} is readable by others: chmod 600 it`; } catch { /* checked above */ }
  if (!armed(cfg.name, dir)) return `not armed: create bot/ARMED-${cfg.name} containing exactly: ${ARM_TEXT}`;
  if (!(cfg.liveMaxUsd > 0) || !(cfg.liveMaxOpenUsd > 0)) return 'liveMaxUsd and liveMaxOpenUsd must be set';
  return null;
}

// ---------- pure helpers ----------
const n = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
// what a quote means in USD terms. q: Jupiter quote { inAmount, outAmount, priceImpactPct, routePlan }. For a buy: in = lamports, out = token base units.
export function quotedBuy(q, solUsd, decimals, baseDec = 9) { const inSol = n(q.inAmount) / 10 ** baseDec, out = n(q.outAmount) / 10 ** decimals; if (!(inSol > 0) || !(out > 0)) return null; const usd = inSol * solUsd; return { usd: +usd.toFixed(2), units: out, px: usd / out, impactPct: +((n(q.priceImpactPct) || 0) * 100).toFixed(2), route: (q.routePlan || []).map((r) => r.swapInfo && r.swapInfo.label).filter(Boolean).join(' > ') }; }
export function quotedSell(q, solUsd, decimals, baseDec = 9) { const inTok = n(q.inAmount) / 10 ** decimals, outSol = n(q.outAmount) / 10 ** baseDec; if (!(inTok > 0) || !(outSol > 0)) return null; const usd = outSol * solUsd; return { usd: +usd.toFixed(2), units: inTok, px: usd / inTok, impactPct: +((n(q.priceImpactPct) || 0) * 100).toFixed(2), route: (q.routePlan || []).map((r) => r.swapInfo && r.swapInfo.label).filter(Boolean).join(' > ') }; }
// the slippage tolerance sent with an order is NOT a cost, it is the most the fill may move against us before the chain rejects the trade.
// Too tight and orders fail (you pay the network fee and miss the entry; on a stop that is dangerous); too loose and a sandwich bot can take
// the difference. So it is set per order from the quote's own price impact: twice the impact plus 0.5%, never under minSlipPct, never over
// liveSlipPct (buys) or liveSlipPct x exitSlipX (exits). The quote itself already includes the real cost (impact and fees).
export function toleranceBps(impactPct, side, cfg = LIVE) { const cap = cfg.liveSlipPct * (side === 'sell' ? cfg.exitSlipX || LIVE.exitSlipX : 1), want = Math.max(cfg.minSlipPct ?? LIVE.minSlipPct, (impactPct || 0) * 2 + 0.5); return Math.round(Math.min(cap, want) * 100); }
// is the quoted fill acceptable against the price we expected? tolerance in %, exits get exitSlipX times more room (a stop must still get out)
export function acceptable(expectedPx, quotedPx, side, cfg = LIVE) { const tol = cfg.liveSlipPct * (side === 'sell' ? cfg.exitSlipX : 1); const worse = side === 'buy' ? (quotedPx / expectedPx - 1) * 100 : (1 - quotedPx / expectedPx) * 100; return { ok: worse <= tol, worsePct: +worse.toFixed(2), tolPct: tol }; }
// token safety from the mint account (Solana): a freeze authority can lock your tokens; a mint authority can print more
export function mintSafety(info) { if (!info) return { ok: false, why: 'mint account not found' }; const fa = info.freezeAuthority, ma = info.mintAuthority; if (fa) return { ok: false, why: 'freeze authority still enabled (your tokens could be frozen)' }; if (ma) return { ok: false, why: 'mint authority still enabled (supply can be inflated)' }; return { ok: true, decimals: n(info.decimals) ?? 9 }; }
// the base coin's price in dollars from a DexScreener pair: priceUsd / priceNative is the price of the pair's QUOTE token, so it is SOL's
// price only when the pair is quoted in SOL (and ETH's only when quoted in WETH). For a pair quoted in USDC it is about $1, and using it
// as SOL's price would size a $50 order as 50 SOL (bug found 23 Oct, never reached: nothing was live). Otherwise: the bot's own SOL or
// ETH price, if it is under 15 minutes old.
export function nativeUsd(qq, st, isRh = false, now = Date.now()) {
  const qt = (qq && qq.quoteToken) || {}, sym = String(qt.symbol || '').toUpperCase(), viaPair = qq && +qq.priceNative > 0 ? +qq.priceUsd / +qq.priceNative : null;
  if (!isRh && (qt.address === SOL || sym === 'SOL' || sym === 'WSOL') && viaPair > 0) return viaPair; if (isRh && (sym === 'WETH' || sym === 'ETH') && viaPair > 0) return viaPair;
  const own = isRh ? st && st.ethUsd : st && st.solUsd, at = isRh ? st && st.ethUsdAt : st && st.solUsdAt; return own > 0 && now - (at || 0) < 15 * 60e3 ? own : null;
}
// one-time note of what the wallet holds against what the bot thinks it holds
export function reconcile(walletSol, solUsd, st, cfg) { const cashUsd = walletSol * solUsd, drift = cashUsd - st.cash; return { walletSol: +walletSol.toFixed(4), walletUsd: +cashUsd.toFixed(2), botCash: +st.cash.toFixed(2), driftUsd: +drift.toFixed(2), ok: Math.abs(drift) <= Math.max(5, 0.02 * st.cash), lowSol: walletSol < (cfg.feeReserveSol || LIVE.feeReserveSol) }; }

// ---------- the market, injectable ----------
export function defaultIo(cfg = LIVE) {
  const get = async (u) => { const r = await fetch(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const rpc = async (method, params) => { const r = await fetch(cfg.rpc || LIVE.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; };
  return {
    quote: (inMint, outMint, amount, slipBps) => get(`${cfg.jupQuote || LIVE.jupQuote}?inputMint=${inMint}&outputMint=${outMint}&amount=${Math.floor(amount)}&slippageBps=${slipBps}&restrictIntermediateTokens=true`),
    swapTx: async (quoteResponse, userPublicKey) => { const r = await fetch(cfg.jupSwap || LIVE.jupSwap, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: cfg.priorityMaxLamports || LIVE.priorityMaxLamports, priorityLevel: 'high' } } }), signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('swap HTTP ' + r.status); const j = await r.json(); if (!j.swapTransaction) throw new Error('no swap transaction returned'); return j.swapTransaction; },
    send: async (txB64, keyFile) => { const web3 = await import('@solana/web3.js'), raw = JSON.parse(fs.readFileSync(keyFile, 'utf8')), kp = web3.Keypair.fromSecretKey(Uint8Array.from(raw)), tx = web3.VersionedTransaction.deserialize(Buffer.from(txB64, 'base64')); tx.sign([kp]);
      const conn = new web3.Connection(cfg.rpc || LIVE.rpc, 'confirmed'), sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }), t0 = Date.now();
      for (;;) { const s = await conn.getSignatureStatuses([sig]), v = s && s.value && s.value[0]; if (v && v.err) throw new Error('transaction failed on chain: ' + JSON.stringify(v.err)); if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return sig; if (Date.now() - t0 > (cfg.confirmMs || LIVE.confirmMs)) throw new Error('not confirmed in time: ' + sig); await new Promise((r) => setTimeout(r, 2000)); } },
    solBalance: async (pubkey) => (await rpc('getBalance', [pubkey])).value / LAMPORTS,
    // a plain SOL transfer (the kitty sweep): only ever to the address in config
    transferSol: async (keyFile, to, sol) => { const web3 = await import('@solana/web3.js'), kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, 'utf8')))), conn = new web3.Connection(cfg.rpc || LIVE.rpc, 'confirmed');
      const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new web3.PublicKey(to), lamports: Math.round(sol * LAMPORTS) })); return web3.sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed' }); },
    tokenBalance: async (pubkey, mint) => { const r = await rpc('getTokenAccountsByOwner', [pubkey, { mint }, { encoding: 'jsonParsed' }]); return (r.value || []).reduce((a, x) => a + (+x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0); },
    mintInfo: async (mint) => { const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]); const p = r && r.value && r.value.data && r.value.data.parsed && r.value.data.parsed.info; return p ? { mintAuthority: p.mintAuthority, freezeAuthority: p.freezeAuthority, decimals: p.decimals } : null; },
  };
}

// ---------- orders ----------
// buy: usd worth of `mint` for the bot. expectedPx: the price the bot decided on. Returns { fill: { px, units, usd, impactPct, route, sig }, why } or { refused }.
export async function buy({ cfg, io, mint, usd, expectedPx, solUsd, mode, keyFile, pubkey, log = () => {} }) {
  const info = await io.mintInfo(mint), safe = TRUSTED_MINTS[mint] && info ? { ok: true, decimals: n(info.decimals) ?? 9, trusted: TRUSTED_MINTS[mint] } : mintSafety(info); if (!safe.ok) return { refused: 'token safety: ' + safe.why };
  const B = baseOf(cfg, solUsd); if (!(B.px > 0)) return { refused: 'no SOL price to size the order' };
  const lamports = Math.floor((usd / B.px) * 10 ** B.dec), slipBps = Math.round(cfg.liveSlipPct * 100), reserve = cfg.feeReserveSol || LIVE.feeReserveSol;
  if (mode === 'live') { if (B.sym === 'USDC') { const [u, sol] = [await io.tokenBalance(pubkey, USDC_MINT), await io.solBalance(pubkey)]; if (u < usd) return { refused: `wallet has $${u.toFixed(2)} USDC, the order needs $${usd.toFixed(2)}` }; if (sol < reserve) return { refused: `wallet has ${sol.toFixed(3)} SOL for fees, needs ${reserve}` }; }
    else { const bal = await io.solBalance(pubkey); if (bal < usd / B.px + reserve) return { refused: `wallet has ${bal.toFixed(3)} SOL, needs ${(usd / B.px + reserve).toFixed(3)} (order plus fee reserve)` }; } }
  let q; try { q = await io.quote(B.mint, mint, lamports, slipBps); } catch (e) { return { refused: 'no quote: ' + e.message }; }
  let f = quotedBuy(q, B.px, safe.decimals, B.dec); if (!f) return { refused: 'empty quote (no route)' };
  const tol = toleranceBps(f.impactPct, 'buy', cfg); if (tol !== slipBps) { try { q = await io.quote(B.mint, mint, lamports, tol); f = quotedBuy(q, B.px, safe.decimals, B.dec) || f; } catch { /* keep the first quote */ } } f.tolPct = tol / 100;
  // honeypot test: can it be sold back? ask for a sell quote of the amount we would hold
  try { const back = await io.quote(mint, B.mint, Math.floor(f.units * 10 ** safe.decimals * 0.5), slipBps); const s = quotedSell(back, B.px, safe.decimals, B.dec); if (!s || s.px < f.px * 0.5) return { refused: 'honeypot check: selling back would lose more than half (' + (s ? s.px.toPrecision(4) : 'no route') + ')' }; } catch (e) { return { refused: 'honeypot check: cannot get a sell quote (' + e.message + ')' }; }
  const a = acceptable(expectedPx, f.px, 'buy', cfg); if (!a.ok) return { refused: `quoted fill ${a.worsePct}% worse than expected (limit ${a.tolPct}%)`, quoted: f };
  if (mode === 'quote') return { fill: { ...f, decimals: safe.decimals, px: +f.px.toPrecision(8), sig: null, rehearsal: true }, why: `rehearsal: quoted ${f.units.toPrecision(6)} at ${f.px.toPrecision(6)} via ${f.route || 'Jupiter'}, impact ${f.impactPct}%, tolerance ${f.tolPct}%, not sent` };
  let before = 0; try { before = await io.tokenBalance(pubkey, mint) || 0; } catch { /* unknown: assume none */ }
  const tx = await io.swapTx(q, pubkey), sig = await io.send(tx, keyFile);
  let units = f.units; try { const held = await io.tokenBalance(pubkey, mint); if (held - before > 0) units = held - before; } catch (e) { log('could not read the token balance after the buy: ' + e.message); } /* only what this buy added (dust or an earlier entry is not this fill) */
  return { fill: { ...f, decimals: safe.decimals, units, px: +(f.usd / units).toPrecision(8), sig }, why: `bought ${units.toPrecision(6)} via ${f.route || 'Jupiter'}, impact ${f.impactPct}%, tolerance ${f.tolPct}%, tx ${sig}` };
}
// sell: units of mint. Exits get more slippage room; a stop that cannot fill is journaled loudly so you can act.
export async function sell({ cfg, io, mint, units, decimals = 9, expectedPx, solUsd, mode, keyFile, pubkey, side = 'sell' }) {
  const slipBps = Math.round(cfg.liveSlipPct * (cfg.exitSlipX || LIVE.exitSlipX) * 100), amount = Math.floor(units * 10 ** decimals), B = baseOf(cfg, solUsd); if (!(B.px > 0)) return { refused: 'no SOL price to value the exit' };
  let q; try { q = await io.quote(mint, B.mint, amount, slipBps); } catch (e) { return { refused: 'no sell quote: ' + e.message }; }
  let f = quotedSell(q, B.px, decimals, B.dec); if (!f) return { refused: 'empty sell quote (no route)' };
  const tol = toleranceBps(f.impactPct, 'sell', cfg); if (tol !== slipBps) { try { q = await io.quote(mint, B.mint, amount, tol); f = quotedSell(q, B.px, decimals, B.dec) || f; } catch { /* keep the first quote */ } } f.tolPct = tol / 100;
  const a = acceptable(expectedPx, f.px, 'sell', cfg); if (!a.ok) return { refused: `quoted exit ${a.worsePct}% worse than the live price (limit ${a.tolPct}%)`, quoted: f };
  if (mode === 'quote') return { fill: { ...f, px: +f.px.toPrecision(8), sig: null, rehearsal: true }, why: `rehearsal: quoted exit ${f.px.toPrecision(6)} via ${f.route || 'Jupiter'}, impact ${f.impactPct}%, not sent` };
  const tx = await io.swapTx(q, pubkey), sig = await io.send(tx, keyFile);
  return { fill: { ...f, px: +f.px.toPrecision(8), sig }, why: `sold via ${f.route || 'Jupiter'}, impact ${f.impactPct}%, tx ${sig}` };
}
