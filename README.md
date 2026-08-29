# Trade Journal

Ein lokales Handels-Tagebuch: importiert Trades aus CSV-Dateien oder direkt
aus MetaTrader 5, zeigt Übersichten pro Tag/Woche/Monat, verwaltet Tags und
ein formatierbares Journal je Handelstag. Läuft komplett lokal auf deinem
Rechner unter `http://127.0.0.1:8420` — es werden keine Daten irgendwohin
übertragen.

## Schnellstart

1. Dieses Repository herunterladen (grüner **Code**-Button oben rechts →
   **Download ZIP**, oder `git clone`) und an einen festen Ort entpacken
   (z. B. `Dokumente`).
2. Vorausgesetzt: [Python](https://www.python.org/downloads/) ist installiert
   (beim Installieren den Haken bei "Add python.exe to PATH" setzen).
3. Auf `start.bat` doppelklicken.

Ausführliche Anleitung, Updates, Datenablage und Fehlerbehebung stehen in
[app_core/README.md](app_core/README.md).

## Aufbau

```
trade-journal/
├── start.bat          Einstiegspunkt: Doppelklick startet die App
├── CLAUDE.md           Konventionen für die Weiterentwicklung
└── app_core/           Kompletter Code (Backend, Frontend, Doku)
    ├── app/             Python-Backend (FastAPI)
    ├── static/          Frontend (HTML/CSS/JS, kein Build-Schritt)
    └── README.md        Nutzer-Anleitung
```

`data/`, `config.json` und `github_token.txt` sind bewusst nicht Teil dieses
Repos (siehe `.gitignore`) — das sind deine eigenen Nutzerdaten bzw.
Zugangsdaten, keine Projektdateien.

## Releases

Vorgefertigte Update-Pakete (`update.zip`) für die automatische
Update-Prüfung von `start.bat` liegen unter
[Releases](https://github.com/Attaxs-90/Trade-Journal/releases). Zum
normalen Nutzen reicht aber der Schnellstart oben.
