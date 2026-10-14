# RynoScan

Your 4-hour-chart meme coin scanner for Solana, Robinhood Chain and Ethereum, running on its own (no Claude needed).
It scans every hour between 6am and 10pm Brisbane (17 scans a day), updates a web dashboard, and can buzz your phone when something new shows up.

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

## Scan now button
The dashboard has a "Scan now" button. It starts the RynoScan workflow on GitHub and refreshes the page when new data lands. First use asks for the repository (owner/repo) and a fine-grained GitHub token for that repository only with the permission "Actions: Read and write". The token is stored in your browser only. Without a token, the panel links to the Actions page where you can press Run workflow.
