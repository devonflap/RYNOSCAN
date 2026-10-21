// The kitty: banked profit is swept out of the trading pot so it is never risked again.
// The pot stays at its start size (accountUsd, $10,000). Whenever the cash in the pot plus what is still invested in open positions
// adds up to more than the start, the excess is banked profit, and it is moved to the kitty (at least kittyMinUsd at a time, from cash
// only). Position sizing, the daily loss limit and risk in use all look at the pot, never the kitty, so a winning streak does not
// grow the bets, and the kitty is never used to top the pot up after losses: what is swept is yours.
//   dry / rehearsal: a paper kitty (st.kitty), shown on the desk.
//   live: the same amount of SOL or ETH is actually sent from the bot's wallet to your kitty wallet (kittyWallet in config: the PUBLIC
//   address of your own Phantom, so the bot can only ever send profit to you, and from there you off-ramp). No kitty wallet set in live
//   mode means no sweeping (and a one-time phone message), because paper and wallet would otherwise drift apart.
export const KITTY = { kitty: true, kittyMinUsd: 25 };
// the kitty wallet must look like an address on the bot's chain (a public address: no key is ever needed for it)
export const validKitty = (a, chain) => /robinhood/i.test(chain || '') ? /^0x[0-9a-fA-F]{40}$/.test(String(a || '')) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a || ''));

// what is still invested in a position: its cost less the part already sold back
export const invested = (p) => p.units > 0 ? p.costUsd * (p.remUnits / p.units) : 0;
// the sweep to make now, or null
export function sweepPlan(st, cfg) {
  if (cfg.kitty === false) return null; const base = st.start || cfg.accountUsd, pot = st.cash + (st.positions || []).reduce((a, p) => a + invested(p), 0), excess = pot - base;
  const usd = Math.min(excess, st.cash); if (!(usd >= (cfg.kittyMinUsd ?? KITTY.kittyMinUsd))) return null; return { usd: +usd.toFixed(2), potAfter: +(pot - usd).toFixed(2) };
}
// apply a sweep to the paper books (the day's loss baseline moves with it, so a sweep never reads as a loss)
export function applySweep(st, usd, extra = {}) { st.cash = +(st.cash - usd).toFixed(2); st.kitty = +((st.kitty || 0) + usd).toFixed(2); if (st.dayStartEq != null) st.dayStartEq -= usd; st.sweeps = [...(st.sweeps || []), { usd, ...extra }].slice(-500); return st.kitty; }
// how much native coin to send for a sweep, leaving the fee reserve in the wallet; null if the wallet cannot cover it
export function nativeFor(usd, nativeUsd, walletNative, reserve) { if (!(nativeUsd > 0)) return null; const n = usd / nativeUsd; return walletNative - n >= reserve ? +n.toFixed(6) : null; }
