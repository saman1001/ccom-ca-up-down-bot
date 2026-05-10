# ccom-ca-up-down-bot

Bezpecny zaklad Crypto.com Exchange bota, ktory vie:

- nacitat cenu vybraneho instrumentu,
- nacitat zostatky cez `private/user-balance`,
- vypocitat orientacnu hodnotu portfolia v quote mene,
- zapisovat snapshoty do `logs/snapshots.jsonl`,
- vytvorit signal `BUY`, `SELL` alebo `HOLD`,
- viest samostatne davky v `logs/batches.json`,
- generovat HTML dashboard/statistiky do `reports/dashboard.html`,
- v predvolenom rezime iba simulovat obchod.

Crypto.com agent skill je ulozeny v `crypto-com-exchange-skill/`. Tento projekt z neho pouziva autentifikacny postup a endpointy, ale samotny bot je samostatny Node.js skript.

## Prvy beh

1. Skopiruj `.env.example` na `.env`.
2. Dopln `CCOM_API_KEY` a `CCOM_API_SECRET`.
3. Na zaciatok pouzi API key bez withdrawals a idealne iba read-only.
4. Spusti kontrolu:

```powershell
node src/bot.js once
```

Pravidelny beh kazdu hodinu:

```powershell
node src/bot.js watch
```

Ak mas dostupne aj `npm`, mozes pouzit aj:

```powershell
npm run once
npm run watch
```

## VPS a IPv4

Na VPS s IPv6 treba pri Crypto.com IP whiteliste vynutit IPv4. Inak moze Node odoslat request cez IPv6 a burza odmietne private API request, aj ked je IPv4 adresa vo whiteliste.

Jednorazove spustenie:

```bash
NODE_OPTIONS=--dns-result-order=ipv4first node src/bot.js once
```

Watch rezim:

```bash
NODE_OPTIONS=--dns-result-order=ipv4first node src/bot.js watch
```

V `systemd` service pridaj:

```ini
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
```

Do Crypto.com whitelistu pridaj verejnu IPv4 adresu VPS. Konkretne IP adresy neukladaj do verejneho repozitara.

## Dashboard a statistiky

Zo suborov `logs/batches.json` a `logs/snapshots.jsonl` sa da vygenerovat staticky HTML dashboard:

```powershell
node src/report.js
```

alebo:

```powershell
npm run report
```

Vystup:

```text
reports/dashboard.html
```

Dashboard ukazuje aktualne portfolio, otvorene davky, priemernu cenu, realizovany a nerealizovany P/L, graf ceny/portfolia, posledne ordery a tabulku davok.

## Obchodovanie

Predvolene je realne obchodovanie vypnute:

```env
DRY_RUN=true
ENABLE_TRADING=false
```

Realne objednavky sa odoslu iba ked nastavis:

```env
DRY_RUN=false
ENABLE_TRADING=true
```

Odporucany postup je:

1. read-only monitoring,
2. dry-run signaly aspon par dni,
3. male limity,
4. az potom trading API key bez withdrawals.

## Strategia

Nastavenie `STRATEGY=batches` robi davkovu strategiu:

- kazdy beh kupi zakladnu davku `BATCH_QUANTITY`, predvolene `20 CRO`,
- ak aktualna cena klesne aspon o `AVERAGE_DOWN_DROP_PCT` pod priemer otvorenej davky, dokupi do tej davky dalsich `20 CRO`,
- jedna davka sa dokupuje najviac do `MAX_BATCH_QUANTITY`, predvolene `500 CRO`; potom uz len caka na predaj,
- ak aktualna cena stupne aspon o `TAKE_PROFIT_RISE_PCT` nad priemer otvorenej davky, preda celu davku,
- kazda davka si drzi vlastne mnozstvo, priemer a historiu nakupov/predajov.

Starsia `STRATEGY=updown` strategia je jednoducha:

- ak cena klesne o `BUY_DROP_PCT` percent oproti predoslemu snapshotu, signal je `BUY`,
- ak cena stupne o `SELL_RISE_PCT` percent oproti predoslemu snapshotu, signal je `SELL`,
- inak `HOLD`.

Je to len startovacia kostra, nie investicne odporucanie.
