// THE COPY BOT (24 Oct, research, paper only, never live): watches the wallets the scanner's own scorecard has PROVEN (docs/data/
// walletscore.json: 3+ coins, 2+ wins, a run rate well above average, a positive return for someone copying them an hour late, no sniper,
// bot or one-lucky-trade wallets) and copies their buys on paper, at the price the bot sees when it notices, not the wallet's price.
// The pump.fun KOL study's warning applies in full: copiers made about 3% a trade where the copied wallets made 14%, and a 2-minute-late
// copy of the big swarms lost 41% a coin. So this bot exists to measure, on our own fills, whether these particular wallets are worth
// following at all, and how: every copy is traded three ways (out when the wallet sells; the scorecard's own 24-hour hold; half at 2x and a
// free ride). Free data only: Robinhood-chain wallets through Blockscout's public API, Solana wallets through the public Solana RPC.
// Nothing here can place an order.
export const COPY = { everySec: 60, provenEveryMin: 60, maxEventAgeMin: 20, perWallet: 25, maxWallets: 12, minCopyPct: 0, majors: ['WETH', 'ETH', 'USDC', 'USDT', 'USDC.E', 'WSOL', 'SOL', 'USD1', 'PYUSD', 'USDS'] };
const SOL_MINTS = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
export const chainOfWallet = (w) => (/^0x[0-9a-fA-F]{40}$/.test(w) ? 'robinhood' : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w) ? 'solana' : null);
// Blockscout token transfers -> buys and sells (a token coming IN is a buy, going OUT a sell; dollar coins and ETH wrappers are the money, not the trade)
export function evmEvents(wallet, j, cfg = COPY) {
  const w = wallet.toLowerCase(), out = [];
  for (const it of (j && j.items) || []) { const tk = it.token || {}, sym = String(tk.symbol || '').toUpperCase(), addr = tk.address_hash || tk.address; if (!addr || cfg.majors.includes(sym) || (tk.type && tk.type !== 'ERC-20')) continue;
    const from = String((it.from && it.from.hash) || '').toLowerCase(), to = String((it.to && it.to.hash) || '').toLowerCase(), side = to === w ? 'buy' : from === w ? 'sell' : null; if (!side) continue;
    out.push({ wallet, chain: 'robinhood', token: addr, symbol: tk.symbol || null, side, at: it.timestamp || null, tx: it.transaction_hash || it.tx_hash || null }); }
  return out; }
// one parsed Solana transaction -> the wallet's token balance changes (up = buy, down = sell); failed transactions ignored
export function solEvents(wallet, tx, sig, cfg = COPY) {
  const m = tx && tx.meta; if (!m || m.err) return []; const at = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, bal = {};
  for (const [k, list] of [['pre', m.preTokenBalances], ['post', m.postTokenBalances]]) for (const b of list || []) { if (b.owner !== wallet || SOL_MINTS.has(b.mint)) continue; (bal[b.mint] ||= { pre: 0, post: 0 })[k] += +((b.uiTokenAmount && b.uiTokenAmount.uiAmount) || 0); }
  return Object.entries(bal).filter(([, x]) => x.post !== x.pre).map(([mint, x]) => ({ wallet, chain: 'solana', token: mint, symbol: null, side: x.post > x.pre ? 'buy' : 'sell', at, tx: sig })); }
// the deepest DexScreener pair for a token on its chain
export function bestPair(j, token, chain) { return ((j && j.pairs) || []).filter((p) => p.chainId === chain && p.baseToken && String(p.baseToken.address).toLowerCase() === String(token).toLowerCase()).sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0))[0] || null; }
// the proven wallets, from the scorecard (only those with a positive copyable return, never a cherry-picker or a decayed one)
export function provenFrom(ws, cfg = COPY) { return ((ws && ws.proven) || []).filter((x) => x && x.w && chainOfWallet(x.w) && !x.cherry && !x.decayed && (x.copyPct ?? 0) > cfg.minCopyPct).slice(0, cfg.maxWallets); }
const short = (w) => w.slice(0, 6) + '…' + w.slice(-4);
// each cycle: refresh the proven list hourly, read each wallet's latest moves, turn fresh buys into setups and remember sells (for the mirror exit)
export async function copySetupsIn(st, cfg, { G, rpc, J, now, nowIso }) {
  const C = { ...COPY, ...(cfg.copy || {}) }; if (now - (st.copyAt || 0) < C.everySec * 1000) return; st.copyAt = now;
  if (!st.proven || now - (st.provenAt || 0) > C.provenEveryMin * 60e3) { try { const before = new Set((st.proven || []).map((x) => x.w)), had = !!st.proven; st.proven = provenFrom(await G(cfg.site + 'walletscore.json'), C); st.provenAt = now;
      /* the scorecard's list decides: a newly proven wallet is followed from now on, one that drops off is no longer copied (open copies run their exits) */
      const after = new Set(st.proven.map((x) => x.w)); if (had) { for (const x of st.proven) if (!before.has(x.w)) J({ type: 'copy', wallet: short(x.w), side: 'added', why: `newly proven by the scorecard (ran on ${x.wins} of ${x.n} coins, ${x.copyPct >= 0 ? '+' : ''}${x.copyPct}% a copy): followed from now on` }); for (const w of before) if (!after.has(w)) J({ type: 'copy', wallet: short(w), side: 'dropped', why: 'no longer proven by the scorecard: not copied any more' }); } } catch (e) { console.log('copy: walletscore ' + e.message); } }
  const P = st.proven || [], cur = (st.copyCursor ||= {}), sells = (st.walletSells ||= {}), fresh = [];
  for (const p of P) { const w = p.w, chain = chainOfWallet(w); let ev = [];
    try { if (chain === 'robinhood') ev = evmEvents(w, await G(`https://robinhoodchain.blockscout.com/api/v2/addresses/${w}/token-transfers?type=ERC-20`), C);
      else if (chain === 'solana' && rpc) { const sigs = ((await rpc('getSignaturesForAddress', [w, { limit: C.perWallet }])) || []).filter((s) => !s.err); const seenSig = cur[w + ':sig'];
        for (const s of sigs) { if (s.signature === seenSig) break; if (!seenSig) continue; /* first look: just set the cursor */ const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]); ev.push(...solEvents(w, tx, s.signature, C)); }
        if (sigs[0]) cur[w + ':sig'] = sigs[0].signature; } }
    catch (e) { console.log(`copy: ${short(w)} ${e.message}`); continue; }
    const first = !cur[w]; for (const e of ev) { const t = Date.parse(e.at || '') || now, key = e.tx + ':' + e.token, seen0 = (cur[w + ':seen'] ||= {}); if (seen0[key]) continue; seen0[key] = now; if (first) continue; /* first look at a wallet: what it did before the bot was watching is not copied */
      if (now - t > C.maxEventAgeMin * 60e3) continue; /* old news: the move has been made */
      if (e.side === 'sell') { sells[e.token.toLowerCase() + '|' + w] = now; J({ type: 'copy', wallet: short(w), coin: e.symbol, side: 'sell', why: 'proven wallet sold' }); } else fresh.push({ ...e, p }); }
    cur[w] = now; const seen = cur[w + ':seen'] || {}; for (const [k, t] of Object.entries(seen)) if (now - t > 2 * 86400e3) delete seen[k]; }
  for (const [k, t] of Object.entries(sells)) if (now - t > 8 * 86400e3) delete sells[k];
  // fresh buys -> setups (one per coin; a second proven wallet on the same coin is noted, not bought twice)
  for (const e of fresh) { const held = st.positions.find((x) => String(x.token || '').toLowerCase() === e.token.toLowerCase()), have = Object.values(st.setups).find((s) => String(s.token || '').toLowerCase() === e.token.toLowerCase());
    if (have) { if (!have.copyOf.includes(e.wallet)) { have.copyOf.push(e.wallet); have.why.push(`and proven wallet ${short(e.wallet)}`); } continue; } if (held) continue;
    if (now - ((st.seen || {})['copy:' + e.token] || 0) < (cfg.coolH || 24) * 3600e3) continue;
    let pair = null; try { pair = bestPair(await G('https://api.dexscreener.com/latest/dex/tokens/' + e.token), e.token, e.chain); } catch (err) { console.log('copy: pair ' + err.message); }
    if (!pair || !(+pair.priceUsd > 0)) { J({ type: 'skip', coin: e.symbol || e.token.slice(0, 6), why: `proven wallet ${short(e.wallet)} bought it, but no market for it on DexScreener` }); continue; }
    (st.seen ||= {})['copy:' + e.token] = now; const px = +pair.priceUsd, p = e.p;
    st.setups[pair.pairAddress] = { pool: pair.pairAddress, coin: (pair.baseToken && pair.baseToken.symbol) || e.symbol, chain: e.chain, token: pair.baseToken.address, kind: 'copy', setup: 'Copy: proven wallet bought', opp: null, zoneLow: px, zoneHigh: px, stop: +(px * (1 - (cfg.fixedStopPct || 25) / 100)).toPrecision(6), mults: cfg.mults, shares: cfg.shares, expireH: cfg.signalMaxAgeH || 0.5, at: nowIso, liq0: +(pair.liquidity && pair.liquidity.usd) || 0, url: pair.url,
      copyOf: [e.wallet], why: [`proven wallet ${short(e.wallet)} bought ${(pair.baseToken && pair.baseToken.symbol) || ''}: ran on ${p.wins} of its ${p.n} coins, ${p.copyPct >= 0 ? '+' : ''}${p.copyPct}% a copy (in an hour late, out a day later)`] };
    J({ type: 'setup', coin: st.setups[pair.pairAddress].coin, pool: pair.pairAddress, kind: 'copy', why: st.setups[pair.pairAddress].why }); }
}
// the mirror exit: has a wallet this position copied sold the coin since the position opened?
export function walletSold(st, pos) { const tk = String(pos.token || (pos.meta && pos.meta.token) || '').toLowerCase(), opened = Date.parse(pos.openedAt) || 0; if (!tk) return null; for (const w of (pos.meta && pos.meta.copyOf) || []) { const t = (st.walletSells || {})[tk + '|' + w]; if (t && t >= opened) return w; } return null; }
