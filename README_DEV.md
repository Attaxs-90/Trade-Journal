# README für Entwickler

Diese Datei bleibt lokal bei dir und wird **nie** an Nutzer verteilt (steht
nicht in `build_release.ps1`). Sie beschreibt, wie du ein neues Update baust
und verteilst, ohne deine eigenen Daten (`data/`, `config.json`) mitzuschicken.

## Code vs. Nutzerdaten

| Code — wird verteilt | Nutzerdaten — bleibt bei dir |
|---|---|
| `app/`, `static/`, `run.py`, `start.bat`, `requirements.txt`, `VERSION`, `CHANGELOG.md`, `README.md` | `data/`, `config.json` |

Details und Begründung stehen in [CLAUDE.md](CLAUDE.md) unter "Code vs.
Nutzerdaten".

## Update bauen und verteilen — Skript-Reihenfolge

1. **Code ändern** wie gewohnt (`app/`, `static/`, ggf. `requirements.txt`).
2. **Falls sich das DB-Schema ändert:** neue Migration ans Ende der
   `MIGRATIONS`-Liste in [app/db.py](app/db.py) anhängen — bestehende Einträge
   nie ändern oder umsortieren (siehe CLAUDE.md, "Migrationen: append-only").
3. **`VERSION` hochzählen** und einen Eintrag in `CHANGELOG.md` ergänzen.
4. **(Optional, empfohlen bei groesseren Änderungen) Frischen Start testen:**
   ```bash
   python dev_reset.py
   ```
   Verschiebt `data/` und `config.json` zeitgestempelt beiseite (löscht
   nichts endgültig, Bestätigung per Texteingabe `RESET` nötig). Danach
   `start.bat` starten und die App wie ein neuer Nutzer durchklicken. Deine
   echten Daten liegen unverändert in `data_reset_backup_<Zeitstempel>/` und
   `config_reset_backup_<Zeitstempel>.json` und lassen sich jederzeit
   zurückbenennen (`data_reset_backup_...` → `data`, entsprechend für die
   config).
5. **`update.zip` bauen:**
   ```powershell
   .\build_release.ps1
   ```
   Packt ausschließlich `app`, `static`, `run.py`, `requirements.txt`,
   `VERSION`, `CHANGELOG.md`, `start.bat`, `README.md` — `data/`,
   `config.json`, `update.bat`, `dev_reset.py`/`dev_reset.bat` und dieses
   `README_DEV.md` sind technisch ausgeschlossen, können also nicht aus
   Versehen mitgeschickt werden.
6. **`update.zip` an Nutzer verteilen** (Mail, Chat, USB-Stick, egal wie),
   zusammen mit dem Hinweis: "In den `trade-journal`-Ordner legen, neben
   `start.bat`, dann `update.bat` doppelklicken." (Details für die Nutzer
   stehen in `README.md`.)

## Manuelles Einspielen (Fallback, falls `update.bat` beim Nutzer fehlt/scheitert)

1. Trade Journal beim Nutzer beenden.
2. Aus der ZIP nur `app/`, `static/`, `run.py`, `requirements.txt`, `VERSION`,
   `CHANGELOG.md` über die alten Dateien kopieren.
3. `data/`-Ordner und `config.json` **nicht anfassen**.
4. `python -m pip install -r requirements.txt` ausführen.
5. `start.bat` (oder `python run.py`) starten.

## Was beim ersten Start nach einem Update automatisch passiert

- Ein Backup der bestehenden `trades.db` wird nach `data/backups/` kopiert
  (Dateiname mit Zeitstempel, siehe `db._backup_db()`; die zehn neuesten
  Backups bleiben erhalten, ältere werden automatisch entfernt).
- Nur die fehlenden Schema-Änderungen werden nachgeholt — vorhandene Trades,
  Konten, Notizen und Bilder bleiben erhalten.
- Bei einem bereits aktuellen Stand passiert nichts (kein unnötiges Backup).

Falls nach einem Update etwas nicht stimmt: die Datenbank von direkt davor
liegt unverändert in `data/backups/` und kann jederzeit zurückkopiert werden
(`data/backups/<Datei>.db` → `data/trades.db`, App vorher beenden).

## Entwickler-Skripte im Überblick

| Skript | Zweck |
|---|---|
| `dev_reset.py` / `dev_reset.bat` | Eigene Daten zeitgestempelt beiseite verschieben, um den Neuinstallations-Zustand zu testen. Nichts wird endgültig gelöscht. |
| `build_release.ps1` | Baut `update.zip` mit exakt den Code-Dateien, die an Nutzer gehen — `data/`, `config.json` und Entwickler-Skripte sind fest ausgeschlossen. |

## Betrieb & Tests

Siehe [CLAUDE.md](CLAUDE.md) für Start-/Neustart-Verhalten (kein Auto-Reload),
Port-Konflikte und die Design-Entscheidungen im Projekt. Ein Testframework
gibt es bewusst nicht — Verifikation läuft gegen den laufenden Server, z. B.
`curl -s "http://127.0.0.1:8420/api/days" | python -m json.tool`.
