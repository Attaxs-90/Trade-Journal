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
├── github_token.txt   <- Zugriffstoken fuers Release-Repo, niemals committen
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

## Release

`VERSION` hochzählen, `CHANGELOG.md` ergänzen, `app_core/build_release.ps1`
baut `update.zip`. Verteilung läuft über ein privates GitHub-Release
(`gh release create`) — `app_core/update_check.ps1` prüft das beim Start
automatisch und fragt vor dem Einspielen nach. Exakter Ablauf inkl.
Skript-Reihenfolge und einmaliger GitHub-Einrichtung steht in
`app_core/README_DEV.md`; Update-Anleitung für Nutzer steht in
`app_core/README.md`.
