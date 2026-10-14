import * as C from '../docs/core.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const t0 = 1.7e9;
const mk = (cs0, vols0, wick = 0.006) => { const pad = Math.max(0, 70 - cs0.length), cs = [...Array(pad).fill(cs0[0]), ...cs0], vols = vols0 ? [...Array(pad).fill(vols0[0]), ...vols0] : null; return cs.map((c, i) => { const o = i ? cs[i - 1] : c; return [t0 + i * 14400, o, Math.max(o, c) * (1 + wick), Math.min(o, c) * (1 - wick), c, vols ? vols[i] : 1000]; }); };
const flat = (v, n) => Array(n).fill(v);
const names = (h4) => { C.RULES.allowShadow = true; const r = C.detectPatterns(h4).map(x => x.name); C.RULES.allowShadow = false; return r; };
// 1. ascending triangle
{ const cs = [...flat(1, 20)]; for (let i = 0; i < 50; i++) { const top = 1.5, D = 1.1 + 0.35 * i / 50, ph = (i % 10) / 10; cs.push(top - (top - D) * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph))); } cs.push(1.52, 1.56);
  const h4 = mk(cs); const r = names(h4); ok(r.includes('Ascending triangle'), 'ascending triangle detected: ' + r.join(',')); ok(!C.detectPatterns(h4).some(x => x.name === 'Ascending triangle'), 'ascending triangle is silent when shadowed'); }
// 2. tight base breakout
{ const cs = []; for (let i = 0; i < 30; i++) cs.push(2 - i * 0.033); for (let i = 0; i < 24; i++) cs.push(1.02 + 0.05 * (1 + Math.sin(i * 1.3))); cs.push(1.13, 1.16);
  const vols = cs.map((_, i) => i < 30 ? 2000 : i < 54 ? 500 : 1500); const r = names(mk(cs, vols)); ok(r.includes('Base breakout'), 'base breakout detected: ' + r.join(',')); }
// 3. breakout retest
{ const cs = [...flat(1, 25)]; cs.push(1.1, 1.2, 1.1, 1.0, 1.0, 1.0); for (let i = 0; i < 12; i++) cs.push(1.0 + 0.04 * i); for (let i = 0; i < 5; i++) cs.push(1.44 - 0.045 * i); cs.push(1.22, 1.21, 1.2, 1.215);
  const h4 = mk(cs); const r = names(h4); ok(r.includes('Breakout retest'), 'breakout retest detected: ' + r.join(',')); }
// 4. liquidity sweep reclaim
{ const cs = [...flat(1.5, 20)]; for (let i = 0; i < 15; i++) cs.push(1.5 - i * 0.035); cs.push(1.0, 1.02); for (let i = 0; i < 14; i++) cs.push(1.05 + 0.02 * i + (i % 2) * 0.02); cs.push(1.06, 1.12);
  const h4 = mk(cs); const sj = cs.findIndex(x => x === 1.02) ; h4.push([t0 + h4.length * 14400, 1.2, 1.2, 0.96, 1.05, 4000]); const r = names(h4); ok(r.includes('Liquidity sweep reclaim'), 'liquidity sweep reclaim detected: ' + r.join(',')); }
// applyLearned
{ const was = JSON.stringify([C.RULES.off, C.RULES.shadow]); C.applyLearned({ promote: ['Base breakout', 'Trend pullback'], demote: ['Falling wedge'] });
  ok(!C.RULES.shadow.includes('Base breakout') && !C.RULES.off.includes('Trend pullback') && C.RULES.off.includes('Falling wedge'), 'learned promote/demote applied');
  const [o, s] = JSON.parse(was); C.RULES.off = o; C.RULES.shadow = s; }
