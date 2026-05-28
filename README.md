# ccom-ca-up-down-bot

Experimental Crypto.com Exchange trading bot for batch-based CRO/USD and BTC/USD trading.

The project is intentionally simple: plain Node.js, no npm runtime dependencies, SQLite runtime storage, file-based safety logs, and HTML/CSV reports. It is a learning and operations project, not investment advice.

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
- manage independent batches in runtime storage,
- average down into a batch when price drops,
- take profit by selling a whole batch when price rises,
- keep rounded-off leftovers in a dust bank,
- write snapshots after every run,
- store hourly price history for later backtests,
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

## Private Web Dashboard

The project includes a private web dashboard with login. It does not place orders or call the Crypto.com API. It can edit only whitelisted non-secret strategy settings, shows a diff before saving, creates an automatic `.env` backup, and restarts only the matching bot service after confirmation. It is intentionally built with plain Node.js, HTML, CSS and browser JavaScript; no React and no runtime npm dependencies are required.

The current dashboard can show:

- combined CRO/BTC overview, total portfolio value, daily P/L, realized P/L, unrealized P/L and annualized P/L including sold dust,
- separate pair detail pages with last price, next sell price, average open price, balances, open/closed batches, recent orders and dust bank,
- price chart with real buy/sell markers and range switches (`24h`, `3d`, `7d`, `30d`, `year`, `all`),
- maker order statistics with fill rate, cancel rate, active count and other statuses,
- health/alerts page with systemd status, last tick age, stale maker checks and recent redacted error-like journal lines,
- settings view with editable whitelisted non-secret strategy fields, diff preview, `.env` backup and service restart.

Create a private local config:

```bash
cp .env.web.example .env.web
```

Edit `.env.web` and choose a strong password:

```env
WEB_BIND_HOST=127.0.0.1
WEB_PORT=8787
WEB_USERNAME=admin
WEB_PASSWORD=change-this-password
WEB_DATA_SOURCE=auto
```

Start it:

```bash
npm run web
```

Open:

```text
http://127.0.0.1:8787
```

For VPS use, the safest default is `WEB_BIND_HOST=127.0.0.1` and access through a protected path such as an SSH tunnel, VPN/Tailscale, Cloudflare Access, or a properly protected reverse proxy. If the dashboard is reachable through a public hostname, keep it behind HTTPS, a strong password, and preferably an additional access layer such as Cloudflare Access, nginx basic auth, VPN or Tailscale. Do not document the private hostname, exact VPS IP, passwords, emails, logs or generated reports in this public repository.

`WEB_DATA_SOURCE=auto` tries SQLite first and falls back to JSON log files. Use `WEB_DATA_SOURCE=sqlite` to require SQLite, or `WEB_DATA_SOURCE=logs` to read only the original log files.

## Batch Strategy

Use:

```env
STRATEGY=batches
```

Batch behavior:

- every normal run can buy a base batch of `BATCH_QUANTITY`,
- `BASE_BUY_COOLDOWN_MINUTES` prevents extra base buys after service restarts,
- `MAX_OPEN_BATCHES` can stop new base buys when too many batches are already open; `0` means unlimited,
- `DAILY_BASE_BUY_LIMIT` can stop new base buys after too many base buys in the current UTC day; `0` means unlimited,
- `FORCE_BASE_BUY_WEEKLY_LIMIT` can force at least N base buys in the last rolling 7 days; `0` means disabled,
- every batch is tracked separately,
- if price drops by `AVERAGE_DOWN_DROP_PCT` below a batch average, the bot can buy `AVERAGE_DOWN_QUANTITY` more into that batch,
- a batch can grow only up to `MAX_BATCH_QUANTITY`,
- if price rises by `TAKE_PROFIT_RISE_PCT` above a batch average, the bot sells the whole batch,
- quantity is rounded according to Crypto.com instrument rules,
- leftovers from rounded sells go to `dust-bank.json`,
- old open batches continue after restart because they are stored in logs.

Example safety limits:

```env
# 0 means unlimited. 30 means no new base batch when 30 batches are open.
MAX_OPEN_BATCHES=30

# If omitted, dokup uses BATCH_QUANTITY. Set this higher for more aggressive average-down buys.
AVERAGE_DOWN_QUANTITY=40

# 0 means unlimited. 6 means at most 6 new base batches per UTC day.
DAILY_BASE_BUY_LIMIT=6

# 0 means disabled. 1 means at least 1 base batch in the last rolling 7 days, even if normal base-buy limits would skip it.
FORCE_BASE_BUY_WEEKLY_LIMIT=1

# 0 means disabled. 25 keeps at least 25 USD available by skipping BUY actions.
MIN_QUOTE_BALANCE=25

# 0 means disabled. 25 halts a run if price moves over 25% since the previous snapshot.
MAX_SUSPICIOUS_PRICE_MOVE_PCT=25
```

`BATCH_QUANTITY` controls new base batches. `AVERAGE_DOWN_QUANTITY` controls buys into existing batches after a price drop; when it is omitted, it defaults to `BATCH_QUANTITY`. `MAX_OPEN_BATCHES` and `DAILY_BASE_BUY_LIMIT` only block normal new `BASE_BUY` actions. `FORCE_BASE_BUY_WEEKLY_LIMIT` has priority over normal base-buy cooldown, daily limit, and max open batch limit, but it looks at the last rolling 7 days instead of resetting every Monday. `MIN_QUOTE_BALANCE` and available quote balance still protect forced buys. `MIN_QUOTE_BALANCE` does not block sells.

Older `STRATEGY=updown` still exists as a simple starting strategy:

- `BUY` when price drops by `BUY_DROP_PCT`,
- `SELL` when price rises by `SELL_RISE_PCT`,
- otherwise `HOLD`.

## Maker Order Mode

The default order mode is still market orders:

```env
ORDER_MODE=market
```

Experimental maker mode can be enabled per env file:

```env
ORDER_MODE=maker
MAKER_BOOK_LEVEL=3
MAKER_POST_ONLY_MODE=SMART_POST_ONLY
MAKER_MAX_SPREAD_PCT=0
MAKER_ORDER_TIMEOUT_MINUTES=0
MAKER_REPRICE_AFTER_MINUTES=0
```

In maker mode, the batch strategy still decides when to buy, average down, or take profit. Before sending the order, the bot reads the public order book and changes the order into a limit maker order:

- BUY uses the Nth bid level,
- SELL uses the Nth ask level,
- `MAKER_BOOK_LEVEL=3` means the third visible price level in the order book,
- `SMART_POST_ONLY` asks Crypto.com to keep the order maker-side when possible,
- `MAKER_MAX_SPREAD_PCT=0` disables the spread guard; a positive value skips maker orders when the bid/ask spread is too wide.
- `MAKER_ORDER_TIMEOUT_MINUTES=0` disables stale-order cancellation; a positive value cancels an old maker order after that many minutes.
- `MAKER_REPRICE_AFTER_MINUTES=0` disables repricing; a positive value cancels an old maker order so the next run can place a fresh order at the current book level.

Being on the third price level does not guarantee third place in the queue. Queue position at the same price depends on who placed an order earlier. It only means the bot chooses the third price level from the order book.

Start maker mode in dry-run first:

```env
DRY_RUN=true
ENABLE_TRADING=false
ORDER_MODE=maker
MAKER_BOOK_LEVEL=3
```

Maker orders can remain open or partially fill. The bot records them in `logs/orders.jsonl` and checks active maker orders on later runs before creating another matching order.

Reports include maker order statistics built from saved order details:

- maker fill rate and cancel rate,
- average, median, and longest time from order creation to fill,
- average time from order creation to cancel,
- breakdown by side and action kind,
- recent maker orders with their final status and wait time.

`node src/bot.js check` prints the loaded instrument rules, including quantity decimals, price decimals, tick sizes, minimum quantity, and minimum notional when Crypto.com returns them.

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

## Price History

Every successful bot run stores a small price-history row in the active `LOG_DIR`:

```text
logs/cro-usd/price-history.jsonl
logs/cro-usd/price-history.csv
logs/btc-usd/price-history.jsonl
logs/btc-usd/price-history.csv
```

This is meant for later backtests and strategy research. The bot writes at most one row per UTC hour per pair, so service restarts do not create duplicate hourly price points.

CSV columns:

```text
at,hour,instrument,price,quote_asset,source
```

Example row:

```text
2026-05-15T22:35:27.116Z,2026-05-15T22,BTC_USD,79039.65,USD,ticker
```

These files are runtime logs. Do not commit real VPS log output to the public repository.

## SQLite Storage

The bot also writes runtime data to SQLite for future web UI work. By default each pair gets its own database inside its private `LOG_DIR`:

```text
logs/cro-usd/bot.sqlite
logs/btc-usd/bot.sqlite
```

The SQLite database contains:

- `snapshots` - one row for each bot run,
- `order_events` - pending, created, filled, cancel and reconcile events,
- `price_history` - one price row per UTC hour and instrument,
- `state` - latest `batches` and `dust_bank` JSON state.

The existing JSON/JSONL/CSV log files are still written as a safety backup and for the current reports. Do not commit SQLite databases to GitHub because they contain private balances and trading history.

To import existing log files into SQLite for the active env file:

```bash
node src/migrate-sqlite.js
```

For multiple pairs:

```bash
ENV_FILE=.env.cro-usd node src/migrate-sqlite.js
ENV_FILE=.env.btc-usd node src/migrate-sqlite.js
```

Set `ENABLE_SQLITE=false` only if you need to temporarily disable SQLite writes while debugging.

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

Reports include open batches, closed batches, recent orders, price chart with buy/sell markers, dust bank, daily summary, fee rows when available, maker order statistics, realized/unrealized P/L, and weighted annualized P/L including sold dust.

Generated reports can contain private balances and trading history. Do not commit them to the public repository.

## Slovak Tax And Accounting Export

Generate tax/accounting CSV files for the active env/log directory:

```bash
node src/taxExport.js
node src/taxExport.js --year=2026
```

For multiple pairs:

```bash
ENV_FILE=.env.cro-usd node src/taxExport.js --year=2026
ENV_FILE=.env.btc-usd node src/taxExport.js --year=2026
```

Generated files go to `reports/`:

- `*-tax-events.csv` - taxable disposal rows from batch sells and dust sells,
- `*-tax-summary.csv` - yearly summary by instrument,
- `*-accounting-ledger.csv` - buy, sell, dust-in and dust-sell ledger rows.

The export is an accounting aid, not legal or tax advice. It uses the bot logs and calculates proceeds, cost basis, realized P/L and an indicative tax base. Review it with an accountant or tax advisor before filing.

## VPS Operations

Useful operational commands:

```bash
node src/health.js .env.cro-usd .env.btc-usd
node src/backup-logs.js
node src/rotate-logs.js
node src/taxExport.js --year=2026
node src/bot.js recover-maker-orders
```

Available npm scripts:

```bash
npm run health
npm run backup:logs
npm run rotate:logs
npm run report
npm run recover:maker
```

`recover-maker-orders` checks active maker orders from the local order ledger against Crypto.com, records fills or terminal statuses, cancels stale active maker orders when the configured timeout says so, and regenerates the report without creating a new planned buy or sell.

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
src/makerOrders.js      Maker limit order helper using public order book levels
src/priceHistory.js     Hourly price history logger for future backtests
src/report.js           HTML and CSV report generator
src/taxExport.js        Slovak tax/accounting CSV export helper
src/health.js           Basic health check for env/log freshness
src/backup-logs.js      Local log backup helper
src/rotate-logs.js      Snapshot log rotation helper
scripts/generate-reports.sh
reports/                Generated local reports, do not commit private output
logs/                   Runtime logs, do not commit
```

## Roadmap Ideas

Planned or possible improvements:

- stronger access protection for any public dashboard deployment,
- safe web controls for whitelisted settings with diff, backup and restart flow,
- safer service controls such as pause/resume/restart after explicit confirmation,
- PostgreSQL option if the SQLite-backed dashboard outgrows local single-VPS operation,
- signed fee/rebate accounting for maker rebates,
- backtests and strategy analysis over stored hourly price history,
- strategy analysis and write-up.

## Disclaimer

This is experimental software for personal learning and automation. It can lose money, fail mid-run, or behave differently from expectations during exchange/API issues. Review the code, use small limits, and monitor it carefully.
