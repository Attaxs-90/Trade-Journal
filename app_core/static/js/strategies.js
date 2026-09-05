/* Strategien: Verwaltung (anlegen, umbenennen, archivieren, loeschen), Regeln in
   optionalen Gruppen und die Einhaltungs-Statistik je Regel.

   Eine Strategie buendelt Regeln; ein Trade hat hoechstens eine Strategie und
   kann je Regel "befolgt"/"nicht befolgt" tragen. Regeln ohne Antwort fallen
   aus jeder Quote heraus - das deckt zugleich "Regel hier nicht anwendbar" ab
   (siehe trade_rule_status in db.py). */

import { api, escapeHtml, fmtSigned, makeSortable, state } from './core.js';
import { confirmContinue, confirmDelete, promptDialog } from './dialogs.js';
import { mountView, setActiveNav } from './overview.js';

let strategiesCache = null;
let selectedStrategyId = null;
let showArchived = false;

export function invalidateStrategiesCache() { strategiesCache = null; }

/* Die Strategie-Auswahl brauchen auch Trade-Seite, Tagesansicht und die
   Sammelbearbeitung - deshalb hier gecacht statt an vier Stellen neu geladen. */
export async function getStrategies(force = false) {
  if (force || !strategiesCache) strategiesCache = (await api("/api/strategies")).strategies;
  return strategiesCache;
}

export async function openStrategy() {
  state.view = "strategy";
  state.currentDay = null;
  setActiveNav("strategy");
  await mountView("tpl-strategy");

  const archivedToggle = document.getElementById("strategy-show-archived");
  archivedToggle.checked = showArchived;
  archivedToggle.addEventListener("change", async () => {
    showArchived = archivedToggle.checked;
    await renderStrategyList();
  });
  document.getElementById("strategy-add-btn").addEventListener("click", addStrategy);
  await renderStrategyList();
}

async function addStrategy() {
  const name = await promptDialog("Name der neuen Strategie:", "");
  if (!name) return;
  const { strategy } = await api("/api/strategies", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  invalidateStrategiesCache();
  selectedStrategyId = strategy.id;
  await renderStrategyList();
}

/* ---------- Linke Spalte: Liste der Strategien ---------- */

async function renderStrategyList() {
  const listEl = document.getElementById("strategy-list");
  if (!listEl) return;
  const strategies = (await api(`/api/strategies?include_archived=${showArchived}`)).strategies;
  strategiesCache = showArchived ? strategiesCache : strategies;

  if (!strategies.length) {
    listEl.innerHTML = `<div class="empty-state">Noch keine Strategie angelegt.</div>`;
    document.getElementById("strategy-detail").innerHTML =
      `<div class="empty-state">Lege links eine Strategie an, um Regeln zu hinterlegen.</div>`;
    return;
  }
  if (!strategies.some(s => s.id === selectedStrategyId)) selectedStrategyId = strategies[0].id;

  listEl.innerHTML = strategies.map(s => `
    <div class="strategy-list-item${s.id === selectedStrategyId ? " active" : ""}${s.archived ? " archived" : ""}"
         draggable="true" data-key="${s.id}">
      <span class="strategy-list-handle">⠿</span>
      <div class="strategy-list-body">
        <div class="strategy-list-name">
          ${escapeHtml(s.name)}
          ${s.is_default ? `<span class="strategy-badge" title="Wird bei neuen Trades vorgeschlagen">Standard</span>` : ""}
          ${s.archived ? `<span class="strategy-badge muted">Archiviert</span>` : ""}
        </div>
        <div class="strategy-list-meta">
          ${s.trade_count} Trade${s.trade_count === 1 ? "" : "s"}
          ${s.winrate === null ? "" : ` · ${s.winrate} % WR`}
          · <span class="${s.net_usd >= 0 ? "pos" : "neg"}">${fmtSigned(s.net_usd)} $</span>
        </div>
      </div>
    </div>`).join("");

  listEl.querySelectorAll(".strategy-list-item").forEach(el => {
    el.addEventListener("click", async () => {
      selectedStrategyId = Number(el.dataset.key);
      await renderStrategyList();
    });
  });
  makeSortable(listEl, ".strategy-list-item", async (order) => {
    await api("/api/strategies/order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: order.map(Number) }),
    });
    invalidateStrategiesCache();
  });

  await renderStrategyDetail();
}

/* ---------- Rechte Spalte: Regeln und Statistik ---------- */

async function renderStrategyDetail() {
  const host = document.getElementById("strategy-detail");
  if (!host || !selectedStrategyId) return;
  const data = await api(`/api/strategies/${selectedStrategyId}`);
  const { strategy, summary, rule_stats } = data;
  const statsById = new Map(rule_stats.map(r => [r.id, r]));

  host.innerHTML = `
    <div class="card">
      <div class="strategy-detail-head">
        <div class="card-title">${escapeHtml(strategy.name)}</div>
        <div class="strategy-detail-actions">
          <button type="button" class="btn btn-secondary" data-act="rename">Umbenennen</button>
          <button type="button" class="btn btn-secondary" data-act="default">
            ${strategy.is_default ? "Standard aufheben" : "Als Standard"}
          </button>
          <button type="button" class="btn btn-secondary" data-act="archive">
            ${strategy.archived ? "Reaktivieren" : "Archivieren"}
          </button>
          <button type="button" class="btn btn-danger" data-act="delete">Endgültig löschen</button>
        </div>
      </div>
      <div class="strategy-summary">
        ${summaryTile("Trades", summary.trade_count)}
        ${summaryTile("Trefferquote", summary.winrate === null ? "–" : summary.winrate + " %")}
        ${summaryTile("Netto", fmtSigned(summary.net_usd) + " $", summary.net_usd >= 0 ? "pos" : "neg")}
        ${summaryTile("davon bewertet", `${summary.rated_trade_count} / ${summary.trade_count}`)}
      </div>
      ${summary.trade_count && summary.rated_trade_count < summary.trade_count ? `
        <div class="strategy-hint">
          ${summary.trade_count - summary.rated_trade_count} Trade(s) dieser Strategie haben noch keine
          Regel-Bewertung. Sie zählen in keine Einhaltungsquote.
        </div>` : ""}
    </div>

    <div class="card">
      <div class="strategy-detail-head">
        <div class="card-title">Regeln</div>
        <div class="strategy-detail-actions">
          <button type="button" class="btn btn-secondary" data-act="add-group">+ Gruppe</button>
          <button type="button" class="btn btn-primary" data-act="add-rule">+ Regel</button>
        </div>
      </div>
      <div id="strategy-rules"></div>
    </div>`;

  host.querySelector('[data-act="rename"]').addEventListener("click", () => renameStrategy(strategy));
  host.querySelector('[data-act="default"]').addEventListener("click", () => toggleDefault(strategy));
  host.querySelector('[data-act="archive"]').addEventListener("click", () => toggleArchived(strategy));
  host.querySelector('[data-act="delete"]').addEventListener("click", () => deleteStrategy(strategy, summary));
  host.querySelector('[data-act="add-group"]').addEventListener("click", () => addGroup(strategy));
  host.querySelector('[data-act="add-rule"]').addEventListener("click", () => addRule(strategy, null));

  renderRuleBlocks(strategy, statsById);
}

function summaryTile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div>
          <div class="value ${extraClass}">${value}</div></div>`;
}

/* Gruppen zuerst in ihrer Reihenfolge, danach die Regeln ohne Gruppe als
   eigener Block - so bleibt "keine Gruppe" ein sichtbarer, gleichwertiger
   Zustand statt einer Restekiste am Rand. */
function renderRuleBlocks(strategy, statsById) {
  const host = document.getElementById("strategy-rules");
  const blocks = [
    ...strategy.groups.map(g => ({ group: g, rules: g.rules })),
    ...(strategy.ungrouped_rules.length ? [{ group: null, rules: strategy.ungrouped_rules }] : []),
  ];
  if (!blocks.length) {
    host.innerHTML = `<div class="empty-state">Noch keine Regeln. Lege eine an, um die Einhaltung zu verfolgen.</div>`;
    return;
  }

  host.innerHTML = blocks.map(({ group, rules }) => `
    <div class="rule-group" data-key="${group ? group.id : "none"}"${group ? ' draggable="true"' : ""}>
      <div class="rule-group-head">
        ${group ? `<span class="rule-group-handle">⠿</span>` : ""}
        <span class="rule-group-name">${group ? escapeHtml(group.name) : "Ohne Gruppe"}</span>
        ${group ? `
          <div class="rule-group-actions">
            <button type="button" class="nb-icon-btn" data-group-act="rename" data-id="${group.id}" aria-label="Gruppe umbenennen">✎</button>
            <button type="button" class="nb-icon-btn" data-group-act="add" data-id="${group.id}" aria-label="Regel in dieser Gruppe">+</button>
            <button type="button" class="nb-icon-btn" data-group-act="delete" data-id="${group.id}" aria-label="Gruppe auflösen">×</button>
          </div>` : ""}
      </div>
      <div class="rule-rows">
        ${rules.map(r => ruleRowHtml(r, statsById.get(r.id))).join("")}
      </div>
    </div>`).join("");

  wireRuleActions(strategy);
}

/* Hauptzahl ist die Einhaltungsquote; die Trefferquote der befolgten Trades
   steht daneben. Beide nur, wenn ueberhaupt beantwortet wurde - eine 0 %
   waere sonst nicht von "noch nichts bewertet" zu unterscheiden. */
function ruleRowHtml(rule, stats) {
  const s = stats || { answered: 0, followed: 0, compliance_pct: null, winrate_followed: null };
  const quote = s.compliance_pct === null
    ? `<span class="rule-stat-empty">noch nicht bewertet</span>`
    : `<span class="rule-stat-main">${s.compliance_pct} %</span>
       <span class="rule-stat-sub">${s.followed}/${s.answered} befolgt</span>`;
  const wr = s.winrate_followed === null
    ? `<span class="rule-stat-empty">–</span>`
    : `<span class="rule-stat-main">${s.winrate_followed} %</span>
       <span class="rule-stat-sub">wenn befolgt</span>`;
  return `
    <div class="rule-row" data-key="${rule.id}" draggable="true">
      <span class="rule-handle">⠿</span>
      <span class="rule-text">${escapeHtml(rule.text)}</span>
      <span class="rule-stat">${quote}</span>
      <span class="rule-stat">${wr}</span>
      <span class="rule-actions">
        <button type="button" class="nb-icon-btn" data-rule-act="edit" data-id="${rule.id}" aria-label="Regel bearbeiten">✎</button>
        <button type="button" class="nb-icon-btn" data-rule-act="replace" data-id="${rule.id}" aria-label="Regel ersetzen">⇄</button>
        <button type="button" class="nb-icon-btn" data-rule-act="delete" data-id="${rule.id}" aria-label="Regel löschen">×</button>
      </span>
    </div>`;
}

function wireRuleActions(strategy) {
  const host = document.getElementById("strategy-rules");

  host.querySelectorAll("[data-group-act]").forEach(btn => {
    const id = Number(btn.dataset.id);
    const group = strategy.groups.find(g => g.id === id);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.groupAct === "rename") renameGroup(group);
      if (btn.dataset.groupAct === "add") addRule(strategy, id);
      if (btn.dataset.groupAct === "delete") deleteGroup(group);
    });
  });

  const allRules = [...strategy.ungrouped_rules, ...strategy.groups.flatMap(g => g.rules)];
  host.querySelectorAll("[data-rule-act]").forEach(btn => {
    const rule = allRules.find(r => r.id === Number(btn.dataset.id));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.ruleAct === "edit") editRule(rule);
      if (btn.dataset.ruleAct === "replace") replaceRule(rule);
      if (btn.dataset.ruleAct === "delete") deleteRule(rule);
    });
  });

  // Gruppen untereinander sortierbar ...
  makeSortable(host, ".rule-group", async (order) => {
    const ids = order.filter(k => k !== "none").map(Number);
    await api(`/api/strategies/${strategy.id}/groups/order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ids }),
    });
  });
  // ... und die Regeln innerhalb ihres Blocks. Die Reihenfolge gilt strategie-
  // weit (eine position-Spalte), deshalb wird beim Speichern die Reihenfolge
  // ueber ALLE Bloecke hinweg gelesen, nicht nur die des angefassten Blocks.
  host.querySelectorAll(".rule-rows").forEach(rows => {
    makeSortable(rows, ".rule-row", async () => {
      const ids = [...host.querySelectorAll(".rule-row")].map(el => Number(el.dataset.key));
      await api(`/api/strategies/${strategy.id}/rules/order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ids }),
      });
    });
  });
}

/* ---------- Aktionen ---------- */

async function refresh() {
  invalidateStrategiesCache();
  await renderStrategyList();
}

async function renameStrategy(strategy) {
  const name = await promptDialog("Neuer Name:", strategy.name);
  if (!name) return;
  await api(`/api/strategies/${strategy.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  await refresh();
}

async function toggleDefault(strategy) {
  await api(`/api/strategies/${strategy.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_default: !strategy.is_default }),
  });
  await refresh();
}

async function toggleArchived(strategy) {
  await api(`/api/strategies/${strategy.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: !strategy.archived }),
  });
  await refresh();
}

/* Archivieren ist der Normalfall - endgueltiges Loeschen wirft die
   Regel-Bewertungen weg, die der Nutzer ueber Monate gepflegt hat. Deshalb
   nennt die Rueckfrage die konkreten Zahlen und verlangt das Eintippen. */
async function deleteStrategy(strategy, summary) {
  const ok = await confirmDelete(
    `Strategie "${strategy.name}" endgültig löschen? ${summary.trade_count} Trade(s) verlieren die `
    + `Zuordnung, alle Regeln und ihre Bewertungen werden gelöscht. `
    + `Zum Erhalten der Auswertung stattdessen archivieren.`);
  if (!ok) return;
  await api(`/api/strategies/${strategy.id}`, { method: "DELETE" });
  selectedStrategyId = null;
  await refresh();
}

async function addGroup(strategy) {
  const name = await promptDialog("Name der Gruppe (z. B. Entry):", "");
  if (!name) return;
  await api(`/api/strategies/${strategy.id}/groups`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  await renderStrategyDetail();
}

async function renameGroup(group) {
  const name = await promptDialog("Neuer Name der Gruppe:", group.name);
  if (!name) return;
  await api(`/api/rule-groups/${group.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  await renderStrategyDetail();
}

/* Gruppe aufloesen statt loeschen: die Regeln samt ihrer Bewertungen bleiben
   erhalten und rutschen auf "ohne Gruppe" (siehe db.delete_rule_group). */
async function deleteGroup(group) {
  const ok = await confirmContinue(
    `Gruppe "${group.name}" auflösen? Die ${group.rules.length} Regel(n) darin bleiben erhalten `
    + `und stehen danach unter "Ohne Gruppe".`, "Auflösen");
  if (!ok) return;
  await api(`/api/rule-groups/${group.id}`, { method: "DELETE" });
  await renderStrategyDetail();
}

async function addRule(strategy, groupId) {
  const text = await promptDialog("Neue Regel:", "");
  if (!text) return;
  await api(`/api/strategies/${strategy.id}/rules`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, group_id: groupId }),
  });
  await renderStrategyDetail();
}

/* Bearbeiten aendert den Text an Ort und Stelle - gedacht fuer Tippfehler.
   Bisherige Bewertungen bleiben der Regel zugeordnet und meinen weiterhin
   dasselbe. Fuer eine inhaltliche Aenderung ist replaceRule() da. */
async function editRule(rule) {
  const text = await promptDialog("Regel bearbeiten (nur Wortlaut korrigieren):", rule.text);
  if (!text || text === rule.text) return;
  await api(`/api/rules/${rule.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  await renderStrategyDetail();
}

/* Inhaltlicher Ersatz: alte Regel wird archiviert, ihre Bewertungen bleiben
   gueltig und weiterhin auswertbar; die neue startet bei null. */
async function replaceRule(rule) {
  const text = await promptDialog(
    "Regel inhaltlich ersetzen. Die bisherige wird archiviert und behält ihre Auswertung:", rule.text);
  if (!text || text === rule.text) return;
  await api(`/api/rules/${rule.id}/replace`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  await renderStrategyDetail();
}

async function deleteRule(rule) {
  const ok = await confirmDelete(
    `Regel "${rule.text}" endgültig löschen? Alle bisherigen Bewertungen dieser Regel gehen `
    + `verloren. Soll die Auswertung erhalten bleiben, stattdessen "Ersetzen" nutzen.`);
  if (!ok) return;
  await api(`/api/rules/${rule.id}`, { method: "DELETE" });
  await renderStrategyDetail();
}
