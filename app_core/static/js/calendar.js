/* Monatsuebersicht, Tages-Modal und der gemeinsame Modal-Rahmen. */

import { api, attachOutsideClose, cls, escapeHtml, fmtDate, fmtNum, fmtSigned, fmtTime, fmtVolume, ICON_IMAGE, ICON_JOURNAL, state, tile, withFilter } from './core.js';
import { getAccountOptions } from './filters.js';
import { closeLightbox } from './images.js';
import { clearActiveJournal, flushJournal, mountJournalEditor, renderJournalList } from './journal.js';
import { impactColorVar, NEWS_CURRENCIES, NEWS_EVENT_TYPES, NEWS_IMPACT_LEVELS, renderImpactTypeCurrencyChips } from './news.js';
import { flushNotebookNote } from './notebooks.js';
import { mountView, setActiveNav } from './overview.js';
import { populateDay } from './share.js';

/* Filter fuer die News-Markierungen im Kalender - eigener Zustand/eigener
   localStorage-Key, unabhaengig vom Newsbar-Filter (newsCalendarFilter in
   news.js): der Kalender zeigt einen dauerhaften Verlauf (siehe
   db.list_news_history), die Newsbar nur die aktuelle/naechste Woche - beide
   Filterauswahlen muessen sich nicht decken. */
const monthNewsFilterState = {
  enabled: true,
  impact: new Set(NEWS_IMPACT_LEVELS.map(l => l.key)),
  currency: new Set(NEWS_CURRENCIES),
  type: new Set(NEWS_EVENT_TYPES),
};
function loadMonthNewsFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("monthNewsFilter") || "null");
    if (saved) {
      if (typeof saved.enabled === "boolean") monthNewsFilterState.enabled = saved.enabled;
      if (Array.isArray(saved.impact)) monthNewsFilterState.impact = new Set(saved.impact);
      if (Array.isArray(saved.currency)) monthNewsFilterState.currency = new Set(saved.currency);
      if (Array.isArray(saved.type)) monthNewsFilterState.type = new Set(saved.type);
    }
  } catch (e) { /* ignore */ }
}
function saveMonthNewsFilterState() {
  try {
    localStorage.setItem("monthNewsFilter", JSON.stringify({
      enabled: monthNewsFilterState.enabled,
      impact: [...monthNewsFilterState.impact], currency: [...monthNewsFilterState.currency], type: [...monthNewsFilterState.type],
    }));
  } catch (e) { /* ignore */ }
}

const MONTH_CHEVRON = `<svg class="ui-icon month-day-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

/* Spalten der Trade-Tabelle, die sich beim Aufklappen eines Tages in "Alle
   Tage des Monats" oeffnet - eigene, feste Spaltenliste statt der
   umsortierbaren TRADE_CARD_FIELDS/DAY_TRADE_FIELDS (Trades-Uebersicht bzw.
   Tagesansicht), weil hier explizit diese Spalten in dieser Reihenfolge
   gewuenscht sind und keine Anpassung noetig ist. Kumuliert/Vorschau werden
   getrennt gefuehrt (nicht wie in DAY_TRADE_FIELDS kombiniert), weil der
   Nutzer eine eigene Vorschau-Spalte fuer Tageshoch/Tagestief wollte. */
function monthDayTradesTable(trades, accountNames, strategyNames) {
  let cum = 0;
  const cumVals = trades.map(t => (cum += t.net_usd));
  const highIdx = cumVals.indexOf(Math.max(...cumVals));
  const lowIdx = cumVals.indexOf(Math.min(...cumVals));

  const rows = trades.map((t, i) => {
    const accountName = t.account_id ? escapeHtml(accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto";
    const strategyName = t.strategy_id ? escapeHtml(strategyNames.get(String(t.strategy_id)) || "?") : "–";
    const cumClass = i === highIdx ? "cum-high" : (i === lowIdx ? "cum-low" : "");
    const preview = i === highIdx ? '<span class="badge-tag">Tageshoch</span>' : (i === lowIdx ? '<span class="badge-tag">Tagestief</span>' : "–");
    return `<tr>
      <td>${accountName}</td>
      <td>${fmtTime(t.entry_time)}</td>
      <td>${fmtTime(t.exit_time)}</td>
      <td><span class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction === "Long" ? "▲" : "▼"} ${t.direction}</span></td>
      <td>${fmtVolume(t)}</td>
      <td>${fmtNum(t.entry_price)}</td>
      <td>${fmtNum(t.exit_price)}</td>
      <td>${t.exit_type || "–"}</td>
      <td class="${cls(t.points)}">${fmtSigned(t.points, 2)}</td>
      <td class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</td>
      <td class="${cumClass}">${fmtSigned(cumVals[i])} $</td>
      <td>${preview}</td>
      <td>${strategyName}</td>
    </tr>`;
  }).join("");

  return `<table class="table month-day-trades-table">
    <thead><tr>
      <th>Konto</th><th>Entry-Zeit</th><th>Exit-Zeit</th><th>Richtung</th><th>Größe</th>
      <th>Entry</th><th>Exit</th><th>Exit-Typ</th><th>Punkte</th><th>Netto $</th>
      <th>Kumuliert</th><th>Vorschau</th><th>Strategie</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ---------- Monatsübersicht ---------- */

export async function openMonth() {
  state.view = "month";
  state.currentDay = null;
  setActiveNav("month");

  const now = new Date();
  if (!state.monthYear) state.monthYear = now.getFullYear();
  if (!state.monthNum) state.monthNum = now.getMonth() + 1;

  const content = await mountView("tpl-month");

  content.querySelector(".month-prev").addEventListener("click", () => shiftMonth(-1));
  content.querySelector(".month-next").addEventListener("click", () => shiftMonth(1));
  content.querySelector(".month-today").addEventListener("click", () => goToCurrentMonth());

  loadMonthNewsFilterState();
  const settingsToggle = content.querySelector("#month-settings-toggle");
  const settingsPanel = content.querySelector("#month-settings-panel");
  settingsToggle.addEventListener("click", () => { settingsPanel.hidden = !settingsPanel.hidden; });

  const newsCheckbox = content.querySelector("#month-news-toggle");
  newsCheckbox.checked = monthNewsFilterState.enabled;
  newsCheckbox.addEventListener("change", () => {
    monthNewsFilterState.enabled = newsCheckbox.checked;
    saveMonthNewsFilterState();
    renderMonth();
  });

  renderImpactTypeCurrencyChips(
    settingsPanel,
    { impact: "month-news-filter-impact", type: "month-news-filter-types", currency: "month-news-filter-currencies" },
    monthNewsFilterState,
    () => { saveMonthNewsFilterState(); renderMonth(); },
  );

  const scrapeBtn = content.querySelector("#month-news-scrape-btn");
  const scrapeStatus = content.querySelector("#month-news-scrape-status");
  scrapeBtn.addEventListener("click", async () => {
    scrapeBtn.disabled = true;
    scrapeStatus.textContent = "Lädt … bei vielen Monaten kann das eine Weile dauern.";
    try {
      const res = await api("/api/news/history/scrape", { method: "POST" });
      scrapeStatus.textContent = `${res.inserted} neue Termine geladen (${res.months_scraped.length} Monat(e) abgefragt`
        + `${res.months_failed.length ? ", " + res.months_failed.length + " fehlgeschlagen" : ""}).`;
      await renderMonth();
    } catch (err) {
      scrapeStatus.textContent = err.message || "Fehlgeschlagen.";
    } finally {
      scrapeBtn.disabled = false;
    }
  });

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

function goToCurrentMonth() {
  const now = new Date();
  state.monthYear = now.getFullYear();
  state.monthNum = now.getMonth() + 1;
  renderMonth();
}

export async function renderMonth() {
  // Neu geladen bei jedem renderMonth() (Monatswechsel, aber auch nach dem
  // Schliessen des Tages-Modals) - ein zwischenzeitlich geloeschter/
  // geaenderter Trade darf nicht aus einem alten Aufklapp-Cache kommen.
  monthDayTradesCache = new Map();
  const monthStart = `${state.monthYear}-${String(state.monthNum).padStart(2, "0")}-01`;
  const lastDay = new Date(state.monthYear, state.monthNum, 0).getDate();
  const monthEnd = `${state.monthYear}-${String(state.monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const [data, accountOptions, strategiesRes, newsHistoryRes] = await Promise.all([
    api(withFilter(`/api/month/${state.monthYear}/${state.monthNum}`)),
    getAccountOptions(),
    api("/api/strategies?include_archived=true"),
    monthNewsFilterState.enabled ? api(`/api/news/history?start=${monthStart}&end=${monthEnd}`) : Promise.resolve({ events: [] }),
  ]);
  const accountNames = new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name]));
  const strategyNames = new Map(strategiesRes.strategies.map(s => [String(s.id), s.name]));

  // Pro Tag: Titel-Liste fuer den Tooltip + hoechster Impact fuer Rahmenfarbe
  // und Label (High > Medium > Low > Feiertag) - ein Tag kann mehrere
  // erfasste Termine haben, gezeigt wird trotzdem nur eine Markierung.
  const impactRank = { High: 4, Medium: 3, Low: 2, Holiday: 1 };
  const newsByDay = new Map();
  for (const ev of newsHistoryRes.events) {
    if (!monthNewsFilterState.impact.has(ev.impact)) continue;
    if (!monthNewsFilterState.currency.has(ev.currency)) continue;
    if (!monthNewsFilterState.type.has(ev.event_type)) continue;
    const entry = newsByDay.get(ev.day) || { impact: ev.impact, titles: [] };
    if ((impactRank[ev.impact] || 0) > (impactRank[entry.impact] || 0)) entry.impact = ev.impact;
    entry.titles.push(ev.title);
    newsByDay.set(ev.day, entry);
  }

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
    const newsEntry = newsByDay.get(d.date);
    el.className = "month-cell" + (isWeekend ? " weekend" : "")
      + (hasTrades ? " has-trades " + (d.net >= 0 ? "cell-pos" : "cell-neg") : "")
      + (openable && !hasTrades ? " clickable" : "");
    // Nur ein kurzes, anklickbares Label (Farbe nach hoechstem Impact) - kein
    // Rahmen mehr um die Kachel (siehe Nutzer-Feedback: der Rahmen war zu
    // viel, das Label allein reicht). Feiertage ausdruecklich als "Feiertag"
    // benannt statt nur "Holiday". Klick zeigt die eigentlichen Termine.
    const newsLabel = newsEntry ? (newsEntry.impact === "Holiday" ? "Feiertag" : newsEntry.impact) : "";
    el.innerHTML = `<div class="cell-date">${dayNum}`
      + (newsEntry ? `<button type="button" class="cell-news-chip" style="background:${impactColorVar(newsEntry.impact)}" title="Klicken für Details">${escapeHtml(newsLabel)}</button>` : "")
      + `</div>`
      + `<div class="cell-icons">`
      + `<span class="cell-journal-icon${d.has_journal ? "" : " cell-journal-icon-empty"}" title="${d.has_journal ? "Journal-Eintrag vorhanden - anzeigen" : "Noch kein Journal-Eintrag - anlegen"}">${ICON_JOURNAL}</span>`
      + (d.has_image ? `<span class="cell-image-icon" title="Bild vorhanden">${ICON_IMAGE}</span>` : "")
      + `</div>`
      + (hasTrades ? `<div class="cell-net">${fmtSigned(d.net)} $</div><div class="cell-count">${d.trades} Trades</div>` : "");
    // Icon oeffnet immer den Journal-Eintrag des Tages (auch zum Neuanlegen an
    // Tagen ohne Trade) - eigener Klick-Handler, damit er unabhaengig vom
    // Zellen-Klick (der nur bei Handelstagen das Tagesdetail oeffnet) funktioniert.
    el.querySelector(".cell-journal-icon").addEventListener("click", (e) => {
      e.stopPropagation();
      openJournalModal(d.date);
    });
    const newsChipBtn = el.querySelector(".cell-news-chip");
    if (newsChipBtn) {
      newsChipBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openNewsInfoModal(d.date, newsEntry);
      });
    }
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
    // Tage mit Trades klappen beim Anklicken ihre Trade-Tabelle direkt in der
    // Liste auf (siehe monthDayTradesTable) statt das Tagesdetail-Modal zu
    // oeffnen - das bleibt dem Kalender-Grid oben vorbehalten (siehe dessen
    // Klick-Handler). Tage ganz ohne Trade (nur Journal/Bild) haben nichts
    // Aufklappbares und oeffnen weiterhin direkt das Modal.
    const openable = hasTrades || d.has_image || d.has_journal;
    const tr = document.createElement("tr");
    if (openable) tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${hasTrades ? MONTH_CHEVRON : ""}${d.date}</td>
      <td>${hasTrades ? d.trades : "–"}</td>
      <td class="${hasTrades ? cls(d.points) : ""}">${hasTrades ? fmtSigned(d.points, 2) : "–"}</td>
      <td class="${hasTrades ? cls(d.net) : ""}">${hasTrades ? fmtSigned(d.net) + " $" : "–"}</td>
      <td class="journal-cell">${d.has_journal
        ? `<span class="journal-marker" title="Journal-Eintrag vorhanden${d.journal_rating ? " – Bewertung " + d.journal_rating + "/5" : ""}">${ICON_JOURNAL}${d.journal_rating ? ` ${d.journal_rating}/5` : ""}</span>`
        : `<span class="muted">–</span>`}</td>
      <td>${d.has_image ? `<span title="Bild vorhanden">${ICON_IMAGE}</span>` : `<span class="muted">–</span>`}</td>
    `;
    tr.querySelector(".journal-cell").addEventListener("click", (e) => {
      e.stopPropagation();
      openJournalModal(d.date);
    });
    if (hasTrades) {
      tr.addEventListener("click", () => toggleMonthDayExpand(tr, d.date, accountNames, strategyNames));
    } else if (openable) {
      tr.addEventListener("click", () => openDayModal(d.date));
    }
    tbody.appendChild(tr);
  }
}

// Tag -> bereits geladene Trades des Tages, damit ein erneutes Auf-/Zuklappen
// desselben Tages (innerhalb dieses Monatsaufrufs) nicht jedes Mal neu laedt.
let monthDayTradesCache = new Map();

async function toggleMonthDayExpand(tr, day, accountNames, strategyNames) {
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains("month-day-expand-row")) {
    existing.remove();
    tr.classList.remove("expanded");
    return;
  }
  // Nur ein aufgeklappter Tag gleichzeitig - sonst waechst die Liste bei
  // mehreren offenen Tagen schnell unuebersichtlich lang.
  closeAllExpandedMonthDays(tr.parentElement);

  tr.classList.add("expanded");
  const expandRow = document.createElement("tr");
  expandRow.className = "month-day-expand-row";
  const cellCount = tr.children.length;
  expandRow.innerHTML = `<td colspan="${cellCount}"><div class="month-day-trades-loading">Lade Trades…</div></td>`;
  tr.after(expandRow);

  let trades = monthDayTradesCache.get(day);
  if (!trades) {
    const dayData = await api(withFilter(`/api/days/${day}`));
    trades = dayData.trades;
    monthDayTradesCache.set(day, trades);
  }
  // Row koennte inzwischen (z.B. durch einen erneuten Klick waehrend des
  // Ladens) schon wieder entfernt worden sein.
  if (!expandRow.isConnected) return;
  expandRow.querySelector("td").innerHTML = `<div class="table-scroll">${monthDayTradesTable(trades, accountNames, strategyNames)}</div>`;
}

function closeAllExpandedMonthDays(tbody) {
  tbody.querySelectorAll(".month-day-expand-row").forEach(row => row.remove());
  tbody.querySelectorAll("tr.expanded").forEach(row => row.classList.remove("expanded"));
}

export function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

/* ---------- Tages-Modal ---------- */

async function openDayModal(day) {
  await flushJournal();
  clearActiveJournal();
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
export async function openJournalModal(day) {
  await flushJournal();
  clearActiveJournal();
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

/* Klick auf das News-Label einer Kalenderkachel (siehe renderMonth) - zeigt
   die tatsaechlichen Termine dieses Tages statt nur des kurzen "High"/
   "Feiertag"-Labels. Nutzt denselben generischen Modal-Rahmen wie
   openJournalModal(), aber ohne modalOnClose - reines Anzeigen, nichts wird
   hier gespeichert/geaendert, ein Neuladen der Monatsuebersicht beim
   Schliessen ist also nicht noetig. */
function openNewsInfoModal(day, entry) {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <section class="view">
      <header class="view-header"><h1>News am ${fmtDate(day)}</h1></header>
      <div class="news-day-info-list">
        ${entry.titles.map(t => `<div class="news-day-info-row">${escapeHtml(t)}</div>`).join("")}
      </div>
    </section>`;
  overlay.classList.add("visible");
  modalOnClose = null;
}

let modalOnClose = null;

export async function closeModal() {
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

export function obsTile(label, value) {
  return `<div class="obs-tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}
/* siehe clearActiveJournal() in journal.js - gleiche Begruendung. */
export function setModalOnClose(fn) { modalOnClose = fn; }
