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

- [x] Pridat `client_oid` ku kazdemu orderu tak, aby bol deterministicky a pouzitelny pri opakovani po pade.
- [x] Pred odoslanim orderu zapisat pending akciu do `logs/orders.jsonl`.
- [x] Po uspesnom `private/create-order` zapisat `order_id` a stav orderu.
- [x] Pri chybe po odoslani orderu ulozit stav a nepokracovat tak, aby vznikol duplicitny nakup.
- [x] Pri starte bota zosuladit pending ordery cez `private/get-order-detail` alebo trade history.
- [x] Zabranit opakovanemu odoslaniu rovnakej akcie po pade bota.

### Presnost fillov a priemerov

- [x] Nahradit balance-delta vypocet fillu presnym citanim `private/get-order-detail` alebo `private/get-trades`.
- [x] Ukladat k davke `order_id`, priemernu fill cenu, gross quantity, net quantity, fee a fee currency.
- [x] Osetrit partial fill a oneskorene fillnutie orderu.
- [x] Pridat repair/reconcile prikaz, ktory spatne zosuladi `batches.json` s ulozenymi ordermi a `private/get-order-detail`.
- [x] V reportoch oddelit poplatky, dust a cisty zisk podla skutocnych fillov z burzy.
- [ ] Podporit zaporne maker fee / rebate: ukladat fee so znamienkom, v reporte oddelit poplatky a rebate, a zapocitat rebate do P/L, priemerov a danoveho exportu.

### Bezpecnostne poistky

- [x] Pridat maximalny pocet otvorenych davok (`MAX_OPEN_BATCHES`).
- [x] Pridat denny limit novych zakladnych nakupov (`DAILY_BASE_BUY_LIMIT`).
- [x] Pridat vynuteny minimalny pocet zakladnych nakupov za tyzden (`FORCE_BASE_BUY_WEEKLY_LIMIT`).
- [x] Pridat minimalny quote zostatok, pod ktorym bot prestane nakupovat (`MIN_QUOTE_BALANCE`).
- [x] Pridat kontrolu, ze bot neobchoduje, ak burza vracia podozrive alebo neuplne data.
- [x] Pridat validaciu nastaveni pri starte: par, minimalny order, velkost davky, trading/dry-run a log adresar.
- [x] Pridat moznost nastavit inu velkost dokupu nez zakladnej davky (`AVERAGE_DOWN_QUANTITY`).

## Davkova strategia

- [ ] Pridat novy vstupny signal pre otvorenie novej davky podla poklesu ceny alebo volatility.
- [ ] Pridat strategiu, ktora vie menit percenta podla volatility trhu.
- [ ] Pridat backtest hladania vhodnych percent, intervalu a velkosti davky.

## Objednavky

- [x] Pred orderom nacitat pravidla instrumentu z burzy: minimalna velkost orderu, quantity decimals, price decimals a notional limity.
- [x] Formatovat a zaokruhlovat `quantity` podla pravidiel instrumentu, aby `CRO_USD` neposielal desatinne mnozstva ako `19.9`.
- [x] Pri zaokruhlovani predaja evidovat zostatok ako dust, aby sa neskreslil skutocny zisk davky.
- [x] Pridat kontrolu minimalnej velkosti orderu podla instrumentu.
- [x] Logovat nacitane pravidla instrumentu pri starte bota alebo pri `check` prikaze.
- [x] Pridat experimentalny maker limit order rezim namiesto market orderov cez `ORDER_MODE=maker`.
- [x] Pridat fallback: ak sa limit order nevyplni do X minut, zrusit alebo upravit cenu.
- [x] Lepsie pracovat s ciastocnymi fillmi priamo cez order detail a order ledger.
- [ ] Preskumat rozdelenie velkych orderov na viac mensich maker casti, hlavne pri vacsich predajoch, aby jeden velky limit order zbytocne nevisel v order booku.
- [ ] Pridat volitelny taker fallback iba pre SELL ordery po X neuspesnych maker pokusoch, napr. MAKER_SELL_MAX_RETRIES_BEFORE_TAKER=20; pre BUY ordery fallback nepouzivat.

## Reporty a statistiky

- [x] Generovat HTML dashboard zo snapshotov, davok a dust banku.
- [x] Generovat samostatny dashboard pre kazdy par podla aktivneho `ENV_FILE` a `LOG_DIR`.
- [x] Pridat graf nakupov a predajov priamo do cenoveho grafu.
- [x] Pridat realized cash P/L, realized P/L vratane dustu a unrealized P/L.
- [x] Pridat annualized P/L / P/L p.a. vratane predaneho dustu.
- [x] Automaticky generovat HTML dashboard po kazdom behu bota.
- [x] Pridat denny suhrn zisku/straty.
- [x] Pridat export do CSV.
- [x] Pridat statistiku poplatkov z fee/trade dat, ked su dostupne v ulozenych logoch.
- [ ] Pridat signed fee statistiky: kladne fee zobrazovat ako naklad, zaporne maker fee ako rebate/odmenu.
- [x] Pridat priemerny cas drzania davky.
- [x] Pridat prehlad najziskovejsich a najhorsich davok.
- [x] Pridat spolocny index reportov, ktory odkazuje na dashboardy vsetkych parov.
- [x] Pridat maker order statistiky: fill rate, cancel rate, priemerny/median/najdlhsi cas do fillu, cas do cancelu a rozpad podla typu orderu.
- [x] Opravit maker statistiky tak, aby sa pending eventy zoskupovali podla `client_oid` a `NO_FILL`/`CREATED` sa ratalo ako canceled/nevyplnene.
- [x] Prepnout reporty na SQLite-first citanie s fallbackom na povodne JSON/JSONL logy.

## Prevadzka na VPS

- [x] Podpora spustenia viacerych botov cez samostatne env subory.
- [x] Podpora samostatnych log adresarov pre jednotlive pary.
- [x] Pridat presny navod na `systemd` sluzby pre viac parov bez zverejnenia IP adries alebo secretov.
- [x] Pridat navod na aktualizaciu cez `git pull`.
- [x] Pridat navod na zalohu `logs/`.
- [x] Pridat rotaciu logov, aby subory nerastli donekonecna.
- [x] Pridat jednoduchy health-check prikaz.
- [x] Pridat prikaz na rychle pregenerovanie a stiahnutie reportov.
- [x] Pridat SQLite databazu pre kazdy par ako zaklad pre buduce webove UI.
- [x] Pridat migracny prikaz, ktory natiahne existujuce logy do SQLite.
- [x] Zjednotit citanie runtime dat cez spolocnu SQLite/logs vrstvu pre web a reporty.

## Upozornenia

- [x] Pridat notifikaciu pri chybe API.
- [x] Pridat notifikaciu pri predaji davky.
- [x] Pridat denny Telegram alebo email report, ked je nastavene odosielanie.
- [x] Pridat upozornenie pri nizkom quote zostatku.
- [x] Pridat upozornenie, ak bot niekolko intervalov za sebou nevie spravit plan alebo zapisat log.

## Testovanie a simulacie

- [ ] Pridat paper trading rezim oddeleny od realnych API klucov.
- [ ] Pridat backtest na historickych datach.
- [ ] Pridat testy pre vypocet priemernej ceny davky.
- [ ] Pridat testy pre pravidla dokupu a predaja.
- [ ] Pridat testy pre zaokruhlovanie quantity a dust bank.
- [ ] Pridat simulator scenarov: prudky pad, pomaly rast, sideways trh.
- [ ] Pridat porovnavanie strategii a hladanie vhodnych percent pre clanok.

## Dane a uctovnictvo

- [x] Pridat export operacii pre danove a uctovne spracovanie podla slovenskych pravidiel.
- [x] Evidovat nakupy, predaje, poplatky, dust, realizovany zisk/stratu a drzbovu dobu v strukture vhodnej pre uctovnika.
- [x] Pridat rocny danovy report so suhrnmi za kazdy par.
- [x] Pridat upozornenie, ze vystupy su podklad pre kontrolu uctovnikom/danovym poradcom, nie pravne ani danove poradenstvo.
- [ ] Pridat spolocny portfolio tax summary za vsetky pary do jedneho suboru.

## Buduce strategie

- [x] Podpora viacerych parov ako samostatne procesy/sluzby, napr. `BTC_USD`, `ETH_USD`, `CRO_USD`.
- [ ] Preskumat intenzivneho maker-side bota, ktory obchoduje limit ordermi na maker strane order booku s cielom vyhnut sa taker fee.
- [ ] Dynamicke percenta podla volatility.
- [ ] Pauza v obchodovani pri prudkom prepade trhu.
- [ ] Pauza v obchodovani pri prudkom raste.
- [ ] Rebalancing medzi quote menou a base assetom.
- [ ] Optimalizacia strategie nad historickymi datami pre vyskum a clanok.
- [ ] Premysliet swing/grid maker bota, ktory by vedel pracovat s limit ordermi na oboch stranach order booku, napr. kupovat makerom na bid strane a postupne ponukat predaje makerom na ask strane.

## Webove rozhranie

Toto robit postupne a bezpecne: najprv read-only dashboard, potom az po kontrole ochrany pristupu nastavovania a ovladanie bota.

- [x] Pripravit SQLite databazu ako jednoduchy medzikrok medzi JSON logmi a web UI.
- [x] Pridat migraciu existujucich logov do SQLite.
- [x] Pouzivat SQLite ako primarny zdroj dat pre web a reporty v `auto` rezime, s logmi ako fallbackom.
- [x] Pridat jednoduchy private web server viazany defaultne na `127.0.0.1`.
- [x] Pridat jednoduche prihlasovanie cez lokalny `.env.web` bez commitovania hesla.
- [x] Pridat prvu read-only web appku bez Reactu a bez runtime zavislosti.
- [x] Zobrazit oba pary CRO/BTC v spolocnom prehlade.
- [x] Zobrazit aktualne portfolio, zostatky a hodnotu uctu zo snapshotov.
- [x] Zobrazit otvorene a uzavrete davky pre kazdy par samostatne.
- [x] Zobrazit realizovany, nerealizovany a denny P/L.
- [x] Zobrazit annualized P/L / P/L p.a. vratane predaneho dustu v prehlade aj detaile paru.
- [x] Zobrazit posledne ordery a zakladne health upozornenia.
- [x] Pridat realne buy/sell markery do weboveho grafu z batch trade dat.
- [x] Pridat rozsahy grafu `24h`, `3d`, `7d`, `30d`, `year` a `all`.
- [x] Pridat Health / Alerts stranku so stavom systemd sluzieb, last tick, stale maker kontrolou a redigovanymi error-like journal riadkami.
- [x] Pridat read-only nastavenia z whitelistu bez secretov.
- [x] Pridat maker order statistiky vo web UI: filled, canceled, active a other.
- [x] Nasadit web UI tak, aby nebolo verejne otvorene bez ochrany: prva verzia pocita s lokalnym bindom alebo chranenym reverse proxy/SSH/VPN pristupom.
- [x] Pridat druhu ochrannu vrstvu cez reverse-proxy basic auth bez zapisania domeny/IP/hesiel do dokumentacie.
- [x] Pridat favicon a login obrazok bez citlivych udajov.
- [x] Doladit desktop a mobilny dizajn podla dodaneho wireframu.
- [ ] Navrhnut databazovu vrstvu tak, aby sa dala neskor prepnut zo SQLite na PostgreSQL.
- [ ] Pre vacsie web UI/API zvazit PostgreSQL ako cielovu produkcnu databazu.
- [ ] Dorobit bezpecne pridavanie novych obchodnych parov cez web alebo sprievodcu: vytvorit `.env`, log adresar, SQLite migraciu, reporty a systemd sluzbu bez commitovania secretov.
- [x] Pridat export/stiahnutie existujucich HTML/CSV reportov az po kontrole ochrany pristupu.
- [x] Umoznit menit nastavenia strategie cez web UI iba pre whitelist bezpecnych poli.
- [x] Zobrazit nastavenia po jednotlivych paroch a zoradit najcastejsie parametre hore.
- [x] Zobrazit nenastavene/default parametre ako neaktivne a umoznit ich vedome zapnut cez UI.
- [x] Pridat jednovetove vysvetlenia ku kazdemu nastaveniu.
- [x] Pred ulozenim nastaveni zobrazit diff, potvrdenie a vytvorit automaticku zalohu `.env`.
- [x] Pridat risk warnings do Review changes pri koliznych alebo znamych rizikovych nastaveniach.
- [x] Umoznit chranene prepnutie `ORDER_MODE` medzi maker a market/taker rezimom s ochranou pri aktivnych maker orderoch.
- [x] Umoznit bezpecny restart sluzby po zmene nastaveni.
- [x] Pridat service control tlacidla pre start, pause/stop a restart povolenych bot sluzieb.
- [ ] Pridat samostatne tlacidlo alebo flow pre dry-run rezim.
- [ ] Pridat lepsiu spravu pouzivatelov alebo dalsiu ochranu ako Cloudflare Access/VPN/Tailscale, ak bude web pouzivany castejsie alebo viac ludmi.
