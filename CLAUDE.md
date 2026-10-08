# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dauerregeln

- **Vor neuen Funktionen prüfen, ob es sie schon gibt.** Vorhandene Helper erweitern statt duplizieren — z. B. `db._account_filter()` für jede Abfrage über Trades, `withFilter()` im Frontend für jede datenladende URL, `_read_upload()` für jeden Upload.
- **Keine mehrfachen Iterationen über dieselben Daten.** Einmal laden, einmal durchlaufen, in einem Rutsch aggregieren. Kein Query pro Tag, wenn ein Range-Query reicht; keine zweite Schleife für eine Kennzahl, die schon mit abfällt.
- Kommentare auf Deutsch, ohne Umlaute (bestehende Konvention). UI und Nutzerkommunikation auf Deutsch mit Umlauten.

## Ordnerstruktur

Der Hauptordner zeigt bewusst nur `start.bat` (plus Nutzerdaten). Der komplette Code liegt in `app_core/` und wird bei Updates ersetzt:

```
trade-journal/
├── start.bat          <- duenner, kaum aenderbarer Einstiegspunkt
├── data/, config.json <- Nutzerdaten, siehe unten
├── github_token.txt   <- optional, nur falls das Release-Repo mal privat wird
└── app_core/          <- kompletter Code, wird bei Updates ersetzt
    ├── app/, static/, run.py, requirements.txt, VERSION, CHANGELOG.md
    ├── ninjascript/       <- NinjaScript-AddOn fuer NinjaTrader-Auto-Sync, siehe unten
    ├── update_check.ps1   <- Versionscheck beim Start, siehe "Release"
    └── README.md, README_DEV.md, build_release.ps1, dev_reset.*, update.bat
```

`CLAUDE.md` und `.git`/`.gitignore` bleiben bewusst am Projekt-Root (Claude Code und Git suchen dort danach).

## Betrieb

```bash
cd app_core
python -m pip install -r requirements.txt
python run.py     # startet auf 127.0.0.1:8420 und oeffnet den Browser
```

- **Kein Auto-Reload:** nach Änderungen an `app_core/app/*.py` Server neu starten. `app_core/static/`-Änderungen brauchen nur einen Browser-Reload.
- Hängt ein alter Prozess auf dem Port: `netstat -ano | findstr :8420`, dann gezielt `taskkill /F /PID <pid>`. Nicht `taskkill /IM python.exe` — das killt jeden Python-Prozess auf dem Rechner.
- **Tests:** `cd app_core && python -m unittest discover -s tests -t .` — nur Standardbibliothek, laufen gegen eine Temp-Datenbank (`tests/helpers.temp_db()`), nie gegen `data/trades.db`. Endpunkte ruft `helpers.call()` direkt per ASGI auf (Starlettes `TestClient` braeuchte `httpx`). `tests/` gehoert nicht ins `update.zip`. Oberflaeche weiterhin gegen den laufenden Server pruefen, z. B. `curl -s "http://127.0.0.1:8420/api/days" | python -m json.tool`.
- **Nur lokale Anfragen:** `LocalOnlyMiddleware` in `main.py` lehnt fremde `Host`-Header (DNS-Rebinding) und schreibende Anfragen fremder Seiten (`Origin`/`Sec-Fetch-Site`, CSRF) mit 403 ab. `curl` gegen schreibende Endpunkte braucht deshalb nichts Besonderes (kein Origin), ein Browser-Aufruf von einer anderen Seite schon.

## Code vs. Nutzerdaten

| Code — wird bei Updates überschrieben | Nutzerdaten — niemals anfassen |
|---|---|
| alles unter `app_core/` | `data/`, `config.json`, `github_token.txt` |

`start.bat` wird bewusst NIE von einem Update überschrieben (eine laufende .bat-Datei sollte sich nicht selbst ersetzen) — nur `app_core/` wird beim Update ersetzt. Diese Grenze nicht aufweichen: keine generierten Code-Artefakte nach `data/`, keine Nutzerdaten außerhalb davon.

`trades.db` enthält Broker-Passwörter im Klartext — bewusst akzeptiert für den rein lokalen Betrieb, und der Grund, warum `data/` in `.gitignore` steht.

## Migrationen: append-only

`db.MIGRATIONS` wird über `PRAGMA user_version` getrackt — **der Listenindex ist die Versionsnummer**. Einträge nie ändern, umsortieren oder löschen: bereits aktualisierte Nutzer-Datenbanken stünden sonst mit falscher Version da und bekämen Migrationen doppelt oder gar nicht. Nur hinten anhängen.

Indizes auf Spalten, die eine Migration erst anlegt, gehören ebenfalls nur in die Migrationen, nicht ins `SCHEMA` — `SCHEMA` läuft vor den Migrationen, bei einer bestehenden Datenbank fehlt die Spalte dort noch (Beispiel: `idx_trades_strategy` brach so den Start ab).

## Konten- und Quellen-Modell

Zwei Achsen, die leicht verwechselt werden:

- **`platform`** — technische Anbindung (`mt5`, `ninjatrader`)
- **Konto** — Zeile in `broker_accounts`; mehrere Konten können dieselbe Plattform nutzen (z. B. zwei getrennte NinjaTrader-Konten)

Trades tragen beides: `source` (Herkunft der Daten) und `account_id` (Zuordnung). Der Filter reicht `?accounts=2,5,csv` durch alle Auswertungs-Endpoints — Konto-IDs plus den Magic String **`"csv"` für `account_id IS NULL`** (nicht zugeordnet).

**NinjaTrader-Auto-Sync** ist optional und laeuft anders als MT5, weil NinjaTrader kein Broker-Login per API kennt: die NinjaScript-AddOn `ninjascript/TradeJournalSync.cs` haengt bei jedem Fill eine Zeile im Executions-Export-Format an eine feste Datei an; `brokers/ninjatrader_adapter.py` liest sie mit dem bestehenden `parser.py` ein, gefiltert auf den in `broker_accounts.login` hinterlegten NinjaTrader-Kontonamen. Ohne hinterlegten `sync_path` bleibt ein NinjaTrader-Konto wie bisher rein manuell (CSV-Import). `MANUAL_PLATFORMS` in `brokers/__init__.py` steuert nur die Formularfelder (kein Login/Passwort/Server-Feld), nicht mehr ob automatisch gesynct wird — das entscheidet `sync_account()` pro Konto anhand `sync_path`.

**Start-Sync laeuft im Hintergrund** (`_startup_tasks` in `main.py`): taegliches Backup, Konten-Sync, News-/Gewichtungs-/Earnings-Abgleich. Der Server nimmt sofort Anfragen an; `GET /api/startup-status` meldet den Fortschritt, `watchStartupSync()` (accounts.js) zeigt ihn in der Sidebar und laedt die Ansicht neu, wenn neue Trades kamen. Weil Start-Sync und „Jetzt synchronisieren“ dadurch gleichzeitig laufen koennen, serialisiert `_SYNC_LOCK` alle Syncs (das MetaTrader5-Paket ist nicht threadsicher).

**MT5-Sync fasst ein offenes Terminal nicht an:** Laeuft `terminal64.exe` schon, haengt sich der Sync ohne Zugangsdaten an und synct nur, wenn dort genau dieses Konto offen ist — `initialize(login=...)` wuerde das Handelsterminal des Nutzers umschalten. Beendet werden nur Terminals, die der Sync selbst gestartet hat (PID-Vergleich vorher/nachher), nie per `taskkill /IM`. MT5-Trade-Schluessel enthalten den Login (`mt5:<login>:<position>:<ticket>`), weil Positions-IDs nur je Broker-Server eindeutig sind; `db._legacy_mt5_key()` erkennt alte Fingerprints in `deleted_trade_keys` weiterhin.

**Datensicherung** (`app/backup.py`): einmal pro Kalendertag beim Start plus Knopf in den Einstellungen; `trades.db` per SQLite-Backup-API und `data/images` inkrementell, die letzten 14 Staende. Standardziel `data/backups/daily`, ein eigener Ordner steht in `app_settings.backup_dir` — dort werden die Broker-Passwoerter in der Kopie geleert (Cloud-Ordner). `trades_pre_update_*` in `data/backups` bleiben die separaten Migrations-Backups.

**Prop-Firm-Limits** (`daily_loss_limit`, `max_loss_limit` in `broker_accounts`, in $): `stats.prop_limit_status()` rechnet nach FTMO-Muster auf Basis geschlossener Trades — Tagesverlust gegen heute, Gesamtverlust als Abstand unter das Startkapital (statisch, kein Trailing Drawdown).

**Konto löschen archiviert nur** (`db.delete_account()` setzt `archived = 1`, kein `DELETE`): Trades behalten ihre `account_id` unveraendert, damit sie weiter ihrem (ehemaligen) Konto zuordenbar bleiben, statt ununterscheidbar im "csv"/"Nicht zugeordnet"-Sammeltopf zu verschwinden (fruehere Version nullte `account_id` beim Loeschen - siehe Nutzer-Feedback, das ging verloren). `list_accounts()` filtert archivierte Konten standardmaessig raus (Verwaltung, Sync, Neuanlage-Dropdowns sehen sie nicht mehr), `list_account_options()` nimmt sie bewusst *mit* auf und haengt `" (gelöscht)"` an den Namen an, damit Filter/Übersicht/Share-Karte sie weiter anzeigen und danach filtern können.

**Geloeschte Trades bleiben geloescht:** `db.delete_trade()` merkt sich den (entry_order_id, exit_order_id)-Fingerprint in `deleted_trade_keys`, weil die geloeschte Zeile die UNIQUE-Bremse gegen erneutes Einfuegen mitgeloescht hat. „Jetzt synchronisieren" (`insert_trades(..., skip_deleted=True)`) ueberspringt diese Fingerprints, „Vollstaendig neu synchronisieren" (`full=True`) bewusst nicht — nur dort soll ein versehentlich geloeschter Trade wiederkommen koennen.

## OneNote-Aufbau (Startansicht)

Die App ist wie das OneNote-Tagebuch des Nutzers aufgebaut: Sidebar = Abschnitte (Tagebuch-Monate je Jahr, Notizbuch-Ordner), Mitte = Seitenliste, rechts = Seite. Die bisherigen Ansichten liegen darunter als „Werkzeuge“. Start ist die heutige Tagesseite (bzw. die Seite aus dem Hash `#tag/2026-10-08`, `#kw/2026-W41`, `#monat/…`, `#review/…`, `#notiz/<id>`, `#abschnitt/<id>`). Code: `static/js/pages.js`, `app/diary.py`.

- **Eine KW gehoert zum Monat ihres Donnerstags** (ISO-Regel, so steht es auch im OneNote des Nutzers: KW 40/2026 mit 28.-30.09. unter Oktober). Gilt in `diary.build_month()`, in `db._DIARY_MONTH_SQL` (Abschnittssummen) und in `monthForDay()` im Frontend — alle drei muessen gleich rechnen, sonst zeigt der Abschnitt eine andere Summe als seine Seitenliste.
- **Abschnitte (Monate) der Sidebar** = Grundbereich (erster Trade/Eintrag bis laufender Monat) plus `app_settings.diary_months_extra` („+ Monat“/„+ Jahr“) minus `diary_months_hidden` (geloeschte). Geloeschte Monate muessen gemerkt werden, sonst brächte der Grundbereich sie zurueck. Monat/Jahr loeschen entfernt nur die Journal-Eintraege (Tage per Donnerstag-Regel, KWs, Monatsziel, Review), **nie Trades**; „+“ macht ihn wieder sichtbar.
- **Seitentitel** („-1R (0R)“, „Kein Trade – NFP“) steht in `journal_entries.title`; der Editor sendet ihn mit (`opts.titleInput`). Ergebnis, News-Label und Monatssumme rechnet die Liste selbst, $ / R / Pkt umschaltbar. R nur aus Trades mit `risk_usd`, ein `*` markiert unvollstaendige R-Werte.
- **Seitenarten** = `entry_type` `day`, `week` (`2026-W40`), `month` (Monatsziel, `2026-10`), `review` (`2026-10`). `_check_journal_ref` prueft die Formate.
- **Standardvorlagen** (`journal_templates.default_for`): eine leere Seite wird mit den Leitfragen vorbefuellt, *ohne* als geaendert zu gelten (Quill-Quelle `api`) — gespeichert wird erst beim Tippen. Je Seitenart hoechstens eine Standardvorlage (`_clear_template_default`).
- **Tagesseite** nutzt `populateDay()` mit eigenem Template `tpl-page-day` (dieselben Klassen-Selektoren, plus `.day-trade-list` fuer kompakte Trade-Zeilen). Nur der Seitenbereich wird getauscht, die Liste bleibt stehen.
- **Screenshots per Strg+V/Drag** laufen ueber `imageUploaderModule()` (journal.js) auf den jeweiligen Upload-Endpunkt — nie Quills Standard (base64 im HTML).
- **Notizbuecher**: Ordner = Abschnitt, Notizen = Seiten. Reihenfolge `notebook_nodes.position`, Farbe `color`.
- **OneNote-Import** (`app/onenote_import.py`, Karte in den Einstellungen): liest per PowerShell/COM ausschliesslich `GetHierarchy`/`GetPageContent`, schreibt nie nach OneNote. Bereiche mit Zugangsdaten (Accounts, Gewerbe, Privat, Login, 2FA …) sind standardmaessig ausgeschlossen. `source_key` (OneNote-Seiten-ID) macht ihn wiederholbar; vorhandene Eintraege werden nie ueberschrieben, OneNote-Inhalt wird angehaengt. Leere Vorlagenseiten (nur Leitfragen) werden uebersprungen.

## Strategien und Regeln

Eine Strategie bündelt Regeln (optional in Gruppen); ein Trade hat **höchstens eine** Strategie. Was ein Trade von ihren Regeln befolgt hat, steht in `trade_rule_status`.

- **Keine Zeile = unbeantwortet**, und fällt aus *jeder* Quote heraus, statt als „nicht befolgt" zu zählen — das ist zugleich der Weg für „Regel hier nicht anwendbar". `0 %` (fünfmal beantwortet, nie befolgt) ist deshalb etwas völlig anderes als „noch nicht bewertet"; beides muss in der Oberfläche unterscheidbar bleiben.
- **Regel ändern gibt es zweimal:** `update_rule()` für Tippfehler und Umgruppieren, `replace_rule()` für inhaltlichen Ersatz. Letzteres archiviert die alte Regel, damit ihre bisherigen Bewertungen nicht rückwirkend etwas Falsches behaupten. Diese Trennung nicht „vereinfachen".
- **Löschen ist zweigleisig:** `archived = 1` ist der Normalfall (Trades und Auswertung bleiben). Eine Gruppe zu löschen löst sie nur auf — ihre Regeln samt Bewertungen bleiben und rutschen auf „ohne Gruppe".
- **Auswertungs-Dimension `rules`** („Regeln eingehalten (Trade)“) nutzt dieselbe Ableitung fuer alle Trades in einer Query (`db.trade_rule_compliance()`); `followed_plan` ist das Feld aus dem **Tages**-Journal — beide nicht zusammenlegen.
- **„Plan befolgt" wird am Trade abgeleitet**, nicht eingegeben: Ja, wenn jede beantwortete Regel auf Ja steht; `None` bei fehlender Strategie oder wenn noch nichts beantwortet ist. „Keine Aussage" ist nicht „Plan gebrochen". Im **Tages**-Journal bleibt das Feld eine normale Eingabe.
- **`is_default` ordnet nichts automatisch zu**, sondern ist nur eine Vorauswahl im Auswahlfeld; Import und Sync setzen niemals eine Strategie, sonst bekämen Bestandstrades still eine falsche.

## Globale Filter

Konto, Tag und Strategie laufen als ein Satz durch die Anwendung:

- Backend: `db._trade_filters()` kombiniert alle drei. Ein vierter Filter gehört genau dort hinein — nicht in die sechs aufrufenden Funktionen.
- Frontend: `withFilter()` in `core.js` ist die **einzige** Stelle, die den Querystring baut. `withAnalyticsFilter()` baut darauf auf und hängt nur den Zeitraum an — nie die Liste selbst nachbilden, das übersieht neue Filter (passierte mit dem Strategie-Filter: die Auswertungsseite zeigte als einzige weiterhin alles).
- Magic Keys für „nicht zugeordnet": `"csv"` beim Konto, `"none"` bei der Strategie.

## Bewusste Design-Entscheidungen

Nicht „aufräumen“, ohne den Grund zu kennen — jede ist Ergebnis eines konkreten Bugs oder Performance-Problems:

- **Monat/Woche:** ein Range-Query plus Gruppierung in Python, statt einer eigenen DB-Verbindung pro Tag (bis zu 31 pro Request).
- **`populateDay()`** arbeitet mit Klassen-Selektoren statt IDs, weil derselbe View gleichzeitig als Seite *und* im Modal existieren kann.
- **Sidebar** animiert ihre eigene `width` statt `grid-template-columns` (Chromium interpoliert Letzteres nicht zuverlässig).
- **Layout ist in festen px gebaut** und skaliert ab 2200/3200 px Fensterbreite über CSS `zoom`. Neue Komponenten müssen dazu passen.
- **Journal-Einträge** hängen an `entry_type` + `ref_key`, nicht an einer `day`-Spalte — damit Wochen-/Monatsreviews (`'2026-W35'`, `'2026-08'`) ohne Schema-Migration dazukommen können. `day_notes` ist der abgelöste Vorgänger und bleibt nur stehen, weil Migrationen append-only sind und auf sie verweisen — nicht mehr benutzen.
- **Ein einziger Journal-Editor** (`mountJournalEditor()`) wird an zwei Stellen eingehängt (Journal-Seite, Karte im Tagesview). `activeJournal` hält ihn fest, damit `mountView()`, `closeModal()` und `beforeunload` noch ungespeicherten Text rausschreiben können. `host.dataset.journalRef` verhindert, dass `populateDay()` (läuft nach jedem Bild-Upload erneut) ihn samt Eingaben neu aufbaut.
- **Raster-Layout (`board.js`):** Übersicht, Monat, Konten & Sync, Export und Einstellungen liegen in einem 24-Spalten-Raster (Lücke 12 px) mit **fester Zeilenhöhe** (`ROW` = 20 px, muss zu `grid-auto-rows`/`padding-bottom` in `.board`/`.board-block` passen). Jeder Block hat eine absolute Position `{x, y, w, h}` und bleibt, wo er losgelassen wird — **kein** automatisches Nachrutschen; nur Kollisionen schieben den Überdeckten nach unten, die Vorschau rechnet dabei immer vom Stand bei Ziehbeginn (nichts „wandert“ mit). `h = null` = Höhe folgt dem Inhalt. Vorgängerversion mit Auto-Zeilen und Bruch-Zeilennummern war genau deshalb unbrauchbar (Blöcke sprangen) — nicht wieder einführen. `BOARD_VIEWS` mappt Template → Key/Standardbreiten, `mountView()` hängt es ein; Blöcke sind die direkten Kinder von `.board`, Key aus `data-block`/`data-settings-card`/`id`, sonst Position (`b0` …) — Template-Reihenfolge also nicht ändern. Layout in `localStorage` (`boardLayout3:<key>`), bedienbar nur im Layout-Modus (ganzer Block ziehen, Kanten = Größe, Pfeiltasten/Umschalt+Pfeile, WCAG 2.5.7). Übersichts-Kacheln sind einzelne Blöcke (`data-w="2" data-h="8"`). Nicht umgestellt: Auswertungen (eigenes Widget-System), Journal/Strategie, To-Do, Trades.
- **Spalten-Auswahl der Übersicht speichert die _ausgeblendeten_ Spalten** (`overviewHiddenColumns`), nicht die sichtbaren — sonst bliebe jede neu hinzugefügte Spalte für Bestandsnutzer unsichtbar.
- **News-Verlauf für die Monatsübersicht** (`marked_news`-Tabelle, Name historisch) wird nicht live vom ForexFactory-Feed befüllt (der deckt nur die aktuelle/nächste Woche ab), sondern per `news.scrape_month()` monatlich je Monat aus der öffentlichen Kalenderseite gescrapt (eingebettetes JSON `window.calendarComponentStates`, kein offizielles API) und dauerhaft gespeichert — nur High-Impact und Feiertage. Läuft automatisch einmal pro Kalendermonat beim App-Start (`_maybe_scrape_news_history`, Fenster ab `NEWS_HISTORY_START_YEAR/MONTH` bis zwölf Monate voraus, wandert mit jedem Monat weiter), der Button in der Monatsübersicht ist nur der manuelle Sofort-Anstoß. `app_core/app/news_history_seed.json` ist ein mitgelieferter Exportstand dieser Tabelle (`_seed_news_history_from_bundle`, läuft vor dem Scrape bei jedem Start) — damit ein frischer Nutzer die Termine sofort und offline hat und die Daten auch erhalten bleiben, falls ForexFactory die Seite irgendwann so ändert, dass der Scraper nicht mehr funktioniert. Diese Seed-Datei ist ein manueller Snapshot, kein automatischer Export — bei Bedarf erneut aus `data/trades.db` (Tabelle `marked_news`) exportieren und im Repo aktualisieren.


`app_core/static/vendor/` enthält Quill (Editor) als lokale Kopie: die App muss ohne Netz laufen, ein CDN kommt nicht in Frage. Kein Build-Step, die Dateien werden direkt eingebunden und mitcommittet.

## Frontend: native ES-Module

`static/js/` enthält das Frontend als native ES-Module — weiterhin **ohne Build-Schritt**, der Browser lädt `js/main.js` (`<script type="module">`) und von dort die übrigen Module. Vorher lag alles in einer einzelnen `app.js` mit über 5.000 Zeilen.

- **`core.js` importiert nichts** und muss das bleiben. Es hält den globalen `state`, `api()`, die Formatierer und die Filter-Querystrings. Die übrigen Module bilden untereinander frei Zyklen — für Funktionen unkritisch (Deklarationen werden gehoistet, Bindings sind live), für `const`/`let` **nicht**: ein Wert, den ein anderes Modul schon beim Laden auswertet, landet im Zyklus in der Temporal Dead Zone. Deshalb liegen `JOURNAL_FONTS`/`JOURNAL_SIZES` in `core.js`, nicht in `journal.js` — `notebooks.js` baut daraus zur Ladezeit seine Quill-Toolbar. Neue modulübergreifende Konstanten gehören nach `core.js`.
- **Importierte `let`-Bindings sind im importierenden Modul schreibgeschützt.** Für die vier Variablen, die von außen gesetzt werden, gibt es deshalb Setter im Heimatmodul: `clearActiveJournal()`, `clearActiveNotebookNote()`, `clearNbDrag()`, `setModalOnClose()`. Keine dieser Variablen direkt aus einem anderen Modul zuweisen.
- **`main.js` enthält nur die reihenfolgekritische Startsequenz.** Die Module registrieren ihre eigenen Event-Listener beim Laden; der gespeicherte Filter- und Ansichtszustand muss aber stehen, bevor `openOverview()` rendert. Dort hängen auch die globalen Fehler-Handler.

### Helfer in core.js, die es schon gibt

Vor einer neuen Umsetzung hier nachsehen (siehe erste Dauerregel):

- **`makeSortable(container, selector, onReorder, {grid, keyAttr})`** für jede Drag-&-Drop-Umsortierung. `grid: true` für mehrspaltige Raster (Übersichts-Kacheln, Auswertungs-Widgets), sonst einspaltige Liste. Gespeichert wird bei `dragend`, nicht bei `drop`. Der Notizbuch-Baum nutzt das bewusst **nicht**: dort wird in Ordner hinein verschoben, nicht umsortiert.
- **`readStoredArray(key)` / `writeStored(key, wert)`** für gespeicherte Listen (Reihenfolgen, ausgeblendete Spalten). Beide fangen Fehler ab — ein beschädigter Eintrag darf höchstens die Vorliebe kosten, nicht den Start. **Achtung:** `theme`, `fontOption`, `sidebarCollapsed` und `newsbarCollapsed` liegen als rohe Strings im localStorage, weil das Inline-Skript im `<head>` sie vor dem ersten Rendern liest — nicht auf `writeStored` (JSON) umstellen.
- **`showAppError(msg)` / `clearAppError()`** für den Fehlerstreifen. Die Render-Funktionen fangen ihre `api()`-Fehler nicht einzeln ab; ein `unhandledrejection`-Handler in `main.js` meldet zentral. `mountView()` räumt den Streifen beim Ansichtswechsel weg. Kein `alert()` mehr im Code.
- **`escapeHtml(s)`** für alles, was aus der Datenbank ins Markup geht. `confirmDelete()`/`confirmContinue()`/`promptDialog()` escapen ihre Nachricht bereits selbst — dort also **nicht** doppelt escapen.

## Release

`VERSION` hochzählen, `CHANGELOG.md` ergänzen, `app_core/build_release.ps1` baut `update.zip`. Verteilung läuft über ein öffentliches GitHub-Release (`gh release create`, Repo `Attaxs-90/Trade-Journal` — bewusst öffentlich, damit Beta-Tester ohne eigenen GitHub-Account Code ansehen und Updates beziehen können) — `app_core/update_check.ps1` prüft das beim Start automatisch und fragt vor dem Einspielen nach. `update.bat`/`update_check.ps1` spiegeln dabei `app/` und `static/` per `robocopy /MIR` (nicht nur `/E`), damit im neuen Release entfernte Dateien wirklich verschwinden statt liegen zu bleiben; die losen Root-Dateien (`update.bat` selbst, `dev_reset.*`, `build_release.ps1`) werden nur kopiert, nie gespiegelt. Exakter Ablauf inkl. Skript-Reihenfolge und einmaliger GitHub-Einrichtung steht in `app_core/README_DEV.md`; Update-Anleitung für Nutzer steht in `app_core/README.md`.
