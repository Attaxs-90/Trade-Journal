/* Gemeinsame Grundlagen: globaler Zustand, API-Aufrufe, Formatierung, Filter-
   Querystrings und kleine DOM-Helfer. Importiert bewusst NICHTS aus den anderen
   Modulen - dadurch bleibt es das Blatt des Importgraphen und seine Konstanten
   sind garantiert initialisiert, bevor ein anderes Modul sie liest. */

/* SVG statt Emoji fuer wiederkehrende Status-/Aktions-Icons (Notiz, Bild,
   Journal-Eintrag, Teilen) - Emoji rendert je nach Betriebssystem/Schriftart
   unterschiedlich gross und farbig und ist kein skalierbares UI-Element.
   Ueberall dort verwendet, wo diese vier Zustaende angezeigt werden (Trades-
   Uebersicht, Kalender, Einzel-Trade-Seite), damit ein Icon im ganzen Produkt
   dasselbe bedeutet. aria-hidden, weil jedes Icon von einem title/aria-label
   am umschliessenden Element begleitet wird. */
export const ICON_NOTE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 21h8"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L10 17l-4 1 1-4Z"/></svg>`;
export const ICON_IMAGE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`;
export const ICON_JOURNAL = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>`;
export const ICON_SHARE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>`;
export const ICON_DELETE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
export const ICON_OPEN = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

export const state = {
  view: "overview", currentDay: null,
  filterMode: "all", filterKeys: [],
  tagFilterMode: "all", tagFilterKeys: [], tagFilterLogic: "or",
  strategyFilterMode: "all", strategyFilterKeys: [],
  // Journal hat einen eigenen Tag-Filter: er filtert Journal-Eintraege, nicht
  // Trades, und darf die Auswertungsseiten deshalb nicht mitbeeinflussen.
  journalMode: "all", journalQuery: "", journalSearchScope: "journal", journalTagKeys: [], journalRefKey: null,
  journalMonth: null, journalTab: "diary",
  journalSelectedKeys: new Set(),
  notebookExpanded: new Set(), notebookSelectedId: null,
  analyticsRange: { start: null, end: null },
};
export function accountsQS() {
  if (state.filterMode !== "selected" || !state.filterKeys.length) return "";
  return `accounts=${encodeURIComponent(state.filterKeys.join(","))}`;
}
export function tagsQS() {
  if (state.tagFilterMode !== "selected" || !state.tagFilterKeys.length) return "";
  return `tags=${encodeURIComponent(state.tagFilterKeys.join(","))}&tag_logic=${state.tagFilterLogic}`;
}

/* Strategie-Filter der Uebersicht (Equity-Kurve/Kacheln) - anders als Konto-
   und Tag-Filter bewusst NICHT Teil von withFilter(): er soll nur die
   Uebersicht selbst filtern, nicht auch Trades/Journal/Auswertungen, die alle
   ueber withFilter() laufen (siehe Nutzer-Feedback - frueher wirkte eine
   Strategie-Auswahl in der Uebersicht ungewollt bis in die Trades-Liste
   hinein). openOverview() haengt diesen Query-Teil deshalb selbst an.
   Schluessel sind Strategie-Ids oder "none" fuer Trades ohne Strategie
   (siehe db._strategy_filter). */
export function strategiesQS() {
  if (state.strategyFilterMode !== "selected" || !state.strategyFilterKeys.length) return "";
  return `strategies=${encodeURIComponent(state.strategyFilterKeys.join(","))}`;
}

export function withFilter(url) {
  const parts = [accountsQS(), tagsQS()].filter(Boolean);
  if (!parts.length) return url;
  return url + (url.includes("?") ? "&" : "?") + parts.join("&");
}

export function fmtNum(n, decimals = 2) {
  return Number(n).toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtSigned(n, decimals = 2) {
  const s = fmtNum(Math.abs(n), decimals);
  return (n < 0 ? "-" : "") + s;
}
export function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
export function cls(n) { return n >= 0 ? "pos" : "neg"; }
export function fmtVolume(trade) {
  if (trade.volume === null || trade.volume === undefined) return "–";
  if (trade.source === "ninjatrader") {
    const n = Math.round(trade.volume);
    return `${n} Kontrakt${n === 1 ? "" : "e"}`;
  }
  return `${fmtNum(trade.volume, 2)} Lot${trade.volume === 1 ? "" : "s"}`;
}
const TAG_COLOR_FALLBACK = "#6c95ff";
export function safeColor(hex) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(hex || "")) ? hex : TAG_COLOR_FALLBACK;
}
export function tagTextColor(hex) {
  const c = (hex || "#6c95ff").replace("#", "");
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1d21" : "#ffffff";
}

export function attachOutsideClose(overlayEl, closeFn) {
  // Schliesst nur, wenn Mousedown UND Click beide direkt auf dem Hintergrund
  // (nicht auf der Karte) lagen - verhindert versehentliches Schliessen,
  // wenn z.B. ein Resize-Drag am Kartenrand endet oder Text ausserhalb selektiert wird.
  let downOnOverlay = false;
  overlayEl.addEventListener("mousedown", (e) => {
    downOnOverlay = e.target === overlayEl;
  });
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl && downOnOverlay) closeFn();
  });
}

export async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    // FastAPI/Pydantic melden Validierungsfehler (422) als Liste von Objekten,
    // eigene HTTPException-Fehler dagegen als Klartext-String. Ohne die
    // Unterscheidung landete bei 422 ein "[object Object]" im Fehlerdialog.
    const detail = Array.isArray(err.detail)
      ? err.detail.map(d => d.msg || JSON.stringify(d)).join("; ")
      : err.detail;
    throw new Error(detail || "Fehler");
  }
  return res.json();
}

export function tile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value ${extraClass}">${value}</div></div>`;
}
export const JOURNAL_FONTS = ["Georgia", "Verdana", "Trebuchet MS", "Courier New", "Arial"];
export const JOURNAL_SIZES = ["12px", "14px", "16px", "18px", "24px", "32px"];

export const JOURNAL_AUTOSAVE_MS = 1500;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Macht die Kinder eines Containers per Drag & Drop umsortierbar.

   Ersetzt sechs fast gleiche Umsetzungen (Sidebar-Menue, Uebersichts-Kacheln
   und deren Auswahlliste, Trade-Feldreihenfolge auf der Trades-Seite und in
   der Tagesansicht, Auswertungs-Widgets). Die beiden Grid-Varianten hatten
   ihre Einfuegepunkt-Berechnung sogar zeilengleich doppelt.

   grid=false (Standard): einspaltige Liste, die Mitte der Zeile entscheidet.
   grid=true: mehrspaltiges Raster - erst ueber/unter der Kachel pruefen, dann
   links/rechts von ihrer Mitte.

   onReorder bekommt die neue Schluesselreihenfolge (aus data-<keyAttr>) und
   wird bei dragend aufgerufen, nicht bei drop: wird ausserhalb der Liste
   losgelassen, bleibt die per dragover schon vollzogene Verschiebung sichtbar
   stehen - ein drop-Handler haette sie dann nicht gespeichert. */
export function makeSortable(container, itemSelector, onReorder, { grid = false, keyAttr = "key" } = {}) {
  const keys = () => [...container.querySelectorAll(itemSelector)].map(el => el.dataset[keyAttr]);
  container.querySelectorAll(itemSelector).forEach(item => {
    item.addEventListener("dragstart", (e) => {
      item.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        // Firefox startet einen Drag nur, wenn Daten gesetzt sind.
        e.dataTransfer.setData("text/plain", item.dataset[keyAttr] || "");
      }
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      onReorder(keys());
    });
    item.addEventListener("dragover", (e) => {
      const dragging = container.querySelector(".dragging");
      if (!dragging || dragging === item) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = item.getBoundingClientRect();
      const before = grid
        ? (e.clientY < rect.top ? true : e.clientY > rect.bottom ? false : e.clientX < rect.left + rect.width / 2)
        : e.clientY < rect.top + rect.height / 2;
      item.parentElement.insertBefore(dragging, before ? item : item.nextSibling);
    });
  });
}

/* Zeigt eine fehlgeschlagene Aktion im Fehlerstreifen an (siehe #app-error in
   index.html). Vorher endete ein Fehler beim Laden einer Ansicht stumm: die
   Seite baute ihr Geruest auf, die Daten fehlten, und weder Kacheln noch eine
   Meldung erschienen - fuer den Nutzer nicht von "keine Daten vorhanden" zu
   unterscheiden.

   Der Streifen bleibt stehen, bis er weggeklickt wird oder eine neue Ansicht
   geladen wird (mountView ruft clearAppError) - nicht schon beim naechsten
   erfolgreichen Request, denn eine Ansicht laedt mehrere Endpoints, und ein
   spaeterer Erfolg macht die vorher fehlenden Daten nicht wieder sichtbar.
   textContent statt innerHTML: die Meldung kommt aus dem "detail" des Servers
   und kann einen Konto- oder Tag-Namen enthalten. */
export function showAppError(message) {
  const box = document.getElementById("app-error");
  if (!box) return;
  document.getElementById("app-error-text").textContent = message;
  box.hidden = false;
}

export function clearAppError() {
  const box = document.getElementById("app-error");
  if (box) box.hidden = true;
}

/* Scrollt ein Element in den sichtbaren Bereich und laesst es kurz aufblitzen -
   fuer Sprungziele aus der Sidebar-Unternavigation (Einstellungen-Karten,
   Konten-Karten, To-Do-Listen) und den bestehenden Sprung von "Vorlagen
   verwalten" im Journal-Editor zu den Einstellungen. Kein el.scrollIntoView():
   direkt nach einem innerHTML-Neuaufbau der Seite ermittelt Chromium den
   scrollbaren Vorfahren manchmal falsch und scrollt kurz die ganze Seite
   (inkl. Sidebar/Newsbar) statt nur .content - deshalb gezielt .content
   scrollen. */
export function scrollAndHighlight(el) {
  if (!el) return;
  const scrollHost = document.querySelector(".content");
  if (scrollHost) {
    const elRect = el.getBoundingClientRect();
    const hostRect = scrollHost.getBoundingClientRect();
    const target = scrollHost.scrollTop + (elRect.top - hostRect.top) - 12;
    scrollHost.scrollTo({ top: target, behavior: "smooth" });
  }
  el.classList.add("nav-jump-highlight");
  setTimeout(() => el.classList.remove("nav-jump-highlight"), 1600);
}

/* Ein-/ausklappbare Karten (".settings-card", siehe Einstellungen und
   Konten & Sync) - Zustand je Karte in localStorage gemerkt, ein eigener
   Storage-Key je Seite, damit beide Seiten unabhaengig voneinander ihren
   Auf-/Zugeklappt-Zustand behalten. Nur der jeweilige Body wird versteckt,
   die Kopfzeile (Titel + Pfeil) bleibt immer sichtbar. */
function loadCollapsedCardState(storageKey) {
  const saved = readStoredArray(storageKey);
  return new Set(saved || []);
}
function saveCollapsedCardState(storageKey, collapsedKeys) {
  writeStored(storageKey, [...collapsedKeys]);
}
export function initCollapsibleCards(root, storageKey) {
  const collapsed = loadCollapsedCardState(storageKey);
  root.querySelectorAll(".settings-card").forEach(card => {
    const key = card.dataset.settingsCard;
    card.classList.toggle("collapsed", collapsed.has(key));
    card.querySelector(".settings-card-header").addEventListener("click", () => {
      const nowCollapsed = card.classList.toggle("collapsed");
      if (nowCollapsed) collapsed.add(key); else collapsed.delete(key);
      saveCollapsedCardState(storageKey, collapsed);
    });
  });
}
/* Klappt eine einzelne Karte auf, falls sie eingeklappt ist (z.B. bevor sie
   hervorgehoben/angesprungen wird) - sonst saehe man das Sprungziel trotz
   Hervorhebung nicht. */
export function expandCollapsibleCard(storageKey, key) {
  const card = document.querySelector(`.settings-card[data-settings-card="${key}"]`);
  if (!card || !card.classList.contains("collapsed")) return;
  card.classList.remove("collapsed");
  const collapsed = loadCollapsedCardState(storageKey);
  collapsed.delete(key);
  saveCollapsedCardState(storageKey, collapsed);
}
/* Fuer "Alle aufklappen"/"Alle einklappen" im Seitenkopf. */
export function setAllCollapsibleCards(root, storageKey, collapsed) {
  const keys = [];
  root.querySelectorAll(".settings-card").forEach(card => {
    card.classList.toggle("collapsed", collapsed);
    keys.push(card.dataset.settingsCard);
  });
  saveCollapsedCardState(storageKey, collapsed ? keys : []);
}

document.getElementById("app-error-close")?.addEventListener("click", clearAppError);

/* Liest eine gespeicherte Liste (Reihenfolge, ausgeblendete Spalten, ...) aus
   dem localStorage. null, wenn nichts gespeichert ist ODER der Wert unbrauchbar
   ist - ein beschaedigter Eintrag darf hoechstens die gespeicherte Vorliebe
   kosten, nicht den Start der App: applyNavOrder() laeuft direkt beim Laden,
   ein Fehler dort haette die Initialisierung abgebrochen. Ersetzt vier Stellen,
   die JSON.parse ungeschuetzt aufriefen, waehrend zehn andere es bereits
   kapselten. */
export function readStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/* Gegenstueck zu readStoredArray(): ein voller localStorage (Quota) oder ein
   Browser, der Speichern verbietet, darf die Aktion selbst nicht scheitern
   lassen - die Auswahl gilt dann nur fuer diese Sitzung. */
export function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* Vorliebe nicht speicherbar - kein Grund abzubrechen */ }
}
