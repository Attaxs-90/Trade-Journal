/* Trade als Bild-Karte teilen (Canvas) und die Trade-Karten der Tagesansicht. */

import { obsTile } from './calendar.js';
import { api, attachOutsideClose, cls, escapeHtml, fmtDate, fmtNum, fmtSigned, fmtTime, fmtVolume, makeSortable, readStoredArray, state, tile, withFilter, writeStored } from './core.js';
import { getAccountOptions } from './filters.js';
import { renderDayImages } from './images.js';
import { mountJournalEditor } from './journal.js';
import { mountView, setActiveNav } from './overview.js';
import { fmtDuration } from './settings.js';
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

/* Gemeinsames Layout (Badge, Instrument, grosse Kennzahl, Stat-Kacheln,
   Wasserzeichen) - nur der Hintergrund/Motiv-Akzent unterscheidet die Themes
   (siehe SHARE_THEMES[].drawBackground). */
function shareDrawLayout(ctx, theme, data) {
  const w = SHARE_W, h = SHARE_H;
  ctx.clearRect(0, 0, w, h);
  theme.drawBackground(ctx, w, h, data);

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
  {
    id: "midnight",
    name: "Midnight Glow",
    previewCss: "radial-gradient(circle at 50% 32%, #234a3d 0%, #0a0e14 68%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0a0e14";
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h * 0.34, 20, w / 2, h * 0.34, h * 0.62);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.32));
      glow.addColorStop(1, "rgba(10, 14, 20, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = shareHexToRgba(data.accent, 0.5);
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.shadowColor = shareHexToRgba(data.accent, 0.65);
      ctx.shadowBlur = 26;
      const pts = data.direction === "Long"
        ? [[-40, h * 0.98], [w * 0.22, h * 0.86], [w * 0.4, h * 0.92], [w * 0.62, h * 0.58], [w * 0.82, h * 0.64], [w + 40, h * 0.22]]
        : [[-40, h * 0.1], [w * 0.22, h * 0.24], [w * 0.4, h * 0.16], [w * 0.62, h * 0.46], [w * 0.82, h * 0.4], [w + 40, h * 0.86]];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "neongrid",
    name: "Neon Grid",
    previewCss: "linear-gradient(180deg, #0a0d12 0%, #131a24 100%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0a0d12";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
      ctx.lineWidth = 1.5;
      const vpX = w / 2, vpY = h * 0.12;
      for (let i = -7; i <= 7; i++) {
        ctx.beginPath();
        ctx.moveTo(vpX + i * 110, h + 40);
        ctx.lineTo(vpX + i * 16, vpY);
        ctx.stroke();
      }
      for (let j = 0; j < 11; j++) {
        const t = j / 10;
        const y = vpY + (h - vpY) * Math.pow(t, 1.9);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
      const glow = ctx.createLinearGradient(0, data.direction === "Long" ? h : 0, 0, data.direction === "Long" ? 0 : h);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.28));
      glow.addColorStop(0.45, "rgba(10, 13, 18, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "aurora",
    name: "Aurora Drift",
    previewCss: "radial-gradient(circle at 30% 20%, #2a2560 0%, transparent 55%), radial-gradient(circle at 75% 75%, #1c3b32 0%, #0b0d16 60%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0b0d16";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.filter = "blur(70px)";
      const blob1 = ctx.createRadialGradient(w * 0.28, h * 0.22, 10, w * 0.28, h * 0.22, w * 0.5);
      blob1.addColorStop(0, "rgba(120, 100, 255, 0.35)");
      blob1.addColorStop(1, "rgba(120, 100, 255, 0)");
      ctx.fillStyle = blob1;
      ctx.fillRect(0, 0, w, h);
      const blob2 = ctx.createRadialGradient(w * 0.75, h * 0.68, 10, w * 0.75, h * 0.68, w * 0.55);
      blob2.addColorStop(0, shareHexToRgba(data.accent, 0.38));
      blob2.addColorStop(1, shareHexToRgba(data.accent, 0));
      ctx.fillStyle = blob2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    },
  },
  {
    id: "carbon",
    name: "Carbon Line",
    previewCss: "linear-gradient(135deg, #0c0c0c 0%, #16171a 100%)",
    drawBackground(ctx, w, h, data) {
      ctx.fillStyle = "#0c0c0c";
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
      ctx.lineWidth = 1;
      for (let x = -h; x < w; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }
      ctx.restore();
      const glow = ctx.createRadialGradient(w / 2, h * 0.3, 10, w / 2, h * 0.3, h * 0.5);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.22));
      glow.addColorStop(1, "rgba(12, 12, 12, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = shareHexToRgba(data.accent, 0.7);
      ctx.lineWidth = 4;
      ctx.shadowColor = shareHexToRgba(data.accent, 0.6);
      ctx.shadowBlur = 18;
      const midY = h * (data.direction === "Long" ? 0.62 : 0.4);
      const step = w / 7;
      ctx.beginPath();
      for (let i = 0; i <= 7; i++) {
        const x = i * step;
        const wobble = Math.sin(i * 1.7) * 30;
        const trend = data.direction === "Long" ? -i * 14 : i * 14;
        const y = midY + wobble + trend;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "sunset",
    name: "Sunset Pulse",
    previewCss: "radial-gradient(circle at 50% 100%, #3a1f10 0%, #0d0b12 60%)",
    drawBackground(ctx, w, h, data) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#0d0b12");
      bg.addColorStop(1, "#161016");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h * 1.05, 10, w / 2, h * 1.05, h * 0.85);
      glow.addColorStop(0, shareHexToRgba(data.accent, 0.4));
      glow.addColorStop(1, "rgba(13, 11, 18, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      let seed = data.instrument.length * 17 + (data.direction === "Long" ? 3 : 7);
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const x = rand() * w, y = rand() * h * 0.75;
        const r = 2 + rand() * 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = shareHexToRgba(data.accent, 0.25 + rand() * 0.35);
        ctx.fill();
      }
      ctx.restore();
    },
  },
];

let shareState = { trade: null, metric: "net", themeId: "midnight" };

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

function shareRender() {
  const canvas = document.getElementById("share-canvas");
  const ctx = canvas.getContext("2d");
  const theme = SHARE_THEMES.find(t => t.id === shareState.themeId) || SHARE_THEMES[0];
  const data = shareBuildData(shareState.trade, shareState.metric);
  shareDrawLayout(ctx, theme, data);
}

function shareFilename(trade) {
  const safe = `${trade.instrument}_${trade.direction}`.replace(/[^a-z0-9_-]/gi, "");
  return `trade-journal_${safe}_${trade.day}.png`;
}

function initShareModal() {
  const overlay = document.getElementById("share-overlay");
  const grid = document.getElementById("share-theme-grid");
  grid.innerHTML = SHARE_THEMES.map(t => `
    <button type="button" class="share-theme-swatch" data-theme="${t.id}" style="background:${t.previewCss}">
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
