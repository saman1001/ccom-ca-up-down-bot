# NMR price guard and email reporting

`MAX_SUSPICIOUS_PRICE_BLOCK_HOURS` controls how long a price-movement block
lasts. The default is 168 hours (7 days) for NMR_USD and 0 (no expiry) for other pairs.
The existing percentage threshold remains unchanged.

The timer starts at the first blocked run after installation, not at the last
successful snapshot. It persists in `logs/<pair>/price-guard-state.json` across
restarts. After expiry, the next scheduled run may continue even if the price
remains outside the threshold. A new successful snapshot becomes the reference
for subsequent checks. Invalid prices and balances are still rejected.

Watch mode now handles failures on the initial run in the same way as failures
on subsequent scheduled runs, avoiding a systemd restart loop.

## Email fallback

`scripts/nmr-email-fallback.mjs` uses the private `.env.nmr-usd` email settings.
It sends a daily fallback when the normal daily report is missing or has a
logged email failure. Mail delivery has a 60-second timeout. A successful send
is recorded in `email-fallback-state.json`; failed sends are retried on a later
timer run. Old snapshot values are explicitly marked as stale. It does not call
trading APIs or change trading settings.

The deployed reporting-only service runs:

```ini
[Unit]
Description=NMR daily email fallback (reporting only)
After=network-online.target
[Service]
Type=oneshot
WorkingDirectory=/opt/ccom-ca-up-down-bot
ExecStart=/usr/bin/node scripts/nmr-email-fallback.mjs
TimeoutStartSec=90
```

Its `nmr-email-fallback.timer` uses:

```ini
[Unit]
Description=Retry missing NMR daily emails
[Timer]
OnCalendar=*-*-* 01..23:00/15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

The fallback treats a normal report with no logged email error as sent; this
does not prove inbox delivery. A crash between logging and delivery can also
leave that inference incorrect. SMTP acceptance of a fallback likewise does
not prove inbox delivery.

## Local verification without exchange access

```bash
node scripts/test-market-data-safety.mjs
node scripts/test-watch-startup.mjs
node --check scripts/nmr-email-fallback.mjs
```
