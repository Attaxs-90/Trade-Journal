/* Strategien: Verwaltung (anlegen, umbenennen, archivieren, loeschen), Regeln in
   optionalen Gruppen und die Einhaltungs-Statistik je Regel.

   Eine Strategie buendelt Regeln; ein Trade hat hoechstens eine Strategie und
   kann je Regel "befolgt"/"nicht befolgt" tragen. Regeln ohne Antwort fallen
   aus jeder Quote heraus - das deckt zugleich "Regel hier nicht anwendbar" ab
   (siehe trade_rule_status in db.py). */

import { api, escapeHtml, fmtSigned, makeSortable, showAppError, state } from './core.js';
import { chooseDialog, confirmContinue, confirmDelete, promptDialog } from './dialogs.js';
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

/* ---------- Strategie und Regel-Checkliste am Trade ----------
   Eine Komponente fuer beide Einhaengeorte: die Einzel-Trade-Seite und die
   Trade-Karte der Tagesansicht (compact). Sonst laege dieselbe Logik zweimal
   im Code und liefe auseinander.

   Je Regel drei Klickzustaende: Ja, Nein und "nochmal auf dieselbe Schaltflaeche"
   = Bewertung zuruecknehmen. Zurueckgenommen zaehlt die Regel in keine Quote -
   das ist zugleich der Weg fuer "Regel hier nicht anwendbar". */

export async function renderTradeStrategyPanel(host, trade, { compact = false } = {}) {
  if (!host) return;
  const [strategies, data] = await Promise.all([
    getStrategies(),
    api(`/api/trades/${trade.id}/rule-status`),
  ]);
  // Archivierte Strategien tauchen in der Auswahl nur auf, wenn der Trade
  // bereits daran haengt - sonst waeren sie neu nicht mehr waehlbar, ein
  // bestehender Trade wuerde aber stillschweigend umgehaengt.
  const options = [...strategies];
  if (data.strategy && !options.some(s => s.id === data.strategy.id)) options.push(data.strategy);

  host.innerHTML = `
    <div class="trade-strategy${compact ? " compact" : ""}">
      <div class="trade-strategy-head">
        <label class="trade-strategy-select-label">Strategie
          <select class="trade-strategy-select">
            <option value="">Ohne Strategie</option>
            ${options.map(s => `<option value="${s.id}"${data.strategy && data.strategy.id === s.id ? " selected" : ""}>`
              + `${escapeHtml(s.name)}${s.archived ? " (archiviert)" : ""}</option>`).join("")}
          </select>
        </label>
        <div class="trade-strategy-plan">${planBadge(data.followed_plan)}</div>
      </div>
      <div class="trade-rule-checklist"></div>
    </div>`;

  host.querySelector(".trade-strategy-select").addEventListener("change", async (e) => {
    const value = e.target.value ? Number(e.target.value) : null;
    await api(`/api/trades/${trade.id}/strategy`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy_id: value }),
    });
    trade.strategy_id = value;
    await renderTradeStrategyPanel(host, trade, { compact });
  });

  renderChecklist(host, trade, data, compact);
}

/* "Plan befolgt" wird nicht mehr eingegeben, sondern abgeleitet: Ja, wenn jede
   beantwortete Regel auf Ja steht. null = keine Aussage (keine Strategie oder
   noch nichts beantwortet) - das ist bewusst nicht dasselbe wie "Nein". */
function planBadge(followedPlan) {
  if (followedPlan === null) return `<span class="plan-badge muted">Plan: keine Aussage</span>`;
  return followedPlan
    ? `<span class="plan-badge yes">Plan befolgt</span>`
    : `<span class="plan-badge no">Plan gebrochen</span>`;
}

function renderChecklist(host, trade, data, compact) {
  const list = host.querySelector(".trade-rule-checklist");
  if (!data.strategy) {
    list.innerHTML = `<div class="trade-rule-empty">Ohne Strategie gibt es keine Regeln zum Abhaken.</div>`;
    return;
  }
  const blocks = [
    ...data.strategy.groups.map(g => ({ name: g.name, rules: g.rules })),
    ...(data.strategy.ungrouped_rules.length ? [{ name: null, rules: data.strategy.ungrouped_rules }] : []),
  ];
  if (!blocks.length) {
    list.innerHTML = `<div class="trade-rule-empty">Diese Strategie hat noch keine Regeln.</div>`;
    return;
  }

  list.innerHTML = blocks.map(b => `
    <div class="trade-rule-block">
      ${b.name ? `<div class="trade-rule-block-title">${escapeHtml(b.name)}</div>` : ""}
      ${b.rules.map(r => {
        const v = data.status[String(r.id)];
        return `<div class="trade-rule-item" data-rule="${r.id}">
          <span class="trade-rule-item-text">${escapeHtml(r.text)}</span>
          <span class="trade-rule-item-btns">
            <button type="button" class="rule-choice${v === 1 ? " yes" : ""}" data-val="1"
                    aria-pressed="${v === 1}">Ja</button>
            <button type="button" class="rule-choice${v === 0 ? " no" : ""}" data-val="0"
                    aria-pressed="${v === 0}">Nein</button>
          </span>
        </div>`;
      }).join("")}
    </div>`).join("");

  list.querySelectorAll(".trade-rule-item").forEach(item => {
    const ruleId = Number(item.dataset.rule);
    item.querySelectorAll(".rule-choice").forEach(btn => {
      btn.addEventListener("click", async () => {
        const want = Number(btn.dataset.val);
        // Erneuter Klick auf die aktive Wahl nimmt die Bewertung zurueck.
        const followed = data.status[String(ruleId)] === want ? null : want === 1;
        const res = await api(`/api/trades/${trade.id}/rule-status`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule_id: ruleId, followed }),
        });
        data.status = res.status;
        host.querySelector(".trade-strategy-plan").innerHTML = planBadge(res.followed_plan);
        renderChecklist(host, trade, data, compact);
      });
    });
  });
}

/* ---------- Sammelaktionen aus der Trades-Uebersicht ----------
   Nacherfassung fuer Bestands-Trades: ohne sie startet das Feature mit
   hunderten unzugeordneten Trades und bleibt praktisch leer. */

export async function bulkAssignStrategy(tradeIds, onDone) {
  const strategies = await getStrategies(true);
  if (!strategies.length) {
    showAppError("Es gibt noch keine Strategie. Lege zuerst unter „Strategie“ eine an.");
    return;
  }
  const choice = await chooseDialog(
    `Strategie für ${tradeIds.length} ausgewählte Trade(s) setzen:`,
    [{ value: "", label: "Ohne Strategie" },
     ...strategies.map(s => ({ value: s.id, label: s.name }))],
    "Zuweisen");
  if (choice === null) return;
  const res = await api("/api/trades/bulk-strategy", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade_ids: tradeIds, strategy_id: choice ? Number(choice) : null }),
  });
  if (onDone) await onDone(res);
}

export async function bulkRateRule(tradeIds, onDone) {
  const strategies = await getStrategies(true);
  // Regeln aller Strategien, nach Strategie gruppiert. Der Server wendet eine
  // Regel nur auf Trades an, die tatsaechlich zu ihrer Strategie gehoeren, und
  // meldet zurueck wie viele es waren - deshalb ist die Liste hier nicht auf
  // die Strategien der Auswahl eingeschraenkt.
  const options = [];
  for (const s of strategies) {
    const tree = await api(`/api/strategies/${s.id}`);
    const rules = [...tree.strategy.groups.flatMap(g => g.rules), ...tree.strategy.ungrouped_rules];
    for (const r of rules) options.push({ value: r.id, label: r.text, group: s.name });
  }
  if (!options.length) {
    showAppError("Es gibt noch keine Regeln, die sich bewerten lassen.");
    return;
  }
  const ruleId = await chooseDialog(`Welche Regel für ${tradeIds.length} Trade(s) bewerten?`, options, "Weiter");
  if (ruleId === null) return;
  const value = await chooseDialog("Wie sollen diese Trades bewertet werden?", [
    { value: "1", label: "Befolgt (Ja)" },
    { value: "0", label: "Nicht befolgt (Nein)" },
    { value: "", label: "Bewertung zurücknehmen (zählt in keine Quote)" },
  ], "Übernehmen");
  if (value === null) return;
  const res = await api("/api/trades/bulk-rule-status", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade_ids: tradeIds, rule_id: Number(ruleId),
                           followed: value === "" ? null : value === "1" }),
  });
  // Erst neu laden, DANN melden: onDone() rendert die Ansicht neu, und
  // mountView() raeumt den Fehlerstreifen beim Ansichtswechsel ab - eine
  // vorher gesetzte Meldung waere sofort wieder verschwunden (beobachtet).
  if (onDone) await onDone(res);
  // Ehrlich melden statt still zu schlucken: die Regel greift nur bei Trades
  // der passenden Strategie, es sind also oft weniger als ausgewaehlt.
  if (res.updated < tradeIds.length) {
    showAppError(`${res.updated} von ${tradeIds.length} Trade(s) bewertet – die übrigen gehören `
      + `zu einer anderen Strategie als diese Regel.`);
  }
}
