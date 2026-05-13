# Roadmapa

## Stav aktualnej verzie

### Hotove

- [x] Davkova strategia pre jeden par: zakladny nakup, dokup davky a predaj davky pri zisku.
- [x] Samostatne davky v `logs/batches.json` s vlastnym mnozstvom, priemerom a historiou nakupov/predajov.
- [x] Limit maximalnej velkosti jednej davky cez `MAX_BATCH_QUANTITY`.
- [x] Ochrana proti extra zakladnemu nakupu po restarte cez `BASE_BUY_COOLDOWN_MINUTES`.
- [x] Nacitanie pravidiel instrumentu z burzy cez `public/get-instruments`.
- [x] Formatovanie a zaokruhlovanie `quantity` podla pravidiel instrumentu.
- [x] Kontrola minimalnej velkosti orderu podla instrumentu.
- [x] Dust bank pre zostatky po zaokruhleni predaja.
- [x] HTML dashboard a statistiky z logov.
- [x] Cenovy graf s vyznacenymi nakupmi a predajmi.
- [x] Realized cash P/L, realized P/L vratane dustu a unrealized P/L.
- [x] Samostatne logy pre kazdy par cez `LOG_DIR`.
- [x] Samostatne env subory pre kazdeho bota cez `ENV_FILE`.
- [x] Podpora viacerych parov ako viac samostatnych procesov alebo `systemd` sluzieb.
- [x] Samostatny dashboard subor pre kazdy instrument, napr. `cro-usd-dashboard.html` a `btc-usd-dashboard.html`.
- [x] Zakladna dokumentacia multi-bot setupu v `README.md`.

## Najblizsie priority

### Spolahlivost obchodov

- [ ] Pridat `client_oid` ku kazdemu orderu tak, aby bol deterministicky a pouzitelny pri opakovani po pade.
- [ ] Pred odoslanim orderu zapisat pending akciu do `logs/orders.jsonl`.
- [ ] Po uspesnom `private/create-order` zapisat `order_id` a stav orderu.
- [ ] Pri chybe po odoslani orderu ulozit stav a nepokracovat tak, aby vznikol duplicitny nakup.
- [ ] Pri starte bota zosuladit pending ordery cez `private/get-order-detail` alebo trade history.
- [ ] Zabranit opakovanemu odoslaniu rovnakej akcie po pade bota.

### Presnost fillov a priemerov

- [ ] Nahradit balance-delta vypocet fillu presnym citanim `private/get-order-detail` alebo `private/get-trades`.
- [ ] Ukladat k davke `order_id`, priemernu fill cenu, gross quantity, net quantity, fee a fee currency.
- [ ] Osetrit partial fill a oneskorene fillnutie orderu.
- [ ] Pridat repair/reconcile prikaz, ktory spatne zosuladi `batches.json` s trade history.
- [ ] V reportoch oddelit poplatky, dust a cisty zisk podla skutocnych fillov z burzy.

### Bezpecnostne poistky

- [ ] Pridat maximalny pocet otvorenych davok (`MAX_OPEN_BATCHES`).
- [ ] Pridat denny limit novych zakladnych nakupov (`DAILY_BASE_BUY_LIMIT`).
- [ ] Pridat denny limit nakupov v quote mene (`DAILY_SPEND_CAP_QUOTE`).
- [ ] Pridat minimalny quote zostatok, pod ktorym bot prestane nakupovat (`MIN_QUOTE_BALANCE`).
- [ ] Pridat maximalny celkovy objem drzaneho base assetu (`MAX_BASE_EXPOSURE`).
- [ ] Pridat kontrolu, ze bot neobchoduje, ak burza vracia podozrive alebo neuplne data.
- [ ] Pridat validaciu nastaveni pri starte: par, minimalny order, velkost davky, trading/dry-run a log adresar.

## Davkova strategia

- [ ] Umoznit vlastne percenta pre jednotlive davky.
- [ ] Pridat moznost vypnut pravidelny zakladny nakup a obchodovat iba podla signalov.
- [ ] Pridat moznost nastavit inu velkost dokupu nez zakladnej davky.
- [ ] Pridat rezim, kde sa nova davka nekupi, ak uz existuje cerstva davka z poslednych X hodin.
- [ ] Pridat strategiu, ktora vie menit percenta podla volatility trhu.
- [ ] Pridat backtest hladania vhodnych percent, intervalu a velkosti davky.

## Objednavky

- [x] Pred orderom nacitat pravidla instrumentu z burzy: minimalna velkost orderu, quantity decimals, price decimals a notional limity.
- [x] Formatovat a zaokruhlovat `quantity` podla pravidiel instrumentu, aby `CRO_USD` neposielal desatinne mnozstva ako `19.9`.
- [x] Pri zaokruhlovani predaja evidovat zostatok ako dust, aby sa neskreslil skutocny zisk davky.
- [x] Pridat kontrolu minimalnej velkosti orderu podla instrumentu.
- [ ] Logovat nacitane pravidla instrumentu pri starte bota alebo pri `check` prikaze.
- [ ] Pridat limit order rezim namiesto market orderov.
- [ ] Pridat fallback: ak sa limit order nevyplni do X minut, zrusit alebo upravit cenu.
- [ ] Lepsie pracovat s ciastocnymi fillmi priamo cez order/trade history.

## Reporty a statistiky

- [x] Generovat HTML dashboard zo snapshotov, davok a dust banku.
- [x] Generovat samostatny dashboard pre kazdy par podla aktivneho `ENV_FILE` a `LOG_DIR`.
- [x] Pridat graf nakupov a predajov priamo do cenoveho grafu.
- [x] Pridat realized cash P/L, realized P/L vratane dustu a unrealized P/L.
- [x] Automaticky generovat HTML dashboard po kazdom behu bota.
- [x] Pridat denny suhrn zisku/straty.
- [x] Pridat export do CSV.
- [x] Pridat statistiku poplatkov z fee/trade dat, ked su dostupne v ulozenych logoch.
- [x] Pridat priemerny cas drzania davky.
- [x] Pridat prehlad najziskovejsich a najhorsich davok.
- [x] Pridat spolocny index reportov, ktory odkazuje na dashboardy vsetkych parov.

## Prevadzka na VPS

- [x] Podpora spustenia viacerych botov cez samostatne env subory.
- [x] Podpora samostatnych log adresarov pre jednotlive pary.
- [ ] Pridat presny navod na `systemd` sluzby pre viac parov bez zverejnenia IP adries alebo secretov.
- [ ] Pridat navod na aktualizaciu cez `git pull`.
- [ ] Pridat navod na zalohu `logs/`.
- [ ] Pridat rotaciu logov, aby subory nerastli donekonecna.
- [ ] Pridat jednoduchy health-check prikaz.
- [ ] Pridat prikaz na rychle pregenerovanie a stiahnutie reportov.

## Upozornenia

- [ ] Pridat notifikaciu pri chybe API.
- [ ] Pridat notifikaciu pri predaji davky.
- [ ] Pridat denny Telegram/e-mail report.
- [ ] Pridat upozornenie pri nizkom quote zostatku.
- [ ] Pridat upozornenie, ak bot niekolko intervalov za sebou nevie spravit plan alebo zapisat log.

## Testovanie a simulacie

- [ ] Pridat paper trading rezim oddeleny od realnych API klucov.
- [ ] Pridat backtest na historickych datach.
- [ ] Pridat testy pre vypocet priemernej ceny davky.
- [ ] Pridat testy pre pravidla dokupu a predaja.
- [ ] Pridat testy pre zaokruhlovanie quantity a dust bank.
- [ ] Pridat simulator scenarov: prudky pad, pomaly rast, sideways trh.
- [ ] Pridat porovnavanie strategii a hladanie vhodnych percent pre clanok.

## Buduce strategie

- [x] Podpora viacerych parov ako samostatne procesy/sluzby, napr. `BTC_USD`, `ETH_USD`, `CRO_USD`.
- [ ] Preskumat intenzivneho maker-side bota, ktory obchoduje limit ordermi na maker strane order booku s cielom vyhnut sa taker fee.
- [ ] Dynamicke percenta podla volatility.
- [ ] Pauza v obchodovani pri prudkom prepade trhu.
- [ ] Pauza v obchodovani pri prudkom raste.
- [ ] Rebalancing medzi quote menou a base assetom.
- [ ] Optimalizacia strategie nad historickymi datami pre vyskum a clanok.

## Webove rozhranie

Toto robit az po doplneni spolahliveho order ledgeru, presneho fill reconciliation a zakladnych bezpecnostnych poistiek.

- [ ] Vytvorit lokalnu web stranku/dashboard pre bota.
- [ ] Zobrazit aktualne portfolio, zostatky a hodnotu uctu.
- [ ] Zobrazit otvorene a uzavrete davky pre kazdy par samostatne.
- [ ] Zobrazit graf ceny, nakupov a predajov.
- [ ] Zobrazit realizovany a nerealizovany P/L.
- [ ] Zobrazit posledne ordery a API chyby.
- [ ] Umoznit menit nastavenia strategie cez web UI.
- [ ] Umoznit bezpecny restart sluzby po zmene nastaveni.
- [ ] Pridat tlacidla: pozastavit bota, spustit bota, dry-run rezim.
- [ ] Pridat jednoduche prihlasovanie alebo aspon obmedzenie pristupu.
- [ ] Nasadit web UI tak, aby nebolo verejne otvorene bez ochrany.
