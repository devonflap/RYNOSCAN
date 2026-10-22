# RynoScan

Your 4-hour-chart meme coin scanner for Solana, Robinhood Chain and Ethereum, running on its own (no Claude needed).
It scans every hour, around the clock (24 scans a day), updates a web dashboard, and can buzz your phone when something new shows up.

Everything is free except the data key (optional, see step 3).

## What you get
- A dashboard web page (blue theme, rhino logo) with: Check a coin, on-chain volume gauge with the "trade none or minimum" tip, bid-ready charts with entry zone / stop / TP1-3, worth-watching list, chart patterns and bottomed-out coins, signal log with results in R, and exit rules.
- Phone alerts (optional): by default only when something is broken (see **Phone alerts: health only** at the end). The trade alerts (new bid-ready, strong watch, take-profit/stop) come back with `"phoneAlerts": "all"` in `config/settings.json`.

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

## Signal log & results (audit trail)
Collapsed by default. Shows the live count toward 30 closed trades, groups rows into Open, Closed and Never filled, labels each row (Live / Replay / Near-miss) with a plain-English "why it ended", filters by coin, setup and state, can subtract an extra cost per trade, and downloads the filtered rows as CSV. The backtest replay and the SOL 7-day move are shown only as context.

## Paper books and the strategy lab
Eight paper books, each with its own $10,000, all started from the fresh-start date in `docs/paper-config.json`:
- **Conservative · Bid-ready setups** (5% per trade): the main rules' bid-ready calls, thirds at TP1/2/3.
- **Conservative · Risky coins** (4%): runners passing 3+ of 4 checks and no risk rule; stop 10%, 40% sold at +15%, 30% at +30%, rest trails 10%, 24 h.
- **Degen desk** (10%): unchanged rules. **Degen ladder / moonbag / tight**: the same coins at the same times with other exits, so they compare directly.
- **Scalper · breakout / dip-buy** (5%): 5-minute candles, decided once an hour at scan time, 1% cost each way plus price impact; paused above 85% of the monthly data allowance.

Every open position shows size, entry, now, banked, current risk (and what the trade ends at if the stop hits), position value and P&L. "Compare all" ranks the books, shows the same trades at 5/10/20/30% size, and the exit study on every logged runner.

Code: `docs/exits.mjs` (exit engine + paper account), `docs/strategies.mjs` (books, entry rules, scalp rules). Trades live in `docs/data/lab.json`. The engine reproduces the old degen desk exactly. Exit-rule comparison on runner-log trades now waits 7 days so long-running exits are not judged early.

## Playbook books, new patterns and the wallet scorecard (19 Oct)
- **Backtest fix:** replayed signals are stamped at the 4h close and checked from the next candle. Earlier reports filled trades on the candle that created the signal, which flattered them. Re-run the backtest for a fair baseline. The report now states its limits (today's trending coins only, ~25+ days old, no past safety/holder/social checks).
- **Trailing stops** in every paper book only use highs of candles that have closed.
- **New 4h patterns:** inverse H&S and cup & handle (live like the others).
- **Playbook books** (Paper desk → Playbook): *First Fib pullback* (limit at the 0.5/0.618 retrace of a 50%+ run to a new high, stop 7% under 0.786, targets old high / 1.272 / 1.618), *Inside the pattern* (limit in the lower third of a forming wedge, flag, double bottom, inverse H&S or cup & handle; half sold at the breakout line), *Follow proven wallets* (2+ proven wallets net buying; half out at 2x, 25% at 3x, rest trails). Limit orders that expire or get cancelled are not trades.
- **Discovery** also reads the 1h and 6h trending lists (`freshTrending`, `freshExtra` in settings); those coins are tagged and always scanned. Runner-log trades carry a lifecycle phase (new / sweet spot / fading) and the study tests it.
- **Wallet scorecard** (`src/scorecard.mjs`, data in `docs/data/wallets.json`, summary in `walletscore.json`): each full scan records the net buyers of runners and early movers; 72 hours later it checks whether the coin ran +50% before dropping 30%. Wallets with 3+ coins, 2+ wins and a run rate 15 points above average are *proven* and count as smart wallets everywhere (★ on runners; proven wallets selling drop a coin). Wallets in more than 30% of all coins are treated as bots. Needs 2–3 weeks of data before anything is proven. No X or social data is used.

## Edge board and clean-up (19 Oct, later)
- **Edge board** (Paper desk → Compare all, and the "Edge board" tile at the top): every book in R (profit ÷ what the first stop would have lost), so scalps and degen trades compare fairly. Each book shows its average R, a 90% bootstrap range, the chance the true average is above zero, the last 14 days, and the average without its best trade. Verdicts: collecting (<10), promising / losing / unclear (<30), then edge candidate (30+ trades, range above zero, still positive without the best trade), not proven, or no edge. Code: `docs/evidence.mjs`.
- **Market at entry:** every new paper trade stores the SOL trend and the on-chain volume day; each book shows its result split by them.
- **Exit check:** each book reports how far losers ran before failing and how far winners dipped before working (from the run-up and dip of every trade) — the data for tuning take-profits and stops.
- **Weekly phone report** leads with any edge candidate and lists promising books.
- **Room to the real target:** TP2 is stretched to at least 2R, so the reward gate always passed and the "reward to risk" study could not see small rewards. Every signal now also records `room` (reward to the prior high or measured move per unit of risk) and the study tests it. The live gate is unchanged.
- **Cleaner dashboard:** fixed sidebar (runners link was mislabelled and two links were duplicated), a Today strip (bid-ready, runners, early movers, worth watching, open paper trades, edge board), runner cards only for coins passing 3–4 checks or with proven wallets (the rest in one-line rows), Worth watching and Patterns show 4 and 6 charts with a Show all button, and Compare all folds the detail tables.

## Bot simulator (Paper desk → Bot sim)
One $10,000 account trades the signals of all 11 books the way a real bot should (`docs/botsim.mjs`):
- **Risk sizing:** each trade risks 1% of the account at its first stop (position = risk ÷ stop distance).
- **Limits:** per coin at most 2% risk and 10% of the account across all books (two setups in one coin dump together; stops can gap and rugs take everything); no position above 2% of the pool's liquidity; 8% total open risk; no new trades after −3% of closed losses in a day.
- **Adaptive version:** only takes a book's signals while its last 20 closed trades average above zero (8 minimum), judged only on trades closed before the signal (walk-forward, no peeking).
- Shows trades taken, made smaller and skipped (with the reason), P&L by the book that gave the signal, and coins held by more than one book. Both bots appear on the edge board and in the weekly report.
- The edge board also shows **+1% cost** (every trade paying 1% more round trip; an edge candidate must stay positive) and **Days to 30** (time to a verdict at the current pace).

## Risky coins under three exit plans (Conservative tab)
Same coins and entry times as the Risky coins book (runners passing 3+ checks, no risk rule), 4% of the desk each:
- **Ryan's setup:** stop 20%, 30% sold at +69%, 30% at +150%, 40% at +260%, 7 days. The exit study on every logged runner also tries this ladder with 15% and 25% stops.
- **Claude's setup:** stop 18%, 25% at +40% (then stop to break-even), 25% at 2x, 25% at 3x, last 25% trails 35%, 5 days.

## Edge recognition rules (19 Oct, final)
- **Random baseline book:** two random liquid coins per full scan with the Risky coins exits; never fed to the bot. A book only counts as an edge if it beats this clearly (by 0.1R a trade once the baseline has 30 trades).
- **Luck correction:** with ~14 books compared, the edge verdict uses a much stricter low end (5% ÷ number of books) than the 90% range shown.
- **Consistency:** the first and second half of a book's closed trades must both be positive.
- **Edge-book alerts:** once a book earns the edge verdict, each new trade it opens is sent to the phone (`edgeAlert: false` in settings turns this off).
- **Removed:** Degen · tight and Scalper · dip-buy (they duplicated other books); fewer books also makes the luck correction less strict.

## Early-move checker and faster hourly reads (DexScreener, free)
- **Early pulse (every ~15 minutes):** the entry watcher re-checks every coin the last full scan saw (`docs/data/universe.json`, up to 300 coins with $50k+ liquidity, 30 per DexScreener call). A coin is flagged when 5-minute volume runs at least 2.5x the last hour's pace, the last hour runs 1.5x the 6-hour pace, price is up 1.5%+ in 5 minutes and 3–60% in the hour, buyers outnumber sellers in the last 5 minutes, and it is not already vertical (over 300% in 24h) or paid-boosted. Rules live in `src/pulse.mjs` (`PULSE`).
- **Where it shows:** the "Moving now" tile and list on the dashboard, saved in `watch.json` (`pulse`). Phone alerts "Early move: COIN": at most 2 per run, one per coin per 6 hours (`"pulseAlert": false` in `config/settings.json` turns them off).
- **Paper book:** each hit becomes a trade in **Early pulse** (Paper desk → Fast movers): stop 10%, 30% at +20%, 30% at +50%, rest trails 20%, 12 hours max, judged on 5-minute candles. It is in the edge board and the bot simulator like every other book.
- **Hourly calls:** every scan now records DexScreener's last-hour volume pace (vs the 6-hour pace), last-hour buyers vs sellers, and whether the early-move checker flagged the coin in the 6 hours before. They show on the coin card and are saved on each signal. Record-only: they never change a score; the learning loop tests three new features ("Last-hour volume pace", "Buyers vs sellers (last hour)", "Early pulse before the call") once each bucket has 8+ closed trades.
- **Starts after** the first full scan writes `universe.json`; no workflow changes needed (the watcher already commits `watch.json`).

## Review council, cut-on-sellers and buy-the-flush (19 Oct, evening)
- **Council (Paper desk → Council, and the "Council says" tile):** six rule-based reviewers read every paper book at the end of each scan and a chair gives one final answer (`docs/council.mjs`, written to `docs/data/council.json`). Statistician (sample size, 90% range, luck-corrected verdict), Skeptic (beats the random baseline, still positive without the best trade, both halves positive, survives 1% extra cost, works in more than one market mood, profit not from one coin), Risk manager (drawdown, losing streaks, stops gapping past plan, bot limits), Exit tuner (same coins, different exits compared trade by trade), Scout (learning-loop findings, with a luck warning), Execution (limit fill rates, cost sensitivity, thin pools). A round table shows each reviewer's view on the book most worth discussing, then the chair's ruling. No AI service and nothing paid: it runs on GitHub with every scan.
- **What the council does by itself:** only paper. The new **Bot · council** (Bot sim tab) trades just the books the chair had approved (bot candidate or promising) before each signal, so it tests whether the council picks well. Anything that would change real rules (retire a book, make an exit the main one, skip a kind of trade, a real-money trial) is listed under "Needs your OK" and never applied. A phone alert goes out only when a book is newly called a bot candidate.
- **Degen · cut on sellers (Degen tab):** same coins as the degen desk; sells everything early when the trade is 8%+ under entry AND sellers take over (hourly wallet read: 1.2x more wallets selling than buying with money flowing out; or the 15-minute DexScreener check: 1.2x more sells than buys in the last hour and more sells in the last 5 minutes). It never cuts a trade that is in profit (the trailing stop handles that). Compared trade by trade with the current exits in the Council's exit test.
- **Runner study exits:** two more loss reducers replayed on every logged runner: a heavy selling candle (red, 2x volume, closes near its low, trade 8%+ down) and no follow-through (never 10% up after 8 hours and under entry), plus both together.
- **Early pulse · buy the flush (Fast movers tab):** the same early-move alerts, but a limit 6% under the alert price, waiting up to 3 hours; cancelled if it runs 25% without a dip. Judged per alert against buying straight away, with a missed fill counted as 0%.
- **Holder concentration:** each new bid-ready signal records the top-10 holder share; the learning loop tests whether concentrated coins do worse (record only).
- No workflow changes: `council.json` is committed by the scan workflow (it adds `docs/data`), the 15-minute seller check rides in `watch.json`.

## Accuracy fixes, luck checks and the thread's ideas (19 Oct, night)
- **Dead pools now count:** a trade whose pool stops giving fresh candles (rugged, delisted, migrated) used to stay open forever, or drop out of the results after 48 hours, which flattered every book. Now each scan without fresh candles is counted as a miss (only while the data feed itself works); after 6 in a row an entered trade is closed at half the last price seen, labelled "price data stopped". Applies to the strategy lab, the degen desk and the runner log. Dead rows also no longer block the queue that decides which rows get re-checked (the runner log and degen desk now re-check the least recently checked rows first).
- **Learning loop luck check:** feature slices are now compared with the REST of the trades (not with zero) and corrected for how many slices were tested (Benjamini-Hochberg q-values). When the whole system loses, every slice used to look "reliably negative"; now only slices that are clearly worse or better than the rest are called reliable.
- **Where each book works (Council → Scout):** every book with 20+ closed trades is split by market mood, volume day, lifecycle phase, liquidity, hour and chain, each slice compared with the rest of that book, luck-corrected across all books. Clear findings appear as "Needs your OK" questions, never applied.
- **Stop-fill stress:** DEXes have no resting stop orders, so a bot sells after it sees the stop hit. The Skeptic now checks each book still makes money if every stop, trail and cut sale filled 5% lower.
- **Size hint:** a bot candidate comes with a risk-per-trade suggestion: a quarter of the Kelly figure from its paper trades, capped at 1%.
- **From the six-bot desk thread (runner study):** two exits replayed on every logged runner: "out when volume dies" (last 6 hours under 20% of the 24-hour pace) with the degen stops, and the thread's own rule (no price stop at all, hold until volume dies, 7 days max). Their "one buyer walking the price" check is already in the runner study as "Top 3 wallets share of volume".

## Position alerts, buyer spikes, market sizing and the score check (20 Oct)
- **Your positions → phone alerts** (`src/positions.mjs`, run by the 15-minute watcher): tap **Get phone alerts** on a coin card (or "+ Add a coin you hold" in the Moving now box). GitHub opens with `config/positions/<coin>.json` filled in; set your real entry and commit. Alerts: volume fading (6h under 35% of the 24h pace) and **volume died, consider closing** (under 20%), **sellers took over** (8%+ under entry, sellers 1.2x the last hour and ahead in the last 5 minutes), **stop hit**, **TP1 reached**. Bid-ready setups get a "lost its volume, consider cancelling" alert. Delete the file to stop. `"volumeAlert": false` in settings turns these off. Your positions show at the top of the Moving now box.
- **Buyer spike book** (Fast movers tab): unique wallets buying in the last hour at least 3x the 24-hour hourly average (GeckoTerminal counts wallets, so one bot spamming trades doesn't inflate it), 25+ buyers, 1.3x more buyers than sellers, volume 2x its pace, and the price NOT already run (0–30% in the hour, under 150% in a day). Full scans only. The spike is also recorded on every signal and runner, so the learning loop and runner study test it.
- **Bot · by market** (Bot sim tab): the same trades as "Every book", sized by the market at entry: bear ½ (SOL risk-off, or weak on-chain volume), neutral 1x, bull 1¼ (SOL risk-on or strong volume), mania 1½ (both). Compare the two to see whether market sizing pays.
- **Score check:** on the first 111 closed bid-ready trades the opportunity score barely ranked the results (rank correlation +0.12), while pattern quality (+0.31), gates passed (+0.29) and 4h volume surge (+0.29) did, and a stretched reward-to-risk ranked them backwards (-0.11). A **shadow score v2** built from those is recorded on every new signal (card Details) and judged only on trades from 20 Oct on. The council asks before any switch.
- **Statistics on every signal:** verdicts, averages and the council now use every recorded signal (no account limits); the paper accounts still show what fitted in their slots.
- **Council:** book-and-condition findings must also point the same way in the older and newer half of the trades; the Risk manager flags books where 15%+ of closed trades were dead pools (rugs).

## Stop-distance fix and shadow score v2 (20 Oct)
- **Live fix: minimum stop 5% under the entry** (`"minStopPct": 5` in `config/settings.json`; 0 brings back the old rule). On the first 116 closed trades, stops under 5% averaged -1.10R and won 14% (costs of ~1.5% each way and normal meme-coin noise eat them; stop-outs averaged -1.50R), while 5%+ stops averaged -0.46R. A structural stop tighter than 5% is now moved to 5% under the entry and the targets are rebuilt from the wider risk (setups whose targets no longer pay 2R drop out on their own). The score now takes 12 points off a stop under 5% instead of taking points off WIDE stops (the old rule pushed the scanner towards the trades that lost most). Position sizes are by risk, so a wider stop means a smaller position, not more dollars at risk. The inside-the-pattern paper book keeps the pattern's own stop.
- **Shadow score v2, revised before it starts being judged:** upside to TP3, pattern quality, gates passed and 4h volume surge (the parts that ranked results), minus 15 for a stop under 5% and minus 10 for pattern quality under 70. Recorded on every new signal, judged only on trades from 20 Oct.

## Execution layer, study exits and the dry-run bot (20 Oct)
- **The split:** the scanner finds WHERE (a setup: zone + invalidation); a 5-minute trigger decides WHEN; an exit stack decides HOW OUT. The 4-hour gates stay as the scanner's quality filter, not as entry timing.
- **5-minute trigger** (`execTrigger` in `docs/strategies.mjs`): a flush below the zone that closes back above it, or a bounce in the zone; 1.5x (flush) / 2x (bounce) normal volume; close in the upper half of the candle; no more than 3% above the zone. Buy the next 5-minute open; stop 1% under the flush low (5% minimum, skip if over 20%). Setup dropped if a candle closes under its invalidation, or after 24 hours.
- **Exit stack** (`exec` profile, replayed on 15-minute candles): a third at +1R and stop to break-even, **ride free at 2x** (sell just enough to get the stake back; the rest cannot lose money), a 25% trail until free, then out when a 15-minute candle closes 50% under its best close; out early after 6 hours without +1R, or when volume dies; 3 days max.
- **Bot rules tab** (paper, the dashboard's first tab): the same scanner setups three ways: the bot's rules (5-minute entry, 15-minute exits), a plain zone limit with the same exits (baseline), and the trigger with the study exits. A setup that never triggers counts as 0% in the Council's paired test.
- **Study exits** (`study` profile): 40% floor under the entry, ride free at 2x, then out on a 15-minute close 50% under the best close; 7 days. Also run on the degen desk's coins (**Degen · study exits**) and in the runner study (plus a 20%-stop version).
- **RynoBot** (`bot/`): four always-on bots on a small server (runner, breakout, range, ignition), each with its own $10,000 paper pot and kitty, a web desk, a live layer for Solana and Robinhood chain that stays off until armed, weekly reality checks against the paper books, and the council reading their records. Setup, modes, wallets and the go-live gates: `bot/README.md`; the security posture: `bot/SECURITY.md`.

## Phone alerts: health only (20 Oct)
RynoBot does the trading now, so the phone no longer gets trade alerts to act on by hand. `"phoneAlerts": "health"` in `config/settings.json` (the default) keeps the scanner, watcher and dashboard running exactly as before; only the phone goes quiet. Set it to `"all"` to bring the trade alerts back.
- **Off:** bid-ready, strong watch, signal updates (TP/stop), one gate away, early 1h, degen runner, edge-book trades, the 6-hourly bid digest and daily check-in, position and early-move alerts from the 15-minute watcher. All of it still shows on the dashboard.
- **Still on (something needs you):** a run failed (scan, watcher, backtest); the watchdog restarted an overdue scan; CoinGecko calls passed 90% of the monthly limit (new, once a month); RynoBot problems and "RynoBot has gone quiet" (`src/botwatch.mjs`, run by the watchdog: the bot's heartbeat on the silent `<topic>-hb` topic stopped for 90 minutes).
- **Still on (rare, about the bot):** the weekly report (Sunday night), the council's "earned a bot spot" alert, and the bot's reality check every 2 weeks.
- **Bot reality check** (`bot/reality.mjs`, weekly on the server, or `node bot/run.mjs --reality`): the bot's dry-run trades against the paper Bot rules book on the same coins, the gap between them, where it comes from, and every paper trade the bot missed with the reason.


## Go-live checks (20 Oct)
- **The bot and the paper Bot rules book take the same setups:** bid-ready or worth watching scored over 65, $100k+ liquidity, no rug danger, one setup per coin per 24 hours (so a stopped-out coin is never bought straight back). That keeps the reality check like-for-like.
- **Sizing counts slippage:** the bot sizes on the loss from its fill (price plus slippage) to the stop less exit slippage, so a stop-out costs the planned 1% of the account instead of about 1.3-1.6%.
- **Candles once per closed 5-minute candle** per coin (45 seconds after each close), well inside GeckoTerminal's free limit.
- **Council:** the Bot rules books are now also split by setup type, bid-ready vs watch, trigger kind (flush vs bounce), score band and stop distance, with the same luck correction; and the study exits are judged against the bot rules on the same trigger entries (a pure exits test) instead of against the zone limit.
- **Paper trigger checks:** up to 20 setups can wait for a trigger (they no longer use up the 10 trading slots), checked least-recently-checked first, 16 per scan.

## Breakout retest bot, research books and the bot tuner (20 Oct)
- **Where the +0.93R came from:** 31 of the 37 Breakout retest trades were backtest replays of near-misses (the pattern with a valid plan, score 50+, but not every gate), 2 were live near-misses and 4 shadow tracking. Backtest replays carry hindsight and only include coins still active today, which flatters breakouts most. The pattern analyst now shows the two apart ("Where the record comes from") and says when the live record is well below the replays.
- **Analyst fix:** a "works best / does worst" slice is now compared only with trades where the same feature is known. Before, "Volume day: Strong" compared live-tracked trades (the only ones with a volume day) against backtest replays, so it measured hindsight, not volume. Conditions also carry their feature and bucket for the tuner. Backtest trades are saved with their features in `bt-trades.json`.
- **Research books (Paper desk → Breakout):** *As backtested* (every Breakout retest, limit at the top of the retest zone, thirds at TP1/TP2/TP3, break-even after TP1, 7 days, 1.5% costs), *Bot filters* (the same after the Breakout bot's filters: its paper twin) and *5-minute trigger entry* (same setups, bought only on 5-minute confirmation, same plan stop and targets: the pattern loses mostly on entries that never work, so this tests a tighter entry). Live paper, no hindsight.
- **Bot tuner (`docs/tuner.mjs`, run with the council every scan):** every hint becomes a filter, tracked on trades after it was found (the paper books, live signals and the forward tracking; never backtest replays). It switches on once it holds (10+ trades kept, 8+ removed, kept ones 0.3R+ a trade better, and the gap passes a luck check across every filter tested at once); a starting filter switches off if new trades go against it; filters can never leave less than 20% of trades. Only which setups are taken can change. Shown under Paper desk → Breakout → Bot tuner, in the council's actions and in the weekly report.
- **Breakout bot (`rynobot@breakout`):** see `bot/README.md`. Starts with one filter (reward to risk to TP2 of 3R or more) and allows stops up to 35%.
- **Not switched on, and why:** "Robinhood only" (10 trades, and mostly a few big backtest runners), "stops over 20% only" (15 trades; 10-20% did worse than both narrower and wider stops, a sign of noise), "skip 10-20% stops" (6 trades), "skip strong volume days" (measured hindsight, see above). All are being tested on new trades by the tuner and switch on by themselves if they hold.

## Bot desk and $10,000 accounts (20 Oct)
- **Bot desk** (`bot/dash.mjs` + `bot/dash.html`, service `rynobot-dash`, port 8080, password set at install): both bots on one page with account curves, daily results, watch lists, live positions, closed trades, activity, and a 5-minute chart of any trade with its entry, stop, targets and fills beside the rules it was taken under. Read only; the server fetches charts from GeckoTerminal (cached, at most 12 a minute).
- Paper accounts start at **$10,000** (`accountUsd`). The bots keep live prices on positions and setups, an equity point every 5 minutes, and R on closed trades for the desk. `node bot/run.mjs --bot <name> --reset` starts an account again (old files kept).

## Execution audit (20 Oct, evening)
Reviewed every path that decides money. The chart rules were sound (closed candles only, no hindsight). Four fixes in how the bots fill and size, which is where memecoin accounts actually leak:
- **Price impact is now in the costs and the sizing.** Costs = 1% slippage + about 2 x (order / pool liquidity) each way. Sizes are capped at 1.5% impact and 1% of the pool. Before, a $2,500 order in a $100k pool was priced as a 1% cost; it is nearer 5% each way.
- **Liquidity is re-checked at buy time:** under $100k, or down 40% since the setup was found, and the buy is dropped (a pool being pulled).
- **The daily loss limit counts open positions**, not just sold trades, so four positions bleeding at once stop new buys.
- **The Breakout bot's limit fills at the limit price.** If the bot first sees the price already below the zone, the resting order would have filled at the top of the zone on the first touch; filling at the lower price flattered the bot.
Not changed, on purpose: the trigger thresholds, targets, ride-free level and holding times. They are the thing the 2-week test measures; tuning them now would fit them to noise.

## Test accuracy (20 Oct, late)
- **Passed-on tracking:** every setup a bot drops (no chasing, too late, thin or pulled liquidity, size too small, expired) is followed for 24 hours with its price, best price and whether its stop would have hit. The desk shows how often saying no was right. This is the missing half of the 2-week test: a bot can look fine on the trades it took and still be leaving the best ones on the table.
- **Trigger-to-fill latency:** each fill records the trigger price (the next 5-minute open), the price actually paid and the impact for the pool, so the reality check can split the paper gap into "late fills" and "wick targets".

