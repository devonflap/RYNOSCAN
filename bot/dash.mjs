// The bot desk: a read-only web dashboard for both bots, served from the bot server.
//   node bot/dash.mjs        (systemd runs it as rynobot-dash; see bot/README.md)
// Open http://<server address>:8080 on your computer and sign in with the password chosen at install (any user name).
// It only READS the bots' state files and journals. Nothing on the page can change a setting, place an order or stop a bot.
// Charts of a coin come from GeckoTerminal's free 5-minute candles, fetched by the server (cached, at most 12 a minute).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BOTS, filesFor, loadConfig } from './run.mjs';
import { deskSummary } from './desk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), PAGE = path.join(HERE, 'dash.html'), LOGO = path.join(HERE, '..', 'docs', 'logo.png');
const GT = { solana: 'solana', robinhood: 'robinhood', ethereum: 'eth', eth: 'eth' };
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// the last lines of a journal (it can grow for months; only the tail is read)
function tail(f, bytes = 200000) { try { const st = fs.statSync(f), fd = fs.openSync(f, 'r'), n = Math.min(bytes, st.size), b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd); const lines = b.toString('utf8').split('\n'); if (n < st.size) lines.shift(); return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

export function desk(now = Date.now()) {
  const bots = Object.keys(BOTS).map((name) => { const F = filesFor(name), cfg = loadConfig(name); return deskSummary(name, { st: rd(F.state, null), cfg, journal: tail(F.journal), reality: rd(F.reality, null), stopFile: fs.existsSync(F.stop) || fs.existsSync(F.stopAll), now }); });
  const on = bots.filter((b) => b.installed), start = on.reduce((a, b) => a + b.account.start, 0), eq = on.reduce((a, b) => a + b.account.equity, 0);
  return { at: new Date(now).toISOString().slice(0, 19) + 'Z', mode: 'dry run', combined: { start, equity: +eq.toFixed(2), pnl: +(eq - start).toFixed(2), pnlPct: start ? +((eq / start - 1) * 100).toFixed(2) : null }, bots };
}

// 5-minute candles for the analysis chart, shared by everyone viewing the page
const cache = new Map(); let calls = [];
export async function candles(chain, pool, fetcher = fetch, now = Date.now()) {
  const net = GT[String(chain || '').toLowerCase()]; if (!net || !/^[A-Za-z0-9]{20,90}$/.test(String(pool || ''))) return { error: 'unknown coin' };
  const k = net + ':' + pool, hit = cache.get(k); if (hit && now - hit.at < 60e3) return hit.data;
  calls = calls.filter((t) => now - t < 60e3); if (calls.length >= 12) return hit ? hit.data : { error: 'busy, try again in a minute' }; calls.push(now);
  try { const r = await fetcher(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd&token=base`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(), raw = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list;
    const data = { bars: Array.isArray(raw) ? raw.map((b) => b.map(Number)).sort((a, b) => a[0] - b[0]) : [] }; cache.set(k, { at: now, data }); if (cache.size > 200) cache.delete(cache.keys().next().value); return data;
  } catch (e) { return hit ? hit.data : { error: 'chart feed unavailable (' + e.message + ')' }; }
}

// password check (any user name), with a slowdown after repeated wrong passwords from one address
const fails = new Map();
export function authorised(req, pass) {
  const h = String(req.headers.authorization || ''); if (!h.startsWith('Basic ')) return false;
  const got = Buffer.from(h.slice(6), 'base64').toString('utf8'), pw = got.slice(got.indexOf(':') + 1), a = crypto.createHash('sha256').update(pw).digest(), b = crypto.createHash('sha256').update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}
export function server(pass, { fetcher = fetch } = {}) {
  return http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || '?', f = fails.get(ip) || { n: 0, at: 0 }, send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" }); res.end(body); };
    if (f.n >= 10 && Date.now() - f.at < 10 * 60e3) return send(429, JSON.stringify({ error: 'too many wrong passwords, wait 10 minutes' }));
    if (!authorised(req, pass)) { if (req.headers.authorization) fails.set(ip, { n: f.n + 1, at: Date.now() }); res.writeHead(401, { 'www-authenticate': 'Basic realm="RynoBot desk", charset="UTF-8"', 'content-type': 'text/plain' }); return res.end('Password needed (any user name).'); }
    fails.delete(ip);
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET') return send(405, '{"error":"read only"}');
    if (u.pathname === '/' || u.pathname === '/index.html') return send(200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
    if (u.pathname === '/logo.png') { try { return send(200, fs.readFileSync(LOGO), 'image/png'); } catch { return send(404, ''); } }
    if (u.pathname === '/api/desk') return send(200, JSON.stringify(desk()));
    if (u.pathname === '/api/candles') return send(200, JSON.stringify(await candles(u.searchParams.get('chain'), u.searchParams.get('pool'), fetcher)));
    send(404, '{"error":"not found"}');
  });
}
if (process.argv[1] && process.argv[1].endsWith(path.join('bot', 'dash.mjs'))) {
  const pass = (process.env.DASH_PASS || (process.env.DASH_PASS_B64 ? Buffer.from(process.env.DASH_PASS_B64, 'base64').toString('utf8') : '')).trim(), port = Number(process.env.DASH_PORT) || 8080;
  if (pass.length < 8) { console.error('RynoBot desk: no desk password yet. Run bash bot/install.sh again to choose one.'); process.exit(1); }
  server(pass).listen(port, () => console.log(`RynoBot desk on port ${port} (read only)`));
}
