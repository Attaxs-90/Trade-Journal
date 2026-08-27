# Trade Journal

Ein lokales Handels-Tagebuch: importiert Trades aus CSV-Dateien oder direkt
aus MetaTrader 5, zeigt Übersichten pro Tag/Woche/Monat und speichert Notizen
und Bilder zu jedem Handelstag. Läuft komplett lokal auf deinem Rechner unter
`http://127.0.0.1:8420` — es werden keine Daten irgendwohin übertragen.

## Erste Einrichtung

Vorausgesetzt: [Python](https://www.python.org/downloads/) ist installiert
(beim Installieren den Haken bei "Add python.exe to PATH" setzen).

1. Den `trade-journal`-Ordner an einen festen Ort legen (z. B. `Dokumente`).
2. Auf `start.bat` doppelklicken.
   - Fehlen noch Pakete, installiert `start.bat` sie automatisch und bittet
     dich danach, es noch einmal zu starten.
3. Ein schwarzes Fenster bleibt offen (das ist der laufende Server) und der
   Browser öffnet sich automatisch mit dem Trade Journal.
4. Zum Beenden das schwarze Fenster schließen.

Beim nächsten Mal reicht wieder ein Doppelklick auf `start.bat`.

## Updates

`start.bat` prüft bei jedem Start automatisch, ob eine neue Version
verfügbar ist:

- Gibt es keine neue Version (oder keine Internetverbindung), startet Trade
  Journal einfach ganz normal.
- Gibt es eine neue Version, fragt das schwarze Fenster **"Update
  verfügbar: vX.X.X — Jetzt aktualisieren? (J/N)"**. Mit `J` + Enter wird das
  Update automatisch heruntergeladen und eingespielt, mit `N` + Enter startet
  Trade Journal wie gewohnt mit der aktuellen Version weiter — du wirst beim
  nächsten Start wieder gefragt.

**Deine Trades, Konten, Notizen und Bilder bleiben bei einem Update immer
erhalten** — sie liegen im Ordner `data/` und in `config.json`, die ein
Update nie überschreibt oder löscht.

## Wo liegen meine Daten?

```
trade-journal/
├── data/
│   ├── trades.db       Trades, Konten, Notizen
│   ├── images/          Hochgeladene Bilder
│   └── backups/          Automatische Sicherungen vor jedem Datenbank-Update
└── config.json           Punktwerte je Instrument
```

Diese beiden bleiben komplett bei dir auf dem Rechner, unabhängig von jedem
Update. Ein regelmäßiges eigenes Backup des `data/`-Ordners (z. B. Kopie auf
einen USB-Stick) schadet trotzdem nicht.

## Falls etwas nicht funktioniert

- **`start.bat` bricht mit einer Fehlermeldung ab:** meist fehlt Python oder
  eine Abhängigkeit — `start.bat` versucht das automatisch zu beheben und
  bittet dich, es danach erneut zu starten.
- **Die Seite öffnet sich nicht von selbst:** im Browser manuell
  `http://127.0.0.1:8420` aufrufen, während das schwarze Fenster offen ist.
- **Der Update-Download schlägt fehl:** meist Internet- oder
  Verbindungsproblem — Trade Journal startet trotzdem ganz normal weiter,
  beim nächsten Start wird es erneut versucht.
