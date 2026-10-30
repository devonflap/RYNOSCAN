// Extra checks that sit on top of the chart scoring: token safety (rugs/honeypots), SOL/ETH market regime,
// and a 24h-cached safety lookup. Shared by the scanner and the dashboard's Check-a-coin box.
import { ema, rsi } from './core.mjs?v=207bcdf506';

// ---------- token safety ----------
const DANGER_RE = /mint authority|freeze authority|honeypot|rugged|blacklist|cannot sell|can't sell|copycat|mutable metadata.*creator|top 10 holders high ownership|single holder ownership|high holder correlation|creator history/i;
export const GOPLUS_CHAIN = { eth: '1', robinhood: '4663' }; // Robinhood Chain id 4663 (GoPlus listed it as coming in 2026; when it answers nothing the Blockscout holders fallback runs)
// the hard safety gate (edge report, Oct 2026): numbers, not just names. Solana: top-10 non-LP holders at most 30% of supply, insiders at most 10%,
// mint and freeze authority revoked. EVM: not a honeypot, buy and sell tax at most 5%, not mintable, no blacklist, top-10 non-contract holders at most 30%.
export const GATE = { top10MaxPct: 30, insiderMaxPct: 10, taxMaxPct: 5 };
// Solana: the full RugCheck report carries the holder table; sum the top 10 that are not liquidity pools or known programs
export function solanaHolderGate(rep, cfg = GATE) {
  const flags = [], danger = []; if (!rep || typeof rep !== 'object') return { flags, danger, top10: null, insider: null };
  if (rep.mintAuthority) danger.push('mint authority still enabled'); if (rep.freezeAuthority) danger.push('freeze authority still enabled');
  const lpOwners = new Set((rep.markets || []).flatMap((m) => [m.pubkey, m.lp && m.lp.lpMint, m.marketAddress].filter(Boolean)));
  const H = (Array.isArray(rep.topHolders) ? rep.topHolders : []).filter((h) => h && !lpOwners.has(h.owner) && !lpOwners.has(h.address) && !/raydium|orca|meteora|pump|jupiter|amm|pool/i.test(String(h.ownerLabel || h.label || ''))).slice(0, 10);
  const top10 = H.length ? +H.reduce((a, h) => a + (+h.pct || 0), 0).toFixed(1) : null, insider = H.length ? +H.filter((h) => h.insider).reduce((a, h) => a + (+h.pct || 0), 0).toFixed(1) : null;
  if (top10 != null && top10 > cfg.top10MaxPct) danger.push(`top 10 wallets hold ${top10}% (gate ${cfg.top10MaxPct}%)`); if (insider != null && insider > cfg.insiderMaxPct) danger.push(`insider wallets hold ${insider}% (gate ${cfg.insiderMaxPct}%)`);
  const lp = (rep.markets || []).map((m) => +(m.lp && m.lp.lpLockedPct)).filter((x) => isFinite(x)); if (lp.length && Math.max(...lp) < 20) flags.push(`only ${Math.round(Math.max(...lp))}% of liquidity locked or burned (no protection against a bundle anyway)`);
  return { flags, danger, top10, insider };
}
// EVM: GoPlus fields to the same gate; holders from GoPlus or, failing that, Blockscout (Robinhood chain)
export function evmHolderGate(holders, cfg = GATE) {
  const H = (Array.isArray(holders) ? holders : []).filter((h) => h && !(h.is_contract === 1 || h.is_contract === '1' || h.isContract)).slice(0, 10); if (!H.length) return { top10: null, danger: [] };
  const top10 = +H.reduce((a, h) => a + (+h.percent || +h.pct || 0) * (h.percent != null && +h.percent <= 1 ? 100 : 1), 0).toFixed(1);
  return { top10, danger: top10 > cfg.top10MaxPct ? [`top 10 wallets hold ${top10}% (gate ${cfg.top10MaxPct}%)`] : [] };
}

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
      // liquidity lock (the summary reports the share of LP that is locked or burned, when it knows)
      const lp = Number(j.lpLockedPct ?? j.lpLocked?.pct); if (cfg.holderChecks !== false && Number.isFinite(lp) && lp < 20 && !flags.some(f => /liquidity|lp/i.test(f))) flags.push('only ' + Math.round(lp) + '% of liquidity is locked or burned');
      // the hard gate: the full report's holder table (one more free call; skipped when the summary already says danger)
      let gate = null; if (!danger.length && cfg.hardGate !== false) { try { const rep = await getJson(`https://api.rugcheck.xyz/v1/tokens/${p.token}/report`); gate = solanaHolderGate(rep, cfg.gate); danger.push(...gate.danger); for (const f of gate.flags) if (!flags.includes(f)) flags.push(f); } catch { flags.push('holder table unavailable: top-10 and insider share not checked'); } }
      if (danger.length) return { level: 'danger', flags: [...danger, ...flags], top10: gate && gate.top10, insider: gate && gate.insider };
      return { level: flags.length ? 'warn' : 'ok', flags, top10: gate && gate.top10, insider: gate && gate.insider };
    }
    const chainId = (cfg.goplusChainId && cfg.goplusChainId[p.net]) || GOPLUS_CHAIN[p.net];
    if (!chainId) return none('safety feed does not cover this chain: check the contract yourself');
    const j = await getJson(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${p.token}`);
    const t = j?.result && (j.result[String(p.token).toLowerCase()] || Object.values(j.result)[0]);
    if (!t) { if (p.net === 'robinhood' && cfg.hardGate !== false) return blockscoutGate(p, getJson, cfg); return none('safety feed returned nothing'); }
    const danger = [], flags = [], n = (x) => Number(x || 0);
    if (t.is_honeypot === '1') danger.push('honeypot');
    if (t.cannot_sell_all === '1') danger.push('cannot sell all');
    if (n(t.sell_tax) > 0.10) danger.push('sell tax ' + Math.round(n(t.sell_tax) * 100) + '%');
    if (t.owner_change_balance === '1') danger.push('owner can change balances');
    if (t.is_blacklisted === '1') danger.push('blacklist function');
    if (n(t.buy_tax) > 0.05) danger.push('buy tax ' + Math.round(n(t.buy_tax) * 100) + '% (gate 5%)');
    if (n(t.sell_tax) > 0.05 && n(t.sell_tax) <= 0.10) danger.push('sell tax ' + Math.round(n(t.sell_tax) * 100) + '% (gate 5%)');
    if (t.is_mintable === '1') danger.push('owner can mint more');
    if (t.hidden_owner === '1') flags.push('hidden owner');
    if (t.can_take_back_ownership === '1') flags.push('ownership can be reclaimed');
    if (t.transfer_pausable === '1') flags.push('transfers can be paused');
    if (Array.isArray(t.holders)) { const g = evmHolderGate(t.holders, cfg.gate); danger.push(...g.danger); }
    if (cfg.holderChecks !== false && Array.isArray(t.lp_holders) && t.lp_holders.length) { const lock = t.lp_holders.filter(h => h.is_locked === 1 || h.is_locked === '1' || /^0x0{10,}|dead$/i.test(String(h.address || ''))).reduce((a, h) => a + n(h.percent), 0); if (lock < 0.2) flags.push('only ' + Math.round(lock * 100) + '% of liquidity is locked or burned'); }
    if (danger.length) return { level: 'danger', flags: [...danger, ...flags] };
    return { level: flags.length ? 'warn' : 'ok', flags };
  } catch (e) { return none('safety feed unavailable'); }
}

// Robinhood chain fallback when GoPlus has nothing: Blockscout's free holders table (top-10 non-contract share) and a sell-count check
async function blockscoutGate(p, getJson, cfg = {}) {
  try { const j = await getJson(`https://robinhoodchain.blockscout.com/api/v2/tokens/${p.token}/holders`), items = Array.isArray(j && j.items) ? j.items : [], total = +(items[0] && items[0].token && items[0].token.total_supply) || null;
    const holders = items.map((it) => ({ address: it.address && it.address.hash, isContract: !!(it.address && it.address.is_contract), pct: total ? (+it.value / total) * 100 : (+it.value_percentage || 0) }));
    const g = evmHolderGate(holders.map((h) => ({ ...h, percent: h.pct })), cfg.gate); const flags = ['honeypot and tax not checkable on this chain yet (GoPlus has no data): sell-test by hand before any live order'];
    return { level: g.danger.length ? 'danger' : 'warn', flags: [...g.danger, ...flags], top10: g.top10 }; } catch { return { level: 'unchecked', flags: ['safety feed does not cover this chain yet: check the contract yourself'] }; }
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
  return { level, score, price, chg7: +chg7.toFixed(1), chg1: +chg1.toFixed(1), rsi4h: r4[n4] != null ? Math.round(r4[n4]) : null, aboveSma20: price > sma20, sma20: +sma20.toPrecision(6), why };
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

// Cooldown: a coin whose last signal ended "stopped out" within `hours` cannot be an Entry signal again yet.
// Returns how many coins were held back. Never throws on odd rows: it just skips them.
export function applyCooldown(rows, prevSignals, hours = 48, CH = {}, now = Date.now()) {
  const cooling = new Set();
  for (const s of prevSignals || []) if (s.status === 'stopped out' && s.closedAt && now - Date.parse(s.closedAt) < hours * 3600e3) cooling.add(s.id);
  let n = 0;
  for (const p of rows) {
    if (p.opp == null || p.signal !== 'Entry signal') continue;
    const id = String(CH[p.chain] || p.chain || '').slice(0, 3).toUpperCase() + ':' + p.sym;
    if (!cooling.has(id)) continue;
    p.signal = 'Watch'; p.ready = false; if (p.pat) p.pat.ready = false;
    (p.flags = p.flags || []).push(`cooling off: stopped out within ${hours}h`); p.opp = Math.max(0, p.opp - 10); n++;
  }
  return n;
}
