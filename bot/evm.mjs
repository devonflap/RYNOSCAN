// Live execution on Robinhood Chain (chain id 4663, an Arbitrum-style L2: single sequencer, first come first served, no public mempool).
// Quotes 0x, KyberSwap, 1inch and the Uniswap Trading API in parallel, takes the best output net of gas, simulates it with eth_call,
// and falls back to a direct Uniswap v3 swap (QuoterV2 + SwapRouter02) when no aggregator has a route. Token approvals go only to an
// allowlist: Permit2, 0x AllowanceHolder, KyberSwap's router, 1inch's spender from its own API, SwapRouter02. Never 0x's Settler.
// Same three modes as Solana (dry / quote / live) and the same arming rules. The io object is injectable; everything is unit tested offline.
import { acceptable, toleranceBps, LIVE } from './live.mjs';
export const RH = {
  chainId: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3', universalRouter: '0x204FAca1764B154221e35c0d20aBb3c525710498', // UR v2.1.2 (the Trading API's target)
  swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2', quoterV2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  zeroxAllowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734', zeroxRegistry: '0x00000000000004533Fe15556B1E086BB1A72cEae', kyberRouter: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
  fees: [500, 3000, 10000], gasPerSwap: 160000, quoteTimeoutMs: 1500, maxFeeX: 2,
};
// addresses that may ever receive an ERC-20 approval or a swap call. Anything else is refused, whatever an API says.
export const ALLOW = new Set([RH.permit2, RH.universalRouter, RH.swapRouter02, RH.zeroxAllowanceHolder, RH.kyberRouter].map((a) => a.toLowerCase()));
const lower = (a) => String(a || '').toLowerCase(), isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));

// ---------- the four aggregators, each returns { src, out (bigint base units), to, data, value, spender, gas } or throws ----------
export const AGG = {
  zerox: async (io, { sell, buy, amount, taker, slipBps }) => { if (!io.keys || !io.keys.zerox) throw new Error('no 0x key'); const j = await io.getJson(`https://api.0x.org/swap/allowance-holder/quote?chainId=${RH.chainId}&sellToken=${sell}&buyToken=${buy}&sellAmount=${amount}&taker=${taker}&slippageBps=${slipBps}`, { '0x-api-key': io.keys.zerox, '0x-version': 'v2' });
    if (!j || !j.transaction || !j.buyAmount) throw new Error('0x: no route');
    // 0x's call target is its Settler, which changes; it is checked against 0x's on-chain registry (ownerOf(2)) rather than hardcoded, and is never approved
    const settler = io.settler ? await io.settler() : null; if (!settler || lower(settler) !== lower(j.transaction.to)) throw new Error('0x: transaction target is not the registered Settler'); return { src: '0x', out: BigInt(j.buyAmount), to: j.transaction.to, toVerified: true, data: j.transaction.data, value: BigInt(j.transaction.value || 0), spender: RH.zeroxAllowanceHolder, gas: Number(j.transaction.gas) || RH.gasPerSwap, route: (j.route && j.route.fills || []).map((f) => f.source).join(' > ') }; },
  kyber: async (io, { sell, buy, amount, taker, slipBps }) => { const r = await io.getJson(`https://aggregator-api.kyberswap.com/robinhood/api/v1/routes?tokenIn=${sell}&tokenOut=${buy}&amountIn=${amount}`); const rs = r && r.data && r.data.routeSummary; if (!rs) throw new Error('kyber: no route');
    const b = await io.postJson('https://aggregator-api.kyberswap.com/robinhood/api/v1/route/build', { routeSummary: rs, sender: taker, recipient: taker, slippageTolerance: slipBps }); const d = b && b.data; if (!d || !d.data) throw new Error('kyber: no build');
    if (lower(d.routerAddress) !== lower(RH.kyberRouter)) throw new Error('kyber: unexpected router ' + d.routerAddress); return { src: 'KyberSwap', out: BigInt(d.amountOut || rs.amountOut), to: d.routerAddress, data: d.data, value: BigInt(d.transactionValue || 0), spender: RH.kyberRouter, gas: Number(d.gas) || RH.gasPerSwap, route: (rs.route || []).flat().map((x) => x.exchange).filter(Boolean).slice(0, 3).join(' > ') }; },
  oneinch: async (io, { sell, buy, amount, taker, slipBps }) => { if (!io.keys || !io.keys.oneinch) throw new Error('no 1inch key'); const h = { Authorization: 'Bearer ' + io.keys.oneinch }; const sp = await io.getJson(`https://api.1inch.dev/swap/v6.0/${RH.chainId}/approve/spender`, h); const spender = sp && sp.address; if (!isAddr(spender)) throw new Error('1inch: no spender');
    const j = await io.getJson(`https://api.1inch.dev/swap/v6.0/${RH.chainId}/swap?src=${sell}&dst=${buy}&amount=${amount}&from=${taker}&origin=${taker}&slippage=${slipBps / 100}&disableEstimate=true`, h); if (!j || !j.tx || !j.dstAmount) throw new Error('1inch: no route');
    return { src: '1inch', out: BigInt(j.dstAmount), to: j.tx.to, data: j.tx.data, value: BigInt(j.tx.value || 0), spender, gas: Number(j.tx.gas) || RH.gasPerSwap, route: '' }; },
  uniswap: async (io, { sell, buy, amount, taker, slipBps }) => { if (!io.keys || !io.keys.uniswap) throw new Error('no Uniswap key'); const h = { 'x-api-key': io.keys.uniswap, 'x-universal-router-version': '2.1.2' };
    const q = await io.postJson('https://trade-api.gateway.uniswap.org/v1/quote', { type: 'EXACT_INPUT', amount: String(amount), tokenInChainId: RH.chainId, tokenOutChainId: RH.chainId, tokenIn: sell, tokenOut: buy, swapper: taker, slippageTolerance: slipBps / 100, routingPreference: 'CLASSIC' }, h); if (!q || !q.quote || !q.quote.output) throw new Error('uniswap: no route');
    const s = await io.postJson('https://trade-api.gateway.uniswap.org/v1/swap', { quote: q.quote, ...(q.permitData ? { permitData: q.permitData } : {}) }, h); if (!s || !s.swap) throw new Error('uniswap: no swap');
    if (lower(s.swap.to) !== lower(RH.universalRouter)) throw new Error('uniswap: unexpected router ' + s.swap.to); return { src: 'Uniswap', out: BigInt(q.quote.output.amount), to: s.swap.to, data: s.swap.data, value: BigInt(s.swap.value || 0), spender: RH.permit2, gas: Number(s.swap.gasLimit) || RH.gasPerSwap, route: 'Uniswap API', permit2: true }; },
};
// Universal Router v2.1.2 commands we use (Uniswap's command byte table): WRAP_ETH 0x0b, V3_SWAP_EXACT_IN 0x00, UNWRAP_WETH 0x0c.
// ADDRESS_THIS (0x…02) means "the router itself"; MSG_SENDER (0x…01) means the caller. A buy wraps the ETH sent with the call and swaps
// it, so no approval is ever needed on the way in; a sell pulls the token through Permit2, swaps and unwraps back to ETH.
export const UR = { WRAP_ETH: 0x0b, V3_SWAP_EXACT_IN: 0x00, UNWRAP_WETH: 0x0c, ADDRESS_THIS: '0x0000000000000000000000000000000000000002', MSG_SENDER: '0x0000000000000000000000000000000000000001' };
export const v3Path = (tokenIn, fee, tokenOut) => '0x' + tokenIn.slice(2) + fee.toString(16).padStart(6, '0') + tokenOut.slice(2);
// the plan for a Universal Router call, before ABI encoding (which io.urEncode does with ethers): { commands: [byte], inputs: [[types, values]], value, deadline }
export function urPlan({ side, tokenIn, tokenOut, fee, amountIn, minOut, taker, deadline }) {
  const path = v3Path(tokenIn, fee, tokenOut);
  if (side === 'buy') return { commands: [UR.WRAP_ETH, UR.V3_SWAP_EXACT_IN], inputs: [[['address', 'uint256'], [UR.ADDRESS_THIS, amountIn]], [['address', 'uint256', 'uint256', 'bytes', 'bool'], [UR.MSG_SENDER, amountIn, minOut, path, false]]], value: amountIn, deadline };
  return { commands: [UR.V3_SWAP_EXACT_IN, UR.UNWRAP_WETH], inputs: [[['address', 'uint256', 'uint256', 'bytes', 'bool'], [UR.ADDRESS_THIS, amountIn, minOut, path, true]], [['address', 'uint256'], [UR.MSG_SENDER, minOut]]], value: 0n, deadline };
}
// direct Uniswap v3 fallback: best fee tier by QuoterV2, then the Universal Router (v2.1.2) with the plan above; SwapRouter02 if the router call cannot be built
export async function v3Fallback(io, { sell, buy, amount, taker, slipBps }, now = Date.now()) {
  let best = null; for (const fee of RH.fees) { try { const out = await io.v3Quote({ tokenIn: sell, tokenOut: buy, fee, amountIn: amount }); if (out > 0n && (!best || out > best.out)) best = { out, fee }; } catch { /* no pool at this fee */ } }
  if (!best) throw new Error('uniswap v3 direct: no pool'); const minOut = best.out - (best.out * BigInt(slipBps)) / 10000n, side = lower(sell) === lower(RH.weth) ? 'buy' : 'sell';
  if (io.urEncode) { const plan = urPlan({ side, tokenIn: sell, tokenOut: buy, fee: best.fee, amountIn: amount, minOut, taker, deadline: Math.floor(now / 1000) + 120 }); const data = await io.urEncode(plan);
    return { src: 'Uniswap v3 direct', out: best.out, to: RH.universalRouter, data, value: plan.value, spender: RH.permit2, permit2: side === 'sell', gas: RH.gasPerSwap + 40000, route: `Universal Router, v3 ${best.fee / 10000}% pool` }; }
  const data = await io.v3Encode({ tokenIn: sell, tokenOut: buy, fee: best.fee, recipient: taker, amountIn: amount, amountOutMinimum: minOut });
  return { src: 'Uniswap v3 direct', out: best.out, to: RH.swapRouter02, data, value: 0n, spender: RH.swapRouter02, gas: RH.gasPerSwap, route: `SwapRouter02, v3 ${best.fee / 10000}% pool` };
}

// ---------- the order ----------
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
// quotes every venue in parallel, drops anything not on the allowlist, picks the best output net of gas (in the output token's units via ethUsd/outUsd)
export async function bestQuote(io, req, { gasPrice, ethUsd, outUsdPerUnit, cfg = RH } = {}) {
  const tries = Object.entries(AGG).map(([k, fn]) => withTimeout(fn(io, req), cfg.quoteTimeoutMs).then((q) => ({ ok: true, q }), (e) => ({ ok: false, src: k, err: e.message })));
  const res = await Promise.all(tries), good = [], bad = [];
  for (const r of res) { if (!r.ok) { bad.push(`${r.src}: ${r.err}`); continue; } const q = r.q; if (!(ALLOW.has(lower(q.to)) || q.toVerified) || !ALLOW.has(lower(q.spender))) { bad.push(`${q.src}: refused, ${q.to} is not on the allowlist`); continue; } good.push(q); }
  if (!good.length) { try { good.push(await v3Fallback(io, req)); } catch (e) { bad.push('fallback ' + e.message); } }
  if (!good.length) return { none: true, why: bad.join('; ') };
  const gasUsd = (q) => (gasPrice && ethUsd ? (Number(gasPrice) * q.gas / 1e18) * ethUsd : 0), net = (q) => Number(q.out) * (outUsdPerUnit || 0) - gasUsd(q);
  good.sort((a, b) => net(b) - net(a)); return { pick: good[0], others: good.slice(1).map((q) => q.src), skipped: bad, gasUsd: +gasUsd(good[0]).toFixed(4) };
}
export const gasFees = (baseFee, cfg = RH) => ({ maxFeePerGas: BigInt(baseFee) * BigInt(cfg.maxFeeX), maxPriorityFeePerGas: 1n }); // FCFS sequencer: tips buy nothing, speed does

// buy `usd` of token with ETH (via WETH). io: getJson, postJson, ethBalance, tokenInfo(token) -> {decimals, symbol}, baseFee, simulate(tx), approveIfNeeded(token, spender, amount), send(tx), tokenBalance.
export async function evmBuy({ cfg, io, token, usd, expectedPx, ethUsd, mode, taker, log = () => {} }) {
  if (!isAddr(token)) return { refused: 'bad token address' };
  const info = await io.tokenInfo(token); if (!info || info.decimals == null) return { refused: 'token contract not readable' }; if (info.feeOnTransfer) return { refused: 'token takes a fee on transfer: fills cannot be trusted' };
  const wei = BigInt(Math.floor((usd / ethUsd) * 1e18)), slipBps = toleranceBps(0, 'buy', cfg), base = await io.baseFee();
  if (mode === 'live') { const bal = await io.ethBalance(taker); const need = wei + BigInt(Math.floor(0.002 * 1e18)); if (bal < need) return { refused: `wallet has ${(Number(bal) / 1e18).toFixed(4)} ETH, needs ${(Number(need) / 1e18).toFixed(4)} (order plus gas reserve)` }; }
  const req = { sell: RH.weth, buy: token, amount: wei, taker, slipBps }, r = await bestQuote(io, req, { gasPrice: base, ethUsd, outUsdPerUnit: expectedPx / 10 ** info.decimals });
  if (r.none) return { refused: 'no route on any venue (' + r.why + ')' };
  const q = r.pick, units = Number(q.out) / 10 ** info.decimals, px = usd / units, a = acceptable(expectedPx, px, 'buy', cfg); if (!a.ok) return { refused: `best quote (${q.src}) ${a.worsePct}% worse than expected (limit ${a.tolPct}%)` };
  // honeypot: a sell of what we would hold must have a route and give back at least half
  try { const back = await bestQuote(io, { sell: token, buy: RH.weth, amount: q.out / 2n, taker, slipBps: toleranceBps(0, 'sell', cfg) }, { gasPrice: base, ethUsd, outUsdPerUnit: ethUsd / 1e18 }); if (back.none) return { refused: 'honeypot check: no way to sell it back' }; const backUsd = (Number(back.pick.out) / 1e18) * ethUsd; if (backUsd < usd * 0.25) return { refused: `honeypot check: selling half back returns $${backUsd.toFixed(2)}` }; } catch (e) { return { refused: 'honeypot check failed: ' + e.message }; }
  const tx = { to: q.to, data: q.data, value: q.value, gas: q.gas, ...gasFees(base) };
  const sim = await io.simulate({ ...tx, from: taker }); if (!sim.ok) return { refused: `simulation failed (${q.src}): ${sim.error || 'reverted'}` };
  const fill = { usd, units, px: +px.toPrecision(8), decimals: info.decimals, impactPct: null, route: `${q.src}${q.route ? ' (' + q.route + ')' : ''}`, gasUsd: r.gasUsd, tolPct: slipBps / 100, venue: q.src, others: r.others, skipped: r.skipped };
  if (mode === 'quote') return { fill: { ...fill, sig: null, rehearsal: true }, why: `rehearsal: best of ${1 + r.others.length} venue${r.others.length ? 's' : ''} was ${q.src}, ${units.toPrecision(6)} at ${px.toPrecision(6)}, gas about $${r.gasUsd}, simulated OK, not sent` };
  if (q.value === 0n) await io.approveIfNeeded(RH.weth, q.spender, wei, { permit2: !!q.permit2, router: q.to }); // an aggregator taking WETH needs an approval; a call that sends native ETH (the router's WRAP_ETH path) does not
  let before = 0n; try { before = BigInt(await io.tokenBalance(taker, token) || 0n); } catch { /* unknown: assume none */ }
  const sig = await io.send(tx); let held = units; try { const b = BigInt(await io.tokenBalance(taker, token)); if (b - before > 0n) held = Number(b - before) / 10 ** info.decimals; } catch (e) { log('could not read the token balance after the buy: ' + e.message); } /* only what this buy added */
  return { fill: { ...fill, units: held, px: +(usd / held).toPrecision(8), sig }, why: `bought ${held.toPrecision(6)} via ${q.src}, gas about $${r.gasUsd}, tx ${sig}` };
}
export async function evmSell({ cfg, io, token, units, decimals, expectedPx, ethUsd, mode, taker }) {
  const amount = BigInt(Math.floor(units * 10 ** decimals)), slipBps = toleranceBps(0, 'sell', cfg), base = await io.baseFee();
  const r = await bestQuote(io, { sell: token, buy: RH.weth, amount, taker, slipBps }, { gasPrice: base, ethUsd, outUsdPerUnit: ethUsd / 1e18 }); if (r.none) return { refused: 'no sell route on any venue (' + r.why + ')' };
  const q = r.pick, usd = (Number(q.out) / 1e18) * ethUsd, px = usd / units, a = acceptable(expectedPx, px, 'sell', cfg); if (!a.ok) return { refused: `best exit quote (${q.src}) ${a.worsePct}% worse than the live price (limit ${a.tolPct}%)`, quoted: { usd, px } };
  const tx = { to: q.to, data: q.data, value: 0n, gas: q.gas, ...gasFees(base) }; const sim = await io.simulate({ ...tx, from: taker }); if (!sim.ok) return { refused: `exit simulation failed (${q.src}): ${sim.error || 'reverted'}` };
  const fill = { usd: +usd.toFixed(2), units, px: +px.toPrecision(8), impactPct: null, route: q.src, gasUsd: r.gasUsd, tolPct: slipBps / 100, venue: q.src };
  if (mode === 'quote') return { fill: { ...fill, sig: null, rehearsal: true }, why: `rehearsal: exit via ${q.src} at ${px.toPrecision(6)}, gas about $${r.gasUsd}, simulated OK, not sent` };
  await io.approveIfNeeded(token, q.spender, amount, { permit2: !!q.permit2, router: q.to }); const sig = await io.send(tx);
  return { fill: { ...fill, sig }, why: `sold via ${q.src}, gas about $${r.gasUsd}, tx ${sig}` };
}

// ---------- the real chain, through ethers (loaded only when used) ----------
export async function evmIo(cfg = {}, keyFile = null) {
  const ethers = await import('ethers'); const rpc = cfg.rhRpc || RH.rpc, provider = new ethers.JsonRpcProvider(rpc, RH.chainId, { staticNetwork: true });
  const net = await provider.getNetwork(); if (Number(net.chainId) !== RH.chainId) throw new Error(`RPC answered chain ${net.chainId}, expected ${RH.chainId}`);
  const wallet = keyFile ? new ethers.Wallet(JSON.parse(await import('node:fs').then((m) => m.readFileSync(keyFile, 'utf8'))).privateKey, provider) : null;
  const erc20 = (t) => new ethers.Contract(t, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], wallet || provider);
  const quoter = new ethers.Contract(RH.quoterV2, ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)'], provider);
  const routerIface = new ethers.Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)']);
  const permit2 = wallet ? new ethers.Contract(RH.permit2, ['function approve(address token,address spender,uint160 amount,uint48 expiration)'], wallet) : null;
  const hdr = (h = {}) => ({ accept: 'application/json', ...h });
  return {
    keys: { zerox: process.env.ZEROX_API_KEY, oneinch: process.env.ONEINCH_API_KEY, uniswap: process.env.UNISWAP_API_KEY },
    getJson: async (u, h) => { const r = await fetch(u, { headers: hdr(h), signal: AbortSignal.timeout(RH.quoteTimeoutMs + 500) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
    postJson: async (u, b, h) => { const r = await fetch(u, { method: 'POST', headers: hdr({ 'content-type': 'application/json', ...h }), body: JSON.stringify(b), signal: AbortSignal.timeout(RH.quoteTimeoutMs + 500) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
    ethBalance: (a) => provider.getBalance(a), tokenBalance: (a, t) => erc20(t).balanceOf(a),
    transferEth: async (to, eth) => { if (!wallet) throw new Error('no wallet'); const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(String(eth)) }); await tx.wait(); return tx.hash; },
    tokenInfo: async (t) => { const c = erc20(t); const [decimals, symbol] = await Promise.all([c.decimals(), c.symbol().catch(() => '?')]); return { decimals: Number(decimals), symbol }; },
    baseFee: async () => { const b = await provider.getBlock('latest'); return b.baseFeePerGas ?? (await provider.getFeeData()).gasPrice; },
    simulate: async (tx) => { try { await provider.call({ to: tx.to, data: tx.data, value: tx.value, from: tx.from }); return { ok: true }; } catch (e) { return { ok: false, error: (e.shortMessage || e.message || '').slice(0, 120) }; } },
    settler: async () => { const reg = new ethers.Contract(RH.zeroxRegistry, ['function ownerOf(uint256) view returns (address)'], provider); return reg.ownerOf(2); },
    v3Quote: async ({ tokenIn, tokenOut, fee, amountIn }) => (await quoter.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 }))[0],
    v3Encode: async (p) => routerIface.encodeFunctionData('exactInputSingle', [{ ...p, sqrtPriceLimitX96: 0 }]),
    urEncode: async (plan) => { const coder = ethers.AbiCoder.defaultAbiCoder(), ur = new ethers.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']); return ur.encodeFunctionData('execute', ['0x' + plan.commands.map((c) => c.toString(16).padStart(2, '0')).join(''), plan.inputs.map(([t, v]) => coder.encode(t, v)), plan.deadline]); },
    approveIfNeeded: async (token, spender, amount, { permit2: viaPermit2, router } = {}) => { if (!wallet) throw new Error('no wallet'); if (!ALLOW.has(lower(spender))) throw new Error('refused: ' + spender + ' is not on the allowlist');
      const c = erc20(token); if (viaPermit2) { if ((await c.allowance(wallet.address, RH.permit2)) < amount) await (await c.approve(RH.permit2, amount * 4n)).wait(); await (await permit2.approve(token, router, amount * 4n, Math.floor(Date.now() / 1000) + 30 * 86400)).wait(); return; }
      if ((await c.allowance(wallet.address, spender)) < amount) await (await c.approve(spender, amount * 4n)).wait(); },
    send: async (tx) => { if (!wallet) throw new Error('no wallet'); const r = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gasLimit: BigInt(Math.ceil(tx.gas * 1.2)), maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas }); const rc = await r.wait(1, cfg.confirmMs || LIVE.confirmMs); if (!rc || rc.status !== 1) throw new Error('transaction failed on chain: ' + r.hash); return r.hash; },
    address: wallet ? wallet.address : null,
  };
}
