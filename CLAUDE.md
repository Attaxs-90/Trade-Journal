# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dauerregeln

- **Vor neuen Funktionen prüfen, ob es sie schon gibt.** Vorhandene Helper
  erweitern statt duplizieren — z. B. `db._account_filter()` für jede Abfrage
  über Trades, `withFilter()` im Frontend für jede datenladende URL,
  `_read_upload()` für jeden Upload.
- **Keine mehrfachen Iterationen über dieselben Daten.** Einmal laden, einmal
  durchlaufen, in einem Rutsch aggregieren. Kein Query pro Tag, wenn ein
  Range-Query reicht; keine zweite Schleife für eine Kennzahl, die in der
  ersten mit abfällt.
- Kommentare auf Deutsch, ohne Umlaute (bestehende Konvention). UI und
  Nutzerkommunikation auf Deutsch mit Umlauten.

## Ordnerstruktur

Der Hauptordner zeigt bewusst nur `start.bat` (plus Nutzerdaten). Der
komplette Code liegt in `app_core/` und wird bei Updates ersetzt:

```
trade-journal/
├── start.bat          <- duenner, kaum aenderbarer Einstiegspunkt
├── data/, config.json <- Nutzerdaten, siehe unten
├── github_token.txt   <- optional, nur falls das Release-Repo mal privat wird
└── app_core/          <- kompletter Code, wird bei Updates ersetzt
    ├── app/, static/, run.py, requirements.txt, VERSION, CHANGELOG.md
    ├── update_check.ps1   <- Versionscheck beim Start, siehe "Release"
    └── README.md, README_DEV.md, build_release.ps1, dev_reset.*, update.bat
```

`CLAUDE.md` und `.git`/`.gitignore` bleiben bewusst am Projekt-Root (Claude
Code und Git suchen dort danach).

## Betrieb

```bash
cd app_core
python -m pip install -r requirements.txt
python run.py     # startet auf 127.0.0.1:8420 und oeffnet den Browser
```

- **Kein Auto-Reload:** nach Änderungen an `app_core/app/*.py` Server neu
  starten. `app_core/static/`-Änderungen brauchen nur einen Browser-Reload.
- Hängt ein alter Prozess auf dem Port: `netstat -ano | findstr :8420`, dann
  gezielt `taskkill /F /PID <pid>`. Nicht `taskkill /IM python.exe` — das killt
  jeden Python-Prozess auf dem Rechner.
- **Tests gibt es nicht.** Verifiziert wird gegen den laufenden Server, z. B.
  `curl -s "http://127.0.0.1:8420/api/days" | python -m json.tool`.

## Code vs. Nutzerdaten

| Code — wird bei Updates überschrieben | Nutzerdaten — niemals anfassen |
|---|---|
| alles unter `app_core/` | `data/`, `config.json`, `github_token.txt` |

`start.bat` wird bewusst NIE von einem Update überschrieben (eine laufende
.bat-Datei sollte sich nicht selbst ersetzen) — nur `app_core/` wird beim
Update ersetzt. Diese Grenze nicht aufweichen: keine generierten
Code-Artefakte nach `data/`, keine Nutzerdaten außerhalb davon.

`trades.db` enthält Broker-Passwörter im Klartext — bewusst akzeptiert für den
rein lokalen Betrieb, und der Grund, warum `data/` in `.gitignore` steht.

## Migrationen: append-only

`db.MIGRATIONS` wird über `PRAGMA user_version` getrackt — **der Listenindex
ist die Versionsnummer**. Einträge nie ändern, umsortieren oder löschen: bereits
aktualisierte Nutzer-Datenbanken stünden sonst mit falscher Version da und
bekämen Migrationen doppelt oder gar nicht. Nur hinten anhängen.

## Konten- und Quellen-Modell

Zwei Achsen, die leicht verwechselt werden:

- **`platform`** — technische Anbindung (`mt5`, `ninjatrader`)
- **Konto** — Zeile in `broker_accounts`; mehrere Konten können dieselbe
  Plattform nutzen (z. B. zwei getrennte NinjaTrader-Konten)

Trades tragen beides: `source` (Herkunft der Daten) und `account_id`
(Zuordnung). Der Filter reicht `?accounts=2,5,csv` durch alle
Auswertungs-Endpoints — Konto-IDs plus den Magic String **`"csv"` für
`account_id IS NULL`** (nicht zugeordnet).

## Strategien und Regeln

Eine Strategie bündelt Regeln (optional in Gruppen); ein Trade hat **höchstens
eine** Strategie. Was ein Trade von ihren Regeln befolgt hat, steht in
`trade_rule_status`.

- **Keine Zeile = unbeantwortet**, und unbeantwortet fällt aus *jeder* Quote
  heraus, statt als „nicht befolgt" zu zählen. Das ist zugleich der Weg für
  „Regel hier nicht anwendbar". Deshalb ist `0 %` (fünfmal beantwortet, nie
  befolgt) etwas völlig anderes als „noch nicht bewertet" — beides muss in der
  Oberfläche unterscheidbar bleiben.
- **Regel ändern gibt es zweimal:** `update_rule()` für Tippfehler und
  Umgruppieren, `replace_rule()` für inhaltlichen Ersatz. Letzteres archiviert
  die alte Regel, damit ihre bisherigen Bewertungen nicht rückwirkend etwas
  Falsches behaupten. Diese Trennung nicht „vereinfachen".
- **Löschen ist zweigleisig:** `archived = 1` ist der Normalfall (Trades und
  Auswertung bleiben), `DELETE` entkoppelt die Trades wie `delete_account()`.
  Eine Gruppe zu löschen löst sie nur auf — ihre Regeln samt Bewertungen
  bleiben und rutschen auf „ohne Gruppe".
- **„Plan befolgt" wird am Trade abgeleitet**, nicht eingegeben: Ja, wenn jede
  beantwortete Regel auf Ja steht; `None` bei fehlender Strategie oder wenn
  noch nichts beantwortet ist. „Keine Aussage" ist nicht „Plan gebrochen". Im
  **Tages**-Journal bleibt das Feld eine normale Eingabe.
- **`is_default` ordnet nichts automatisch zu.** Es ist nur eine Vorauswahl im
  Auswahlfeld; Import und Sync setzen niemals eine Strategie, sonst bekämen
  Bestandstrades still eine falsche.
- **`idx_trades_strategy` steht nur in den Migrationen, nicht im `SCHEMA`.**
  `SCHEMA` läuft vor den Migrationen, und bei einer bestehenden Datenbank gibt
  es `trades.strategy_id` dort noch nicht — der Index brach den Start ab. Für
  Indizes auf Spalten, die eine Migration erst anlegt, gilt das allgemein.

## Globale Filter

Konto, Tag und Strategie laufen als ein Satz durch die Anwendung:

- Backend: `db._trade_filters()` kombiniert alle drei. Ein vierter Filter
  gehört genau dort hinein — nicht in die sechs aufrufenden Funktionen.
- Frontend: `withFilter()` in `core.js` ist die **einzige** Stelle, die den
  Querystring baut. `withAnalyticsFilter()` baut darauf auf und hängt nur den
  Zeitraum an. Vorher wiederholte es die Liste und übersah dadurch den neu
  hinzugekommenen Strategie-Filter — die Auswertungsseite zeigte als einzige
  weiterhin alles.
- Magic Keys für „nicht zugeordnet": `"csv"` beim Konto, `"none"` bei der
  Strategie.

## Bewusste Design-Entscheidungen

Nicht „aufräumen“, ohne den Grund zu kennen — alle vier sind Ergebnis eines
konkreten Bugs oder Performance-Problems:

- **Monat/Woche:** ein Range-Query plus Gruppierung in Python. Vorher lief eine
  eigene DB-Verbindung pro Tag (bis zu 31 pro Request).
- **`populateDay()`** arbeitet mit Klassen-Selektoren statt IDs, weil derselbe
  View gleichzeitig als Seite *und* im Modal existieren kann.
- **Sidebar** animiert ihre eigene `width` statt `grid-template-columns`
  (Chromium interpoliert Letzteres nicht zuverlässig).
- **Layout ist in festen px gebaut** und skaliert ab 2200/3200 px Fensterbreite
  über CSS `zoom`. Neue Komponenten müssen dazu passen.
- **Journal-Einträge** hängen an `entry_type` + `ref_key`, nicht an einer
  `day`-Spalte — damit Wochen-/Monatsreviews (`'2026-W35'`, `'2026-08'`) ohne
  Schema-Migration dazukommen können. `day_notes` ist der abgelöste Vorgänger:
  Inhalte wurden per Migration übernommen, die Tabelle bleibt nur stehen, weil
  Migrationen append-only sind und auf sie verweisen. Nicht mehr benutzen.
- **Ein einziger Journal-Editor** (`mountJournalEditor()`) wird an zwei Stellen
  eingehängt (Journal-Seite, Karte im Tagesview). `activeJournal` hält ihn fest,
  damit `mountView()`, `closeModal()` und `beforeunload` noch ungespeicherten
  Text rausschreiben können. `host.dataset.journalRef` verhindert, dass
  `populateDay()` (läuft nach jedem Bild-Upload erneut) ihn samt Eingaben neu
  aufbaut.
- **Spalten-Auswahl der Übersicht speichert die _ausgeblendeten_ Spalten**
  (`overviewHiddenColumns`), nicht die sichtbaren — sonst bliebe jede neu
  hinzugefügte Spalte für Bestandsnutzer unsichtbar.

`app_core/static/vendor/` enthält Quill (Editor) als lokale Kopie: die App muss
ohne Netz laufen, ein CDN kommt nicht in Frage. Kein Build-Step, die Dateien
werden direkt eingebunden und mitcommittet.

## Frontend: native ES-Module

`static/js/` enthält das Frontend als native ES-Module — weiterhin **ohne
Build-Schritt**, der Browser lädt `js/main.js` (`<script type="module">`) und
von dort die übrigen Module. Vorher lag alles in einer einzelnen `app.js` mit
über 5.000 Zeilen.

- **`core.js` importiert nichts** und muss das bleiben. Es hält den globalen
  `state`, `api()`, die Formatierer und die Filter-Querystrings. Die übrigen
  Module importieren sich gegenseitig frei und bilden dabei Zyklen — das ist
  für Funktionen unkritisch (Deklarationen werden gehoistet, Bindings sind
  live). Für `const`/`let` gilt das **nicht**: ein Wert, den ein anderes Modul
  schon beim Laden auswertet, landet im Zyklus in der Temporal Dead Zone.
  Genau deshalb liegen `JOURNAL_FONTS`/`JOURNAL_SIZES` in `core.js` und nicht
  in `journal.js` — `notebooks.js` baut daraus zur Ladezeit seine
  Quill-Toolbar. Neue modulübergreifende Konstanten gehören nach `core.js`.
- **Importierte `let`-Bindings sind im importierenden Modul schreibgeschützt.**
  Für die vier Variablen, die von außen gesetzt werden, gibt es deshalb Setter
  im Heimatmodul: `clearActiveJournal()`, `clearActiveNotebookNote()`,
  `clearNbDrag()`, `setModalOnClose()`. Keine dieser Variablen direkt aus einem
  anderen Modul zuweisen.
- **`main.js` enthält nur die reihenfolgekritische Startsequenz.** Die Module
  registrieren ihre eigenen Event-Listener beim Laden; der gespeicherte Filter-
  und Ansichtszustand muss aber stehen, bevor `openOverview()` rendert. Dort
  hängen auch die globalen Fehler-Handler.

### Helfer in core.js, die es schon gibt

Vor einer neuen Umsetzung hier nachsehen (siehe erste Dauerregel):

- **`makeSortable(container, selector, onReorder, {grid, keyAttr})`** für jede
  Drag-&-Drop-Umsortierung. Ersetzte sechs fast gleiche Implementierungen.
  `grid: true` für mehrspaltige Raster (Übersichts-Kacheln, Auswertungs-
  Widgets), sonst einspaltige Liste. Gespeichert wird bei `dragend`, nicht bei
  `drop` — wird außerhalb der Liste losgelassen, bleibt die per `dragover`
  bereits vollzogene Verschiebung sonst sichtbar, aber ungespeichert stehen.
  Der Notizbuch-Baum nutzt das bewusst **nicht**: dort wird in Ordner
  hinein verschoben, nicht umsortiert.
- **`readStoredArray(key)` / `writeStored(key, wert)`** für gespeicherte Listen
  (Reihenfolgen, ausgeblendete Spalten). Beide fangen Fehler ab — ein
  beschädigter Eintrag darf höchstens die Vorliebe kosten, nicht den Start.
  **Achtung:** `theme`, `fontOption`, `sidebarCollapsed` und `newsbarCollapsed`
  liegen als rohe Strings im localStorage, weil das Inline-Skript im `<head>`
  sie vor dem ersten Rendern liest. Die dürfen nicht auf `writeStored`
  (JSON) umgestellt werden.
- **`showAppError(msg)` / `clearAppError()`** für den Fehlerstreifen. Die
  Render-Funktionen fangen ihre `api()`-Fehler nicht einzeln ab; ein
  `unhandledrejection`-Handler in `main.js` meldet zentral. `mountView()` räumt
  den Streifen beim Ansichtswechsel weg. Kein `alert()` mehr im Code.
- **`escapeHtml(s)`** für alles, was aus der Datenbank ins Markup geht.
  `confirmDelete()`/`confirmContinue()`/`promptDialog()` escapen ihre Nachricht
  bereits selbst — dort also **nicht** doppelt escapen.

## Release

`VERSION` hochzählen, `CHANGELOG.md` ergänzen, `app_core/build_release.ps1`
baut `update.zip`. Verteilung läuft über ein öffentliches GitHub-Release
(`gh release create`, Repo `Attaxs-90/Trade-Journal` — bewusst öffentlich,
damit Beta-Tester ohne eigenen GitHub-Account Code ansehen und Updates
beziehen können) — `app_core/update_check.ps1` prüft das beim Start
automatisch und fragt vor dem Einspielen nach. Exakter Ablauf inkl.
Skript-Reihenfolge und einmaliger GitHub-Einrichtung steht in
`app_core/README_DEV.md`; Update-Anleitung für Nutzer steht in
`app_core/README.md`.
