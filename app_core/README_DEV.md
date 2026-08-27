# README für Entwickler

Diese Datei bleibt lokal bei dir und wird **nie** an Nutzer verteilt (steht
nicht in `build_release.ps1`). Sie beschreibt, wie du ein neues Update baust
und über GitHub Releases verteilst, ohne deine eigenen Daten (`data/`,
`config.json`, `github_token.txt`) mitzuschicken.

## Code vs. Nutzerdaten

| Code — wird verteilt (liegt in `app_core/`) | Nutzerdaten — bleibt bei dir |
|---|---|
| `app/`, `static/`, `run.py`, `requirements.txt`, `VERSION`, `CHANGELOG.md`, `README.md`, `update_check.ps1` | `data/`, `config.json`, `github_token.txt` |

`start.bat` liegt am Projekt-Root (nicht in `app_core/`) und wird von Updates
bewusst **nie** überschrieben. Details und Begründung stehen in
[CLAUDE.md](../CLAUDE.md) unter "Code vs. Nutzerdaten".

## Einmalige Einrichtung (GitHub Release-Repo)

Nur einmal nötig, danach läuft die Verteilung über `gh release create`.

1. **GitHub-Konto** anlegen, falls noch nicht vorhanden: https://github.com/signup
2. **Privates Repository** anlegen (z. B. `Attaxs-90/Trade-Journal`) — dient
   nur der Release-Verteilung, nicht zwingend derselbe Ort wie dieser
   Code-Ordner.
3. **GitHub CLI** installieren: https://cli.github.com, danach im Terminal
   einmalig `gh auth login` (öffnet den Browser zum Einloggen).
4. **Fine-grained Personal Access Token** erzeugen für den *automatischen
   Update-Check* der App (getrennt vom `gh`-Login):
   github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → "Generate new token" → Repository access nur auf
   `Trade-Journal` beschränken → unter Permissions nur **Contents:
   Read-only**. Den erzeugten Token-String in eine Datei `github_token.txt`
   im Projekt-Root speichern (neben `start.bat`, **nicht** in `app_core/`) —
   die Datei ist in `.gitignore` und wird nie mitverteilt.

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
   Verschiebt `data/` und `config.json` (am Projekt-Root) zeitgestempelt
   beiseite (löscht nichts endgültig, Bestätigung per Texteingabe `RESET`
   nötig). Danach `start.bat` starten und die App wie ein neuer Nutzer
   durchklicken. Deine echten Daten liegen unverändert in
   `data_reset_backup_<Zeitstempel>/` und `config_reset_backup_<Zeitstempel>.json`
   im Projekt-Root und lassen sich jederzeit zurückbenennen
   (`data_reset_backup_...` → `data`, entsprechend für die config).
5. **`update.zip` bauen:**
   ```powershell
   cd app_core
   .\build_release.ps1
   ```
   Packt ausschließlich `app`, `static`, `run.py`, `requirements.txt`,
   `VERSION`, `CHANGELOG.md`, `README.md`, `update_check.ps1` — `data/`,
   `config.json`, `github_token.txt`, `start.bat`, `update.bat`,
   `dev_reset.py`/`dev_reset.bat`, `build_release.ps1` und dieses
   `README_DEV.md` sind technisch ausgeschlossen, können also nicht aus
   Versehen mitgeschickt werden.
6. **Als GitHub Release veröffentlichen:**
   ```bash
   gh release create v1.1.0 app_core/update.zip --title "v1.1.0" --notes-file app_core/CHANGELOG.md
   ```
   (Versionsnummer an Schritt 3 anpassen, mit `v`-Präfix im Tag.) Sobald das
   Release online ist, findet `update_check.ps1` es beim nächsten Start der
   App automatisch — kein manuelles Verteilen der `update.zip` mehr nötig.

## Manuelles Einspielen (Fallback, falls der automatische Check scheitert)

`app_core/update.bat` bleibt als Fallback erhalten, z. B. wenn kein Internet
verfügbar ist und du `update.zip` selbst per USB-Stick vorbeibringst:

1. Trade Journal beim Nutzer beenden.
2. Die `update.zip` in dessen `app_core/`-Ordner legen (neben `update.bat`).
3. `update.bat` per Doppelklick ausführen.
4. `data/`-Ordner und `config.json` am Projekt-Root **nicht anfassen** —
   liegen ohnehin außerhalb von `app_core/` und werden nicht berührt.

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
| `dev_reset.py` / `dev_reset.bat` | Eigene Daten (am Projekt-Root) zeitgestempelt beiseite verschieben, um den Neuinstallations-Zustand zu testen. Nichts wird endgültig gelöscht. |
| `build_release.ps1` | Baut `update.zip` mit exakt den Code-Dateien, die an Nutzer gehen — Nutzerdaten und Entwickler-Skripte sind fest ausgeschlossen. |
| `update_check.ps1` | Läuft bei jedem Start automatisch über `start.bat` — prüft GitHub Releases, fragt bei neuer Version nach, spielt sie bei Zustimmung ein. |
| `update.bat` | Manueller Fallback, falls der automatische Check nicht greift (z. B. offline). |

## Betrieb & Tests

Siehe [CLAUDE.md](../CLAUDE.md) für Start-/Neustart-Verhalten (kein
Auto-Reload), Port-Konflikte und die Design-Entscheidungen im Projekt. Ein
Testframework gibt es bewusst nicht — Verifikation läuft gegen den laufenden
Server, z. B. `curl -s "http://127.0.0.1:8420/api/days" | python -m json.tool`.
