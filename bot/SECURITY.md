# RynoBot security: how the desk, the bots and the keys are kept apart

Short version: the desk password protects the **view**, not the bot. The bot and its keys live in their own processes and files that
the desk cannot read. Nothing secret is ever in the page, a URL or the desk's environment. While paper trading the downside of a
leak is small; once real funds are on a wallet, treat the desk address as semi-public and follow every line below.

## What runs as what

| Process | User | Can read | Cannot read |
|---|---|---|---|
| `rynobot@rules`, `rynobot@breakout`, `rynobot@degen` | you | `/etc/rynobot.env` (ntfy topic, GitHub token, API keys), `/etc/rynobot/keys/<bot>.json` | the desk passwords |
| `rynobot-dash` (the desk) | `rynodesk` (no login shell, no home) | `bot/state-*.json`, `bot/journal-*.jsonl`, `bot/config.json` (public addresses only), `/etc/rynobot-desk.env` (desk passwords only) | `/etc/rynobot`, `/etc/rynobot.env`: blocked by file permissions **and** by systemd `InaccessiblePaths` |

The desk writes only two kinds of file, both in `bot/`: `cmd-<bot>.jsonl` (a queued close or cancel) and `STOP-<bot>` (pause). The bot
reads them at its next check and decides for itself. The desk never signs anything and never calls a wallet library.

`bash bot/install.sh` sets all of this up (the `rynodesk` user, the two environment files, the permissions) and is safe to run again.

## HTTPS only

Before sharing the address with anyone, or going live:

    bash bot/install.sh --https desk.yourdomain.com

That installs Caddy with a free Let's Encrypt certificate (renewed on its own), moves the desk to listen on the server itself only
(`DASH_BIND=127.0.0.1`), closes port 8080 on the firewall and opens 80/443. The domain's A record must point at the droplet first
(any cheap domain works; a subdomain of one you own is fine). Without HTTPS the password crosses the network in the clear on every
refresh, so do not use the desk on public Wi-Fi until this is done.

## Auth, not obscurity

- Desk password: 12+ characters, unique, in a password manager. Any user name. It is checked in constant time.
- Control password (optional, separate): needed for close / cancel / pause / resume. Without it the desk is read only, which is the
  right setting for most of the time. The page asks for it once per browser tab and keeps it in session storage only (gone when the
  tab closes); it travels in a request header, never a URL.
- `DASH_CONTROLS=local` in `/etc/rynobot-desk.env` makes the controls work only from the server itself. Use an SSH tunnel for that:
  `ssh -L 8080:127.0.0.1:8080 you@server`, then open `http://localhost:8080`. The public address stays view-only.
- A secret link is not auth; the desk does not have one.

## Brute force

Two layers: the desk itself slows down after 10 wrong passwords from one address (10 minutes), and fail2ban (installed by
`--https`) bans an address for an hour after 5 wrong passwords in 10 minutes, reading the desk's own log line
`desk: wrong password from <ip>` from the journal. Behind Caddy the real address is used (`DASH_TRUST_PROXY=1`), so the ban lands
on the visitor, not on the proxy.

    sudo fail2ban-client status rynobot-desk      # who is banned
    sudo journalctl -u rynobot-dash -f            # the desk's log, including every control used and by which address

## No secrets in the page or URLs

The API returns bot state, trades and public wallet addresses. It never returns the ntfy topic, the GitHub token, API keys, a
private key or either password; `npm test` checks this on every run. Pages and API answers are `Cache-Control: no-store`. The
page's content security policy allows nothing from outside except the embedded DexScreener chart.

## The keys

- One wallet per bot, made on the server with `node bot/wallet.mjs create --bot <name> [--chain robinhood]`; the key file is
  `/etc/rynobot/keys/<bot>.json`, owner read only, in a folder only your user can enter.
- Fund each wallet with no more than that bot may lose. Phantom keeps your main money; the bots get working floats.
- `node bot/wallet.mjs export --bot <name>` prints the key once for a one-time import into Phantom (Solana or Ethereum-style for
  Robinhood chain). Clear the screen and the shell history afterwards: `history -c`.
- Never paste a key into a chat, a GitHub file, this page or a support ticket. If a key is ever exposed anywhere, move the funds to
  a new wallet (`create` refuses to overwrite: rename the old file first) and update the address in `bot/config.json`.
- Live trading additionally needs `mode: "live"` for that bot in `bot/config.json`, the arming file `bot/ARMED-<bot>` containing the
  exact arming sentence, and the per-trade and open caps. The desk cannot create any of these.

## Checklist before real money

1. `bash bot/install.sh --https <domain>` done; `https://` in the address bar; port 8080 closed.
2. Desk password and control password both 12+ characters and unique; or controls set to local only.
3. `sudo systemctl show rynobot-dash -p User` says `rynodesk`; `sudo -u rynodesk cat /etc/rynobot.env` is refused.
4. fail2ban running: `sudo fail2ban-client status rynobot-desk`.
5. SSH: key-based login only, `PasswordAuthentication no` in `/etc/ssh/sshd_config`, and `ufw` on (22, 80, 443 only).
6. The droplet's automatic security updates on: `sudo apt-get install unattended-upgrades`.
7. Wallets funded with a working float only; the arming sentence written by you, by hand, per bot.
