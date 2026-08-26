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

## Betrieb

```bash
python -m pip install -r requirements.txt
python run.py     # startet auf 127.0.0.1:8420 und oeffnet den Browser
```

- **Kein Auto-Reload:** nach Änderungen an `app/*.py` Server neu starten.
  `static/`-Änderungen brauchen nur einen Browser-Reload.
- Hängt ein alter Prozess auf dem Port: `netstat -ano | findstr :8420`, dann
  gezielt `taskkill /F /PID <pid>`. Nicht `taskkill /IM python.exe` — das killt
  jeden Python-Prozess auf dem Rechner.
- **Tests gibt es nicht.** Verifiziert wird gegen den laufenden Server, z. B.
  `curl -s "http://127.0.0.1:8420/api/days" | python -m json.tool`.

## Code vs. Nutzerdaten

| Code — wird bei Updates überschrieben | Nutzerdaten — niemals anfassen |
|---|---|
| `app/`, `static/`, `run.py`, `*.bat`, `requirements.txt`, `VERSION` | `data/`, `config.json` |

Die App wird als ZIP an nicht-technische Nutzer verteilt, die per Doppelklick
auf `update.bat` aktualisieren; das Skript schließt `data/` und `config.json`
beim Kopieren explizit aus. Diese Grenze nicht aufweichen: keine generierten
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

## Release

`VERSION` hochzählen, `CHANGELOG.md` ergänzen, ZIP ohne `data/`, `config.json`
und `update.bat` bauen. Exakter Ablauf steht in `UPDATE.md`.
