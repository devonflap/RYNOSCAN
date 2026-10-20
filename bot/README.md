# RynoBot (dry run)

Two always-on bots that do what a trading bot would do, except place orders. Each runs as its own service with its own $1,000 paper account:

- **rules** (`rynobot@rules`): the scanner's bid-ready and worth-watching setups, bought on the 5-minute trigger (below).
- **breakout** (`rynobot@breakout`): Breakout retest, see **The Breakout bot** further down.

Every minute the rules bot:

1. **Reads the scanner's setups** from the dashboard data: bid-ready and worth-watching coins scored over 65, with $100k+ liquidity and no rug danger, each with a buy zone and an invalidation level. These are exactly the setups the paper **Bot rules** book takes, and each coin gets one setup per 24 hours (so a stopped-out coin is never bought straight back).
2. **Watches the ones near their zone on 5-minute candles** and waits for the trigger: a flush below the zone that closes back above it, or a bounce in the zone, on at least 1.5x (flush) or 2x (bounce) normal volume, closing in the upper half of its candle and no more than 3% above the zone (no chasing).
3. **Logs the exact order it would place**: size, limit price, stop, TP1, the ride-free level (server log and `bot/journal.jsonl`; not your phone, see below).
4. **Manages that paper position** and logs every would-be sale:
   - stop under the flush low (at least 5%, at most 20% away)
   - out early if sellers take over while 8%+ under the entry, if volume dies (last 6 hours under 20% of the 24-hour pace), or if it hasn't reached +1R after 6 hours
   - a third at +1R, stop to break-even, then a 25% trail
   - **ride free at 2x**: sells just enough to get the whole stake back, so the rest cannot lose money
   - the rest rides until a 5-minute candle closes 50% under its best close, or 72 hours

Sizing: 1% of the paper account at risk per trade, at most 25% of the account in one coin, 2% of the pool's liquidity, 4% total open risk, 4 positions at once, and no new entries after a 3% losing day.

**Nothing is ever bought or sold.** There is no wallet, no private key and no trading code here. `"mode"` must be `"dry"`; anything else makes the bot refuse to start. Live trading gets built only after 2 to 4 weeks of dry-run results that are worth trusting, with its own wallet and keys kept only on the server.

The same trigger and exits are also replayed on the dashboard's **Bot rules** tab (5-minute entries, 15-minute exits), next to a plain zone limit and the study exits on the same setups, so the bot's rules are always measured against the alternatives.

## The Breakout bot

Breakout retest exactly as the backtest traded it, because that is what the +0.93R record measured:

- **Setups:** every Breakout retest the scanner sees with a valid plan (score 50+, $100k+ liquidity, no rug danger, not already through its stop), bid-ready or not, from `breakouts.json`. One per coin per 24 hours.
- **Filters (the bot tuner):** it starts with one, reward to risk to TP2 of 3R or more (the biggest and most sensible hint: 24 of the 37 trades, +1.41R against -0.10R for 2-3R). Stops up to 35% are allowed (the widest stops did best; the rules bot's 20% cap would have blocked them). Every other hint from the pattern analyst is tested on new trades and switches on by itself once it clearly holds there (10+ trades kept, 8+ removed, 0.3R+ better, and a luck check); a filter that new trades clearly contradict switches off. You get one phone note when that happens. The tuner never changes sizing, stops or targets.
- **Entry:** a limit order at the top of the retest zone, 48 hours to fill; cancelled if the price falls through the stop first.
- **Exits:** the pattern plan's stop; a third at TP1 and the stop to break-even; a third at TP2; the rest at TP3; out after 7 days.
- **Sizing:** the same as the rules bot: 1% of its paper account lost at the stop (slippage included), 4 positions, 4% total risk, no new buys after a 3% losing day.
- **Its paper twin** is the dashboard's **Breakout → Bot filters** book, and its reality check compares against that.

## What reaches your phone

Only what needs you. The bot trades; you don't, so would-be buys and sells stay on the server (`node bot/run.mjs --status` shows them).

- **"RynoBot started (dry run)"** when it starts or restarts.
- **A problem**, once it has lasted long enough to matter, and a note when it clears by itself:
  - can't get prices for 15 minutes with a position open (30 minutes otherwise)
  - can't get 5-minute candles for 30 minutes (no new entries can trigger)
  - can't read the scanner's setups for 30 minutes
  - 5 checks in a row failed (a bug or a full disk: send me `journalctl -u rynobot@rules -n 50`, or `@breakout`)
- **"RynoBot Breakout: filters changed"** when the tuner switches a filter on or off (rare: it needs new trades on both sides).
- **"RynoBot has gone quiet"**: the bot posts a heartbeat every 30 minutes to a silent second topic (`<your topic>-hb`, which your phone doesn't subscribe to). The GitHub watchdog checks it every 30 minutes and tells you once if it stops for 90 minutes (overnight it waits until 6am), and once when it's back.
- **The reality check**, every 2 weeks.

To get the would-be trades on your phone again, set `"tradeAlerts": true` in `bot/config.json`; `"dailySummary": true` brings back the 8pm summary.

## Reality check (every 2 weeks, automatic)

The dashboard's **Bot rules** book replays the same rules on candles. A candle replay sees every high and low, so a target touched for ten seconds counts as sold; the bot only sees the price once a minute, the way you would. Every 14 days the bot compares the two on the coins both took and sends you the result:

- how each side did on the same trades, and the gap between them (with a 90% range)
- where the gap comes from: worse entries, or targets the paper booked that the bot never reached
- every paper trade the bot missed, and why (offline, all slots full, price ran first, the trigger didn't fire, never saw the setup)
- what to do with it: the amount to knock off every paper book's average before trusting it (once there are 10 or more shared trades)

The first one arrives 14 days after each bot starts. To see it any time: `node bot/run.mjs --reality` (add `--bot breakout` for that bot, which is compared with the **Breakout → Bot filters** paper book). Each result is also kept in `bot/reality.json` / `bot/reality-breakout.json`. Change the timing with `"realityEveryDays"` in `bot/config.json`.

## Where to run it

It needs a computer that never sleeps. A small cloud server is the right home: about US$6 a month (DigitalOcean's 1 GB droplet), or free on Oracle Cloud's Always Free tier (an ARM server; sign-up needs a card and the free capacity is sometimes hard to get). Pick a region near Asia or the US; latency barely matters at one check a minute.

The scanner itself stays on GitHub (free, and it runs the dashboard). The bot only reads the dashboard's public data, so the server needs no GitHub login.

## Setup (about 10 minutes)

1. Create an **Ubuntu 24.04** server (the smallest size is plenty) and open its console or SSH into it.
2. Run:
   ```
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/devonflap/RYNOSCAN.git
   cd RYNOSCAN
   bash bot/install.sh
   ```
3. It asks for your **ntfy topic** (the same one as the `NTFY_TOPIC` secret on GitHub). It is stored in `/etc/rynobot.env`, readable only by the server's admin.
4. You get "RynoBot started (dry run)" on your phone. From then on it stays quiet unless something breaks, plus the reality check every 2 weeks (see **What reaches your phone**).

## Everyday commands (on the server, inside the RYNOSCAN folder)

Add `--bot breakout` to any `node bot/run.mjs` command for the Breakout bot (without it you get the rules bot).

| what | command |
|---|---|
| watch both bots work | `sudo journalctl -u 'rynobot@*' -f` |
| how a bot is doing: account, filters, open positions, last 10 trades | `node bot/run.mjs --bot breakout --status` |
| stop new entries, every bot (open positions still managed) | `touch bot/STOP` (delete it to allow them again) |
| stop new entries, one bot | `touch bot/STOP-breakout` or `touch bot/STOP-rules` |
| change settings | `nano bot/config.json` then `sudo systemctl restart 'rynobot@*'` |
| update to the latest RynoScan | `git pull && sudo systemctl restart 'rynobot@*'` |
| check the data feeds | `node bot/run.mjs --check` |
| see the reality check now | `node bot/run.mjs --bot breakout --reality` |
| stop one bot completely | `sudo systemctl stop rynobot@breakout` |

Every decision is written to `bot/journal.jsonl` (rules) or `bot/journal-breakout.jsonl`, and the paper accounts live in `bot/state.json` and `bot/state-breakout.json`.

## Settings (`bot/config.json`)

`accountUsd` paper account size · `riskPct` % of the account risked per trade · `maxOpen` positions at once · `maxOpenRiskPct` total open risk · `dailyLossPct` no new entries after this losing day · `minOpp` lowest scanner score to watch · `signals` `["bid", "watch"]` or just `["bid"]` · `pollSec` seconds between checks · `tradeAlerts` would-be trades to the phone (default false) · `dailySummary` the 8pm summary (default false) · `summaryHourBrisbane` its time · `realityEveryDays` days between reality checks (14).

These apply to both bots. To change one bot only, put it under `"bots"`, for example `"bots": { "breakout": { "autoTune": false } }` keeps the Breakout bot on its starting filter. Breakout-only settings: `autoTune` (let the tuner switch filters, default true) · `maxStopPct` (35) · `minOpp` (50) · `maxHoldH` (168).
