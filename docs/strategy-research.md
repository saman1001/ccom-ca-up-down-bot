# Vyskumne poznamky: hladanie optimalnej strategie

Cielom je najst rozumne parametre davkovej CRO strategie. Nejde o dokaz zarobku ani financne odporucanie, ale o prakticky experiment s automatizovanou DCA/grid logikou, poplatkami, rizikom a kapitalovou narocnostou.

## Zakladna otazka

Ake nastavenie intervalu, dokupu a predaja dava najlepsi pomer medzi:

- realizovanym ziskom,
- maximalnym drawdownom,
- viazanym kapitalom,
- poctom obchodov,
- zaplatenymi poplatkami,
- rizikom dlhodobeho drzania otvorenych davok?

## Premenne strategie

- `CHECK_INTERVAL_MINUTES` - ako casto bot vyhodnocuje trh
- `BATCH_QUANTITY` - velkost novej davky
- `AVERAGE_DOWN_DROP_PCT` - pokles pod priemer davky, pri ktorom bot dokupi
- `TAKE_PROFIT_RISE_PCT` - rast nad priemer davky, pri ktorom bot davku preda
- `MAX_BATCH_QUANTITY` - maximalna velkost jednej davky
- `MAX_OPEN_BATCHES` - maximalny pocet otvorenych davok (todo)
- `MIN_QUOTE_BALANCE` - minimalna hotovostna rezerva (todo)
- `DAILY_SPEND_CAP_QUOTE` - denny limit nakupov v quote mene (todo)

## Hypotezy

1. Prilis male take-profit percento bude po zapocitani taker fee a spreadu stratove alebo len nulove.
2. Drop threshold by mal byt vacsi ako take-profit threshold, aby sa nepriemerovalo prilis casto.
3. Pri nizkej volatilite bude strategia hlavne akumulovat davky a malo predavat.
4. Pri prudkom pade bude strategia rychlo zvacsovat expoziciu, preto je potrebny limit na davku a/alebo celkovu expoziciu.
5. Limit order rezim moze znizit fee, ale prida riziko nevyplnenych orderov.

## Metriky

- celkova hodnota portfolia v USD
- realizovany P/L
- nerealizovany P/L
- celkove zaplatene poplatky
- pocet otvorenych davok
- pocet uzavretych davok
- priemerny cas drzania davky
- maximalny pocet otvorenych davok naraz
- maximalny drawdown portfolia
- viazany kapital v CRO
- pocet obchodov za den
- priemerny zisk na uzavretu davku

## Data

Live data sa ukladaju do:

```text
logs/snapshots.jsonl
logs/batches.json
```

Pre serioznejsie vyhodnotenie bude treba pridat:

- export do CSV,
- historicke sviecky z Crypto.com API,
- trade history reconciliation,
- presne poplatky a filly cez `private/get-trades` alebo `private/get-order-detail`.

## Backtest plan

1. Stiahnut historicke sviecky pre `CRO_USD`.
2. Simulovat davkovu strategiu pre viacero kombinacii parametrov.
3. Zohladnit taker fee, pripadne aj spread/slippage.
4. Vyhodnotit metriky pre kazdu kombinaciu.
5. Vytvorit heatmapy:
   - drop threshold vs take-profit threshold,
   - interval vs drawdown,
   - batch size vs viazany kapital.
6. Vybrat nastavenia, ktore maju rozumny kompromis medzi vynosom a rizikom.

## Kandidatske nastavenia na porovnanie

| Interval | Drop % | Take profit % | Poznamka |
|---:|---:|---:|---|
| 60 min | 7 | 3 | konzervativnejsi dokup, rychlejsi exit |
| 60 min | 5 | 3 | stredna varianta |
| 60 min | 3 | 2 | aktivnejsia varianta |
| 30 min | 3 | 2 | castejsie vstupy |
| 1440 min | 7 | 5 | denny rezim |

## Rizika

- market ordery su takmer vzdy taker, teda vyssie fee,
- prilis caste nakupy v sideway trhu mozu vytvorit vela otvorenych davok,
- pri dlhom poklese moze strategia viazat vela kapitalu,
- pri chybach API treba mat idempotentny order ledger,
- pri nepresnom fill vypocte sa mozu pokazit priemerne ceny davok.

## Namet na clanok

Pracovny nazov:

```text
Automatizovana davkova strategia na kryptoburze: experiment s DCA, grid logikou a poplatkami
```

Mozna struktura clanku:

1. Motivacia a ciel experimentu
2. Popis strategie
3. Technicka implementacia bota
4. Poplatky, spread a preco na nich zalezi
5. Simulacia a backtest
6. Live experiment na malom kapitali
7. Rizika a limity
8. Poucenia a dalsie kroky

## Otvorene otazky

- Je lepsie pouzivat market alebo limit ordery?
- Ma byt drop threshold vzdy vacsi ako take-profit threshold?
- Ako dynamicky upravit percenta podla volatility?
- Kedy zastavit pravidelny nakup novych davok?
- Ako najlepsie merat riziko pri vela otvorenych davkach?
- Da sa strategia formulovat ako optimalizacny problem?
