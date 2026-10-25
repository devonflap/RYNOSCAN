// THE BEST-OF BOT (25 Oct, the head council's own; paper only, never live). It trades its own rulebook, built from everything the paper
// traders and backtests have found (docs/bestrules.mjs -> docs/data/bestof-rules.json, rebuilt with every council run): only entries and
// exits that made money on both halves of their data, the one with the best worse half winning, and every proven "avoid" lesson. It
// trades the ACTIVE rulebook; a changed one waits for Ryan's yes. A position keeps the exits of the rulebook it was opened under.
export const BEST = { everyMin: 60 };
// read the rulebook in force (hourly); the journal records every change of version
export async function loadRules(st, cfg, { G, J, now, H }) {
  const B = { ...BEST, ...(cfg.best || {}) }; if (now - (st.rulesAt || 0) < B.everyMin * 60e3) return st.rules || null; st.rulesAt = now; let bad = false;
  try { const f = await G(cfg.site + 'bestof-rules.json'), a = f && f.active; if (a && Array.isArray(a.entries) && (!f.at || !st.rules || !st.rules.at || f.at >= st.rules.at)) { if (!st.rules || st.rules.version !== a.version) J({ type: 'rules', version: a.version, entries: a.entries.map((e) => `${e.type} ${e.combo}`), why: a.entries.length ? a.entries.map((e) => e.evidence).join('; ') : 'nothing has earned a place in the rulebook yet: no new buys' }); st.rules = { ...a, at: f.at || a.at }; st.rulesOkAt = now; } else if (!a) bad = 'no rulebook in the file'; } catch (e) { bad = e.message; console.log('bestof rules: ' + e.message); }
  /* an older copy served by the page cache is ignored; a rulebook unreadable for hours is a phone alert (the bot keeps the last one it had) */
  if (H) await H('rules', bad ? String(bad).slice(0, 60) : false, { afterMin: 180, title: 'the best-of rulebook', text: (m, why) => `The best-of bot has not been able to read its rulebook (bestof-rules.json) for ${m} minutes (${why}). It keeps trading the last rulebook it had${st.rules ? ' (' + st.rules.version + ')' : ''}. Check that the scanner is running on GitHub.` });
  return st.rules || null; }
export const ruleFor = (st, type) => ((st.rules && st.rules.entries) || []).find((e) => e.type === type) || null;
// a setup found under a rule carries that rule's exits, so the position keeps them even if the rulebook later changes
export function tagSetup(s, rule, version) { if (!s || !rule || s.vcfg) return s; s.vcfg = { ...rule.exit }; s.mults = rule.exit.mults; s.shares = rule.exit.shares; s.rule = version; s.setup = `Best-of (${rule.type === 'base' ? 'base breakout' : 'bottomed-out DCA'} "${rule.combo}")`; s.why = [...(s.why || []), 'rulebook ' + version + ': ' + rule.evidence]; return s; }
