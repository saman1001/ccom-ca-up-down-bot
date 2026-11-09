# ccom-ca-up-down-bot — pravidlá projektu

Platia globálne pokyny používateľa. Tento súbor obsahuje iba miestne doplnenia spoločné pre Claude Code aj Codex.

## Začiatok práce

Prečítaj INDEX.md, SPEC.md a CURRENT.md. Checklist je v ROADMAP.md. Pri rozpore platí SPEC.md → ROADMAP.md → CURRENT.md → testy → kód. Rozpor nahlás, nemeníš dohodu podľa implementácie.

## Rozsah a bezpečnosť

- Ide o existujúci bot schopný reálne obchodovať. Lokálna dokumentácia, test alebo úprava kódu nie sú povolením na obchod.
- Bez konkrétneho pokynu nemeň stratégiu, obchodné prepínače, parametre párov, ledger, databázy ani služby.
- Testy spúšťaj izolovane bez reálneho API a bez odosielania správ. Príkazy once, watch, reconcile a recover:maker nie sú testy.
- Tajomstvá nikdy nevypisuj. Súkromné konfigurácie, logy, reporty, zálohy, interné dokumenty a _legacy nesmú ísť do verejného repozitára.
- Aktívny kód je v koreni tohto repozitára. _legacy je zachovaný historický materiál, nie zdroj na automatické prepísanie aktuálneho kódu.
- Nevymýšľaj nové funkcie pri oprave alebo organizačnej zmene. Nápady patria do ROADMAP.md.
- Necommituj, nepushuj a nenasadzuj bez pokynu používateľa.
- Deploy iba projektovým skriptom. scripts/deploy-email-fallback.mjs pokrýva iba záložný e-mail, nie celý bot. Ostatné SSH zásahy sa riadia globálnym pravidlom VPS.
- Pri presune alebo mazaní rešpektuj výslovné zadanie používateľa. Prevádzkové dáta zachovaj.
- Dokumentačné zmeny nesmú zapnúť tracking, nový externý servis ani AI API.

## Overenie

Pri zmene príslušnej oblasti spusti existujúce testy v scripts/test-*.mjs. Pre e-mail stačí test-email-fallback.mjs a kontrola syntaxe. Pri presune celého projektu over všetky existujúce offline testy a Git stav. Neopakuj produkčné obchodné behy ako smoke test.

## Dokumentácia

SPEC.md je dohoda, CURRENT.md prevádzková navigácia, ROADMAP.md verejný checklist a README.md verejný návod. INDEX.md prepája projekt s mozgami. Interné súbory zostávajú ignorované Gitom. Pri väčšom dokončenom celku skontroluj aktuálnosť dokumentácie a v zápisoch do mozgov označ zmeny Codexu značkou „(Codex)“.
