// THE BOTTOMED-OUT BOT (25 Oct, Ryan's call, from ChillTRD's risk-on / risk-off framework; paper only, never live). Quality Solana meme
// coins (90+ days old, $1m+ market cap, $50k+ a day of volume) that fall 70%, 80% and 90% under their high of the last year are bought a
// clip at each level, the day the level is first reached (docs/data/bottoms.json, written daily by src/bottoms.mjs on GitHub with the
// same rules as the weekly bottomed-out backtest). Each clip is held through the next risk-on spell and sold when the market flips back to
// risk-off (SOL closes under its 20-day average two days running), with a 40% stop and 180 days at most. The backtest's best line
// (dca / riskoff): +8.5% a clip over a year, but +16.6% in the older half and -7.1% in the newer, so this is a test, not a proven edge.
import { bestPair } from './copy.mjs';
export const LEVELS = [0.7, 0.8, 0.9];
export const BOTTOMS = { everyMin: 30, staleD: 3, stopPct: 40 };
const short = (x) => Math.round(x * 100);
// bottoms.json -> setups (one per coin and level, the first time the level shows up as reached); the market switch is remembered for the exit
export async function bottomSetupsIn(st, cfg, { G, J, now, nowIso }) {
  const B = { ...BOTTOMS, ...(cfg.bottoms || {}) }; if (now - (st.bottomsAt || 0) < B.everyMin * 60e3) return; st.bottomsAt = now;
  let b; try { b = await G(cfg.site + 'bottoms.json'); } catch (e) { console.log('bottoms: ' + e.message); return; }
  if (!b || !Array.isArray(b.coins) || !b.at) return;
  if (now - Date.parse(b.at) > B.staleD * 86400e3) { if (!st.staleWarned || now - st.staleWarned > 86400e3) { st.staleWarned = now; J({ type: 'skip', why: `bottoms.json is from ${b.at.slice(0, 10)}: the daily GitHub job has not run, so no new buys and the market switch is not updated` }); } return; }
  const was = st.regime && st.regime.riskOn; st.regime = { riskOn: b.riskOn === true, at: b.at, why: b.regimeWhy || null };
  if (was != null && was !== st.regime.riskOn) J({ type: 'regime', riskOn: st.regime.riskOn, why: st.regime.riskOn ? 'SOL back over its 20-day average: risk-on' : 'SOL under its 20-day average two days running: risk-off (holds that have seen risk-on are sold)' });
  const done = (st.dcaDone ||= {});
  for (const c of b.coins) { if (!c || !c.token || !(c.dd > 0)) continue; const fresh = (c.fresh || LEVELS.filter((l) => c.dd >= l)).filter((l) => !done[c.token + '|' + l]); if (!fresh.length) continue;
    for (const l of fresh) done[c.token + '|' + l] = nowIso;
    let pair = null; try { pair = bestPair(await G('https://api.dexscreener.com/latest/dex/tokens/' + c.token), c.token, 'solana'); } catch (e) { console.log('bottoms pair: ' + e.message); }
    if (!pair || !(+pair.priceUsd > 0)) { J({ type: 'skip', coin: c.symbol, why: `${short(c.dd)}% under its high, but no market for it on DexScreener` }); continue; }
    const px = +pair.priceUsd;
    for (const l of fresh) { const key = pair.pairAddress + '#' + short(l);
      st.setups[key] = { pool: pair.pairAddress, coin: (pair.baseToken && pair.baseToken.symbol) || c.symbol, chain: 'solana', token: c.token, kind: 'dca', dca: true, setup: `DCA at -${short(l)}% from the high (Chill)`, opp: null, zoneLow: px, zoneHigh: px, stop: +(px * (1 - B.stopPct / 100)).toPrecision(6), mults: [], shares: [], expireH: 24, at: nowIso, liq0: +(pair.liquidity && pair.liquidity.usd) || 0, url: pair.url, level: l,
        why: [`${c.symbol} is ${short(c.dd)}% under its high of the last year (first reached -${short(l)}% ${c.firstAt ? 'on ' + String(c.firstAt).slice(0, 10) : 'now'})`, `$${Math.round((c.mcap || 0) / 1e6)}m market cap, $${Math.round((c.vol30 || 0) / 1000)}k a day traded over the month, ${c.ageD || '90+'} days old`, `market ${st.regime.riskOn ? 'risk-on' : 'risk-off'}: held until the next flip from risk-on back to risk-off`] };
      J({ type: 'setup', coin: st.setups[key].coin, pool: pair.pairAddress, kind: 'dca', why: st.setups[key].why }); } }
}
// the risk-off exit: a clip that has seen the market risk-on (at or after the buy) is sold when it turns risk-off
export function regimeExitWhy(st, pos) { const R = st.regime; if (!R) return null; if (R.riskOn) { pos.seenOn = true; return null; } return pos.seenOn ? 'risk-off: SOL closed under its 20-day average two days running, so the hold is sold (Chill\'s risk-on / risk-off rule)' : null; }
