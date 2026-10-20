// Is RynoBot alive? The bot posts a heartbeat every 30 minutes to a silent second ntfy topic (<NTFY_TOPIC>-hb) that your phone
// doesn't subscribe to. The watchdog workflow runs this every 30 minutes: if the heartbeats stop for 90 minutes it tells your phone
// once (between 6am and 10pm Brisbane; a night outage is reported at 6am), and once more when they start again. It leaves a
// marker on the heartbeat topic so the same outage is never reported twice. ntfy keeps messages for 12 hours, so no heartbeat at
// all in that time means the bot isn't installed yet (or the outage was already reported), and it stays quiet.
// decide() is pure so it can be tested; the CLI at the bottom is what the workflow calls.
export const QUIET_MIN = 90;
const awake = (ms) => { const h = (new Date(ms).getUTCHours() + 10) % 24; return h >= 6 && h < 22; };
const bne = (ms) => new Date(ms + 10 * 3600e3).toISOString().slice(11, 16);
// each bot tags its heartbeat "hb:<name> ..." (older heartbeats "hb <time> ..." are the rules bot); markers carry the same name
const nameOf = (msg) => { const m = /^(hb|quiet-alerted|back-noted)(?::(\S+))?/.exec(msg || ''); return m ? m[2] || 'rules' : null; };
export const botsIn = (msgs) => [...new Set((msgs || []).filter((m) => /^hb/.test(m.message || '')).map((m) => nameOf(m.message)))];
// msgs: ntfy cached messages [{ time (unix seconds), message }]
export function decide(msgs, { now = Date.now(), quietMin = QUIET_MIN, name = 'rules' } = {}) {
  const mine = (msgs || []).filter((m) => nameOf(m.message) === name), at = (re) => mine.filter((m) => re.test(m.message || '')).map((m) => m.time * 1000), hb = at(/^hb\b|^hb:/), quiet = at(/^quiet-alerted/), back = at(/^back-noted/);
  const lastHb = hb.length ? Math.max(...hb) : null, lastQuiet = quiet.length ? Math.max(...quiet) : null;
  if (lastHb == null) return { action: 'none', reason: 'no heartbeat in the last 12 hours (bot not installed yet, or already reported)' };
  const mins = Math.round((now - lastHb) / 60000);
  if (mins < quietMin) {
    if (lastQuiet != null && lastHb > lastQuiet && !back.some((t) => t > lastQuiet)) return awake(now) ? { action: 'back', mins, reason: 'heartbeats are back after a reported outage', since: lastQuiet } : { action: 'wait', mins, reason: 'back again; will say so after 6am Brisbane' };
    return { action: 'ok', mins, reason: `last heartbeat ${mins} minutes ago` };
  }
  if (lastQuiet != null && lastQuiet > lastHb) return { action: 'already', mins, reason: 'this outage was already reported' };
  if (!awake(now)) return { action: 'wait', mins, reason: 'night time: will report after 6am Brisbane' };
  return { action: 'alert', mins, last: lastHb, reason: `no heartbeat for ${mins} minutes` };
}
export function message(d, name = 'rules') {
  const label = name === 'rules' ? 'RynoBot' : 'RynoBot ' + name;
  if (d.action === 'alert') { const h = Math.floor(d.mins / 60), m = d.mins % 60;
    return { title: `${label} has gone quiet`, priority: 'high', body: `No heartbeat from ${label} since ${bne(d.last)} Brisbane (${h ? h + 'h ' : ''}${m}m ago). The server may be off, or the bot stopped.\nCheck: DigitalOcean > your droplet is On. Then in its console: systemctl status rynobot@${name}\nRestart it with: systemctl restart rynobot@${name}\nIt's a dry run, so no money is at risk.` }; }
  if (d.action === 'back') return { title: `${label} is back`, priority: 'default', body: `Heartbeats from ${label} have started again. Nothing for you to do.` };
  return null;
}
if (process.argv[1] && process.argv[1].endsWith('botwatch.mjs')) {
  const topic = (process.env.NTFY_TOPIC || '').trim();
  if (!topic) { console.log('botwatch: no NTFY_TOPIC, skipped'); process.exit(0); }
  const hbUrl = 'https://ntfy.sh/' + encodeURIComponent(topic + '-hb');
  try {
    const r = await fetch(hbUrl + '/json?poll=1&since=12h', { signal: AbortSignal.timeout(20000) }), txt = await r.text();
    const msgs = txt.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m && m.event === 'message');
    const names = botsIn(msgs); if (!names.length) console.log('botwatch: no heartbeat in the last 12 hours (no bot installed yet, or already reported)');
    for (const name of names) { const d = decide(msgs, { name }), m = message(d, name); console.log(`botwatch ${name}: ${d.action} (${d.reason})`);
      if (m) { await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: m.body, headers: { Title: m.title, Priority: m.priority, Tags: 'robot,rhinoceros' } });
        await fetch(hbUrl, { method: 'POST', body: (d.action === 'alert' ? 'quiet-alerted:' : 'back-noted:') + name, headers: { Priority: 'min' } }); } }
  } catch (e) { console.log('botwatch: could not check (' + (e.message || e) + ')'); }
}
