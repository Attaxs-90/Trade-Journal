# Changelog

## 1.8.0
- Neuer Menüpunkt "Strategie": Strategien anlegen, umbenennen, archivieren und
  löschen; je Strategie eigene Regeln, wahlweise in Gruppen (z. B. "Entry",
  "Lot") oder ohne. Alles per Drag & Drop sortierbar.
- Jeder Trade kann einer Strategie zugeordnet werden und deren Regeln mit
  Ja/Nein bewerten - auf der Trade-Seite und kompakt in der Tagesansicht, dort
  über die Pfeile durch alle Trades eines Tages. Ein erneuter Klick nimmt die
  Bewertung zurück; unbewertete Regeln zählen in keine Quote (deckt auch
  "Regel hier nicht anwendbar" ab).
- Strategie-Seite zeigt je Regel, wie oft sie befolgt wurde und wie die
  befolgten Trades gelaufen sind. "0 %" (nie befolgt) und "noch nicht
  bewertet" bleiben dabei unterscheidbar, ebenso wie viele Trades einer
  Strategie überhaupt schon bewertet sind.
- Regeln lassen sich bearbeiten (Wortlaut) oder ersetzen - beim Ersetzen wird
  die alte Regel archiviert und behält ihre bisherige Auswertung.
- Trades-Übersicht: Strategie zuweisen und eine Regel für mehrere ausgewählte
  Trades auf einmal bewerten.
- "Plan befolgt" wird beim Trade jetzt aus den Regeln abgeleitet statt separat
  eingegeben. Im Tages-Journal bleibt es wie bisher.
- Auswertungen: neue Dimension "Strategie".
- Neuer globaler Strategie-Filter neben Konten und Tags - Übersicht,
  Equity-Kurve, Trades, Monatsansicht und Auswertungen lassen sich damit auf
  einzelne Strategien einschränken.
- Fix: In Balkendiagrammen mit wenigen Kategorien fehlten Beschriftungen (bei
  drei Strategien blieb die mittlere namenlos, ebenso bei "Nicht zugeordnet"
  unter Konten).

## 1.7.1
- Fix: Beim Löschen eines Trades blieben seine Bewertung im Journal und seine
  Bilder als nicht mehr erreichbare Reste zurück (Bilddateien belegten weiter
  Plattenplatz). Beides wird jetzt mitgelöscht.
- Fix: Ein Bild-Upload akzeptierte jedes beliebige Datum in der Adresse und
  legte es unter einem Tag ab, der in keinem Kalender mehr auftauchte.
- Journal: Die Liste ist serverseitig auf die 300 neuesten Einträge begrenzt -
  bisher fehlten ältere kommentarlos, eine Suche sah dadurch vollständig aus,
  obwohl sie es nicht war. Jetzt weist ein Hinweis darauf hin.
- Tag-Farben werden geprüft, statt ungefiltert ins Seiten-Markup zu wandern.
- Übersicht und Tagesansicht berechnen ihre Kennzahlen in einem Durchlauf statt
  in mehreren; Datenbankzugriffe eines Aufrufs teilen sich eine Verbindung.
- Frontend in ES-Module unter `static/js/` aufgeteilt (vorher eine Datei mit
  über 5.000 Zeilen), weiterhin ohne Build-Schritt.
- Vorbereitung auf künftige Python-Versionen: die zur Entfernung vorgemerkten
  UTC-Funktionen ersetzt.
- Fehlgeschlagene Server-Anfragen werden jetzt sichtbar gemeldet. Bisher blieb
  eine Ansicht in so einem Fall einfach ohne Daten stehen - nicht davon zu
  unterscheiden, dass es nichts anzuzeigen gab.
- Namen mit Sonderzeichen (z. B. "Prop & Co <Swing>") werden in
  Bestätigungsdialogen und Konto-Auswahllisten korrekt angezeigt statt
  verstümmelt.
- Farbfelder der Tag-Verwaltung haben jetzt Namen für Screenreader, die
  Konto-Auswahl beim Löschen eine Beschriftung.
- Eine beschädigte gespeicherte Reihenfolge kostet nur noch diese Einstellung,
  statt den Start der Oberfläche abzubrechen.

## 1.7.0
- Neuer Menüpunkt "To-Do-Listen": Listen anlegen/verwalten, Einträge per Klick
  auf den Text abhaken (bleiben ausgegraut erhalten, Löschen nur explizit),
  Sichtbarkeit einzelner Listen im rechten Menü (Newsbar) steuerbar.
- Trades lassen sich als Bild-Karte teilen (Netto $ oder R-Multiple, 5
  Design-Themes, PNG-Download/Zwischenablage) - Share-Button in der
  Trades-Übersicht und auf der Einzel-Trade-Seite. Neues Risiko-Feld je Trade
  als Basis der R-Multiple: bei MT5-Sync automatisch aus dem Stop-Loss des
  Eröffnungs-Orders ermittelt, sonst manuell auf der Trade-Seite eintragbar.
- Übersicht: neue Kennzahlen-Kacheln (Trefferquote, Profit-Faktor, Handelstage
  % Gewinn, Gewinn/Verlust-Verhältnis, Erwartungswert) - einzeln
  ein-/ausblendbar und per Drag & Drop anordenbar, mit Gradient-Gauge bzw.
  zweifarbiger Balkengrafik für Prozent-/Verhältnis-Kennzahlen.
- Auswertungen: Kacheln im Dashboard per Drag & Drop umsortierbar.
- Journal-Suche durchsucht jetzt wahlweise auch die Notizbücher (neuer
  Scope-Schalter Journal/Notizbücher/Beides), Treffer zeigen den Ordnerpfad
  und öffnen in einem schließbaren Fenster statt die Seite zu verlassen.

## 1.6.0
- Journal neu strukturiert: das Tagebuch öffnet jetzt auf einer Jahr/Monat-
  Kachel-Übersicht (Eintragsanzahl, Ø-Bewertung, Netto-Ergebnis, Hinweis auf
  Handelstage ohne Eintrag je Monat) statt einer endlosen Liste, mit
  Jahres-Sprungleiste und Breadcrumb-Rücksprung. Suche/Tag-/Modus-Filter
  wirken weiterhin global über alle Jahre und weichen automatisch in eine
  flache Ergebnisliste aus.
- Neuer Bereich "Notizbücher" (zweiter Reiter auf der Journal-Seite): frei
  verschachtelbare Ordner und Notizen ohne Kalenderbezug, für Beobachtungen,
  Strategie, Unterlagen, Logins o. Ä. Jede Notiz hat einen eigenen
  Rich-Text-Editor inkl. Bild-Einfügen. Ordner/Notizen lassen sich umbenennen,
  per Dialog oder direkt per Drag & Drop verschieben (auch auf die oberste
  Ebene) und samt Inhalt löschen; Zyklen (ein Ordner in sich selbst oder einen
  eigenen Unterordner) sind ausgeschlossen.
- Fix: Journal- bzw. Notizbuch-Einträge, die nur ein eingefügtes Bild ohne
  Text enthielten, wurden beim Speichern verworfen.

## 1.5.0
- Neuer Menüpunkt "Auswertungen": frei zusammenstellbares Dashboard mit
  Equity-Kurve & Drawdown, Kern-Kennzahlen, Serien/Konsistenz-Übersicht,
  P&L-Verteilung und beliebig kombinierbaren Balkendiagrammen (Wochentag,
  Uhrzeit, Instrument, Richtung, Haltedauer, Positionsgröße, Tagesbewertung,
  Verfassung, Plan befolgt, Konto, Tag). Jede Auswertung lässt sich
  hinzufügen, bearbeiten und entfernen, mit eigenem Konten-/Tag-/
  Zeitraum-Filter.
- Einstellungen: alle Karten (Schriftart, Konto löschen, Tags,
  Journal-Vorlagen) lassen sich einzeln ein-/ausklappen.
- Übersicht: Konten-Filter der Equity-Kurve jetzt als direkt klickbare Chips
  statt hinter einem Dropdown versteckt; neuer Status-Bereich unten in der
  Sidebar zeigt den aktiven Konten-Filter auf jeder Seite und führt per Klick
  zurück zur Übersicht.
- Barrierefreiheit: durchgängig sichtbarer Fokusring für Tastaturnavigation,
  aria-Label für alle Icon-Buttons, Theme-Umschalter als SVG-Icon statt
  Emoji, größere Klickflächen für kleine Icon-Buttons.

## 1.4.0
- Tagesansicht neu gestaltet: Trades stehen als linke Spalte mit Feldern
  untereinander statt als Tabelle, Reihenfolge per Drag & Drop einstellbar,
  Pfeil-Navigation zwischen den Trades desselben Tages.
- Kalender-Modal der Tagesansicht lädt die Monatsübersicht beim Schließen
  neu, damit ein frischer Journal-/Bild-Eintrag sofort im Kalender-Icon
  erscheint.
- Trades-Übersicht: neue Badge zeigt an, ob zu einem Trade ein
  Journal-Eintrag existiert; Mehrfachauswahl per Checkbox, um
  Journal-Einträge mehrerer Trades auf einmal zu löschen; Feldreihenfolge
  lässt sich jetzt auch einzeln ein-/ausblenden (nicht nur umsortieren).
- Sidebar-Menüpunkte per Drag & Drop umsortierbar, Reihenfolge wird
  gespeichert.
- "Alle Tags"-Chip und Auswahlleisten (Trades/Journal) zeigen keinen blauen
  Standard-Hintergrund mehr - echte Auswahl bleibt weiterhin farbig
  hervorgehoben.

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
