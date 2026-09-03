/* Notizbuecher: frei verschachtelbare Ordner und Notizen. */

import { shortenLabel } from './analytics.js';
import { setModalOnClose } from './calendar.js';
import { JOURNAL_AUTOSAVE_MS, JOURNAL_FONTS, JOURNAL_SIZES, api, attachOutsideClose, escapeHtml, state } from './core.js';
import { confirmDelete, promptDialog } from './dialogs.js';
import { initQuillFormats, mountJournalEditor, renderJournalList } from './journal.js';

/* ---------- Notizbuecher: frei verschachtelbare Ordner/Notizen ----------
   Zweiter Bereich neben dem Tages-Tagebuch, fuer Inhalte ohne Kalenderbezug
   (Strategie, Beobachtungen, Unterlagen, Logins, ...). Ordner koennen beliebig
   tief verschachtelt und jederzeit unter einen anderen Ordner verschoben
   werden (siehe move_notebook_node in db.py fuer die Zyklus-Pruefung). */

const NB_ICON_FOLDER = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`;
const NB_ICON_NOTE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/></svg>`;
const NB_ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;

export async function switchJournalTab(tab, force = false) {
  if (!force && state.journalTab === tab) return;
  await flushNotebookNote();
  state.journalTab = tab;
  document.querySelectorAll(".journal-view-tab").forEach(t => t.classList.toggle("active", t.dataset.journalTab === tab));
  document.getElementById("journal-diary-panel").hidden = tab !== "diary";
  document.getElementById("notebook-panel").hidden = tab !== "notebooks";
  if (tab === "notebooks") await renderNotebookTree();
}

export function loadNotebookExpandedState() {
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
export async function renderNotebookSearchResults(container, withLabel) {
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
  setModalOnClose(() => { if (state.view === "journal") renderJournalList(); });
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

export async function renderNotebookTree() {
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
export let nbDrag = null;

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

export async function notebookMoveTo(draggedId, targetParentId) {
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

export async function notebookCreateDirect(parentId, nodeType) {
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

export let activeNotebookNote = null;

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

export async function saveNotebookNote(force = false) {
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

export async function flushNotebookNote() {
  if (activeNotebookNote && activeNotebookNote.dirty) await saveNotebookNote();
}
/* siehe clearActiveJournal() in journal.js - gleiche Begruendung. */
export function clearActiveNotebookNote() { activeNotebookNote = null; }
export function clearNbDrag() { nbDrag = null; }
