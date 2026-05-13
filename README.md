# ccom-ca-up-down-bot

Experimental Crypto.com Exchange trading bot for batch-based CRO/USD and BTC/USD trading.

The project is intentionally simple: plain Node.js, no runtime dependencies, file-based logs, and HTML/CSV reports. It is a learning and operations project, not investment advice.

## Safety First

This is a public repository. Never commit sensitive data:

- API keys or API secrets,
- `.env` files,
- exact VPS IP address,
- private SSH keys,
- logs with account data,
- generated reports with private balances,
- backups.

Use API keys without withdrawals. For testing, start with read-only or dry-run mode, then move slowly with small limits.

## What The Bot Does

The bot can:

- load market prices from Crypto.com Exchange,
- load balances through `private/user-balance`,
- track one trading pair per process,
- manage independent batches in JSON logs,
- average down into a batch when price drops,
- take profit by selling a whole batch when price rises,
- keep rounded-off leftovers in a dust bank,
- write snapshots after every run,
- generate dashboards and CSV reports.

Current common setup uses two independent pairs:

- `CRO_USD`, with logs in `logs/cro-usd`,
- `BTC_USD`, with logs in `logs/btc-usd`.

Each pair should use its own env file, own log directory, and ideally its own Crypto.com subaccount/API key.

## Requirements

- Node.js 20 or newer
- Crypto.com Exchange API key
- On VPS/systemd: IPv4 DNS preference for Crypto.com IP whitelisting

For systemd services, use:

```ini
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
```

This helps avoid IPv6/IPv4 mismatch problems when Crypto.com API key IP whitelisting is enabled.

## First Run

Copy the example env file and fill your own local values:

```bash
cp .env.example .env
```

Required private values stay only in your local `.env` file:

```env
CCOM_API_KEY=...
CCOM_API_SECRET=...
```

Check configuration and connectivity:

```bash
node src/bot.js check
```

Run once:

```bash
node src/bot.js once
```

Run continuously:

```bash
node src/bot.js watch
```

With npm scripts:

```bash
npm run check
npm run once
npm run watch
```

## Trading Switches

Real trading should stay disabled until you intentionally enable it:

```env
DRY_RUN=true
ENABLE_TRADING=false
```

Real orders are sent only when both are changed:

```env
DRY_RUN=false
ENABLE_TRADING=true
```

Recommended path:

1. read-only monitoring,
2. dry-run signals for a few days,
3. small real limits,
4. trading API key without withdrawals.

## Batch Strategy

Use:

```env
STRATEGY=batches
```

Batch behavior:

- every normal run can buy a base batch of `BATCH_QUANTITY`,
- `BASE_BUY_COOLDOWN_MINUTES` prevents extra base buys after service restarts,
- `MAX_OPEN_BATCHES` can stop new base buys when too many batches are already open; `0` means unlimited,
- every batch is tracked separately,
- if price drops by `AVERAGE_DOWN_DROP_PCT` below a batch average, the bot can buy more into that batch,
- a batch can grow only up to `MAX_BATCH_QUANTITY`,
- if price rises by `TAKE_PROFIT_RISE_PCT` above a batch average, the bot sells the whole batch,
- quantity is rounded according to Crypto.com instrument rules,
- leftovers from rounded sells go to `dust-bank.json`,
- old open batches continue after restart because they are stored in logs.

Example safety limit:

```env
# 0 means unlimited. 30 means no new base batch when 30 batches are open.
MAX_OPEN_BATCHES=30
```

The max-open-batches limit only blocks new `BASE_BUY` actions. It does not block average-down buys into batches that already exist.

Older `STRATEGY=updown` still exists as a simple starting strategy:

- `BUY` when price drops by `BUY_DROP_PCT`,
- `SELL` when price rises by `SELL_RISE_PCT`,
- otherwise `HOLD`.

## Multiple Pairs

One bot process trades one pair. For multiple pairs, run multiple processes or systemd services.

Example CRO env file:

```env
INSTRUMENT=CRO_USD
BASE_ASSET=CRO
QUOTE_ASSET=USD
LOG_DIR=logs/cro-usd
```

Example BTC env file:

```env
INSTRUMENT=BTC_USD
BASE_ASSET=BTC
QUOTE_ASSET=USD
LOG_DIR=logs/btc-usd
```

Run one pair with a chosen env file:

```bash
ENV_FILE=.env.cro-usd node src/bot.js once
ENV_FILE=.env.btc-usd node src/bot.js once
```

## Reports

Generate a report for the active env/log directory:

```bash
node src/report.js
```

For multiple pairs:

```bash
ENV_FILE=.env.cro-usd node src/report.js
ENV_FILE=.env.btc-usd node src/report.js
```

Or generate both configured reports on the VPS:

```bash
bash scripts/generate-reports.sh
```

Generated files go to `reports/`:

- `index.html` - report index with links,
- `cro-usd-dashboard.html`,
- `btc-usd-dashboard.html`,
- `*-batches.csv`,
- `*-orders.csv`,
- `*-daily.csv`.

Reports include open batches, closed batches, recent orders, price chart, dust bank, daily summary, fee rows when available, and weighted annualized P/L.

Generated reports can contain private balances and trading history. Do not commit them to the public repository.

## VPS Operations

Useful operational commands:

```bash
node src/health.js .env.cro-usd .env.btc-usd
node src/backup-logs.js
node src/rotate-logs.js
```

Available npm scripts:

```bash
npm run health
npm run backup:logs
npm run rotate:logs
npm run report
```

Typical systemd commands on the VPS:

```bash
systemctl status ccom-updown --no-pager
systemctl restart ccom-updown
journalctl -u ccom-updown -f
```

If you run a second pair, use a second service with its own env file and log directory.

## Project Layout

```text
src/bot.js              Main bot command: check, once, watch
src/report.js           HTML and CSV report generator
src/health.js           Basic health check for env/log freshness
src/backup-logs.js      Local log backup helper
src/rotate-logs.js      Snapshot log rotation helper
scripts/generate-reports.sh
reports/                Generated local reports, do not commit private output
logs/                   Runtime logs, do not commit
```

## Roadmap Ideas

Planned or possible improvements:

- more reliable fill tracking through order detail/trades,
- idempotency with `client_oid` and pending orders,
- daily spend caps or stricter portfolio-level exposure limits,
- better web UI for settings and stats,
- maker-side experimental bot with intensive no-fee/maker trading,
- strategy analysis and write-up.

## Disclaimer

This is experimental software for personal learning and automation. It can lose money, fail mid-run, or behave differently from expectations during exchange/API issues. Review the code, use small limits, and monitor it carefully.
