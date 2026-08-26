# Updates verteilen & einspielen

## Ordnerstruktur: Code vs. eigene Daten

```
trade-journal/
├── app/              <- Code (wird bei einem Update ersetzt)
├── static/           <- Code (wird bei einem Update ersetzt)
├── run.py            <- Code (wird bei einem Update ersetzt)
├── start.bat          <- Code (Doppelklick-Starter)
├── update.bat          <- Code (Doppelklick-Updater, bleibt bei Updates unangetastet)
├── requirements.txt  <- Code (wird bei einem Update ersetzt)
├── VERSION           <- Code (wird bei einem Update ersetzt)
├── config.json         <- EIGENE Daten (Punktwerte etc.) - wird NIE überschrieben
└── data/                <- EIGENE Daten - wird NIE überschrieben
    ├── trades.db          Trades, Konten, Notizen
    ├── images/             Hochgeladene Bilder
    └── backups/            Automatische Backups vor jedem DB-Update
```

`update.bat` selbst wird von Updates **nicht** angefasst - es lebt dauerhaft im
Ordner des Nutzers und muss nur bei der Ersteinrichtung einmal vorhanden sein.

## Für Nutzer: Update in einem Klick

1. Die neue `update.zip`-Datei bekommen (per Mail, Chat, USB-Stick, egal wie).
2. Die `update.zip` **direkt in den `trade-journal`-Ordner legen** (neben `start.bat`).
3. Auf `update.bat` doppelklicken.
4. Fertig - ein schwarzes Fenster zeigt den Fortschritt und meldet sich am Ende
   mit "Update abgeschlossen! Deine Daten sind erhalten."
5. App wie gewohnt über `start.bat` starten.

`update.bat` beendet dabei automatisch eine noch laufende Instanz, entpackt die
ZIP, kopiert nur Code-Dateien darüber (der `data`-Ordner und `config.json`
werden dabei technisch ausgeschlossen - nicht nur per Zip-Inhalt, sondern
zusätzlich per Filter beim Kopieren, doppelt abgesichert), installiert bei
Bedarf neue Abhängigkeiten nach und räumt hinter sich auf.

Ist keine `update.zip` vorhanden, bricht das Skript mit einer klaren Meldung ab,
statt irgendetwas zu verändern.

## Für dich als Entwickler: ein Update bauen

1. Änderungen wie gewohnt vornehmen (in `app/`, `static/`, ggf. `requirements.txt`).
2. Falls sich die Datenbankstruktur ändert: neue Migration am Ende der
   `MIGRATIONS`-Liste in `app/db.py` anhängen (nie bestehende Einträge ändern).
3. `VERSION` hochzählen, kurzer Eintrag in `CHANGELOG.md`.
4. `update.zip` bauen - **ohne** `data/`, **ohne** `config.json`, **ohne**
   `update.bat` selbst (das bleibt beim Nutzer unverändert liegen):

```powershell
Compress-Archive -Path app,static,run.py,requirements.txt,VERSION,CHANGELOG.md,start.bat `
  -DestinationPath update.zip -Force
```

5. `update.zip` an die Nutzer schicken, mit dem Hinweis: "ins trade-journal-
   Verzeichnis legen, `update.bat` doppelklicken".

## Manuelles Einspielen (Fallback, falls `update.bat` fehlt oder scheitert)

1. Trade Journal beenden.
2. Aus der ZIP nur `app/`, `static/`, `run.py`, `requirements.txt`, `VERSION`,
   `CHANGELOG.md` über die alten Dateien kopieren.
3. `data/`-Ordner und `config.json` **nicht anfassen**.
4. `python -m pip install -r requirements.txt` ausführen.
5. `start.bat` (oder `python run.py`) starten.

## Was beim ersten Start nach einem Update automatisch passiert

- Ein Backup der bestehenden `trades.db` wird nach `data/backups/` kopiert
  (Dateiname mit Zeitstempel).
- Nur die fehlenden Schema-Änderungen werden nachgeholt - vorhandene Trades,
  Konten, Notizen und Bilder bleiben erhalten.
- Bei einem bereits aktuellen Stand passiert nichts (kein unnötiges Backup).

Falls nach einem Update etwas nicht stimmt, liegt die Datenbank von direkt davor
unverändert in `data/backups/` und kann jederzeit zurückkopiert werden
(`data/backups/<Datei>.db` → `data/trades.db`, App vorher beenden).
