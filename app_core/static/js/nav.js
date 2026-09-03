/* Sidebar-Navigation und Reihenfolge der Menuepunkte. */

import { openBacktesting, openStrategy } from './accounts.js';
import { openAccounts, openAnalytics } from './analytics.js';
import { openMonth } from './calendar.js';
import { makeSortable, readStoredArray, state, writeStored } from './core.js';
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
    if (el.dataset.view === "backtesting") openBacktesting();
    if (el.dataset.view === "accounts") openAccounts();
    if (el.dataset.view === "settings") openSettings();
  });
});

makeSortable(document.querySelector(".nav"), ".nav-item", saveNavOrder, { keyAttr: "view" });

/* Globaler Konten-Status-Klick fuehrt zur Uebersicht, wo der Filter sitzt -
   Tastatur-Aktivierung analog zu .nav-item (ebenfalls ein div[role=button]). */
const sidebarAccountStatusEl = document.getElementById("sidebar-account-status");
sidebarAccountStatusEl.addEventListener("click", () => { if (state.view !== "overview") openOverview(); });
sidebarAccountStatusEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  sidebarAccountStatusEl.click();
});
