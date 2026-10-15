import * as C from '../docs/core.mjs';
const wasOff = C.RULES.off; C.RULES.off = []; // detector is tested with the pattern switched on
// 4h bars: quiet base, +80% leg up, 78% retrace, base, bounce
const px = []; let p = 1; const add = (to, n, v = 0.01) => { const f = p; for (let i = 1; i <= n; i++) { p = f + (to - f) * i / n; px.push(p * (1 + Math.sin(px.length * 1.7) * v)); } };
add(1, 60); add(1.8, 14); add(1.8 - 0.8 * 0.78, 22); add(1.18, 6); add(1.32, 6);
const t0 = 1.7e9, h4 = px.map((c, i) => { const o = i ? px[i - 1] : c; return [t0 + i * 14400, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 1000 + (i > 95 ? 1500 : 0)]; });
const pats = C.detectPatterns(h4), pb = pats.find(x => x.name === 'Trend pullback');
console.log(pb ? `PASS detected: quality ${pb.quality}, status ${pb.status}, rr2 ${pb.plan.rr2}, risk ${pb.plan.riskPct}%` : 'FAIL not detected (found: ' + pats.map(x => x.name).join(',') + ')');
// shallow 40% pullback must NOT count
const q = []; p = 1; px.length = 0; add(1, 60); add(1.8, 14); add(1.8 - 0.8 * 0.4, 22); add(1.5, 6); add(1.6, 6);
const h4b = px.map((c, i) => { const o = i ? px[i - 1] : c; return [t0 + i * 14400, o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 1000]; });
console.log(C.detectPatterns(h4b).some(x => x.name === 'Trend pullback') ? 'FAIL shallow pullback detected' : 'PASS shallow 40% pullback ignored');
process.exitCode = pb ? 0 : 1;

C.RULES.off = wasOff;
console.log(C.detectPatterns(h4).some(x => x.name === 'Trend pullback') ? 'PASS Trend pullback keeps running by default (no pattern is switched off)' : 'FAIL Trend pullback should run by default');
