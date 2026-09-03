/* Globaler Konten- und Tag-Filter (Sidebar, Uebersicht, Trades, Journal). */

import { renderAllAnalyticsWidgets } from './analytics.js';
import { renderMonth } from './calendar.js';
import { api, escapeHtml, state, tagTextColor } from './core.js';
import { openJournal } from './journal.js';
import { openOverview, openTrades } from './overview.js';
import { populateDay } from './share.js';

/* ---------- Konten-Filter ---------- */

export function loadFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("accountFilter") || "null");
    if (saved && saved.mode) {
      state.filterMode = saved.mode;
      state.filterKeys = saved.keys || [];
    }
  } catch (e) { /* ignore */ }
}
function saveFilterState() {
  localStorage.setItem("accountFilter", JSON.stringify({ mode: state.filterMode, keys: state.filterKeys }));
  renderSidebarAccountStatus();
}

/* ---------- Tags-Filter ---------- */

export function loadTagFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("tagFilter") || "null");
    if (saved && saved.mode) {
      state.tagFilterMode = saved.mode;
      state.tagFilterKeys = saved.keys || [];
      state.tagFilterLogic = saved.logic || "or";
    }
  } catch (e) { /* ignore */ }
}
function saveTagFilterState() {
  localStorage.setItem("tagFilter", JSON.stringify({
    mode: state.tagFilterMode, keys: state.tagFilterKeys, logic: state.tagFilterLogic,
  }));
}

export async function getAccountOptions() {
  return api("/api/account-options");
}

/* Rendert den Konten-Filter in ein Inline-Panel. Kein-Op, wenn das Panel
   gerade nicht im DOM ist (View nicht aktiv). panelId/countId parametrisiert,
   weil neben der Uebersicht auch die Auswertungsseite ihr eigenes Panel-Paar
   hat - gleiche Logik, andere IDs, statt einer zweiten Kopie dieser Funktion. */
export async function renderAccountFilter(panelId = "ov-account-filter-panel", countId = "ov-account-filter-count") {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const options = await getAccountOptions();
  panel.innerHTML = "";
  const rerender = () => renderAccountFilter(panelId, countId);

  const countBadge = document.getElementById(countId);
  if (countBadge) countBadge.textContent = state.filterMode === "selected" && state.filterKeys.length ? `(${state.filterKeys.length})` : "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox"> Alle Konten`;
  panel.appendChild(masterLabel);
  const masterInput = masterLabel.querySelector("input");
  masterInput.checked = state.filterMode === "all";
  masterInput.addEventListener("change", () => {
    state.filterMode = "all";
    state.filterKeys = [];
    saveFilterState();
    rerender();
    refreshCurrentView();
  });

  if (!options.length) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.style.padding = "6px 0";
    hint.textContent = "Noch keine Konten/Importe.";
    panel.appendChild(hint);
    return;
  }

  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "filter-item";
    label.innerHTML = `<input type="checkbox" data-key="${opt.key}"> ${opt.name}`;
    const input = label.querySelector("input");
    input.checked = state.filterMode === "selected" && state.filterKeys.includes(opt.key);
    input.addEventListener("change", () => {
      const checked = Array.from(panel.querySelectorAll("input[data-key]:checked")).map(i => i.dataset.key);
      if (!checked.length) {
        state.filterMode = "all";
        state.filterKeys = [];
      } else {
        state.filterMode = "selected";
        state.filterKeys = checked;
      }
      saveFilterState();
      rerender();
      refreshCurrentView();
    });
    panel.appendChild(label);
  }
}

/* Konten-Filter der Uebersicht als direkt sichtbare Klick-Chips statt eines
   Dropdown-Panels - alle gesyncten Konten stehen sofort da, ein Klick waehlt
   an/ab. Baut auf demselben --tag-color-Mechanismus wie .tag-chip-filter auf
   (siehe style.css), nur mit --accent statt einer Tag-Farbe. */
function accountChipEl(label, active, onClick) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tag-chip-filter" + (active ? " active" : "");
  chip.style.setProperty("--tag-color", "var(--accent)");
  chip.style.setProperty("--tag-chip-text", "#fff");
  chip.textContent = label;
  chip.addEventListener("click", onClick);
  return chip;
}

export async function renderAccountChipRow(containerId) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const options = await getAccountOptions();
  wrap.innerHTML = "";
  const rerender = () => renderAccountChipRow(containerId);

  wrap.appendChild(accountChipEl("Alle Konten", state.filterMode === "all", () => {
    state.filterMode = "all";
    state.filterKeys = [];
    saveFilterState();
    rerender();
    refreshCurrentView();
  }));

  if (!options.length) {
    const hint = document.createElement("span");
    hint.className = "account-chip-row-empty";
    hint.textContent = "Noch keine Konten/Importe.";
    wrap.appendChild(hint);
    return;
  }

  for (const opt of options) {
    const active = state.filterMode === "selected" && state.filterKeys.includes(opt.key);
    wrap.appendChild(accountChipEl(opt.name, active, () => {
      const current = new Set(state.filterMode === "selected" ? state.filterKeys : []);
      if (current.has(opt.key)) current.delete(opt.key); else current.add(opt.key);
      if (!current.size) {
        state.filterMode = "all";
        state.filterKeys = [];
      } else {
        state.filterMode = "selected";
        state.filterKeys = [...current];
      }
      saveFilterState();
      rerender();
      refreshCurrentView();
    }));
  }
}

/* Globaler Konten-Filter-Status in der Sidebar - auf jeder Seite sichtbar
   (die Sidebar bleibt beim View-Wechsel bestehen), damit ein aktiver Filter
   nicht "unsichtbar" auf einer anderen Seite als der Uebersicht weiterwirkt.
   Wird bei jeder Filteraenderung ueber saveFilterState() sowie einmal beim
   Start aufgerufen. */
export async function renderSidebarAccountStatus() {
  const chipsWrap = document.getElementById("sidebar-account-status-chips");
  if (!chipsWrap) return;
  chipsWrap.innerHTML = "";

  if (state.filterMode !== "selected" || !state.filterKeys.length) {
    chipsWrap.innerHTML = `<span class="sidebar-account-status-chip muted">Alle Konten</span>`;
    return;
  }

  const options = await getAccountOptions();
  const nameByKey = new Map(options.map(o => [o.key, o.name]));
  const names = state.filterKeys.map(k => nameByKey.get(k) || (k === "csv" ? "Nicht zugeordnet" : `Konto ${k}`));

  const MAX_SHOWN = 3;
  for (const name of names.slice(0, MAX_SHOWN)) {
    const chip = document.createElement("span");
    chip.className = "sidebar-account-status-chip";
    chip.textContent = name;
    chipsWrap.appendChild(chip);
  }
  if (names.length > MAX_SHOWN) {
    const more = document.createElement("span");
    more.className = "sidebar-account-status-chip sidebar-account-status-chip-more";
    more.textContent = `+${names.length - MAX_SHOWN}`;
    chipsWrap.appendChild(more);
  }
}

/* Schliesst ein Inline-Filter-Panel (Konten-Filter, Spalten-Auswahl, ...) bei
   Klick ausserhalb - ein Listener fuer alle .inline-filter-panel-Paare statt
   einem eigenen pro Panel. */
function initInlineFilterToggles() {
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".inline-filter-panel").forEach(panel => {
      if (panel.hidden) return;
      const toggle = panel.previousElementSibling;
      if (!panel.contains(e.target) && e.target !== toggle && !toggle?.contains(e.target)) panel.hidden = true;
    });
  });
}
initInlineFilterToggles();

let cachedTags = null;
export async function getTags(force = false) {
  if (force || !cachedTags) cachedTags = await api("/api/tags");
  return cachedTags;
}
export function invalidateTagsCache() { cachedTags = null; }

/* Baut die nach tag_group gruppierten Tag-Chips (Vorbild: Marktnews-Filterchips).
   Genutzt vom Tag-Filter der Trades-Seite, vom Journal-Filter und von der
   Tag-Auswahl im Journal-Editor - eine Darstellung fuer alle drei Orte. */
export function buildTagChipGroups(tags, isActive, onToggle) {
  const frag = document.createDocumentFragment();
  const byGroup = new Map();
  for (const t of tags) {
    const g = t.tag_group || "Ohne Gruppe";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }
  for (const [group, groupTags] of byGroup) {
    const block = document.createElement("div");
    block.className = "tag-filter-group";
    block.innerHTML = `<div class="tag-filter-group-title">${escapeHtml(group)}</div><div class="newsbar-chip-row"></div>`;
    const row = block.querySelector(".newsbar-chip-row");
    for (const tag of groupTags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip-filter" + (isActive(tag) ? " active" : "");
      chip.dataset.key = tag.id;
      chip.style.setProperty("--tag-color", tag.color);
      chip.style.setProperty("--tag-chip-text", tagTextColor(tag.color));
      chip.textContent = tag.name;
      chip.addEventListener("click", () => onToggle(tag, chip));
      row.appendChild(chip);
    }
    frag.appendChild(block);
  }
  return frag;
}

/* Tag-Filter als Klick-Chips gruppiert nach tag_group, Vorbild die
   Marktnews-Filterchips (.newsbar-chip) statt Checkboxen. listId/logicToggleId
   parametrisiert, weil die Auswertungsseite ihr eigenes Tag-Filter-Panel hat -
   gleiche Logik, andere Container, statt einer zweiten Kopie dieser Funktion. */
export async function renderTagFilter(listId = "trades-tag-filter-list", logicToggleId = "trades-tag-logic-toggle") {
  const wrap = document.getElementById(listId);
  if (!wrap) return;
  const tags = await getTags();
  wrap.innerHTML = "";
  const rerender = () => renderTagFilter(listId, logicToggleId);

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "tag-filter-all-chip" + (state.tagFilterMode === "all" ? " active" : "");
  allBtn.textContent = "Alle Tags";
  allBtn.addEventListener("click", () => {
    state.tagFilterMode = "all";
    state.tagFilterKeys = [];
    saveTagFilterState();
    rerender();
    refreshCurrentView();
  });
  wrap.appendChild(allBtn);

  if (!tags.length) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.style.padding = "6px 0";
    hint.textContent = "Noch keine Tags angelegt.";
    wrap.appendChild(hint);
  } else {
    wrap.appendChild(buildTagChipGroups(
      tags,
      (tag) => state.tagFilterMode === "selected" && state.tagFilterKeys.includes(String(tag.id)),
      (tag) => {
        const current = new Set(state.tagFilterMode === "selected" ? state.tagFilterKeys : []);
        if (current.has(String(tag.id))) current.delete(String(tag.id)); else current.add(String(tag.id));
        if (!current.size) {
          state.tagFilterMode = "all";
          state.tagFilterKeys = [];
        } else {
          state.tagFilterMode = "selected";
          state.tagFilterKeys = [...current];
        }
        saveTagFilterState();
        rerender();
        refreshCurrentView();
      },
    ));
  }

  document.querySelectorAll(`#${logicToggleId} .tag-logic-btn`).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.logic === state.tagFilterLogic);
    btn.onclick = () => {
      state.tagFilterLogic = btn.dataset.logic;
      saveTagFilterState();
      rerender();
      refreshCurrentView();
    };
  });
}

export function refreshCurrentView() {
  if (state.view === "overview") openOverview();
  else if (state.view === "journal") openJournal();
  else if (state.view === "trades") openTrades(state.tradesPage || 1);
  else if (state.view === "month") renderMonth();
  else if (state.view === "day" && state.currentDay) populateDay(document.getElementById("content"), state.currentDay);
  else if (state.view === "analytics") renderAllAnalyticsWidgets();
}
