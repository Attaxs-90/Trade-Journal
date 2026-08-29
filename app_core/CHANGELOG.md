# Changelog

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
