const state = {
  view: "overview", currentDay: null,
  filterMode: "all", filterKeys: [],
  tagFilterMode: "all", tagFilterKeys: [], tagFilterLogic: "or",
  selectedTradeIds: new Set(),
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

async function renderAccountFilter() {
  const options = await api("/api/account-options");
  const list = document.getElementById("account-filter-list");
  list.innerHTML = "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox" id="filter-all"> Alle Konten`;
  list.appendChild(masterLabel);
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
    list.appendChild(hint);
    return;
  }

  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "filter-item";
    label.innerHTML = `<input type="checkbox" data-key="${opt.key}"> ${opt.name}`;
    const input = label.querySelector("input");
    input.checked = state.filterMode === "selected" && state.filterKeys.includes(opt.key);
    input.addEventListener("change", () => {
      const checked = Array.from(list.querySelectorAll("input[data-key]:checked")).map(i => i.dataset.key);
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
    list.appendChild(label);
  }
}

let cachedTags = null;
async function getTags(force = false) {
  if (force || !cachedTags) cachedTags = await api("/api/tags");
  return cachedTags;
}
function invalidateTagsCache() { cachedTags = null; }

async function renderTagFilter() {
  const tags = await getTags();
  const list = document.getElementById("tag-filter-list");
  list.innerHTML = "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox" id="tag-filter-all"> Alle Tags`;
  list.appendChild(masterLabel);
  const masterInput = masterLabel.querySelector("input");
  masterInput.checked = state.tagFilterMode === "all";
  masterInput.addEventListener("change", () => {
    state.tagFilterMode = "all";
    state.tagFilterKeys = [];
    saveTagFilterState();
    renderTagFilter();
    refreshCurrentView();
  });

  if (!tags.length) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.style.padding = "6px 0";
    hint.textContent = "Noch keine Tags angelegt.";
    list.appendChild(hint);
  } else {
    for (const tag of tags) {
      const label = document.createElement("label");
      label.className = "filter-item";
      label.innerHTML = `<input type="checkbox" data-key="${tag.id}"><span class="filter-item-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}`;
      const input = label.querySelector("input");
      input.checked = state.tagFilterMode === "selected" && state.tagFilterKeys.includes(String(tag.id));
      input.addEventListener("change", () => {
        const checked = Array.from(list.querySelectorAll("input[data-key]:checked")).map(i => i.dataset.key);
        if (!checked.length) {
          state.tagFilterMode = "all";
          state.tagFilterKeys = [];
        } else {
          state.tagFilterMode = "selected";
          state.tagFilterKeys = checked;
        }
        saveTagFilterState();
        renderTagFilter();
        refreshCurrentView();
      });
      list.appendChild(label);
    }
  }

  document.querySelectorAll("#tag-logic-toggle .tag-logic-btn").forEach(btn => {
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
  refreshDayList();
  if (state.view === "overview") openOverview();
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
      await refreshDayList();
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
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-settings").content.cloneNode(true));
  renderFontSettings();
  await renderSettingsAccountDelete();
  await renderTagsSettings();
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

/* ---------- Tag-Chips & Popover (Tagesansicht) ---------- */

function tagTextColor(hex) {
  const c = (hex || "#6c95ff").replace("#", "");
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1d21" : "#ffffff";
}
function tagChipHtml(tag) {
  return `<span class="tag-chip" style="background:${tag.color};color:${tagTextColor(tag.color)}">${escapeHtml(tag.name)}</span>`;
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

function confirmDelete(message) {
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

/* ---------- Sidebar / Day list ---------- */

async function refreshDayList() {
  const days = await api(withFilter("/api/days"));
  const list = document.getElementById("day-list");
  list.innerHTML = "";
  if (!days.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Daten.<br>CSV importieren.</div>`;
    return;
  }
  for (const d of days) {
    const btn = document.createElement("button");
    btn.className = "day-row" + (state.currentDay === d.day ? " active" : "");
    btn.innerHTML = `<span class="d-date">${d.day}</span><span class="d-net ${cls(d.net_usd)}">${fmtSigned(d.net_usd)} $</span>`;
    btn.addEventListener("click", () => openDay(d.day));
    list.appendChild(btn);
  }
}

/* ---------- Views ---------- */

function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
}

async function openOverview() {
  state.view = "overview";
  state.currentDay = null;
  setActiveNav("overview");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-overview").content.cloneNode(true));

  const data = await api(withFilter("/api/overview"));

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
    tr.innerHTML = `<td>${d.day}</td><td>${d.trade_count}</td><td>${fmtSigned(d.points, 2)}</td><td class="${cls(d.net_usd)}">${fmtSigned(d.net_usd)} $</td>`;
    tr.addEventListener("click", () => openDay(d.day));
    tbody.appendChild(tr);
  }
}

function tile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value ${extraClass}">${value}</div></div>`;
}

async function openDay(day) {
  state.view = "day";
  state.currentDay = day;
  setActiveNav("");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-day").content.cloneNode(true));
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
        refreshDayList();
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
  bulkSelect.innerHTML = tagsForBulk.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
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

  const noteArea = container.querySelector(".day-note");
  noteArea.value = data.note || "";
  // onblur= statt addEventListener: populateDay() wird auf demselben Container
  // mehrfach neu aufgerufen (z.B. nach jedem Bild-Upload), das Notizfeld selbst
  // wird dabei aber nicht neu erzeugt - addEventListener wuerde sich also bei
  // jedem Aufruf einen weiteren Handler dazu-stapeln und beim Verlassen des
  // Felds mehrfach denselben Request abschicken.
  noteArea.onblur = async () => {
    await api(`/api/days/${day}/notes`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: noteArea.value }),
    });
  };
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
  refreshDayList();

  const now = new Date();
  if (!state.monthYear) state.monthYear = now.getFullYear();
  if (!state.monthNum) state.monthNum = now.getMonth() + 1;

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-month").content.cloneNode(true));

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
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = "";
  body.appendChild(document.getElementById("tpl-day").content.cloneNode(true));
  overlay.classList.add("visible");
  await populateDay(body, day);
}

function closeModal() {
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
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-accounts").content.cloneNode(true));

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
        <div class="account-name">${acc.name}</div>
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
        await refreshDayList();
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
          await refreshDayList();
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
    await refreshDayList();
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
  el.addEventListener("click", () => {
    if (el.dataset.view === "overview") openOverview();
    if (el.dataset.view === "month") openMonth();
    if (el.dataset.view === "accounts") openAccounts();
    if (el.dataset.view === "settings") openSettings();
  });
});

loadFilterState();
loadTagFilterState();
renderAccountFilter();
renderTagFilter();
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

  const filtered = newsEvents.filter(e =>
    newsFilterState.impact.has(e.impact) && newsFilterState.currency.has(e.currency) && newsFilterState.type.has(e.event_type)
  );

  const week = [], hot = [], history = [];
  for (const e of filtered) {
    const t = new Date(e.time);
    const day0 = startOfDay(t);
    if (day0 >= monday0 && day0 < saturday0) week.push(e);
    if (day0.getTime() === today0.getTime() && t < now) hot.push(e);
    else if (day0 < monday0) history.push(e);
  }
  week.sort((a, b) => new Date(a.time) - new Date(b.time));
  hot.sort((a, b) => new Date(b.time) - new Date(a.time));
  history.sort((a, b) => new Date(b.time) - new Date(a.time));

  const emptyMsg = newsLoadFailed && !newsEvents.length ? "Kalender aktuell nicht erreichbar." : "Keine Termine.";
  fillNewsList("news-upcoming", week, emptyMsg);
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

  const filterBtn = document.getElementById("newsbar-filter-btn");
  const panel = document.getElementById("newsbar-filter-panel");
  filterBtn.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  const historyToggle = document.getElementById("news-history-toggle");
  const historyList = document.getElementById("news-history");
  const applyHistoryCollapsed = (collapsed) => {
    historyList.classList.toggle("collapsed", collapsed);
    historyToggle.classList.toggle("collapsed", collapsed);
  };
  applyHistoryCollapsed(localStorage.getItem("newsHistoryCollapsed") === "true");
  historyToggle.addEventListener("click", () => {
    const next = !historyList.classList.contains("collapsed");
    localStorage.setItem("newsHistoryCollapsed", String(next));
    applyHistoryCollapsed(next);
  });

  loadNewsFilterState();
  renderNewsFilters();
  loadNews();
  setInterval(loadNews, 5 * 60 * 1000);
}
initNewsbar();
