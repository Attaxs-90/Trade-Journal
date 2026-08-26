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

## Ein Update einspielen

Du bekommst von Zeit zu Zeit eine neue `update.zip`-Datei (per Mail, Chat,
USB-Stick — wie auch immer).

1. Trade Journal beenden, falls es gerade läuft.
2. Die `update.zip` **direkt in den `trade-journal`-Ordner legen**, neben
   `start.bat`.
3. Auf `update.bat` doppelklicken.
4. Ein schwarzes Fenster zeigt den Fortschritt und meldet sich am Ende mit
   "Update abgeschlossen! Deine Daten sind erhalten."
5. Trade Journal wie gewohnt über `start.bat` starten.

**Deine Trades, Konten, Notizen und Bilder bleiben bei einem Update immer
erhalten** — sie liegen im Ordner `data/` und in `config.json`, die ein
Update nie überschreibt oder löscht. Ist keine `update.zip` vorhanden, bricht
`update.bat` mit einer klaren Meldung ab, ohne irgendetwas zu verändern.

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
- **`update.bat` meldet einen Fehler beim Kopieren:** sicherstellen, dass
  Trade Journal wirklich komplett beendet ist (schwarzes Fenster geschlossen),
  dann `update.bat` erneut starten.
