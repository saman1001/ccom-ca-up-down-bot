# ccom-ca-up-down-bot

Bezpecny zaklad Crypto.com Exchange bota, ktory vie:

- nacitat cenu vybraneho instrumentu,
- nacitat zostatky cez `private/user-balance`,
- vypocitat orientacnu hodnotu portfolia v quote mene,
- zapisovat snapshoty do `logs/snapshots.jsonl`,
- vytvorit signal `BUY`, `SELL` alebo `HOLD`,
- viest samostatne davky v `logs/batches.json`,
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
- novy zakladny nakup sa nevykona, ak posledny `BASE_BUY` je mladsi nez `BASE_BUY_COOLDOWN_MINUTES`,
- ak aktualna cena stupne aspon o `TAKE_PROFIT_RISE_PCT` nad priemer otvorenej davky, preda celu davku,
- pred predajom bot zaokruhli mnozstvo podla pravidiel instrumentu z burzy, aby neposielal neplatne quantity,
- zostatok po zaokruhleni predaja ide do `logs/dust-bank.json`; ked dust dosiahne `DUST_SELL_QUANTITY`, bot ho vie predat samostatne,
- kazda davka si drzi vlastne mnozstvo, priemer a historiu nakupov/predajov.

Starsia `STRATEGY=updown` strategia je jednoducha:

- ak cena klesne o `BUY_DROP_PCT` percent oproti predoslemu snapshotu, signal je `BUY`,
- ak cena stupne o `SELL_RISE_PCT` percent oproti predoslemu snapshotu, signal je `SELL`,
- inak `HOLD`.

Je to len startovacia kostra, nie investicne odporucanie.
