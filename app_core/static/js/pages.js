/* OneNote-Aufbau: Abschnitte (Sidebar) -> Seitenliste -> Seite.

   Tagebuch: Jahr -> Monat (Abschnitt) -> Monatsseite/Review/KW -> Tage.
   Eine KW gehoert zum Monat ihres Donnerstags (siehe app/diary.py), deshalb
   rechnet monthForDay() den Monat ueber den Donnerstag der Woche aus.
   Notizbuecher: Ordner = Abschnitt(sgruppe), Notizen = Seiten.

   Die Seiten selbst nutzen die vorhandenen Bausteine: populateDay() (Trades,
   Strategie/Regeln, Bilder, Journal) fuer Tage, mountJournalEditor() fuer
   KW/Monat/Review und mountNotebookEditor() fuer Notizen. Gewechselt wird nur
   der Seitenbereich, die Liste bleibt stehen (schnell wie in OneNote). */

import { monthLabel } from './calendar.js';
import { api, cls, escapeHtml, fmtSigned, state, withFilter, writeStored } from './core.js';
import { confirmDelete, promptDialog } from './dialogs.js';
import { mountJournalEditor } from './journal.js';
import { flushNotebookNote, mountNotebookEditor } from './notebooks.js';
import { mountView, setActiveNav } from './overview.js';
import { populateDay } from './share.js';

const P = {
  kind: null,          // "diary" | "notebook"
  month: null,         // "2026-10"
  monthData: null,
  folderId: null,
  nodes: [],
  target: null,        // { type, ref }  type: day|week|month|review|note|folder
};

const YEAR_COLORS = ["#8AA8E4", "#F6B078", "#ADE792", "#E8A0C8", "#9BD3D0", "#C9B3F0"];
const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/* ---------- Hilfen ---------- */

function readStoredString(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
let unit = readStoredString("pageUnit", "usd");
// Betraege neben Jahren/Monaten in der Sidebar - abschaltbar (roher String wie theme).
let showSectionResults = readStoredString("sectionsShowResults", "true") !== "false";
function readExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem("sectionsExpanded") || "null") || [`y${new Date().getFullYear()}`]); }
  catch { return new Set([`y${new Date().getFullYear()}`]); }
}
const expanded = readExpanded();
function toggleExpanded(key) {
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  writeStored("sectionsExpanded", [...expanded]);
}

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayIso() { return isoDate(new Date()); }
function parseDay(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function isoWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function monthForDay(day) {
  const d = parseDay(day);
  const thu = addDays(d, 4 - isoWeekday(d));
  return `${thu.getFullYear()}-${pad(thu.getMonth() + 1)}`;
}
function isoWeekMonday(ref) {
  const [y, w] = ref.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  return addDays(jan4, 1 - isoWeekday(jan4) + (w - 1) * 7);
}
function monthForTarget(t) {
  if (t.type === "day") return monthForDay(t.ref);
  if (t.type === "week") return monthForDay(isoDate(isoWeekMonday(t.ref)));
  return t.ref;
}
function shortDate(day) { return `${day.slice(8, 10)}.${day.slice(5, 7)}.`; }
function monthName(ref) { return MONTH_NAMES[Number(ref.slice(5, 7)) - 1]; }

function signed(n, decimals) {
  const s = fmtSigned(n, decimals);
  return n > 0 ? "+" + s : s;
}
/* Ergebnis in der gewaehlten Einheit. R zaehlt nur Trades mit hinterlegtem
   Risiko - ein Sternchen zeigt, wenn das nicht alle Trades waren. */
function fmtResult(st) {
  if (!st || !st.trades) return { text: "", cls: "", title: "" };
  if (unit === "r") {
    if (st.r === null || st.r === undefined) return { text: "–", cls: "muted", title: "Kein Risiko hinterlegt" };
    return { text: signed(st.r, 1) + "R" + (st.r_complete ? "" : "*"), cls: cls(st.r),
             title: st.r_complete ? "" : "Nur Trades mit hinterlegtem Risiko gezählt" };
  }
  if (unit === "pts") return { text: signed(st.points, 1) + " Pkt", cls: cls(st.points), title: "" };
  return { text: signed(st.net, Math.abs(st.net) >= 1000 ? 0 : 2) + " $", cls: cls(st.net), title: "" };
}
function resultHtml(st, extraClass = "") {
  const r = fmtResult(st);
  return r.text ? `<span class="pi-res ${r.cls} ${extraClass}"${r.title ? ` title="${r.title}"` : ""}>${r.text}</span>` : "";
}
function sumStats(list) {
  const out = { trades: 0, net: 0, points: 0, r: null, r_complete: true };
  for (const s of list) {
    if (!s.trades) continue;
    out.trades += s.trades; out.net += s.net; out.points += s.points;
    if (s.r !== null && s.r !== undefined) out.r = (out.r || 0) + s.r;
    if (!s.r_complete) out.r_complete = false;
  }
  return out;
}

function targetHash(t) {
  const map = { day: "tag", week: "kw", month: "monat", review: "review", note: "notiz", folder: "abschnitt" };
  return `#${map[t.type]}/${t.ref}`;
}
function parseHash() {
  const m = location.hash.match(/^#(tag|kw|monat|review|notiz|abschnitt)\/(.+)$/);
  if (!m) return null;
  const map = { tag: "day", kw: "week", monat: "month", review: "review", notiz: "note", abschnitt: "folder" };
  return { type: map[m[1]], ref: decodeURIComponent(m[2]) };
}

/* ---------- Abschnitte (Sidebar) ---------- */

export async function renderSections() {
  const host = document.getElementById("sections");
  if (!host) return;
  const [sec, nb] = await Promise.all([api(withFilter("/api/diary/sections")), api("/api/notebooks")]);
  P.nodes = nb.nodes;
  const byYear = new Map();
  for (const m of sec.months) {
    const y = m.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m);
  }
  const years = [...byYear.keys()].sort().reverse();
  const allYears = [...byYear.keys()].sort();

  const secRes = (st) => (showSectionResults ? resultHtml(st, "sec-res") : "");
  let html = `<div class="sections-head">
      <span>Tagebuch</span>
      <span class="sections-head-actions">
        <button type="button" class="sections-head-btn" id="sections-toggle-results" aria-pressed="${showSectionResults}"
          title="${showSectionResults ? "Beträge ausblenden" : "Beträge einblenden"}" aria-label="${showSectionResults ? "Beträge ausblenden" : "Beträge einblenden"}">${showSectionResults ? "$ an" : "$ aus"}</button>
        <button type="button" class="sections-head-btn" id="sections-add-month" title="Nächsten Monat anlegen" aria-label="Nächsten Monat anlegen">+ Monat</button>
        <button type="button" class="sections-head-btn" id="sections-today" title="Heutige Seite öffnen">Heute</button>
      </span>
    </div>`;
  for (const y of years) {
    const months = byYear.get(y);
    const color = YEAR_COLORS[allYears.indexOf(y) % YEAR_COLORS.length];
    const open = expanded.has(`y${y}`);
    html += `<div class="sec-group" style="--sec-color:${color}">
        <button type="button" class="sec-group-head" data-toggle="y${y}" aria-expanded="${open}">
          <span class="sec-chevron${open ? " open" : ""}" aria-hidden="true"></span>
          <span class="sec-name">${y}</span>${secRes(sumStats(months))}
        </button>
        <div class="sec-items"${open ? "" : " hidden"}>
          ${months.map(m => `<button type="button" class="sec-item" data-month="${m.month}">
              <span class="sec-tab" aria-hidden="true"></span>
              <span class="sec-name">${monthName(m.month)}</span>${secRes(m)}
            </button>`).join("")}
        </div>
      </div>`;
  }

  html += `<div class="sections-head">
      <span>Notizbücher</span>
      <button type="button" class="sections-head-btn" id="sections-add-notebook" title="Neuen Abschnitt anlegen" aria-label="Neuen Abschnitt anlegen">+</button>
    </div>`;
  html += folderTreeHtml(null, 0) || `<div class="sections-empty">Noch keine Notizbücher.</div>`;
  host.innerHTML = html;

  host.querySelector("#sections-today").onclick = () => openPages({ type: "day", ref: todayIso() });
  host.querySelector("#sections-toggle-results").onclick = () => {
    showSectionResults = !showSectionResults;
    try { localStorage.setItem("sectionsShowResults", String(showSectionResults)); } catch { /* nur diese Sitzung */ }
    renderSections();
  };
  host.querySelector("#sections-add-month").onclick = async () => {
    const { month } = await api("/api/diary/months", { method: "POST" });
    expanded.add(`y${month.slice(0, 4)}`);
    writeStored("sectionsExpanded", [...expanded]);
    await renderSections();
    await openPages({ type: "month", ref: month });
  };
  host.querySelector("#sections-add-notebook").onclick = () => createFolder(null);
  host.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleExpanded(btn.dataset.toggle);
      renderSections();
    };
  });
  host.querySelectorAll(".sec-item[data-month]").forEach(btn => {
    btn.onclick = () => openPages({ type: "month", ref: btn.dataset.month }, { openFirst: true });
  });
  host.querySelectorAll(".sec-item[data-folder]").forEach(btn => {
    btn.onclick = () => openPages({ type: "folder", ref: btn.dataset.folder });
  });
  markSectionsActive();
}

function folderTreeHtml(parentId, depth) {
  const folders = P.nodes.filter(n => n.node_type === "folder" && (n.parent_id ?? null) === parentId);
  return folders.map(f => {
    const hasSub = P.nodes.some(n => n.node_type === "folder" && n.parent_id === f.id);
    const open = expanded.has(`f${f.id}`);
    const color = f.color || "var(--text-faint)";
    return `<div class="sec-folder" style="--sec-color:${escapeHtml(color)}">
        <div class="sec-item sec-folder-row" data-folder="${f.id}" role="button" tabindex="0" style="padding-left:${8 + depth * 14}px">
          ${hasSub ? `<span class="sec-chevron${open ? " open" : ""}" data-toggle="f${f.id}" role="button" aria-label="Unterabschnitte ein-/ausklappen"></span>` : `<span class="sec-tab" aria-hidden="true"></span>`}
          <span class="sec-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        </div>
        ${hasSub && open ? folderTreeHtml(f.id, depth + 1) : ""}
      </div>`;
  }).join("");
}

function markSectionsActive() {
  const host = document.getElementById("sections");
  if (!host) return;
  const t = state.view === "pages" ? P.target : null;
  const month = t && P.kind === "diary" ? P.month : null;
  const folder = t && P.kind === "notebook" ? String(P.folderId) : null;
  host.querySelectorAll(".sec-item").forEach(el => {
    el.classList.toggle("active", (month && el.dataset.month === month) || (folder && el.dataset.folder === folder));
  });
}
export function clearSectionsActive() {
  if (location.hash) history.replaceState(null, "", location.pathname);
  document.querySelectorAll("#sections .sec-item.active").forEach(el => el.classList.remove("active"));
}

/* ---------- Ansicht ---------- */

async function ensureView() {
  if (state.view === "pages" && document.getElementById("page-list")) return;
  state.view = "pages";
  state.currentDay = null;
  setActiveNav("");
  await mountView("tpl-pages");
  document.getElementById("page-unit-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-unit]");
    if (!btn) return;
    unit = btn.dataset.unit;
    try { localStorage.setItem("pageUnit", unit); } catch { /* nur fuer diese Sitzung */ }
    paintUnitToggle();
    renderSections();
    if (P.kind === "diary") { renderDiaryList(); if (P.target) renderCanvas(P.target, true); }
  });
  paintUnitToggle();
}
function paintUnitToggle() {
  document.querySelectorAll("#page-unit-toggle [data-unit]").forEach(b => b.classList.toggle("active", b.dataset.unit === unit));
}

/* Oeffnet eine Seite. opts.openFirst: bei Monat ohne konkrete Seite die
   heutige (im laufenden Monat) bzw. die Monatsseite zeigen. */
export async function openPages(target, opts = {}) {
  await ensureView();
  if (["day", "week", "month", "review"].includes(target.type)) {
    const month = monthForTarget(target);
    if (P.kind !== "diary" || P.month !== month || opts.reload) {
      P.kind = "diary";
      P.month = month;
      P.monthData = await api(withFilter(`/api/diary/${month.slice(0, 4)}/${Number(month.slice(5, 7))}`));
    }
    if (opts.openFirst && target.type === "month") {
      const today = todayIso();
      if (monthForDay(today) === month) target = { type: "day", ref: today };
    }
    renderDiaryList();
  } else {
    let folderId = target.type === "folder" ? Number(target.ref) : null;
    if (target.type === "note") {
      const node = P.nodes.find(n => n.id === Number(target.ref)) || (await api(`/api/notebooks/${target.ref}`)).node;
      folderId = node.parent_id;
    }
    if (P.kind !== "notebook" || P.folderId !== folderId || opts.reload) {
      P.kind = "notebook";
      P.folderId = folderId;
      P.nodes = (await api("/api/notebooks")).nodes;
    }
    if (target.type === "folder") {
      const first = notesOf(folderId)[0];
      if (first) target = { type: "note", ref: String(first.id) };
    }
    renderNotebookList();
  }
  P.target = target;
  history.replaceState(null, "", targetHash(target));
  document.querySelector(".page-list")?.classList.toggle("is-notebook", P.kind === "notebook");
  markListActive();
  markSectionsActive();
  await renderCanvas(target);
}

export async function refreshPages() {
  if (!P.target) return;
  await renderSections();
  await openPages(P.target, { reload: true });
}

export async function openStartPage() {
  const t = parseHash();
  await openPages(t || { type: "day", ref: todayIso() });
}

/* ---------- Seitenliste ---------- */

function pageItem(type, ref, level, name, title, st, extra = {}) {
  const classes = ["page-item", `lvl-${level}`];
  if (extra.today) classes.push("is-today");
  if (extra.future) classes.push("is-future");
  if (!extra.hasEntry) classes.push("no-entry");
  const news = (extra.news || []).map(n => `<span class="pi-news" title="${escapeHtml(n.title)}">${escapeHtml(n.label)}</span>`).join("");
  return `<button type="button" class="${classes.join(" ")}" data-type="${type}" data-ref="${escapeHtml(ref)}">
      <span class="pi-main">
        <span class="pi-name">${escapeHtml(name)}</span>
        ${title ? `<span class="pi-title">${escapeHtml(title)}</span>` : ""}${news}
      </span>
      ${resultHtml(st)}
    </button>`;
}

function renderDiaryList() {
  const list = document.getElementById("page-list-items");
  const head = document.getElementById("page-list-title");
  if (!list || !P.monthData) return;
  const d = P.monthData;
  const [y, m] = d.month.split("-").map(Number);
  head.innerHTML = `<span>${escapeHtml(monthLabel(y, m))}</span>${resultHtml(d.stats)}`;
  let html = pageItem("month", d.month, 1, monthName(d.month), d.month_page.title || "Monatsziel", d.stats, { hasEntry: d.month_page.has_entry })
    + pageItem("review", d.month, 2, "Review", d.review_page.title, null, { hasEntry: d.review_page.has_entry });
  for (const w of d.weeks) {
    html += pageItem("week", w.ref, 1, `KW ${w.iso_week}`, w.title, w.stats, { hasEntry: w.has_entry, today: w.is_current });
    for (const day of w.days) {
      html += pageItem("day", day.date, 2, `${shortDate(day.date)} ${day.weekday}`, day.title || (day.stats.trades ? "" : (day.is_future ? "" : "")),
        day.stats, { hasEntry: day.has_entry, today: day.is_today, future: day.is_future, news: day.news });
    }
  }
  list.innerHTML = html;
  wireList(list);
  document.getElementById("page-list-actions").innerHTML = "";
}

function notesOf(folderId) {
  return P.nodes.filter(n => n.node_type === "note" && (n.parent_id ?? null) === folderId);
}

function renderNotebookList() {
  const list = document.getElementById("page-list-items");
  const head = document.getElementById("page-list-title");
  if (!list) return;
  const folder = P.nodes.find(n => n.id === P.folderId);
  head.innerHTML = `<span>${escapeHtml(folder ? folder.name : "Notizbuch")}</span>`;
  const notes = notesOf(P.folderId);
  list.innerHTML = notes.length
    ? notes.map(n => pageItem("note", String(n.id), 1, n.name, "", null, { hasEntry: !!(n.plain_text || "").trim() })).join("")
    : `<div class="page-list-empty">Dieser Abschnitt hat noch keine Seiten.</div>`;
  wireList(list);
  const actions = document.getElementById("page-list-actions");
  actions.innerHTML = `
    <button type="button" class="btn btn-secondary btn-sm" id="pl-add-note">+ Seite</button>
    <button type="button" class="btn btn-secondary btn-sm" id="pl-add-folder" title="Unterabschnitt anlegen">+ Abschnitt</button>
    <label class="pl-color" title="Abschnittsfarbe"><input type="color" id="pl-color" value="${folder && folder.color ? escapeHtml(folder.color) : "#8aa8e4"}"></label>
    <button type="button" class="nb-icon-btn" id="pl-rename" title="Abschnitt umbenennen" aria-label="Abschnitt umbenennen">✎</button>
    <button type="button" class="nb-icon-btn nb-delete" id="pl-delete" title="Abschnitt löschen" aria-label="Abschnitt löschen">×</button>`;
  actions.querySelector("#pl-add-note").onclick = () => createNote(P.folderId);
  actions.querySelector("#pl-add-folder").onclick = () => createFolder(P.folderId);
  if (!folder) return;
  actions.querySelector("#pl-color").onchange = async (e) => {
    await api(`/api/notebooks/${folder.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color: e.target.value }) });
    folder.color = e.target.value;
    renderSections();
  };
  actions.querySelector("#pl-rename").onclick = async () => {
    const name = await promptDialog("Neuer Name des Abschnitts:", folder.name);
    if (!name || name === folder.name) return;
    await api(`/api/notebooks/${folder.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    folder.name = name;
    renderNotebookList();
    renderSections();
  };
  actions.querySelector("#pl-delete").onclick = async () => {
    const count = P.nodes.filter(n => n.parent_id === folder.id).length;
    if (!await confirmDelete(`Abschnitt „${folder.name}“${count ? ` samt ${count} enthaltenen Seiten/Abschnitten` : ""} wirklich löschen?`, count > 0)) return;
    await api(`/api/notebooks/${folder.id}`, { method: "DELETE" });
    await renderSections();
    await openPages({ type: "day", ref: todayIso() });
  };
}

function wireList(list) {
  list.querySelectorAll(".page-item").forEach(el => {
    el.onclick = () => openPages({ type: el.dataset.type, ref: el.dataset.ref });
  });
}

function markListActive() {
  const t = P.target;
  document.querySelectorAll("#page-list-items .page-item").forEach(el => {
    const on = !!t && el.dataset.type === t.type && el.dataset.ref === t.ref;
    el.classList.toggle("active", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
}

/* Nach dem Speichern: Titel/Markierungen der Liste nachziehen, ohne die
   Seite neu aufzubauen (der Editor bleibt samt Cursor stehen). */
let softTimer = null;
function softRefreshList() {
  clearTimeout(softTimer);
  softTimer = setTimeout(async () => {
    if (P.kind !== "diary" || !P.month) return;
    P.monthData = await api(withFilter(`/api/diary/${P.month.slice(0, 4)}/${Number(P.month.slice(5, 7))}`));
    renderDiaryList();
    markListActive();
  }, 300);
}

/* ---------- Seiten ---------- */

function findDay(day) {
  for (const w of P.monthData?.weeks || []) for (const d of w.days) if (d.date === day) return d;
  return null;
}
function findWeek(ref) { return (P.monthData?.weeks || []).find(w => w.ref === ref) || null; }

async function renderCanvas(t, keepScroll = false) {
  const canvas = document.getElementById("page-canvas");
  if (!canvas) return;
  await flushNotebookNote();
  const scroll = keepScroll ? canvas.scrollTop : 0;
  canvas.innerHTML = "";
  if (t.type === "day") await renderDayPage(canvas, t.ref);
  else if (t.type === "week") await renderWeekPage(canvas, t.ref);
  else if (t.type === "month" || t.type === "review") await renderMonthPage(canvas, t.type, t.ref);
  else if (t.type === "note") await renderNotePage(canvas, Number(t.ref));
  else renderEmptyFolder(canvas);
  canvas.scrollTop = scroll;
}

function pageHeadHtml(placeholder, metaHtml) {
  return `<header class="page-head">
      <input type="text" class="page-title-input" placeholder="${escapeHtml(placeholder)}" aria-label="Seitentitel">
      <div class="page-meta">${metaHtml}</div>
    </header>`;
}

async function renderDayPage(canvas, day) {
  canvas.appendChild(document.getElementById("tpl-page-day").content.cloneNode(true));
  const info = findDay(day);
  const d = parseDay(day);
  const long = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const meta = canvas.querySelector(".page-meta");
  const res = info ? fmtResult(info.stats) : { text: "" };
  const cum = info && info.cum ? fmtResult(info.cum) : { text: "" };
  meta.innerHTML = `<span>${escapeHtml(long)}</span>`
    + (res.text ? `<span class="page-res ${res.cls}">${res.text}</span>` : "")
    + (cum.text ? `<span class="page-cum" title="Monat bis hier">Monat ${cum.text}</span>` : "")
    + (info?.news || []).map(n => `<span class="pi-news" title="${escapeHtml(n.title)}">${escapeHtml(n.label)}</span>`).join("");
  const titleInput = canvas.querySelector(".page-title-input");
  const data = await populateDay(canvas, day, { journal: { defaultFor: "day", titleInput, onSaved: softRefreshList } });
  canvas.querySelector(".page-trades").hidden = !data.trades.length;
}

function statTiles(st, extra = []) {
  const res = fmtResult(st);
  const tiles = [
    ["Ergebnis", res.text || "–", res.cls],
    ["Netto", st.trades ? signed(st.net, 2) + " $" : "–", st.trades ? cls(st.net) : ""],
    ["R", st.r !== null && st.r !== undefined ? signed(st.r, 1) + "R" + (st.r_complete ? "" : "*") : "–", st.r ? cls(st.r) : ""],
    ["Trades", String(st.trades), ""],
    ...extra,
  ];
  return `<div class="page-tiles">${tiles.map(([l, v, c]) => `<div class="page-tile"><div class="label">${l}</div><div class="value ${c}">${v}</div></div>`).join("")}</div>`;
}

async function renderWeekPage(canvas, ref) {
  const w = findWeek(ref);
  const monday = isoWeekMonday(ref);
  const sunday = addDays(monday, 6);
  const wk = Number(ref.slice(6));
  const days = w ? w.days : [];
  const traded = days.filter(x => x.stats.trades);
  const winDays = traded.filter(x => x.stats.net > 0).length;
  canvas.innerHTML = `<section class="view onenote-page">
      ${pageHeadHtml("Seitentitel, z. B. RETRACEMENT", `<span>KW ${wk} · ${shortDate(isoDate(monday))} – ${shortDate(isoDate(sunday))}${sunday.getFullYear()}</span>`)}
      ${statTiles(w ? w.stats : { trades: 0, net: 0, points: 0, r: null }, [["Handelstage", String(traded.length), ""], ["Gewinntage", traded.length ? `${winDays}/${traded.length}` : "–", ""]])}
      <div class="page-day-rows">${days.map(x => `<button type="button" class="page-day-row" data-day="${x.date}">
          <span class="pdr-day">${x.weekday} ${shortDate(x.date)}</span>
          <span class="pdr-title">${escapeHtml(x.title || (x.stats.trades ? `${x.stats.trades} Trade${x.stats.trades === 1 ? "" : "s"}` : x.is_future ? "" : "Kein Trade"))}</span>
          ${resultHtml(x.stats)}
        </button>`).join("")}</div>
      <div class="journal-editor-host page-journal"></div>
    </section>`;
  canvas.querySelectorAll(".page-day-row").forEach(el => { el.onclick = () => openPages({ type: "day", ref: el.dataset.day }); });
  await mountJournalEditor(canvas.querySelector(".page-journal"), ref, {
    entryType: "week", imageDay: isoDate(monday), defaultFor: "week",
    titleInput: canvas.querySelector(".page-title-input"), onSaved: softRefreshList,
    placeholder: "Wie lief die Woche?",
  });
}

async function renderMonthPage(canvas, type, ref) {
  const d = P.monthData;
  const [y, m] = ref.split("-").map(Number);
  const weeks = d ? d.weeks : [];
  const tradedDays = weeks.flatMap(w => w.days).filter(x => x.stats.trades);
  const winDays = tradedDays.filter(x => x.stats.net > 0).length;
  const isReview = type === "review";
  canvas.innerHTML = `<section class="view onenote-page">
      ${pageHeadHtml(isReview ? "Review" : "Seitentitel, z. B. Bester LOC-Monat!", `<span>${isReview ? "Review · " : "Monatsziel · "}${escapeHtml(monthLabel(y, m))}</span>`)}
      ${statTiles(d ? d.stats : { trades: 0, net: 0, points: 0, r: null }, [["Handelstage", String(tradedDays.length), ""], ["Gewinntage", tradedDays.length ? `${winDays}/${tradedDays.length}` : "–", ""]])}
      <div class="page-day-rows">${weeks.map(w => `<button type="button" class="page-day-row" data-week="${w.ref}">
          <span class="pdr-day">KW ${w.iso_week}</span>
          <span class="pdr-title">${escapeHtml(w.title || `${shortDate(w.monday)} – ${shortDate(w.sunday)}`)}</span>
          ${resultHtml(w.stats)}
        </button>`).join("")}</div>
      <div class="journal-editor-host page-journal"></div>
    </section>`;
  canvas.querySelectorAll(".page-day-row").forEach(el => { el.onclick = () => openPages({ type: "week", ref: el.dataset.week }); });
  await mountJournalEditor(canvas.querySelector(".page-journal"), ref, {
    entryType: type, imageDay: `${ref}-01`, defaultFor: type,
    titleInput: canvas.querySelector(".page-title-input"), onSaved: softRefreshList,
    placeholder: isReview ? "Was nimmst du aus diesem Monat mit?" : "Was ist dein Ziel für diesen Monat?",
  });
}

async function renderNotePage(canvas, id) {
  canvas.innerHTML = `<section class="view onenote-page onenote-note"><div class="notebook-editor-host" id="page-note-host"></div></section>`;
  await mountNotebookEditor(canvas.querySelector("#page-note-host"), id, {
    onSaved: ({ id: nid, name }) => {
      const node = P.nodes.find(n => n.id === nid);
      if (node) node.name = name;
      const el = document.querySelector(`#page-list-items .page-item[data-type="note"][data-ref="${nid}"] .pi-name`);
      if (el) el.textContent = name;
    },
    onDelete: async (node) => {
      if (!await confirmDelete(`Seite „${node.name}“ wirklich löschen?`, false)) return;
      await api(`/api/notebooks/${node.id}`, { method: "DELETE" });
      await openPages({ type: "folder", ref: String(node.parent_id ?? "") }, { reload: true });
    },
  });
}

function renderEmptyFolder(canvas) {
  canvas.innerHTML = `<section class="view onenote-page"><div class="page-empty">
      <p>Dieser Abschnitt ist noch leer.</p>
      <button type="button" class="btn btn-primary" id="page-empty-add">Erste Seite anlegen</button>
    </div></section>`;
  canvas.querySelector("#page-empty-add").onclick = () => createNote(P.folderId);
}

/* ---------- Anlegen ---------- */

async function createFolder(parentId) {
  const name = await promptDialog("Name des neuen Abschnitts:", "Neuer Abschnitt");
  if (!name) return;
  const { node } = await api("/api/notebooks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId, node_type: "folder", name }),
  });
  if (parentId) { expanded.add(`f${parentId}`); writeStored("sectionsExpanded", [...expanded]); }
  await renderSections();
  await openPages({ type: "folder", ref: String(node.id) }, { reload: true });
}

async function createNote(folderId) {
  const { node } = await api("/api/notebooks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: folderId, node_type: "note", name: "Neue Seite" }),
  });
  await openPages({ type: "note", ref: String(node.id) }, { reload: true });
  const title = document.getElementById("notebook-note-title");
  if (title) { title.focus(); title.select(); }
}

/* ---------- Tastatur: Strg+Bild auf/ab blaettert wie in OneNote ---------- */

document.addEventListener("keydown", (e) => {
  if (state.view !== "pages" || !e.ctrlKey || (e.key !== "PageDown" && e.key !== "PageUp")) return;
  const items = [...document.querySelectorAll("#page-list-items .page-item")];
  const idx = items.findIndex(el => el.classList.contains("active"));
  const next = items[idx + (e.key === "PageDown" ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.click();
});

// Link oder Zurueck-Taste auf eine Seiten-Adresse (#tag/..., #notiz/...)
window.addEventListener("hashchange", () => {
  const t = parseHash();
  if (t && !(P.target && P.target.type === t.type && P.target.ref === t.ref)) openPages(t);
});

document.addEventListener("pages:changed", () => {
  renderSections();
  if (state.view === "pages") refreshPages();
});
