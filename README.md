# RynoScan

Your 4-hour-chart meme coin scanner for Solana, Robinhood Chain and Ethereum, running on its own (no Claude needed).
It scans every hour, around the clock (24 scans a day), updates a web dashboard, and can buzz your phone when something new shows up.

Everything is free except the data key (optional, see step 3).

## What you get
- A dashboard web page (blue theme, rhino logo) with: Check a coin, on-chain volume gauge with the "trade none or minimum" tip, bid-ready charts with entry zone / stop / TP1-3, worth-watching list, chart patterns and bottomed-out coins, signal log with results in R, and exit rules.
- Phone alerts (optional) for: a new bid-ready coin, a strong new watch (opportunity 75+), or a take-profit/stop being hit.

## Setup (about 15 minutes, once)

### 1. Make a GitHub account and a repository
1. Sign up at github.com (free).
2. Click **New repository**, name it `rynoscan`, choose **Public**, leave it empty, click **Create**.
   (Public is the simplest way to host the page for free. It also means anyone with the link can see your scan results. Your API key stays private.)
3. Click **uploading an existing file**, drag in **everything inside this folder** (including the hidden `.github` folder, which must keep its path `.github/workflows/scan.yml`), and click **Commit changes**.
   Tip: if the hidden folder won't drag in, use GitHub Desktop, or create the file by hand: **Add file > Create new file**, type `.github/workflows/scan.yml` as the name and paste the contents.

### 2. Turn on the web page
Repository **Settings > Pages**. Under "Build and deployment" pick **Deploy from a branch**, branch **main**, folder **/docs**, **Save**.
After a minute your dashboard is at `https://YOUR-USERNAME.github.io/rynoscan/`. Bookmark it on your phone.

### 3. Data key (recommended, makes a scan take minutes instead of an hour)
Without a key the scanner uses the free feed, which rate-limits hard (a scan can take 30-60 minutes and covers fewer coins). It still works.
With a CoinGecko paid API key (their on-chain data, Analyst plan or similar; check their pricing page and that on-chain/GeckoTerminal data is included in the plan before paying):
1. Repository **Settings > Secrets and variables > Actions > Secrets > New repository secret**. Name `CG_API_KEY`, value = your key. 
2. Same page, **Variables** tab > **New repository variable**. Name `CG_PLAN`, value `pro` (paid key) or `demo` (free demo key).
Never paste the key into a chat or into a file in the repository.

### 4. Phone alerts (optional)
1. Install the free **ntfy** app (iPhone or Android).
2. In the app, subscribe to a topic with a long random name, e.g. `rynoscan-8f3k2x9q7w` (anyone who knows the name can read it, so make it hard to guess).
3. Repository **Settings > Secrets > New repository secret**: name `NTFY_TOPIC`, value = that topic name.

### 5. Run the first scan
Repository **Actions** tab > **RynoScan** > **Run workflow**. Watch it run (the "Run scan" step prints progress and a plain summary). When it finishes the dashboard updates. After that it runs by itself at five past every hour from 6:05am to 10:05pm Brisbane.
The first time, GitHub may ask you to enable Actions: click the green button.

## Changing settings
Edit `config/settings.json` on GitHub (pencil icon):
- `minVolume` (default 100000): ignore coins under this 24h volume.
- `minLiquidity` (default 100000).
- `maxPools`, `cap` and `extraPages`: how many coins to scan per run and how deep to search each chain (paid key only). Each scan uses roughly 240 data calls, so about 120,000 a month at 17 scans a day; raise these only if your plan allows.
- `chains` (default solana and robinhood): which chains the hourly scan covers. Add "eth" to include Ethereum (about 50 more calls per scan). The Check a coin box still searches all three chains.
- `minOpp` (default 65): only coins above this opportunity score are shown.

Research list: put coins you always want scored in `config/mycoins.json`, e.g. `{"coins":["BONK","solana:WIF","<contract address>"]}`.

## Check a coin
The search box on the dashboard first looks in the latest scan; if the coin isn't there it fetches the data live from your browser and scores it with the same rules. Search by ticker, name or contract address. Prefix the chain if the ticker is ambiguous, e.g. `solana:BONK`.

## Running it on your own computer instead
Install Node 20+ (nodejs.org), then in this folder:
```
CG_API_KEY=your_key CG_PLAN=pro node src/scan.mjs     (Windows PowerShell: $env:CG_API_KEY="..."; node src/scan.mjs)
npx serve docs
```
Run the scan on a schedule with cron / Task Scheduler if you want.

## Safety and risk features
- **Token safety checks.** Before a coin can be bid-ready it is checked for the things that actually rug people: on Solana, mint or freeze authority still enabled and other danger flags (RugCheck feed); on Ethereum, honeypots, heavy taxes, owner powers and concentrated holders (GoPlus feed). A dangerous token is removed from the lists and named in the scan summary. Warnings (for example concentrated holders) stay visible on the card and cost 3 opportunity points. **Robinhood Chain is not covered by these free feeds**, so those cards say "not checked": look at the contract and top holders yourself. A coin the feed cannot check is never shown as safe.
- **Market backdrop.** SOL (for Solana coins) and ETH (for Ethereum and Robinhood coins) are scored Risk-on, Neutral or Risk-off from their daily and 4h trend. A banner at the top and a line on each card warn you when it is risk-off. By default signals are kept and flagged; set `"regimeFilter": "downgrade"` in `config/settings.json` to turn bid-ready into watch while the market is risk-off, or `"off"` to switch it off.
- **Trend pullback setup.** A new setup type for coins already in an uptrend that pull back 65-90% of their last leg (the typical meme-coin retrace), form a base and turn up again. It appears alongside the five chart patterns.
- **Position sizing.** Fill in the Position sizing box on the dashboard (account size, risk per trade, share of pool liquidity, max open positions). Every card then shows a suggested size: the smaller of what the stop distance allows at your risk per trade and 1% of the pool's liquidity. The Open positions tile warns when you are at your limit. It is saved in your own browser only.
- **Smarter alerts.** A phone alert is sent only if the price is still inside the entry zone, never repeats the same coin within 24 hours, and includes the buy zone, stop, maximum size and a market warning.
- **Backtest.** The "RynoScan backtest" workflow (Actions tab; also runs every Sunday) replays the chart rules over the last ~40 days of hourly candles and shows win rate, average R and profit factor per setup in the Backtest section of the dashboard. Run it once after the first scan. It is a sanity check, not a forecast: it covers a short window, only coins that are active today, and approximates the buyer/seller gate from candle volume.

Extra settings in `config/settings.json`: `safetyChecks` (true/false), `regimeFilter` ("warn", "downgrade" or "off"), `backtestPools` (coins in the backtest, default 150), and `goplusChainId` (e.g. `{"robinhood":"<chain id>"}` if the safety feed adds Robinhood Chain support).

## Good to know
- GitHub's scheduled runs can start 5-30 minutes late; that is normal. If the repo has no activity for 60 days GitHub pauses the schedule, but each scan commits its results so that normally keeps it alive.
- If a scan can't get data it leaves the dashboard untouched rather than publishing a bad one. The Actions log says why.
- The dashboard here is separate from the one inside Claude, which keeps showing whatever Claude last published.
- Sample data from the 13 Oct 2026 12:46 UTC scan is included so the page isn't empty before your first run; it is replaced on the first scan.
- This is a rule-based screen, not financial advice. The exit rules are untested until the signal log has about 30 closed signals. Meme coins can go to zero and stops can gap on thin liquidity.

## Tests (for developers)
`npm test` runs offline checks: the API layer, the safety and market filters, the Check-a-coin path, plus a parity test proving this code scores identically to the original Claude scheduled scan on a fake market. `node test/lookup.test.mjs` checks the Check-a-coin path.

## Rule revisions after the backtest (v2)
Based on a ~10 day, 106-signal replay (small sample, treat as directional):
- Stop distance: patterns with a stop 10%+ away lose 8–18 opp points, 15%+ the most; reversals with a stop 5%+ away lose 6.
- Pattern entry signals need a confirmed breakout. Forming patterns can only be Watch, and only within 3% of the trigger.
- Pattern score now weights quality less (0.45) and breakout state more.
- Reversal Watch requires the structure gate.
- Falling-knife filter: a coin down more than 15% over 7 days with the daily RSI not turning is kept out of Watch/Entry and loses 10 opp points.
- Set `RS_RULES=v1` to reproduce the original rules (the parity test does this).

## v3: entries
- `src/watch.mjs` + `.github/workflows/watch.yml`: every 30 minutes (with backup slots) it checks live prices against the entry zones from the last scan and alerts when price is in the zone, the setup is invalidated, or price ran past TP1 unfilled. It writes `docs/data/watch.json`.
- Full scans run every 2 hours (backup slot 30 minutes later; skipped if a scan ran in the last 90 minutes).
- `fillAt: "high"` and `slipPct: 1.5` in `config/settings.json` make the backtest and signal log assume a limit order at the top of the zone plus slippage. Trend pullback is switched off (`RULES.off` in `docs/core.mjs`).

## v3.1: learning loop
- `src/learn.mjs` runs at the end of every backtest and writes `docs/data/learned.json`. The backtest now replays every pattern, including four candidates in shadow mode (Ascending triangle, Base breakout, Breakout retest, Liquidity sweep reclaim) and switched-off ones (Trend pullback).
- A candidate goes live only with 20+ closed trades whose 90% confidence interval is above zero and profit factor over 1.3. A live setup is switched off only with 12+ trades whose interval is below zero. The scan reads `learned.json` at the start of each run.
- DexScreener extras: the watcher reads hourly buy/sell flow and liquidity (alerts on a 40% liquidity drop), the scan flags tokens with an active paid boost, and every card links to the pair on DexScreener.

## v4: hardening, grey theme, three-voice panel
- Stress-tested: garbage candles, bad response bodies, wrong-shaped data files, feed outages (the run stops after 4 failed requests), unfinished 4h candles (the live scan now scores closed candles only, like the backtest). Tests in `test/hardening.test.mjs`.
- `docs/panel.mjs`: bull, bear and a neutral evidence judge with veto power argue each setup; shown under every card, logged in the signal log, summarised in alerts, and scored by the learner.
- The scan, watcher and backtest workflows send a phone alert if the run itself fails. The dashboard shows a schedule warning when a run is overdue.

## v5: hourly updates
- `scan.yml` runs hourly, 24 hours a day. Every 4th hour, right after a 4h candle closes, it is a full discovery scan; the other hours are light refreshes that rebuild the tracked coins from DexScreener (free) and only fetch their candles from CoinGecko. A full scan costs about 250 CoinGecko calls, a light one about 60, which keeps hourly updates inside a 100k-calls-a-month plan. `docs/data/usage.json` tracks the month's calls; near the limit the scan stays light.
- Set `"lightScans": false` in `config/settings.json` to make every run a full scan (about 130k calls a month, over a 100k plan).

## Learning loop and edge report
Every week the backtest replays recent candles and combines them with your live signals and the background trades (near-misses, and every pattern that is not live, tracked silently from each full scan). It flags a pattern as failing when the 90% range is below zero over 12+ trades, but never switches a pattern off: every pattern keeps running and alerting. The dashboard's Learn section also shows an **Edge report**: whether there is an edge yet, what each pattern still needs, what winners had in common, and candidate rules checked on older and newer trades. It never changes a rule by itself.

## Gates, resting limit calls and the gate funnel
A reversal setup has 7 gates (RSI divergence, RSI flipping up, volume, buyers, price in the buy zone, chart structure, safety). Because you place limit orders in the zone rather than chase, the **zone gate counts as an order rule**: six quality gates passing with price up to 8% above the zone is bid-ready as a *resting-limit call* (the alert says "rest a limit order at X, do not chase"). To go back to the strict seven-gate rule set `zoneAsOrder:false` in `docs/core.mjs`. The scan pane shows which gates block the most coins, and a low-priority phone alert tells you when a coin is exactly one gate from bid-ready. Every tracked trade records the gates it missed and whether it was a resting-limit call, so the Edge report can tell you whether these early calls pay.

## Gate report (weekly)
The scan keeps 14 days of gate-failure counts (`docs/data/funnel-history.json`). The Sunday backtest compares trades that passed every gate with trades that missed only one gate, and shows per-gate keep / relax / unclear plus bottleneck numbers in the Learn tab ("Gate report"), and sends a summary to your phone via `src/weekly.mjs`. It is a report only; nothing is switched off.

## Early-1h experiment
Each full scan also re-scores every coin with the still-forming 4h candle (built from closed 1h bars). If every reversal gate passes on that version but not on the closed-candle version, it is logged as `<pattern> [early 1h]`, tracked with the normal fill/exit rules, and sent as a low-priority "Early" phone alert (max 3 per scan, once per coin per day; set `"earlyAlert": false` in `config/settings.json` to stop the alerts and keep tracking). These trades are kept out of the normal setup stats. The weekly Gate report compares them with confirmed trades and says whether waiting for the 4h close costs you entries or saves you from fakeouts.

## Runner study upgrades
- **Random control group:** each full scan also logs up to 6 random coins that meet the runner size floors but are not on the list, with the same exits. The study compares the list against them.
- **Liquidity-scaled slippage:** degen and runner-log fills pay the flat 3% plus the price impact of a $1,000 order (size / pool liquidity) on the way in and out.
- **Locked test:** `config/study.json` holds `lockedFrom`. Rules are found only on trades before that date and judged only on trades after it. Do not move the date after seeing results.
- **More samples:** up to 20 runners are logged per scan (was 12), from 20 candidates.
- **Wallet trend:** `data/wallethist.json` keeps recent buyer/seller snapshots per pool; the change in buyers-to-sellers versus an earlier snapshot is logged as `wTrend` and tested as a feature.

## Access code, risk view and real fills
- **Access code:** the dashboard shows a code screen first (the code is stored only as a SHA-256 hash in `docs/index.html`, and the browser remembers it once entered). This is a screen lock, not real security: the page source and the files under `data/` stay public to anyone who knows the address. Do not rely on it to protect anything sensitive.
- **Exit-liquidity vetoes:** a runner is dropped if selling $1,000 would move its price over 4%, or if daily volume is over 60x the pool (pump or wash-trading sign). Still logged, so the study can check the rule.
- **Risk view:** the runner study shows worst drawdown, longest losing run and a suggested position size.
- **Week by week:** top findings are checked for consistency across separate weeks.
- **Real fills:** `config/livefills.json` is where you log what a small real trade actually cost versus paper. The study then reports the gap.
- **Progress:** the weekly phone report states how many closed trades are still needed before reading results (30).
