/* Trade als Bild-Karte teilen (Canvas) und die Trade-Karten der Tagesansicht. */

import { obsTile } from './calendar.js';
import { api, attachOutsideClose, cls, escapeHtml, fmtDate, fmtNum, fmtSigned, fmtTime, fmtVolume, makeSortable, readStoredArray, state, tile, withFilter, writeStored } from './core.js';
import { getAccountOptions } from './filters.js';
import { renderDayImages } from './images.js';
import { mountJournalEditor } from './journal.js';
import { mountView, setActiveNav } from './overview.js';
import { fmtDuration } from './settings.js';
import { renderTradeStrategyPanel } from './strategies.js';
import { renderTradeTagCell } from './tags.js';
import { tradeRMultiple } from './trades.js';

/* ---------- Trade teilen (Canvas-Karte) ----------
   Rendert einen Trade als Bild-Karte (Instrument, Richtung, Netto-$ oder
   R-Multiple, Ein-/Ausstieg, Dauer) in einem von 5 Design-Themes, per PNG-
   Download oder Zwischenablage teilbar. Reines Canvas 2D statt einer
   Screenshot-Bibliothek - keine externen Assets/CDN noetig (siehe CLAUDE.md). */

const SHARE_W = 1080, SHARE_H = 1350, SHARE_PAD = 70;
const SHARE_FONT = "-apple-system, 'Segoe UI', Inter, Roboto, sans-serif";

function shareHexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shareRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Hintergrund-Motive: feste Bild-Vorlagen (Vorlagen/Bilder Hintergrund Trade
   weiterleiten/) statt generierter Canvas-Grafik - je Theme ein Long- (gruen)
   und ein Short-Motiv (rot), passend zur Trade-Richtung. */
const SHARE_BG = {
  clean: { Long: "/img/share-bg/long-clean.png", Short: "/img/share-bg/short-clean.png" },
  future: { Long: "/img/share-bg/long-bull-future.png", Short: "/img/share-bg/short-bear-future.png" },
  realistic: { Long: "/img/share-bg/long-bull-realistic.png", Short: "/img/share-bg/short-bear-realistic.png" },
};

const shareImageCache = new Map();
function shareLoadImage(src) {
  let entry = shareImageCache.get(src);
  if (!entry) {
    entry = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    shareImageCache.set(src, entry);
  }
  return entry;
}

/* Bild im "cover"-Fit zentriert einpassen, dann per Verlauf oben/unten
   abdunkeln - sonst sind Badge-Text und Stat-Kacheln auf hellen Bildstellen
   schlecht lesbar. */
async function shareDrawBackgroundImage(ctx, w, h, src) {
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, w, h);
  const img = await shareLoadImage(src);
  if (!img) return;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(0, 0, 0, 0.4)");
  fade.addColorStop(0.45, "rgba(0, 0, 0, 0.05)");
  fade.addColorStop(0.7, "rgba(0, 0, 0, 0.25)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0.78)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
}

/* Gemeinsames Layout (Badge, Instrument, grosse Kennzahl, Stat-Kacheln,
   Wasserzeichen) - nur das Hintergrundmotiv unterscheidet die Themes. */
async function shareDrawLayout(ctx, theme, data) {
  const w = SHARE_W, h = SHARE_H;
  ctx.clearRect(0, 0, w, h);
  await shareDrawBackgroundImage(ctx, w, h, SHARE_BG[theme.id][data.direction]);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";

  const badgeText = data.direction === "Long" ? "▲ LONG" : "▼ SHORT";
  ctx.font = "700 30px " + SHARE_FONT;
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgePadX = 34, badgeH = 62;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeX = w / 2 - badgeW / 2;
  const badgeY = h * 0.185;
  ctx.fillStyle = shareHexToRgba(data.accent, 0.16);
  shareRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.strokeStyle = shareHexToRgba(data.accent, 0.6);
  ctx.lineWidth = 2;
  shareRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.stroke();
  ctx.fillStyle = data.accent;
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, w / 2, badgeY + badgeH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 52px " + SHARE_FONT;
  ctx.fillText(data.instrument, w / 2, badgeY + badgeH + 76);

  ctx.font = "800 128px " + SHARE_FONT;
  ctx.fillStyle = data.metricColor;
  ctx.shadowColor = shareHexToRgba(data.metricColor, 0.55);
  ctx.shadowBlur = 44;
  ctx.fillText(data.metricValueText, w / 2, badgeY + badgeH + 236);
  ctx.shadowBlur = 0;

  const tiles = [
    { label: "Einstieg", value: data.entryText },
    { label: "Ausstieg", value: data.exitText },
    { label: "Dauer", value: data.durationText },
  ];
  const gap = 20;
  const tileW = (w - 2 * SHARE_PAD - 2 * gap) / 3;
  const tileH = 128;
  const tileY = h - SHARE_PAD - 70 - tileH;
  tiles.forEach((t, i) => {
    const x = SHARE_PAD + i * (tileW + gap);
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    shareRoundRect(ctx, x, tileY, tileW, tileH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1;
    shareRoundRect(ctx, x, tileY, tileW, tileH, 18);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.font = "600 21px " + SHARE_FONT;
    ctx.fillText(t.label, x + tileW / 2, tileY + 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 29px " + SHARE_FONT;
    ctx.fillText(t.value, x + tileW / 2, tileY + 86);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "600 20px " + SHARE_FONT;
  ctx.textAlign = "right";
  ctx.fillText("Trade Journal", w - SHARE_PAD, h - SHARE_PAD + 26);
}

const SHARE_THEMES = [
  { id: "clean", name: "Clean Chart" },
  { id: "future", name: "Bull & Bear" },
  { id: "realistic", name: "Realistic" },
];

let shareState = { trade: null, metric: "net", themeId: "clean" };

function shareDurationText(entryIso, exitIso) {
  const ms = new Date(exitIso) - new Date(entryIso);
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  return `${fmtNum(hours, 1)}h`;
}

function shareBuildData(trade, metric) {
  const isNet = metric !== "r" || tradeRMultiple(trade) === null;
  const value = isNet ? trade.net_usd : tradeRMultiple(trade);
  const positive = value >= 0;
  const accent = positive ? "#3ddc84" : "#ff6b6b";
  return {
    direction: trade.direction,
    instrument: trade.instrument,
    accent,
    metricColor: accent,
    metricValueText: isNet ? `${fmtSigned(trade.net_usd)} $` : `${fmtSigned(value, 2)}R`,
    entryText: fmtNum(trade.entry_price),
    exitText: fmtNum(trade.exit_price),
    durationText: shareDurationText(trade.entry_time, trade.exit_time),
  };
}

async function shareRender() {
  const canvas = document.getElementById("share-canvas");
  const ctx = canvas.getContext("2d");
  const theme = SHARE_THEMES.find(t => t.id === shareState.themeId) || SHARE_THEMES[0];
  const data = shareBuildData(shareState.trade, shareState.metric);
  await shareDrawLayout(ctx, theme, data);
}

function shareFilename(trade) {
  const safe = `${trade.instrument}_${trade.direction}`.replace(/[^a-z0-9_-]/gi, "");
  return `trade-journal_${safe}_${trade.day}.png`;
}

function initShareModal() {
  const overlay = document.getElementById("share-overlay");
  const grid = document.getElementById("share-theme-grid");
  grid.innerHTML = SHARE_THEMES.map(t => `
    <button type="button" class="share-theme-swatch" data-theme="${t.id}" style="background-image:url('${SHARE_BG[t.id].Long}')">
      <span class="share-theme-swatch-label">${escapeHtml(t.name)}</span>
    </button>
  `).join("");
  grid.querySelectorAll(".share-theme-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      shareState.themeId = btn.dataset.theme;
      grid.querySelectorAll(".share-theme-swatch").forEach(b => b.classList.toggle("active", b === btn));
      shareRender();
    });
  });

  document.getElementById("share-metric-toggle").querySelectorAll(".share-metric-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      shareState.metric = btn.dataset.metric;
      document.querySelectorAll(".share-metric-btn").forEach(b => b.classList.toggle("active", b === btn));
      shareRender();
    });
  });

  document.getElementById("share-close").addEventListener("click", closeShareModal);
  attachOutsideClose(overlay, closeShareModal);

  document.getElementById("share-download-btn").addEventListener("click", () => {
    const canvas = document.getElementById("share-canvas");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = shareFilename(shareState.trade);
    a.click();
  });

  document.getElementById("share-copy-btn").addEventListener("click", async () => {
    const status = document.getElementById("share-copy-status");
    const canvas = document.getElementById("share-canvas");
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      status.textContent = "In Zwischenablage kopiert.";
      status.className = "share-copy-status ok";
    } catch (e) {
      status.textContent = "Kopieren nicht unterstützt - bitte als PNG herunterladen.";
      status.className = "share-copy-status error";
    }
  });
}
initShareModal();

export function openShareModal(trade) {
  const hasR = tradeRMultiple(trade) !== null;
  shareState = { trade, metric: "net", themeId: shareState.themeId || "midnight" };

  const netBtn = document.querySelector('.share-metric-btn[data-metric="net"]');
  const rBtn = document.querySelector('.share-metric-btn[data-metric="r"]');
  netBtn.classList.add("active");
  rBtn.classList.remove("active");
  rBtn.disabled = !hasR;
  document.getElementById("share-metric-hint").hidden = hasR;

  const grid = document.getElementById("share-theme-grid");
  grid.querySelectorAll(".share-theme-swatch").forEach(b => b.classList.toggle("active", b.dataset.theme === shareState.themeId));

  document.getElementById("share-copy-status").textContent = "";
  document.getElementById("share-copy-status").className = "share-copy-status";

  shareRender();
  document.getElementById("share-overlay").classList.add("visible");
}

function closeShareModal() {
  document.getElementById("share-overlay").classList.remove("visible");
}

/* Felder der Trade-Karte in der Tagesansicht (linke Spalte) - Reihenfolge per
   Drag & Drop einstellbar, analog TRADE_CARD_FIELDS/tradeFieldOrder auf der
   Trades-Uebersicht, aber eigene Feldliste (kein "Datum", dafuer "Kumuliert")
   und eigener localStorage-Key, da die Spaltenmengen nicht identisch sind. */
const DAY_TRADE_FIELDS = [
  { key: "account", label: "Konto", render: (t, ctx) => t.account_id ? escapeHtml(ctx.accountNames.get(String(t.account_id)) || `Konto ${t.account_id}`) : "CSV / ohne Konto" },
  { key: "entry_time", label: "Entry-Zeit", render: (t) => fmtTime(t.entry_time) },
  { key: "exit_time", label: "Exit-Zeit", render: (t) => fmtTime(t.exit_time) },
  { key: "direction", label: "Richtung", render: (t) => `<span class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction === "Long" ? "▲" : "▼"} ${t.direction}</span>` },
  { key: "volume", label: "Größe", render: (t) => fmtVolume(t) },
  { key: "entry_price", label: "Entry", render: (t) => fmtNum(t.entry_price) },
  { key: "exit_price", label: "Exit", render: (t) => fmtNum(t.exit_price) },
  { key: "exit_type", label: "Exit-Typ", render: (t) => t.exit_type || "–" },
  { key: "points", label: "Punkte", render: (t) => `<span class="${cls(t.points)}">${fmtSigned(t.points, 2)}</span>` },
  { key: "net_usd", label: "Netto $", render: (t) => `<span class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</span>` },
  { key: "cumulative", label: "Kumuliert", render: (t, ctx) => `<span class="${ctx.cumClass}">${fmtSigned(ctx.cumVal)} $</span> ${ctx.hiLoBadge}` },
  { key: "tags", label: "Tags", render: null },
];
const DAY_TRADE_FIELD_KEYS = DAY_TRADE_FIELDS.map(f => f.key);

function loadDayTradeFieldOrder() {
  const saved = readStoredArray("dayTradeFieldOrder");
  if (!Array.isArray(saved)) return [...DAY_TRADE_FIELD_KEYS];
  const known = saved.filter(k => DAY_TRADE_FIELD_KEYS.includes(k));
  for (const k of DAY_TRADE_FIELD_KEYS) if (!known.includes(k)) known.push(k);
  return known;
}
function saveDayTradeFieldOrder(order) {
  writeStored("dayTradeFieldOrder", order);
}

/* container-scoped statt ueber Ids: dieselbe Tagesansicht kann gleichzeitig
   als Seite und im Modal existieren (siehe CLAUDE.md "Bewusste
   Design-Entscheidungen"), globale Ids wuerden sich doppeln. */
function renderDayTradeFieldOrderPanel(container, onReorder) {
  const panel = container.querySelector(".day-trade-field-order-panel");
  const order = loadDayTradeFieldOrder();
  panel.innerHTML = `<div class="newsbar-filter-group-title">Ziehen zum Umsortieren</div>`
    + order.map(key => {
      const field = DAY_TRADE_FIELDS.find(f => f.key === key);
      return `<div class="trade-field-order-row" draggable="true" data-key="${key}">
        <span class="trade-field-order-handle">⠿</span>${escapeHtml(field.label)}
      </div>`;
    }).join("");

  makeSortable(panel, ".trade-field-order-row", (order) => {
    saveDayTradeFieldOrder(order);
    onReorder();
  });
}

export async function openDay(day) {
  state.view = "day";
  state.currentDay = day;
  setActiveNav("");

  const content = await mountView("tpl-day");
  await populateDay(content, day);
}

/* opts.tradeIndex: welcher Trade der Liste in der linken Spalte angezeigt wird -
   bleibt beim Neuladen nach Bild-Upload/Loeschen moeglichst erhalten, statt
   immer wieder beim ersten Trade des Tages zu landen. */
export async function populateDay(container, day, opts = {}) {
  container.querySelector(".day-title").textContent = fmtDate(day);

  const [data, accountOptions] = await Promise.all([
    api(withFilter(`/api/days/${day}`)),
    getAccountOptions(),
  ]);
  const s = data.stats;
  const accountNames = new Map(accountOptions.filter(o => o.key !== "csv").map(o => [String(o.key), o.name]));

  container.querySelector(".day-stats").innerHTML =
    tile("Punkte", fmtSigned(s.total_points))
    + tile("Netto", fmtSigned(s.total_net) + " $", cls(s.total_net))
    + tile("Trades", s.trade_count)
    + tile("Tagestief (kum.)", fmtSigned(s.lowest_cum) + " $", "neg")
    + tile("Tageshoch (kum.)", fmtSigned(s.highest_cum) + " $", "pos")
    + tile("Peak-to-Valley Drawdown", fmtSigned(s.max_drawdown) + " $");

  let cum = 0;
  const cumVals = data.trades.map(t => (cum += t.net_usd));
  const highIdx = cumVals.indexOf(Math.max(...cumVals));
  const lowIdx = cumVals.indexOf(Math.min(...cumVals));

  const emptyEl = container.querySelector(".day-trade-empty");
  const bodyEl = container.querySelector(".day-trade-body");
  const toggle = container.querySelector(".day-trade-field-order-toggle");
  const panel = container.querySelector(".day-trade-field-order-panel");

  if (!data.trades.length) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    toggle.hidden = true;
  } else {
    emptyEl.hidden = true;
    bodyEl.hidden = false;
    toggle.hidden = false;

    let activeIndex = Math.min(Math.max(opts.tradeIndex || 0, 0), data.trades.length - 1);

    function renderCard() {
      const t = data.trades[activeIndex];
      const i = activeIndex;
      const cumClass = i === highIdx ? "cum-high" : (i === lowIdx ? "cum-low" : "");
      const hiLoBadge = i === highIdx ? '<span class="badge-tag">← Tageshoch</span>' : (i === lowIdx ? '<span class="badge-tag">← Tagestief</span>' : "");
      const ctx = { accountNames, cumVal: cumVals[i], cumClass, hiLoBadge };

      container.querySelector(".day-trade-index").textContent = `Trade ${i + 1} von ${data.trades.length}`;
      container.querySelector(".day-trade-prev").disabled = i === 0;
      container.querySelector(".day-trade-next").disabled = i === data.trades.length - 1;

      const order = loadDayTradeFieldOrder();
      const fieldsEl = container.querySelector(".day-trade-fields");
      fieldsEl.innerHTML = order.map(key => {
        if (key === "tags") return `<div class="day-trade-field-row"><span class="label">Tags</span><span class="tag-cell day-trade-tag-cell"></span></div>`;
        const field = DAY_TRADE_FIELDS.find(f => f.key === key);
        return `<div class="day-trade-field-row"><span class="label">${escapeHtml(field.label)}</span><span class="value">${field.render(t, ctx)}</span></div>`;
      }).join("");
      const tagCell = fieldsEl.querySelector(".day-trade-tag-cell");
      if (tagCell) renderTradeTagCell(tagCell, t);
      // Dieselbe Komponente wie auf der Trade-Seite, nur kompakt - so laesst
      // sich ein ganzer Handelstag ueber die Pfeile durchgehen und bewerten,
      // ohne je die Seite zu wechseln.
      renderTradeStrategyPanel(container.querySelector(".day-trade-strategy-host"), t, { compact: true });
    }
    renderCard();

    // .onclick statt addEventListener: diese Buttons liegen ausserhalb des
    // per renderCard() neu befuellten Bereichs und werden bei einem erneuten
    // populateDay()-Aufruf auf demselben Container nicht neu erzeugt -
    // addEventListener wuerde sich sonst bei jedem Aufruf stapeln.
    container.querySelector(".day-trade-prev").onclick = () => { if (activeIndex > 0) { activeIndex--; renderCard(); } };
    container.querySelector(".day-trade-next").onclick = () => { if (activeIndex < data.trades.length - 1) { activeIndex++; renderCard(); } };

    toggle.onclick = (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderDayTradeFieldOrderPanel(container, renderCard);
    };
  }

  renderDayImages(container, day, data.images || []);

  const obsCard = container.querySelector(".day-observations").closest(".card");
  if (data.trades.length) {
    obsCard.hidden = false;
    container.querySelector(".day-observations").innerHTML =
      obsTile("Ø Haltedauer", fmtDuration(s.avg_duration_sec))
      + obsTile("Größte Pause zw. Trades", fmtDuration(s.max_gap_sec))
      + obsTile("Richtung", `${s.long_count}x Long / ${s.short_count}x Short`)
      + obsTile("Preisspanne", `${fmtNum(s.price_low)} – ${fmtNum(s.price_high)}`)
      + obsTile("Erster Trade", fmtTime(data.trades[0].entry_time))
      + obsTile("Letzter Trade", fmtTime(data.trades[data.trades.length - 1].exit_time));
  } else {
    // Beobachtungen sind reine Trade-Kennzahlen - an einem Tag ohne Trades
    // (nur Bild und/oder Journal) gibt es hier nichts sinnvoll zu zeigen.
    obsCard.hidden = true;
  }

  // mountJournalEditor() steigt selbst aus, wenn der Editor fuer diesen Tag
  // schon steht - populateDay() laeuft nach jedem Bild-Upload erneut und wuerde
  // sonst ungespeicherten Text im Editor verwerfen.
  await mountJournalEditor(container.querySelector(".day-journal"), day);
}
