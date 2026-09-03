/* Journal: Editor (Quill), Journal-Seite, Jahr/Monat-Uebersicht, Suche. */

import { monthLabel, openJournalModal } from './calendar.js';
import { JOURNAL_AUTOSAVE_MS, JOURNAL_FONTS, JOURNAL_SIZES, api, cls, escapeHtml, fmtDate, fmtSigned, state, tile } from './core.js';
import { confirmDelete } from './dialogs.js';
import { buildTagChipGroups, getTags } from './filters.js';
import { activeNotebookNote, clearNbDrag, nbDrag, notebookCreateDirect, notebookMoveTo, renderNotebookSearchResults, renderNotebookTree, saveNotebookNote, switchJournalTab } from './notebooks.js';
import { mountView, setActiveNav } from './overview.js';
import { tagChipHtml } from './tags.js';

/* ---------- Journal ----------
   Ein Eintrag haengt am Datum, nicht am Trade: ein Handelstag kann einen
   Eintrag haben, ein Eintrag braucht keinen Trade. Derselbe Editor wird an
   zwei Stellen eingehaengt (Journal-Seite und Karte im Tagesview) - deshalb
   eine mountJournalEditor()-Funktion statt zweier Implementierungen. */

let quillReady = false;

/* Schrift- und Groessenauswahl als Style-Attributoren registrieren: das
   gespeicherte HTML traegt die Formatierung dann als inline style und bleibt
   auch ohne Quill-CSS lesbar (wichtig, weil wir das HTML selbst speichern). */

export function initQuillFormats() {
  if (quillReady) return;
  const Font = Quill.import("attributors/style/font");
  Font.whitelist = JOURNAL_FONTS;
  const Size = Quill.import("attributors/style/size");
  Size.whitelist = JOURNAL_SIZES;
  Quill.register(Font, true);
  Quill.register(Size, true);
  quillReady = true;
}

export const JOURNAL_TOOLBAR = [
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

/* Nur ein Editor ist gleichzeitig sichtbar (Journal-Seite ODER Tagesview).
   activeJournal haelt ihn fest, damit beim Seitenwechsel, beim Schliessen des
   Modals und beim Verlassen der Seite noch ungespeicherte Aenderungen
   rausgeschrieben werden koennen. */
export let activeJournal = null;

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

export async function saveJournal(force = false) {
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
export async function flushJournal() {
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
export async function mountJournalEditor(host, refKey, opts = {}) {
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
export async function getJournalTemplates(force = false) {
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

export async function renderJournalList() {
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

  const { entries, truncated } = await api(journalListQS());
  listEl.innerHTML = scope === "both" ? `<div class="newsbar-filter-group-title journal-list-section-label">Journal</div>` : "";
  if (!entries.length) {
    listEl.innerHTML += `<div class="empty-state">Keine Einträge für diese Auswahl.</div>`;
    return;
  }
  // Der Server deckelt die Liste. Ohne diesen Hinweis sah eine abgeschnittene
  // Suche wie ein vollstaendiges Ergebnis aus.
  if (truncated) {
    listEl.innerHTML += `<div class="journal-list-truncated-hint">Nur die ${entries.length} neuesten Einträge werden angezeigt. Grenze den Zeitraum oder die Suche ein, um ältere zu sehen.</div>`;
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

export async function openJournal() {
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
    clearNbDrag();
    await notebookMoveTo(draggedId, null);
  });

  await switchJournalTab(state.journalTab, true);
}
/* Setter statt direkter Zuweisung von aussen: ein per import geholtes let laesst
   sich im importierenden Modul nicht zuweisen (ES-Modul-Bindings sind dort
   schreibgeschuetzt). mountView() und die Tages-Modals brauchen genau das. */
export function clearActiveJournal() { activeJournal = null; }
