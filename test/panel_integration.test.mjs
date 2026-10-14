// panel on real scorer output (mock market): never throws, always returns a well-formed verdict
import { installMock } from './mock.mjs'; const { pools } = installMock(globalThis);
import * as C from '../docs/core.mjs';
import { debate, planView } from '../docs/panel.mjs';
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
let n = 0, withPlan = 0, bad = 0; const verdicts = {};
for (const net of ['solana', 'robinhood']) for (const q of pools[net].slice(0, 25)) {
  const r = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${q.addr}/ohlcv/hour?aggregate=1&limit=1000`)).json();
  const p = { sym: q.sym, net, chain: net, pool: q.addr, token: q.tokenAddr, price: q.price, v24: q.v24, v1: q.v24 / 24, liq: q.liq, b1: 30, s1: 24, b24: 700, s24: 620, buyers24: 400, sellers24: 380, ch24: q.ch24, flags: [], created: new Date(Date.now() - q.ageDays * 864e5).toISOString() };
  if (!C.techFromRaw(p, r.data.attributes.ohlcv_list)) continue; C.scoreList([p], Date.now()); n++;
  const row = C.toRow(p, 'x'); try { const d = debate(planView(row), { learned: null, volRatio: 1 }); if (d) { withPlan++; verdicts[d.verdict] = (verdicts[d.verdict] || 0) + 1; if (!['ENTER', 'SMALL', 'WAIT', 'PASS'].includes(d.verdict) || !Array.isArray(d.bull) || !Array.isArray(d.bear) || !d.why) bad++; } } catch (e) { bad++; console.log(e.message); } }
ok(n > 20 && bad === 0, `panel ran on ${n} scored coins (${withPlan} with a plan, verdicts ${JSON.stringify(verdicts)}), ${bad} malformed`);
