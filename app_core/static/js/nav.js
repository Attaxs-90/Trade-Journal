/* Sidebar-Navigation und Reihenfolge der Menuepunkte. */

import { openStrategy } from './strategies.js';
import { goToAccountsCard, openAccounts, openAnalytics } from './analytics.js';
import { openMonth } from './calendar.js';
import { api, makeSortable, readStoredArray, state, writeStored } from './core.js';
import { openExport } from './export.js';
import { renderAccountFilter } from './filters.js';
import { flushJournal, openJournal } from './journal.js';
import { openOverview, openTrades } from './overview.js';
import { goToSettingsCard, openSettings } from './settings.js';
import { goToTodoList, openTodos } from './todos.js';

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
    if (el.dataset.view === "export") openExport();
    if (el.dataset.view === "settings") openSettings();
    syncJournalNavActive();
  });
});

makeSortable(document.querySelector(".nav"), ".nav-item", saveNavOrder, { keyAttr: "view" });

/* Ausklappbare Unterpunkte je Nav-Eintrag (Journal: Tagebuch/Notizbuecher;
   Einstellungen: einzelne Karten; Konten & Sync: einzelne Karten; To-Do-Listen:
   eine je angelegter Liste, siehe refreshTodoNavSubnav()). Ein Klick auf einen
   Unterpunkt springt direkt zur passenden Stelle statt erst die Hauptseite zu
   oeffnen und dort selbst zu suchen. Auf-/Zuklappen ist je Eintrag eigenstaendig
   gespeichert (Nutzer soll einzelne Listen dauerhaft einklappen koennen, ohne
   dass sie beim naechsten Start wieder aufklappen). */
function wireSubnavToggle(key) {
  const toggle = document.querySelector(`.nav-subnav-toggle[data-subnav-toggle-for="${key}"]`);
  const subnav = document.querySelector(`.nav-subnav[data-subnav-for="${key}"]`);
  if (!toggle || !subnav) return;
  const storeKey = `navSubnavExpanded:${key}`;
  const setExpanded = (expanded) => {
    subnav.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
  };
  // readStoredArray liefert nur bei Arrays etwas zurueck (siehe core.js) - hier
  // reicht der rohe String, writeStored() unten schreibt ihn als JSON-Boolean.
  setExpanded(localStorage.getItem(storeKey) !== "false");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const expanded = subnav.hidden;
    setExpanded(expanded);
    writeStored(storeKey, expanded);
  });
}
["journal", "todos", "accounts", "settings"].forEach(wireSubnavToggle);

function wireSubnavItemKeyboard(el) {
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    el.click();
  });
}

document.querySelectorAll('.nav-subnav[data-subnav-for="journal"] .nav-subitem').forEach(el => {
  wireSubnavItemKeyboard(el);
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    await flushJournal();
    state.journalTab = el.dataset.journalTab;
    await openJournal();
  });
});

document.querySelectorAll('.nav-subnav[data-subnav-for="settings"] .nav-subitem').forEach(el => {
  wireSubnavItemKeyboard(el);
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    await flushJournal();
    await goToSettingsCard(el.dataset.settingsCard);
  });
});

document.querySelectorAll('.nav-subnav[data-subnav-for="accounts"] .nav-subitem').forEach(el => {
  wireSubnavItemKeyboard(el);
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    await flushJournal();
    await goToAccountsCard(el.dataset.accountsCard);
  });
});

/* Spiegelt state.view/journalTab auf die Hervorhebung der Journal-Unterpunkte -
   wird sowohl hier (nach jedem Nav-Klick) als auch von switchJournalTab()
   in notebooks.js aufgerufen, damit der In-Page-Umschalter auf der
   Journal-Seite die Sidebar ebenfalls aktuell haelt. */
export function syncJournalNavActive() {
  document.querySelectorAll('.nav-subnav[data-subnav-for="journal"] .nav-subitem').forEach(el => {
    el.classList.toggle("active", state.view === "journal" && state.journalTab === el.dataset.journalTab);
  });
}

/* To-Do-Listen-Unterpunkte sind dynamisch (eine je angelegter Liste) - wird
   einmal beim Start sowie nach jeder Aenderung (Anlegen/Umbenennen/Loeschen,
   siehe refreshTodoUI() in todos.js) neu aufgebaut. Ganz ohne Liste bleibt der
   Aufklapp-Pfeil versteckt - eine leere Unterliste haette nichts zu zeigen. */
export async function refreshTodoNavSubnav() {
  const toggle = document.querySelector('.nav-subnav-toggle[data-subnav-toggle-for="todos"]');
  const subnav = document.querySelector('.nav-subnav[data-subnav-for="todos"]');
  if (!toggle || !subnav) return;
  let lists = [];
  try {
    ({ lists } = await api("/api/todo-lists"));
  } catch (e) {
    return; // z.B. beim allerersten Laden noch nicht erreichbar - naechster Refresh holt es nach
  }
  toggle.hidden = lists.length === 0;
  subnav.hidden = lists.length === 0 || localStorage.getItem("navSubnavExpanded:todos") === "false";
  subnav.innerHTML = "";
  for (const list of lists) {
    const el = document.createElement("span");
    el.className = "nav-subitem";
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.textContent = list.name;
    el.title = list.name;
    el.dataset.todoListId = String(list.id);
    wireSubnavItemKeyboard(el);
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      await flushJournal();
      await goToTodoList(list.id);
    });
    subnav.appendChild(el);
  }
}
refreshTodoNavSubnav();

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
