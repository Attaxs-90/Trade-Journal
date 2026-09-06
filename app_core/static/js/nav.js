/* Sidebar-Navigation und Reihenfolge der Menuepunkte. */

import { openStrategy } from './strategies.js';
import { openAccounts, openAnalytics } from './analytics.js';
import { openMonth } from './calendar.js';
import { makeSortable, readStoredArray, writeStored } from './core.js';
import { renderAccountFilter } from './filters.js';
import { flushJournal, openJournal } from './journal.js';
import { openOverview, openTrades } from './overview.js';
import { openSettings } from './settings.js';
import { openTodos } from './todos.js';

/* ---------- Nav ---------- */

/* Reihenfolge der Sidebar-Menuepunkte per Drag & Drop einstellbar, in
   localStorage gespeichert - gleiches Muster wie die Feldreihenfolge der
   Trades-Uebersicht (bekannte Keys aus gespeicherter Reihenfolge uebernehmen,
   neue/entfernte Keys ergaenzen/rausfiltern, damit ein spaeter hinzugekommener
   Menuepunkt fuer Bestandsnutzer nicht verschwindet). */
function applyNavOrder() {
  const nav = document.querySelector(".nav");
  const items = [...nav.querySelectorAll(".nav-item")];
  const knownViews = items.map(el => el.dataset.view);
  const saved = readStoredArray("navOrder");
  if (!saved) return;
  const order = saved.filter(v => knownViews.includes(v));
  for (const v of knownViews) if (!order.includes(v)) order.push(v);
  for (const view of order) {
    const el = items.find(e => e.dataset.view === view);
    if (el) nav.appendChild(el);
  }
}
function saveNavOrder(order) {
  writeStored("navOrder", order);
}
applyNavOrder();

document.querySelectorAll(".nav-item").forEach(el => {
  // .nav-item ist bewusst ein <div role="button"> statt <button> - draggable="true"
  // auf einem echten <button> feuert in Chromium kein dragstart (die Buttons
  // eigene Press-Behandlung schluckt die Maus-Geste), auf einem <div> geht es
  // zuverlaessig. Dafuer fehlt die native Tastatur-Aktivierung, deshalb hier
  // explizit per Enter/Leertaste nachgebaut.
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    el.click();
  });
  el.addEventListener("click", async () => {
    // Erst den Journal-Editor leeren, dann wechseln - sonst geht der zuletzt
    // getippte, noch nicht automatisch gespeicherte Absatz verloren.
    await flushJournal();
    if (el.dataset.view === "overview") openOverview();
    if (el.dataset.view === "trades") openTrades();
    if (el.dataset.view === "journal") openJournal();
    if (el.dataset.view === "todos") openTodos();
    if (el.dataset.view === "analytics") openAnalytics();
    if (el.dataset.view === "month") openMonth();
    if (el.dataset.view === "strategy") openStrategy();
    if (el.dataset.view === "accounts") openAccounts();
    if (el.dataset.view === "settings") openSettings();
  });
});

makeSortable(document.querySelector(".nav"), ".nav-item", saveNavOrder, { keyAttr: "view" });

/* Globaler Konten-Filter-Status unten in der Sidebar: Klick oeffnet die
   Konten-Auswahl direkt an Ort und Stelle (dasselbe Panel wie ueberall sonst,
   siehe renderAccountFilter() in filters.js) - so laesst sich das Konto von
   jeder Seite aus wechseln, ohne erst zur Uebersicht zu wechseln (frueher
   fuehrte ein Klick nur dorthin). <button> statt <div role="button"> gibt
   Tastatur-Aktivierung kostenlos mit. */
const sidebarAccountStatusToggle = document.getElementById("sidebar-account-status-toggle");
const sidebarAccountStatusPanel = document.getElementById("sidebar-account-status-panel");
sidebarAccountStatusToggle.addEventListener("click", async (e) => {
  e.stopPropagation();
  const wasHidden = sidebarAccountStatusPanel.hidden;
  sidebarAccountStatusPanel.hidden = !wasHidden;
  if (wasHidden) await renderAccountFilter("sidebar-account-status-panel");
});
// Schliesst das Panel bei jedem Klick ausserhalb - auch bei einem Klick auf
// einen Nav-Punkt (die Sidebar bleibt beim View-Wechsel bestehen, das Panel
// wuerde sonst ueber der neuen Seite haengen bleiben). Capture-Phase (dritter
// Parameter true), weil zahlreiche Elemente in den Ansichten (Tabellenzeilen,
// Checkboxen, Tag-Zellen) auf ihren eigenen Klick-Handlern stopPropagation()
// aufrufen - das wuerde einen Bubble-Listener auf document nie erreichen,
// die Capture-Phase laeuft aber vorher und ist davon nicht betroffen.
document.addEventListener("click", (e) => {
  if (!sidebarAccountStatusPanel.hidden && !e.target.closest("#sidebar-account-status")) {
    sidebarAccountStatusPanel.hidden = true;
  }
}, true);
