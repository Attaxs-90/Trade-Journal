const state = {
  view: "overview", currentDay: null,
  filterMode: "all", filterKeys: [],
  tagFilterMode: "all", tagFilterKeys: [], tagFilterLogic: "or",
  selectedTradeIds: new Set(),
  // Journal hat einen eigenen Tag-Filter: er filtert Journal-Eintraege, nicht
  // Trades, und darf die Auswertungsseiten deshalb nicht mitbeeinflussen.
  journalMode: "all", journalQuery: "", journalTagKeys: [], journalRefKey: null,
  journalSelectedKeys: new Set(),
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

/* ---------- Spalten-Auswahl "Tage im Ueberblick" (Uebersicht) ---------- */

/* Neue Spalte hinzufuegen: hier eintragen (key = data-col-Wert in der
   <th>/<td> im HTML), dann die passende <th data-col="..."> im tpl-overview-
   Template und die <td data-col="..."> beim Bauen der Zeile in openOverview()
   ergaenzen - der Toggle-Mechanismus selbst muss dafuer nicht angefasst werden.
   Neue Spalten sind automatisch sichtbar, siehe loadOverviewColumnsState(). */
const OVERVIEW_COLUMNS = [
  { key: "account", label: "Konto" },
  { key: "volume", label: "Größe" },
  { key: "trades", label: "Trades" },
  { key: "points", label: "Punkte" },
  { key: "net", label: "Netto $" },
  { key: "journal", label: "Journal" },
];

/* Gespeichert werden die AUSGEBLENDETEN Spalten, nicht die sichtbaren: eine
   spaeter dazukommende Spalte ist damit automatisch sichtbar. Wuerden wir die
   sichtbaren merken, bliebe jede neue Spalte fuer alle Bestandsnutzer
   unsichtbar - sie steht ja in keiner alten Auswahl. */
function loadOverviewColumnsState() {
  const visible = new Set(OVERVIEW_COLUMNS.map(c => c.key));
  try {
    const hidden = JSON.parse(localStorage.getItem("overviewHiddenColumns") || "null");
    if (Array.isArray(hidden)) hidden.forEach(key => visible.delete(key));
  } catch (e) { /* ignore */ }
  return visible;
}
function saveOverviewColumnsState(visible) {
  const hidden = OVERVIEW_COLUMNS.map(c => c.key).filter(key => !visible.has(key));
  localStorage.setItem("overviewHiddenColumns", JSON.stringify(hidden));
}

function applyOverviewColumnVisibility(visible) {
  document.querySelectorAll("#ov-days-table [data-col]").forEach(el => {
    const key = el.dataset.col;
    el.hidden = key !== "date" && !visible.has(key);
  });
}

function renderOverviewColumnToggle() {
  const panel = document.getElementById("ov-columns-panel");
  if (!panel) return;
  const visible = loadOverviewColumnsState();
  panel.innerHTML = `<div class="newsbar-chip-row"></div>`;
  const row = panel.querySelector(".newsbar-chip-row");
  for (const col of OVERVIEW_COLUMNS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "newsbar-chip" + (visible.has(col.key) ? " active" : "");
    chip.textContent = col.label;
    chip.addEventListener("click", () => {
      if (visible.has(col.key)) visible.delete(col.key); else visible.add(col.key);
      chip.classList.toggle("active");
      saveOverviewColumnsState(visible);
      applyOverviewColumnVisibility(visible);
    });
    row.appendChild(chip);
  }
  applyOverviewColumnVisibility(visible);
}

async function getAccountOptions() {
  return api("/api/account-options");
}

/* Rendert den Konten-Filter in das Inline-Panel der Uebersicht. Kein-Op, wenn
   das Panel gerade nicht im DOM ist (Uebersicht nicht aktive View). */
async function renderAccountFilter() {
  const panel = document.getElementById("ov-account-filter-panel");
  if (!panel) return;
  const options = await getAccountOptions();
  panel.innerHTML = "";

  const countBadge = document.getElementById("ov-account-filter-count");
  if (countBadge) countBadge.textContent = state.filterMode === "selected" && state.filterKeys.length ? `(${state.filterKeys.length})` : "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox" id="filter-all"> Alle Konten`;
  panel.appendChild(masterLabel);
  const masterInput = masterLabel.querySelector("input");
  masterInput.checked = state.filterMode === "all";
  masterInput.addEventListener("change", () => {
    state.filterMode = "all";
    state.filterKeys = [];
    saveFilterState();
    renderAccountFilter();
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
      renderAccountFilter();
      refreshCurrentView();
    });
    panel.appendChild(label);
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
   Marktnews-Filterchips (.newsbar-chip) statt Checkboxen. */
async function renderTagFilter() {
  const wrap = document.getElementById("trades-tag-filter-list");
  if (!wrap) return;
  const tags = await getTags();
  wrap.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "tag-filter-all-chip" + (state.tagFilterMode === "all" ? " active" : "");
  allBtn.textContent = "Alle Tags";
  allBtn.addEventListener("click", () => {
    state.tagFilterMode = "all";
    state.tagFilterKeys = [];
    saveTagFilterState();
    renderTagFilter();
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
        renderTagFilter();
        refreshCurrentView();
      },
    ));
  }

  document.querySelectorAll("#trades-tag-logic-toggle .tag-logic-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.logic === state.tagFilterLogic);
    btn.onclick = () => {
      state.tagFilterLogic = btn.dataset.logic;
      saveTagFilterState();
      renderTagFilter();
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
}

/* ---------- Theme ---------- */

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const apply = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    btn.textContent = theme === "light" ? "☀️" : "🌙";
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

async function openSettings() {
  state.view = "settings";
  state.currentDay = null;
  setActiveNav("settings");

  const content = await mountView("tpl-settings");
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

/* Tagesaggregat aus db.list_days() - eine Liste {source, total}, weil ein Tag
   Trades aus mehreren Quellen (Lots UND Kontrakte) enthalten kann. */
function fmtVolumeAgg(volumes) {
  if (!volumes || !volumes.length) return "–";
  return volumes.map(v => v.source === "ninjatrader"
    ? `${Math.round(v.total)} Kontrakt${Math.round(v.total) === 1 ? "" : "e"}`
    : `${fmtNum(v.total, 2)} Lot${v.total === 1 ? "" : "s"}`
  ).join(", ");
}

/* ---------- Tag-Chips & Popover (Tagesansicht) ---------- */

/* <optgroup> je tag_group fuer <select>-Elemente (z. B. Mehrfach-Tagging) -
   sonst ist bei vielen Tags nicht erkennbar, welcher Tag zu welcher Gruppe gehoert. */
function groupedTagOptionsHtml(tags) {
  const byGroup = new Map();
  for (const t of tags) {
    const g = t.tag_group || "Ohne Gruppe";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }
  return [...byGroup].map(([group, groupTags]) => `
    <optgroup label="${escapeHtml(group)}">
      ${groupTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
    </optgroup>
  `).join("");
}

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
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${rect.left}px`;
  requestAnimationFrame(() => {
    const pRect = popover.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) popover.style.left = `${Math.max(8, window.innerWidth - pRect.width - 8)}px`;
    if (pRect.bottom > window.innerHeight - 8) popover.style.top = `${Math.max(8, rect.top - pRect.height - 4)}px`;
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
  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById(templateId).content.cloneNode(true));
  return content;
}

async function openOverview() {
  state.view = "overview";
  state.currentDay = null;
  setActiveNav("overview");

  const content = await mountView("tpl-overview");

  const toggleBtn = document.getElementById("ov-account-filter-toggle");
  const panel = document.getElementById("ov-account-filter-panel");
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  await renderAccountFilter();

  const columnsToggleBtn = document.getElementById("ov-columns-toggle");
  const columnsPanel = document.getElementById("ov-columns-panel");
  columnsToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    columnsPanel.hidden = !columnsPanel.hidden;
  });
  renderOverviewColumnToggle();

  const [data, accountOptions] = await Promise.all([api(withFilter("/api/overview")), getAccountOptions()]);
  const accountNames = new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name]));

  const statGrid = document.getElementById("ov-stats");
  statGrid.innerHTML = tile("Startkapital", fmtNum(data.start_balance) + " $")
    + tile("Kontostand", fmtNum(data.current_balance) + " $", cls(data.current_balance - data.start_balance))
    + tile("Netto gesamt", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Trades gesamt", data.total_trades)
    + tile("Handelstage", data.trading_days)
    + tile("Bester Tag", data.best_day ? `${data.best_day.day} (${fmtSigned(data.best_day.net_usd)} $)` : "–")
    + tile("Schwächster Tag", data.worst_day ? `${data.worst_day.day} (${fmtSigned(data.worst_day.net_usd)} $)` : "–");

  const chartWrap = document.getElementById("ov-chart");
  if (data.curve.length > 1) {
    const curveValues = data.curve.map(p => p.cum_net);
    const curveLabels = data.curve.map(p => p.day);
    chartWrap.innerHTML = lineChartSvg(curveValues, curveLabels, data.start_balance) + `<div class="chart-tooltip"></div>`;
    attachChartTooltip(chartWrap);
  } else {
    chartWrap.innerHTML = `<div class="empty-state">Mindestens 2 Tage nötig für eine Kurve.</div>`;
  }

  const tbody = document.querySelector("#ov-days-table tbody");
  tbody.innerHTML = "";
  for (const d of data.days) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    const names = (d.account_ids || []).map(id => accountNames.get(String(id)) || `Konto ${id}`);
    if (d.has_unassigned) names.push("CSV / ohne Konto");
    let accountCell;
    if (names.length === 0) accountCell = "–";
    else if (names.length === 1) accountCell = escapeHtml(names[0]);
    else accountCell = `<span title="${escapeHtml(names.join(", "))}">Mehrere</span>`;
    tr.innerHTML = `
      <td data-col="date">${d.day}</td>
      <td data-col="account">${accountCell}</td>
      <td data-col="volume">${fmtVolumeAgg(d.volumes)}</td>
      <td data-col="trades">${d.trade_count}</td>
      <td data-col="points">${fmtSigned(d.points, 2)}</td>
      <td data-col="net" class="${cls(d.net_usd)}">${fmtSigned(d.net_usd)} $</td>
      <td data-col="journal" class="journal-cell">${d.has_journal
        ? `<span class="journal-marker" title="Journal-Eintrag vorhanden${d.journal_rating ? " – Bewertung " + d.journal_rating + "/5" : ""}">📝${d.journal_rating ? ` ${d.journal_rating}/5` : ""}</span>`
        : `<span class="muted">–</span>`}</td>
    `;
    tr.querySelector(".journal-cell").addEventListener("click", (e) => {
      e.stopPropagation();
      state.journalRefKey = d.day;
      openJournal();
    });
    tr.addEventListener("click", () => openDay(d.day));
    tbody.appendChild(tr);
  }
  applyOverviewColumnVisibility(loadOverviewColumnsState());
}

function tile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value ${extraClass}">${value}</div></div>`;
}

const TRADES_PAGE_SIZE = 50;

async function openTrades(page = 1) {
  state.view = "trades";
  state.currentDay = null;
  state.tradesPage = page;
  setActiveNav("trades");

  const content = await mountView("tpl-trades");

  await renderTagFilter();

  const [result, accountOptions] = await Promise.all([
    api(withFilter(`/api/trades?page=${page}&page_size=${TRADES_PAGE_SIZE}`)),
    getAccountOptions(),
  ]);
  const accountNames = new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name]));

  const tbody = document.getElementById("trades-tbody");
  tbody.innerHTML = "";
  if (!result.trades.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">Keine Trades für die aktuelle Filterauswahl.</div></td></tr>`;
  }
  for (const t of result.trades) {
    const accountName = t.account_id ? (accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto";
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${t.day}</td>
      <td>${escapeHtml(accountName)}</td>
      <td>${fmtTime(t.entry_time)}</td>
      <td>${t.direction}</td>
      <td>${fmtVolume(t)}</td>
      <td>${fmtNum(t.entry_price)}</td>
      <td>${fmtNum(t.exit_price)}</td>
      <td>${fmtSigned(t.points, 2)}</td>
      <td class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</td>
      <td class="tag-cell"></td>
    `;
    tr.addEventListener("click", () => openDay(t.day));
    const tagCell = tr.querySelector(".tag-cell");
    tagCell.addEventListener("click", (e) => e.stopPropagation());
    renderTradeTagCell(tagCell, t);
    tbody.appendChild(tr);
  }

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

async function openDay(day) {
  state.view = "day";
  state.currentDay = day;
  setActiveNav("");

  const content = await mountView("tpl-day");
  await populateDay(content, day);
}

async function populateDay(container, day) {
  container.querySelector(".day-title").textContent = fmtDate(day);

  const data = await api(withFilter(`/api/days/${day}`));
  const s = data.stats;

  container.querySelector(".day-stats").innerHTML =
    tile("Punkte", fmtSigned(s.total_points))
    + tile("Netto", fmtSigned(s.total_net) + " $", cls(s.total_net))
    + tile("Trades", s.trade_count)
    + tile("Tagestief (kum.)", fmtSigned(s.lowest_cum) + " $", "neg")
    + tile("Tageshoch (kum.)", fmtSigned(s.highest_cum) + " $", "pos")
    + tile("Peak-to-Valley Drawdown", fmtSigned(s.max_drawdown) + " $");

  const tbody = container.querySelector(".day-table tbody");
  tbody.innerHTML = "";
  let cum = 0;
  const cumVals = data.trades.map(t => (cum += t.net_usd));
  const highIdx = cumVals.indexOf(Math.max(...cumVals));
  const lowIdx = cumVals.indexOf(Math.min(...cumVals));

  state.selectedTradeIds = new Set();
  const bulkBar = container.querySelector(".bulk-tag-bar");
  const selectAllCb = container.querySelector(".day-table-select-all");
  bulkBar.hidden = true;
  selectAllCb.checked = false;

  function updateBulkBar() {
    const n = state.selectedTradeIds.size;
    bulkBar.hidden = n === 0;
    container.querySelector(".bulk-tag-count").textContent = `${n} Trade(s) ausgewählt`;
  }

  data.trades.forEach((t, i) => {
    const tr = document.createElement("tr");
    const cumClass = i === highIdx ? "cum-high" : (i === lowIdx ? "cum-low" : "");
    const hiLoBadge = i === highIdx ? '<span class="badge-tag">← Tageshoch</span>' : (i === lowIdx ? '<span class="badge-tag">← Tagestief</span>' : "");
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="row-select" data-id="${t.id}"></td>
      <td>${fmtTime(t.entry_time)}</td>
      <td>${fmtTime(t.exit_time)}</td>
      <td class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction}</td>
      <td>${fmtVolume(t)}</td>
      <td>${fmtNum(t.entry_price)}</td>
      <td>${fmtNum(t.exit_price)}</td>
      <td>${t.exit_type || ""}</td>
      <td class="${cls(t.points)}">${fmtSigned(t.points)}</td>
      <td class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</td>
      <td class="${cumClass}">${fmtSigned(cumVals[i])} $${hiLoBadge}</td>
      <td class="tag-cell"></td>
      <td><input class="row-note" data-id="${t.id}" value="${(t.notes || "").replace(/"/g, "&quot;")}" placeholder="Notiz…"></td>
      <td class="image-cell"></td>
      <td><button class="btn btn-danger row-delete" data-id="${t.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);

    renderTradeTagCell(tr.querySelector(".tag-cell"), t);

    tr.querySelector(".row-select").addEventListener("change", (e) => {
      if (e.target.checked) state.selectedTradeIds.add(t.id);
      else state.selectedTradeIds.delete(t.id);
      selectAllCb.checked = state.selectedTradeIds.size === data.trades.length;
      updateBulkBar();
    });

    const cell = tr.querySelector(".image-cell");
    const tradeImages = (data.images || []).filter(im => im.trade_id === t.id);
    tradeImages.forEach(img => cell.appendChild(imageThumbEl(img, "image-thumb-sm")));
    cell.appendChild(imageAddButton(day, t.id, container));

    tr.querySelector(".row-delete").addEventListener("click", async () => {
      if (!confirm("Trade wirklich löschen?")) return;
      await api(`/api/trades/${t.id}`, { method: "DELETE" });

      if (data.trades.length === 1) {
        // letzter Trade des Tages - Tag existiert danach nicht mehr,
        // GET /api/days/{day} liefert 404. Statt populateDay() erneut
        // aufzurufen (wuerde dort abbrechen und die alte Zeile stehen
        // lassen), die Ansicht verlassen, die es nicht mehr gibt.
        if (container.closest("#modal-overlay")) {
          closeModal();
          if (state.view === "month") renderMonth();
        } else {
          openOverview();
        }
        return;
      }

      await populateDay(container, day);
    });
  });

  // .onchange/.onclick statt addEventListener: diese Elemente liegen ausserhalb
  // von tbody und werden bei einem erneuten populateDay()-Aufruf auf demselben
  // Container (z.B. nach Bild-Upload) nicht neu erzeugt - addEventListener
  // wuerde sich sonst bei jedem Aufruf einen weiteren Handler dazustapeln.
  selectAllCb.onchange = () => {
    const checked = selectAllCb.checked;
    tbody.querySelectorAll(".row-select").forEach(cb => { cb.checked = checked; });
    state.selectedTradeIds = new Set(checked ? data.trades.map(t => t.id) : []);
    updateBulkBar();
  };

  const bulkSelect = container.querySelector(".bulk-tag-select");
  const tagsForBulk = await getTags();
  bulkSelect.innerHTML = groupedTagOptionsHtml(tagsForBulk);
  container.querySelector(".bulk-tag-apply").onclick = async () => {
    if (!bulkSelect.value || !state.selectedTradeIds.size) return;
    await api("/api/trades/bulk-tag", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade_ids: Array.from(state.selectedTradeIds), tag_id: parseInt(bulkSelect.value) }),
    });
    await populateDay(container, day);
  };

  tbody.querySelectorAll(".row-note").forEach(inp => {
    inp.addEventListener("blur", async () => {
      await api(`/api/trades/${inp.dataset.id}/notes`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: inp.value }),
      });
    });
  });

  renderDayImages(container, day, data.images || []);

  container.querySelector(".day-observations").innerHTML =
    obsTile("Ø Haltedauer", fmtDuration(s.avg_duration_sec))
    + obsTile("Größte Pause zw. Trades", fmtDuration(s.max_gap_sec))
    + obsTile("Richtung", `${s.long_count}x Long / ${s.short_count}x Short`)
    + obsTile("Preisspanne", `${fmtNum(s.price_low)} – ${fmtNum(s.price_high)}`)
    + obsTile("Erster Trade", fmtTime(data.trades[0].entry_time))
    + obsTile("Letzter Trade", fmtTime(data.trades[data.trades.length - 1].exit_time));

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
  const html = j.quill.getText().trim() ? j.quill.root.innerHTML : "";
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
    const res = await api(`/api/journal/day/${j.refKey}`, {
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
  const label = fmtDate(j.refKey);
  if (!await confirmDelete(`Journal-Eintrag vom ${label} wirklich löschen?`, false)) return;
  clearTimeout(j.timer);
  j.dirty = false;
  await api(`/api/journal/day/${j.refKey}`, { method: "DELETE" });
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

  const [res, tags, templates] = await Promise.all([
    api(`/api/journal/day/${refKey}`),
    getTags(),
    getJournalTemplates(),
  ]);
  const entry = res.entry;

  host.innerHTML = `
    <div class="journal-editor">
      <div class="journal-metrics">
        ${journalScoreRow("Tagesbewertung", "rating", entry ? entry.rating : null, RATING_LABELS)}
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
        <div class="journal-section-label">Tags für diesen Tag</div>
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
    placeholder: "Was ist heute passiert? Was hast du gelernt?",
    modules: { toolbar: { container: JOURNAL_TOOLBAR } },
  });
  if (entry && entry.content_html) quill.clipboard.dangerouslyPasteHTML(entry.content_html);

  activeJournal = {
    refKey, quill, host,
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
      const img = await api(`/api/days/${refKey}/images`, { method: "POST", body: fd });
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

async function renderJournalList() {
  const listEl = document.getElementById("journal-list");
  if (!listEl) return;
  const { entries } = await api(journalListQS());
  listEl.innerHTML = "";
  if (!entries.length) {
    listEl.innerHTML = `<div class="empty-state">Keine Einträge für diese Auswahl.</div>`;
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
    item.addEventListener("click", () => selectJournalEntry(entry.ref_key));
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

  const modeRow = document.getElementById("journal-mode-chips");
  for (const mode of JOURNAL_MODES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "newsbar-chip" + (state.journalMode === mode.key ? " active" : "");
    chip.textContent = mode.label;
    chip.addEventListener("click", () => {
      state.journalMode = mode.key;
      modeRow.querySelectorAll(".newsbar-chip").forEach(c => c.classList.toggle("active", c === chip));
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
      renderJournalList();
    }, 300);
  });

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
    if (dateInput.value) selectJournalEntry(dateInput.value);
  });

  await renderJournalList();
  if (state.journalRefKey) await selectJournalEntry(state.journalRefKey);
}

/* ---------- Bilder & Lightbox ---------- */

function imageThumbEl(img, sizeClass) {
  const div = document.createElement("div");
  div.className = sizeClass;
  div.innerHTML = `<img src="/media/${img.thumb_filename}" alt="" loading="lazy">`;
  div.addEventListener("click", () => openLightbox(img));
  return div;
}

function imageAddButton(day, tradeId, container) {
  const label = document.createElement("label");
  label.className = "image-add";
  label.textContent = "+";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    await uploadImage(day, file, tradeId);
    await populateDay(container, day);
  });
  label.appendChild(input);
  return label;
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
    strip.appendChild(imageThumbEl(img, "image-thumb"));
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

function positionLightboxBox(size) {
  const box = document.getElementById("lightbox-box");
  // top/left einmalig fest setzen (nicht ueber Flexbox zentrieren) - sonst
  // verschiebt sich der Anker waehrend des Resize-Drags mit dem Mauszeiger mit.
  const left = Math.max(10, Math.round((window.innerWidth - size.width) / 2));
  const top = Math.max(10, Math.round((window.innerHeight - size.height) / 2));
  box.style.left = left + "px";
  box.style.top = top + "px";
  box.style.width = size.width + "px";
  box.style.height = size.height + "px";
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
    box.style.width = width + "px";
    box.style.height = height + "px";
    box.style.left = (centerX - width / 2) + "px";
    box.style.top = (centerY - height / 2) + "px";
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
    const isWeekend = [0, 6].includes(new Date(d.date + "T00:00:00").getDay());
    el.className = "month-cell" + (isWeekend ? " weekend" : "") + (hasTrades ? " has-trades " + (d.net >= 0 ? "cell-pos" : "cell-neg") : "");
    el.innerHTML = `<div class="cell-date">${dayNum}</div>`
      + (d.has_journal ? `<span class="cell-journal-dot" title="Journal-Eintrag vorhanden"></span>` : "")
      + (hasTrades ? `<div class="cell-net">${fmtSigned(d.net)} $</div><div class="cell-count">${d.trades} Trades</div>` : "");
    if (hasTrades) el.addEventListener("click", () => openDayModal(d.date));
    grid.appendChild(el);
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
  await populateDay(body, day);
}

function closeModal() {
  // Der Journal-Editor im Modal wird gleich unsichtbar - vorher rausschreiben.
  flushJournal();
  document.getElementById("modal-overlay").classList.remove("visible");
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
function attachChartTooltip(chartWrap) {
  const tooltip = chartWrap.querySelector(".chart-tooltip");
  const ring = chartWrap.querySelector(".chart-hover-ring");
  if (!tooltip) return;

  const position = (e) => {
    const wrapRect = chartWrap.getBoundingClientRect();
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = e.clientX - wrapRect.left + 14;
    let top = e.clientY - wrapRect.top - th - 10;
    if (left + tw > wrapRect.width) left = e.clientX - wrapRect.left - tw - 14;
    if (top < 0) top = e.clientY - wrapRect.top + 14;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  chartWrap.querySelectorAll(".chart-dot-hit").forEach(hit => {
    hit.addEventListener("mouseenter", (e) => {
      tooltip.innerHTML = `<div class="chart-tooltip-date">${fmtDate(hit.dataset.day)}</div>`
        + `<div class="chart-tooltip-value">${fmtNum(parseFloat(hit.dataset.value))} $</div>`;
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
      ? "Dieses Konto hat keine automatische Sync-Anbindung. Trades ordnest du ihm beim CSV-Import in der Sidebar zu (Dropdown über \"Datei wählen\")."
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

async function renderImportAccountSelect() {
  const select = document.getElementById("import-account-select");
  const current = select.value;
  const accounts = await api("/api/accounts");
  select.innerHTML = '<option value="">Kein Konto (freier Import)</option>'
    + accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  if (accounts.some(a => String(a.id) === current)) select.value = current;
}
renderImportAccountSelect();

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
    if (state.view === "overview") openOverview();
    if (res.days && res.days.length) openDay(res.days[res.days.length - 1]);
  } catch (err) {
    statusEl.className = "import-status err";
    statusEl.textContent = err.message;
  }
  e.target.value = "";
});

/* ---------- Nav ---------- */

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", async () => {
    // Erst den Journal-Editor leeren, dann wechseln - sonst geht der zuletzt
    // getippte, noch nicht automatisch gespeicherte Absatz verloren.
    await flushJournal();
    if (el.dataset.view === "overview") openOverview();
    if (el.dataset.view === "trades") openTrades();
    if (el.dataset.view === "journal") openJournal();
    if (el.dataset.view === "month") openMonth();
    if (el.dataset.view === "accounts") openAccounts();
    if (el.dataset.view === "settings") openSettings();
  });
});

loadFilterState();
loadTagFilterState();
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
    }
  } catch (e) { /* ignore */ }
}
function saveNewsFilterState() {
  localStorage.setItem("newsCalendarFilter", JSON.stringify({
    impact: [...newsFilterState.impact], currency: [...newsFilterState.currency], type: [...newsFilterState.type],
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

function newsRowHtml(e) {
  const dt = new Date(e.time);
  const weekday = dt.toLocaleDateString("de-DE", { weekday: "short" });
  const time = dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `
    <a class="news-row" href="${escapeHtml(e.ff_url)}" target="_blank" rel="noopener" title="${escapeHtml(e.title)}">
      <div class="news-row-line1">
        <span class="news-row-dot" style="background:${impactColorVar(e.impact)}"></span>
        <span class="news-row-time">${weekday} ${time}</span>
        <span class="news-row-currency">${escapeHtml(e.currency)}</span>
        <span class="news-row-title">${escapeHtml(e.title)}</span>
      </div>
    </a>`;
}

function fillNewsList(elId, events, emptyMsg) {
  const el = document.getElementById(elId);
  el.innerHTML = events.length ? events.map(newsRowHtml).join("") : `<div class="empty-state">${emptyMsg}</div>`;
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
    newsFilterState.impact.has(e.impact) && newsFilterState.currency.has(e.currency) && newsFilterState.type.has(e.event_type)
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

  const emptyMsg = newsLoadFailed && !newsEvents.length ? "Kalender aktuell nicht erreichbar." : "Keine Termine.";
  fillNewsList("news-upcoming", week, emptyMsg);
  fillNewsList("news-nextweek", nextWeek, emptyMsg);
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
