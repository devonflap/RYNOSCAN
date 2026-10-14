// Extra checks that sit on top of the chart scoring: token safety (rugs/honeypots), SOL/ETH market regime,
// and a 24h-cached safety lookup. Shared by the scanner and the dashboard's Check-a-coin box.
import { ema, rsi } from './core.mjs';

// ---------- token safety ----------
const DANGER_RE = /mint authority|freeze authority|honeypot|rugged|blacklist|cannot sell|can't sell|copycat|mutable metadata.*creator/i;
export const GOPLUS_CHAIN = { eth: '1' }; // Robinhood Chain is not covered by the free feed unless you add its id in settings.goplusChainId.robinhood

export async function checkToken(p, getJson, cfg = {}) {
  const none = (why) => ({ level: 'unchecked', flags: why ? [why] : [] });
  if (!p.token) return none('no token address');
  try {
    if (p.net === 'solana') {
      const j = await getJson(`https://api.rugcheck.xyz/v1/tokens/${p.token}/report/summary`);
      const risks = Array.isArray(j?.risks) ? j.risks : null;
      if (!risks) return none('safety feed returned nothing');
      const flags = [], danger = [];
      for (const r of risks) {
        const name = String(r.name || r.description || '').trim(); if (!name) continue;
        if (r.level === 'danger' || r.level === 'warn') {
          if (DANGER_RE.test(name)) danger.push(name); else flags.push(name);
        }
      }
      if (danger.length) return { level: 'danger', flags: [...danger, ...flags] };
      return { level: flags.length ? 'warn' : 'ok', flags };
    }
    const chainId = (cfg.goplusChainId && cfg.goplusChainId[p.net]) || GOPLUS_CHAIN[p.net];
    if (!chainId) return none('safety feed does not cover this chain: check the contract yourself');
    const j = await getJson(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${p.token}`);
    const t = j?.result && (j.result[String(p.token).toLowerCase()] || Object.values(j.result)[0]);
    if (!t) return none('safety feed returned nothing');
    const danger = [], flags = [], n = (x) => Number(x || 0);
    if (t.is_honeypot === '1') danger.push('honeypot');
    if (t.cannot_sell_all === '1') danger.push('cannot sell all');
    if (n(t.sell_tax) > 0.10) danger.push('sell tax ' + Math.round(n(t.sell_tax) * 100) + '%');
    if (t.owner_change_balance === '1') danger.push('owner can change balances');
    if (t.is_blacklisted === '1') danger.push('blacklist function');
    if (n(t.buy_tax) > 0.05) flags.push('buy tax ' + Math.round(n(t.buy_tax) * 100) + '%');
    if (n(t.sell_tax) > 0.05 && n(t.sell_tax) <= 0.10) flags.push('sell tax ' + Math.round(n(t.sell_tax) * 100) + '%');
    if (t.is_mintable === '1') flags.push('owner can mint more');
    if (t.hidden_owner === '1') flags.push('hidden owner');
    if (t.can_take_back_ownership === '1') flags.push('ownership can be reclaimed');
    if (t.transfer_pausable === '1') flags.push('transfers can be paused');
    if (Array.isArray(t.holders)) { const top = t.holders.slice(0, 10).reduce((a, h) => a + n(h.percent), 0); if (top > 0.5) flags.push('top 10 wallets hold ' + Math.round(top * 100) + '%'); }
    if (danger.length) return { level: 'danger', flags: [...danger, ...flags] };
    return { level: flags.length ? 'warn' : 'ok', flags };
  } catch (e) { return none('safety feed unavailable'); }
}

// ---------- market regime (SOL for Solana coins, ETH for everything else) ----------
const lastPerBucket = (pts, sec) => { const m = new Map(); for (const [t, v] of pts) m.set(Math.floor(t / 1000 / sec), v); return [...m.keys()].sort((a, b) => a - b).map(k => m.get(k)); };
export function regimeFromPrices(pts) {
  if (!Array.isArray(pts) || pts.length < 24 * 20) return null;
  const c4 = lastPerBucket(pts, 14400), d1 = lastPerBucket(pts, 86400);
  if (c4.length < 60 || d1.length < 22) return null;
  const n4 = c4.length - 1, e20 = ema(c4, 20), e50 = ema(c4, 50), r4 = rsi(c4);
  const price = c4[n4], sma20 = d1.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const chg7 = (price / d1[d1.length - 8] - 1) * 100, chg1 = (price / d1[d1.length - 2] - 1) * 100;
  let score = 0; const why = [];
  if (price > sma20) { score++; } else { score--; why.push('below its 20-day average'); }
  if (e20[n4] > e50[n4]) { score++; } else { score--; why.push('4h trend down (20 under 50)'); }
  if (chg7 > 0) { score++; } else { score--; why.push(`down ${Math.abs(chg7).toFixed(1)}% over 7 days`); }
  let level = score >= 2 ? 'Risk-on' : score <= -2 ? 'Risk-off' : 'Neutral';
  if (chg1 < -8) { level = 'Risk-off'; why.push(`dropped ${Math.abs(chg1).toFixed(1)}% in a day`); }
  return { level, score, price, chg7: +chg7.toFixed(1), chg1: +chg1.toFixed(1), rsi4h: r4[n4] != null ? Math.round(r4[n4]) : null, why };
}
export async function fetchRegime(getCG) {
  const out = {};
  for (const [k, id] of [['sol', 'solana'], ['eth', 'ethereum']]) {
    try { const j = await getCG(`/coins/${id}/market_chart?vs_currency=usd&days=60`); out[k] = regimeFromPrices(j?.prices) || null; } catch { out[k] = null; }
  }
  return out;
}
export const regimeFor = (regime, net) => regime ? (net === 'solana' ? regime.sol : regime.eth) : null;

// ---------- apply to scored rows (mutates; call after crossCheck, before filtering) ----------
export function applyOverlays(rows, { safety = {}, regime = null, regimeFilter = 'warn' } = {}) {
  const excluded = [];
  for (const p of rows) {
    if (p.opp == null) continue;
    const s = safety[p.net + '|' + p.token]; p.rug = s ? s.level : undefined; p.rugFlags = s && s.flags.length ? s.flags.join('; ') : undefined;
    if (s && s.level === 'danger') {
      p.ready = false; if (p.pat) p.pat.ready = false; p.signal = 'No trade'; p.noTradeWhy = 'token safety: ' + s.flags[0];
      p.flags.push('TOKEN RISK: ' + s.flags.join(', ')); p.opp = Math.min(p.opp, 40); excluded.push(p.sym + ' (' + s.flags[0] + ')');
    } else if (s && s.level === 'warn') { p.flags.push('token flags: ' + s.flags.join(', ')); p.opp = Math.max(0, p.opp - 3); }
    else if (s && s.level === 'unchecked' && s.flags[0]) p.flags.push('token not checked: ' + s.flags[0]);
    const rg = regimeFor(regime, p.net);
    if (rg) {
      p.regime = rg.level;
      if (rg.level === 'Risk-off') {
        p.flags.push(`market risk-off (${p.net === 'solana' ? 'SOL' : 'ETH'} ${rg.why.slice(0, 2).join(', ')})`);
        if (regimeFilter === 'downgrade' && p.signal === 'Entry signal') { p.signal = 'Watch'; p.ready = false; if (p.pat) p.pat.ready = false; }
      }
    }
  }
  return excluded;
}
