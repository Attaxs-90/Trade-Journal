/* Monatsuebersicht, Tages-Modal und der gemeinsame Modal-Rahmen. */

import { api, attachOutsideClose, cls, fmtDate, fmtSigned, state, tile, withFilter } from './core.js';
import { closeLightbox } from './images.js';
import { clearActiveJournal, flushJournal, mountJournalEditor, renderJournalList } from './journal.js';
import { flushNotebookNote } from './notebooks.js';
import { mountView, setActiveNav } from './overview.js';
import { populateDay } from './share.js';

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

export async function renderMonth() {
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
