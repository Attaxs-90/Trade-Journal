# Changelog

## 1.3.0
- Neue Einzel-Trade-Seite: Bewertung/Verfassung/Plan-befolgt/Tags/Freitext
  je Trade (gleiches System wie das Tages-Journal), Vor/Zurück-Navigation
  per Button und Pfeiltasten, Warnung samt Liste bei ungespeicherten
  Änderungen vor dem Verlassen.
- Trades-Übersicht: Notiz-/Foto-Markierung je Zeile, Feldreihenfolge der
  Tabellenspalten per Drag & Drop einstellbar, Klick auf eine Zeile öffnet
  die neue Einzel-Trade-Seite.
- Monatsübersicht: Liste aller Tage mit Trade/Journal/Bild unter dem
  Kalender, Journal- und Bild-Icon je Kalenderzelle, Journal-Eintrag öffnet
  sich in einem Fenster statt die Seite zu wechseln.
- Übersicht: "Tage im Überblick"-Tabelle entfernt (durch die neue
  Monatsliste ersetzt), Konten-Filter bleibt an der Equity-Kurve.
- CSV-Import von der Sidebar in eine eigene Karte auf der Konten-Seite
  verschoben, unter "Konto hinzufügen".
- Bilder: direkter Löschen-Button auf jeder Miniatur; Tage ohne Trades aber
  mit Bild/Journal sind jetzt erreichbar (vorher Fehler); Bildqualität
  moderat angehoben (max. Breite 1600→2200px, JPEG-Qualität 82→90,
  Thumbnail 320→380px/Qualität 70→78).
- Fix: Bei aktivem CSS-Zoom (ab 2200/3200px Fensterbreite) wurden Lightbox,
  Tag-Popover und Chart-Tooltip falsch positioniert/skaliert, teils mit
  unerreichbaren Buttons in der Lightbox.
- Neue Menüpunkte Strategie/Backtesting (Platzhalter "Work in Progress").
- Diverse Backend-Härtung: unvollständige Backups im WAL-Modus behoben,
  Migrationsfehler werden nicht mehr stillschweigend verschluckt, statische
  Dateien werden mit Cache-Control: no-cache ausgeliefert.

## 1.2.1
- Journal: Lösch-Button pro Eintrag (mit Ja-Bestätigung) und Mehrfachauswahl
  zum gemeinsamen Löschen mehrerer Tage.
- Journal: Bewertung/Verfassung/Plan-befolgt jetzt als Liste untereinander,
  direkter Link zur Vorlagenverwaltung aus dem Editor.
- Marktnews: neuer Filter "FTMO News" für FTMOs Restricted Events (2 Min.
  Trade-Sperre vor/nach der Veröffentlichung) - mit ❗-Markierung, optionaler
  roter Hervorhebung und Hinweis-Icon bei eingeklappter Newsbar.
- Tags/Journal-Vorlagen: Eingabefelder kompakter und untereinander statt
  über die volle Breite verteilt.
- Diverse Bugfixes: Browser-Autofill-Vorschläge bei Tags deaktiviert, zwei
  Fälle behoben in denen die Seite nach einem Sprung zu den
  Journal-Vorlagen falsch scrollte.

## 1.2.0
- Neues Journal: formatierbare Einträge (Schriftart, Größe, Listen,
  Überschriften u. a.) je Handelstag, unabhängig davon ob an dem Tag
  gehandelt wurde. Mit Tagesbewertung, Verfassung, "Plan befolgt", eigenen
  Tags, editierbaren Vorlagen und Volltextsuche. Mehrfachauswahl zum
  gemeinsamen Löschen mehrerer Einträge.
- Neue Trades-Seite: alle Einzeltrades paginiert, mit Tag-Filter.
- Trade-Tags mit Farbe und Gruppierung, filterbar (UND/ODER) auf der
  Trades-Seite, auch bei der Mehrfachauswahl im Tagesdetail.
- Konten lassen sich jederzeit umbenennen.
- Trade-Größe (Lots bei CFDs, Kontrakte bei Futures) wird automatisch anhand
  der Quelle erkannt und angezeigt, auch aggregiert in der Übersicht.
- Übersichtstabelle: wählbare Spalten (Konto, Größe, Trades, Punkte, Netto,
  Journal) und Konto-Filter direkt in der Tabelle statt in der Sidebar.
- Marktnews: zusätzliche Sektion für die kommende Handelswoche.
- Sidebar entschlackt: Konten-/Tags-Filter und Tage-Liste sind in die
  passenden Seiten gewandert.

## 1.1.0
- Equity-Kurve startet und endet beim echten Kontostand aus dem MT5-Sync
  statt einem manuell eingetragenen Startkapital.
- Equity-Kurve farbig relativ zum Startkapital (grün oberhalb, rot
  unterhalb), sofort erscheinendes Tooltip beim Hovern über einen Punkt.
- Neue Marktnews-Spalte: Wirtschaftskalender (ForexFactory) mit Filtern nach
  Impact, Event-Typ und Währung, Wochenübersicht Mo-Fr, ein-/ausklappbar.
- Sidebar: Ein-/Ausklappen jetzt oben neben dem Theme-Switch.
- MT5-Terminal wird nach jedem Sync automatisch geschlossen.

## 1.0.0
- Erste verteilbare Version.
- NinjaTrader-CSV-Import, MetaTrader-5-Sync, Konten-Filter.
- Übersicht, Monats-/Wochenansicht, Tagesdetail mit Journal-Notizen.
- Bild-Upload pro Tag/Trade mit Lightbox.
- Automatische, versionierte DB-Migrationen mit Backup vor jedem Update.
