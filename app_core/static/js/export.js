/* Export-Seite: frei waehlbare Trade-Felder als CSV/JSON. Eigene Filter,
   bewusst unabhaengig vom globalen Konto-/Tag-/Strategie-Filter der App -
   sonst muesste man fuer "nur MT5 der letzten Woche exportieren" erst den
   globalen Filter umstellen und danach wieder zuruecksetzen. */

import { api, escapeHtml, readStoredArray, writeStored } from './core.js';
import { buildTagChipGroups, getAccountOptions, getTags } from './filters.js';
import { mountView, setActiveNav } from './overview.js';

/* Muss mit db.EXPORT_FIELDS/db.EXPORT_COMPUTED_FIELDS (db.py) uebereinstimmen -
   zwei Sprachen, eine Liste je Seite. Neues Broker-Feld: hier UND dort ergaenzen. */
const EXPORT_FIELD_GROUPS = [
  {
    title: "Rohdaten (vom Broker)",
    fields: [
      { key: "instrument", label: "Instrument" },
      { key: "direction", label: "Richtung" },
      { key: "entry_time", label: "Entry-Zeit" },
      { key: "exit_time", label: "Exit-Zeit" },
      { key: "entry_price", label: "Entry-Preis" },
      { key: "exit_price", label: "Exit-Preis" },
      { key: "entry_order_id", label: "Entry-Order-ID" },
      { key: "exit_order_id", label: "Exit-Order-ID" },
      { key: "volume", label: "Volumen" },
      { key: "commission_usd", label: "Kommission $" },
      { key: "exit_type", label: "Exit-Typ" },
      { key: "risk_usd", label: "Risiko $" },
    ],
  },
  {
    title: "Berechnet (aus echten Preisen)",
    fields: [
      { key: "points", label: "Punkte" },
      { key: "gross_usd", label: "Brutto $" },
      { key: "net_usd", label: "Netto $" },
    ],
  },
  {
    // Setzt voraus, dass die Trades in der richtigen Reihenfolge exportiert
    // werden (siehe get_trades_for_export() in db.py: day ASC, entry_time
    // ASC) - sonst liesse sich "Tageshoch"/"Tagestief" nicht sinnvoll einem
    // Trade zuordnen.
    title: "Kumuliert (pro Tag, in Reihenfolge)",
    fields: [
      { key: "cumulative_net", label: "Kumuliert $" },
      { key: "day_extreme", label: "Tageshoch/-tief" },
    ],
  },
];
const EXPORT_FIELD_KEYS = EXPORT_FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key));

/* Gespeichert werden die AUSGEBLENDETEN Felder, nicht die ausgewaehlten -
   analog zu overviewHiddenColumns/tradeFieldHidden (siehe CLAUDE.md), sonst
   waere ein neu hinzugekommenes Feld fuer Bestandsnutzer mit gespeicherter
   Auswahl unsichtbar. */
function loadExportFieldHidden() {
  const saved = readStoredArray("exportFieldHidden");
  if (!saved) return new Set();
  return new Set(saved.filter(k => EXPORT_FIELD_KEYS.includes(k)));
}
function saveExportFieldHidden(hidden) {
  writeStored("exportFieldHidden", [...hidden]);
}

let exportFilters = {
  accounts: { mode: "all", keys: [] },
  strategies: { mode: "all", keys: [] },
  tags: { mode: "all", keys: [], logic: "or" },
  start: "",
  end: "",
};
let exportHiddenFields = new Set();
let exportFormat = "csv";

function exportFilterQS() {
  const parts = [];
  if (exportFilters.accounts.mode === "selected" && exportFilters.accounts.keys.length) {
    parts.push(`accounts=${encodeURIComponent(exportFilters.accounts.keys.join(","))}`);
  }
  if (exportFilters.strategies.mode === "selected" && exportFilters.strategies.keys.length) {
    parts.push(`strategies=${encodeURIComponent(exportFilters.strategies.keys.join(","))}`);
  }
  if (exportFilters.tags.mode === "selected" && exportFilters.tags.keys.length) {
    parts.push(`tags=${encodeURIComponent(exportFilters.tags.keys.join(","))}&tag_logic=${exportFilters.tags.logic}`);
  }
  if (exportFilters.start) parts.push(`start=${encodeURIComponent(exportFilters.start)}`);
  if (exportFilters.end) parts.push(`end=${encodeURIComponent(exportFilters.end)}`);
  return parts.join("&");
}

async function refreshExportCount() {
  const label = document.getElementById("export-count-label");
  if (!label) return;
  label.textContent = "Wird ermittelt …";
  const qs = exportFilterQS();
  const { count } = await api(`/api/trades/export/count${qs ? "?" + qs : ""}`);
  label.textContent = count === 1 ? "1 Trade entspricht den Filtern." : `${count} Trades entsprechen den Filtern.`;
}

/* Checkbox-Panel fuer Konto/Strategie - gleiche Optik wie renderAccountFilter()
   in filters.js, aber an lokalen statt globalen Zustand gebunden (siehe oben:
   der Export-Filter darf den globalen Filter nicht mitveraendern). */
function renderCheckboxFilter(panelId, countId, options, filterState, allLabel, emptyHint) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.innerHTML = "";
  const rerender = () => renderCheckboxFilter(panelId, countId, options, filterState, allLabel, emptyHint);

  const countBadge = document.getElementById(countId);
  if (countBadge) countBadge.textContent = filterState.mode === "selected" && filterState.keys.length ? `(${filterState.keys.length})` : "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox"> ${escapeHtml(allLabel)}`;
  const masterInput = masterLabel.querySelector("input");
  masterInput.checked = filterState.mode === "all";
  masterInput.addEventListener("change", () => {
    filterState.mode = "all";
    filterState.keys = [];
    rerender();
    refreshExportCount();
  });
  panel.appendChild(masterLabel);

  if (!options.length) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.style.padding = "6px 0";
    hint.textContent = emptyHint;
    panel.appendChild(hint);
    return;
  }

  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "filter-item";
    label.innerHTML = `<input type="checkbox" data-key="${escapeHtml(opt.key)}"> ${escapeHtml(opt.name)}`;
    const input = label.querySelector("input");
    input.checked = filterState.mode === "selected" && filterState.keys.includes(opt.key);
    input.addEventListener("change", () => {
      const checked = Array.from(panel.querySelectorAll("input[data-key]:checked")).map(i => i.dataset.key);
      if (!checked.length) { filterState.mode = "all"; filterState.keys = []; }
      else { filterState.mode = "selected"; filterState.keys = checked; }
      rerender();
      refreshExportCount();
    });
    panel.appendChild(label);
  }
}

async function renderExportTagFilter() {
  const wrap = document.getElementById("export-tag-filter-list");
  if (!wrap) return;
  const tags = await getTags();
  wrap.innerHTML = "";
  const rerender = renderExportTagFilter;

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "tag-filter-all-chip" + (exportFilters.tags.mode === "all" ? " active" : "");
  allBtn.textContent = "Alle Tags";
  allBtn.addEventListener("click", () => {
    exportFilters.tags.mode = "all";
    exportFilters.tags.keys = [];
    rerender();
    refreshExportCount();
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
      (tag) => exportFilters.tags.mode === "selected" && exportFilters.tags.keys.includes(String(tag.id)),
      (tag) => {
        const current = new Set(exportFilters.tags.mode === "selected" ? exportFilters.tags.keys : []);
        if (current.has(String(tag.id))) current.delete(String(tag.id)); else current.add(String(tag.id));
        if (!current.size) { exportFilters.tags.mode = "all"; exportFilters.tags.keys = []; }
        else { exportFilters.tags.mode = "selected"; exportFilters.tags.keys = [...current]; }
        rerender();
        refreshExportCount();
      },
    ));
  }

  document.querySelectorAll("#export-tag-logic-toggle .tag-logic-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.logic === exportFilters.tags.logic);
    btn.addEventListener("click", () => {
      exportFilters.tags.logic = btn.dataset.logic;
      rerender();
      refreshExportCount();
    });
  });
}

/* Immer nur eines der drei Filter-Panels gleichzeitig offen - ein Klick auf
   einen anderen Toggle soll das gerade offene schliessen, nicht ein zweites
   danebenstellen. */
const EXPORT_FILTER_PANEL_IDS = ["export-account-filter-panel", "export-strategy-filter-panel", "export-tag-filter-panel"];
function toggleExportFilterPanel(panel) {
  const wasHidden = panel.hidden;
  for (const id of EXPORT_FILTER_PANEL_IDS) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  panel.hidden = !wasHidden;
}

function renderExportFieldPanel() {
  const container = document.getElementById("export-fields");
  if (!container) return;
  container.innerHTML = EXPORT_FIELD_GROUPS.map(group => `
    <div class="export-field-group">
      <div class="newsbar-filter-group-title">${escapeHtml(group.title)}</div>
      ${group.fields.map(f => `
        <label class="filter-item">
          <input type="checkbox" data-field="${f.key}" ${exportHiddenFields.has(f.key) ? "" : "checked"}>
          ${escapeHtml(f.label)}
        </label>
      `).join("")}
    </div>
  `).join("");

  container.querySelectorAll("input[data-field]").forEach(input => {
    input.addEventListener("change", () => {
      const key = input.dataset.field;
      const willHide = !input.checked;
      // Mindestens ein Feld muss gewaehlt bleiben - sonst waere die Export-Datei leer.
      if (willHide && exportHiddenFields.size >= EXPORT_FIELD_KEYS.length - 1) {
        input.checked = true;
        return;
      }
      if (willHide) exportHiddenFields.add(key); else exportHiddenFields.delete(key);
      saveExportFieldHidden(exportHiddenFields);
    });
  });
}

async function triggerExportDownload() {
  const selectedFields = EXPORT_FIELD_KEYS.filter(k => !exportHiddenFields.has(k));
  const params = new URLSearchParams(exportFilterQS());
  params.set("fields", selectedFields.join(","));
  params.set("format", exportFormat);

  const btn = document.getElementById("export-download-btn");
  btn.disabled = true;
  try {
    const res = await fetch(`/api/trades/export?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = Array.isArray(err.detail) ? err.detail.map(d => d.msg || JSON.stringify(d)).join("; ") : err.detail;
      throw new Error(detail || "Export fehlgeschlagen.");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `trades_export.${exportFormat}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
  }
}

export async function openExport() {
  setActiveNav("export");
  await mountView("tpl-export");
  exportHiddenFields = loadExportFieldHidden();

  const accountOptions = await getAccountOptions();
  const accToggle = document.getElementById("export-account-filter-toggle");
  const accPanel = document.getElementById("export-account-filter-panel");
  accToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleExportFilterPanel(accPanel); });
  renderCheckboxFilter("export-account-filter-panel", "export-account-filter-count",
    accountOptions, exportFilters.accounts, "Alle Konten", "Noch keine Konten/Importe.");

  const { strategies } = await api("/api/strategies?include_archived=true");
  const strategyBlock = document.getElementById("export-strategy-filter");
  if (!strategies.length) {
    strategyBlock.hidden = true;
  } else {
    const strategyOptions = [...strategies.map(s => ({ key: String(s.id), name: s.name })),
      { key: "none", name: "Ohne Strategie" }];
    const stratToggle = document.getElementById("export-strategy-filter-toggle");
    const stratPanel = document.getElementById("export-strategy-filter-panel");
    stratToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleExportFilterPanel(stratPanel); });
    renderCheckboxFilter("export-strategy-filter-panel", "export-strategy-filter-count",
      strategyOptions, exportFilters.strategies, "Alle Strategien", "Noch keine Strategie angelegt.");
  }

  const tagToggle = document.getElementById("export-tag-filter-toggle");
  const tagPanel = document.getElementById("export-tag-filter-panel");
  tagToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleExportFilterPanel(tagPanel); });
  await renderExportTagFilter();

  const startInput = document.getElementById("export-range-start");
  const endInput = document.getElementById("export-range-end");
  startInput.value = exportFilters.start;
  endInput.value = exportFilters.end;
  startInput.addEventListener("change", () => { exportFilters.start = startInput.value; refreshExportCount(); });
  endInput.addEventListener("change", () => { exportFilters.end = endInput.value; refreshExportCount(); });
  document.getElementById("export-range-clear").addEventListener("click", () => {
    exportFilters.start = "";
    exportFilters.end = "";
    startInput.value = "";
    endInput.value = "";
    refreshExportCount();
  });

  renderExportFieldPanel();

  document.querySelectorAll('input[name="export-format"]').forEach(r => {
    r.checked = r.value === exportFormat;
    r.addEventListener("change", () => { if (r.checked) exportFormat = r.value; });
  });

  document.getElementById("export-download-btn").addEventListener("click", triggerExportDownload);

  await refreshExportCount();
}
