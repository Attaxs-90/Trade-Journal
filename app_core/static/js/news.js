/* Newsbar mit dem ForexFactory-Wirtschaftskalender. */

import { api, escapeHtml, state } from './core.js';

/* ---------- Newsbar (ForexFactory-Wirtschaftskalender) ---------- */

export const NEWS_IMPACT_LEVELS = [
  { key: "High", label: "High Impact" },
  { key: "Medium", label: "Medium Impact" },
  { key: "Low", label: "Low Impact" },
  { key: "Holiday", label: "Non-Economic / Holiday" },
];
export const NEWS_CURRENCIES = ["AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "JPY", "NZD", "USD"];
export const NEWS_EVENT_TYPES = ["Growth", "Housing", "Inflation", "Consumer Surveys", "Employment", "Business Surveys", "Central Bank", "Speeches", "Bonds", "Misc"];

const newsFilterState = {
  impact: new Set(NEWS_IMPACT_LEVELS.map(l => l.key)),
  currency: new Set(NEWS_CURRENCIES),
  type: new Set(NEWS_EVENT_TYPES),
  ftmo: new Set(["on"]),
  ftmoHighlight: new Set(["on"]),
};
let newsEvents = [];
let newsLoadFailed = false;

function loadNewsFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("newsCalendarFilter") || "null");
    if (saved) {
      if (Array.isArray(saved.impact)) newsFilterState.impact = new Set(saved.impact);
      if (Array.isArray(saved.currency)) newsFilterState.currency = new Set(saved.currency);
      if (Array.isArray(saved.type)) newsFilterState.type = new Set(saved.type);
      if (Array.isArray(saved.ftmo)) newsFilterState.ftmo = new Set(saved.ftmo);
      if (Array.isArray(saved.ftmoHighlight)) newsFilterState.ftmoHighlight = new Set(saved.ftmoHighlight);
    }
  } catch (e) { /* ignore */ }
}
function saveNewsFilterState() {
  localStorage.setItem("newsCalendarFilter", JSON.stringify({
    impact: [...newsFilterState.impact], currency: [...newsFilterState.currency], type: [...newsFilterState.type],
    ftmo: [...newsFilterState.ftmo], ftmoHighlight: [...newsFilterState.ftmoHighlight],
  }));
}

export function impactColorVar(impact) {
  const cs = getComputedStyle(document.documentElement);
  const map = { High: "--impact-high", Medium: "--impact-medium", Low: "--impact-low" };
  return cs.getPropertyValue(map[impact] || "--impact-none").trim();
}

/* Wiederverwendbarer Impact/Kategorie/Waehrung-Chip-Filter - dieselbe Optik
   und Bedienung fuer Newsbar-Panel UND das News-Einstellungen-Panel der
   Monatsuebersicht (siehe calendar.js), damit sich beide identisch anfuehlen
   statt zwei unabhaengige Filter-UIs zu pflegen. panelEl ist der Container,
   der sowohl die drei Chip-Reihen als auch die "alle/keine"-Links enthaelt.
   Listener werden nur einmal verdrahtet (dataset-Flag) - die Funktion wird
   z.B. bei jedem Theme-Wechsel erneut aufgerufen (siehe chrome.js), um die
   Impact-Punktfarben aufzufrischen, ohne bei jedem Aufruf weitere Listener
   auf denselben Elementen zu stapeln. */
export function renderImpactTypeCurrencyChips(panelEl, ids, filterState, onChange) {
  const impactEl = panelEl.querySelector(`#${ids.impact}`);
  const typeEl = panelEl.querySelector(`#${ids.type}`);
  const currencyEl = panelEl.querySelector(`#${ids.currency}`);

  const renderChips = () => {
    impactEl.innerHTML = NEWS_IMPACT_LEVELS.map(lvl => `
      <button type="button" class="newsbar-chip${filterState.impact.has(lvl.key) ? " active" : ""}" data-group="impact" data-key="${lvl.key}" title="${lvl.label}">
        <span class="newsbar-chip-dot" style="background:${impactColorVar(lvl.key)}"></span>${lvl.key}
      </button>
    `).join("");
    typeEl.innerHTML = NEWS_EVENT_TYPES.map(t => `
      <button type="button" class="newsbar-chip${filterState.type.has(t) ? " active" : ""}" data-group="type" data-key="${t}">${t}</button>
    `).join("");
    currencyEl.innerHTML = NEWS_CURRENCIES.map(c => `
      <button type="button" class="newsbar-chip${filterState.currency.has(c) ? " active" : ""}" data-group="currency" data-key="${c}">${c}</button>
    `).join("");
  };
  renderChips();

  if (panelEl.dataset.chipsWired) return;
  panelEl.dataset.chipsWired = "1";

  function toggleChip(e) {
    const chip = e.target.closest(".newsbar-chip");
    if (!chip) return;
    const group = chip.dataset.group, key = chip.dataset.key;
    if (filterState[group].has(key)) filterState[group].delete(key); else filterState[group].add(key);
    chip.classList.toggle("active");
    onChange();
  }
  impactEl.addEventListener("click", toggleChip);
  typeEl.addEventListener("click", toggleChip);
  currencyEl.addEventListener("click", toggleChip);

  panelEl.querySelectorAll("a[data-filter]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const group = a.dataset.filter, mode = a.dataset.mode;
      const source = group === "impact" ? NEWS_IMPACT_LEVELS.map(l => l.key) : group === "currency" ? NEWS_CURRENCIES : NEWS_EVENT_TYPES;
      filterState[group] = new Set(mode === "all" ? source : []);
      renderChips();
      onChange();
    });
  });
}

export function renderNewsFilters() {
  const panel = document.getElementById("newsbar-filter-panel");
  renderImpactTypeCurrencyChips(
    panel,
    { impact: "newsbar-filter-impact", type: "newsbar-filter-types", currency: "newsbar-filter-currencies" },
    newsFilterState,
    () => { saveNewsFilterState(); renderNewsSections(); },
  );

  const ftmoWrap = document.getElementById("newsbar-filter-ftmo");
  ftmoWrap.innerHTML = `
    <button type="button" class="newsbar-chip${newsFilterState.ftmo.has("on") ? " active" : ""}" data-group="ftmo" data-key="on" title="FTMO Restricted Events (2 Min. vor/nach kein Trade erlaubt) anzeigen/ausblenden">❗ FTMO News</button>
    <button type="button" class="newsbar-chip${newsFilterState.ftmoHighlight.has("on") ? " active" : ""}" data-group="ftmoHighlight" data-key="on" title="FTMO Restricted Events rot hinterlegen">Rot hervorheben</button>
  `;
  ftmoWrap.querySelectorAll(".newsbar-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.group, key = chip.dataset.key;
      if (newsFilterState[group].has(key)) newsFilterState[group].delete(key); else newsFilterState[group].add(key);
      chip.classList.toggle("active");
      saveNewsFilterState();
      renderNewsSections();
    });
  });
}

function ftmoMarkerHtml(e) {
  if (!e.ftmo_status) return "";
  const hint = e.ftmo_status === "unverified"
    ? "FTMO Restricted Event (laut FTMO-FAQ, nicht live verifiziert) - 2 Min. vor/nach kein Trade"
    : "FTMO Restricted Event - 2 Min. vor/nach kein Trade";
  return `<span class="news-row-ftmo" title="${escapeHtml(hint)}">❗</span>`;
}

function newsRowHtml(e, showFtmo) {
  const dt = new Date(e.time);
  const weekday = dt.toLocaleDateString("de-DE", { weekday: "short" });
  const time = dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const highlight = showFtmo && e.ftmo_status && newsFilterState.ftmoHighlight.has("on");
  return `
    <a class="news-row${highlight ? " news-row-ftmo-highlight" : ""}" href="${escapeHtml(e.ff_url)}" target="_blank" rel="noopener" title="${escapeHtml(e.title)}">
      <div class="news-row-line1">
        <span class="news-row-dot" style="background:${impactColorVar(e.impact)}"></span>
        <span class="news-row-time">${weekday} ${time}</span>
        <span class="news-row-currency">${escapeHtml(e.currency)}</span>
        <span class="news-row-title">${escapeHtml(e.title)}</span>
        ${showFtmo ? ftmoMarkerHtml(e) : ""}
      </div>
    </a>`;
}

function fillNewsList(elId, events, emptyMsg, showFtmo = false) {
  const el = document.getElementById(elId);
  el.innerHTML = events.length ? events.map(e => newsRowHtml(e, showFtmo)).join("") : `<div class="empty-state">${emptyMsg}</div>`;
}

export function renderNewsSections() {
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today0 = startOfDay(now);
  // Montag der laufenden Woche (getDay(): 0=So..6=Sa) bis Samstag 00:00 (exklusiv) -
  // deckt Montag bis Freitag ab, unabhaengig davon ob der Tag schon vorbei ist.
  const mondayOffset = (today0.getDay() + 6) % 7;
  const monday0 = new Date(today0); monday0.setDate(monday0.getDate() - mondayOffset);
  const saturday0 = new Date(monday0); saturday0.setDate(saturday0.getDate() + 5);
  // Naechste Woche direkt daran anschliessend - der Feed liefert sowohl
  // ff_calendar_thisweek als auch ff_calendar_nextweek (siehe news.py).
  const nextMonday0 = new Date(saturday0); nextMonday0.setDate(nextMonday0.getDate() + 2);
  const nextSaturday0 = new Date(nextMonday0); nextSaturday0.setDate(nextSaturday0.getDate() + 5);
  // Die Woche gilt als abgeschlossen ab Freitag 22 Uhr (Forex-Handelsschluss),
  // nicht erst am naechsten Montag 00:00 - sonst zeigt "Diese Woche" das ganze
  // Wochenende ueber noch die bereits vergangene Woche an (Nutzer-Feedback).
  const weekCutoff = new Date(monday0); weekCutoff.setDate(weekCutoff.getDate() + 4); weekCutoff.setHours(22, 0, 0, 0);
  const weekConcluded = now >= weekCutoff;

  const filtered = newsEvents.filter(e =>
    newsFilterState.impact.has(e.impact) && newsFilterState.currency.has(e.currency) && newsFilterState.type.has(e.event_type) &&
    (newsFilterState.ftmo.has("on") || !e.ftmo_status)
  );

  const week = [], nextWeek = [], hot = [], history = [];
  for (const e of filtered) {
    const t = new Date(e.time);
    const day0 = startOfDay(t);
    const inCurrentWeekRange = day0 >= monday0 && day0 < saturday0;
    if (inCurrentWeekRange && !weekConcluded) week.push(e);
    else if (day0 >= nextMonday0 && day0 < nextSaturday0) nextWeek.push(e);
    if (day0.getTime() === today0.getTime() && t < now) hot.push(e);
    else if (day0 < monday0 || (inCurrentWeekRange && weekConcluded)) history.push(e);
  }
  week.sort((a, b) => new Date(a.time) - new Date(b.time));
  nextWeek.sort((a, b) => new Date(a.time) - new Date(b.time));
  hot.sort((a, b) => new Date(b.time) - new Date(a.time));
  history.sort((a, b) => new Date(b.time) - new Date(a.time));

  // Unabhaengig von allen Filtern (auch dem FTMO-Sichtbarkeits-Filter) - der
  // Zweck ist eine Erinnerung im eingeklappten Zustand, die nicht durch eine
  // enge Filterauswahl verschwinden darf. Deckt diese UND naechste Woche ab.
  const weekHasFtmo = newsEvents.some(e => {
    const day0 = startOfDay(new Date(e.time));
    const inCurrentWeekRange = day0 >= monday0 && day0 < saturday0;
    return ((inCurrentWeekRange && !weekConcluded) || (day0 >= nextMonday0 && day0 < nextSaturday0)) && e.ftmo_status;
  });
  document.getElementById("newsbar-icon-alert").hidden = !weekHasFtmo;

  const emptyMsg = newsLoadFailed && !newsEvents.length ? "Kalender aktuell nicht erreichbar." : "Keine Termine.";
  fillNewsList("news-upcoming", week, emptyMsg, true);
  fillNewsList("news-nextweek", nextWeek, emptyMsg, true);
  fillNewsList("news-hot", hot.slice(0, 30), emptyMsg);
  fillNewsList("news-history", history.slice(0, 60), emptyMsg);
}

async function loadNews() {
  try {
    const data = await api("/api/news/calendar");
    newsEvents = data.events || [];
    newsLoadFailed = false;
  } catch (e) {
    newsLoadFailed = true;
  }
  renderNewsSections();
}

export function initNewsbar() {
  const collapseBtn = document.getElementById("newsbar-collapse");
  const apply = (collapsed) => {
    if (collapsed) document.documentElement.setAttribute("data-newsbar", "collapsed");
    else document.documentElement.removeAttribute("data-newsbar");
  };
  apply(localStorage.getItem("newsbarCollapsed") === "true");
  collapseBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-newsbar") !== "collapsed";
    localStorage.setItem("newsbarCollapsed", String(next));
    apply(next);
  });
  document.querySelector(".newsbar-icon").addEventListener("click", () => {
    if (document.documentElement.getAttribute("data-newsbar") === "collapsed") {
      localStorage.setItem("newsbarCollapsed", "false");
      apply(false);
    }
  });

  // Ein-/ausklappbare Newsbar-Sektion (Historie, Naechste Woche). defaultCollapsed
  // greift nur, solange der Nutzer noch keine eigene Wahl gespeichert hat.
  function initNewsSectionCollapse(toggleId, listId, storageKey, defaultCollapsed) {
    const toggle = document.getElementById(toggleId);
    const list = document.getElementById(listId);
    const apply = (collapsed) => {
      list.classList.toggle("collapsed", collapsed);
      toggle.classList.toggle("collapsed", collapsed);
    };
    const saved = localStorage.getItem(storageKey);
    apply(saved === null ? defaultCollapsed : saved === "true");
    toggle.addEventListener("click", () => {
      const next = !list.classList.contains("collapsed");
      localStorage.setItem(storageKey, String(next));
      apply(next);
    });
  }

  const filterBtn = document.getElementById("newsbar-filter-btn");
  const panel = document.getElementById("newsbar-filter-panel");
  filterBtn.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  initNewsSectionCollapse("news-history-toggle", "news-history", "newsHistoryCollapsed", true);
  initNewsSectionCollapse("news-nextweek-toggle", "news-nextweek", "newsNextWeekCollapsed", false);

  loadNewsFilterState();
  renderNewsFilters();
  loadNews();
  setInterval(loadNews, 5 * 60 * 1000);
}
