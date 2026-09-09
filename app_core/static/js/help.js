/* Kontextabhaengige Hilfe: Fragezeichen-Button oben rechts in jedem
   Menuepunkt, oeffnet eine kurze Anleitung dazu, was die Seite zeigt und wie
   man sich durch sie bewegt - fuer Leute, die die App noch nicht kennen.
   Bewusst statischer Text hier im Modul statt aus der DB, da sich der
   Hilfetext nie pro Nutzer aendert. Neue Seite mit Hilfe: hier einen Eintrag
   mit dem jeweiligen Template-Namen ergaenzen, mountHelpButton() (siehe
   mountView() in overview.js) greift automatisch. */

import { attachOutsideClose } from './core.js';

const HELP_CONTENT = {
  "tpl-overview": {
    title: "Übersicht",
    body: `
      <p>Die Startseite zeigt Kennzahlen-Kacheln (Startkapital, Kontostand, Trefferquote,
      Profit-Faktor, ...) und darunter die Equity-Kurve über die Zeit.</p>
      <p>Über den Button <b>"Kacheln auswählen"</b> oben rechts lässt sich festlegen, welche
      Kacheln angezeigt werden. Per Ziehen (Drag &amp; Drop) an einer Kachel lässt sich ihre
      Reihenfolge ändern.</p>
      <p>Der Konten-/Tag-/Strategie-Filter in der Seitenleiste links wirkt auf diese Seite und
      gleichzeitig auf Trades, Auswertungen und Monatsübersicht.</p>
    `,
  },
  "tpl-trades": {
    title: "Trades",
    body: `
      <p>Hier stehen alle importierten/synchronisierten Trades als Tabelle, mit Seiten-Blättern
      unten und Sortierung per Klick auf eine Spaltenüberschrift.</p>
      <p>Über <b>"Feldreihenfolge"</b> oben lassen sich Spalten ein-/ausblenden und per Drag &amp;
      Drop umsortieren. Die drei Icons je Zeile öffnen den Trade, teilen ihn als Bild oder löschen
      ihn endgültig.</p>
      <p>Checkboxen links markieren mehrere Trades für Sammelaktionen (Strategie zuweisen,
      Journal-Einträge oder ganze Trades löschen) über die Leiste, die dabei erscheint.</p>
      <p>Tags, Konten- und Strategie-Filter oben schränken die Liste ein; ein Klick auf "Öffnen"
      führt zur Detailseite eines einzelnen Trades mit Notiz, Bild und Bewertung.</p>
    `,
  },
  "tpl-journal": {
    title: "Journal",
    body: `
      <p>Zwei Reiter oben: <b>"Tagebuch"</b> für Journal-Einträge zu Tagen, Wochen, Monaten und
      einzelnen Trades, <b>"Notizbücher"</b> für freie Notizen in einer Ordnerstruktur.</p>
      <p>Im Tagebuch-Reiter über die Suche/Filter nach Zeitraum oder Tag-Zuordnung stöbern; ein
      Klick auf einen Treffer öffnet den Editor. Änderungen werden automatisch beim Verlassen
      gespeichert, ein manuelles Speichern ist nicht nötig.</p>
      <p>Im Notizbücher-Reiter links durch die Ordner/Notizen klicken, rechts schreiben - per
      Rechtsklick auf einen Ordner/eine Notiz erscheint ein Kontextmenü zum Umbenennen,
      Verschieben oder Löschen.</p>
    `,
  },
  "tpl-todos": {
    title: "To-Do-Listen",
    body: `
      <p>Hier Listen anlegen und Einträge hinzufügen. Über den Schalter "sichtbar" bei einer
      Liste erscheint sie zusätzlich rechts in der Newsbar-Seitenleiste als abhakbare
      Checkliste - dort einfach auf einen Eintrag klicken, um ihn als erledigt zu markieren
      (er verschwindet dabei nicht, sondern wird nur durchgestrichen).</p>
      <p>Umbenennen, Einträge entfernen und ganze Listen löschen geht direkt in dieser
      Verwaltungsansicht.</p>
    `,
  },
  "tpl-analytics": {
    title: "Auswertungen",
    body: `
      <p>Frei zusammenstellbares Dashboard aus Auswertungs-Widgets (z. B. Netto nach Wochentag,
      Uhrzeit, Instrument, Haltedauer). Über <b>"+ Auswertung"</b> ein neues Widget hinzufügen,
      per Drag &amp; Drop am Titel umsortieren, über das X am Widget wieder entfernen.</p>
      <p>Der Konten-Filter oben im Kopf wirkt zusätzlich zum globalen Filter der Seitenleiste nur
      auf diese Seite; darunter lässt sich für die ganze Seite ein Zeitraum einstellen.</p>
    `,
  },
  "tpl-month": {
    title: "Monatsübersicht",
    body: `
      <p>Kalenderansicht eines Monats: grüne/rote Kacheln zeigen Handelstage mit Netto-Ergebnis
      und Trade-Anzahl, das Journal-Symbol oben rechts in einer Kachel öffnet direkt den
      Journal-Eintrag des Tages. Ein Klick auf einen Tag im Kalender öffnet dessen volles
      Tagesdetail (alle Trades, Beobachtungen, Bilder, Journal).</p>
      <p>In der Liste <b>"Alle Tage des Monats"</b> darunter klappt ein Klick auf einen
      Handelstag stattdessen direkt seine einzelnen Trades mit Konto, Zeiten, Ein-/Ausstieg
      und kumuliertem Ergebnis in dieser Liste auf - erneuter Klick klappt wieder zu.</p>
      <p>Mit den Pfeilen oben neben dem Monatsnamen zwischen Monaten wechseln.</p>
    `,
  },
  "tpl-strategy": {
    title: "Strategie",
    body: `
      <p>Hier Strategien anlegen und ihre Regeln festlegen (optional in Gruppen). Links die
      Strategie auswählen, rechts Regeln hinzufügen/umsortieren.</p>
      <p>Ein Trade lässt sich auf seiner Detailseite oder in der Tagesansicht höchstens einer
      Strategie zuordnen und dort Regel für Regel als befolgt/nicht befolgt abhaken - hier auf
      dieser Seite zeigt die Prozentzahl neben jeder Regel, wie oft sie über alle Trades hinweg
      befolgt wurde. Nicht beantwortete Bewertungen zählen dabei nicht als "nicht befolgt".</p>
      <p>"Archivierte zeigen" blendet archivierte (ersetzte) Regeln und Strategien wieder ein.</p>
    `,
  },
  "tpl-accounts": {
    title: "Konten & Sync",
    body: `
      <p>Broker-Konten anlegen (MT5 mit Login/Passwort, NinjaTrader über eine Sync-Datei) oder
      CSV-Dateien manuell importieren. "Jetzt synchronisieren" holt nur neue Trades, "Vollständig
      neu synchronisieren" fragt die letzten 365 Tage komplett neu ab (auch absichtlich gelöschte
      Trades in diesem Zeitraum kommen dabei zurück).</p>
      <p>Über den Stern lässt sich ein Konto als Favorit markieren (erscheint dann oben in einem
      eigenen Bereich), über den Pfeil links daneben ein Konto einklappen. Reihenfolge per Drag
      &amp; Drop innerhalb der Favoriten bzw. der übrigen Konten änderbar.</p>
      <p>"Bisherige nicht zugeordnete Trades zuweisen" ordnet Trades, die vor dem Anlegen dieses
      Kontos ohne Konto importiert/gesynct wurden, nachträglich zu.</p>
    `,
  },
  "tpl-export": {
    title: "Export",
    body: `
      <p>Trades als CSV- oder JSON-Datei herunterladen. Eigener Filter (Konten, Tags, Strategie,
      Zeitraum) unabhängig vom globalen Filter der Seitenleiste - so lässt sich gezielt exportieren,
      ohne den Filter auf den anderen Seiten zu verändern.</p>
      <p>Unter "Felder" auswählen, welche Spalten in der Export-Datei landen sollen.</p>
    `,
  },
  "tpl-settings": {
    title: "Einstellungen",
    body: `
      <p>Aufklappbare Karten für Schriftart, Tags verwalten, Journal-Vorlagen (Text-Bausteine für
      neue Journal-Einträge) und das endgültige Löschen eines Kontos samt seiner Trades.</p>
      <p>Auf eine Kartenüberschrift klicken, um sie auf- bzw. zuzuklappen.</p>
    `,
  },
};

export function mountHelpButton(container, templateId) {
  const help = HELP_CONTENT[templateId];
  const header = container.querySelector(".view-header");
  if (!help || !header) return;

  // Alles ausser der Ueberschrift (h1) in einen eigenen rechtsbuendigen
  // Wrapper verschieben, damit der Hilfe-Button neben bereits vorhandenen
  // Kopfzeilen-Steuerelementen (Monats-Pfeile, Reiter, Filter, ...) landet,
  // statt bei drei Kindern von .view-header (space-between) in der Mitte.
  let right = header.querySelector(".view-header-right");
  if (!right) {
    right = document.createElement("div");
    right.className = "view-header-right";
    [...header.children].slice(1).forEach(el => right.appendChild(el));
    header.appendChild(right);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "view-help-btn";
  btn.title = "Hilfe zu dieser Seite";
  btn.setAttribute("aria-label", "Hilfe zu dieser Seite");
  btn.textContent = "?";
  btn.addEventListener("click", () => openHelpModal(help));
  right.appendChild(btn);
}

function openHelpModal(help) {
  document.getElementById("help-title").textContent = help.title;
  document.getElementById("help-body").innerHTML = help.body;
  document.getElementById("help-overlay").classList.add("visible");
}

export function closeHelpModal() {
  document.getElementById("help-overlay").classList.remove("visible");
}

document.getElementById("help-close").addEventListener("click", closeHelpModal);
attachOutsideClose(document.getElementById("help-overlay"), closeHelpModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("help-overlay").classList.contains("visible")) {
    closeHelpModal();
  }
});
