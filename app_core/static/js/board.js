/* Frei anordenbares Raster fuer Ansichten (Uebersicht, Monat, Konten, Export,
   Einstellungen) - nach dem Muster klassischer Dashboard-Raster:

   - 24 Spalten, feste Zeilenhoehe (ROW px). Jeder Block hat eine absolute
     Position {x, y, w, h} in Rasterzellen und BLEIBT dort, wo er losgelassen
     wird. Es gibt kein automatisches Nachrutschen oder Zusammenschieben.
   - Nur Kollisionen bewegen andere Bloecke: wer ueberdeckt wird, rutscht
     minimal nach unten und kehrt zurueck, sobald der Platz wieder frei ist
     (die Vorschau rechnet immer vom Stand zu Beginn des Ziehens aus).
   - Hoehe: h = null heisst "wie der Inhalt" (Karten mit wechselndem Inhalt);
     wer die Hoehe zieht, legt sie fest (Doppelklick auf die untere Kante = wieder auto).
   - Bedienung nur im Layout-Modus (Knopf im Seitenkopf): ganzer Block ist
     greifbar, Kanten/Ecke ziehen die Groesse. Pfeiltasten verschieben,
     Umschalt+Pfeile aendern die Groesse - Ziehen ist nie der einzige Weg.
   - Gespeichert wird je Ansicht in localStorage; Bloecke ohne Eintrag (neu)
     fliessen mit Standardbreite hinter die platzierten. */

import { writeStored } from './core.js';

const COLS = 24;
const ROW = 20;      // Zeilenhoehe in px; muss zu .board (grid-auto-rows) und .board-block (padding-bottom) passen
const MIN_H = 3;

/* Je Ansicht: Speicher-Key und Standardbreiten. Einzelne Bloecke koennen per
   data-w / data-min / data-h (feste Hoehe in Zeilen) abweichen. */
export const BOARD_VIEWS = {
  "tpl-overview": { key: "overview", defaultW: 24, minW: 8 },
  "tpl-month": { key: "month", defaultW: 24, minW: 12 },
  "tpl-accounts": { key: "accounts", defaultW: 12, minW: 8 },
  "tpl-export": { key: "export", defaultW: 12, minW: 8 },
  "tpl-settings": { key: "settings", defaultW: 12, minW: 8 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function readSaved(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function blockTitle(block) {
  const t = block.querySelector(".card-title, .settings-card-title, .label, h2, h3");
  return (t ? t.textContent : block.dataset.block).trim().slice(0, 50);
}

export function mountBoard(section, viewKey, { defaultW = 24, minW = 8, board = null } = {}) {
  const storageKey = "boardLayout3:" + viewKey;
  const header = section.querySelector(".view-header");
  if (!board) {
    board = document.createElement("div");
    board.className = "board";
    [...section.children].filter(el => el !== header && !el.classList.contains("view-header")).forEach(el => board.appendChild(el));
    section.appendChild(board);
  }
  board.classList.add("board");
  section.classList.add("has-board");

  const ctrl = { board, saved: readSaved(storageKey), lay: {}, editing: false, busy: false };
  board._board = ctrl;
  let autoKey = 0;
  const ro = new ResizeObserver(() => { if (!ctrl.busy) apply(false); });

  /* Neue (noch nicht umhuellte) Kinder in Bloecke packen. */
  function adopt() {
    [...board.children].forEach(child => {
      if (child.classList.contains("board-block")) return;
      const block = document.createElement("div");
      block.className = "board-block";
      block.dataset.block = child.dataset.block || child.dataset.settingsCard || child.id || "b" + (autoKey++);
      block.dataset.w = child.dataset.w || defaultW;
      block.dataset.min = child.dataset.min || minW;
      if (child.dataset.h) block.dataset.h = child.dataset.h;
      block.hidden = child.hidden;
      board.insertBefore(block, child);
      child.classList.add("board-content");
      block.appendChild(child);
      // Wechselt ein Kind spaeter per hidden-Attribut (leere Hinweise,
      // Prop-Limits), folgt der Block.
      new MutationObserver(() => { block.hidden = child.hidden; apply(false); })
        .observe(child, { attributes: true, attributeFilter: ["hidden"] });
      ro.observe(child);
      const title = blockTitle(block);
      const overlay = document.createElement("div");
      overlay.className = "board-overlay";
      overlay.tabIndex = 0;
      overlay.setAttribute("role", "group");
      overlay.setAttribute("aria-label", `„${title}“ – Pfeiltasten verschieben, Umschalt plus Pfeiltasten Größe ändern`);
      overlay.innerHTML = `<span class="board-chip"></span>`;
      block.appendChild(overlay);
      [["e", "Breite ändern (Ziehen)"], ["s", "Höhe ändern (Ziehen, Doppelklick: automatisch)"], ["se", "Größe ändern (Ziehen)"]].forEach(([edge, tip]) => {
        const h = document.createElement("div");
        h.className = "board-resize board-resize-" + edge;
        h.dataset.edge = edge;
        h.title = tip;
        block.appendChild(h);
      });
    });
  }

  const blocks = () => [...board.querySelectorAll(":scope > .board-block")].filter(b => !b.hidden);
  const numAttr = (b, name, def) => { const n = Math.round(Number(b.dataset[name])); return Number.isFinite(n) && n > 0 ? n : def; };
  const minWOf = b => clamp(numAttr(b, "min", minW), 1, COLS);
  const wDefOf = b => clamp(numAttr(b, "w", defaultW), 1, COLS);
  const blockByKey = key => board.querySelector(`:scope > .board-block[data-block="${CSS.escape(key)}"]`);

  /* Layout berechnen. source: key -> {x,y,w,h|null}; Bloecke ohne Eintrag fliessen
     nach. fixedKey (waehrend Ziehen) behaelt seinen Platz, alle anderen weichen aus. */
  function compute(source, fixedKey) {
    const items = [], loose = [];
    const list = blocks();
    list.forEach(b => {
      const key = b.dataset.block, s = source[key];
      const w = clamp(Math.round(Number(s && s.w)) || wDefOf(b), minWOf(b), COLS);
      const fixedH = s ? (s.h == null ? null : Math.max(MIN_H, Math.round(Number(s.h)) || MIN_H)) : (numAttr(b, "h", 0) || null);
      b.classList.toggle("board-fixed", fixedH != null);
      // Auto-Hoehe: Block ist am oberen Rand ausgerichtet, offsetHeight = Inhalt + Abstand.
      const h = fixedH != null ? fixedH : Math.max(MIN_H, Math.ceil(b.offsetHeight / ROW));
      const item = { key, w, h, auto: fixedH == null };
      if (s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))) {
        item.x = clamp(Math.round(Number(s.x)), 0, COLS - w);
        item.y = Math.max(0, Math.round(Number(s.y)));
        items.push(item);
      } else {
        loose.push(item);
      }
    });
    // Kollisionen aufloesen: der Festgehaltene (falls vorhanden) und alles Weitere
    // in Leserichtung; nur wer ueberdeckt wird, rutscht unter den Verursacher.
    items.sort((a, b) => (a.key === fixedKey ? -1 : b.key === fixedKey ? 1 : a.y - b.y || a.x - b.x));
    const placed = [];
    items.forEach(it => {
      let hit;
      while ((hit = placed.find(p => overlaps(it, p)))) it.y = hit.y + hit.h;
      placed.push(it);
    });
    // Neue Bloecke: Regalweise von links nach rechts hinter den bestehenden.
    let shelfY = Math.max(0, ...placed.map(p => p.y + p.h)), x = 0, shelfH = 0;
    loose.forEach(it => {
      if (x + it.w > COLS) { shelfY += shelfH; x = 0; shelfH = 0; }
      it.x = x; it.y = shelfY;
      x += it.w; shelfH = Math.max(shelfH, it.h);
      placed.push(it);
    });
    const lay = {};
    placed.forEach(it => { lay[it.key] = it; });
    return lay;
  }

  /* Berechnetes Layout -> speicherbares Format (auto-Hoehe bleibt null). */
  const toSource = lay => Object.fromEntries(Object.values(lay).map(it => [it.key, { x: it.x, y: it.y, w: it.w, h: it.auto ? null : it.h }]));

  function paint(lay) {
    ctrl.lay = lay;
    let bottom = 0;
    blocks().forEach(b => {
      const it = lay[b.dataset.block];
      b.style.gridColumn = `${it.x + 1} / span ${it.w}`;
      b.style.gridRow = `${it.y + 1} / span ${it.h}`;
      bottom = Math.max(bottom, it.y + it.h);
      if (ctrl.editing) b.querySelector(".board-chip").textContent = `${blockTitle(b)} · ${it.w} × ${it.auto ? "auto" : it.h}`;
    });
    // Im Layout-Modus Platz unter dem letzten Block zum Ablegen lassen.
    board.style.minHeight = ctrl.editing || ctrl.busy ? (bottom + 12) * ROW + "px" : "";
  }

  function apply(persist) {
    adopt();
    const lay = compute(ctrl.saved);
    paint(lay);
    if (persist) commit(lay);
    board.dispatchEvent(new CustomEvent("boardlayout"));
  }
  function commit(lay) {
    ctrl.saved = { ...ctrl.saved, ...toSource(lay) };
    writeStored(storageKey, ctrl.saved);
  }
  ctrl.refresh = () => apply(false);

  function metrics() {
    const rect = board.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    return { gap, colW: (rect.width - gap * (COLS - 1)) / COLS };
  }

  /* Ziehen (Verschieben oder Groesse). Vorschau aus dem Stand bei Beginn, damit
     nichts "mitwandert": verlaesst der Block eine Stelle, springen die ausgewichenen
     Nachbarn zurueck. */
  function startDrag(block, e, mode, target) {
    e.preventDefault();
    try { target.setPointerCapture(e.pointerId); } catch (err) { /* synthetische Events */ }
    const key = block.dataset.block;
    const start = ctrl.lay[key];
    const base = toSource(ctrl.lay);
    const m = metrics();
    const cell = m.colW + m.gap;
    const x0 = e.clientX, y0 = e.clientY;
    let last = null;
    ctrl.busy = true;
    block.classList.add("board-moving");
    board.classList.add("board-dragging");
    const onMove = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let nx = start.x, ny = start.y, nw = start.w, nh = start.h, fixed = !start.auto;
      if (mode === "move") {
        nx = clamp(start.x + Math.round(dx / cell), 0, COLS - start.w);
        ny = Math.max(0, start.y + Math.round(dy / ROW));
      } else {
        if (mode.includes("e")) nw = clamp(Math.round((start.w * cell - m.gap + dx + m.gap) / cell), minWOf(block), COLS - start.x);
        if (mode.includes("s")) { nh = Math.max(MIN_H, Math.round((start.h * ROW + dy) / ROW)); fixed = true; }
      }
      last = { x: nx, y: ny, w: nw, h: fixed ? nh : null };
      paint(compute({ ...base, [key]: last }, key));
    };
    const finish = (keep) => {
      const el = target;
      el.onpointermove = el.onpointerup = el.onpointercancel = null;
      block.classList.remove("board-moving");
      board.classList.remove("board-dragging");
      ctrl.busy = false;
      if (keep && last) {
        const lay = compute({ ...base, [key]: last }, key);
        paint(lay);
        commit(lay);
      } else {
        apply(false);
      }
      board.dispatchEvent(new CustomEvent("boardlayout"));
    };
    target.onpointermove = onMove;
    target.onpointerup = () => finish(true);
    target.onpointercancel = () => finish(false);
  }

  board.addEventListener("pointerdown", (e) => {
    if (!ctrl.editing || e.button !== 0) return;
    const handle = e.target.closest(".board-resize"), overlay = e.target.closest(".board-overlay");
    if (!handle && !overlay) return;
    startDrag((handle || overlay).closest(".board-block"), e, handle ? handle.dataset.edge : "move", handle || overlay);
  });
  board.addEventListener("dblclick", (e) => {
    const handle = e.target.closest(".board-resize");
    if (!ctrl.editing || !handle || !handle.dataset.edge.includes("s")) return;
    const key = handle.closest(".board-block").dataset.block;
    ctrl.saved = { ...ctrl.saved, ...toSource(ctrl.lay), [key]: { ...toSource(ctrl.lay)[key], h: null } };
    apply(true);
  });

  /* Tastatur: Pfeile verschieben um eine Zelle, Umschalt+Pfeile aendern die Groesse. */
  board.addEventListener("keydown", (e) => {
    const overlay = e.target.closest(".board-overlay");
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = arrows[e.key];
    if (!ctrl.editing || !overlay || !d) return;
    e.preventDefault();
    const block = overlay.closest(".board-block"), key = block.dataset.block;
    const it = ctrl.lay[key], base = toSource(ctrl.lay);
    const next = { x: it.x, y: it.y, w: it.w, h: it.auto ? null : it.h };
    if (e.shiftKey) {
      next.w = clamp(it.w + d[0], minWOf(block), COLS - it.x);
      if (d[1]) next.h = Math.max(MIN_H, it.h + d[1]);
    } else {
      next.x = clamp(it.x + d[0], 0, COLS - it.w);
      next.y = Math.max(0, it.y + d[1]);
    }
    const lay = compute({ ...base, [key]: next }, key);
    paint(lay);
    commit(lay);
    overlay.focus();
  });

  /* Lueckenschliessen: jeden Block so weit nach oben, bis er anstoesst. */
  function compact() {
    const items = Object.values(ctrl.lay).map(it => ({ ...it })).sort((a, b) => a.y - b.y || a.x - b.x);
    const placed = [];
    items.forEach(it => {
      const orig = it.y;
      for (let y = 0; y <= orig; y++) {
        it.y = y;
        if (!placed.some(p => overlaps(it, p))) break;
      }
      placed.push(it);
    });
    const lay = {};
    placed.forEach(it => { lay[it.key] = it; });
    paint(lay);
    commit(lay);
  }

  /* Layout-Modus, Aufraeumen und Zuruecksetzen im Seitenkopf. */
  const tools = document.createElement("div");
  tools.className = "board-tools";
  tools.innerHTML = `<span class="board-hint" hidden>Block greifen &amp; ziehen · Kanten ziehen = Größe · Pfeiltasten (Umschalt = Größe)</span>
    <button type="button" class="btn btn-secondary board-compact-btn" hidden title="Alle Blöcke nach oben rücken, Lücken schließen">Lücken schließen</button>
    <button type="button" class="btn btn-secondary board-reset-btn" hidden title="Standard-Anordnung wiederherstellen">Zurücksetzen</button>
    <button type="button" class="btn btn-secondary board-edit-btn" aria-pressed="false" title="Blöcke anordnen und in der Größe einstellen">Layout anpassen</button>`;
  const editBtn = tools.querySelector(".board-edit-btn");
  const editOnly = tools.querySelectorAll(".board-hint, .board-compact-btn, .board-reset-btn");
  editBtn.addEventListener("click", () => {
    ctrl.editing = !ctrl.editing;
    board.classList.toggle("board-editing", ctrl.editing);
    editBtn.setAttribute("aria-pressed", String(ctrl.editing));
    editBtn.textContent = ctrl.editing ? "Fertig" : "Layout anpassen";
    editBtn.classList.toggle("btn-primary", ctrl.editing);
    editBtn.classList.toggle("btn-secondary", !ctrl.editing);
    editOnly.forEach(el => { el.hidden = !ctrl.editing; });
    apply(false);
  });
  tools.querySelector(".board-compact-btn").addEventListener("click", compact);
  tools.querySelector(".board-reset-btn").addEventListener("click", () => {
    ctrl.saved = {};
    writeStored(storageKey, {});
    apply(false);
  });
  (section.querySelector(".view-header-right") || header)?.appendChild(tools);

  apply(false);
  return ctrl;
}

/* Von aussen nach dem Einfuegen/Entfernen von Bloecken (z.B. Uebersichts-Kacheln). */
export function refreshBoard(board) {
  board?._board?.refresh();
}
