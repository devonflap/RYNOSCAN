# Your positions (phone alerts)

One small `.json` file per coin you actually hold. The entry watcher (every ~15 minutes) checks each one on DexScreener and sends
an ntfy alert when:

- **volume dies**: the last 6 hours traded under 20% of the 24-hour pace (a "fading" warning comes first, under 35%)
- **sellers take over**: you are 8%+ under your entry and sellers lead the last hour (1.2x) and the last 5 minutes
- **stop hit** or **TP1 reached** (if you put them in the file)

The easiest way to add one: tap **Get phone alerts** on a coin card on the dashboard. It opens GitHub with the file filled in;
change `entry` to your real fill price and press **Commit changes**. To stop the alerts, open the file here and delete it.

By hand: create `config/positions/solana-mycoin.json` with

```json
{ "coin": "MYCOIN", "chain": "solana", "pool": "the pair address from DexScreener", "entry": 0.0123, "stop": 0.0098, "tp1": 0.018 }
```

`pool` is the pair address (the last part of a DexScreener link). You can use `"token": "<contract address>"` instead; the
watcher then follows its most liquid pair. `stop` and `tp1` are optional. Set `"volumeAlert": false` in `config/settings.json`
to switch all of these alerts off.
