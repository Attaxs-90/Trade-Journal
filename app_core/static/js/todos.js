/* To-Do-Listen (Verwaltung im Journal, Anzeige in der Newsbar). */

import { api, state } from './core.js';
import { confirmDelete, promptDialog } from './dialogs.js';
import { mountView, setActiveNav } from './overview.js';

/* ---------- To-Do-Listen ----------
   Angelegt/verwaltet im Journal-Tab "To-Do-Listen" (Liste anlegen, Eintraege
   hinzufuegen, umbenennen, sichtbar schalten, endgueltig loeschen). Das
   rechte Menue (Newsbar) zeigt nur die als "visible" markierten Listen rein
   lesend zum Abhaken - Klick auf den Text togglet done, ohne dass der
   Eintrag verschwindet (siehe update_todo_item in db.py). Nach jeder
   Aenderung wird beides neu geladen statt optimistisch aktualisiert, gleiches
   Vorgehen wie beim Notizbuch (z.B. notebookRenameFlow -> renderNotebookTree). */

async function refreshTodoUI() {
  await loadTodoWidget();
  if (state.view === "todos") await renderTodoManagePanel();
}

export async function openTodos() {
  state.view = "todos";
  state.currentDay = null;
  setActiveNav("todos");
  await mountView("tpl-todos");
  document.getElementById("todo-add-list-btn").addEventListener("click", () => todoListCreateFlow());
  await renderTodoManagePanel();
}

export async function loadTodoWidget() {
  const section = document.getElementById("todo-widget-section");
  const container = document.getElementById("todo-widget-lists");
  if (!section || !container) return;
  let lists;
  try {
    ({ lists } = await api("/api/todo-lists"));
  } catch (e) {
    return;
  }
  const visible = lists.filter(l => l.visible);
  section.hidden = visible.length === 0;
  container.innerHTML = "";
  if (!visible.length) return;
  for (const list of visible) {
    const group = document.createElement("div");
    group.className = "todo-widget-group";
    const title = document.createElement("div");
    title.className = "todo-widget-group-title";
    title.textContent = list.name;
    title.title = list.name;
    group.appendChild(title);
    const itemsEl = document.createElement("div");
    itemsEl.className = "todo-widget-items";
    if (!list.items.length) {
      itemsEl.innerHTML = `<div class="todo-widget-empty">Keine Einträge.</div>`;
    } else {
      for (const item of list.items) itemsEl.appendChild(todoWidgetItemEl(item));
    }
    group.appendChild(itemsEl);
    container.appendChild(group);
  }
}

function todoWidgetItemEl(item) {
  const row = document.createElement("div");
  row.className = "todo-item" + (item.done ? " done" : "");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.title = "Klicken zum Abhaken";
  const text = document.createElement("span");
  text.className = "todo-item-text";
  text.textContent = item.text;
  row.appendChild(text);
  row.addEventListener("click", () => toggleTodoItemDone(item));
  row.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    row.click();
  });
  return row;
}

async function toggleTodoItemDone(item) {
  await api(`/api/todo-items/${item.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: !item.done }),
  });
  await refreshTodoUI();
}

async function renderTodoManagePanel() {
  const container = document.getElementById("todo-manage-lists");
  const emptyEl = document.getElementById("todo-manage-empty");
  if (!container) return;
  const { lists } = await api("/api/todo-lists");
  container.innerHTML = "";
  emptyEl.hidden = lists.length > 0;
  for (const list of lists) container.appendChild(todoManageCardEl(list));
}

function todoManageCardEl(list) {
  const card = document.createElement("div");
  card.className = "todo-manage-card";

  const header = document.createElement("div");
  header.className = "todo-manage-card-header";

  const name = document.createElement("button");
  name.type = "button";
  name.className = "todo-manage-card-name";
  name.textContent = list.name;
  name.title = "Klicken zum Umbenennen";
  name.addEventListener("click", () => todoListRenameFlow(list));
  header.appendChild(name);

  const visibleLabel = document.createElement("label");
  visibleLabel.className = "todo-visible-toggle";
  visibleLabel.innerHTML = `
    <span class="todo-switch">
      <input type="checkbox" ${list.visible ? "checked" : ""}>
      <span class="todo-switch-track"></span>
    </span>
    <span>Rechtes Menü</span>`;
  visibleLabel.querySelector("input").addEventListener("change", (e) => todoListSetVisible(list.id, e.target.checked));
  header.appendChild(visibleLabel);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nb-icon-btn nb-delete";
  delBtn.textContent = "×";
  delBtn.setAttribute("aria-label", "Liste löschen");
  delBtn.addEventListener("click", () => todoListDeleteFlow(list));
  header.appendChild(delBtn);

  card.appendChild(header);

  const addRow = document.createElement("form");
  addRow.className = "todo-manage-add-row";
  addRow.innerHTML = `<input type="text" placeholder="Neuer Eintrag…" autocomplete="off">
    <button type="submit" class="btn btn-secondary">+ Eintrag</button>`;
  addRow.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = addRow.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await api(`/api/todo-lists/${list.id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await refreshTodoUI();
    } finally {
      input.disabled = false;
    }
  });
  card.appendChild(addRow);

  const itemsEl = document.createElement("div");
  itemsEl.className = "todo-manage-items";
  if (!list.items.length) {
    itemsEl.innerHTML = `<div class="empty-state todo-manage-items-empty">Noch keine Einträge.</div>`;
  } else {
    for (const item of list.items) itemsEl.appendChild(todoManageItemEl(item));
  }
  card.appendChild(itemsEl);

  return card;
}

function todoManageItemEl(item) {
  const row = document.createElement("div");
  row.className = "todo-manage-item" + (item.done ? " done" : "");

  const text = document.createElement("span");
  text.className = "todo-manage-item-text";
  text.textContent = item.text;
  text.title = "Klicken zum Abhaken";
  text.addEventListener("click", () => toggleTodoItemDone(item));
  row.appendChild(text);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "nb-icon-btn nb-delete todo-manage-item-delete";
  delBtn.textContent = "×";
  delBtn.setAttribute("aria-label", "Eintrag endgültig löschen");
  delBtn.addEventListener("click", () => todoItemDeleteFlow(item));
  row.appendChild(delBtn);

  return row;
}

async function todoListCreateFlow() {
  const name = await promptDialog("Name der neuen To-Do-Liste:", "Neue Liste");
  if (!name) return;
  await api("/api/todo-lists", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshTodoUI();
}

async function todoListRenameFlow(list) {
  const name = await promptDialog("Neuer Name der Liste:", list.name);
  if (!name || name === list.name) return;
  await api(`/api/todo-lists/${list.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshTodoUI();
}

async function todoListSetVisible(listId, visible) {
  await api(`/api/todo-lists/${listId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible }),
  });
  await refreshTodoUI();
}

async function todoListDeleteFlow(list) {
  if (!await confirmDelete(`Soll die To-Do-Liste "${list.name}" samt allen Einträgen wirklich gelöscht werden?`)) return;
  await api(`/api/todo-lists/${list.id}`, { method: "DELETE" });
  await refreshTodoUI();
}

async function todoItemDeleteFlow(item) {
  if (!await confirmDelete(`Eintrag "${item.text}" endgültig löschen?`, false)) return;
  await api(`/api/todo-items/${item.id}`, { method: "DELETE" });
  await refreshTodoUI();
}
