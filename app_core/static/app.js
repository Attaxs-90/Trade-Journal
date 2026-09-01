const state = {
  view: "overview", currentDay: null,
  filterMode: "all", filterKeys: [],
  tagFilterMode: "all", tagFilterKeys: [], tagFilterLogic: "or",
  // Journal hat einen eigenen Tag-Filter: er filtert Journal-Eintraege, nicht
  // Trades, und darf die Auswertungsseiten deshalb nicht mitbeeinflussen.
  journalMode: "all", journalQuery: "", journalSearchScope: "journal", journalTagKeys: [], journalRefKey: null,
  journalMonth: null, journalTab: "diary",
  journalSelectedKeys: new Set(),
  notebookExpanded: new Set(), notebookSelectedId: null,
  analyticsRange: { start: null, end: null },
};

/* ---------- Konten-Filter ---------- */

function loadFilterState() {
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
function accountsQS() {
  if (state.filterMode !== "selected" || !state.filterKeys.length) return "";
  return `accounts=${encodeURIComponent(state.filterKeys.join(","))}`;
}

/* ---------- Tags-Filter ---------- */

function loadTagFilterState() {
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
function tagsQS() {
  if (state.tagFilterMode !== "selected" || !state.tagFilterKeys.length) return "";
  return `tags=${encodeURIComponent(state.tagFilterKeys.join(","))}&tag_logic=${state.tagFilterLogic}`;
}

function withFilter(url) {
  const parts = [accountsQS(), tagsQS()].filter(Boolean);
  if (!parts.length) return url;
  return url + (url.includes("?") ? "&" : "?") + parts.join("&");
}

async function getAccountOptions() {
  return api("/api/account-options");
}

/* Rendert den Konten-Filter in ein Inline-Panel. Kein-Op, wenn das Panel
   gerade nicht im DOM ist (View nicht aktiv). panelId/countId parametrisiert,
   weil neben der Uebersicht auch die Auswertungsseite ihr eigenes Panel-Paar
   hat - gleiche Logik, andere IDs, statt einer zweiten Kopie dieser Funktion. */
async function renderAccountFilter(panelId = "ov-account-filter-panel", countId = "ov-account-filter-count") {
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

async function renderAccountChipRow(containerId) {
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
async function renderSidebarAccountStatus() {
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
async function getTags(force = false) {
  if (force || !cachedTags) cachedTags = await api("/api/tags");
  return cachedTags;
}
function invalidateTagsCache() { cachedTags = null; }

/* Baut die nach tag_group gruppierten Tag-Chips (Vorbild: Marktnews-Filterchips).
   Genutzt vom Tag-Filter der Trades-Seite, vom Journal-Filter und von der
   Tag-Auswahl im Journal-Editor - eine Darstellung fuer alle drei Orte. */
function buildTagChipGroups(tags, isActive, onToggle) {
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
async function renderTagFilter(listId = "trades-tag-filter-list", logicToggleId = "trades-tag-logic-toggle") {
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

function refreshCurrentView() {
  if (state.view === "overview") openOverview();
  else if (state.view === "journal") openJournal();
  else if (state.view === "trades") openTrades(state.tradesPage || 1);
  else if (state.view === "month") renderMonth();
  else if (state.view === "day" && state.currentDay) populateDay(document.getElementById("content"), state.currentDay);
  else if (state.view === "analytics") renderAllAnalyticsWidgets();
}

/* ---------- Theme ---------- */

const ICON_SUN = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const ICON_MOON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const apply = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    btn.innerHTML = theme === "light" ? ICON_SUN : ICON_MOON;
  };
  apply(localStorage.getItem("theme") || "dark");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    apply(next);
    // Die Equity-Kurve und die Newsbar-Impact-Farben backen Theme-Farben als
    // feste Werte ein (per getComputedStyle beim Rendern) - ohne Neuzeichnen
    // blieben nach einem Theme-Wechsel die alten Farben stehen.
    refreshCurrentView();
    if (typeof renderNewsFilters === "function") { renderNewsFilters(); renderNewsSections(); }
  });
}
initTheme();

/* ---------- Sidebar ein-/ausklappen ---------- */

function initSidebarCollapse() {
  const btn = document.getElementById("sidebar-collapse");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-sidebar") !== "collapsed";
    document.documentElement.setAttribute("data-sidebar", next ? "collapsed" : "expanded");
    localStorage.setItem("sidebarCollapsed", String(next));
  });
}
initSidebarCollapse();

/* ---------- Globaler Sync-Button ---------- */

function initGlobalSync() {
  const btn = document.getElementById("global-sync-btn");
  const defaultTitle = btn.title;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("syncing");
    btn.title = "Synchronisiere…";
    try {
      const [accounts, platforms] = await Promise.all([api("/api/accounts"), getPlatforms()]);
      const autoAccounts = accounts.filter(acc => {
        const p = platforms.find(pl => pl.key === acc.platform);
        return p && !p.manual;
      });
      if (!autoAccounts.length) {
        btn.title = "Keine automatisch synchronisierbaren Konten verbunden.";
        return;
      }
      let inserted = 0, failed = 0;
      for (const acc of autoAccounts) {
        try {
          const res = await api(`/api/accounts/${acc.id}/sync`, { method: "POST" });
          inserted += res.inserted;
        } catch (err) {
          failed++;
        }
      }
      btn.title = failed
        ? `${inserted} neue Trades importiert, ${failed} Konto(en) fehlgeschlagen.`
        : `${inserted} neue Trades importiert.`;
      await renderAccountFilter();
      refreshCurrentView();
      if (state.view === "accounts") await renderAccounts();
    } finally {
      btn.disabled = false;
      btn.classList.remove("syncing");
      setTimeout(() => { btn.title = defaultTitle; }, 4000);
    }
  });
}
initGlobalSync();

/* ---------- Schriftart ---------- */

const FONT_OPTIONS = [
  { key: "system", name: "Standard (System)", stack: "-apple-system, 'Segoe UI', Inter, Roboto, sans-serif" },
  { key: "mono", name: "Monospace (Terminal)", stack: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace" },
  { key: "serif", name: "Serif (Editorial)", stack: "Georgia, 'Times New Roman', Times, serif" },
  { key: "verdana", name: "Verdana (Klar & breit)", stack: "Verdana, Tahoma, Geneva, sans-serif" },
  { key: "trebuchet", name: "Trebuchet (Rund & modern)", stack: "'Trebuchet MS', 'Century Gothic', sans-serif" },
];

function applyFont(key) {
  document.documentElement.setAttribute("data-font", key);
}

function renderFontSettings() {
  const grid = document.getElementById("font-grid");
  const current = localStorage.getItem("fontOption") || "system";
  grid.innerHTML = "";
  for (const opt of FONT_OPTIONS) {
    const card = document.createElement("button");
    card.className = "font-card" + (opt.key === current ? " active" : "");
    card.style.fontFamily = opt.stack;
    card.innerHTML = `
      <div class="font-name">${opt.name}</div>
      <div class="font-preview-title">Aa Bb Trade Journal</div>
      <div class="font-preview-body">Der schnelle Fuchs springt über den Handelstag.</div>
      <div class="font-preview-nums">253,84 $ · 14,00 Pkt · -114,36 $</div>
    `;
    card.addEventListener("click", () => {
      localStorage.setItem("fontOption", opt.key);
      applyFont(opt.key);
      renderFontSettings();
    });
    grid.appendChild(card);
  }
}

/* Ein-/ausklappbare Karten der Einstellungen - Zustand je Karte (per
   data-settings-card-Key) in localStorage gemerkt, analog zu Sidebar-/
   Newsbar-Einklappzustand. Nur der jeweilige Body wird versteckt, die
   Kopfzeile (Titel + Pfeil) bleibt immer sichtbar. */
function loadSettingsCollapsedState() {
  try {
    const saved = JSON.parse(localStorage.getItem("settingsCollapsed") || "null");
    return Array.isArray(saved) ? new Set(saved) : new Set();
  } catch (e) {
    return new Set();
  }
}
function saveSettingsCollapsedState(collapsedKeys) {
  localStorage.setItem("settingsCollapsed", JSON.stringify([...collapsedKeys]));
}
function initSettingsCollapse(content) {
  const collapsed = loadSettingsCollapsedState();
  content.querySelectorAll(".settings-card").forEach(card => {
    const key = card.dataset.settingsCard;
    card.classList.toggle("collapsed", collapsed.has(key));
    card.querySelector(".settings-card-header").addEventListener("click", () => {
      const nowCollapsed = card.classList.toggle("collapsed");
      if (nowCollapsed) collapsed.add(key); else collapsed.delete(key);
      saveSettingsCollapsedState(collapsed);
    });
  });
}
/* Klappt eine einzelne Settings-Karte auf, falls sie eingeklappt ist (z.B.
   bevor sie hervorgehoben/angesprungen wird) - sonst saehe der Nutzer den
   Sprungziel-Inhalt trotz Hervorhebung nicht. */
function expandSettingsCard(key) {
  const card = document.querySelector(`.settings-card[data-settings-card="${key}"]`);
  if (!card || !card.classList.contains("collapsed")) return;
  card.classList.remove("collapsed");
  const collapsed = loadSettingsCollapsedState();
  collapsed.delete(key);
  saveSettingsCollapsedState(collapsed);
}

async function openSettings() {
  state.view = "settings";
  state.currentDay = null;
  setActiveNav("settings");

  const content = await mountView("tpl-settings");
  initSettingsCollapse(content);
  renderFontSettings();
  await renderSettingsAccountDelete();
  await renderTagsSettings();
  await renderJournalTemplatesSettings();
}

/* Springt aus dem Journal-Editor direkt zur Vorlagenverwaltung in den
   Einstellungen und hebt die Karte kurz hervor, damit sie sofort auffindbar
   ist statt in der Seite gesucht werden zu muessen. */
async function goToJournalTemplateSettings() {
  await flushJournal();
  document.getElementById("modal-overlay").classList.remove("visible");
  await openSettings();
  expandSettingsCard("journal-templates");
  const card = document.getElementById("journal-templates-card");
  // Kein card.scrollIntoView(): direkt nach dem innerHTML-Neuaufbau der Seite
  // ermittelt Chromium den scrollbaren Vorfahren manchmal falsch und scrollt
  // kurz die ganze Seite (inkl. Sidebar/Newsbar) statt nur .content - deshalb
  // stattdessen gezielt .content scrollen.
  const scrollHost = document.querySelector(".content");
  if (card && scrollHost) {
    const cardRect = card.getBoundingClientRect();
    const hostRect = scrollHost.getBoundingClientRect();
    const target = scrollHost.scrollTop + (cardRect.top - hostRect.top) - 12;
    scrollHost.scrollTo({ top: target, behavior: "smooth" });
  }
  card?.classList.add("settings-card-highlight");
  setTimeout(() => card?.classList.remove("settings-card-highlight"), 1600);
}

/* ---------- Journal-Vorlagen (Einstellungen) ---------- */

async function renderJournalTemplatesSettings() {
  initQuillFormats();
  const host = document.getElementById("journal-tpl-editor");
  host.innerHTML = `<div class="journal-quill"></div>`;
  const tplQuill = new Quill(host.querySelector(".journal-quill"), {
    theme: "snow",
    placeholder: "Struktur der Vorlage – Überschriften, Listen, Platzhalter…",
    modules: { toolbar: { container: JOURNAL_TOOLBAR } },
  });

  const form = document.getElementById("journal-tpl-form");
  const nameInput = document.getElementById("journal-tpl-name");
  const submitBtn = document.getElementById("journal-tpl-submit");
  const cancelBtn = document.getElementById("journal-tpl-cancel");
  let editingId = null;
  let editingPosition = 0;

  const resetForm = () => {
    editingId = null;
    editingPosition = 0;
    nameInput.value = "";
    tplQuill.setContents([]);
    submitBtn.textContent = "Vorlage anlegen";
    cancelBtn.hidden = true;
  };

  const renderList = async () => {
    const templates = await getJournalTemplates(true);
    const list = document.getElementById("journal-tpl-list");
    list.innerHTML = "";
    if (!templates.length) {
      list.innerHTML = `<div class="empty-state">Noch keine Vorlagen angelegt.</div>`;
      return;
    }
    for (const tpl of templates) {
      const row = document.createElement("div");
      row.className = "tag-row";
      row.innerHTML = `
        <div class="tag-row-name">${escapeHtml(tpl.name)}</div>
        <div class="tag-row-actions">
          <button type="button" class="btn btn-secondary tpl-edit">Bearbeiten</button>
          <button type="button" class="btn btn-secondary tpl-delete">Löschen</button>
        </div>`;
      row.querySelector(".tpl-edit").addEventListener("click", () => {
        editingId = tpl.id;
        editingPosition = tpl.position;
        nameInput.value = tpl.name;
        tplQuill.setContents([]);
        tplQuill.clipboard.dangerouslyPasteHTML(tpl.content_html || "");
        submitBtn.textContent = "Änderungen speichern";
        cancelBtn.hidden = false;
        nameInput.focus();
      });
      row.querySelector(".tpl-delete").addEventListener("click", async () => {
        if (!await confirmDelete(`Vorlage „${tpl.name}“ wirklich löschen?`)) return;
        await api(`/api/journal-templates/${tpl.id}`, { method: "DELETE" });
        if (editingId === tpl.id) resetForm();
        await renderList();
      });
      list.appendChild(row);
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const payload = {
      name,
      content_html: tplQuill.getText().trim() ? tplQuill.root.innerHTML : "",
      position: editingPosition,
    };
    try {
      if (editingId) {
        await api(`/api/journal-templates/${editingId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      } else {
        await api("/api/journal-templates", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      }
      resetForm();
      await renderList();
    } catch (err) {
      alert(err.message);
    }
  };
  cancelBtn.onclick = resetForm;

  resetForm();
  await renderList();
}

/* ---------- Tags-Verwaltung (Einstellungen) ---------- */

const TAG_PRESET_COLORS = [
  "#6c95ff", "#3ddc84", "#ff6b6b", "#ffa94d", "#ffd43b",
  "#c792ea", "#4dd4d0", "#ff8fc7", "#8b93a1", "#4f8cff",
];

let editingTagId = null;

function renderTagSwatches(selectedColor) {
  const row = document.getElementById("tag-swatch-row");
  row.innerHTML = TAG_PRESET_COLORS.map(c =>
    `<button type="button" class="tag-swatch${c.toLowerCase() === (selectedColor || "").toLowerCase() ? " active" : ""}" style="background:${c}" data-color="${c}"></button>`
  ).join("");
  row.querySelectorAll(".tag-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("tag-color-input").value = btn.dataset.color;
      row.querySelectorAll(".tag-swatch").forEach(b => b.classList.toggle("active", b === btn));
    });
  });
}

async function renderTagsSettings() {
  const form = document.getElementById("tag-form");
  const nameInput = document.getElementById("tag-name-input");
  const groupInput = document.getElementById("tag-group-input");
  const colorInput = document.getElementById("tag-color-input");
  const submitBtn = document.getElementById("tag-form-submit");
  const cancelBtn = document.getElementById("tag-form-cancel");

  function resetForm() {
    editingTagId = null;
    form.reset();
    colorInput.value = TAG_PRESET_COLORS[0];
    renderTagSwatches(colorInput.value);
    submitBtn.textContent = "Tag anlegen";
    cancelBtn.hidden = true;
  }

  cancelBtn.onclick = resetForm;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const payload = { name: nameInput.value.trim(), color: colorInput.value, tag_group: groupInput.value.trim() };
    if (!payload.name) return;
    try {
      if (editingTagId) {
        await api(`/api/tags/${editingTagId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      } else {
        await api("/api/tags", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      }
      invalidateTagsCache();
      resetForm();
      await renderTagsList();
      await renderTagFilter();
    } catch (err) {
      alert(err.message);
    }
  };

  resetForm();
  await renderTagsList();
}

async function renderTagsList() {
  const [tags, stats] = await Promise.all([getTags(true), api("/api/tag-stats")]);
  const statsById = new Map(stats.map(s => [s.id, s]));

  const groupOptions = document.getElementById("tag-group-options");
  const groups = [...new Set(tags.map(t => t.tag_group).filter(Boolean))];
  groupOptions.innerHTML = groups.map(g => `<option value="${escapeHtml(g)}">`).join("");

  const list = document.getElementById("tag-list");
  list.innerHTML = "";
  if (!tags.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Tags angelegt.</div>`;
    return;
  }

  const byGroup = new Map();
  for (const t of tags) {
    const g = t.tag_group || "Ohne Gruppe";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }

  for (const [group, groupTags] of byGroup) {
    const block = document.createElement("div");
    block.className = "tag-group-block";
    block.innerHTML = `<div class="tag-group-title">${escapeHtml(group)}</div>`;
    for (const t of groupTags) {
      const s = statsById.get(t.id) || { trade_count: 0, net_usd: 0, winrate: 0 };
      const row = document.createElement("div");
      row.className = "tag-row";
      row.innerHTML = `
        <div class="tag-row-name"><span class="tag-color-dot" style="background:${t.color}"></span>${escapeHtml(t.name)}</div>
        <div class="tag-row-actions">
          <button type="button" class="btn btn-secondary tag-edit">Bearbeiten</button>
          <button type="button" class="btn btn-danger tag-delete">Löschen</button>
        </div>
        <div class="tag-row-stats">${s.trade_count} Trade(s) · <span class="${cls(s.net_usd)}">${fmtSigned(s.net_usd)} $</span> · Winrate ${fmtNum(s.winrate, 1)}%</div>
      `;
      row.querySelector(".tag-edit").addEventListener("click", () => {
        editingTagId = t.id;
        document.getElementById("tag-name-input").value = t.name;
        document.getElementById("tag-group-input").value = t.tag_group || "";
        document.getElementById("tag-color-input").value = t.color;
        renderTagSwatches(t.color);
        document.getElementById("tag-form-submit").textContent = "Speichern";
        document.getElementById("tag-form-cancel").hidden = false;
        document.getElementById("tag-name-input").focus();
      });
      row.querySelector(".tag-delete").addEventListener("click", async () => {
        const msg = s.trade_count
          ? `Tag "${t.name}" wirklich löschen? Er ist ${s.trade_count} Trade(s) zugewiesen - die Zuordnung geht dabei verloren.`
          : `Tag "${t.name}" wirklich löschen?`;
        if (!confirm(msg)) return;
        await api(`/api/tags/${t.id}`, { method: "DELETE" });
        invalidateTagsCache();
        await renderTagsList();
        await renderTagFilter();
        if (state.view === "day" && state.currentDay) populateDay(document.getElementById("content"), state.currentDay);
      });
      block.appendChild(row);
    }
    list.appendChild(block);
  }
}

async function renderSettingsAccountDelete() {
  const select = document.getElementById("settings-account-select");
  const btn = document.getElementById("settings-account-delete-btn");
  const accounts = await api("/api/accounts");

  if (!accounts.length) {
    select.innerHTML = "";
    select.disabled = true;
    btn.disabled = true;
    document.getElementById("settings-account-hint").textContent = "Keine Konten vorhanden.";
    return;
  }
  select.disabled = false;
  btn.disabled = false;
  document.getElementById("settings-account-hint").textContent = "";
  select.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("");

  btn.onclick = async () => {
    const acc = accounts.find(a => String(a.id) === select.value);
    if (!acc) return;
    const deleted = await deleteAccountFlow(acc.id, acc.name);
    if (deleted) await renderSettingsAccountDelete();
  };
}

function fmtNum(n, decimals = 2) {
  return Number(n).toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtSigned(n, decimals = 2) {
  const s = fmtNum(Math.abs(n), decimals);
  return (n < 0 ? "-" : "") + s;
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} Sek`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} Min`;
}
function cls(n) { return n >= 0 ? "pos" : "neg"; }

/* CFDs (MT5) werden in Lots gehandelt, Futures (NinjaTrader-Import) in
   Kontrakten - die Herkunft (source) entscheidet automatisch, welche
   Einheit angezeigt wird. Aeltere Trades ohne gespeicherte Groesse (vor
   Einfuehrung dieses Felds) zeigen "-". */
function fmtVolume(trade) {
  if (trade.volume === null || trade.volume === undefined) return "–";
  if (trade.source === "ninjatrader") {
    const n = Math.round(trade.volume);
    return `${n} Kontrakt${n === 1 ? "" : "e"}`;
  }
  return `${fmtNum(trade.volume, 2)} Lot${trade.volume === 1 ? "" : "s"}`;
}

/* ---------- Tag-Chips & Popover (Tagesansicht) ---------- */

function tagTextColor(hex) {
  const c = (hex || "#6c95ff").replace("#", "");
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1d21" : "#ffffff";
}
function tagChipHtml(tag) {
  const groupHtml = tag.tag_group ? `<span class="tag-chip-group">${escapeHtml(tag.tag_group)}</span>` : "";
  const title = tag.tag_group ? `${escapeHtml(tag.tag_group)} - ${escapeHtml(tag.name)}` : escapeHtml(tag.name);
  return `<span class="tag-chip" style="background:${tag.color};color:${tagTextColor(tag.color)}" title="${title}">${groupHtml}${escapeHtml(tag.name)}</span>`;
}

function renderTradeTagCell(cell, trade) {
  cell.innerHTML = (trade.tags || []).map(tagChipHtml).join("");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tag-add-btn";
  addBtn.title = "Tags zuweisen";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTagPopover(addBtn, trade, cell);
  });
  cell.appendChild(addBtn);
}

async function openTagPopover(button, trade, cell) {
  const tags = await getTags();
  const popover = document.getElementById("tag-popover");
  const list = document.getElementById("tag-popover-list");
  const empty = document.getElementById("tag-popover-empty");

  if (!tags.length) {
    list.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const assigned = new Set((trade.tags || []).map(t => t.id));
    list.innerHTML = tags.map(t => `
      <label class="tag-popover-item">
        <input type="checkbox" data-tag-id="${t.id}" ${assigned.has(t.id) ? "checked" : ""}>
        <span class="tag-color-dot" style="background:${t.color}"></span>${escapeHtml(t.name)}
      </label>`).join("");
    list.querySelectorAll("input").forEach(cb => {
      cb.addEventListener("change", async () => {
        const tagIds = Array.from(list.querySelectorAll("input:checked")).map(i => parseInt(i.dataset.tagId));
        await api(`/api/trades/${trade.id}/tags`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_ids: tagIds }),
        });
        trade.tags = tags.filter(t => tagIds.includes(t.id));
        renderTradeTagCell(cell, trade);
      });
    });
  }

  popover.hidden = false;
  const rect = button.getBoundingClientRect();
  const zoom = currentZoom();
  popover.style.top = `${(rect.bottom + 4) / zoom}px`;
  popover.style.left = `${rect.left / zoom}px`;
  requestAnimationFrame(() => {
    const pRect = popover.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) popover.style.left = `${Math.max(8, window.innerWidth - pRect.width - 8) / zoom}px`;
    if (pRect.bottom > window.innerHeight - 8) popover.style.top = `${Math.max(8, rect.top - pRect.height - 4) / zoom}px`;
  });
}

function initTagPopover() {
  document.addEventListener("click", (e) => {
    const popover = document.getElementById("tag-popover");
    if (popover.hidden) return;
    if (!popover.contains(e.target) && !e.target.closest(".tag-add-btn")) popover.hidden = true;
  });
}
initTagPopover();

function attachOutsideClose(overlayEl, closeFn) {
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

/* ---------- Zweistufiger Loesch-Dialog ---------- */

/* requireTyping steuert die dritte Stufe (Eintippen von "Löschen"): fuer
   folgenreiche Loeschungen (Konto, Vorlage) bleibt sie an, fuer den Journal-
   Eintrag reicht ein einfacher Ja-Klick, weil der Inhalt selbst der einzige
   Verlust ist und die zwei Klicks (Loeschen-Button + Ja) schon vor
   Versehentlichem schuetzen. */
function confirmDelete(message, requireTyping = true) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Nein</button>
          <button class="btn btn-danger confirm-yes">Ja</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }
    attachOutsideClose(overlay, () => cleanup(false));

    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => {
      if (!requireTyping) { cleanup(true); return; }
      const card = overlay.querySelector(".modal-card");
      card.innerHTML = `
        <div class="confirm-message">Zum endgültigen Bestätigen bitte "Löschen" eintippen:</div>
        <input type="text" class="confirm-input" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-cancel">Abbrechen</button>
          <button class="btn btn-danger confirm-final" disabled>Endgültig löschen</button>
        </div>`;
      const input = card.querySelector(".confirm-input");
      const finalBtn = card.querySelector(".confirm-final");
      input.addEventListener("input", () => {
        finalBtn.disabled = input.value !== "Löschen";
      });
      card.querySelector(".confirm-cancel").addEventListener("click", () => cleanup(false));
      finalBtn.addEventListener("click", () => cleanup(true));
      input.focus();
    });
  });
}

/* Einfacher Ja/Nein-Dialog fuer nicht-destruktive Entscheidungen (z.B.
   "trotzdem weiter, obwohl ungespeichert?") - wie confirmDelete(msg, false),
   aber mit einem regulaeren statt rot eingefaerbten Bestaetigen-Button, damit
   eine haeufige, harmlose Aktion nicht wie eine Loeschung aussieht. */
function confirmContinue(message, yesLabel = "Weiter") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
          <button class="btn btn-primary confirm-yes">${escapeHtml(yesLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }
    attachOutsideClose(overlay, () => cleanup(false));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => cleanup(true));
  });
}

/* Einzeiliges Texteingabe-Fenster (Umbenennen, Name beim Anlegen) - null bei
   Abbruch oder leerer Eingabe. */
function promptDialog(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${escapeHtml(message)}</div>
        <input type="text" class="confirm-input" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
          <button class="btn btn-primary confirm-yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".confirm-input");
    input.value = defaultValue;
    function cleanup(result) { overlay.remove(); resolve(result); }
    attachOutsideClose(overlay, () => cleanup(null));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(null));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => cleanup(input.value.trim() || null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); overlay.querySelector(".confirm-yes").click(); }
    });
    input.focus();
    input.select();
  });
}

/* Gemeinsamer Ablauf fuer Konto-Loeschung, aufgerufen sowohl von der
   Konten-Seite als auch von den Einstellungen - vermeidet doppelte
   Confirm-/Request-/Refresh-Logik an zwei Stellen. */
async function deleteAccountFlow(accountId, accountName) {
  const ok = await confirmDelete(
    `Konto "${accountName}" wirklich entfernen? Bereits importierte Trades bleiben erhalten, verlieren aber die Zuordnung zu diesem Konto.`
  );
  if (!ok) return false;
  await api(`/api/accounts/${accountId}`, { method: "DELETE" });
  await renderAccounts();
  await renderAccountFilter();
  await renderImportAccountSelect();
  return true;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Fehler");
  }
  return res.json();
}

/* ---------- Views ---------- */

function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
}

/* Baut den Hauptbereich auf ein Template um. Schreibt vorher einen offenen
   Journal-Editor raus und verwirft ihn - sein DOM wird hier ersetzt, ein
   danach noch feuernder Autosave wuerde ins Leere laufen. */
async function mountView(templateId) {
  await flushJournal();
  activeJournal = null;
  await flushNotebookNote();
  activeNotebookNote = null;
  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById(templateId).content.cloneNode(true));
  return content;
}

/* Kachel-Definitionen der Uebersicht - jede mit eigener render(data)-Funktion,
   damit Prozent-/Verhaeltnis-Kennzahlen ihre Gauge-/Ratio-Grafik bekommen
   (analog zum Auswertungen-Widget-System, aber ohne Umsortieren - hier reicht
   Ein-/Ausblenden). Reihenfolge hier = Anzeige-Reihenfolge. */
const OVERVIEW_STAT_DEFS = [
  { key: "start_balance", label: "Startkapital", render: (d) => tile("Startkapital", fmtNum(d.start_balance) + " $") },
  { key: "current_balance", label: "Kontostand", render: (d) => tile("Kontostand", fmtNum(d.current_balance) + " $", cls(d.current_balance - d.start_balance)) },
  { key: "total_net", label: "Netto gesamt", render: (d) => tile("Netto gesamt", fmtSigned(d.total_net) + " $", cls(d.total_net)) },
  { key: "total_trades", label: "Trades gesamt", render: (d) => tile("Trades gesamt", d.total_trades) },
  { key: "trading_days", label: "Handelstage", render: (d) => tile("Handelstage", d.trading_days) },
  { key: "win_rate", label: "Trefferquote", render: (d) => gaugeTile("Trefferquote", d.win_rate, fmtNum(d.win_rate, 1) + " %") },
  { key: "profit_factor", label: "Profit-Faktor", render: (d) => tile("Profit-Faktor", d.profit_factor === null ? "∞" : fmtNum(d.profit_factor, 2)) },
  { key: "win_days_pct", label: "Handelstage % Gewinn", render: (d) => gaugeTile("Handelstage % Gewinn", d.win_days_pct, fmtNum(d.win_days_pct, 1) + " %") },
  { key: "win_loss_ratio", label: "Ø Gewinn/Verlust-Verhältnis", render: (d) => ratioTile("Ø Gewinn/Verlust-Verhältnis", d.avg_win, d.avg_loss, d.win_loss_ratio) },
  { key: "expectancy", label: "Erwartungswert", render: (d) => tile("Erwartungswert", fmtSigned(d.expectancy, 2) + " $", cls(d.expectancy)) },
  { key: "best_day", label: "Bester Tag", render: (d) => tile("Bester Tag", d.best_day ? `${d.best_day.day} (${fmtSigned(d.best_day.net_usd)} $)` : "–") },
  { key: "worst_day", label: "Schwächster Tag", render: (d) => tile("Schwächster Tag", d.worst_day ? `${d.worst_day.day} (${fmtSigned(d.worst_day.net_usd)} $)` : "–") },
];
const OVERVIEW_STAT_KEYS = OVERVIEW_STAT_DEFS.map(d => d.key);

/* Gespeichert werden die AUSGEBLENDETEN Kacheln, nicht die sichtbaren -
   analog zu overviewHiddenColumns/tradeFieldHidden (siehe CLAUDE.md), sonst
   waere eine neu hinzugekommene Kachel fuer Bestandsnutzer unsichtbar. */
function loadOverviewHiddenStats() {
  try {
    const saved = JSON.parse(localStorage.getItem("overviewHiddenStats") || "null");
    if (Array.isArray(saved)) return new Set(saved.filter(k => OVERVIEW_STAT_KEYS.includes(k)));
  } catch (e) { /* ignore */ }
  return new Set();
}
function saveOverviewHiddenStats(hiddenSet) {
  localStorage.setItem("overviewHiddenStats", JSON.stringify([...hiddenSet]));
}

/* Reihenfolge der Kacheln - analog zu tradeFieldOrder/analyticsWidgets:
   unbekannte/entfernte Keys rausfiltern, neu hinzugekommene hinten anhaengen. */
function loadOverviewStatOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem("overviewStatOrder") || "null");
    if (Array.isArray(saved)) {
      const known = saved.filter(k => OVERVIEW_STAT_KEYS.includes(k));
      for (const k of OVERVIEW_STAT_KEYS) if (!known.includes(k)) known.push(k);
      return known;
    }
  } catch (e) { /* ignore */ }
  return [...OVERVIEW_STAT_KEYS];
}
function saveOverviewStatOrder(order) {
  localStorage.setItem("overviewStatOrder", JSON.stringify(order));
}

/* Drag & Drop der Kacheln im Grid - 2-achsige Positionsbestimmung wie bei den
   Auswertungen-Widgets (analyticsCardGoesBefore), da #ov-stats ein
   mehrspaltiges Grid ist, kein einspaltiges wie die Trade-Feldreihenfolge. */
let overviewStatDragEl = null;
function overviewStatGoesBefore(e, rect) {
  if (e.clientY < rect.top) return true;
  if (e.clientY > rect.bottom) return false;
  return e.clientX < rect.left + rect.width / 2;
}
function wireOverviewStatDrag(tileEl) {
  tileEl.addEventListener("dragstart", (e) => {
    overviewStatDragEl = tileEl;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tileEl.dataset.statKey);
    tileEl.classList.add("dragging");
  });
  tileEl.addEventListener("dragend", () => {
    tileEl.classList.remove("dragging");
    overviewStatDragEl = null;
    const keys = [...document.querySelectorAll("#ov-stats .stat-tile")].map(t => t.dataset.statKey);
    saveOverviewStatOrder(keys);
  });
  tileEl.addEventListener("dragover", (e) => {
    if (!overviewStatDragEl || overviewStatDragEl === tileEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const before = overviewStatGoesBefore(e, tileEl.getBoundingClientRect());
    tileEl.parentElement.insertBefore(overviewStatDragEl, before ? tileEl : tileEl.nextSibling);
  });
}

function gaugeTile(label, pct, valueText) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value">${valueText}</div>
    <div class="stat-gauge-track"><div class="stat-gauge-marker" style="left:${clamped}%"></div></div>
    <div class="stat-gauge-scale"><span>0</span><span>50</span><span>100</span></div>
  </div>`;
}

function ratioTile(label, avgWin, avgLoss, ratio) {
  const win = Math.abs(avgWin || 0), loss = Math.abs(avgLoss || 0);
  const total = win + loss;
  const winPct = total ? (win / total * 100) : 50;
  const valueText = ratio === null ? "∞" : fmtNum(ratio, 2);
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value">${valueText}</div>
    <div class="stat-ratio-track">
      <div class="stat-ratio-win" style="width:${winPct}%"></div>
      <div class="stat-ratio-loss" style="width:${100 - winPct}%"></div>
    </div>
    <div class="stat-ratio-scale"><span class="pos">+${fmtNum(win, 2)} $</span><span class="neg">-${fmtNum(loss, 2)} $</span></div>
  </div>`;
}

let lastOverviewData = null;

function renderOverviewStats(data) {
  lastOverviewData = data;
  const hidden = loadOverviewHiddenStats();
  const grid = document.getElementById("ov-stats");
  grid.innerHTML = loadOverviewStatOrder()
    .filter(key => !hidden.has(key))
    .map(key => {
      const def = OVERVIEW_STAT_DEFS.find(d => d.key === key);
      const html = def.render(data);
      // draggable/data-Attribut hier statt in jeder render()-Funktion setzen -
      // alle drei (tile/gaugeTile/ratioTile) beginnen mit demselben
      // `<div class="stat-tile">`.
      return html.replace('<div class="stat-tile">', `<div class="stat-tile" draggable="true" data-stat-key="${key}">`);
    }).join("");
  grid.querySelectorAll(".stat-tile").forEach(wireOverviewStatDrag);
}

function renderOverviewStatsPanel() {
  const panel = document.getElementById("ov-stats-panel");
  const hidden = loadOverviewHiddenStats();
  const order = loadOverviewStatOrder();
  panel.innerHTML = `<div class="newsbar-filter-group-title">Ziehen zum Umsortieren, Klick zum Ein-/Ausblenden</div>`
    + order.map(key => {
      const def = OVERVIEW_STAT_DEFS.find(d => d.key === key);
      const isHidden = hidden.has(key);
      return `<div class="trade-field-order-row" draggable="true" data-key="${key}">
        <span class="trade-field-order-handle">⠿</span>
        <button type="button" class="trade-field-toggle-btn${isHidden ? "" : " active"}" data-key="${key}">${escapeHtml(def.label)}</button>
      </div>`;
    }).join("");

  panel.querySelectorAll(".trade-field-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const hiddenNow = loadOverviewHiddenStats();
      if (hiddenNow.has(key)) hiddenNow.delete(key); else hiddenNow.add(key);
      saveOverviewHiddenStats(hiddenNow);
      btn.classList.toggle("active");
      renderOverviewStats(lastOverviewData);
    });
  });

  let dragKey = null;
  panel.querySelectorAll(".trade-field-order-row").forEach(row => {
    row.addEventListener("dragstart", () => { dragKey = row.dataset.key; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = panel.querySelector(".dragging");
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.parentNode.insertBefore(dragging, before ? row : row.nextSibling);
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const newOrder = [...panel.querySelectorAll(".trade-field-order-row")].map(r => r.dataset.key);
      saveOverviewStatOrder(newOrder);
      renderOverviewStats(lastOverviewData);
    });
  });
}

async function openOverview() {
  state.view = "overview";
  state.currentDay = null;
  setActiveNav("overview");

  const content = await mountView("tpl-overview");
  await renderAccountChipRow("ov-account-chip-row");

  const data = await api(withFilter("/api/overview"));
  renderOverviewStats(data);

  const toggle = document.getElementById("ov-stats-toggle");
  const panel = document.getElementById("ov-stats-panel");
  toggle.onclick = (e) => {
    e.stopPropagation();
    if (panel.hidden) renderOverviewStatsPanel();
    panel.hidden = !panel.hidden;
  };

  const chartWrap = document.getElementById("ov-chart");
  if (data.curve.length > 1) {
    const curveValues = data.curve.map(p => p.cum_net);
    const curveLabels = data.curve.map(p => p.day);
    chartWrap.innerHTML = lineChartSvg(curveValues, curveLabels, data.start_balance) + `<div class="chart-tooltip"></div>`;
    attachChartTooltip(chartWrap);
  } else {
    chartWrap.innerHTML = `<div class="empty-state">Mindestens 2 Tage nötig für eine Kurve.</div>`;
  }

}

function tile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value ${extraClass}">${value}</div></div>`;
}

const TRADES_PAGE_SIZE = 50;

/* Spalten der Trades-Tabelle - "render" liefert den Zellinhalt fuer alle
   Spalten ausser "tags" (das braucht echtes DOM fuer den Tag-Zuweisen-Button
   und wird in renderTradesTable() separat behandelt). Neue Spalte hinzufuegen:
   hier eintragen, TRADE_CARD_FIELD_KEYS zieht die Keys automatisch nach - der
   per Drag & Drop einstellbare Reihenfolge-Mechanismus selbst muss dafuer
   nicht angefasst werden. */
const TRADE_CARD_FIELDS = [
  { key: "day", label: "Datum", render: (t) => t.day },
  { key: "account", label: "Konto", render: (t, ctx) => t.account_id ? escapeHtml(ctx.accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto" },
  { key: "entry_time", label: "Entry-Zeit", render: (t) => fmtTime(t.entry_time) },
  { key: "direction", label: "Richtung", render: (t) => `<span class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction === "Long" ? "▲" : "▼"} ${t.direction}</span>` },
  { key: "volume", label: "Größe", render: (t) => fmtVolume(t) },
  { key: "entry_price", label: "Entry", render: (t) => fmtNum(t.entry_price) },
  { key: "exit_price", label: "Exit", render: (t) => fmtNum(t.exit_price) },
  { key: "points", label: "Punkte", render: (t) => `<span class="${cls(t.points)}">${fmtSigned(t.points, 2)}</span>` },
  { key: "net_usd", label: "Netto $", render: (t) => `<span class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</span>` },
  { key: "tags", label: "Tags", render: null },
];
const TRADE_CARD_FIELD_KEYS = TRADE_CARD_FIELDS.map(f => f.key);

/* Reihenfolge gilt global fuer jede Trade-Karte (nicht pro Sitzung) - deshalb
   in localStorage statt in state, analog zu overviewHiddenColumns. */
function loadTradeFieldOrder() {
  const saved = JSON.parse(localStorage.getItem("tradeFieldOrder") || "null");
  if (!Array.isArray(saved)) return [...TRADE_CARD_FIELD_KEYS];
  // Unbekannte/entfernte Keys rausfiltern, neu hinzugekommene Felder hinten anhaengen -
  // sonst verschwindet ein neues Feld fuer Bestandsnutzer mit gespeicherter Reihenfolge.
  const known = saved.filter(k => TRADE_CARD_FIELD_KEYS.includes(k));
  for (const k of TRADE_CARD_FIELD_KEYS) if (!known.includes(k)) known.push(k);
  return known;
}
function saveTradeFieldOrder(order) {
  localStorage.setItem("tradeFieldOrder", JSON.stringify(order));
}

/* Gespeichert werden die AUSGEBLENDETEN Felder, nicht die sichtbaren - analog
   zu overviewHiddenColumns (siehe CLAUDE.md), sonst waere ein neu
   hinzugekommenes Feld fuer Bestandsnutzer mit gespeicherter Auswahl unsichtbar. */
function loadTradeFieldHidden() {
  const saved = JSON.parse(localStorage.getItem("tradeFieldHidden") || "null");
  if (!Array.isArray(saved)) return new Set();
  return new Set(saved.filter(k => TRADE_CARD_FIELD_KEYS.includes(k)));
}
function saveTradeFieldHidden(hiddenSet) {
  localStorage.setItem("tradeFieldHidden", JSON.stringify([...hiddenSet]));
}

function renderTradeFieldOrderPanel() {
  const panel = document.getElementById("trades-field-order-panel");
  const order = loadTradeFieldOrder();
  const hidden = loadTradeFieldHidden();
  panel.innerHTML = `<div class="newsbar-filter-group-title">Ziehen zum Umsortieren, Klick zum Ein-/Ausblenden</div>`
    + order.map(key => {
      const field = TRADE_CARD_FIELDS.find(f => f.key === key);
      const isHidden = hidden.has(key);
      return `<div class="trade-field-order-row" draggable="true" data-key="${key}">
        <span class="trade-field-order-handle">⠿</span>
        <button type="button" class="trade-field-toggle-btn${isHidden ? "" : " active"}" data-key="${key}">${escapeHtml(field.label)}</button>
      </div>`;
    }).join("");

  panel.querySelectorAll(".trade-field-toggle-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const hiddenNow = loadTradeFieldHidden();
      // Mindestens ein Feld muss sichtbar bleiben - sonst zeigt die Tabelle
      // nur noch die fixen Check-/Badge-Spalten und wirkt kaputt statt leer.
      if (!hiddenNow.has(key) && hiddenNow.size >= TRADE_CARD_FIELD_KEYS.length - 1) return;
      if (hiddenNow.has(key)) hiddenNow.delete(key); else hiddenNow.add(key);
      saveTradeFieldHidden(hiddenNow);
      btn.classList.toggle("active");
      renderTradesTable();
    });
  });

  let dragKey = null;
  panel.querySelectorAll(".trade-field-order-row").forEach(row => {
    row.addEventListener("dragstart", () => { dragKey = row.dataset.key; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = panel.querySelector(".dragging");
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.parentNode.insertBefore(dragging, before ? row : row.nextSibling);
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const newOrder = [...panel.querySelectorAll(".trade-field-order-row")].map(r => r.dataset.key);
      saveTradeFieldOrder(newOrder);
      renderTradesTable();
    });
  });
}

let tradesTableData = { trades: [], accountNames: new Map() };

/* Auswahl fuer die Sammel-Aktion (Journal-Eintraege mehrerer Trades auf
   einmal loeschen) - bewusst nicht in state, sondern modulweit wie
   tradesTableData: gilt nur fuer die aktuell geladene Trades-Seite, wird bei
   jedem openTrades()-Aufruf (Seiten-/Filterwechsel) zurueckgesetzt. */
let tradesSelectedIds = new Set();

function updateTradesBulkBar() {
  const bar = document.getElementById("trades-bulk-bar");
  if (!bar) return;
  const n = tradesSelectedIds.size;
  bar.hidden = n === 0;
  const countEl = document.getElementById("trades-bulk-count");
  if (countEl) countEl.textContent = n === 1 ? "1 Trade ausgewählt" : `${n} Trades ausgewählt`;
}

function renderTradesTable() {
  const theadRow = document.getElementById("trades-thead-row");
  const tbody = document.getElementById("trades-tbody");
  const { trades, accountNames } = tradesTableData;
  const hidden = loadTradeFieldHidden();
  const order = loadTradeFieldOrder().filter(key => !hidden.has(key));

  // Badges-Spalte ist fix (nicht Teil der einstellbaren Reihenfolge) - sie
  // markiert nur, ob Notiz/Bild/Journal-Eintrag vorhanden sind, ist also kein
  // eigenstaendiger Datenwert wie die uebrigen Spalten.
  const selectAllCb = document.createElement("input");
  selectAllCb.type = "checkbox";
  theadRow.innerHTML = `<th class="col-check"></th><th class="col-badges"></th><th class="col-share"></th>` + order.map(key => {
    const field = TRADE_CARD_FIELDS.find(f => f.key === key);
    return `<th>${escapeHtml(field.label)}</th>`;
  }).join("");
  theadRow.querySelector(".col-check").appendChild(selectAllCb);

  tbody.innerHTML = "";
  if (!trades.length) {
    tbody.innerHTML = `<tr><td colspan="${order.length + 3}"><div class="empty-state">Keine Trades für die aktuelle Filterauswahl.</div></td></tr>`;
    selectAllCb.disabled = true;
    updateTradesBulkBar();
    return;
  }
  for (const t of trades) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    const badges = (t.notes && t.notes.trim() ? `<span class="trade-card-badge" title="Notiz vorhanden">📝</span>` : "")
      + (t.has_image ? `<span class="trade-card-badge" title="Bild vorhanden">📷</span>` : "")
      + (t.has_journal ? `<span class="trade-card-badge" title="Journal-Eintrag (Bewertung/Review) vorhanden">🗒️</span>` : "");
    tr.innerHTML = `<td class="col-check"><input type="checkbox" class="trades-row-select" data-id="${t.id}"${tradesSelectedIds.has(t.id) ? " checked" : ""}></td>`
      + `<td class="col-badges">${badges}</td>`
      + `<td class="col-share"><button type="button" class="trade-share-row-btn" title="Als Bild teilen" aria-label="Als Bild teilen">📤</button></td>`
      + order.map(key => {
      if (key === "tags") return `<td class="tag-cell"></td>`;
      const field = TRADE_CARD_FIELDS.find(f => f.key === key);
      return `<td>${field.render(t, { accountNames })}</td>`;
    }).join("");
    tr.addEventListener("click", () => openTrade(t.id));
    const shareBtn = tr.querySelector(".trade-share-row-btn");
    shareBtn.addEventListener("click", (e) => { e.stopPropagation(); openShareModal(t); });
    const tagCell = tr.querySelector(".tag-cell");
    if (tagCell) {
      tagCell.addEventListener("click", (e) => e.stopPropagation());
      renderTradeTagCell(tagCell, t);
    }
    const rowCb = tr.querySelector(".trades-row-select");
    rowCb.addEventListener("click", (e) => e.stopPropagation());
    rowCb.addEventListener("change", () => {
      if (rowCb.checked) tradesSelectedIds.add(t.id);
      else tradesSelectedIds.delete(t.id);
      selectAllCb.checked = trades.every(tr => tradesSelectedIds.has(tr.id));
      updateTradesBulkBar();
    });
    tbody.appendChild(tr);
  }

  selectAllCb.checked = trades.every(t => tradesSelectedIds.has(t.id));
  selectAllCb.addEventListener("click", (e) => e.stopPropagation());
  selectAllCb.addEventListener("change", () => {
    for (const t of trades) {
      if (selectAllCb.checked) tradesSelectedIds.add(t.id);
      else tradesSelectedIds.delete(t.id);
    }
    tbody.querySelectorAll(".trades-row-select").forEach(cb => { cb.checked = selectAllCb.checked; });
    updateTradesBulkBar();
  });
  updateTradesBulkBar();
}

async function bulkDeleteTradeJournalEntries() {
  const ids = [...tradesSelectedIds];
  if (!ids.length) return;
  const label = ids.length === 1 ? "den Journal-Eintrag des ausgewählten Trades" : `die Journal-Einträge der ${ids.length} ausgewählten Trades`;
  if (!await confirmDelete(`Sollen ${label} wirklich gelöscht werden?`, false)) return;
  await api("/api/journal/trade/bulk-delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref_keys: ids.map(String) }),
  });
  tradesSelectedIds.clear();
  await openTrades(state.tradesPage || 1);
}

async function openTrades(page = 1) {
  state.view = "trades";
  state.currentDay = null;
  state.tradesPage = page;
  setActiveNav("trades");

  const content = await mountView("tpl-trades");
  tradesSelectedIds.clear();

  await renderTagFilter();

  const [result, accountOptions] = await Promise.all([
    api(withFilter(`/api/trades?page=${page}&page_size=${TRADES_PAGE_SIZE}`)),
    getAccountOptions(),
  ]);
  tradesTableData = {
    trades: result.trades,
    accountNames: new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name])),
  };
  renderTradesTable();

  const toggle = document.getElementById("trades-field-order-toggle");
  const panel = document.getElementById("trades-field-order-panel");
  toggle.onclick = (e) => {
    e.stopPropagation();
    if (panel.hidden) renderTradeFieldOrderPanel();
    panel.hidden = !panel.hidden;
  };

  document.getElementById("trades-bulk-clear").onclick = () => {
    tradesSelectedIds.clear();
    renderTradesTable();
  };
  document.getElementById("trades-bulk-delete-journal").onclick = () => bulkDeleteTradeJournalEntries();

  const totalPages = Math.max(1, Math.ceil(result.total / TRADES_PAGE_SIZE));
  const pagination = document.getElementById("trades-pagination");
  pagination.innerHTML = `
    <button type="button" class="btn btn-secondary trades-page-prev" ${page <= 1 ? "disabled" : ""}>← Zurück</button>
    <span class="pagination-label">Seite ${page} von ${totalPages} (${result.total} Trade(s))</span>
    <button type="button" class="btn btn-secondary trades-page-next" ${page >= totalPages ? "disabled" : ""}>Weiter →</button>
  `;
  pagination.querySelector(".trades-page-prev").addEventListener("click", () => openTrades(page - 1));
  pagination.querySelector(".trades-page-next").addEventListener("click", () => openTrades(page + 1));
}

/* ---------- Einzel-Trade-Seite ---------- */

let activeTradeNote = null;

async function saveActiveTradeNote() {
  const n = activeTradeNote;
  if (!n || !n.dirty) return;
  n.dirty = false;
  await api(`/api/trades/${n.tradeId}/notes`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: n.input.value }),
  });
}

/* Vor jedem Verlassen der Trade-Seite (Pfeile, Buttons, Zurueck-Links) geprueft -
   listet konkret auf, was noch nicht gespeichert ist, statt nur pauschal zu warnen.
   Bestaetigung speichert die Aenderungen (kein Datenverlust), lehnt der Nutzer ab
   bleibt er auf der Seite. */
async function confirmLeaveTradePage() {
  const reasons = [];
  if (activeJournal && activeJournal.dirty) reasons.push("Bewertung/Review-Text");
  if (activeTradeNote && activeTradeNote.dirty) reasons.push("Notiz zu diesem Trade");
  if (!reasons.length) return true;
  const ok = await confirmContinue(
    `Es gibt noch ungespeicherte Änderungen (${reasons.join(", ")}). Trotzdem weiter? Die Änderungen werden dabei gespeichert.`
  );
  if (ok) {
    if (activeJournal && activeJournal.dirty) await saveJournal();
    await saveActiveTradeNote();
  }
  return ok;
}

async function openTrade(tradeId, opts = {}) {
  if (!opts.skipGuard && state.view === "trade" && !(await confirmLeaveTradePage())) return;
  state.view = "trade";
  state.currentDay = null;
  state.currentTradeId = tradeId;
  setActiveNav("");

  const content = await mountView("tpl-trade");
  await populateTrade(content, tradeId);
}

async function populateTrade(container, tradeId) {
  const [trade, images] = await Promise.all([
    api(`/api/trades/${tradeId}`),
    api(`/api/trades/${tradeId}/images`),
  ]);

  container.querySelector(".trade-title").textContent =
    `${fmtDate(trade.day)} · ${fmtTime(trade.entry_time)} · ${trade.direction} ${trade.instrument}`;

  container.querySelector(".trade-stats").innerHTML =
    tile("Richtung", trade.direction, trade.direction === "Long" ? "pos" : "neg")
    + tile("Größe", fmtVolume(trade))
    + tile("Entry", fmtNum(trade.entry_price))
    + tile("Exit", fmtNum(trade.exit_price))
    + tile("Punkte", fmtSigned(trade.points, 2), cls(trade.points))
    + tile("Netto", fmtSigned(trade.net_usd) + " $", cls(trade.net_usd))
    + tile("Entry-Zeit", fmtTime(trade.entry_time))
    + tile("Exit-Zeit", fmtTime(trade.exit_time))
    + tile("Exit-Typ", trade.exit_type || "–");

  renderTradeTagCell(container.querySelector(".trade-tag-cell"), trade);

  wireTradeRiskRow(container, trade);
  container.querySelector(".trade-share-btn").onclick = () => openShareModal(trade);

  const noteInput = container.querySelector(".trade-note-input");
  noteInput.value = trade.notes || "";
  activeTradeNote = { tradeId: trade.id, input: noteInput, dirty: false };
  noteInput.oninput = () => { activeTradeNote.dirty = true; };
  noteInput.onblur = () => saveActiveTradeNote();

  const imgStrip = container.querySelector(".trade-images");
  imgStrip.innerHTML = "";
  images.forEach(img => imgStrip.appendChild(imageThumbEl(img, "image-thumb", () => populateTrade(container, tradeId))));
  const imgInput = container.querySelector(".trade-image-input");
  imgInput.value = "";
  imgInput.onchange = async () => {
    const file = imgInput.files[0];
    if (!file) return;
    await uploadImage(trade.day, file, trade.id);
    await populateTrade(container, tradeId);
  };

  container.querySelector(".trade-back-to-list").onclick = async () => {
    if (!(await confirmLeaveTradePage())) return;
    openTrades(state.tradesPage || 1);
  };
  container.querySelector(".trade-back-to-day").onclick = async () => {
    if (!(await confirmLeaveTradePage())) return;
    openDay(trade.day);
  };

  const prevBtn = container.querySelector(".trade-prev");
  const nextBtn = container.querySelector(".trade-next");
  const [prevRes, nextRes] = await Promise.all([
    api(withFilter(`/api/trades/${tradeId}/neighbor?to=prev&sort=day&dir=desc`)),
    api(withFilter(`/api/trades/${tradeId}/neighbor?to=next&sort=day&dir=desc`)),
  ]);
  prevBtn.disabled = !prevRes.id;
  nextBtn.disabled = !nextRes.id;
  prevBtn.onclick = async () => {
    if (prevRes.id && await confirmLeaveTradePage()) openTrade(prevRes.id, { skipGuard: true });
  };
  nextBtn.onclick = async () => {
    if (nextRes.id && await confirmLeaveTradePage()) openTrade(nextRes.id, { skipGuard: true });
  };

  await mountJournalEditor(container.querySelector(".trade-journal"), String(trade.id), {
    entryType: "trade", imageDay: trade.day,
  });
}

document.addEventListener("keydown", (e) => {
  if (state.view !== "trade") return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
  const btn = document.querySelector(e.key === "ArrowLeft" ? ".trade-prev" : ".trade-next");
  if (btn && !btn.disabled) btn.click();
});

/* Risiko-Eingabe (Basis der R-Multiple) auf der Trade-Detailseite - bei
   MT5-Sync automatisch aus dem Stop-Loss des Eroeffnungs-Orders befuellt
   (siehe _entry_risk_usd in mt5_adapter.py), sonst manuell nachtragbar. */
function tradeRMultiple(trade) {
  if (!trade.risk_usd || trade.risk_usd <= 0) return null;
  return trade.net_usd / trade.risk_usd;
}

function wireTradeRiskRow(container, trade) {
  const input = container.querySelector(".trade-risk-input");
  const display = container.querySelector("#trade-risk-r-display");
  const hint = container.querySelector(".trade-risk-hint");
  input.value = trade.risk_usd != null ? trade.risk_usd : "";
  hint.textContent = trade.source === "mt5" && trade.risk_usd != null
    ? "Automatisch aus dem MT5-Stop-Loss ermittelt." : "";

  function refresh() {
    const r = tradeRMultiple(trade);
    display.textContent = r === null ? "–" : `${fmtSigned(r, 2)}R`;
    display.className = "trade-risk-r" + (r === null ? "" : ` ${cls(r)}`);
  }
  refresh();

  input.oninput = () => {
    const val = input.value === "" ? null : Number(input.value);
    trade.risk_usd = (val === null || Number.isNaN(val)) ? null : val;
    refresh();
  };
  input.onblur = async () => {
    await api(`/api/trades/${trade.id}/risk`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_usd: trade.risk_usd }),
    });
    hint.textContent = "";
  };
}

/* ---------- Trade teilen (Canvas-Karte) ----------
   Rendert einen Trade als Bild-Karte (Instrument, Richtung, Netto-$ oder
   R-Multiple, Ein-/Ausstieg, Dauer) in einem von 5 Design-Themes, per PNG-
   Download oder Zwischenablage teilbar. Reines Canvas 2D statt einer
   Screenshot-Bibliothek - keine externen Assets/CDN noetig (siehe CLAUDE.md). */

const SHARE_W = 1080, SHARE_H = 1350, SHARE_PAD = 70;
const SHARE_FONT = "-apple-system, 'Segoe UI', Inter, Roboto, sans-serif";

function shareHexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shareRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Gemeinsames Layout (Badge, Instrument, grosse Kennzahl, Stat-Kacheln,
   Wasserzeichen) - nur der Hintergrund/Motiv-Akzent unterscheidet die Themes
   (siehe SHARE_THEMES[].drawBackground). */
function shareDrawLayout(ctx, theme, data) {
  const w = SHARE_W, h = SHARE_H;
  ctx.clearRect(0, 0, w, h);
  theme.drawBackground(ctx, w, h, data);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";

  const badgeText = data.direction === "Long" ? "▲ LONG" : "▼ SHORT";
  ctx.font = "700 30px " + SHARE_FONT;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgePadX = 34, badgeH = 62;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeX = w / 2 - badgeW / 2;
  const badgeY = h * 0.185;
  ctx.fillStyle = shareHexToRgba(data.accent, 0.16);
  shareRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.strokeStyle = shareHexToRgba(data.accent, 0.6);
  ctx.lineWidth = 2;
  shareRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.stroke();
  ctx.fillStyle = data.accent;
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, w / 2, badgeY + badgeH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 52px " + SHARE_FONT;
  ctx.fillText(data.instrument, w / 2, badgeY + badgeH + 76);

  ctx.font = "800 128px " + SHARE_FONT;
  ctx.fillStyle = data.metricColor;
  ctx.shadowColor = shareHexToRgba(data.metricColor, 0.55);
  ctx.shadowBlur = 44;
  ctx.fillText(data.metricValueText, w / 2, badgeY + badgeH + 236);
  ctx.shadowBlur = 0;

  const tiles = [
    { label: "Einstieg", value: data.entryText },
    { label: "Ausstieg", value: data.exitText },
    { label: "Dauer", value: data.durationText },
  ];
  const gap = 20;
  const tileW = (w - 2 * SHARE_PAD - 2 * gap) / 3;
  const tileH = 128;
  const tileY = h - SHARE_PAD - 70 - tileH;
  tiles.forEach((t, i) => {
    const x = SHARE_PAD + i * (tileW + gap);
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    shareRoundRect(ctx, x, tileY, tileW, tileH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    shareRoundRect(ctx, x, tileY, tileW, tileH, 18);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.font = "600 21px " + SHARE_FONT;
    ctx.fillText(t.label, x + tileW / 2, tileY + 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 29px " + SHARE_FONT;
    ctx.fillText(t.value, x + tileW / 2, tileY + 86);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "600 20px " + SHARE_FONT;
  ctx.textAlign = "right";
  ctx.fillText("Trade Journal", w - SHARE_PAD, h - SHARE_PAD + 26);
}

const SHARE_THEMES = [
  {
    id: "midnight",
    name: "Midnight Glow",
    previewCss: "radial-gradient(circle at 50% 32%, #234a3d 0%, #0a0e14 68%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0a0e14";
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h * 0.34, 20, w / 2, h * 0.34, h * 0.62);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.32));
      glow.addColorStop(1, "rgba(10, 14, 20, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = shareHexToRgba(data.accent, 0.5);
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.shadowColor = shareHexToRgba(data.accent, 0.65);
      ctx.shadowBlur = 26;
      const pts = data.direction === "Long"
        ? [[-40, h * 0.98], [w * 0.22, h * 0.86], [w * 0.4, h * 0.92], [w * 0.62, h * 0.58], [w * 0.82, h * 0.64], [w + 40, h * 0.22]]
        : [[-40, h * 0.1], [w * 0.22, h * 0.24], [w * 0.4, h * 0.16], [w * 0.62, h * 0.46], [w * 0.82, h * 0.4], [w + 40, h * 0.86]];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "neongrid",
    name: "Neon Grid",
    previewCss: "linear-gradient(180deg, #0a0d12 0%, #131a24 100%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0a0d12";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
      ctx.lineWidth = 1.5;
      const vpX = w / 2, vpY = h * 0.12;
      for (let i = -7; i <= 7; i++) {
        ctx.beginPath();
        ctx.moveTo(vpX + i * 110, h + 40);
        ctx.lineTo(vpX + i * 16, vpY);
        ctx.stroke();
      }
      for (let j = 0; j < 11; j++) {
        const t = j / 10;
        const y = vpY + (h - vpY) * Math.pow(t, 1.9);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
      const glow = ctx.createLinearGradient(0, data.direction === "Long" ? h : 0, 0, data.direction === "Long" ? 0 : h);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.28));
      glow.addColorStop(0.45, "rgba(10, 13, 18, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "aurora",
    name: "Aurora Drift",
    previewCss: "radial-gradient(circle at 30% 20%, #2a2560 0%, transparent 55%), radial-gradient(circle at 75% 75%, #1c3b32 0%, #0b0d16 60%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0b0d16";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.filter = "blur(70px)";
      const blob1 = ctx.createRadialGradient(w * 0.28, h * 0.22, 10, w * 0.28, h * 0.22, w * 0.5);
      blob1.addColorStop(0, "rgba(120, 100, 255, 0.35)");
      blob1.addColorStop(1, "rgba(120, 100, 255, 0)");
      ctx.fillStyle = blob1;
      ctx.fillRect(0, 0, w, h);
      const blob2 = ctx.createRadialGradient(w * 0.75, h * 0.68, 10, w * 0.75, h * 0.68, w * 0.55);
      blob2.addColorStop(0, shareHexToRgba(data.accent, 0.38));
      blob2.addColorStop(1, shareHexToRgba(data.accent, 0));
      ctx.fillStyle = blob2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
  },
  {
    id: "carbon",
    name: "Carbon Line",
    previewCss: "linear-gradient(135deg, #0c0c0c 0%, #16171a 100%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0c0c0c";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.lineWidth = 1;
      for (let x = -h; x < w; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }
      ctx.restore();
      const glow = ctx.createRadialGradient(w / 2, h * 0.3, 10, w / 2, h * 0.3, h * 0.5);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.22));
      glow.addColorStop(1, "rgba(12, 12, 12, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = shareHexToRgba(data.accent, 0.7);
      ctx.lineWidth = 4;
      ctx.shadowColor = shareHexToRgba(data.accent, 0.6);
      ctx.shadowBlur = 18;
      const midY = h * (data.direction === "Long" ? 0.62 : 0.4);
      const step = w / 7;
      ctx.beginPath();
      for (let i = 0; i <= 7; i++) {
        const x = i * step;
        const wobble = Math.sin(i * 1.7) * 30;
        const trend = data.direction === "Long" ? -i * 14 : i * 14;
        const y = midY + wobble + trend;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "sunset",
    name: "Sunset Pulse",
    previewCss: "radial-gradient(circle at 50% 100%, #3a1f10 0%, #0d0b12 60%)",
    drawBackground(ctx, w, h, data) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0d0b12");
      bg.addColorStop(1, "#161016");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h * 1.05, 10, w / 2, h * 1.05, h * 0.85);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.4));
      glow.addColorStop(1, "rgba(13, 11, 18, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      let seed = data.instrument.length * 17 + (data.direction === "Long" ? 3 : 7);
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const x = rand() * w, y = rand() * h * 0.75;
        const r = 2 + rand() * 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = shareHexToRgba(data.accent, 0.25 + rand() * 0.35);
        ctx.fill();
      }
      ctx.restore();
    },
  },
];

let shareState = { trade: null, metric: "net", themeId: "midnight" };

function shareDurationText(entryIso, exitIso) {
  const ms = new Date(exitIso) - new Date(entryIso);
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  return `${fmtNum(hours, 1)}h`;
}

function shareBuildData(trade, metric) {
  const isNet = metric !== "r" || tradeRMultiple(trade) === null;
  const value = isNet ? trade.net_usd : tradeRMultiple(trade);
  const positive = value >= 0;
  const accent = positive ? "#3ddc84" : "#ff6b6b";
  return {
    direction: trade.direction,
    instrument: trade.instrument,
    accent,
    metricColor: accent,
    metricValueText: isNet ? `${fmtSigned(trade.net_usd)} $` : `${fmtSigned(value, 2)}R`,
    entryText: fmtNum(trade.entry_price),
    exitText: fmtNum(trade.exit_price),
    durationText: shareDurationText(trade.entry_time, trade.exit_time),
  };
}

function shareRender() {
  const canvas = document.getElementById("share-canvas");
  const ctx = canvas.getContext("2d");
  const theme = SHARE_THEMES.find(t => t.id === shareState.themeId) || SHARE_THEMES[0];
  const data = shareBuildData(shareState.trade, shareState.metric);
  shareDrawLayout(ctx, theme, data);
}

function shareFilename(trade) {
  const safe = `${trade.instrument}_${trade.direction}`.replace(/[^a-z0-9_-]/gi, "");
  return `trade-journal_${safe}_${trade.day}.png`;
}

function initShareModal() {
  const overlay = document.getElementById("share-overlay");
  const grid = document.getElementById("share-theme-grid");
  grid.innerHTML = SHARE_THEMES.map(t => `
    <button type="button" class="share-theme-swatch" data-theme="${t.id}" style="background:${t.previewCss}">
      <span class="share-theme-swatch-label">${escapeHtml(t.name)}</span>
    </button>
  `).join("");
  grid.querySelectorAll(".share-theme-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      shareState.themeId = btn.dataset.theme;
      grid.querySelectorAll(".share-theme-swatch").forEach(b => b.classList.toggle("active", b === btn));
      shareRender();
    });
  });

  document.getElementById("share-metric-toggle").querySelectorAll(".share-metric-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      shareState.metric = btn.dataset.metric;
      document.querySelectorAll(".share-metric-btn").forEach(b => b.classList.toggle("active", b === btn));
      shareRender();
    });
  });

  document.getElementById("share-close").addEventListener("click", closeShareModal);
  attachOutsideClose(overlay, closeShareModal);

  document.getElementById("share-download-btn").addEventListener("click", () => {
    const canvas = document.getElementById("share-canvas");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = shareFilename(shareState.trade);
    a.click();
  });

  document.getElementById("share-copy-btn").addEventListener("click", async () => {
    const status = document.getElementById("share-copy-status");
    const canvas = document.getElementById("share-canvas");
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      status.textContent = "In Zwischenablage kopiert.";
      status.className = "share-copy-status ok";
    } catch (e) {
      status.textContent = "Kopieren nicht unterstützt - bitte als PNG herunterladen.";
      status.className = "share-copy-status error";
    }
  });
}
initShareModal();

function openShareModal(trade) {
  const hasR = tradeRMultiple(trade) !== null;
  shareState = { trade, metric: "net", themeId: shareState.themeId || "midnight" };

  const netBtn = document.querySelector('.share-metric-btn[data-metric="net"]');
  const rBtn = document.querySelector('.share-metric-btn[data-metric="r"]');
  netBtn.classList.add("active");
  rBtn.classList.remove("active");
  rBtn.disabled = !hasR;
  document.getElementById("share-metric-hint").hidden = hasR;

  const grid = document.getElementById("share-theme-grid");
  grid.querySelectorAll(".share-theme-swatch").forEach(b => b.classList.toggle("active", b.dataset.theme === shareState.themeId));

  document.getElementById("share-copy-status").textContent = "";
  document.getElementById("share-copy-status").className = "share-copy-status";

  shareRender();
  document.getElementById("share-overlay").classList.add("visible");
}

function closeShareModal() {
  document.getElementById("share-overlay").classList.remove("visible");
}

/* Felder der Trade-Karte in der Tagesansicht (linke Spalte) - Reihenfolge per
   Drag & Drop einstellbar, analog TRADE_CARD_FIELDS/tradeFieldOrder auf der
   Trades-Uebersicht, aber eigene Feldliste (kein "Datum", dafuer "Kumuliert")
   und eigener localStorage-Key, da die Spaltenmengen nicht identisch sind. */
const DAY_TRADE_FIELDS = [
  { key: "account", label: "Konto", render: (t, ctx) => t.account_id ? escapeHtml(ctx.accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto" },
  { key: "entry_time", label: "Entry-Zeit", render: (t) => fmtTime(t.entry_time) },
  { key: "exit_time", label: "Exit-Zeit", render: (t) => fmtTime(t.exit_time) },
  { key: "direction", label: "Richtung", render: (t) => `<span class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction === "Long" ? "▲" : "▼"} ${t.direction}</span>` },
  { key: "volume", label: "Größe", render: (t) => fmtVolume(t) },
  { key: "entry_price", label: "Entry", render: (t) => fmtNum(t.entry_price) },
  { key: "exit_price", label: "Exit", render: (t) => fmtNum(t.exit_price) },
  { key: "exit_type", label: "Exit-Typ", render: (t) => t.exit_type || "–" },
  { key: "points", label: "Punkte", render: (t) => `<span class="${cls(t.points)}">${fmtSigned(t.points, 2)}</span>` },
  { key: "net_usd", label: "Netto $", render: (t) => `<span class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</span>` },
  { key: "cumulative", label: "Kumuliert", render: (t, ctx) => `<span class="${ctx.cumClass}">${fmtSigned(ctx.cumVal)} $</span> ${ctx.hiLoBadge}` },
  { key: "tags", label: "Tags", render: null },
];
const DAY_TRADE_FIELD_KEYS = DAY_TRADE_FIELDS.map(f => f.key);

function loadDayTradeFieldOrder() {
  const saved = JSON.parse(localStorage.getItem("dayTradeFieldOrder") || "null");
  if (!Array.isArray(saved)) return [...DAY_TRADE_FIELD_KEYS];
  const known = saved.filter(k => DAY_TRADE_FIELD_KEYS.includes(k));
  for (const k of DAY_TRADE_FIELD_KEYS) if (!known.includes(k)) known.push(k);
  return known;
}
function saveDayTradeFieldOrder(order) {
  localStorage.setItem("dayTradeFieldOrder", JSON.stringify(order));
}

/* container-scoped statt ueber Ids: dieselbe Tagesansicht kann gleichzeitig
   als Seite und im Modal existieren (siehe CLAUDE.md "Bewusste
   Design-Entscheidungen"), globale Ids wuerden sich doppeln. */
function renderDayTradeFieldOrderPanel(container, onReorder) {
  const panel = container.querySelector(".day-trade-field-order-panel");
  const order = loadDayTradeFieldOrder();
  panel.innerHTML = `<div class="newsbar-filter-group-title">Ziehen zum Umsortieren</div>`
    + order.map(key => {
      const field = DAY_TRADE_FIELDS.find(f => f.key === key);
      return `<div class="trade-field-order-row" draggable="true" data-key="${key}">
        <span class="trade-field-order-handle">⠿</span>${escapeHtml(field.label)}
      </div>`;
    }).join("");

  let dragKey = null;
  panel.querySelectorAll(".trade-field-order-row").forEach(row => {
    row.addEventListener("dragstart", () => { dragKey = row.dataset.key; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = panel.querySelector(".dragging");
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.parentNode.insertBefore(dragging, before ? row : row.nextSibling);
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const newOrder = [...panel.querySelectorAll(".trade-field-order-row")].map(r => r.dataset.key);
      saveDayTradeFieldOrder(newOrder);
      onReorder();
    });
  });
}

async function openDay(day) {
  state.view = "day";
  state.currentDay = day;
  setActiveNav("");

  const content = await mountView("tpl-day");
  await populateDay(content, day);
}

/* opts.tradeIndex: welcher Trade der Liste in der linken Spalte angezeigt wird -
   bleibt beim Neuladen nach Bild-Upload/Loeschen moeglichst erhalten, statt
   immer wieder beim ersten Trade des Tages zu landen. */
async function populateDay(container, day, opts = {}) {
  container.querySelector(".day-title").textContent = fmtDate(day);

  const [data, accountOptions] = await Promise.all([
    api(withFilter(`/api/days/${day}`)),
    getAccountOptions(),
  ]);
  const s = data.stats;
  const accountNames = new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name]));

  container.querySelector(".day-stats").innerHTML =
    tile("Punkte", fmtSigned(s.total_points))
    + tile("Netto", fmtSigned(s.total_net) + " $", cls(s.total_net))
    + tile("Trades", s.trade_count)
    + tile("Tagestief (kum.)", fmtSigned(s.lowest_cum) + " $", "neg")
    + tile("Tageshoch (kum.)", fmtSigned(s.highest_cum) + " $", "pos")
    + tile("Peak-to-Valley Drawdown", fmtSigned(s.max_drawdown) + " $");

  let cum = 0;
  const cumVals = data.trades.map(t => (cum += t.net_usd));
  const highIdx = cumVals.indexOf(Math.max(...cumVals));
  const lowIdx = cumVals.indexOf(Math.min(...cumVals));

  const emptyEl = container.querySelector(".day-trade-empty");
  const bodyEl = container.querySelector(".day-trade-body");
  const toggle = container.querySelector(".day-trade-field-order-toggle");
  const panel = container.querySelector(".day-trade-field-order-panel");

  if (!data.trades.length) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    toggle.hidden = true;
  } else {
    emptyEl.hidden = true;
    bodyEl.hidden = false;
    toggle.hidden = false;

    let activeIndex = Math.min(Math.max(opts.tradeIndex || 0, 0), data.trades.length - 1);

    function renderCard() {
      const t = data.trades[activeIndex];
      const i = activeIndex;
      const cumClass = i === highIdx ? "cum-high" : (i === lowIdx ? "cum-low" : "");
      const hiLoBadge = i === highIdx ? '<span class="badge-tag">← Tageshoch</span>' : (i === lowIdx ? '<span class="badge-tag">← Tagestief</span>' : "");
      const ctx = { accountNames, cumVal: cumVals[i], cumClass, hiLoBadge };

      container.querySelector(".day-trade-index").textContent = `Trade ${i + 1} von ${data.trades.length}`;
      container.querySelector(".day-trade-prev").disabled = i === 0;
      container.querySelector(".day-trade-next").disabled = i === data.trades.length - 1;

      const order = loadDayTradeFieldOrder();
      const fieldsEl = container.querySelector(".day-trade-fields");
      fieldsEl.innerHTML = order.map(key => {
        if (key === "tags") return `<div class="day-trade-field-row"><span class="label">Tags</span><span class="tag-cell day-trade-tag-cell"></span></div>`;
        const field = DAY_TRADE_FIELDS.find(f => f.key === key);
        return `<div class="day-trade-field-row"><span class="label">${escapeHtml(field.label)}</span><span class="value">${field.render(t, ctx)}</span></div>`;
      }).join("");
      const tagCell = fieldsEl.querySelector(".day-trade-tag-cell");
      if (tagCell) renderTradeTagCell(tagCell, t);
    }
    renderCard();

    // .onclick statt addEventListener: diese Buttons liegen ausserhalb des
    // per renderCard() neu befuellten Bereichs und werden bei einem erneuten
    // populateDay()-Aufruf auf demselben Container nicht neu erzeugt -
    // addEventListener wuerde sich sonst bei jedem Aufruf stapeln.
    container.querySelector(".day-trade-prev").onclick = () => { if (activeIndex > 0) { activeIndex--; renderCard(); } };
    container.querySelector(".day-trade-next").onclick = () => { if (activeIndex < data.trades.length - 1) { activeIndex++; renderCard(); } };

    toggle.onclick = (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderDayTradeFieldOrderPanel(container, renderCard);
    };
  }

  renderDayImages(container, day, data.images || []);

  const obsCard = container.querySelector(".day-observations").closest(".card");
  if (data.trades.length) {
    obsCard.hidden = false;
    container.querySelector(".day-observations").innerHTML =
      obsTile("Ø Haltedauer", fmtDuration(s.avg_duration_sec))
      + obsTile("Größte Pause zw. Trades", fmtDuration(s.max_gap_sec))
      + obsTile("Richtung", `${s.long_count}x Long / ${s.short_count}x Short`)
      + obsTile("Preisspanne", `${fmtNum(s.price_low)} – ${fmtNum(s.price_high)}`)
      + obsTile("Erster Trade", fmtTime(data.trades[0].entry_time))
      + obsTile("Letzter Trade", fmtTime(data.trades[data.trades.length - 1].exit_time));
  } else {
    // Beobachtungen sind reine Trade-Kennzahlen - an einem Tag ohne Trades
    // (nur Bild und/oder Journal) gibt es hier nichts sinnvoll zu zeigen.
    obsCard.hidden = true;
  }

  // mountJournalEditor() steigt selbst aus, wenn der Editor fuer diesen Tag
  // schon steht - populateDay() laeuft nach jedem Bild-Upload erneut und wuerde
  // sonst ungespeicherten Text im Editor verwerfen.
  await mountJournalEditor(container.querySelector(".day-journal"), day);
}

/* ---------- Journal ----------
   Ein Eintrag haengt am Datum, nicht am Trade: ein Handelstag kann einen
   Eintrag haben, ein Eintrag braucht keinen Trade. Derselbe Editor wird an
   zwei Stellen eingehaengt (Journal-Seite und Karte im Tagesview) - deshalb
   eine mountJournalEditor()-Funktion statt zweier Implementierungen. */

let quillReady = false;

/* Schrift- und Groessenauswahl als Style-Attributoren registrieren: das
   gespeicherte HTML traegt die Formatierung dann als inline style und bleibt
   auch ohne Quill-CSS lesbar (wichtig, weil wir das HTML selbst speichern). */
const JOURNAL_FONTS = ["Georgia", "Verdana", "Trebuchet MS", "Courier New", "Arial"];
const JOURNAL_SIZES = ["12px", "14px", "16px", "18px", "24px", "32px"];

function initQuillFormats() {
  if (quillReady) return;
  const Font = Quill.import("attributors/style/font");
  Font.whitelist = JOURNAL_FONTS;
  const Size = Quill.import("attributors/style/size");
  Size.whitelist = JOURNAL_SIZES;
  Quill.register(Font, true);
  Quill.register(Size, true);
  quillReady = true;
}

const JOURNAL_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  // Die Whitelist muss hier explizit stehen: ein leeres Array wuerde Quills
  // eigene Vorgabe (Serif/Monospace bzw. Small/Large/Huge) ziehen, nicht die
  // oben registrierte.
  // false = Standardwert (keine Formatierung), sonst kaeme man nie zur
  // Grundschrift bzw. -groesse zurueck.
  [{ font: [false, ...JOURNAL_FONTS] }, { size: [false, ...JOURNAL_SIZES] }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
  [{ align: [] }, "blockquote", "code-block"],
  ["link", "image"],
  ["clean"],
];

const JOURNAL_AUTOSAVE_MS = 1500;

/* Nur ein Editor ist gleichzeitig sichtbar (Journal-Seite ODER Tagesview).
   activeJournal haelt ihn fest, damit beim Seitenwechsel, beim Schliessen des
   Modals und beim Verlassen der Seite noch ungespeicherte Aenderungen
   rausgeschrieben werden koennen. */
let activeJournal = null;

function journalStatus(text, tone = "") {
  if (!activeJournal || !activeJournal.statusEl) return;
  activeJournal.statusEl.textContent = text;
  activeJournal.statusEl.className = "journal-status " + tone;
}

function journalMarkDirty() {
  if (!activeJournal) return;
  activeJournal.dirty = true;
  journalStatus("Änderungen…", "pending");
  clearTimeout(activeJournal.timer);
  activeJournal.timer = setTimeout(() => saveJournal(), JOURNAL_AUTOSAVE_MS);
}

async function saveJournal(force = false) {
  const j = activeJournal;
  if (!j || (!j.dirty && !force)) return;
  clearTimeout(j.timer);
  j.dirty = false;
  const html = j.quill.getLength() > 1 ? j.quill.root.innerHTML : "";
  const payload = {
    title: "",
    content_html: html,
    plain_text: j.quill.getText(),
    rating: j.rating,
    mood: j.mood,
    followed_plan: j.followedPlan,
    tag_ids: [...j.tagIds],
  };
  try {
    const res = await api(`/api/journal/${j.entryType}/${j.refKey}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    journalStatus("Gespeichert", "saved");
    if (j.onSaved) j.onSaved(res.entry);
  } catch (e) {
    j.dirty = true;
    journalStatus("Nicht gespeichert: " + e.message, "error");
  }
}

/* Loescht den Eintrag nach Bestaetigung (Loeschen-Button + Ja/Nein-Dialog =
   zwei Klicks, wie gewuenscht). Setzt den Editor danach leer statt ihn
   zu schliessen, damit sofort weitergeschrieben werden kann. */
async function deleteJournalEntry() {
  const j = activeJournal;
  if (!j) return;
  const label = j.entryType === "trade" ? `zu Trade #${j.refKey}` : `vom ${fmtDate(j.refKey)}`;
  if (!await confirmDelete(`Journal-Eintrag ${label} wirklich löschen?`, false)) return;
  clearTimeout(j.timer);
  j.dirty = false;
  await api(`/api/journal/${j.entryType}/${j.refKey}`, { method: "DELETE" });
  j.quill.setContents([]);
  j.rating = null;
  j.mood = null;
  j.followedPlan = null;
  j.tagIds.clear();
  j.host.querySelectorAll(".journal-score-btn.active, .journal-plan-btn.active").forEach(b => b.classList.remove("active"));
  j.host.querySelectorAll(".tag-chip-filter.active").forEach(c => c.classList.remove("active"));
  journalStatus("Gelöscht", "saved");
  if (j.onSaved) j.onSaved(null);
}

/* Vor jedem Wechsel der Ansicht aufrufen - sonst geht der letzte, noch nicht
   automatisch gespeicherte Absatz verloren. */
async function flushJournal() {
  if (activeJournal && activeJournal.dirty) await saveJournal();
}
window.addEventListener("beforeunload", () => {
  if (activeJournal && activeJournal.dirty) saveJournal();
  if (activeNotebookNote && activeNotebookNote.dirty) saveNotebookNote();
});

function journalScoreRow(label, name, value, labels) {
  const buttons = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="journal-score-btn${value === n ? " active" : ""}" data-score="${n}" title="${labels[n - 1]}">${n}</button>`
  ).join("");
  return `<div class="journal-metric" data-metric="${name}">
      <span class="journal-metric-label">${label}</span>
      <div class="journal-score-row">${buttons}
        <button type="button" class="journal-score-clear" title="Zurücksetzen">×</button>
      </div>
    </div>`;
}

const RATING_LABELS = ["Sehr schlecht", "Schlecht", "Durchschnitt", "Gut", "Sehr gut"];
const MOOD_LABELS = ["Sehr schlecht", "Angeschlagen", "Neutral", "Gut", "Topfit"];

/* Haengt den Editor in host ein. host.dataset.journalRef merkt sich den bereits
   gemounteten Tag: populateDay() laeuft mehrfach auf demselben Container (z.B.
   nach jedem Bild-Upload) und wuerde den Editor sonst samt ungespeichertem Text
   neu aufbauen. */
async function mountJournalEditor(host, refKey, opts = {}) {
  if (!host) return;
  if (host.dataset.journalRef === refKey) return;
  await flushJournal();
  initQuillFormats();
  host.dataset.journalRef = refKey;
  const entryType = opts.entryType || "day";
  const imageDay = opts.imageDay || refKey;

  const [res, tags, templates] = await Promise.all([
    api(`/api/journal/${entryType}/${refKey}`),
    getTags(),
    getJournalTemplates(),
  ]);
  const entry = res.entry;

  const isTrade = entryType === "trade";
  host.innerHTML = `
    <div class="journal-editor">
      <div class="journal-metrics">
        ${journalScoreRow(isTrade ? "Trade-Bewertung" : "Tagesbewertung", "rating", entry ? entry.rating : null, RATING_LABELS)}
        ${journalScoreRow("Verfassung", "mood", entry ? entry.mood : null, MOOD_LABELS)}
        <div class="journal-metric" data-metric="plan">
          <span class="journal-metric-label">Plan befolgt</span>
          <div class="journal-score-row">
            <button type="button" class="journal-plan-btn" data-plan="1">Ja</button>
            <button type="button" class="journal-plan-btn" data-plan="0">Nein</button>
          </div>
        </div>
      </div>
      <div class="journal-templates"></div>
      <div class="journal-quill"></div>
      <div class="journal-tag-picker">
        <div class="journal-section-label">${isTrade ? "Tags für diesen Trade" : "Tags für diesen Tag"}</div>
        <div class="journal-tag-chips"></div>
      </div>
      <div class="journal-footer">
        <button type="button" class="btn btn-primary journal-save-btn">Speichern</button>
        <button type="button" class="btn btn-danger journal-delete-btn">Eintrag löschen</button>
        <span class="journal-status"></span>
      </div>
    </div>`;

  const quill = new Quill(host.querySelector(".journal-quill"), {
    theme: "snow",
    placeholder: isTrade ? "Wie ist dieser Trade gelaufen? Was hast du gelernt?" : "Was ist heute passiert? Was hast du gelernt?",
    modules: { toolbar: { container: JOURNAL_TOOLBAR } },
  });
  if (entry && entry.content_html) quill.clipboard.dangerouslyPasteHTML(entry.content_html);

  activeJournal = {
    refKey, quill, host, entryType, imageDay,
    dirty: false, timer: null,
    rating: entry ? entry.rating : null,
    mood: entry ? entry.mood : null,
    followedPlan: entry ? entry.followed_plan : null,
    tagIds: new Set((entry ? entry.tags : []).map(t => t.id)),
    statusEl: host.querySelector(".journal-status"),
    onSaved: opts.onSaved || null,
  };

  quill.on("text-change", (delta, old, source) => {
    if (source === "user") journalMarkDirty();
  });

  // Bilder nicht als base64 einbetten (das blaeht die Datenbank auf), sondern
  // ueber den bestehenden Bild-Upload des Tages hochladen und nur verlinken.
  quill.getModule("toolbar").addHandler("image", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const fd = new FormData();
      fd.append("file", input.files[0]);
      if (isTrade) fd.append("trade_id", refKey);
      const img = await api(`/api/days/${imageDay}/images`, { method: "POST", body: fd });
      const range = quill.getSelection(true);
      quill.insertEmbed(range.index, "image", `/media/${img.filename}`, "user");
      quill.setSelection(range.index + 1);
    };
    input.click();
  });

  host.querySelectorAll(".journal-metric[data-metric='rating'], .journal-metric[data-metric='mood']").forEach(metric => {
    const field = metric.dataset.metric;
    metric.querySelectorAll(".journal-score-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        activeJournal[field] = parseInt(btn.dataset.score, 10);
        metric.querySelectorAll(".journal-score-btn").forEach(b => b.classList.toggle("active", b === btn));
        journalMarkDirty();
      });
    });
    metric.querySelector(".journal-score-clear").addEventListener("click", () => {
      activeJournal[field] = null;
      metric.querySelectorAll(".journal-score-btn").forEach(b => b.classList.remove("active"));
      journalMarkDirty();
    });
  });

  const planButtons = host.querySelectorAll(".journal-plan-btn");
  const paintPlan = () => planButtons.forEach(b =>
    b.classList.toggle("active", activeJournal.followedPlan !== null
      && parseInt(b.dataset.plan, 10) === activeJournal.followedPlan));
  paintPlan();
  planButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const value = parseInt(btn.dataset.plan, 10);
      activeJournal.followedPlan = activeJournal.followedPlan === value ? null : value;
      paintPlan();
      journalMarkDirty();
    });
  });

  const chipWrap = host.querySelector(".journal-tag-chips");
  if (!tags.length) {
    chipWrap.innerHTML = `<div class="empty-state" style="padding:6px 0">Noch keine Tags angelegt.</div>`;
  } else {
    chipWrap.appendChild(buildTagChipGroups(
      tags,
      (tag) => activeJournal.tagIds.has(tag.id),
      (tag, chip) => {
        if (activeJournal.tagIds.has(tag.id)) activeJournal.tagIds.delete(tag.id);
        else activeJournal.tagIds.add(tag.id);
        chip.classList.toggle("active");
        journalMarkDirty();
      },
    ));
  }

  const tplWrap = host.querySelector(".journal-templates");
  tplWrap.innerHTML = "";
  if (templates.length) {
    const label = document.createElement("span");
    label.className = "journal-section-label";
    label.textContent = "Vorlage einfügen:";
    tplWrap.appendChild(label);
    for (const tpl of templates) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "newsbar-chip";
      btn.textContent = tpl.name;
      btn.addEventListener("click", () => {
        // Ans Ende anhaengen statt ersetzen - eine Vorlage darf nie Text
        // loeschen. Vorher einen leeren Absatz erzeugen, sonst verschmilzt die
        // erste Ueberschrift der Vorlage mit dem letzten vorhandenen Absatz.
        if (quill.getLength() > 1) quill.insertText(quill.getLength() - 1, "\n", "user");
        quill.clipboard.dangerouslyPasteHTML(quill.getLength() - 1, tpl.content_html, "user");
        journalMarkDirty();
      });
      tplWrap.appendChild(btn);
    }
  } else {
    const hint = document.createElement("span");
    hint.className = "journal-section-label";
    hint.textContent = "Noch keine Vorlagen angelegt.";
    tplWrap.appendChild(hint);
  }
  const manageLink = document.createElement("button");
  manageLink.type = "button";
  manageLink.className = "journal-tpl-manage-link";
  manageLink.textContent = "Vorlagen verwalten →";
  manageLink.addEventListener("click", () => goToJournalTemplateSettings());
  tplWrap.appendChild(manageLink);

  host.querySelector(".journal-save-btn").addEventListener("click", () => saveJournal(true));
  host.querySelector(".journal-delete-btn").addEventListener("click", () => deleteJournalEntry());
  quill.root.addEventListener("blur", () => { if (activeJournal && activeJournal.dirty) saveJournal(); });
}

let cachedJournalTemplates = null;
async function getJournalTemplates(force = false) {
  if (force || !cachedJournalTemplates) cachedJournalTemplates = await api("/api/journal-templates");
  return cachedJournalTemplates;
}

/* ---------- Journal-Seite ---------- */

const JOURNAL_MODES = [
  { key: "all", label: "Alle Einträge" },
  { key: "with_trades", label: "Mit Trades" },
  { key: "without_trades", label: "Ohne Trades" },
  { key: "gaps", label: "Handelstage ohne Eintrag" },
];

function journalListQS() {
  const parts = [`type=day`, `mode=${state.journalMode}`];
  if (state.journalMonth) {
    const [y, m] = state.journalMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    parts.push(`start=${state.journalMonth}-01`, `end=${state.journalMonth}-${String(lastDay).padStart(2, "0")}`);
  }
  if (state.journalQuery) parts.push(`q=${encodeURIComponent(state.journalQuery)}`);
  if (state.journalTagKeys.length) parts.push(`tags=${encodeURIComponent(state.journalTagKeys.join(","))}`);
  return "/api/journal?" + parts.join("&");
}

function journalPreview(entry) {
  const text = (entry.plain_text || "").replace(/\s+/g, " ").trim();
  if (!text) return entry.id ? "(leer)" : "Noch kein Eintrag";
  return text.length > 110 ? text.slice(0, 110) + "…" : text;
}

function journalStars(rating) {
  if (!rating) return "";
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

/* ---------- Journal: Jahr/Monat-Uebersicht ----------
   Einstiegsebene des Journals: Monats-Kacheln gruppiert nach Jahr statt einer
   endlosen Tagesliste. Sobald gesucht/gefiltert wird oder ein Monat geoeffnet
   ist, weicht die Uebersicht der bisherigen Liste+Editor-Ansicht - siehe
   journalListMode()/updateJournalViewMode(). */

function journalListMode() {
  return !!(state.journalMonth || state.journalQuery || state.journalTagKeys.length || state.journalMode !== "all");
}

function updateJournalViewMode() {
  const monthsEl = document.getElementById("journal-months");
  const layoutEl = document.getElementById("journal-layout");
  const crumbEl = document.getElementById("journal-breadcrumb");
  const crumbCurrent = document.getElementById("journal-breadcrumb-current");
  if (!monthsEl || !layoutEl) return;
  const listMode = journalListMode();
  monthsEl.hidden = listMode;
  layoutEl.hidden = !listMode;
  crumbEl.hidden = !listMode;
  if (crumbCurrent) {
    crumbCurrent.textContent = state.journalMonth
      ? monthLabel(...state.journalMonth.split("-").map(Number))
      : "Suchergebnisse";
  }
}

function journalBackToOverview() {
  state.journalMonth = null;
  state.journalQuery = "";
  state.journalTagKeys = [];
  state.journalMode = "all";
  state.journalSearchScope = "journal";
  const search = document.getElementById("journal-search");
  if (search) search.value = "";
  document.querySelectorAll("#journal-mode-chips .newsbar-chip").forEach((c, i) => {
    c.classList.toggle("active", JOURNAL_MODES[i]?.key === "all");
  });
  document.querySelectorAll("#journal-search-scope-chips .newsbar-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.scope === "journal");
  });
  updateJournalScopeUI();
  renderJournalTagFilter();
  updateJournalViewMode();
  renderJournalMonths();
}

/* Blendet die komplette Journal-Browsing-Zeile (Modus-Chips, Tag-Filter,
   Datum+Eintrag-Button) aus, wenn der Suchbereich rein auf Notizbücher
   eingeschraenkt ist - sie wirkt dann auf nichts Sichtbares und der
   "+ Eintrag"-Button suggeriert sonst faelschlich, man koenne darueber einen
   Notizbuch-Eintrag anlegen. Bei "both" bleibt sie an, da der Journal-Teil
   der Ergebnisse weiterhin gefiltert wird. */
function updateJournalScopeUI() {
  const filterRow = document.querySelector(".journal-filter-row");
  if (filterRow) filterRow.hidden = state.journalSearchScope === "notebooks";
}

async function openJournalMonth(monthKey) {
  state.journalMonth = monthKey;
  updateJournalViewMode();
  await renderJournalList();
}

async function renderJournalMonths() {
  const jumpEl = document.getElementById("journal-year-jump");
  const groupsEl = document.getElementById("journal-year-groups");
  if (!groupsEl) return;
  const { months } = await api("/api/journal/months");
  jumpEl.innerHTML = "";
  groupsEl.innerHTML = "";
  if (!months.length) {
    groupsEl.innerHTML = `<div class="empty-state">Noch keine Handelstage oder Journal-Einträge vorhanden.</div>`;
    return;
  }
  const byYear = new Map();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(m);
  }
  for (const year of byYear.keys()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip-filter journal-year-chip";
    chip.style.setProperty("--tag-color", "var(--accent)");
    chip.textContent = year;
    chip.addEventListener("click", () => {
      document.getElementById(`journal-year-${year}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    jumpEl.appendChild(chip);
  }
  for (const [year, list] of byYear) {
    const yearNet = list.reduce((sum, m) => sum + (m.net_usd || 0), 0);
    const group = document.createElement("div");
    group.className = "journal-year-group";
    group.id = `journal-year-${year}`;
    group.innerHTML = `
      <div class="journal-year-heading">
        <span>${year}</span>
        <span class="journal-year-net ${cls(yearNet)}">${fmtSigned(yearNet)} $</span>
      </div>
      <div class="journal-month-grid"></div>`;
    const grid = group.querySelector(".journal-month-grid");
    for (const m of list) grid.appendChild(journalMonthTileEl(m));
    groupsEl.appendChild(group);
  }
}

function journalMonthTileEl(m) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "journal-month-tile" + (m.trade_count ? ` tile-${cls(m.net_usd)}` : "");
  const [y, mo] = m.month.split("-").map(Number);
  const label = new Date(y, mo - 1, 1).toLocaleDateString("de-DE", { month: "long" });
  const ratingHtml = m.avg_rating
    ? `<span class="journal-month-rating">${journalStars(Math.round(m.avg_rating))} <span class="muted">${m.avg_rating.toFixed(1)}</span></span>`
    : "";
  const netHtml = m.trade_count
    ? `<span class="journal-month-net ${cls(m.net_usd)}">${fmtSigned(m.net_usd)} $</span>`
    : `<span class="journal-month-net muted">kein Trade</span>`;
  const gap = m.trading_days - m.entry_count;
  const gapHtml = gap > 0
    ? `<div class="journal-month-gap">≈ ${gap} Handelstag${gap === 1 ? "" : "e"} ohne Eintrag</div>`
    : "";
  el.innerHTML = `
    <div class="journal-month-tile-top">
      <span class="journal-month-name">${label}</span>
      ${netHtml}
    </div>
    <div class="journal-month-tile-meta">
      <span>${m.entry_count} Eintrag${m.entry_count === 1 ? "" : "e"}</span>
      ${ratingHtml}
    </div>
    ${gapHtml}`;
  el.addEventListener("click", () => openJournalMonth(m.month));
  return el;
}

async function renderJournalList() {
  const listEl = document.getElementById("journal-list");
  const nbListEl = document.getElementById("notebook-search-list");
  if (!listEl) return;
  const scope = state.journalSearchScope;
  const showJournal = scope !== "notebooks";
  const showNotebooks = scope !== "journal";

  listEl.hidden = !showJournal;
  if (nbListEl) {
    nbListEl.hidden = !showNotebooks;
    if (showNotebooks) await renderNotebookSearchResults(nbListEl, scope === "both");
    else nbListEl.innerHTML = "";
  }
  if (!showJournal) {
    listEl.innerHTML = "";
    state.journalSelectedKeys.clear();
    updateJournalBulkBar();
    return;
  }

  const { entries } = await api(journalListQS());
  listEl.innerHTML = scope === "both" ? `<div class="newsbar-filter-group-title journal-list-section-label">Journal</div>` : "";
  if (!entries.length) {
    listEl.innerHTML += `<div class="empty-state">Keine Einträge für diese Auswahl.</div>`;
    return;
  }
  // Auswahl auf tatsaechlich geladene, existierende Eintraege begrenzen -
  // virtuelle "Luecken"-Zeilen (mode=gaps, id=null) haben nichts zu loeschen.
  const existingKeys = new Set(entries.filter(e => e.id).map(e => e.ref_key));
  for (const key of [...state.journalSelectedKeys]) {
    if (!existingKeys.has(key)) state.journalSelectedKeys.delete(key);
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "journal-item-row";

    if (entry.id) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "journal-item-checkbox";
      checkbox.checked = state.journalSelectedKeys.has(entry.ref_key);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.journalSelectedKeys.add(entry.ref_key);
        else state.journalSelectedKeys.delete(entry.ref_key);
        updateJournalBulkBar();
      });
      row.appendChild(checkbox);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "journal-item-checkbox-spacer";
      row.appendChild(spacer);
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "journal-item" + (entry.ref_key === state.journalRefKey ? " active" : "");
    const stats = entry.day_stats;
    const netHtml = stats
      ? `<span class="journal-item-net ${cls(stats.net_usd)}">${fmtSigned(stats.net_usd)} $</span>`
      : `<span class="journal-item-net muted">kein Trade</span>`;
    const meta = [
      stats ? `${stats.trade_count} Trade(s)` : null,
      entry.rating ? journalStars(entry.rating) : null,
    ].filter(Boolean).join(" · ");
    item.innerHTML = `
      <div class="journal-item-top">
        <span class="journal-item-date">${fmtDate(entry.ref_key)}</span>${netHtml}
      </div>
      ${meta ? `<div class="journal-item-meta">${meta}</div>` : ""}
      <div class="journal-item-preview${entry.id ? "" : " muted"}">${escapeHtml(journalPreview(entry))}</div>
      <div class="journal-item-tags">${entry.tags.map(tagChipHtml).join("")}</div>`;
    // Bei aktiver Volltextsuche im Modal oeffnen statt in die Editor-Spalte zu
    // laden: die Liste bleibt dann unveraendert im Hintergrund sichtbar und
    // "Schliessen" fuehrt direkt zu den Suchergebnissen zurueck, statt dass
    // man - wie zuvor - keinen Weg zurueck zur Suche hatte.
    item.addEventListener("click", () => {
      if (state.journalQuery) openJournalModal(entry.ref_key);
      else selectJournalEntry(entry.ref_key);
    });
    row.appendChild(item);
    listEl.appendChild(row);
  }
  updateJournalBulkBar();
}

/* Zeigt/versteckt die Sammelleiste je nach Auswahlgroesse und haelt die
   Zaehl-Anzeige aktuell - wird nach jeder Auswahlaenderung aufgerufen. */
function updateJournalBulkBar() {
  const bar = document.getElementById("journal-bulk-bar");
  if (!bar) return;
  const n = state.journalSelectedKeys.size;
  bar.hidden = n === 0;
  const countEl = document.getElementById("journal-bulk-count");
  if (countEl) countEl.textContent = n === 1 ? "1 Eintrag ausgewählt" : `${n} Einträge ausgewählt`;
}

async function bulkDeleteJournalEntries() {
  const keys = [...state.journalSelectedKeys];
  if (!keys.length) return;
  const label = keys.length === 1
    ? `den Journal-Eintrag vom ${fmtDate(keys[0])}`
    : `${keys.length} Journal-Einträge`;
  if (!await confirmDelete(`Soll ${label} wirklich gelöscht werden?`, false)) return;
  await api("/api/journal/day/bulk-delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref_keys: keys }),
  });
  if (keys.includes(state.journalRefKey)) {
    // Der offene Eintrag wurde mitgeloescht - Editor leeren statt auf
    // gespeicherte, jetzt nicht mehr existente Daten zu verweisen.
    activeJournal = null;
    const host = document.getElementById("journal-page-host");
    if (host) { host.innerHTML = ""; host.dataset.journalRef = ""; }
    state.journalRefKey = null;
  }
  state.journalSelectedKeys.clear();
  await renderJournalList();
}

async function selectJournalEntry(refKey) {
  state.journalRefKey = refKey;
  document.querySelectorAll("#journal-list .journal-item").forEach(el => el.classList.remove("active"));
  const host = document.getElementById("journal-page-host");
  if (!host) return;
  host.dataset.journalRef = "";
  await mountJournalEditor(host, refKey, { onSaved: () => renderJournalList() });
  renderJournalList();
}

async function renderJournalTagFilter() {
  const panel = document.getElementById("journal-tag-panel");
  if (!panel) return;
  const tags = await getTags();
  panel.innerHTML = "";
  if (!tags.length) {
    panel.innerHTML = `<div class="empty-state" style="padding:6px 0">Noch keine Tags angelegt.</div>`;
  } else {
    panel.appendChild(buildTagChipGroups(
      tags,
      (tag) => state.journalTagKeys.includes(String(tag.id)),
      (tag, chip) => {
        const keys = new Set(state.journalTagKeys);
        if (keys.has(String(tag.id))) keys.delete(String(tag.id)); else keys.add(String(tag.id));
        state.journalTagKeys = [...keys];
        chip.classList.toggle("active");
        document.getElementById("journal-tag-count").textContent =
          state.journalTagKeys.length ? `(${state.journalTagKeys.length})` : "";
        updateJournalViewMode();
        renderJournalList();
      },
    ));
  }
  document.getElementById("journal-tag-count").textContent =
    state.journalTagKeys.length ? `(${state.journalTagKeys.length})` : "";
}

async function openJournal() {
  state.view = "journal";
  state.currentDay = null;
  setActiveNav("journal");

  const content = await mountView("tpl-journal");
  state.journalSelectedKeys.clear();

  document.querySelector(".journal-bulk-clear").addEventListener("click", () => {
    state.journalSelectedKeys.clear();
    renderJournalList();
  });
  document.querySelector(".journal-bulk-delete").addEventListener("click", () => bulkDeleteJournalEntries());

  document.getElementById("journal-breadcrumb-root").addEventListener("click", () => journalBackToOverview());

  const modeRow = document.getElementById("journal-mode-chips");
  for (const mode of JOURNAL_MODES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "newsbar-chip" + (state.journalMode === mode.key ? " active" : "");
    chip.textContent = mode.label;
    chip.addEventListener("click", () => {
      state.journalMode = mode.key;
      modeRow.querySelectorAll(".newsbar-chip").forEach(c => c.classList.toggle("active", c === chip));
      updateJournalViewMode();
      renderJournalList();
    });
    modeRow.appendChild(chip);
  }

  const search = document.getElementById("journal-search");
  search.value = state.journalQuery;
  let searchTimer = null;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.journalQuery = search.value.trim();
      updateJournalViewMode();
      renderJournalList();
    }, 300);
  });

  const scopeChips = document.querySelectorAll("#journal-search-scope-chips .newsbar-chip");
  scopeChips.forEach(chip => {
    chip.classList.toggle("active", chip.dataset.scope === state.journalSearchScope);
    chip.addEventListener("click", () => {
      state.journalSearchScope = chip.dataset.scope;
      scopeChips.forEach(c => c.classList.toggle("active", c === chip));
      updateJournalScopeUI();
      renderJournalList();
    });
  });
  updateJournalScopeUI();

  const tagToggle = document.getElementById("journal-tag-toggle");
  const tagPanel = document.getElementById("journal-tag-panel");
  tagToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    tagPanel.hidden = !tagPanel.hidden;
  });
  await renderJournalTagFilter();

  const dateInput = document.getElementById("journal-new-date");
  dateInput.value = new Date().toISOString().slice(0, 10);
  document.getElementById("journal-new-btn").addEventListener("click", () => {
    if (!dateInput.value) return;
    state.journalMonth = dateInput.value.slice(0, 7);
    updateJournalViewMode();
    renderJournalList();
    selectJournalEntry(dateInput.value);
  });

  updateJournalViewMode();
  await renderJournalMonths();
  await renderJournalList();
  if (state.journalRefKey) await selectJournalEntry(state.journalRefKey);

  document.querySelectorAll(".journal-view-tab").forEach(tab => {
    tab.addEventListener("click", () => switchJournalTab(tab.dataset.journalTab));
  });
  document.getElementById("nb-add-folder-btn").addEventListener("click", () => notebookCreateDirect(null, "folder"));
  document.getElementById("nb-add-note-btn").addEventListener("click", () => notebookCreateDirect(null, "note"));

  // Drop auf den freien Bereich der Baum-Palette (nicht auf einer Zeile) -
  // loest den gezogenen Knoten auf die oberste Ebene. Einmalig hier verdrahtet
  // statt in renderNotebookTree(), weil das Baum-Element selbst bei jedem
  // Rerender erhalten bleibt (nur innerHTML wird geleert) und sonst bei jedem
  // Aufruf ein weiterer Listener dazukaeme.
  const notebookTreeEl = document.getElementById("notebook-tree");
  notebookTreeEl.addEventListener("dragover", (e) => {
    if (!nbDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    notebookTreeEl.classList.add("nb-drop-target-root");
  });
  notebookTreeEl.addEventListener("dragleave", (e) => {
    if (e.target === notebookTreeEl) notebookTreeEl.classList.remove("nb-drop-target-root");
  });
  notebookTreeEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    notebookTreeEl.classList.remove("nb-drop-target-root");
    if (!nbDrag) return;
    const draggedId = nbDrag.id;
    nbDrag = null;
    await notebookMoveTo(draggedId, null);
  });

  await switchJournalTab(state.journalTab, true);
}

/* ---------- Notizbuecher: frei verschachtelbare Ordner/Notizen ----------
   Zweiter Bereich neben dem Tages-Tagebuch, fuer Inhalte ohne Kalenderbezug
   (Strategie, Beobachtungen, Unterlagen, Logins, ...). Ordner koennen beliebig
   tief verschachtelt und jederzeit unter einen anderen Ordner verschoben
   werden (siehe move_notebook_node in db.py fuer die Zyklus-Pruefung). */

const NB_ICON_FOLDER = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`;
const NB_ICON_NOTE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/></svg>`;
const NB_ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;

async function switchJournalTab(tab, force = false) {
  if (!force && state.journalTab === tab) return;
  await flushNotebookNote();
  state.journalTab = tab;
  document.querySelectorAll(".journal-view-tab").forEach(t => t.classList.toggle("active", t.dataset.journalTab === tab));
  document.getElementById("journal-diary-panel").hidden = tab !== "diary";
  document.getElementById("notebook-panel").hidden = tab !== "notebooks";
  if (tab === "notebooks") await renderNotebookTree();
}

function loadNotebookExpandedState() {
  try {
    state.notebookExpanded = new Set(JSON.parse(localStorage.getItem("notebookExpanded") || "[]"));
  } catch {
    state.notebookExpanded = new Set();
  }
}
function saveNotebookExpandedState() {
  localStorage.setItem("notebookExpanded", JSON.stringify([...state.notebookExpanded]));
}

async function fetchNotebookNodes() {
  const { nodes } = await api("/api/notebooks");
  return nodes;
}

/* Notizbuch-Treffer der Journal-Suche (Scope "Notizbücher"/"Beides") - eigene
   Liste neben #journal-list statt Einmischung in die Tages-Eintraege-Karten,
   da Notizen weder Datum noch Trade-Bezug haben. */
async function renderNotebookSearchResults(container, withLabel) {
  const query = state.journalQuery;
  if (!query) {
    container.innerHTML = `<div class="empty-state">Suchbegriff eingeben, um Notizbücher zu durchsuchen.</div>`;
    return;
  }
  const { notes } = await api(`/api/notebooks/search?q=${encodeURIComponent(query)}`);
  container.innerHTML = withLabel ? `<div class="newsbar-filter-group-title journal-list-section-label">Notizbücher</div>` : "";
  if (!notes.length) {
    container.innerHTML += `<div class="empty-state">Keine Notizen gefunden.</div>`;
    return;
  }
  for (const note of notes) {
    const preview = (note.plain_text || "").replace(/\s+/g, " ").trim();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "journal-item notebook-search-item";
    item.innerHTML = `
      <div class="journal-item-top"><span class="journal-item-date">${escapeHtml(note.name)}</span></div>
      <div class="journal-item-meta">${escapeHtml(note.path || "Oberste Ebene")}</div>
      <div class="journal-item-preview${preview ? "" : " muted"}">${escapeHtml(preview ? shortenLabel(preview, 110) : "(leer)")}</div>`;
    item.addEventListener("click", () => openNotebookSearchResult(note.id, note.path));
    container.appendChild(item);
  }
}

/* Oeffnet einen Notizbuch-Suchtreffer im Modal statt auf den Notizbücher-Tab
   umzuschalten - die Suchergebnisse bleiben dahinter unveraendert sichtbar,
   "Schliessen" fuehrt also automatisch zur Suche zurueck (vorher: Tab-Wechsel
   ohne Weg zurueck zu den Treffern). */
async function openNotebookSearchResult(nodeId, path) {
  await flushNotebookNote();
  activeNotebookNote = null;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = `<section class="view">
      ${path ? `<div class="notebook-modal-path">${escapeHtml(path)}</div>` : ""}
      <div class="notebook-editor-host" id="notebook-modal-host"></div>
    </section>`;
  overlay.classList.add("visible");
  modalOnClose = () => { if (state.view === "journal") renderJournalList(); };
  await mountNotebookEditor(document.getElementById("notebook-modal-host"), nodeId);
}

/* Alle Nachfahren eines Knotens aus der flachen Liste - iterativ ueber
   parent_id, damit weder Backend-Rundtrips noch WITH RECURSIVE noetig sind. */
function notebookDescendantIds(nodes, rootId) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parent_id ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  const ids = new Set();
  const stack = [rootId];
  while (stack.length) {
    for (const child of byParent.get(stack.pop()) || []) {
      if (!ids.has(child.id)) { ids.add(child.id); stack.push(child.id); }
    }
  }
  return ids;
}

async function renderNotebookTree() {
  const treeEl = document.getElementById("notebook-tree");
  if (!treeEl) return;
  const nodes = await fetchNotebookNodes();
  treeEl.innerHTML = "";
  if (!nodes.length) {
    treeEl.innerHTML = `<div class="empty-state notebook-tree-empty">Noch keine Ordner oder Notizen - oben anlegen.</div>`;
    return;
  }
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parent_id ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const node of byParent.get("root") || []) {
    treeEl.appendChild(notebookRowEl(node, 0, byParent));
  }
}

function notebookRowEl(node, depth, byParent) {
  const isFolder = node.node_type === "folder";
  const expanded = state.notebookExpanded.has(node.id);

  const wrap = document.createElement("div");
  wrap.className = "nb-row" + (node.id === state.notebookSelectedId ? " selected" : "");
  wrap.dataset.id = node.id;

  const main = document.createElement("div");
  main.className = "nb-row-main";
  // Ab einer gewissen Tiefe nicht weiter einruecken, sonst frisst die
  // Einrueckung bei langen Ketten irgendwann den kompletten Platz fuer den
  // Namen weg (siehe Tooltip auf .nb-name als zusaetzliche Absicherung).
  main.style.paddingLeft = `${6 + Math.min(depth, 10) * 18}px`;

  if (isFolder) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nb-toggle" + (expanded ? " expanded" : "");
    toggle.setAttribute("aria-label", expanded ? "Ordner einklappen" : "Ordner ausklappen");
    toggle.innerHTML = NB_ICON_CHEVRON;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotebookFolder(node.id);
    });
    main.appendChild(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "nb-toggle-spacer";
    main.appendChild(spacer);
  }

  const icon = document.createElement("span");
  icon.className = "nb-icon";
  icon.innerHTML = isFolder ? NB_ICON_FOLDER : NB_ICON_NOTE;
  main.appendChild(icon);

  const name = document.createElement("span");
  name.className = "nb-name";
  name.textContent = node.name;
  name.title = node.name;
  main.appendChild(name);

  const actions = document.createElement("div");
  actions.className = "nb-row-actions";

  if (isFolder) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "nb-icon-btn";
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", `Neu in "${node.name}"`);
    addBtn.addEventListener("click", (e) => { e.stopPropagation(); notebookCreateFlow(node.id); });
    actions.appendChild(addBtn);
  }

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "nb-icon-btn";
  renameBtn.textContent = "✎";
  renameBtn.setAttribute("aria-label", "Umbenennen");
  renameBtn.addEventListener("click", (e) => { e.stopPropagation(); notebookRenameFlow(node); });
  actions.appendChild(renameBtn);

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.className = "nb-icon-btn";
  moveBtn.textContent = "⇄";
  moveBtn.setAttribute("aria-label", "Verschieben nach…");
  moveBtn.addEventListener("click", (e) => { e.stopPropagation(); notebookMoveFlow(node); });
  actions.appendChild(moveBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nb-icon-btn nb-delete";
  delBtn.textContent = "×";
  delBtn.setAttribute("aria-label", "Löschen");
  delBtn.addEventListener("click", (e) => { e.stopPropagation(); notebookDeleteFlow(node); });
  actions.appendChild(delBtn);

  main.appendChild(actions);
  main.addEventListener("click", () => {
    if (isFolder) toggleNotebookFolder(node.id);
    else selectNotebookNote(node.id);
  });
  wireNotebookDragAndDrop(main, node, isFolder);
  wrap.appendChild(main);

  if (isFolder && expanded) {
    const childWrap = document.createElement("div");
    childWrap.className = "nb-children";
    for (const child of byParent.get(node.id) || []) {
      childWrap.appendChild(notebookRowEl(child, depth + 1, byParent));
    }
    wrap.appendChild(childWrap);
  }
  return wrap;
}

/* Haelt den gerade gezogenen Knoten fest, waehrend eine Drag&Drop-Operation
   laeuft - null ausserhalb einer Operation. excludeIds (der Knoten selbst
   plus bei einem Ordner alle Nachfahren) verhindert schon waehrend des
   Ziehens optisch ungueltige Ziele, statt erst nach dem Drop einen
   Server-Fehler anzuzeigen. */
let nbDrag = null;

function wireNotebookDragAndDrop(main, node, isFolder) {
  main.draggable = true;
  main.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    nbDrag = { id: node.id, excludeIds: new Set([node.id]) };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(node.id));
    main.classList.add("nb-dragging");
    if (isFolder) {
      fetchNotebookNodes().then(nodes => {
        for (const id of notebookDescendantIds(nodes, node.id)) nbDrag?.excludeIds.add(id);
      });
    }
  });
  main.addEventListener("dragend", () => {
    main.classList.remove("nb-dragging");
    document.querySelectorAll(".nb-drop-target").forEach(el => el.classList.remove("nb-drop-target"));
    nbDrag = null;
  });

  if (isFolder) {
    main.addEventListener("dragover", (e) => {
      // stopPropagation immer, auch bei ungueltigem Ziel - sonst blubbert
      // das Ereignis zum Baum-Root-Drop-Handler hoch und der wuerde einen
      // eigentlich abgelehnten Drop faelschlich als "auf oberste Ebene
      // verschieben" werten.
      e.stopPropagation();
      if (!nbDrag || nbDrag.excludeIds.has(node.id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      main.classList.add("nb-drop-target");
    });
    main.addEventListener("dragleave", (e) => { e.stopPropagation(); main.classList.remove("nb-drop-target"); });
    main.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      main.classList.remove("nb-drop-target");
      if (!nbDrag || nbDrag.excludeIds.has(node.id)) return;
      const draggedId = nbDrag.id;
      nbDrag = null;
      if (draggedId === node.id) return;
      await notebookMoveTo(draggedId, node.id);
    });
  } else {
    // Notizen koennen keine Kinder enthalten - Drop hier ablehnen, aber
    // stoppen, damit es nicht als Drop auf die oberste Ebene durchschlaegt.
    main.addEventListener("dragover", (e) => e.stopPropagation());
    main.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); });
  }
}

async function notebookMoveTo(draggedId, targetParentId) {
  try {
    await api(`/api/notebooks/${draggedId}/move`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: targetParentId }),
    });
  } catch (e) {
    alert(e.message);
    return;
  }
  if (targetParentId !== null) { state.notebookExpanded.add(targetParentId); saveNotebookExpandedState(); }
  await renderNotebookTree();
}

function toggleNotebookFolder(folderId) {
  if (state.notebookExpanded.has(folderId)) state.notebookExpanded.delete(folderId);
  else state.notebookExpanded.add(folderId);
  saveNotebookExpandedState();
  renderNotebookTree();
}

async function notebookCreateNode(parentId, nodeType, name) {
  const { node } = await api("/api/notebooks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId, node_type: nodeType, name }),
  });
  if (parentId) { state.notebookExpanded.add(parentId); saveNotebookExpandedState(); }
  await renderNotebookTree();
  if (nodeType === "note") await selectNotebookNote(node.id);
  return node;
}

async function notebookCreateDirect(parentId, nodeType) {
  const label = nodeType === "folder" ? "Name des Ordners:" : "Titel der Notiz:";
  const name = await promptDialog(label, nodeType === "folder" ? "Neuer Ordner" : "Neue Notiz");
  if (!name) return;
  await notebookCreateNode(parentId, nodeType, name);
}

/* "+" innerhalb eines Ordners - anders als die Werkzeugleiste (zwei getrennte
   Buttons) muss hier erst geklaert werden, ob ein Unterordner oder eine
   Notiz entstehen soll. */
function notebookTypeDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">Was möchtest du anlegen?</div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
          <button class="btn btn-secondary" data-type="folder">Ordner</button>
          <button class="btn btn-primary" data-type="note">Notiz</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function cleanup(result) { overlay.remove(); resolve(result); }
    attachOutsideClose(overlay, () => cleanup(null));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(null));
    overlay.querySelectorAll("[data-type]").forEach(btn => {
      btn.addEventListener("click", () => cleanup(btn.dataset.type));
    });
  });
}

async function notebookCreateFlow(parentId) {
  const nodeType = await notebookTypeDialog();
  if (!nodeType) return;
  await notebookCreateDirect(parentId, nodeType);
}

async function notebookRenameFlow(node) {
  const name = await promptDialog("Neuer Name:", node.name);
  if (!name || name === node.name) return;
  await api(`/api/notebooks/${node.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await renderNotebookTree();
  if (state.notebookSelectedId === node.id && activeNotebookNote) {
    activeNotebookNote.titleEl.value = name;
  }
}

/* Statt Drag&Drop (bei beliebiger Verschachtelungstiefe schwer treffsicher zu
   bedienen) ein Zielordner-Dialog - deckt "loesen und neu verknuepfen" ab,
   ohne Baum-Drag-Handling zu brauchen. Ordner koennen nicht in sich selbst
   oder einen eigenen Nachfahren verschoben werden (serverseitig zusaetzlich
   abgesichert, siehe move_notebook_node). */
function pickNotebookParentDialog(nodes, excludeIds, currentParentId) {
  return new Promise((resolve) => {
    const folders = nodes.filter(n => n.node_type === "folder" && !excludeIds.has(n.id));
    const byParent = new Map();
    for (const f of folders) {
      const key = f.parent_id ?? "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    }
    const rows = [];
    (function walk(key, depth) {
      for (const f of (byParent.get(key) || []).slice().sort((a, b) => a.name.localeCompare(b.name, "de"))) {
        rows.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      }
    })("root", 0);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    const rootSuffix = currentParentId === null ? " – aktuell" : "";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">Wohin verschieben?</div>
        <div class="notebook-move-list">
          <button type="button" class="notebook-move-option" data-id="" style="padding-left:10px">(Oberste Ebene)${rootSuffix}</button>
          ${rows.map(r => `<button type="button" class="notebook-move-option" data-id="${r.id}" style="padding-left:${10 + r.depth * 16}px">${escapeHtml(r.name)}${r.id === currentParentId ? " – aktuell" : ""}</button>`).join("")}
        </div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function cleanup(result) { overlay.remove(); resolve(result); }
    attachOutsideClose(overlay, () => cleanup(undefined));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(undefined));
    overlay.querySelectorAll(".notebook-move-option").forEach(btn => {
      btn.addEventListener("click", () => cleanup(btn.dataset.id ? Number(btn.dataset.id) : null));
    });
  });
}

async function notebookMoveFlow(node) {
  const nodes = await fetchNotebookNodes();
  const excludeIds = new Set([node.id]);
  if (node.node_type === "folder") {
    for (const id of notebookDescendantIds(nodes, node.id)) excludeIds.add(id);
  }
  const targetId = await pickNotebookParentDialog(nodes, excludeIds, node.parent_id);
  if (targetId === undefined || targetId === node.parent_id) return;
  await notebookMoveTo(node.id, targetId);
}

async function notebookDeleteFlow(node) {
  const nodes = await fetchNotebookNodes();
  const descendantIds = node.node_type === "folder" ? notebookDescendantIds(nodes, node.id) : new Set();
  const label = node.node_type === "folder"
    ? `den Ordner "${node.name}"${descendantIds.size ? ` samt ${descendantIds.size} enthaltenem Eintrag/Einträgen` : ""}`
    : `die Notiz "${node.name}"`;
  if (!await confirmDelete(`Soll ${label} wirklich gelöscht werden?`, descendantIds.size > 0)) return;
  await api(`/api/notebooks/${node.id}`, { method: "DELETE" });
  if (state.notebookSelectedId === node.id || descendantIds.has(state.notebookSelectedId)) {
    state.notebookSelectedId = null;
    activeNotebookNote = null;
    resetNotebookEditorHost();
  }
  await renderNotebookTree();
}

function resetNotebookEditorHost() {
  const host = document.getElementById("notebook-editor-host");
  if (!host) return;
  host.innerHTML = `<div class="empty-state">Ordner oder Notiz links auswählen bzw. anlegen.</div>`;
  host.dataset.notebookId = "";
}

const NOTEBOOK_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  [{ font: [false, ...JOURNAL_FONTS] }, { size: [false, ...JOURNAL_SIZES] }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ list: "ordered" }, { list: "bullet" }, { indent: "-1" }, { indent: "+1" }],
  [{ align: [] }, "blockquote", "code-block"],
  ["link", "image"],
  ["clean"],
];

let activeNotebookNote = null;

async function selectNotebookNote(nodeId) {
  await flushNotebookNote();
  state.notebookSelectedId = nodeId;
  document.querySelectorAll("#notebook-tree .nb-row").forEach(el => {
    el.classList.toggle("selected", Number(el.dataset.id) === nodeId);
  });
  const host = document.getElementById("notebook-editor-host");
  await mountNotebookEditor(host, nodeId);
}

async function mountNotebookEditor(host, nodeId) {
  if (!host) return;
  if (host.dataset.notebookId === String(nodeId)) return;
  initQuillFormats();
  host.dataset.notebookId = String(nodeId);

  const { node } = await api(`/api/notebooks/${nodeId}`);
  host.innerHTML = `
    <input type="text" class="notebook-note-title" id="notebook-note-title" value="${escapeHtml(node.name)}" placeholder="Titel">
    <div class="journal-quill" id="notebook-quill"></div>
    <div class="journal-footer">
      <button type="button" class="btn btn-danger" id="notebook-delete-btn">Notiz löschen</button>
      <span class="journal-status" id="notebook-note-status"></span>
    </div>`;

  const quill = new Quill(host.querySelector("#notebook-quill"), {
    theme: "snow",
    placeholder: "Frei schreiben…",
    modules: { toolbar: { container: NOTEBOOK_TOOLBAR } },
  });
  if (node.content_html) quill.clipboard.dangerouslyPasteHTML(node.content_html);

  activeNotebookNote = {
    nodeId, quill, host, dirty: false, timer: null,
    statusEl: host.querySelector("#notebook-note-status"),
    titleEl: host.querySelector("#notebook-note-title"),
  };

  // Bilder in Notizen haengen an keinem Tag - eigener Upload-Endpunkt statt
  // des tagesgebundenen /api/days/{day}/images (siehe mountJournalEditor).
  quill.getModule("toolbar").addHandler("image", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const fd = new FormData();
      fd.append("file", input.files[0]);
      const img = await api(`/api/notebooks/${nodeId}/images`, { method: "POST", body: fd });
      const range = quill.getSelection(true);
      quill.insertEmbed(range.index, "image", `/media/${img.filename}`, "user");
      quill.setSelection(range.index + 1);
      notebookMarkDirty();
    };
    input.click();
  });

  quill.on("text-change", (delta, old, source) => { if (source === "user") notebookMarkDirty(); });
  activeNotebookNote.titleEl.addEventListener("input", () => notebookMarkDirty());
  quill.root.addEventListener("blur", () => { if (activeNotebookNote && activeNotebookNote.dirty) saveNotebookNote(); });
  activeNotebookNote.titleEl.addEventListener("blur", () => { if (activeNotebookNote && activeNotebookNote.dirty) saveNotebookNote(); });
  host.querySelector("#notebook-delete-btn").addEventListener("click", () => notebookDeleteFlow(node));
}

function notebookStatus(text, tone = "") {
  if (!activeNotebookNote || !activeNotebookNote.statusEl) return;
  activeNotebookNote.statusEl.textContent = text;
  activeNotebookNote.statusEl.className = "journal-status " + tone;
}

function notebookMarkDirty() {
  if (!activeNotebookNote) return;
  activeNotebookNote.dirty = true;
  notebookStatus("Änderungen…", "pending");
  clearTimeout(activeNotebookNote.timer);
  activeNotebookNote.timer = setTimeout(() => saveNotebookNote(), JOURNAL_AUTOSAVE_MS);
}

async function saveNotebookNote(force = false) {
  const n = activeNotebookNote;
  if (!n || (!n.dirty && !force)) return;
  clearTimeout(n.timer);
  n.dirty = false;
  const name = n.titleEl.value.trim() || "Ohne Titel";
  const payload = {
    name,
    // getText() ignoriert eingebettete Bilder (Embeds zaehlen nicht als Text) -
    // getLength() > 1 (Quill haengt immer ein abschliessendes Newline an)
    // erkennt auch eine Notiz, die nur aus einem Bild ohne Text besteht.
    content_html: n.quill.getLength() > 1 ? n.quill.root.innerHTML : "",
    plain_text: n.quill.getText(),
  };
  try {
    await api(`/api/notebooks/${n.nodeId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    notebookStatus("Gespeichert", "saved");
    const nameEl = document.querySelector(`#notebook-tree .nb-row[data-id="${n.nodeId}"] > .nb-row-main .nb-name`);
    if (nameEl) { nameEl.textContent = name; nameEl.title = name; }
  } catch (e) {
    n.dirty = true;
    notebookStatus("Nicht gespeichert: " + e.message, "error");
  }
}

async function flushNotebookNote() {
  if (activeNotebookNote && activeNotebookNote.dirty) await saveNotebookNote();
}

/* ---------- To-Do-Listen ----------
   Angelegt/verwaltet im Journal-Tab "To-Do-Listen" (Liste anlegen, Eintraege
   hinzufuegen, umbenennen, sichtbar schalten, endgueltig loeschen). Das
   rechte Menue (Newsbar) zeigt nur die als "visible" markierten Listen rein
   lesend zum Abhaken - Klick auf den Text togglet done, ohne dass der
   Eintrag verschwindet (siehe update_todo_item in db.py). Nach jeder
   Aenderung wird beides neu geladen statt optimistisch aktualisiert, gleiches
   Vorgehen wie beim Notizbuch (z.B. notebookRenameFlow -> renderNotebookTree). */

async function refreshTodoUI() {
  await loadTodoWidget();
  if (state.view === "todos") await renderTodoManagePanel();
}

async function openTodos() {
  state.view = "todos";
  state.currentDay = null;
  setActiveNav("todos");
  await mountView("tpl-todos");
  document.getElementById("todo-add-list-btn").addEventListener("click", () => todoListCreateFlow());
  await renderTodoManagePanel();
}

async function loadTodoWidget() {
  const section = document.getElementById("todo-widget-section");
  const container = document.getElementById("todo-widget-lists");
  if (!section || !container) return;
  let lists;
  try {
    ({ lists } = await api("/api/todo-lists"));
  } catch (e) {
    return;
  }
  const visible = lists.filter(l => l.visible);
  section.hidden = visible.length === 0;
  container.innerHTML = "";
  if (!visible.length) return;
  for (const list of visible) {
    const group = document.createElement("div");
    group.className = "todo-widget-group";
    const title = document.createElement("div");
    title.className = "todo-widget-group-title";
    title.textContent = list.name;
    title.title = list.name;
    group.appendChild(title);
    const itemsEl = document.createElement("div");
    itemsEl.className = "todo-widget-items";
    if (!list.items.length) {
      itemsEl.innerHTML = `<div class="todo-widget-empty">Keine Einträge.</div>`;
    } else {
      for (const item of list.items) itemsEl.appendChild(todoWidgetItemEl(item));
    }
    group.appendChild(itemsEl);
    container.appendChild(group);
  }
}

function todoWidgetItemEl(item) {
  const row = document.createElement("div");
  row.className = "todo-item" + (item.done ? " done" : "");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.title = "Klicken zum Abhaken";
  const text = document.createElement("span");
  text.className = "todo-item-text";
  text.textContent = item.text;
  row.appendChild(text);
  row.addEventListener("click", () => toggleTodoItemDone(item));
  row.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    row.click();
  });
  return row;
}

async function toggleTodoItemDone(item) {
  await api(`/api/todo-items/${item.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: !item.done }),
  });
  await refreshTodoUI();
}

async function renderTodoManagePanel() {
  const container = document.getElementById("todo-manage-lists");
  const emptyEl = document.getElementById("todo-manage-empty");
  if (!container) return;
  const { lists } = await api("/api/todo-lists");
  container.innerHTML = "";
  emptyEl.hidden = lists.length > 0;
  for (const list of lists) container.appendChild(todoManageCardEl(list));
}

function todoManageCardEl(list) {
  const card = document.createElement("div");
  card.className = "todo-manage-card";

  const header = document.createElement("div");
  header.className = "todo-manage-card-header";

  const name = document.createElement("button");
  name.type = "button";
  name.className = "todo-manage-card-name";
  name.textContent = list.name;
  name.title = "Klicken zum Umbenennen";
  name.addEventListener("click", () => todoListRenameFlow(list));
  header.appendChild(name);

  const visibleLabel = document.createElement("label");
  visibleLabel.className = "todo-visible-toggle";
  visibleLabel.innerHTML = `
    <span class="todo-switch">
      <input type="checkbox" ${list.visible ? "checked" : ""}>
      <span class="todo-switch-track"></span>
    </span>
    <span>Rechtes Menü</span>`;
  visibleLabel.querySelector("input").addEventListener("change", (e) => todoListSetVisible(list.id, e.target.checked));
  header.appendChild(visibleLabel);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nb-icon-btn nb-delete";
  delBtn.textContent = "×";
  delBtn.setAttribute("aria-label", "Liste löschen");
  delBtn.addEventListener("click", () => todoListDeleteFlow(list));
  header.appendChild(delBtn);

  card.appendChild(header);

  const addRow = document.createElement("form");
  addRow.className = "todo-manage-add-row";
  addRow.innerHTML = `<input type="text" placeholder="Neuer Eintrag…" autocomplete="off">
    <button type="submit" class="btn btn-secondary">+ Eintrag</button>`;
  addRow.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = addRow.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await api(`/api/todo-lists/${list.id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await refreshTodoUI();
    } finally {
      input.disabled = false;
    }
  });
  card.appendChild(addRow);

  const itemsEl = document.createElement("div");
  itemsEl.className = "todo-manage-items";
  if (!list.items.length) {
    itemsEl.innerHTML = `<div class="empty-state todo-manage-items-empty">Noch keine Einträge.</div>`;
  } else {
    for (const item of list.items) itemsEl.appendChild(todoManageItemEl(item));
  }
  card.appendChild(itemsEl);

  return card;
}

function todoManageItemEl(item) {
  const row = document.createElement("div");
  row.className = "todo-manage-item" + (item.done ? " done" : "");

  const text = document.createElement("span");
  text.className = "todo-manage-item-text";
  text.textContent = item.text;
  text.title = "Klicken zum Abhaken";
  text.addEventListener("click", () => toggleTodoItemDone(item));
  row.appendChild(text);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nb-icon-btn nb-delete todo-manage-item-delete";
  delBtn.textContent = "×";
  delBtn.setAttribute("aria-label", "Eintrag endgültig löschen");
  delBtn.addEventListener("click", () => todoItemDeleteFlow(item));
  row.appendChild(delBtn);

  return row;
}

async function todoListCreateFlow() {
  const name = await promptDialog("Name der neuen To-Do-Liste:", "Neue Liste");
  if (!name) return;
  await api("/api/todo-lists", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshTodoUI();
}

async function todoListRenameFlow(list) {
  const name = await promptDialog("Neuer Name der Liste:", list.name);
  if (!name || name === list.name) return;
  await api(`/api/todo-lists/${list.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshTodoUI();
}

async function todoListSetVisible(listId, visible) {
  await api(`/api/todo-lists/${listId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible }),
  });
  await refreshTodoUI();
}

async function todoListDeleteFlow(list) {
  if (!await confirmDelete(`Soll die To-Do-Liste "${list.name}" samt allen Einträgen wirklich gelöscht werden?`)) return;
  await api(`/api/todo-lists/${list.id}`, { method: "DELETE" });
  await refreshTodoUI();
}

async function todoItemDeleteFlow(item) {
  if (!await confirmDelete(`Eintrag "${item.text}" endgültig löschen?`, false)) return;
  await api(`/api/todo-items/${item.id}`, { method: "DELETE" });
  await refreshTodoUI();
}

/* ---------- Bilder & Lightbox ---------- */

/* onDeleted (optional): Callback zum Neuladen der jeweiligen Ansicht nach dem
   Loeschen - direkter Loeschen-Button auf der Miniatur selbst, damit man
   dafuer nicht erst durch die Lightbox (Klick zum Vergroessern) muss. */
function imageThumbEl(img, sizeClass, onDeleted) {
  const div = document.createElement("div");
  div.className = sizeClass;
  div.innerHTML = `<img src="/media/${img.thumb_filename}" alt="" loading="lazy">`;
  div.addEventListener("click", () => openLightbox(img));
  if (onDeleted) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "image-thumb-delete";
    delBtn.title = "Bild löschen";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Bild wirklich löschen?")) return;
      await api(`/api/images/${img.id}`, { method: "DELETE" });
      await onDeleted();
    });
    div.appendChild(delBtn);
  }
  return div;
}

async function uploadImage(day, file, tradeId) {
  const fd = new FormData();
  fd.append("file", file);
  if (tradeId !== null && tradeId !== undefined) fd.append("trade_id", tradeId);
  await api(`/api/days/${day}/images`, { method: "POST", body: fd });
}

function renderDayImages(container, day, images) {
  const strip = container.querySelector(".day-images");
  strip.innerHTML = "";
  images.filter(im => im.trade_id === null).forEach(img => {
    strip.appendChild(imageThumbEl(img, "image-thumb", () => populateDay(container, day)));
  });

  const input = container.querySelector(".day-image-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    await uploadImage(day, file, null);
    await populateDay(container, day);
  };
}

const LIGHTBOX_DEFAULT_SIZE = { width: 720, height: 520 };
let lightboxCurrentImage = null;
let lightboxOpenDay = null;

function getLightboxSize() {
  try {
    const saved = JSON.parse(localStorage.getItem("lightboxSize") || "null");
    if (saved && saved.width && saved.height) return saved;
  } catch (e) { /* ignore */ }
  return { ...LIGHTBOX_DEFAULT_SIZE };
}
function saveLightboxSize(size) {
  localStorage.setItem("lightboxSize", JSON.stringify(size));
}

/* Ab 2200px/3200px Fensterbreite skaliert die App per CSS-Zoom hoch (siehe
   style.css) - Chromium rendert dabei JEDEN in px geschriebenen Wert eines
   Nachfahren-Elements zusaetzlich mal diesem Zoom-Faktor (bestaetigt: 720px
   geschriebene Breite kommt bei zoom:1.15 als 828px = 720*1.15 gerendert
   zurueck). window.innerWidth/innerHeight sind davon nicht betroffen und
   zeigen weiterhin die echte Fenstergroesse. Jeder Code, der eine Zielgroesse
   in echten Bildschirm-Pixeln berechnet und dann per style.width/height/left/
   top setzt, muss deshalb durch den Zoom-Faktor teilen. */
function currentZoom() {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

function positionLightboxBox(size) {
  const box = document.getElementById("lightbox-box");
  // Eine gespeicherte Groesse kann von einem groesseren Monitor stammen -
  // hier immer auf das aktuelle Fenster begrenzen (gleiche Grenzen wie beim
  // manuellen Ziehen am Handle), sonst ragt die Box ueber den Bildschirm
  // hinaus und die Toolbar (Groesse speichern/Standardgroesse/Loeschen) am
  // unteren Rand wird unerreichbar. Die gespeicherte Praeferenz selbst bleibt
  // dabei unangetastet - zurueck auf dem grossen Monitor gilt sie wieder voll.
  const maxWidth = window.innerWidth * 0.96;
  const maxHeight = window.innerHeight * 0.9;
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  // top/left einmalig fest setzen (nicht ueber Flexbox zentrieren) - sonst
  // verschiebt sich der Anker waehrend des Resize-Drags mit dem Mauszeiger mit.
  const left = Math.max(10, Math.round((window.innerWidth - width) / 2));
  const top = Math.max(10, Math.round((window.innerHeight - height) / 2));
  const zoom = currentZoom();
  box.style.left = (left / zoom) + "px";
  box.style.top = (top / zoom) + "px";
  box.style.width = (width / zoom) + "px";
  box.style.height = (height / zoom) + "px";
}

function openLightbox(img) {
  lightboxCurrentImage = img;
  lightboxOpenDay = img.day || state.currentDay;

  const overlay = document.getElementById("lightbox-overlay");
  const imgEl = document.getElementById("lightbox-img");
  imgEl.src = `/media/${img.filename}`;

  positionLightboxBox(getLightboxSize());
  overlay.classList.add("visible");
}

function closeLightbox() {
  document.getElementById("lightbox-overlay").classList.remove("visible");
  lightboxCurrentImage = null;
}

/* Eigener Resize-Griff statt natives CSS resize: waechst symmetrisch um den
   Mittelpunkt der Box, statt nur von der oben-links-Ecke aus - die gezogene
   Ecke folgt dabei exakt dem Mauszeiger, da centerX/centerY beim Start fix
   eingefroren werden und Breite/Hoehe direkt aus dem Abstand zum Zeiger
   berechnet werden (kein Nachlaufen, kein Drift). */
(function setupLightboxResize() {
  const handle = document.getElementById("lightbox-handle");
  const box = document.getElementById("lightbox-box");
  let centerX = 0, centerY = 0;

  const minWidth = 280, minHeight = 220;

  function onMove(e) {
    const maxWidth = window.innerWidth * 0.96;
    const maxHeight = window.innerHeight * 0.9;
    const width = Math.min(maxWidth, Math.max(minWidth, Math.abs(e.clientX - centerX) * 2));
    const height = Math.min(maxHeight, Math.max(minHeight, Math.abs(e.clientY - centerY) * 2));
    const zoom = currentZoom();
    box.style.width = (width / zoom) + "px";
    box.style.height = (height / zoom) + "px";
    box.style.left = ((centerX - width / 2) / zoom) + "px";
    box.style.top = ((centerY - height / 2) / zoom) + "px";
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
  }

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
attachOutsideClose(document.getElementById("lightbox-overlay"), closeLightbox);
document.getElementById("lightbox-reset").addEventListener("click", () => {
  positionLightboxBox(LIGHTBOX_DEFAULT_SIZE);
  saveLightboxSize({ ...LIGHTBOX_DEFAULT_SIZE });
});
document.getElementById("lightbox-save").addEventListener("click", (e) => {
  const box = document.getElementById("lightbox-box");
  const rect = box.getBoundingClientRect();
  saveLightboxSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.textContent = "✓ Gespeichert";
  setTimeout(() => { btn.textContent = original; }, 1200);
});
document.getElementById("lightbox-delete").addEventListener("click", async () => {
  if (!lightboxCurrentImage) return;
  if (!confirm("Bild wirklich löschen?")) return;
  await api(`/api/images/${lightboxCurrentImage.id}`, { method: "DELETE" });
  closeLightbox();
  if (document.getElementById("modal-overlay").classList.contains("visible")) {
    await populateDay(document.getElementById("modal-body"), lightboxOpenDay);
  } else if (state.view === "day" && state.currentDay) {
    await populateDay(document.getElementById("content"), state.currentDay);
  } else if (state.view === "trade" && state.currentTradeId) {
    await populateTrade(document.getElementById("content"), state.currentTradeId);
  }
});

/* ---------- Monatsübersicht ---------- */

async function openMonth() {
  state.view = "month";
  state.currentDay = null;
  setActiveNav("month");

  const now = new Date();
  if (!state.monthYear) state.monthYear = now.getFullYear();
  if (!state.monthNum) state.monthNum = now.getMonth() + 1;

  const content = await mountView("tpl-month");

  content.querySelector(".month-prev").addEventListener("click", () => shiftMonth(-1));
  content.querySelector(".month-next").addEventListener("click", () => shiftMonth(1));

  await renderMonth();
}

function shiftMonth(delta) {
  let y = state.monthYear, m = state.monthNum + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.monthYear = y;
  state.monthNum = m;
  renderMonth();
}

async function renderMonth() {
  const data = await api(withFilter(`/api/month/${state.monthYear}/${state.monthNum}`));
  const content = document.getElementById("content");
  content.querySelector(".month-label").textContent = monthLabel(state.monthYear, state.monthNum);

  content.querySelector(".month-stats").innerHTML =
    tile("Netto gesamt", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Punkte gesamt", fmtSigned(data.total_points))
    + tile("Trades gesamt", data.total_trades)
    + tile("Handelstage", data.trading_days);

  const grid = content.querySelector(".month-grid");
  grid.innerHTML = "";
  ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((wd, idx) => {
    const el = document.createElement("div");
    el.className = "month-grid-head" + (idx >= 5 ? " weekend" : "");
    el.textContent = wd;
    grid.appendChild(el);
  });
  for (let i = 1; i < data.first_weekday; i++) {
    const el = document.createElement("div");
    el.className = "month-cell empty";
    grid.appendChild(el);
  }
  for (const d of data.days) {
    const el = document.createElement("div");
    const dayNum = parseInt(d.date.split("-")[2], 10);
    const hasTrades = d.trades > 0;
    // Auch ohne Trades oeffenbar, wenn es dort ein Bild oder einen Journal-
    // Eintrag gibt - sonst laesst sich das von der Zelle aus nicht erreichen
    // (die farbige has-trades-Klasse bleibt bewusst an echte Trades gebunden,
    // sonst wuerde ein trade-loser Tag faelschlich gruen/rot eingefaerbt).
    const openable = hasTrades || d.has_image || d.has_journal;
    const isWeekend = [0, 6].includes(new Date(d.date + "T00:00:00").getDay());
    el.className = "month-cell" + (isWeekend ? " weekend" : "")
      + (hasTrades ? " has-trades " + (d.net >= 0 ? "cell-pos" : "cell-neg") : "")
      + (openable && !hasTrades ? " clickable" : "");
    el.innerHTML = `<div class="cell-date">${dayNum}</div>`
      + `<div class="cell-icons">`
      + `<span class="cell-journal-icon${d.has_journal ? "" : " cell-journal-icon-empty"}" title="${d.has_journal ? "Journal-Eintrag vorhanden - anzeigen" : "Noch kein Journal-Eintrag - anlegen"}">📝</span>`
      + (d.has_image ? `<span class="cell-image-icon" title="Bild vorhanden">📷</span>` : "")
      + `</div>`
      + (hasTrades ? `<div class="cell-net">${fmtSigned(d.net)} $</div><div class="cell-count">${d.trades} Trades</div>` : "");
    // Icon oeffnet immer den Journal-Eintrag des Tages (auch zum Neuanlegen an
    // Tagen ohne Trade) - eigener Klick-Handler, damit er unabhaengig vom
    // Zellen-Klick (der nur bei Handelstagen das Tagesdetail oeffnet) funktioniert.
    el.querySelector(".cell-journal-icon").addEventListener("click", (e) => {
      e.stopPropagation();
      openJournalModal(d.date);
    });
    if (openable) el.addEventListener("click", () => openDayModal(d.date));
    grid.appendChild(el);
  }

  const tbody = content.querySelector("#month-days-table tbody");
  tbody.innerHTML = "";
  // Nur Tage mit Trade, Journal-Eintrag oder Bild - reine Nicht-Handelstage
  // ohne jede Notiz/Bild haben hier nichts zu zeigen und wuerden die Liste
  // nur mit Leerzeilen fuellen.
  const relevantDays = data.days.filter(d => d.trades > 0 || d.has_journal || d.has_image);
  if (!relevantDays.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Keine Trades, Journal-Einträge oder Bilder in diesem Monat.</div></td></tr>`;
  }
  for (const d of relevantDays) {
    const hasTrades = d.trades > 0;
    const openable = hasTrades || d.has_image || d.has_journal;
    const tr = document.createElement("tr");
    if (openable) tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${d.date}</td>
      <td>${hasTrades ? d.trades : "–"}</td>
      <td class="${hasTrades ? cls(d.points) : ""}">${hasTrades ? fmtSigned(d.points, 2) : "–"}</td>
      <td class="${hasTrades ? cls(d.net) : ""}">${hasTrades ? fmtSigned(d.net) + " $" : "–"}</td>
      <td class="journal-cell">${d.has_journal
        ? `<span class="journal-marker" title="Journal-Eintrag vorhanden${d.journal_rating ? " – Bewertung " + d.journal_rating + "/5" : ""}">📝${d.journal_rating ? ` ${d.journal_rating}/5` : ""}</span>`
        : `<span class="muted">–</span>`}</td>
      <td>${d.has_image ? `<span title="Bild vorhanden">📷</span>` : `<span class="muted">–</span>`}</td>
    `;
    tr.querySelector(".journal-cell").addEventListener("click", (e) => {
      e.stopPropagation();
      openJournalModal(d.date);
    });
    if (openable) tr.addEventListener("click", () => openDayModal(d.date));
    tbody.appendChild(tr);
  }
}

function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

/* ---------- Tages-Modal ---------- */

async function openDayModal(day) {
  await flushJournal();
  activeJournal = null;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = "";
  body.appendChild(document.getElementById("tpl-day").content.cloneNode(true));
  overlay.classList.add("visible");
  // Nach dem Schliessen die Monatsuebersicht neu laden, damit ein frisch
  // angelegter/geaenderter Journal-Eintrag (oder ein geloeschtes Bild) sofort
  // im Kalender-Icon auftaucht, ohne dass man selbst neu laden muss.
  modalOnClose = () => { if (state.view === "month") renderMonth(); };
  await populateDay(body, day);
}

/* Journal-Eintrag eines Tages in einem Fenster statt auf der Journal-Seite -
   fuer die Monatsuebersicht: Eintrag machen, Fenster schliessen, direkt mit
   dem naechsten Tag im Kalender weitermachen, ohne die Seite zu verlassen. */
async function openJournalModal(day) {
  await flushJournal();
  activeJournal = null;
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <section class="view">
      <header class="view-header"><h1>${fmtDate(day)}</h1></header>
      <div class="journal-editor-host" id="journal-modal-host"></div>
    </section>`;
  overlay.classList.add("visible");
  // Nach dem Schliessen die Monatsuebersicht bzw. (bei einem aus der
  // Journal-Suche geoeffneten Eintrag) die Trefferliste neu laden, damit ein
  // frisch angelegter/geloeschter Eintrag sofort sichtbar ist.
  modalOnClose = () => {
    if (state.view === "month") renderMonth();
    else if (state.view === "journal") renderJournalList();
  };
  await mountJournalEditor(document.getElementById("journal-modal-host"), day);
}

let modalOnClose = null;

async function closeModal() {
  // Journal- bzw. Notizbuch-Editor im Modal werden gleich unsichtbar - vorher
  // rausschreiben, und zwar abgewartet statt nur angestossen, damit ein
  // anschliessendes Neuladen (modalOnClose) die gespeicherten Daten schon sieht.
  await flushJournal();
  await flushNotebookNote();
  document.getElementById("modal-overlay").classList.remove("visible");
  if (modalOnClose) {
    const cb = modalOnClose;
    modalOnClose = null;
    cb();
  }
}

document.getElementById("modal-close").addEventListener("click", closeModal);
attachOutsideClose(document.getElementById("modal-overlay"), closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("lightbox-overlay").classList.contains("visible")) {
    closeLightbox();
  } else {
    closeModal();
  }
});

function obsTile(label, value) {
  return `<div class="obs-tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

/* ---------- Chart (inline SVG, keine externe Lib) ---------- */

function lineChartSvg(values, labels, baseline = 0) {
  const w = 1000, h = 260, padL = 62, padR = 16, padT = 14, padB = 28;

  // Wertebereich mit Puffer statt fest bei 0 zu starten - sonst quetscht ein
  // Kontostand (z.B. 9.800-10.500) sich auf ein paar Pixel am oberen Rand
  // zusammen, waehrend der riesige ungenutzte Bereich bis 0 leer bleibt.
  // Das Startkapital fliesst mit in die Spanne ein, damit die Referenzlinie
  // immer sichtbar bleibt, auch wenn die Kurve nie in ihre Naehe kommt.
  const rawMin = Math.min(...values, baseline), rawMax = Math.max(...values, baseline);
  const span = (rawMax - rawMin) || Math.abs(rawMax) || 1;
  const pad = span * 0.15;
  const min = rawMin - pad, max = rawMax + pad;
  const range = (max - min) || 1;
  const stepX = (w - padL - padR) / (values.length - 1 || 1);

  const x = i => padL + i * stepX;
  const y = v => padT + (h - padT - padB) * (1 - (v - min) / range);

  const last = values[values.length - 1];
  const cs = getComputedStyle(document.documentElement);
  const green = cs.getPropertyValue("--green").trim();
  const red = cs.getPropertyValue("--red").trim();
  const border = cs.getPropertyValue("--border").trim();
  const faint = cs.getPropertyValue("--text-faint").trim();
  const text = cs.getPropertyValue("--text").trim();

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const baselineY = y(baseline);
  // Flaeche zwischen Kurve und Startkapital-Linie (nicht bis zum Kartenrand) -
  // so entsteht optisch ein Gewinn-/Verlust-Band relativ zum Startkapital.
  const areaPoints = `${x(0)},${baselineY} ${points} ${x(values.length - 1)},${baselineY}`;

  // Horizontale Gitterlinien mit Werten - macht den ungefaehren Stand an
  // jeder Stelle der Kurve ablesbar, ohne jeden Punkt einzeln pruefen zu muessen.
  const GRID_LINES = 4;
  let gridSvg = "";
  for (let i = 0; i <= GRID_LINES; i++) {
    const v = min + (range * i / GRID_LINES);
    const gy = y(v);
    gridSvg += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="${border}" stroke-width="1" opacity="0.6" />`;
    gridSvg += `<text x="${padL - 8}" y="${gy + 3}" fill="${faint}" font-size="10" text-anchor="end">${fmtNum(v, 0)}</text>`;
  }

  // X-Achse: mehrere Datums-Labels statt nur Anfang/Ende, damit man den
  // Zeitpunkt eines Kurvenabschnitts grob zuordnen kann.
  const maxLabels = Math.min(6, values.length);
  let xLabelsSvg = "";
  if (values.length === 1) {
    xLabelsSvg = `<text x="${x(0)}" y="${h - 8}" fill="${faint}" font-size="10" text-anchor="middle">${labels[0]}</text>`;
  } else {
    for (let i = 0; i < maxLabels; i++) {
      const idx = Math.round(i * (values.length - 1) / (maxLabels - 1));
      const anchor = idx === 0 ? "start" : idx === values.length - 1 ? "end" : "middle";
      xLabelsSvg += `<text x="${x(idx)}" y="${h - 8}" fill="${faint}" font-size="10" text-anchor="${anchor}">${labels[idx]}</text>`;
    }
  }

  // Sichtbare Punkte, Farbe je nachdem ob ueber oder unter dem Startkapital.
  const dots = values.map((v, i) =>
    `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${v >= baseline ? green : red}" />`
  ).join("");

  // Grosse unsichtbare Trefferflaechen statt des nativen (verzoegerten,
  // winzigen) SVG-<title>-Tooltips - macht Hover sofort und leichter zu
  // treffen. Werte liegen als data-Attribute fuer attachChartTooltip() bereit.
  const hitAreas = values.map((v, i) =>
    `<circle class="chart-dot-hit" cx="${x(i)}" cy="${y(v)}" r="14" fill="transparent" data-day="${labels[i]}" data-value="${v}" data-color="${v >= baseline ? green : red}" />`
  ).join("");

  const uid = "chart" + Math.random().toString(36).slice(2, 8);

  // Kurve + Flaeche je zweimal (gruen/rot) zeichnen und per clipPath auf den
  // Bereich ueber bzw. unter der Startkapital-Linie beschraenken - so wechselt
  // die Farbe automatisch genau an der Stelle, wo die Kurve die Linie kreuzt.
  return `
  <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <clipPath id="${uid}-above"><rect x="0" y="0" width="${w}" height="${Math.max(baselineY, 0)}" /></clipPath>
      <clipPath id="${uid}-below"><rect x="0" y="${baselineY}" width="${w}" height="${Math.max(h - baselineY, 0)}" /></clipPath>
      <linearGradient id="${uid}-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${green}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${green}" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="${uid}-r" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${red}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${red}" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${gridSvg}
    <g clip-path="url(#${uid}-above)">
      <polygon points="${areaPoints}" fill="url(#${uid}-g)" />
      <polyline points="${points}" fill="none" stroke="${green}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    </g>
    <g clip-path="url(#${uid}-below)">
      <polygon points="${areaPoints}" fill="url(#${uid}-r)" />
      <polyline points="${points}" fill="none" stroke="${red}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    </g>
    <line x1="${padL}" y1="${baselineY}" x2="${w - padR}" y2="${baselineY}" stroke="${text}" stroke-width="1" stroke-dasharray="5 4" opacity="0.7" />
    <text x="${w - padR}" y="${baselineY - 6}" fill="${text}" font-size="11" text-anchor="end">Startkapital</text>
    ${dots}
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="4.5" fill="${last >= baseline ? green : red}" stroke="${text}" stroke-width="1.5" />
    ${xLabelsSvg}
    <circle class="chart-hover-ring" r="7" fill="none" stroke-width="2" opacity="0" />
    ${hitAreas}
  </svg>`;
}

// Sofortiges, gut lesbares Tooltip statt des traegen nativen SVG-<title> -
// wird nach dem Einfuegen des lineChartSvg()-Markups auf den chart-wrap
// aufgerufen (braucht die tatsaechlichen DOM-Positionen der Trefferkreise).
function attachChartTooltip(chartWrap, renderContent) {
  const tooltip = chartWrap.querySelector(".chart-tooltip");
  const ring = chartWrap.querySelector(".chart-hover-ring");
  if (!tooltip) return;
  // Default: Datum + $-Wert (Equity-Kurve). Balkendiagramme der Auswertungen
  // uebergeben einen eigenen Renderer (andere Achsen/Einheiten) statt diese
  // Funktion zu duplizieren.
  renderContent = renderContent || ((hit) => `<div class="chart-tooltip-date">${fmtDate(hit.dataset.day)}</div>`
    + `<div class="chart-tooltip-value">${fmtNum(parseFloat(hit.dataset.value))} $</div>`);

  const position = (e) => {
    const wrapRect = chartWrap.getBoundingClientRect();
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = e.clientX - wrapRect.left + 14;
    let top = e.clientY - wrapRect.top - th - 10;
    if (left + tw > wrapRect.width) left = e.clientX - wrapRect.left - tw - 14;
    if (top < 0) top = e.clientY - wrapRect.top + 14;
    const zoom = currentZoom();
    tooltip.style.left = `${left / zoom}px`;
    tooltip.style.top = `${top / zoom}px`;
  };

  chartWrap.querySelectorAll(".chart-dot-hit").forEach(hit => {
    hit.addEventListener("mouseenter", (e) => {
      tooltip.innerHTML = renderContent(hit);
      tooltip.style.display = "block";
      if (ring) {
        ring.setAttribute("cx", hit.getAttribute("cx"));
        ring.setAttribute("cy", hit.getAttribute("cy"));
        ring.setAttribute("stroke", hit.dataset.color);
        ring.style.opacity = "1";
      }
      position(e);
    });
    hit.addEventListener("mousemove", position);
    hit.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      if (ring) ring.style.opacity = "0";
    });
  });
}

/* ---------- Konten & Sync ---------- */

let cachedPlatforms = null;

async function getPlatforms() {
  if (!cachedPlatforms) cachedPlatforms = await api("/api/platforms");
  return cachedPlatforms;
}

async function openStrategy() {
  state.view = "strategy";
  state.currentDay = null;
  setActiveNav("strategy");
  await mountView("tpl-strategy");
}

async function openBacktesting() {
  state.view = "backtesting";
  state.currentDay = null;
  setActiveNav("backtesting");
  await mountView("tpl-backtesting");
}

/* ---------- Auswertungen ---------- */
/* Modulares Dashboard: jede Kachel (Widget) ist ein Objekt {id, type, title,
   ...typspezifische Felder}. type="breakdown" traegt zusaetzlich dimension +
   metric - eine einzige generische Balkendiagramm-Darstellung bedient damit
   jede Dimension x Kennzahl-Kombination, statt fuer jede Auswertung eine
   eigene Komponente zu bauen. Konfiguration liegt in localStorage, analog zu
   den uebrigen Ansichts-Einstellungen dieser App (Spaltenreihenfolge, Sidebar-
   Reihenfolge, ...) - kein Server-Roundtrip fuer reine Anzeige-Praeferenzen. */

const ANALYTICS_METRICS = [
  { key: "net", field: "total_net", label: "Netto-P&L", unit: "$", signed: true, decimals: 0 },
  { key: "points", field: "total_points", label: "Punkte", unit: "Pkt", signed: true, decimals: 1 },
  { key: "win_rate", field: "win_rate", label: "Trefferquote", unit: "%", signed: false, decimals: 1 },
  { key: "profit_factor", field: "profit_factor", label: "Profit-Faktor", unit: "", signed: false, decimals: 2 },
  { key: "expectancy", field: "expectancy", label: "Ø pro Trade", unit: "$", signed: true, decimals: 1 },
  { key: "trade_count", field: "trade_count", label: "Anzahl Trades", unit: "", signed: false, decimals: 0 },
  { key: "avg_win", field: "avg_win", label: "Ø Gewinn", unit: "$", signed: false, decimals: 1 },
  { key: "avg_loss", field: "avg_loss", label: "Ø Verlust", unit: "$", signed: false, decimals: 1 },
];

const ANALYTICS_DEFAULT_WIDGETS = [
  { id: "kpi-1", type: "kpi", title: "Kern-Kennzahlen" },
  { id: "equity-1", type: "equity", title: "Equity-Kurve & Drawdown" },
  { id: "streaks-1", type: "streaks", title: "Serien & Konsistenz" },
  { id: "bd-weekday", type: "breakdown", title: "Netto-P&L nach Wochentag", dimension: "weekday", metric: "net" },
  { id: "bd-hour", type: "breakdown", title: "Netto-P&L nach Uhrzeit (Entry)", dimension: "hour", metric: "net" },
  { id: "bd-instrument", type: "breakdown", title: "Performance nach Instrument", dimension: "instrument", metric: "net" },
  { id: "bd-direction", type: "breakdown", title: "Trefferquote: Long vs. Short", dimension: "direction", metric: "win_rate" },
  { id: "bd-duration", type: "breakdown", title: "Performance nach Haltedauer", dimension: "duration", metric: "net" },
  { id: "dist-1", type: "distribution", title: "P&L-Verteilung" },
  { id: "bd-rating", type: "breakdown", title: "Netto-P&L nach Tagesbewertung", dimension: "rating", metric: "net" },
  { id: "bd-plan", type: "breakdown", title: "Trefferquote: Plan befolgt?", dimension: "followed_plan", metric: "win_rate" },
  { id: "bd-account", type: "breakdown", title: "Performance nach Konto", dimension: "account", metric: "net" },
];

let analyticsWidgets = [];

function loadAnalyticsWidgets() {
  try {
    const saved = JSON.parse(localStorage.getItem("analyticsWidgets") || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) { /* ignore */ }
  return ANALYTICS_DEFAULT_WIDGETS.map(w => ({ ...w }));
}
function saveAnalyticsWidgets() {
  localStorage.setItem("analyticsWidgets", JSON.stringify(analyticsWidgets));
}

function loadAnalyticsRangeState() {
  try {
    const saved = JSON.parse(localStorage.getItem("analyticsRange") || "null");
    state.analyticsRange = saved && typeof saved === "object" ? saved : { start: null, end: null };
  } catch (e) {
    state.analyticsRange = { start: null, end: null };
  }
}
function saveAnalyticsRangeState() {
  localStorage.setItem("analyticsRange", JSON.stringify(state.analyticsRange));
}
function analyticsRangeQS() {
  const { start, end } = state.analyticsRange || {};
  const parts = [];
  if (start) parts.push(`start=${encodeURIComponent(start)}`);
  if (end) parts.push(`end=${encodeURIComponent(end)}`);
  return parts.join("&");
}
/* Wie withFilter(), zusaetzlich mit dem Zeitraum der Auswertungsseite -
   eigene Funktion statt withFilter() selbst zu erweitern, weil der Zeitraum
   nur hier existiert (Uebersicht/Trades/Journal kennen keinen Datumsfilter). */
function withAnalyticsFilter(url) {
  const parts = [accountsQS(), tagsQS(), analyticsRangeQS()].filter(Boolean);
  if (!parts.length) return url;
  return url + (url.includes("?") ? "&" : "?") + parts.join("&");
}

let cachedAnalyticsDimensions = null;
async function getAnalyticsDimensions() {
  if (!cachedAnalyticsDimensions) cachedAnalyticsDimensions = await api("/api/analytics/dimensions");
  return cachedAnalyticsDimensions;
}

function shortenLabel(label, max = 13) {
  const s = String(label);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* Generisches Balkendiagramm - bedient sowohl breakdown-Widgets (rows aus
   /api/analytics/breakdown) als auch die P&L-Verteilung (rows synthetisch aus
   den Histogramm-Bins gebaut), damit fuer Letztere kein zweiter Chart-Baustein
   noetig ist. metric.field zeigt auf das Feld in jeder row, das die Balkenhoehe
   liefert; null-Werte (z.B. Profit-Faktor ohne Verlusttrade) werden als "∞"
   beschriftet statt als 0 fehlinterpretiert. */
function barChartSvg(rows, metric, w = 1000, h = 260) {
  const padL = 54, padR = 16, padT = 20, padB = 46;
  const values = rows.map(r => { const v = r[metric.field]; return v == null ? 0 : v; });
  const rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values);
  const range = (rawMax - rawMin) || 1;
  const y = v => padT + (h - padT - padB) * (1 - (v - rawMin) / range);
  const zeroY = y(0);
  const n = rows.length;
  const bandW = (w - padL - padR) / n;
  const barW = Math.min(58, bandW * 0.62);

  const cs = getComputedStyle(document.documentElement);
  const green = cs.getPropertyValue("--green").trim();
  const red = cs.getPropertyValue("--red").trim();
  const accent = cs.getPropertyValue("--accent").trim();
  const border = cs.getPropertyValue("--border").trim();
  const faint = cs.getPropertyValue("--text-faint").trim();
  const text = cs.getPropertyValue("--text").trim();

  const GRID_LINES = 4;
  let gridSvg = "";
  for (let i = 0; i <= GRID_LINES; i++) {
    const v = rawMin + (range * i / GRID_LINES);
    const gy = y(v);
    gridSvg += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="${border}" stroke-width="1" opacity="0.5" />`;
    gridSvg += `<text x="${padL - 8}" y="${gy + 3}" fill="${faint}" font-size="10" text-anchor="end">${fmtNum(v, 0)}</text>`;
  }

  // Wieviele x-Achsen-Beschriftungen unten Platz haben, bevor sie sich
  // ueberlappen - wie die Datums-Labels in lineChartSvg() nur eine Auswahl
  // zeigen statt jede Kategorie, wenn es viele sind (z.B. 24 Stunden) oder
  // die Kategorienamen selbst lang sind (z.B. Instrument-Ticker). Richtet
  // sich nach der tatsaechlichen Durchschnittslaenge der Labels, nicht nach
  // einer festen Breite - sonst ueberlappen sich lange Namen trotzdem.
  const avgLabelLen = rows.reduce((sum, r) => sum + shortenLabel(r.label).length, 0) / n || 6;
  const labelPxNeeded = Math.max(34, avgLabelLen * 6.2 + 8);
  const maxAxisLabels = Math.max(1, Math.floor((w - padL - padR) / labelPxNeeded));
  const axisLabelStep = Math.max(1, Math.ceil(n / maxAxisLabels));

  let barsSvg = "", labelsSvg = "", hitSvg = "";
  rows.forEach((r, i) => {
    const raw = r[metric.field];
    const v = values[i];
    const cx = padL + bandW * i + bandW / 2;
    const barTop = y(Math.max(v, 0));
    const barBottom = y(Math.min(v, 0));
    const barH = Math.max(1.5, barBottom - barTop);
    const color = metric.signed ? (v >= 0 ? green : red) : accent;
    const valueLabel = raw == null ? "∞" : `${fmtNum(v, metric.decimals ?? 0)}${metric.unit ? " " + metric.unit : ""}`;
    const labelY = v >= 0 ? barTop - 6 : barBottom + 14;
    barsSvg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}" opacity="0.85" />`;
    // Wertelabel nur zeichnen, wenn es grob in die eigene Bandbreite passt -
    // sonst ueberlappen sich Nachbarlabels bei vielen/schmalen Balken (z.B.
    // 24 Stunden) und werden unleserlich. Der exakte Wert bleibt per Tooltip
    // abrufbar, auch wenn das Label hier ausgelassen wird.
    const estWidth = valueLabel.length * 6.3;
    if (estWidth <= bandW - 2) {
      barsSvg += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${text}" font-size="11" font-weight="600" text-anchor="middle">${valueLabel}</text>`;
    }
    if (i % axisLabelStep === 0) {
      labelsSvg += `<text x="${cx.toFixed(1)}" y="${h - padB + 18}" fill="${faint}" font-size="10" text-anchor="middle">${escapeHtml(shortenLabel(r.label))}</text>`;
    }
    hitSvg += `<rect class="chart-dot-hit" x="${(cx - bandW / 2).toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${h - padT - padB}" fill="transparent" data-day="${escapeHtml(r.label)}" data-value="${raw == null ? "" : v}" data-count="${r.trade_count}" />`;
  });

  // Kein preserveAspectRatio="none" mehr: w/h kommen jetzt von mountBarChart()
  // in echten Pixelmassen der Kachel, die viewBox entspricht also bereits der
  // tatsaechlichen Seitenverhaeltnis - eine nicht-uniforme Streckung (und
  // damit verzerrter, schwer lesbarer Text) faellt dadurch weg.
  return `<svg viewBox="0 0 ${w} ${h}">
    ${gridSvg}
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${w - padR}" y2="${zeroY.toFixed(1)}" stroke="${text}" stroke-width="1" opacity="0.5" />
    ${barsSvg}
    ${labelsSvg}
    ${hitSvg}
  </svg>`;
}

/* Zeichnet das Balkendiagramm in einen bereits im DOM haengenden, leeren
   .chart-wrap - braucht ein eingehaengtes Element zum Ausmessen (nicht nur
   einen HTML-String), damit die viewBox exakt der gerenderten Kachelgroesse
   entspricht statt einer festen 1000x260-Einheit, die je nach Kachelbreite
   unterschiedlich stark nicht-uniform gestreckt wuerde. */
function mountBarChart(wrap, rows, metric, tooltipRenderer) {
  const w = Math.max(220, Math.round(wrap.clientWidth) || 1000);
  const h = Math.max(120, Math.round(wrap.clientHeight) || 260);
  wrap.innerHTML = barChartSvg(rows, metric, w, h) + `<div class="chart-tooltip"></div>`;
  attachChartTooltip(wrap, tooltipRenderer);
}

function barTooltipRenderer(metric) {
  return (hit) => {
    const raw = hit.dataset.value;
    const valueText = raw === "" ? "∞" : `${fmtNum(parseFloat(raw), metric.decimals ?? 2)}${metric.unit ? " " + metric.unit : ""}`;
    return `<div class="chart-tooltip-date">${escapeHtml(hit.dataset.day)}</div>`
      + `<div class="chart-tooltip-value">${valueText}</div>`
      + `<div class="chart-tooltip-date">${hit.dataset.count} Trade${hit.dataset.count === "1" ? "" : "s"}</div>`;
  };
}

async function renderKpiWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/summary"));
  if (!data.trade_count) {
    body.innerHTML = `<div class="empty-state">Keine Trades im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  body.innerHTML = tile("Netto-P&L", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Trefferquote", fmtNum(data.win_rate, 1) + " %")
    + tile("Profit-Faktor", data.profit_factor === null ? "∞" : fmtNum(data.profit_factor, 2))
    + tile("Ø pro Trade", fmtSigned(data.expectancy, 1) + " $", cls(data.expectancy))
    + tile("Anzahl Trades", data.trade_count)
    + tile("Ø Gewinn", fmtNum(data.avg_win, 1) + " $", "pos")
    + tile("Ø Verlust", fmtNum(Math.abs(data.avg_loss), 1) + " $", "neg")
    + tile("Ø Haltedauer", fmtDuration(data.avg_duration_sec))
    + tile("Bester Trade", fmtSigned(data.best_trade) + " $", "pos")
    + tile("Schwächster Trade", fmtSigned(data.worst_trade) + " $", "neg");
}

async function renderEquityWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/equity"));
  if (data.trading_days < 2) {
    body.innerHTML = `<div class="empty-state">Mindestens 2 Handelstage im gewählten Zeitraum/Filter nötig.</div>`;
    return;
  }
  const values = data.curve.map(p => p.cum_net);
  const labels = data.curve.map(p => p.day);
  body.innerHTML = `<div class="analytics-equity-meta">
      <span>Max. Drawdown: <strong class="neg">${fmtNum(data.max_drawdown)} $</strong>${data.max_drawdown_day ? ` (${fmtDate(data.max_drawdown_day)})` : ""}</span>
      <span>Gewinn-/Verlusttage: <strong class="pos">${data.win_days}</strong> / <strong class="neg">${data.loss_days}</strong> (${fmtNum(data.win_days_pct, 1)} %)</span>
    </div>
    <div class="chart-wrap analytics-equity-chart">${lineChartSvg(values, labels, data.start_balance)}<div class="chart-tooltip"></div></div>`;
  attachChartTooltip(body.querySelector(".analytics-equity-chart"));
}

async function renderStreaksWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/equity"));
  if (!data.trading_days) {
    body.innerHTML = `<div class="empty-state">Keine Handelstage im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  const curLabel = data.current_streak_type === "win" ? "Gewinn-Serie" : data.current_streak_type === "loss" ? "Verlust-Serie" : "–";
  const curClass = data.current_streak_type === "win" ? "pos" : data.current_streak_type === "loss" ? "neg" : "";
  body.innerHTML = tile("Aktuelle Serie", data.current_streak ? `${data.current_streak} Tage` : "–", curClass)
    + tile("Serientyp", curLabel, curClass)
    + tile("Längste Gewinn-Serie", data.longest_win_streak + " Tage", "pos")
    + tile("Längste Verlust-Serie", data.longest_loss_streak + " Tage", "neg")
    + tile("Profitable Handelstage", `${fmtNum(data.win_days_pct, 1)} %`, cls(data.win_days_pct - 50))
    + tile("Handelstage gesamt", data.trading_days);
}

async function renderDistributionWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/distribution?bins=10"));
  if (!data.trade_count) {
    body.innerHTML = `<div class="empty-state">Keine Trades im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  const rows = data.bins.map(b => ({ label: b.label, total_net: b.count, trade_count: b.count }));
  const metric = { field: "total_net", unit: "", decimals: 0, signed: false };
  body.innerHTML = `<div class="analytics-equity-meta">
      <span>Ø Gewinn: <strong class="pos">${fmtNum(data.avg_win)} $</strong></span>
      <span>Ø Verlust: <strong class="neg">${fmtNum(data.avg_loss)} $</strong></span>
      <span>Größter Gewinn: <strong class="pos">${fmtNum(data.largest_win)} $</strong></span>
      <span>Größter Verlust: <strong class="neg">${fmtNum(data.largest_loss)} $</strong></span>
    </div>
    <div class="chart-wrap analytics-bar-chart"></div>`;
  mountBarChart(body.querySelector(".analytics-bar-chart"), rows, metric, (hit) =>
    `<div class="chart-tooltip-date">${escapeHtml(hit.dataset.day)} $</div><div class="chart-tooltip-value">${hit.dataset.count} Trades</div>`);
}

async function renderBreakdownWidget(body, widget) {
  const metric = ANALYTICS_METRICS.find(m => m.key === widget.metric) || ANALYTICS_METRICS[0];
  const data = await api(withAnalyticsFilter(`/api/analytics/breakdown?dimension=${encodeURIComponent(widget.dimension)}`));
  const rows = data.rows.filter(r => r.trade_count > 0);
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state">Keine Daten für diese Auswertung im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  body.innerHTML = `<div class="chart-wrap analytics-bar-chart"></div>`;
  mountBarChart(body.querySelector(".analytics-bar-chart"), rows, metric, barTooltipRenderer(metric));
}

function analyticsWidgetRenderer(widget) {
  if (widget.type === "kpi") return renderKpiWidget;
  if (widget.type === "equity") return renderEquityWidget;
  if (widget.type === "streaks") return renderStreaksWidget;
  if (widget.type === "distribution") return renderDistributionWidget;
  if (widget.type === "breakdown") return (body) => renderBreakdownWidget(body, widget);
  return async (body) => { body.innerHTML = `<div class="empty-state">Unbekannter Auswertungstyp.</div>`; };
}

const ANALYTICS_WIDE_TYPES = new Set(["equity", "distribution"]);

function analyticsWidgetCardHtml(widget) {
  const wideClass = ANALYTICS_WIDE_TYPES.has(widget.type) ? " analytics-widget-wide" : "";
  const bodyClass = (widget.type === "kpi" || widget.type === "streaks") ? " stat-grid" : "";
  return `
    <div class="card analytics-widget${wideClass}" data-widget-id="${widget.id}" draggable="true">
      <div class="analytics-widget-header">
        <div class="analytics-widget-header-left">
          <span class="analytics-widget-handle" title="Ziehen zum Umsortieren">⠿</span>
          <div class="analytics-widget-title">${escapeHtml(widget.title)}</div>
        </div>
        <div class="analytics-widget-actions">
          <button type="button" class="analytics-widget-edit" title="Bearbeiten" aria-label="Auswertung bearbeiten">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="analytics-widget-remove" title="Entfernen" aria-label="Auswertung entfernen">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="analytics-widget-body${bodyClass}"><div class="empty-state">Lädt…</div></div>
    </div>`;
}

async function renderAnalyticsWidget(widget) {
  const card = document.querySelector(`.analytics-widget[data-widget-id="${widget.id}"]`);
  if (!card) return;
  const body = card.querySelector(".analytics-widget-body");
  try {
    await analyticsWidgetRenderer(widget)(body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderAllAnalyticsWidgets() {
  await Promise.all(analyticsWidgets.map(w => renderAnalyticsWidget(w)));
}

function mountAnalyticsGrid() {
  const grid = document.getElementById("analytics-grid");
  if (!grid) return;
  grid.innerHTML = analyticsWidgets.length
    ? analyticsWidgets.map(analyticsWidgetCardHtml).join("")
    : `<div class="empty-state">Noch keine Auswertungen. Klicke auf „+ Auswertung", um deine erste hinzuzufügen.</div>`;
  grid.querySelectorAll(".analytics-widget").forEach(card => {
    const widget = analyticsWidgets.find(w => w.id === card.dataset.widgetId);
    if (!widget) return;
    card.querySelector(".analytics-widget-edit").addEventListener("click", () => openAnalyticsWidgetEditor(widget));
    card.querySelector(".analytics-widget-remove").addEventListener("click", () => removeAnalyticsWidget(widget.id));
    wireAnalyticsWidgetDrag(card);
  });
}

/* Kacheln per Drag & Drop umsortieren - anders als die einspaltigen Listen
   (Sidebar, Notizbuch-Baum) ist das Auswertungs-Grid zweispaltig, deshalb
   entscheidet die Zielposition ueber Y (oberhalb/unterhalb der Karte) UND X
   (linke/rechte Haelfte), nicht nur Y. Reihenfolge wird erst bei dragend aus
   dem tatsaechlichen DOM gelesen und gespeichert - waehrend des Ziehens
   bewegt sich das Element bereits live mit (wie bei .nav-item). */
let analyticsDragEl = null;

function analyticsCardGoesBefore(e, rect) {
  if (e.clientY < rect.top) return true;
  if (e.clientY > rect.bottom) return false;
  return e.clientX < rect.left + rect.width / 2;
}

function wireAnalyticsWidgetDrag(card) {
  card.addEventListener("dragstart", (e) => {
    analyticsDragEl = card;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.widgetId);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    analyticsDragEl = null;
    const ids = [...document.querySelectorAll("#analytics-grid .analytics-widget")].map(c => c.dataset.widgetId);
    analyticsWidgets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    saveAnalyticsWidgets();
  });
  card.addEventListener("dragover", (e) => {
    if (!analyticsDragEl || analyticsDragEl === card) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const before = analyticsCardGoesBefore(e, card.getBoundingClientRect());
    card.parentElement.insertBefore(analyticsDragEl, before ? card : card.nextSibling);
  });
}

function removeAnalyticsWidget(id) {
  analyticsWidgets = analyticsWidgets.filter(w => w.id !== id);
  saveAnalyticsWidgets();
  mountAnalyticsGrid();
  renderAllAnalyticsWidgets();
}

/* Hinzufuegen/Bearbeiten im bestehenden Modal (gleiche Ueberlagerung wie
   Tages-/Journal-Modal) statt einer eigenen Dialog-Komponente. */
async function openAnalyticsWidgetEditor(existingWidget) {
  const dims = await getAnalyticsDimensions();
  const isEdit = !!existingWidget;
  const w = existingWidget || { type: "breakdown", dimension: dims[0]?.key, metric: "net", title: "" };

  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <section class="view">
      <header class="view-header"><h1>${isEdit ? "Auswertung bearbeiten" : "Auswertung hinzufügen"}</h1></header>
      <form class="account-form" id="widget-form">
        <input type="text" name="title" placeholder="Titel" value="${escapeHtml(w.title || "")}" required>
        <label class="widget-form-label">Typ
          <select name="type">
            <option value="kpi">Kern-Kennzahlen</option>
            <option value="equity">Equity-Kurve &amp; Drawdown</option>
            <option value="streaks">Serien &amp; Konsistenz</option>
            <option value="breakdown">Balkendiagramm nach Kategorie</option>
            <option value="distribution">P&amp;L-Verteilung</option>
          </select>
        </label>
        <label class="widget-form-label" id="widget-dim-row">Gruppieren nach
          <select name="dimension">${dims.map(d => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join("")}</select>
        </label>
        <label class="widget-form-label" id="widget-metric-row">Kennzahl
          <select name="metric">${ANALYTICS_METRICS.map(m => `<option value="${m.key}">${escapeHtml(m.label)}</option>`).join("")}</select>
        </label>
        <button type="submit" class="btn btn-primary">${isEdit ? "Speichern" : "Hinzufügen"}</button>
      </form>
    </section>`;
  overlay.classList.add("visible");

  const form = document.getElementById("widget-form");
  form.type.value = w.type;
  form.dimension.value = w.dimension || dims[0]?.key;
  form.metric.value = w.metric || "net";

  const dimRow = document.getElementById("widget-dim-row");
  const metricRow = document.getElementById("widget-metric-row");
  const updateVisibility = () => {
    const show = form.type.value === "breakdown";
    dimRow.style.display = show ? "" : "none";
    metricRow.style.display = show ? "" : "none";
  };
  form.type.addEventListener("change", updateVisibility);
  updateVisibility();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    const type = form.type.value;
    const newWidget = {
      id: existingWidget ? existingWidget.id : "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type, title,
    };
    if (type === "breakdown") {
      newWidget.dimension = form.dimension.value;
      newWidget.metric = form.metric.value;
    }
    if (isEdit) {
      const idx = analyticsWidgets.findIndex(x => x.id === existingWidget.id);
      analyticsWidgets[idx] = newWidget;
    } else {
      analyticsWidgets.push(newWidget);
    }
    saveAnalyticsWidgets();
    closeModal();
    mountAnalyticsGrid();
    renderAllAnalyticsWidgets();
  });
}

function onAnalyticsRangeChange() {
  state.analyticsRange = {
    start: document.getElementById("an-range-start").value || null,
    end: document.getElementById("an-range-end").value || null,
  };
  saveAnalyticsRangeState();
  renderAllAnalyticsWidgets();
}

async function openAnalytics() {
  state.view = "analytics";
  state.currentDay = null;
  setActiveNav("analytics");

  await mountView("tpl-analytics");
  loadAnalyticsRangeState();

  const accToggle = document.getElementById("an-account-filter-toggle");
  const accPanel = document.getElementById("an-account-filter-panel");
  accToggle.addEventListener("click", (e) => { e.stopPropagation(); accPanel.hidden = !accPanel.hidden; });
  await renderAccountFilter("an-account-filter-panel", "an-account-filter-count");

  const tagToggle = document.getElementById("an-tag-filter-toggle");
  const tagPanel = document.getElementById("an-tag-filter-panel");
  tagToggle.addEventListener("click", (e) => { e.stopPropagation(); tagPanel.hidden = !tagPanel.hidden; });
  await renderTagFilter("an-tag-filter-list", "an-tag-logic-toggle");

  document.getElementById("an-range-start").value = state.analyticsRange.start || "";
  document.getElementById("an-range-end").value = state.analyticsRange.end || "";
  document.getElementById("an-range-start").addEventListener("change", onAnalyticsRangeChange);
  document.getElementById("an-range-end").addEventListener("change", onAnalyticsRangeChange);
  document.getElementById("an-range-clear").addEventListener("click", () => {
    state.analyticsRange = { start: null, end: null };
    saveAnalyticsRangeState();
    document.getElementById("an-range-start").value = "";
    document.getElementById("an-range-end").value = "";
    renderAllAnalyticsWidgets();
  });

  document.getElementById("an-add-widget-btn").addEventListener("click", () => openAnalyticsWidgetEditor(null));

  analyticsWidgets = loadAnalyticsWidgets();
  mountAnalyticsGrid();
  await renderAllAnalyticsWidgets();
}

async function openAccounts() {
  state.view = "accounts";
  state.currentDay = null;
  setActiveNav("accounts");

  const content = await mountView("tpl-accounts");

  const platforms = await getPlatforms();
  const platformSelect = document.getElementById("account-platform-select");
  platformSelect.innerHTML = platforms.map(p => `<option value="${p.key}">${p.name}</option>`).join("");

  const credentialFields = [
    document.getElementById("account-login"),
    document.getElementById("account-password"),
    document.getElementById("account-server"),
  ];
  const hint = document.getElementById("account-hint");
  const updateFormForPlatform = () => {
    const platform = platforms.find(p => p.key === platformSelect.value);
    const manual = platform && platform.manual;
    credentialFields.forEach(f => { f.hidden = manual; f.required = !manual; });
    hint.textContent = manual
      ? "Dieses Konto hat keine automatische Sync-Anbindung. Trades ordnest du ihm weiter unten beim CSV-Import zu (Dropdown über \"Datei wählen\")."
      : "Nutze ausschließlich das Investor-/Read-Only-Passwort. Zugangsdaten werden nur lokal in deiner SQLite-Datenbank gespeichert und nie an Dritte übertragen.";
  };
  platformSelect.addEventListener("change", updateFormForPlatform);
  updateFormForPlatform();

  const form = document.getElementById("account-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.starting_balance = parseFloat(payload.starting_balance) || 0;
    try {
      await api("/api/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      form.reset();
      updateFormForPlatform();
      await renderAccounts();
      await renderAccountFilter();
      await renderImportAccountSelect();
    } catch (err) {
      alert(err.message);
    }
  });

  await renderAccounts();
  await renderImportAccountSelect();

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("csv-input").click();
  });

  document.getElementById("csv-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const accountId = document.getElementById("import-account-select").value;
    const statusEl = document.getElementById("import-status");
    statusEl.className = "import-status";
    statusEl.textContent = "Importiere…";
    const form = new FormData();
    form.append("file", file);
    if (accountId) form.append("account_id", accountId);
    try {
      const res = await api("/api/import", { method: "POST", body: form });
      statusEl.className = "import-status ok";
      statusEl.textContent = `${res.inserted} von ${res.parsed} Trades importiert.`;
      await renderAccountFilter();
      if (res.days && res.days.length) openDay(res.days[res.days.length - 1]);
    } catch (err) {
      statusEl.className = "import-status err";
      statusEl.textContent = err.message;
    }
    e.target.value = "";
  });
}

async function renderAccounts() {
  const [accounts, platforms] = await Promise.all([api("/api/accounts"), getPlatforms()]);
  const list = document.getElementById("account-list");
  if (!accounts.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Konten verbunden.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const acc of accounts) {
    const platformInfo = platforms.find(p => p.key === acc.platform);
    const isManual = platformInfo ? platformInfo.manual : true;
    const platformName = platformInfo ? platformInfo.name : acc.platform;

    const row = document.createElement("div");
    row.className = "account-row";
    const lastSync = acc.last_sync ? fmtDateTime(acc.last_sync) : "noch nie";
    row.innerHTML = `
      <div class="account-info">
        <div class="account-name-row">
          <div class="account-name">${escapeHtml(acc.name)}</div>
          <button type="button" class="account-name-edit-btn" title="Konto umbenennen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
        <form class="account-name-edit-form" hidden>
          <input type="text" class="acc-name-input" value="${escapeHtml(acc.name)}" required>
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary acc-name-cancel">Abbrechen</button>
        </form>
        <div class="account-meta">${platformName}${isManual ? "" : ` · Login ${acc.login} · Server ${acc.server}`}</div>
        <div class="account-meta">${isManual ? "Zuordnung per CSV-Import" : `Letzter Sync: ${lastSync}`}</div>
        ${acc.synced_balance !== null
          ? `<div class="account-meta">Kontostand (aus Sync): ${fmtNum(acc.synced_balance)} $</div>`
          : `<div class="account-meta account-balance-edit">
               Startkapital: <input type="number" step="0.01" class="acc-starting-balance" value="${acc.starting_balance || 0}">
               <button type="button" class="btn btn-secondary acc-balance-save">Speichern</button>
             </div>`}
      </div>
      <div class="account-actions">
        ${isManual
          ? `<button class="btn btn-secondary acc-reassign">Bisherige nicht zugeordnete Trades zuweisen</button>`
          : `<button class="btn btn-secondary acc-sync">Jetzt synchronisieren</button>
             <button class="btn btn-secondary acc-sync-full">Vollständig neu synchronisieren</button>`}
        <button class="btn btn-secondary acc-delete">Entfernen</button>
      </div>
      <div class="account-status"></div>
    `;
    const statusEl = row.querySelector(".account-status");

    const nameRow = row.querySelector(".account-name-row");
    const nameForm = row.querySelector(".account-name-edit-form");
    const nameInput = row.querySelector(".acc-name-input");
    row.querySelector(".account-name-edit-btn").addEventListener("click", () => {
      nameRow.hidden = true;
      nameForm.hidden = false;
      nameInput.focus();
      nameInput.select();
    });
    row.querySelector(".acc-name-cancel").addEventListener("click", () => {
      nameInput.value = acc.name;
      nameForm.hidden = true;
      nameRow.hidden = false;
    });
    nameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = nameInput.value.trim();
      if (!newName || newName === acc.name) {
        nameForm.hidden = true;
        nameRow.hidden = false;
        return;
      }
      try {
        await api(`/api/accounts/${acc.id}/name`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        acc.name = newName;
        row.querySelector(".account-name").textContent = newName;
        nameForm.hidden = true;
        nameRow.hidden = false;
        statusEl.className = "account-status ok";
        statusEl.textContent = "Konto umbenannt.";
        await renderAccountFilter();
        await renderImportAccountSelect();
        if (state.view === "overview" || state.view === "trades") refreshCurrentView();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    });

    const balanceSaveBtn = row.querySelector(".acc-balance-save");
    if (balanceSaveBtn) balanceSaveBtn.addEventListener("click", async () => {
      const input = row.querySelector(".acc-starting-balance");
      const value = parseFloat(input.value) || 0;
      try {
        await api(`/api/accounts/${acc.id}/starting-balance`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starting_balance: value }),
        });
        statusEl.className = "account-status ok";
        statusEl.textContent = "Startkapital gespeichert.";
        if (state.view === "overview") refreshCurrentView();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    });

    async function runSync(full) {
      statusEl.textContent = full ? "Synchronisiere vollstaendig (kann etwas dauern)…" : "Synchronisiere…";
      statusEl.className = "account-status";
      try {
        const res = await api(`/api/accounts/${acc.id}/sync${full ? "?full=true" : ""}`, { method: "POST" });
        statusEl.className = "account-status ok";
        statusEl.textContent = `${res.inserted} neue Trades importiert (${res.parsed} gefunden).`;
        await renderAccountFilter();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    }

    const syncBtn = row.querySelector(".acc-sync");
    if (syncBtn) syncBtn.addEventListener("click", () => runSync(false));

    const syncFullBtn = row.querySelector(".acc-sync-full");
    if (syncFullBtn) {
      syncFullBtn.addEventListener("click", () => {
        if (!confirm("Die letzten 365 Tage komplett neu von MetaTrader abfragen? Geloeschte Trades aus diesem Zeitraum werden dabei wieder importiert.")) return;
        runSync(true);
      });
    }

    const reassignBtn = row.querySelector(".acc-reassign");
    if (reassignBtn) {
      reassignBtn.addEventListener("click", async () => {
        if (!confirm(`Alle bisher nicht zugeordneten "${platformName}"-Trades dem Konto "${acc.name}" zuweisen?`)) return;
        statusEl.textContent = "Ordne zu…";
        statusEl.className = "account-status";
        try {
          const res = await api("/api/trades/reassign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acc.id, source: acc.platform }),
          });
          statusEl.className = "account-status ok";
          statusEl.textContent = `${res.updated} Trade(s) zugeordnet.`;
          await renderAccountFilter();
        } catch (err) {
          statusEl.className = "account-status err";
          statusEl.textContent = err.message;
        }
      });
    }

    row.querySelector(".acc-delete").addEventListener("click", () => deleteAccountFlow(acc.id, acc.name));

    list.appendChild(row);
  }
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE");
}

/* ---------- Import ---------- */

/* Existiert nur, waehrend die Konten-Seite gemountet ist (Karte "CSV
   importieren") - wird aber auch von der Konto-Loeschung in den
   Einstellungen aus aufgerufen, deshalb hier bewusst ein No-Op statt
   Crash, wenn das Element gerade nicht im DOM ist. */
async function renderImportAccountSelect() {
  const select = document.getElementById("import-account-select");
  if (!select) return;
  const current = select.value;
  const accounts = await api("/api/accounts");
  select.innerHTML = '<option value="">Kein Konto (freier Import)</option>'
    + accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  if (accounts.some(a => String(a.id) === current)) select.value = current;
}
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
  const saved = JSON.parse(localStorage.getItem("navOrder") || "null");
  if (!Array.isArray(saved)) return;
  const order = saved.filter(v => knownViews.includes(v));
  for (const v of knownViews) if (!order.includes(v)) order.push(v);
  for (const view of order) {
    const el = items.find(e => e.dataset.view === view);
    if (el) nav.appendChild(el);
  }
}
function saveNavOrder() {
  const order = [...document.querySelectorAll(".nav-item")].map(el => el.dataset.view);
  localStorage.setItem("navOrder", JSON.stringify(order));
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
  el.addEventListener("dragstart", () => el.classList.add("dragging"));
  el.addEventListener("dragend", () => { el.classList.remove("dragging"); saveNavOrder(); });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    const nav = document.querySelector(".nav");
    const dragging = nav.querySelector(".dragging");
    if (!dragging || dragging === el) return;
    const rect = el.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    nav.insertBefore(dragging, before ? el : el.nextSibling);
  });
});

/* Globaler Konten-Status-Klick fuehrt zur Uebersicht, wo der Filter sitzt -
   Tastatur-Aktivierung analog zu .nav-item (ebenfalls ein div[role=button]). */
const sidebarAccountStatusEl = document.getElementById("sidebar-account-status");
sidebarAccountStatusEl.addEventListener("click", () => { if (state.view !== "overview") openOverview(); });
sidebarAccountStatusEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  sidebarAccountStatusEl.click();
});

loadFilterState();
loadTagFilterState();
loadNotebookExpandedState();
renderSidebarAccountStatus();
openOverview();

/* ---------- Newsbar (ForexFactory-Wirtschaftskalender) ---------- */

const NEWS_IMPACT_LEVELS = [
  { key: "High", label: "High Impact" },
  { key: "Medium", label: "Medium Impact" },
  { key: "Low", label: "Low Impact" },
  { key: "Holiday", label: "Non-Economic / Holiday" },
];
const NEWS_CURRENCIES = ["AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "JPY", "NZD", "USD"];
const NEWS_EVENT_TYPES = ["Growth", "Housing", "Inflation", "Consumer Surveys", "Employment", "Business Surveys", "Central Bank", "Speeches", "Bonds", "Misc"];

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

function impactColorVar(impact) {
  const cs = getComputedStyle(document.documentElement);
  const map = { High: "--impact-high", Medium: "--impact-medium", Low: "--impact-low" };
  return cs.getPropertyValue(map[impact] || "--impact-none").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderNewsFilters() {
  const impactWrap = document.getElementById("newsbar-filter-impact");
  impactWrap.innerHTML = NEWS_IMPACT_LEVELS.map(lvl => `
    <button type="button" class="newsbar-chip${newsFilterState.impact.has(lvl.key) ? " active" : ""}" data-group="impact" data-key="${lvl.key}" title="${lvl.label}">
      <span class="newsbar-chip-dot" style="background:${impactColorVar(lvl.key)}"></span>${lvl.key}
    </button>
  `).join("");

  const typeWrap = document.getElementById("newsbar-filter-types");
  typeWrap.innerHTML = NEWS_EVENT_TYPES.map(t => `
    <button type="button" class="newsbar-chip${newsFilterState.type.has(t) ? " active" : ""}" data-group="type" data-key="${t}">${t}</button>
  `).join("");

  const curWrap = document.getElementById("newsbar-filter-currencies");
  curWrap.innerHTML = NEWS_CURRENCIES.map(c => `
    <button type="button" class="newsbar-chip${newsFilterState.currency.has(c) ? " active" : ""}" data-group="currency" data-key="${c}">${c}</button>
  `).join("");

  const ftmoWrap = document.getElementById("newsbar-filter-ftmo");
  ftmoWrap.innerHTML = `
    <button type="button" class="newsbar-chip${newsFilterState.ftmo.has("on") ? " active" : ""}" data-group="ftmo" data-key="on" title="FTMO Restricted Events (2 Min. vor/nach kein Trade erlaubt) anzeigen/ausblenden">❗ FTMO News</button>
    <button type="button" class="newsbar-chip${newsFilterState.ftmoHighlight.has("on") ? " active" : ""}" data-group="ftmoHighlight" data-key="on" title="FTMO Restricted Events rot hinterlegen">Rot hervorheben</button>
  `;

  document.querySelectorAll("#newsbar-filter-panel .newsbar-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.group, key = chip.dataset.key;
      if (newsFilterState[group].has(key)) newsFilterState[group].delete(key); else newsFilterState[group].add(key);
      chip.classList.toggle("active");
      saveNewsFilterState();
      renderNewsSections();
    });
  });

  document.querySelectorAll("#newsbar-filter-panel a[data-filter]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const group = a.dataset.filter, mode = a.dataset.mode;
      const source = group === "impact" ? NEWS_IMPACT_LEVELS.map(l => l.key) : group === "currency" ? NEWS_CURRENCIES : NEWS_EVENT_TYPES;
      newsFilterState[group] = new Set(mode === "all" ? source : []);
      saveNewsFilterState();
      renderNewsFilters();
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

function renderNewsSections() {
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

  const filtered = newsEvents.filter(e =>
    newsFilterState.impact.has(e.impact) && newsFilterState.currency.has(e.currency) && newsFilterState.type.has(e.event_type) &&
    (newsFilterState.ftmo.has("on") || !e.ftmo_status)
  );

  const week = [], nextWeek = [], hot = [], history = [];
  for (const e of filtered) {
    const t = new Date(e.time);
    const day0 = startOfDay(t);
    if (day0 >= monday0 && day0 < saturday0) week.push(e);
    else if (day0 >= nextMonday0 && day0 < nextSaturday0) nextWeek.push(e);
    if (day0.getTime() === today0.getTime() && t < now) hot.push(e);
    else if (day0 < monday0) history.push(e);
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
    return ((day0 >= monday0 && day0 < saturday0) || (day0 >= nextMonday0 && day0 < nextSaturday0)) && e.ftmo_status;
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

function initNewsbar() {
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
initNewsbar();
loadTodoWidget();
