// Runs the review council on the data files and writes docs/data/council.json. Called at the end of every scan; also runnable on its own:
//   node src/councilrun.mjs            (uses docs/data)
import fs from 'node:fs';
import path from 'node:path';
import { council, NEED } from '../docs/council.mjs';
import { trenchCouncil } from '../docs/trenchcouncil.mjs';
import { trackCouncils } from '../docs/trackcouncil.mjs';
import { buildRulebook, activeRulebook } from '../docs/bestrules.mjs';
import { tune, forwardTrades, tuneText, TUNE } from '../docs/tuner.mjs';
const rd = (dir, f, d) => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return Array.isArray(d) ? (Array.isArray(j) ? j : d) : j && typeof j === 'object' ? j : d; } catch { return d; } };

// Books waiting to earn a spot in RynoBot. Each gets its own phone alert the first time the council calls it a bot candidate
// (30+ closed paper trades, a luck-corrected edge, both halves positive, survives extra costs, beats random entries, no risk flag).
// One alert per book; it re-arms only if the book later falls to "losing", so a wobble between calls cannot spam the phone.
export const BOT_WATCH = { riskyPick: "Claude's setup on risky coins" };   // Ryan's setup became the runner bot on 22 Oct
const fR = (x) => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + 'R');
export function botSpotAlerts(c, prev = {}, watch = BOT_WATCH) {
  const spot = { ...((prev && prev.botSpot) || {}) }, alerts = [], books = (c && c.books) || [], base = books.find((b) => b.key === 'randomCtl');
  for (const [key, name] of Object.entries(watch)) {
    const b = books.find((x) => x.key === key); if (!b) continue;
    if (b.call === 'losing') { delete spot[key]; continue; }
    if (b.call !== 'bot candidate' || spot[key]) continue;
    spot[key] = { at: c.at, n: b.n, avgR: b.avgR };
    alerts.push({ key, title: `RynoBot: ${b.short} has earned a bot spot`,
      body: [`The council just called ${name} a bot candidate.`,
        `${b.n} closed paper trades, ${fR(b.avgR)} a trade (90% range ${fR(b.lo)} to ${fR(b.hi)})${b.worth != null ? `, ${Math.round(b.worth * 100)}% chance the true average is above zero` : ''}.`,
        base && base.n ? `Random entries on the same desk: ${fR(base.avgR)} a trade over ${base.n}.` : null,
        'It passed every check: enough trades, both halves of the sample positive, survives extra costs, beats random entries, no risk flag.',
        'Next step: ask Claude to add it to RynoBot as a second dry-run rulebook.',
        'Paper-tested only. Nothing trades real money unless you set that up yourself.'].filter(Boolean).join('\n') });
  }
  return { alerts, spot };
}

// the Breakout bot's filters: the learning loop's hints for the pattern, checked on trades that came after they were found
export function breakoutTuning(dir, prev, now = Date.now()) {
  const cfg = TUNE.breakout, learned = rd(dir, 'learned.json', {}), A = Array.isArray(learned.analysts) ? learned.analysts : [], d = A.find((x) => x && x.setup === cfg.pattern);
  const asHint = (c, side) => { const t = String(c.text || ''), i = t.indexOf(': '); return { feat: c.feat || (i > 0 ? t.slice(0, i) : null), bucket: c.bucket || (i > 0 ? t.slice(i + 2) : null), side: c.side || side }; };
  const hints = d ? [...(d.conditions.best || []).map((c) => asHint(c, 'only')), ...(d.conditions.avoid || []).map((c) => asHint(c, 'skip'))] : [];
  const bt = rd(dir, 'bt-trades.json', {}), inSample = (Array.isArray(bt.trades) ? bt.trades : []).filter((x) => x.setup === cfg.pattern);
  const forward = forwardTrades({ pattern: cfg.pattern, book: cfg.book, lab: rd(dir, 'lab.json', []), signals: rd(dir, 'signals.json', []), forward: rd(dir, 'forward.json', []), now });
  return tune({ cfg, hints, inSample, forward, prev: (prev && prev.botTuning && prev.botTuning.breakout) || null, now });
}
export async function runCouncil(dir = process.env.OUT_DIR || 'docs/data', { now = Date.now(), topic = '', site = '', post = null, since: sinceIn } = {}) {
  const since = sinceIn !== undefined ? sinceIn : rd('docs', 'paper-config.json', {}).since || null, prev = rd(dir, 'council.json', {});
  const botRecs = {}; try { for (const f of fs.readdirSync(path.join(dir, 'bots'))) if (f.endsWith('.json')) botRecs[f.slice(0, -5)] = rd(path.join(dir, 'bots'), f, null); } catch { /* none yet */ }
  /* the trenchers' own council first: its findings about coins and crowds go to the main council, nothing else does */
  let tc = null; try { tc = trenchCouncil({ recs: Object.fromEntries(Object.entries(botRecs).filter(([k]) => /^trench/.test(k))), prev: rd(dir, 'trench-council.json', null), now }); fs.writeFileSync(path.join(dir, 'trench-council.json'), JSON.stringify(tc)); } catch (e) { console.log('trench council: ' + e.message); }
  /* the four research tracks and the head council (docs/trackcouncil.mjs) */
  /* the best-of bot's rulebook: built from every book, bot and backtest; a changed one waits for Ryan's yes (docs/bestof-approve.json) */
  try { const proposed = buildRulebook({ council: prev, runnerBt: rd(dir, 'runner-bt.json', null), bottomBt: rd(dir, 'bottom-bt.json', null), patternBt: rd(dir, 'backtest.json', null), botRecs, now }), prevRb = rd(dir, 'bestof-rules.json', null) || (() => { const c = rd(dir, 'councils.json', null); return c && c.tracks && c.tracks.best && c.tracks.best.rulebook ? c.tracks.best.rulebook : null; })(), rb = { at: proposed.at, ...activeRulebook(prevRb, proposed, rd(path.dirname(dir), 'bestof-approve.json', null)) }; /* a lost file falls back to the copy inside councils.json; with neither, the bot waits for a yes */ fs.writeFileSync(path.join(dir, 'bestof-rules.json'), JSON.stringify(rb)); } catch (e) { console.log('best-of rulebook: ' + e.message); }
  try { const bts = Object.fromEntries(['backtest.json', 'runner-bt.json', 'bottom-bt.json', 'alts-bt.json', 'bestof-rules.json'].map((f) => [f, rd(dir, f, null)])), tk = trackCouncils({ recs: botRecs, backtests: bts, prev: rd(dir, 'councils.json', null), now }); fs.writeFileSync(path.join(dir, 'councils.json'), JSON.stringify(tk)); } catch (e) { console.log('track councils: ' + e.message); }
  const c = council({ trench: tc, signals: rd(dir, 'signals.json', []), degen: rd(dir, 'degen.json', []), lab: rd(dir, 'lab.json', []), learned: rd(dir, 'learned.json', null), wscore: rd(dir, 'walletscore.json', null), since, history: prev.history || [], now, botRecs, giants: rd(dir, 'giants.json', null), majorsBt: rd(dir, 'majors-bt.json', null) });
  const send = post || (async (title, body, tags) => { const h = { Title: title, Priority: 'high', Tags: tags }; if (site) h.Click = site; await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body, headers: h }); });
  // the books waiting for a RynoBot spot: their own alert, once each
  const bs = botSpotAlerts(c, prev); c.botSpot = bs.spot; c.botSpotNeed = NEED; c.botSpotSent = [];
  for (const a of bs.alerts) { if (!topic && !post) { delete c.botSpot[a.key]; continue; } try { await send(a.title, a.body, 'rhinoceros,robot,trophy'); c.botSpotSent.push(a.key); } catch { delete c.botSpot[a.key]; } }
  // general alert when any other book is newly called a bot candidate (rare by design)
  const before = new Set(((prev.books || []).filter((b) => b.call === 'bot candidate')).map((b) => b.key)), fresh = c.books.filter((b) => b.call === 'bot candidate' && !before.has(b.key) && !BOT_WATCH[b.key]);
  if (fresh.length && (topic || post)) { try { await send('RynoScan council: bot candidate', `${c.final.answer}\n\nPaper-tested only. Nothing trades real money unless you set it up yourself.`, 'rhinoceros,scales'); } catch { /* optional */ } }
  try { const bt = breakoutTuning(dir, prev, now); c.botTuning = { breakout: bt }; c.final.actions.push({ kind: 'auto', text: tuneText(bt) }); } catch (e) { c.botTuning = (prev && prev.botTuning) || null; }
  fs.writeFileSync(path.join(dir, 'council.json'), JSON.stringify(c));
  return c;
}
if (process.argv[1] && process.argv[1].endsWith('councilrun.mjs')) runCouncil().then((c) => { console.log('Council: ' + c.final.headline); console.log(c.final.answer); for (const h of c.hats) console.log(`- ${h.name}: ${h.headline}`); }).catch((e) => console.log('council: ' + (e.message || e)));
