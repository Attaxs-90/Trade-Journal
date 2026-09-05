/* Trades-Tabelle und Einzel-Trade-Seite. */

import { api, cls, fmtDate, fmtNum, fmtSigned, fmtTime, fmtVolume, state, tile, withFilter } from './core.js';
import { confirmContinue } from './dialogs.js';
import { imageThumbEl, uploadImage } from './images.js';
import { activeJournal, mountJournalEditor, saveJournal } from './journal.js';
import { mountView, openTrades, setActiveNav } from './overview.js';
import { openDay, openShareModal } from './share.js';
import { renderTradeStrategyPanel } from './strategies.js';
import { renderTradeTagCell } from './tags.js';

/* ---------- Einzel-Trade-Seite ---------- */

let activeTradeNote = null;

async function saveActiveTradeNote() {
  const n = activeTradeNote;
  if (!n || !n.dirty) return;
  n.dirty = false;
  await api(`/api/trades/${n.tradeId}/notes`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: n.input.value }),
  });
}

/* Vor jedem Verlassen der Trade-Seite (Pfeile, Buttons, Zurueck-Links) geprueft -
   listet konkret auf, was noch nicht gespeichert ist, statt nur pauschal zu warnen.
   Bestaetigung speichert die Aenderungen (kein Datenverlust), lehnt der Nutzer ab
   bleibt er auf der Seite. */
async function confirmLeaveTradePage() {
  const reasons = [];
  if (activeJournal && activeJournal.dirty) reasons.push("Bewertung/Review-Text");
  if (activeTradeNote && activeTradeNote.dirty) reasons.push("Notiz zu diesem Trade");
  if (!reasons.length) return true;
  const ok = await confirmContinue(
    `Es gibt noch ungespeicherte Änderungen (${reasons.join(", ")}). Trotzdem weiter? Die Änderungen werden dabei gespeichert.`
  );
  if (ok) {
    if (activeJournal && activeJournal.dirty) await saveJournal();
    await saveActiveTradeNote();
  }
  return ok;
}

export async function openTrade(tradeId, opts = {}) {
  if (!opts.skipGuard && state.view === "trade" && !(await confirmLeaveTradePage())) return;
  state.view = "trade";
  state.currentDay = null;
  state.currentTradeId = tradeId;
  setActiveNav("");

  const content = await mountView("tpl-trade");
  await populateTrade(content, tradeId);
}

export async function populateTrade(container, tradeId) {
  const [trade, images] = await Promise.all([
    api(`/api/trades/${tradeId}`),
    api(`/api/trades/${tradeId}/images`),
  ]);

  container.querySelector(".trade-title").textContent =
    `${fmtDate(trade.day)} · ${fmtTime(trade.entry_time)} · ${trade.direction} ${trade.instrument}`;

  container.querySelector(".trade-stats").innerHTML =
    tile("Richtung", trade.direction, trade.direction === "Long" ? "pos" : "neg")
    + tile("Größe", fmtVolume(trade))
    + tile("Entry", fmtNum(trade.entry_price))
    + tile("Exit", fmtNum(trade.exit_price))
    + tile("Punkte", fmtSigned(trade.points, 2), cls(trade.points))
    + tile("Netto", fmtSigned(trade.net_usd) + " $", cls(trade.net_usd))
    + tile("Entry-Zeit", fmtTime(trade.entry_time))
    + tile("Exit-Zeit", fmtTime(trade.exit_time))
    + tile("Exit-Typ", trade.exit_type || "–");

  renderTradeTagCell(container.querySelector(".trade-tag-cell"), trade);
  await renderTradeStrategyPanel(container.querySelector(".trade-strategy-host"), trade);

  wireTradeRiskRow(container, trade);
  container.querySelector(".trade-share-btn").onclick = () => openShareModal(trade);

  const noteInput = container.querySelector(".trade-note-input");
  noteInput.value = trade.notes || "";
  activeTradeNote = { tradeId: trade.id, input: noteInput, dirty: false };
  noteInput.oninput = () => { activeTradeNote.dirty = true; };
  noteInput.onblur = () => saveActiveTradeNote();

  const imgStrip = container.querySelector(".trade-images");
  imgStrip.innerHTML = "";
  images.forEach(img => imgStrip.appendChild(imageThumbEl(img, "image-thumb", () => populateTrade(container, tradeId))));
  const imgInput = container.querySelector(".trade-image-input");
  imgInput.value = "";
  imgInput.onchange = async () => {
    const file = imgInput.files[0];
    if (!file) return;
    await uploadImage(trade.day, file, trade.id);
    await populateTrade(container, tradeId);
  };

  container.querySelector(".trade-back-to-list").onclick = async () => {
    if (!(await confirmLeaveTradePage())) return;
    openTrades(state.tradesPage || 1);
  };
  container.querySelector(".trade-back-to-day").onclick = async () => {
    if (!(await confirmLeaveTradePage())) return;
    openDay(trade.day);
  };

  const prevBtn = container.querySelector(".trade-prev");
  const nextBtn = container.querySelector(".trade-next");
  const [prevRes, nextRes] = await Promise.all([
    api(withFilter(`/api/trades/${tradeId}/neighbor?to=prev&sort=day&dir=desc`)),
    api(withFilter(`/api/trades/${tradeId}/neighbor?to=next&sort=day&dir=desc`)),
  ]);
  prevBtn.disabled = !prevRes.id;
  nextBtn.disabled = !nextRes.id;
  prevBtn.onclick = async () => {
    if (prevRes.id && await confirmLeaveTradePage()) openTrade(prevRes.id, { skipGuard: true });
  };
  nextBtn.onclick = async () => {
    if (nextRes.id && await confirmLeaveTradePage()) openTrade(nextRes.id, { skipGuard: true });
  };

  await mountJournalEditor(container.querySelector(".trade-journal"), String(trade.id), {
    entryType: "trade", imageDay: trade.day,
  });
}

document.addEventListener("keydown", (e) => {
  if (state.view !== "trade") return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
  const btn = document.querySelector(e.key === "ArrowLeft" ? ".trade-prev" : ".trade-next");
  if (btn && !btn.disabled) btn.click();
});

/* Risiko-Eingabe (Basis der R-Multiple) auf der Trade-Detailseite - bei
   MT5-Sync automatisch aus dem Stop-Loss des Eroeffnungs-Orders befuellt
   (siehe _entry_risk_usd in mt5_adapter.py), sonst manuell nachtragbar. */
export function tradeRMultiple(trade) {
  if (!trade.risk_usd || trade.risk_usd <= 0) return null;
  return trade.net_usd / trade.risk_usd;
}

function wireTradeRiskRow(container, trade) {
  const input = container.querySelector(".trade-risk-input");
  const display = container.querySelector("#trade-risk-r-display");
  const hint = container.querySelector(".trade-risk-hint");
  input.value = trade.risk_usd != null ? trade.risk_usd : "";
  hint.textContent = trade.source === "mt5" && trade.risk_usd != null
    ? "Automatisch aus dem MT5-Stop-Loss ermittelt." : "";

  function refresh() {
    const r = tradeRMultiple(trade);
    display.textContent = r === null ? "–" : `${fmtSigned(r, 2)}R`;
    display.className = "trade-risk-r" + (r === null ? "" : ` ${cls(r)}`);
  }
  refresh();

  input.oninput = () => {
    const val = input.value === "" ? null : Number(input.value);
    trade.risk_usd = (val === null || Number.isNaN(val)) ? null : val;
    refresh();
  };
  input.onblur = async () => {
    await api(`/api/trades/${trade.id}/risk`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_usd: trade.risk_usd }),
    });
    hint.textContent = "";
  };
}
