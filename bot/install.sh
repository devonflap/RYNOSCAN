#!/usr/bin/env bash
# Sets up RynoBot on an Ubuntu or Debian server so it runs 24/7 and restarts itself after a crash or a reboot.
# Run it from inside the RYNOSCAN folder:   bash bot/install.sh            (run it again after a git pull: it is safe to repeat)
#   bash bot/install.sh --https desk.yourdomain.com     also puts the desk behind HTTPS (Caddy + Let's Encrypt) and fail2ban
#   bash bot/install.sh --passwords                     choose new desk and control passwords (the old ones are forgotten)
# What it sets up, and why (see bot/SECURITY.md):
#   - three bot services (rules, breakout, degen) running as you, with the secrets file /etc/rynobot.env (root only)
#   - the desk as its OWN user "rynodesk" with its own environment file holding only the desk passwords: it cannot read the bot keys,
#     the ntfy topic or the GitHub token even if the page were ever broken into
#   - a desk password (the view) and an optional, separate control password (close/cancel/pause); no control password = read only
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN=""; if [ "${1:-}" = "--passwords" ]; then sudo sed -i '/^DASH_PASS_B64=/d; /^DASH_CONTROL_B64=/d' /etc/rynobot-desk.env 2>/dev/null || true; echo "Desk and control passwords cleared; choose new ones below."; fi
if [ "${1:-}" = "--https" ]; then DOMAIN="${2:-}"; [ -n "$DOMAIN" ] || { echo "usage: bash bot/install.sh --https desk.yourdomain.com"; exit 1; }; fi
need_node=1
if command -v node >/dev/null 2>&1; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || echo "(wallet libraries not installed: the bots run in dry run; rehearsal and live need them: run npm install later)"
RUN_AS="${USER:-$(id -un)}"; GROUP="$(id -gn "$RUN_AS")"
# the bot keys folder: yours only. The desk user can never read it.
sudo mkdir -p /etc/rynobot/keys && sudo chown -R "$RUN_AS:$GROUP" /etc/rynobot && sudo chmod 700 /etc/rynobot /etc/rynobot/keys
[ -f bot/config.json ] || cp bot/config.example.json bot/config.json
grep -q '"accountUsd": 1000,' bot/config.json && sed -i 's/"accountUsd": 1000,/"accountUsd": 10000,/' bot/config.json && echo "Paper accounts set to \$10,000 in bot/config.json (was the old \$1,000 default)."
if [ ! -f /etc/rynobot.env ]; then
  read -rp "Your ntfy topic (the same one as the NTFY_TOPIC secret on GitHub): " TOPIC
  echo "NTFY_TOPIC=$TOPIC" | sudo tee /etc/rynobot.env >/dev/null
fi
sudo chmod 600 /etc/rynobot.env; sudo chown root:root /etc/rynobot.env
# the desk's own user and environment file (desk passwords only; never the bot secrets)
id -u rynodesk >/dev/null 2>&1 || sudo useradd -r -s /usr/sbin/nologin -d /nonexistent rynodesk
# the desk user may enter the folders down to this repo (traverse only), read the repo, and read/write bot/ (ACLs, so no group membership
# is handed out: on a droplet run as root that would otherwise put the desk in the root group)
command -v setfacl >/dev/null 2>&1 || sudo apt-get install -y acl >/dev/null 2>&1
d="$PWD"; while [ "$d" != "/" ]; do sudo setfacl -m u:rynodesk:x "$d"; d="$(dirname "$d")"; done
sudo setfacl -m u:rynodesk:rx "$PWD" "$PWD/docs"; sudo setfacl -m u:rynodesk:r "$PWD/docs/logo.png" 2>/dev/null || true
sudo setfacl -R -m u:rynodesk:rwX bot && sudo setfacl -R -d -m u:rynodesk:rwX bot   # existing files, and every file the bots write later
sudo chmod g+s bot; sudo chown "$RUN_AS:$GROUP" bot   # files the desk creates (commands, STOP) take the bot's group so the bot can write them
[ -f /etc/rynobot-desk.env ] || sudo touch /etc/rynobot-desk.env
sudo chown root:rynodesk /etc/rynobot-desk.env; sudo chmod 640 /etc/rynobot-desk.env
if sudo grep -q '^DASH_PASS_B64=' /etc/rynobot.env; then   # older install: move the desk password out of the bot secrets
  sudo grep '^DASH_PASS_B64=' /etc/rynobot.env | sudo tee -a /etc/rynobot-desk.env >/dev/null; sudo sed -i '/^DASH_PASS_B64=/d' /etc/rynobot.env
fi
if ! sudo grep -q '^DASH_PASS_B64=' /etc/rynobot-desk.env; then
  echo
  echo "The bot desk is a web page on this server showing the bots. Choose a long password only you know (12+ characters, not used anywhere else)."
  while :; do read -rsp "Desk password: " DP; echo; [ ${#DP} -ge 12 ] && break; echo "Too short, try again (12+ characters)."; done
  echo "DASH_PASS_B64=$(printf '%s' "$DP" | base64 -w0)" | sudo tee -a /etc/rynobot-desk.env >/dev/null   # stored encoded so any character works
fi
if ! sudo grep -q '^DASH_CONTROL_B64=' /etc/rynobot-desk.env; then
  echo
  echo "Controls on the desk (close a paper position, cancel a setup, pause a bot) need a SECOND password. Leave it blank to keep the desk read only."
  read -rsp "Control password (12+ characters, or blank for read only): " CP; echo
  if [ -n "$CP" ] && [ ${#CP} -ge 12 ]; then echo "DASH_CONTROL_B64=$(printf '%s' "$CP" | base64 -w0)" | sudo tee -a /etc/rynobot-desk.env >/dev/null; else echo "Desk stays read only (run the installer again to add a control password)."; fi
fi
BOTS="runner breakout range ignition"
# retired bots (rules, degen): stop their services and tell the GitHub watchdog so it does not report them as gone quiet
TOPIC_HB="$(sudo grep '^NTFY_TOPIC=' /etc/rynobot.env 2>/dev/null | cut -d= -f2-)"
for old in rules degen; do if systemctl list-unit-files "rynobot@$old.service" >/dev/null 2>&1 && systemctl is-enabled "rynobot@$old" >/dev/null 2>&1; then sudo systemctl disable --now "rynobot@$old" >/dev/null 2>&1 || true; echo "Retired the $old bot (its files are kept: bot/state-$old.json, bot/journal-$old.jsonl)."; [ -n "$TOPIC_HB" ] && curl -fsS -o /dev/null -X POST -H "Priority: min" -d "quiet-alerted:$old retired" "https://ntfy.sh/${TOPIC_HB}-hb" || true; fi; done
sed "s#__DIR__#$PWD#; s#__USER__#$RUN_AS#" "bot/rynobot@.service" | sudo tee "/etc/systemd/system/rynobot@.service" >/dev/null
sudo systemctl disable --now rynobot 2>/dev/null || true   # an older single-bot install, if there is one
sudo systemctl daemon-reload
for b in $BOTS; do sudo systemctl enable "rynobot@$b" >/dev/null 2>&1; sudo systemctl restart "rynobot@$b"; done   # restart picks up new code after a git pull
sed "s#__DIR__#$PWD#" bot/rynobot-dash.service | sudo tee /etc/systemd/system/rynobot-dash.service >/dev/null
if [ -n "$DOMAIN" ]; then
  # HTTPS: Caddy answers on 80/443 with a Let's Encrypt certificate and passes to the desk, which now listens on this machine only
  command -v caddy >/dev/null 2>&1 || { sudo apt-get update -qq; sudo apt-get install -y caddy fail2ban; }
  command -v fail2ban-client >/dev/null 2>&1 || sudo apt-get install -y fail2ban
  sed "s#__DOMAIN__#$DOMAIN#" bot/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
  sudo sed -i '/^DASH_BIND=/d; /^DASH_TRUST_PROXY=/d' /etc/rynobot-desk.env
  printf 'DASH_BIND=127.0.0.1\nDASH_TRUST_PROXY=1\n' | sudo tee -a /etc/rynobot-desk.env >/dev/null
  sudo systemctl enable caddy >/dev/null 2>&1; sudo systemctl restart caddy
  if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then sudo ufw allow 80/tcp >/dev/null; sudo ufw allow 443/tcp >/dev/null; sudo ufw delete allow 8080/tcp >/dev/null 2>&1 || true; fi
else
  if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then sudo ufw allow 8080/tcp >/dev/null; fi
fi
if command -v fail2ban-client >/dev/null 2>&1; then
  sudo cp bot/fail2ban/rynobot-desk.filter.conf /etc/fail2ban/filter.d/rynobot-desk.conf; sudo cp bot/fail2ban/rynobot-desk.jail.conf /etc/fail2ban/jail.d/rynobot-desk.conf
  sudo systemctl enable fail2ban >/dev/null 2>&1; sudo systemctl restart fail2ban
fi
sudo systemctl daemon-reload; sudo systemctl enable rynobot-dash >/dev/null 2>&1; sudo systemctl restart rynobot-dash
sleep 2; if ! systemctl is-active --quiet rynobot-dash; then echo; echo "THE DESK DID NOT START. Its last log lines:"; sudo journalctl -u rynobot-dash -n 20 --no-pager; echo; fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
sleep 2
for b in $BOTS; do node bot/run.mjs --bot "$b" --check || true; done   # checks the data feeds; the ntfy topic is only readable by the services
echo
echo "RynoBot is running in DRY-RUN mode: four bots (runner, breakout, range, ignition), each with a \$10,000 paper account."
echo
if [ -n "$DOMAIN" ]; then echo "  BOT DESK: open  https://$DOMAIN  (the certificate takes a minute the first time). Any user name, and the desk password."
else echo "  BOT DESK: open  http://$IP:8080  on your computer. Any user name, and the desk password. Before sharing the address or going live:  bash bot/install.sh --https desk.yourdomain.com"; fi
echo
echo "  live log:            sudo journalctl -u 'rynobot@*' -f          desk log: sudo journalctl -u rynobot-dash -f"
echo "  how a bot is doing:  node bot/run.mjs --bot breakout --status     (or --bot runner, --bot range, --bot ignition)"
echo "  stop new entries:    touch bot/STOP   (all bots)   or   touch bot/STOP-breakout   (one bot); delete the file to allow them again"
echo "  update:              git pull && bash bot/install.sh"
