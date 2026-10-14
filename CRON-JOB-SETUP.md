# Setting up cron-job.org (so RynoScan does not depend on GitHub's schedule)

GitHub's own schedule is best-effort and sometimes goes quiet for hours. cron-job.org is a free service that pokes GitHub on time instead.
You need: a free cron-job.org account, and a GitHub token that is allowed to start workflows on this one repo.

## Part 1: make the GitHub token (about 2 minutes)
1. github.com -> your profile picture -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token.
2. Token name: `cron-job`. Expiration: 1 year (put a reminder in your calendar to renew it).
3. Repository access: **Only select repositories**, then pick `RYNOSCAN`.
4. Permissions -> Repository permissions -> **Actions: Read and write**. Leave everything else alone.
5. Generate token and copy it now (it is only shown once). Keep it private: it goes into cron-job.org only. Never put it in the repo or send it to anyone.

## Part 2: make the jobs at cron-job.org
Make three jobs. For each: Create cronjob, then fill in the fields below. Under "Advanced" set the method, headers and body.

| | Job 1: scan | Job 2: watcher | Job 3: backtest |
|---|---|---|---|
| Title | RynoScan scan | RynoScan watcher | RynoScan backtest |
| URL | `https://api.github.com/repos/devonflap/RYNOSCAN/actions/workflows/scan.yml/dispatches` | same, but `watch.yml` | same, but `backtest.yml` |
| Schedule | every 30 minutes | every 15 minutes | weekly, Sunday 11:40pm (Brisbane time) |
| Method | POST | POST | POST |

**Time zone:** in cron-job.org account settings set your time zone to Australia/Brisbane so the times above mean what they say.

**Headers (same on all three):**
- `Authorization` = `Bearer YOUR_TOKEN` (the word Bearer, a space, then the token)
- `Accept` = `application/vnd.github+json`
- `Content-Type` = `application/json`

**Request body:**
- Jobs 1 and 2: `{"ref":"main","inputs":{"source":"chain"}}`
- Job 3: `{"ref":"main"}`

## Part 3: test it
1. Open each job and press **Test run**. Success is HTTP **204** (no content).
2. 401 = token wrong or expired. 404 = wrong URL or the token cannot see the repo. 422 = the body or branch name is wrong (the branch must be `main`).
3. Open the repo's Actions tab: a new run should appear within a minute of each test.
4. In cron-job.org settings turn on "notify me when a job fails" so you hear about a broken token.

## Good to know
- Scans that run too close together skip themselves, so the 30-minute pings do not waste your data allowance.
- If the token expires the pings fail with 401 and cron-job.org emails you. Make a new token and paste it into the three jobs.
