# VPS prevadzka

Tento navod neobsahuje API kluce, secrety, presnu IP adresu ani obsah `.env` suborov.

## Aktualizacia kodu

```bash
cd /opt/ccom-ca-up-down-bot
node src/backup-logs.js
git pull --ff-only
node --check src/bot.js
node --check src/report.js
systemctl restart ccom-updown.service ccom-updown-btc.service
```

## Systemd sluzby

Jeden bot obchoduje jeden par. Kazdy par ma vlastny env subor a vlastny log adresar.

Priklad CRO sluzby:

```ini
[Unit]
Description=Crypto.com CRO up/down batch bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/ccom-ca-up-down-bot
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=ENV_FILE=/opt/ccom-ca-up-down-bot/.env.cro-usd
ExecStart=/usr/bin/node src/bot.js watch
Restart=always
RestartSec=15
User=root

[Install]
WantedBy=multi-user.target
```

Priklad BTC sluzby:

```ini
[Unit]
Description=Crypto.com BTC up/down batch bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/ccom-ca-up-down-bot
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=ENV_FILE=/opt/ccom-ca-up-down-bot/.env.btc-usd
ExecStart=/usr/bin/node src/bot.js watch
Restart=always
RestartSec=15
User=root

[Install]
WantedBy=multi-user.target
```

Po zmene unit suborov:

```bash
systemctl daemon-reload
systemctl enable ccom-updown.service ccom-updown-btc.service
systemctl restart ccom-updown.service ccom-updown-btc.service
```

Stav:

```bash
systemctl status ccom-updown.service --no-pager
systemctl status ccom-updown-btc.service --no-pager
```

Logy:

```bash
journalctl -u ccom-updown.service -f
journalctl -u ccom-updown-btc.service -f
```

## Health-check

Rychla kontrola sluzieb, poslednych snapshotov, dustu a reportov:

```bash
cd /opt/ccom-ca-up-down-bot
node src/health.js .env.cro-usd .env.btc-usd
```

Ak je posledny snapshot starsi nez 90 minut, health-check skonci chybou. Limit sa da zmenit:

```bash
HEALTH_MAX_SNAPSHOT_AGE_MINUTES=130 node src/health.js .env.cro-usd .env.btc-usd
```

## SQLite databaza

Kazdy par ma vlastnu SQLite databazu v privatnom `LOG_DIR`:

```text
logs/cro-usd/bot.sqlite
logs/btc-usd/bot.sqlite
```

Po nasadeni alebo po obnove zo zalohy natiahni existujuce logy do SQLite:

```bash
cd /opt/ccom-ca-up-down-bot
ENV_FILE=.env.cro-usd node src/migrate-sqlite.js
ENV_FILE=.env.btc-usd node src/migrate-sqlite.js
node src/health.js .env.cro-usd .env.btc-usd
```

Databazy patria medzi runtime data. Necommitovat ich do GitHubu.

## Reporty

Reporty sa generuju automaticky po kazdom behu bota. Rucne pregenerovanie vsetkych znamych parov:

```bash
cd /opt/ccom-ca-up-down-bot
bash scripts/generate-reports.sh
```

Alebo jednotlivo:

```bash
ENV_FILE=.env.cro-usd node src/report.js
ENV_FILE=.env.btc-usd node src/report.js
```

Vystupy:

```text
reports/index.html
reports/cro-usd-dashboard.html
reports/btc-usd-dashboard.html
reports/cro-usd-batches.csv
reports/btc-usd-batches.csv
reports/cro-usd-orders.csv
reports/btc-usd-orders.csv
reports/cro-usd-daily.csv
reports/btc-usd-daily.csv
```

## Zaloha logov

Pred kazdou vacsou zmenou:

```bash
cd /opt/ccom-ca-up-down-bot
node src/backup-logs.js
```

Vytvori adresar:

```text
backups/logs-YYYYMMDD-HHMMSS
```

Rucna zaloha cez shell je tiez v poriadku:

```bash
cp -a logs "logs-backup-$(date +%Y%m%d-%H%M%S)"
```

## Rotacia snapshot logov

`snapshots.jsonl` bude casom rast. Kompakcia ponecha poslednych 5000 riadkov a starsie presunie do archivu v rovnakom log adresari:

```bash
cd /opt/ccom-ca-up-down-bot
node src/rotate-logs.js
```

Iny pocet riadkov:

```bash
ROTATE_KEEP_SNAPSHOT_LINES=10000 node src/rotate-logs.js
```

Odporucanie: spustat rucne az po kontrole, ze reporty funguju. Neskor z toho moze byt systemd timer alebo cron.
