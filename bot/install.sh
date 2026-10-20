#!/usr/bin/env bash
# Sets up RynoBot (dry run) on an Ubuntu or Debian server so it runs 24/7 and restarts itself after a crash or a reboot.
# Run it from inside the RYNOSCAN folder:   bash bot/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
need_node=1
if command -v node >/dev/null 2>&1; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
[ -f bot/config.json ] || cp bot/config.example.json bot/config.json
if [ ! -f /etc/rynobot.env ]; then
  read -rp "Your ntfy topic (the same one as the NTFY_TOPIC secret on GitHub): " TOPIC
  echo "NTFY_TOPIC=$TOPIC" | sudo tee /etc/rynobot.env >/dev/null
  sudo chmod 600 /etc/rynobot.env
fi
if ! sudo grep -q '^DASH_PASS_B64=' /etc/rynobot.env; then
  echo
  echo "The bot desk is a web page on this server showing both bots (read only)."
  while :; do read -rsp "Choose a password for the bot desk (8+ characters): " DP; echo; [ ${#DP} -ge 8 ] && break; echo "Too short, try again."; done
  echo "DASH_PASS_B64=$(printf '%s' "$DP" | base64 -w0)" | sudo tee -a /etc/rynobot.env >/dev/null   # stored encoded so any character works
fi
RUN_AS="${USER:-$(id -un)}"
BOTS="rules breakout"
sed "s#__DIR__#$PWD#; s#__USER__#$RUN_AS#" "bot/rynobot@.service" | sudo tee "/etc/systemd/system/rynobot@.service" >/dev/null
sudo systemctl disable --now rynobot 2>/dev/null || true   # an older single-bot install, if there is one
sudo systemctl daemon-reload
for b in $BOTS; do sudo systemctl enable "rynobot@$b" >/dev/null 2>&1; sudo systemctl restart "rynobot@$b"; done   # restart picks up new code after a git pull
sed "s#__DIR__#$PWD#; s#__USER__#$RUN_AS#" bot/rynobot-dash.service | sudo tee /etc/systemd/system/rynobot-dash.service >/dev/null
sudo systemctl daemon-reload; sudo systemctl enable rynobot-dash >/dev/null 2>&1; sudo systemctl restart rynobot-dash
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then sudo ufw allow 8080/tcp >/dev/null; fi
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
sleep 2
for b in $BOTS; do node bot/run.mjs --bot "$b" --check || true; done   # checks the data feeds; the ntfy topic is only readable by the services
echo
echo "RynoBot is running in DRY-RUN mode: two bots (rules, breakout), each with a \$10,000 paper account. You should get a 'started' message from each on your phone."
echo
echo "  BOT DESK: open  http://$IP:8080  on your computer. Any user name, and the desk password you chose."
echo
echo "  live log:            sudo journalctl -u 'rynobot@*' -f"
echo "  how a bot is doing:  node bot/run.mjs --bot breakout --status     (or --bot rules)"
echo "  stop new entries:    touch bot/STOP   (all bots)   or   touch bot/STOP-breakout   (one bot); delete the file to allow them again"
echo "  update:              git pull && sudo systemctl restart 'rynobot*'"
