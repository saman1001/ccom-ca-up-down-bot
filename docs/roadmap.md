# Roadmapa

## Najblizsie priority

### Spolahlivost obchodov

- [ ] Pridat `client_oid` ku kazdemu orderu
- [ ] Pred odoslanim orderu zapisat pending akciu do `logs/orders.jsonl`
- [ ] Po uspesnom `private/create-order` zapisat `order_id`
- [ ] Pri chybe po odoslani orderu ulozit stav a nepokracovat tak, aby vznikol duplicitny nakup
- [ ] Pri starte bota zosuladit pending ordery cez `private/get-order-detail`
- [ ] Zabranit opakovanemu odoslaniu rovnakej akcie po pade bota

### Presnost fillov a priemerov

- [ ] Nahradit balance-delta vypocet fillu presnym citanim `private/get-order-detail` alebo `private/get-trades`
- [ ] Ukladat k davke `order_id`, priemernu fill cenu, gross quantity, net quantity, fee a fee currency
- [ ] Osetrit partial fill a oneskorene fillnutie orderu
- [ ] Pridat repair/reconcile prikaz, ktory spatne zosuladi `batches.json` s trade history

## Bezpecnostne poistky

- [ ] Pridat maximalny pocet otvorenych davok (`MAX_OPEN_BATCHES`)
- [ ] Pridat denny limit novych zakladnych nakupov (`DAILY_BASE_BUY_LIMIT`)
- [ ] Pridat denny limit nakupov v USD (`DAILY_SPEND_CAP_QUOTE`)
- [ ] Pridat minimalny USD zostatok, pod ktorym bot prestane nakupovat (`MIN_QUOTE_BALANCE`)
- [ ] Pridat ochranu proti prilis castemu nakupovaniu zakladnych davok
- [ ] Pridat kontrolu, ze bot neobchoduje, ak burza vracia podozrive alebo neuplne data

## Davkova strategia

- [ ] Umoznit vlastne percenta pre jednotlive davky
- [ ] Pridat moznost vypnut pravidelny zakladny nakup a obchodovat iba podla signalov
- [ ] Pridat moznost nastavit inu velkost dokupu nez zakladnej davky
- [ ] Pridat maximalny celkovy objem drzaneho CRO
- [ ] Pridat rezim, kde sa nova davka nekupi, ak uz existuje cerstva davka z poslednych X hodin

## Objednavky

- [ ] Pridat limit order rezim namiesto market orderov
- [ ] Pridat fallback: ak sa limit order nevyplni do X minut, zrusit alebo upravit cenu
- [ ] Lepsie pracovat s ciastocnymi fillmi priamo cez order/trade history
- [ ] Pridat kontrolu minimalnej velkosti orderu podla instrumentu

## Reporty a statistiky

- [ ] Automaticky generovat HTML dashboard po kazdom behu bota
- [ ] Pridat denny suhrn zisku/straty
- [ ] Pridat export do CSV
- [ ] Pridat graf nakupov a predajov priamo do cenoveho grafu
- [ ] Pridat statistiku poplatkov
- [ ] Pridat priemerny cas drzania davky
- [ ] Pridat prehlad najziskovejsich a najhorsich davok

## Prevadzka na VPS

- [ ] Pridat navod na `systemd` sluzbu
- [ ] Pridat navod na aktualizaciu cez `git pull`
- [ ] Pridat navod na zalohu `logs/`
- [ ] Pridat rotaciu logov, aby subory nerastli donekonecna
- [ ] Pridat jednoduchy health-check prikaz

## Upozornenia

- [ ] Pridat notifikaciu pri chybe API
- [ ] Pridat notifikaciu pri predaji davky
- [ ] Pridat denny Telegram/e-mail report
- [ ] Pridat upozornenie pri nizkom USD zostatku

## Testovanie a simulacie

- [ ] Pridat paper trading rezim
- [ ] Pridat backtest na historickych datach
- [ ] Pridat testy pre vypocet priemernej ceny davky
- [ ] Pridat testy pre pravidla dokupu a predaja
- [ ] Pridat simulator scenarov: prudky pad, pomaly rast, sideways trh

## Buduce strategie

- [ ] Podpora viacerych parov, napr. `BTC_USD`, `ETH_USD`, `CRO_USD`
- [ ] Dynamicke percenta podla volatility
- [ ] Pauza v obchodovani pri prudkom prepade trhu
- [ ] Pauza v obchodovani pri prudkom raste
- [ ] Rebalancing medzi USD a CRO

## Webove rozhranie

Toto robit az po doplneni spolahliveho order ledgeru, presneho fill reconciliation a zakladnych bezpecnostnych poistiek.

- [ ] Vytvorit lokalnu web stranku/dashboard pre bota
- [ ] Zobrazit aktualne portfolio, USD/CRO zostatky a hodnotu uctu
- [ ] Zobrazit otvorene a uzavrete davky
- [ ] Zobrazit graf ceny, nakupov a predajov
- [ ] Zobrazit realizovany a nerealizovany P/L
- [ ] Zobrazit posledne ordery a API chyby
- [ ] Umoznit menit nastavenia strategie cez web UI
- [ ] Umoznit bezpecny restart sluzby po zmene nastaveni
- [ ] Pridat tlacidla: pozastavit bota, spustit bota, dry-run rezim
- [ ] Pridat jednoduche prihlasovanie alebo aspon obmedzenie pristupu
- [ ] Nasadit web UI tak, aby nebolo verejne otvorene bez ochrany
