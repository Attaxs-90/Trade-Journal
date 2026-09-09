/* Uebersichtsseite mit Kennzahlen-Kacheln und Equity-Kurve, plus mountView(). */

import { attachChartTooltip, lineChartSvg } from './chart.js';
import { api, clearAppError, cls, escapeHtml, fmtNum, fmtSigned, fmtTime, fmtVolume, ICON_DELETE, ICON_IMAGE, ICON_JOURNAL, ICON_NOTE, ICON_OPEN, ICON_SHARE, makeSortable, readStoredArray, state, strategiesQS, tile, withFilter, writeStored } from './core.js';
import { confirmDelete } from './dialogs.js';
import { getAccountOptions, renderAccountChipRow, renderStrategyChipRow, renderTagFilter } from './filters.js';
import { clearActiveJournal, flushJournal } from './journal.js';
import { clearActiveNotebookNote, flushNotebookNote } from './notebooks.js';
import { mountHelpButton } from './help.js';
import { openShareModal } from './share.js';
import { bulkAssignStrategy } from './strategies.js';
import { renderTradeTagCell } from './tags.js';
import { openTrade } from './trades.js';

/* ---------- Views ---------- */

export function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
}

/* Baut den Hauptbereich auf ein Template um. Schreibt vorher einen offenen
   Journal-Editor raus und verwirft ihn - sein DOM wird hier ersetzt, ein
   danach noch feuernder Autosave wuerde ins Leere laufen. */
export async function mountView(templateId) {
  await flushJournal();
  clearActiveJournal();
  await flushNotebookNote();
  clearActiveNotebookNote();
  clearAppError();  // neue Ansicht - eine Meldung der vorherigen ist erledigt
  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById(templateId).content.cloneNode(true));
  mountHelpButton(content, templateId);
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
  writeStored("overviewHiddenStats", [...hiddenSet]);
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
  writeStored("overviewStatOrder", order);
}

/* #ov-stats ist ein mehrspaltiges Grid, daher grid:true (siehe makeSortable). */
function wireOverviewStatDrag(grid) {
  makeSortable(grid, ".stat-tile", saveOverviewStatOrder, { grid: true, keyAttr: "statKey" });
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
  wireOverviewStatDrag(grid);
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

  makeSortable(panel, ".trade-field-order-row", (order) => {
    saveOverviewStatOrder(order);
    renderOverviewStats(lastOverviewData);
  });
}

export async function openOverview() {
  state.view = "overview";
  state.currentDay = null;
  setActiveNav("overview");

  const content = await mountView("tpl-overview");
  await renderAccountChipRow("ov-account-chip-row");
  await renderStrategyChipRow("ov-strategy-chip-row");

  // Strategie-Filter bewusst nicht in withFilter() (siehe core.js) - er soll
  // nur die Uebersicht selbst filtern, deshalb hier separat angehaengt statt
  // ueber den globalen Filter-Querystring, der auch von Trades/Journal/
  // Auswertungen genutzt wird.
  const overviewUrl = withFilter("/api/overview");
  const sq = strategiesQS();
  const data = await api(sq ? overviewUrl + (overviewUrl.includes("?") ? "&" : "?") + sq : overviewUrl);
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

const TRADES_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const TRADES_PAGE_SIZE_DEFAULT = 50;

function loadTradesPageSize() {
  const saved = Number(localStorage.getItem("tradesPageSize"));
  return TRADES_PAGE_SIZE_OPTIONS.includes(saved) ? saved : TRADES_PAGE_SIZE_DEFAULT;
}
function saveTradesPageSize(size) {
  writeStored("tradesPageSize", size);
}

const ICON_SORT = `<svg class="sort-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

/* Nur Spalten, deren Schluessel exakt einer sortierbaren DB-Spalte entsprechen
   (siehe TRADE_SORT_COLUMNS in db.py) - Konto/Strategie muessten fuer eine
   sinnvolle Sortierung erst den Namen nachladen (Join), Tags sind kein
   skalarer Wert. */
const SORTABLE_TRADE_KEYS = new Set(["day", "entry_time", "direction", "volume", "entry_price", "exit_price", "points", "net_usd"]);

/* Spalten der Trades-Tabelle - "render" liefert den Zellinhalt fuer alle
   Spalten ausser "tags" (das braucht echtes DOM fuer den Tag-Zuweisen-Button
   und wird in renderTradesTable() separat behandelt). Neue Spalte hinzufuegen:
   hier eintragen, TRADE_CARD_FIELD_KEYS zieht die Keys automatisch nach - der
   per Drag & Drop einstellbare Reihenfolge-Mechanismus selbst muss dafuer
   nicht angefasst werden. */
const TRADE_CARD_FIELDS = [
  { key: "day", label: "Datum", render: (t) => t.day },
  { key: "account", label: "Konto", render: (t, ctx) => {
    const name = t.account_id ? (ctx.accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto";
    return `<span class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
  } },
  { key: "entry_time", label: "Entry-Zeit", render: (t) => fmtTime(t.entry_time) },
  { key: "direction", label: "Richtung", render: (t) => `<span class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction === "Long" ? "▲" : "▼"} ${t.direction}</span>` },
  { key: "volume", label: "Größe", render: (t) => fmtVolume(t) },
  { key: "entry_price", label: "Entry", render: (t) => fmtNum(t.entry_price) },
  { key: "exit_price", label: "Exit", render: (t) => fmtNum(t.exit_price) },
  { key: "points", label: "Punkte", render: (t) => `<span class="${cls(t.points)}">${fmtSigned(t.points, 2)}</span>` },
  { key: "net_usd", label: "Netto $", render: (t) => `<span class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</span>` },
  { key: "strategy", label: "Strategie", render: (t, ctx) => {
    if (!t.strategy_id) return "–";
    const name = ctx.strategyNames.get(String(t.strategy_id)) || "?";
    return `<span class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
  } },
  { key: "tags", label: "Tags", render: null },
];
const TRADE_CARD_FIELD_KEYS = TRADE_CARD_FIELDS.map(f => f.key);

/* Reihenfolge gilt global fuer jede Trade-Karte (nicht pro Sitzung) - deshalb
   in localStorage statt in state, analog zu overviewHiddenColumns. */
function loadTradeFieldOrder() {
  const saved = readStoredArray("tradeFieldOrder");
  if (!saved) return [...TRADE_CARD_FIELD_KEYS];
  // Unbekannte/entfernte Keys rausfiltern, neu hinzugekommene Felder hinten anhaengen -
  // sonst verschwindet ein neues Feld fuer Bestandsnutzer mit gespeicherter Reihenfolge.
  const known = saved.filter(k => TRADE_CARD_FIELD_KEYS.includes(k));
  for (const k of TRADE_CARD_FIELD_KEYS) if (!known.includes(k)) known.push(k);
  return known;
}
function saveTradeFieldOrder(order) {
  writeStored("tradeFieldOrder", order);
}

/* Gespeichert werden die AUSGEBLENDETEN Felder, nicht die sichtbaren - analog
   zu overviewHiddenColumns (siehe CLAUDE.md), sonst waere ein neu
   hinzugekommenes Feld fuer Bestandsnutzer mit gespeicherter Auswahl unsichtbar. */
function loadTradeFieldHidden() {
  const saved = readStoredArray("tradeFieldHidden");
  if (!saved) return new Set();
  return new Set(saved.filter(k => TRADE_CARD_FIELD_KEYS.includes(k)));
}
function saveTradeFieldHidden(hiddenSet) {
  writeStored("tradeFieldHidden", [...hiddenSet]);
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

  makeSortable(panel, ".trade-field-order-row", (order) => {
    saveTradeFieldOrder(order);
    renderTradesTable();
  });
}

let tradesTableData = { trades: [], accountNames: new Map(), strategyNames: new Map() };

/* Auswahl fuer die Sammel-Aktion (Journal-Eintraege mehrerer Trades auf
   einmal loeschen) - bewusst nicht in state, sondern modulweit wie
   tradesTableData: gilt nur fuer die aktuell geladene Trades-Seite, wird bei
   jedem openTrades()-Aufruf (Seiten-/Filterwechsel) zurueckgesetzt. */
let tradesSelectedIds = new Set();

/* Bar bleibt immer sichtbar (auch bei 0 markierten Trades) statt ein- und
   auszublenden - so springt das Layout beim ersten Markieren/Entmarkieren
   nicht, und "0 Trades ausgewählt" macht die Auswahlfunktion ueberhaupt erst
   sichtbar. Die Aktions-Buttons ergeben ohne Auswahl keinen Sinn und werden
   stattdessen deaktiviert. */
function updateTradesBulkBar() {
  const bar = document.getElementById("trades-bulk-bar");
  if (!bar) return;
  const n = tradesSelectedIds.size;
  const countEl = document.getElementById("trades-bulk-count");
  if (countEl) countEl.textContent = n === 1 ? "1 Trade ausgewählt" : `${n} Trades ausgewählt`;
  ["trades-bulk-clear", "trades-bulk-strategy-btn", "trades-bulk-delete-journal", "trades-bulk-delete-trades"]
    .forEach(id => { const btn = document.getElementById(id); if (btn) btn.disabled = n === 0; });
}

function renderTradesTable() {
  const theadRow = document.getElementById("trades-thead-row");
  const tbody = document.getElementById("trades-tbody");
  const { trades, accountNames, strategyNames } = tradesTableData;
  const hidden = loadTradeFieldHidden();
  const order = loadTradeFieldOrder().filter(key => !hidden.has(key));

  // Badges- und Oeffnen-Spalte sind fix (nicht Teil der einstellbaren
  // Reihenfolge) - die Badges markieren nur, ob Notiz/Bild/Journal-Eintrag
  // vorhanden sind, sind also kein eigenstaendiger Datenwert wie die uebrigen
  // Spalten, und "Oeffnen" ist eine Aktion, keine Spalte mit Wert.
  const sort = state.tradesSort || { key: "day", dir: "desc" };
  const selectAllCb = document.createElement("input");
  selectAllCb.type = "checkbox";
  theadRow.innerHTML = `<th class="col-check"></th><th class="col-badges">Status</th><th class="col-actions">Aktionen</th>` + order.map(key => {
    const field = TRADE_CARD_FIELDS.find(f => f.key === key);
    if (!SORTABLE_TRADE_KEYS.has(key)) return `<th>${escapeHtml(field.label)}</th>`;
    const active = sort.key === key;
    return `<th class="sortable-th${active ? " active" : ""}" data-sort-key="${key}">`
      + `${escapeHtml(field.label)}${active ? ICON_SORT.replace('class="sort-arrow"', `class="sort-arrow${sort.dir === "asc" ? " asc" : ""}"`) : ""}</th>`;
  }).join("");
  theadRow.querySelector(".col-check").appendChild(selectAllCb);
  theadRow.querySelectorAll(".sortable-th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      const current = state.tradesSort || { key: "day", dir: "desc" };
      // Erneuter Klick auf die aktive Spalte kehrt die Richtung um, eine neue
      // Spalte startet absteigend (bei Datum/Betraegen meist die interessantere
      // Richtung: neuestes/groesstes zuerst).
      state.tradesSort = { key, dir: current.key === key && current.dir === "desc" ? "asc" : "desc" };
      openTrades(1);
    });
  });

  tbody.innerHTML = "";
  if (!trades.length) {
    tbody.innerHTML = `<tr><td colspan="${order.length + 3}"><div class="empty-state">Keine Trades für die aktuelle Filterauswahl.</div></td></tr>`;
    selectAllCb.disabled = true;
    updateTradesBulkBar();
    return;
  }
  // Zeile antippen markiert/entmarkiert nur den Trade (Mehrfachauswahl fuer
  // Sammelaktionen) - ein Trade oeffnen geht ausschliesslich ueber den
  // expliziten Oeffnen-Button. Vorher oeffnete ein Klick irgendwo auf der
  // Zeile den Trade, was beim Markieren mehrerer Trades staendig aus
  // Versehen dazwischenfunkte (siehe Nutzer-Feedback) - jetzt umgekehrt.
  for (const t of trades) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    const badges = (t.notes && t.notes.trim() ? `<span class="trade-card-badge" title="Notiz vorhanden">${ICON_NOTE}</span>` : "")
      + (t.has_image ? `<span class="trade-card-badge" title="Bild vorhanden">${ICON_IMAGE}</span>` : "")
      + (t.has_journal ? `<span class="trade-card-badge" title="Journal-Eintrag (Bewertung/Review) vorhanden">${ICON_JOURNAL}</span>` : "");
    tr.innerHTML = `<td class="col-check"><input type="checkbox" class="trades-row-select" data-id="${t.id}"${tradesSelectedIds.has(t.id) ? " checked" : ""}></td>`
      + `<td class="col-badges">${badges}</td>`
      + `<td class="col-actions">`
      + `<button type="button" class="trade-open-row-btn" title="Trade öffnen" aria-label="Trade öffnen">${ICON_OPEN}</button>`
      + `<button type="button" class="trade-share-row-btn" title="Als Bild teilen" aria-label="Als Bild teilen">${ICON_SHARE}</button>`
      + `<button type="button" class="trade-delete-row-btn" title="Trade löschen" aria-label="Trade löschen">${ICON_DELETE}</button>`
      + `</td>`
      + order.map(key => {
      if (key === "tags") return `<td class="tag-cell"></td>`;
      const field = TRADE_CARD_FIELDS.find(f => f.key === key);
      return `<td>${field.render(t, { accountNames, strategyNames })}</td>`;
    }).join("");
    const rowCb = tr.querySelector(".trades-row-select");
    function setRowSelected(checked) {
      rowCb.checked = checked;
      if (checked) tradesSelectedIds.add(t.id);
      else tradesSelectedIds.delete(t.id);
      tr.classList.toggle("selected", checked);
      selectAllCb.checked = trades.every(tr => tradesSelectedIds.has(tr.id));
      updateTradesBulkBar();
    }
    tr.classList.toggle("selected", rowCb.checked);
    tr.addEventListener("click", () => setRowSelected(!rowCb.checked));
    const openBtn = tr.querySelector(".trade-open-row-btn");
    openBtn.addEventListener("click", (e) => { e.stopPropagation(); openTrade(t.id); });
    const shareBtn = tr.querySelector(".trade-share-row-btn");
    shareBtn.addEventListener("click", (e) => { e.stopPropagation(); openShareModal(t); });
    const deleteBtn = tr.querySelector(".trade-delete-row-btn");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await confirmDelete("Soll dieser Trade endgültig gelöscht werden? Notizen, Bilder und der Journal-Eintrag zu diesem Trade werden mitgelöscht.")) return;
      await api(`/api/trades/${t.id}`, { method: "DELETE" });
      tradesSelectedIds.delete(t.id);
      await openTrades(state.tradesPage || 1);
    });
    const tagCell = tr.querySelector(".tag-cell");
    if (tagCell) {
      tagCell.addEventListener("click", (e) => e.stopPropagation());
      renderTradeTagCell(tagCell, t);
    }
    // Checkbox hat ihr eigenes natives Toggle - stopPropagation verhindert,
    // dass der Zeilen-Click-Handler denselben Klick zusaetzlich verarbeitet
    // und die Auswahl wieder umkehrt; "change" uebernimmt den neuen Zustand.
    rowCb.addEventListener("click", (e) => e.stopPropagation());
    rowCb.addEventListener("change", () => setRowSelected(rowCb.checked));
    tbody.appendChild(tr);
  }

  selectAllCb.checked = trades.every(t => tradesSelectedIds.has(t.id));
  selectAllCb.addEventListener("click", (e) => e.stopPropagation());
  selectAllCb.addEventListener("change", () => {
    for (const t of trades) {
      if (selectAllCb.checked) tradesSelectedIds.add(t.id);
      else tradesSelectedIds.delete(t.id);
    }
    tbody.querySelectorAll(".trades-row-select").forEach(cb => {
      cb.checked = selectAllCb.checked;
      cb.closest("tr").classList.toggle("selected", selectAllCb.checked);
    });
    updateTradesBulkBar();
  });
  updateTradesBulkBar();
}

async function bulkDeleteTrades() {
  const ids = [...tradesSelectedIds];
  if (!ids.length) return;
  const message = ids.length === 1
    ? "Soll der ausgewählte Trade endgültig gelöscht werden? Notizen, Bilder und der Journal-Eintrag dazu werden mitgelöscht."
    : `Sollen die ${ids.length} ausgewählten Trades endgültig gelöscht werden? Notizen, Bilder und Journal-Einträge dazu werden mitgelöscht.`;
  if (!await confirmDelete(message)) return;
  await api("/api/trades/bulk-delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade_ids: ids }),
  });
  tradesSelectedIds.clear();
  await openTrades(state.tradesPage || 1);
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

export async function openTrades(page = 1) {
  state.view = "trades";
  state.currentDay = null;
  state.tradesPage = page;
  setActiveNav("trades");

  const content = await mountView("tpl-trades");
  tradesSelectedIds.clear();

  await renderTagFilter();

  const pageSize = loadTradesPageSize();
  const sort = state.tradesSort || { key: "day", dir: "desc" };
  const [result, accountOptions, strategiesRes] = await Promise.all([
    api(withFilter(`/api/trades?page=${page}&page_size=${pageSize}&sort=${sort.key}&dir=${sort.dir}`)),
    getAccountOptions(),
    // include_archived: ein archiviert markierter, aber noch zugewiesener Trade
    // soll seinen Strategienamen behalten statt "?" anzuzeigen.
    api("/api/strategies?include_archived=true"),
  ]);
  tradesTableData = {
    trades: result.trades,
    accountNames: new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name])),
    strategyNames: new Map(strategiesRes.strategies.map(s => [String(s.id), s.name])),
  };
  renderTradesTable();

  const pageSizeRow = document.getElementById("trades-page-size-row");
  pageSizeRow.innerHTML = `
    <label class="trades-page-size-label">Trades pro Seite
      <select class="trades-page-size-select">
        ${TRADES_PAGE_SIZE_OPTIONS.map(n => `<option value="${n}"${n === pageSize ? " selected" : ""}>${n}</option>`).join("")}
      </select>
    </label>
  `;
  pageSizeRow.querySelector(".trades-page-size-select").addEventListener("change", (e) => {
    saveTradesPageSize(Number(e.target.value));
    // Zurueck auf Seite 1 - die aktuelle Seitenzahl haette bei einer groesseren
    // Seitengroesse eine andere Bedeutung und koennte ausserhalb des gueltigen
    // Bereichs liegen.
    openTrades(1);
  });

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
  document.getElementById("trades-bulk-delete-trades").onclick = () => bulkDeleteTrades();
  // Nach einer Sammelaktion die Tabelle neu laden - Strategie und
  // Journal-/Bild-Markierungen stehen in den Trade-Zeilen.
  document.getElementById("trades-bulk-strategy-btn").onclick = () =>
    bulkAssignStrategy([...tradesSelectedIds], () => openTrades(state.tradesPage || 1));

  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const pagination = document.getElementById("trades-pagination");
  pagination.innerHTML = `
    <button type="button" class="btn btn-secondary trades-page-prev" ${page <= 1 ? "disabled" : ""}>← Zurück</button>
    <span class="pagination-label">Seite ${page} von ${totalPages} (${result.total} Trade(s))</span>
    <button type="button" class="btn btn-secondary trades-page-next" ${page >= totalPages ? "disabled" : ""}>Weiter →</button>
  `;
  pagination.querySelector(".trades-page-prev").addEventListener("click", () => openTrades(page - 1));
  pagination.querySelector(".trades-page-next").addEventListener("click", () => openTrades(page + 1));
}
