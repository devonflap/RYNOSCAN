// The bot desk: a web dashboard for the bots, served from the bot server.
//   node bot/dash.mjs        (systemd runs it as rynobot-dash, as its own user; see bot/README.md and bot/SECURITY.md)
// Open https://<your desk address> and sign in with the desk password chosen at install (any user name).
// Security posture: the password gate protects the VIEW. The desk process runs as a separate user with no access to the bot keys,
// the ntfy topic or the GitHub token (its environment file holds only the desk passwords). Nothing secret is ever in the page or a URL.
// Controls (close a position, write a scam off, cancel a watched setup, pause or resume a bot): on a PAPER bot (dry run, config mode dry)
// they need only the desk password and a confirm click (26 Oct, Ryan: the control password can take effect once we go live). On a bot in
// rehearsal or live they are OFF unless a second, separate control password is set; each such control needs that password in a header
// plus a confirm click, and DASH_CONTROLS=local limits them to the server itself
// (an SSH tunnel). Wrong passwords slow down per address and are logged as "desk: wrong password from <ip>" for fail2ban.
// Charts come from DexScreener's embedded chart (fast, in the browser) or the server's cached GeckoTerminal candles (12 a minute).
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

export function desk(now = Date.now(), wallets = {}) {
  const bots = Object.keys(BOTS).map((name) => { const F = filesFor(name), cfg = loadConfig(name); const d = deskSummary(name, { st: rd(F.state, null), cfg, journal: tail(F.journal), reality: rd(F.reality, null), stopFile: fs.existsSync(F.stop) || fs.existsSync(F.stopAll), now }); d.paused = fs.existsSync(F.stop); d.pausedAll = fs.existsSync(F.stopAll); d.wallet = walletInfo(cfg, wallets[name]); d.live = cfg.mode !== 'dry'; return d; });
  const on = bots.filter((b) => b.installed), start = on.reduce((a, b) => a + b.account.start, 0), eq = on.reduce((a, b) => a + b.account.equity, 0), kitty = on.reduce((a, b) => a + (b.account.kitty || 0), 0), total = eq + kitty;
  return { at: new Date(now).toISOString().slice(0, 19) + 'Z', mode: 'dry run', combined: { start, equity: +eq.toFixed(2), kitty: +kitty.toFixed(2), total: +total.toFixed(2), pnl: +(total - start).toFixed(2), pnlPct: start ? +((total / start - 1) * 100).toFixed(2) : null }, bots };
}

// wallets: one public address per bot in bot/config.json ("bots": { "rules": { "wallet": "...", "walletChain": "solana" } }). Read only.
function walletInfo(cfg, bal) { if (!cfg.wallet) return { set: false, chain: cfg.walletChain || null }; return { set: true, chain: cfg.walletChain || 'solana', address: cfg.wallet, short: cfg.wallet.slice(0, 4) + '…' + cfg.wallet.slice(-4), ...(bal || {}) }; }
const RPC = { solana: 'https://api.mainnet-beta.solana.com', robinhood: 'https://rpc.mainnet.chain.robinhood.com', bsc: 'https://bsc-dataseed.binance.org', base: 'https://mainnet.base.org', ethereum: 'https://eth.llamarpc.com' };
const balCache = new Map();
export async function balance(chain, address, fetcher = fetch, now = Date.now()) {
  const k = chain + ':' + address, hit = balCache.get(k); if (hit && now - hit.at < 60e3) return hit.v; const url = RPC[chain]; if (!url || !address) return { error: 'unknown chain' };
  try { const sol = chain === 'solana', body = sol ? { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] } : { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] };
    const r = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }), j = await r.json();
    const v = sol ? { native: +(j.result.value / 1e9).toFixed(4), unit: 'SOL' } : { native: +(parseInt(j.result, 16) / 1e18).toFixed(5), unit: chain === 'bsc' ? 'BNB' : 'ETH' }; v.at = new Date(now).toISOString().slice(0, 19) + 'Z'; balCache.set(k, { at: now, v }); return v;
  } catch (e) { return hit ? hit.v : { error: 'balance unavailable (' + e.message + ')' }; }
}
// commands from the desk: appended to bot/cmd-<name>.jsonl for the bot to act on at its next check; pause/resume are the STOP files
// is this bot paper only right now? (its state's execMode and its config's mode both dry)
export function isPaper(name) { try { const cfg = loadConfig(name), st = JSON.parse(fs.readFileSync(filesFor(name).state, 'utf8')); return (st.execMode || 'dry') === 'dry' && (cfg.mode || 'dry') === 'dry'; } catch { return (loadConfig(name).mode || 'dry') === 'dry'; } }
export function command(name, type, pool) {
  if (!BOTS[name]) return { error: 'unknown bot' }; const F = filesFor(name), at = new Date().toISOString().slice(0, 19) + 'Z';
  if (type === 'pause') { fs.writeFileSync(F.stop, at, { mode: 0o664 }); return { ok: true, did: 'paused new entries' }; }
  if (type === 'resume') { try { fs.unlinkSync(F.stop); } catch { /* already */ } return { ok: true, did: 'resumed new entries' }; }
  if ((type === 'close' || type === 'cancel' || type === 'writeoff') && /^[A-Za-z0-9]{20,90}$/.test(String(pool || ''))) { const id = crypto.randomBytes(6).toString('hex'); fs.appendFileSync(F.cmd, JSON.stringify({ id, type, pool, at }) + '\n', { mode: 0o664 }); /* group-writable: the desk runs as its own user, the bot truncates the file */ return { ok: true, did: type === 'close' ? 'close sent: the bot sells at its next check (within a minute)' : type === 'writeoff' ? 'write-off sent: the bot books it at zero at its next check' : 'cancel sent: the bot drops it at its next check' }; }
  return { error: 'unknown command' };
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
const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
export function authorised(req, pass) {
  const h = String(req.headers.authorization || ''); if (!h.startsWith('Basic ')) return false;
  const got = Buffer.from(h.slice(6), 'base64').toString('utf8'); return same(got.slice(got.indexOf(':') + 1), pass);
}
const LOOPBACK = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
// controlPass: a second password for the controls (none = the desk is read only). controls 'local' = controls only from the server itself.
// trustProxy: behind Caddy or Nginx on the same machine, the real address is in X-Forwarded-For (used for the slowdown and the log line).
export function server(pass, { fetcher = fetch, controlPass = '', controls = 'on', trustProxy = false, log = console.log } = {}) {
  const mode = !controlPass || controlPass.length < 8 ? 'off' : controls === 'local' ? 'local' : 'on';
  return http.createServer(async (req, res) => {
    const sock = req.socket.remoteAddress || '?', ip = trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : sock, f = fails.get(ip) || { n: 0, at: 0 };
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://dexscreener.com; base-uri 'none'; form-action 'none'" }); res.end(body); };
    const wrong = () => { fails.set(ip, { n: f.n + 1, at: Date.now() }); log(`desk: wrong password from ${ip}`); };
    if (f.n >= 10 && Date.now() - f.at < 10 * 60e3) return send(429, JSON.stringify({ error: 'too many wrong passwords, wait 10 minutes' }));
    if (!authorised(req, pass)) { if (req.headers.authorization) wrong(); res.writeHead(401, { 'www-authenticate': 'Basic realm="RynoBot desk", charset="UTF-8"', 'content-type': 'text/plain' }); return res.end('Password needed (any user name).'); }
    fails.delete(ip);
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/api/cmd') { let body = ''; req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); }); await new Promise((r) => req.on('end', r));
      let j0 = null; try { j0 = JSON.parse(body || '{}'); } catch { return send(400, '{"error":"bad request"}'); } const paper = j0 && j0.bot && BOTS[j0.bot] ? isPaper(j0.bot) : false;
      if (!paper) { /* rehearsal or live: the control password, and the local-only rule, stand */
        if (mode === 'off') return send(403, '{"error":"controls on a live or rehearsal bot are off: set a control password on the server to turn them on"}');
        if (mode === 'local' && !LOOPBACK.test(sock)) return send(403, '{"error":"controls only work from the server itself (SSH tunnel)"}');
        const given = String(req.headers['x-control'] || ''); if (!given || !same(given, controlPass)) { if (given) wrong(); return send(403, '{"error":"control password wrong or missing"}'); } }
      try { const j = j0; if (String(req.headers['x-desk'] || '') !== '1') return send(403, '{"error":"refused"}'); const r = command(j.bot, j.type, j.pool); if (r.ok) log(`desk: ${j.type} ${j.bot} ${j.pool || ''} by ${ip}`); return send(r.error ? 400 : 200, JSON.stringify(r)); } catch { return send(400, '{"error":"bad request"}'); } }
    if (req.method !== 'GET') return send(405, '{"error":"not allowed"}');
    if (u.pathname === '/' || u.pathname === '/index.html') return send(200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
    if (u.pathname === '/logo.png') { try { return send(200, fs.readFileSync(LOGO), 'image/png'); } catch { return send(404, ''); } }
    if (u.pathname === '/api/desk') { const w = {}; for (const name of Object.keys(BOTS)) { const cfg = loadConfig(name); if (cfg.wallet) w[name] = await balance(cfg.walletChain || 'solana', cfg.wallet, fetcher); } const d = desk(Date.now(), w); d.controls = mode; d.tls = !!(req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted); return send(200, JSON.stringify(d)); }
    if (u.pathname === '/api/candles') return send(200, JSON.stringify(await candles(u.searchParams.get('chain'), u.searchParams.get('pool'), fetcher)));
    send(404, '{"error":"not found"}');
  });
}
const b64 = (k) => (process.env[k] ? Buffer.from(process.env[k], 'base64').toString('utf8') : '').trim();
if (process.argv[1] && process.argv[1].endsWith(path.join('bot', 'dash.mjs'))) {
  const pass = (process.env.DASH_PASS || b64('DASH_PASS_B64')).trim(), controlPass = b64('DASH_CONTROL_B64'), port = Number(process.env.DASH_PORT) || 8080, bind = process.env.DASH_BIND || '0.0.0.0';
  if (pass.length < 8) { console.error('RynoBot desk: no desk password yet. Run bash bot/install.sh again to choose one.'); process.exit(1); }
  for (const k of ['NTFY_TOPIC', 'GITHUB_TOKEN', 'ZEROX_API_KEY', 'ONEINCH_API_KEY', 'UNISWAP_API_KEY']) if (process.env[k]) console.log(`desk: ${k} is in this process's environment; it does not need it. Use /etc/rynobot-desk.env for the desk (bash bot/install.sh does this).`);
  const controls = process.env.DASH_CONTROLS === 'local' ? 'local' : 'on', trustProxy = process.env.DASH_TRUST_PROXY === '1';
  server(pass, { controlPass, controls, trustProxy }).listen(port, bind, () => console.log(`RynoBot desk on ${bind}:${port}; controls ${controlPass.length >= 8 ? controls : 'off (read only)'}${trustProxy ? '; behind a proxy' : ''}`));
}
