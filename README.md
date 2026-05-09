# ccom-ca-up-down-bot

Bezpecny zaklad Crypto.com Exchange bota, ktory vie:

- nacitat cenu vybraneho instrumentu,
- nacitat zostatky cez `private/user-balance`,
- vypocitat orientacnu hodnotu portfolia v quote mene,
- zapisovat snapshoty do `logs/snapshots.jsonl`,
- vytvorit signal `BUY`, `SELL` alebo `HOLD`,
- v predvolenom rezime iba simulovat obchod.

Projekt pouziva Crypto.com Exchange REST API a podpisovanie podla oficialnej dokumentacie. Povodny Crypto.com agent skill sme pouzili ako referenciu pri implementacii autentifikacie a endpointov.

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

Zakladna strategia je jednoducha:

- ak cena klesne o `BUY_DROP_PCT` percent oproti predoslemu snapshotu, signal je `BUY`,
- ak cena stupne o `SELL_RISE_PCT` percent oproti predoslemu snapshotu, signal je `SELL`,
- inak `HOLD`.

Je to len startovacia kostra, nie investicne odporucanie.
