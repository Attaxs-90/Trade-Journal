/* Tag-Chips und das Tag-Popover der Tagesansicht. */

import { api, escapeHtml, safeColor, tagTextColor } from './core.js';
import { getTags } from './filters.js';
import { currentZoom } from './images.js';

/* ---------- Tag-Chips & Popover (Tagesansicht) ---------- */

/* Tag-Farben landen direkt in einem style="background:..."-Attribut. Der Server
   laesst seit der Hex-Pruefung in TagCreate nichts anderes mehr durch, aber
   Bestands-Datenbanken koennen noch aeltere Werte enthalten - deshalb hier
   zusaetzlich pruefen statt dem gespeicherten Wert zu vertrauen. Alles, was
   keine Hex-Farbe ist, faellt auf die Standardfarbe zurueck. */
export function tagChipHtml(tag) {
  const groupHtml = tag.tag_group ? `<span class="tag-chip-group">${escapeHtml(tag.tag_group)}</span>` : "";
  const title = tag.tag_group ? `${escapeHtml(tag.tag_group)} - ${escapeHtml(tag.name)}` : escapeHtml(tag.name);
  return `<span class="tag-chip" style="background:${safeColor(tag.color)};color:${tagTextColor(safeColor(tag.color))}" title="${title}">${groupHtml}${escapeHtml(tag.name)}</span>`;
}

export function renderTradeTagCell(cell, trade) {
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
        <span class="tag-color-dot" style="background:${safeColor(t.color)}"></span>${escapeHtml(t.name)}
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
  const zoom = currentZoom();
  popover.style.top = `${(rect.bottom + 4) / zoom}px`;
  popover.style.left = `${rect.left / zoom}px`;
  requestAnimationFrame(() => {
    const pRect = popover.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) popover.style.left = `${Math.max(8, window.innerWidth - pRect.width - 8) / zoom}px`;
    if (pRect.bottom > window.innerHeight - 8) popover.style.top = `${Math.max(8, rect.top - pRect.height - 4) / zoom}px`;
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
