/* Einstellungen: Schriftart, ein-/ausklappbare Karten, Journal-Vorlagen, Tag-Verwaltung. */

import { api, cls, escapeHtml, fmtNum, fmtSigned, safeColor, state } from './core.js';
import { confirmDelete, deleteAccountFlow } from './dialogs.js';
import { getTags, invalidateTagsCache, renderTagFilter } from './filters.js';
import { JOURNAL_TOOLBAR, flushJournal, getJournalTemplates, initQuillFormats } from './journal.js';
import { mountView, setActiveNav } from './overview.js';
import { populateDay } from './share.js';

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

export async function openSettings() {
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
        <div class="tag-row-name"><span class="tag-color-dot" style="background:${safeColor(t.color)}"></span>${escapeHtml(t.name)}</div>
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
export function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} Sek`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} Min`;
}

/* CFDs (MT5) werden in Lots gehandelt, Futures (NinjaTrader-Import) in
   Kontrakten - die Herkunft (source) entscheidet automatisch, welche
   Einheit angezeigt wird. Aeltere Trades ohne gespeicherte Groesse (vor
   Einfuehrung dieses Felds) zeigen "-". */
