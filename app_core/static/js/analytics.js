/* Auswertungen: frei zusammenstellbares Dashboard aus Widgets. */

import { getPlatforms, renderImportAccountSelect } from './accounts.js';
import { closeModal } from './calendar.js';
import { attachChartTooltip, lineChartSvg } from './chart.js';
import { accountsQS, api, cls, escapeHtml, fmtDate, fmtNum, fmtSigned, makeSortable, showAppError, state, tagsQS, tile, withFilter } from './core.js';
import { deleteAccountFlow } from './dialogs.js';
import { refreshCurrentView, renderAccountFilter, renderTagFilter } from './filters.js';
import { mountView, setActiveNav } from './overview.js';
import { fmtDuration } from './settings.js';
import { openDay } from './share.js';

/* ---------- Auswertungen ---------- */
/* Modulares Dashboard: jede Kachel (Widget) ist ein Objekt {id, type, title,
   ...typspezifische Felder}. type="breakdown" traegt zusaetzlich dimension +
   metric - eine einzige generische Balkendiagramm-Darstellung bedient damit
   jede Dimension x Kennzahl-Kombination, statt fuer jede Auswertung eine
   eigene Komponente zu bauen. Konfiguration liegt in localStorage, analog zu
   den uebrigen Ansichts-Einstellungen dieser App (Spaltenreihenfolge, Sidebar-
   Reihenfolge, ...) - kein Server-Roundtrip fuer reine Anzeige-Praeferenzen. */

const ANALYTICS_METRICS = [
  { key: "net", field: "total_net", label: "Netto-P&L", unit: "$", signed: true, decimals: 0 },
  { key: "points", field: "total_points", label: "Punkte", unit: "Pkt", signed: true, decimals: 1 },
  { key: "win_rate", field: "win_rate", label: "Trefferquote", unit: "%", signed: false, decimals: 1 },
  { key: "profit_factor", field: "profit_factor", label: "Profit-Faktor", unit: "", signed: false, decimals: 2 },
  { key: "expectancy", field: "expectancy", label: "Ø pro Trade", unit: "$", signed: true, decimals: 1 },
  { key: "trade_count", field: "trade_count", label: "Anzahl Trades", unit: "", signed: false, decimals: 0 },
  { key: "avg_win", field: "avg_win", label: "Ø Gewinn", unit: "$", signed: false, decimals: 1 },
  { key: "avg_loss", field: "avg_loss", label: "Ø Verlust", unit: "$", signed: false, decimals: 1 },
];

const ANALYTICS_DEFAULT_WIDGETS = [
  { id: "kpi-1", type: "kpi", title: "Kern-Kennzahlen" },
  { id: "equity-1", type: "equity", title: "Equity-Kurve & Drawdown" },
  { id: "streaks-1", type: "streaks", title: "Serien & Konsistenz" },
  { id: "bd-weekday", type: "breakdown", title: "Netto-P&L nach Wochentag", dimension: "weekday", metric: "net" },
  { id: "bd-hour", type: "breakdown", title: "Netto-P&L nach Uhrzeit (Entry)", dimension: "hour", metric: "net" },
  { id: "bd-instrument", type: "breakdown", title: "Performance nach Instrument", dimension: "instrument", metric: "net" },
  { id: "bd-direction", type: "breakdown", title: "Trefferquote: Long vs. Short", dimension: "direction", metric: "win_rate" },
  { id: "bd-duration", type: "breakdown", title: "Performance nach Haltedauer", dimension: "duration", metric: "net" },
  { id: "dist-1", type: "distribution", title: "P&L-Verteilung" },
  { id: "bd-rating", type: "breakdown", title: "Netto-P&L nach Tagesbewertung", dimension: "rating", metric: "net" },
  { id: "bd-plan", type: "breakdown", title: "Trefferquote: Plan befolgt?", dimension: "followed_plan", metric: "win_rate" },
  { id: "bd-account", type: "breakdown", title: "Performance nach Konto", dimension: "account", metric: "net" },
];

let analyticsWidgets = [];

function loadAnalyticsWidgets() {
  try {
    const saved = JSON.parse(localStorage.getItem("analyticsWidgets") || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) { /* ignore */ }
  return ANALYTICS_DEFAULT_WIDGETS.map(w => ({ ...w }));
}
function saveAnalyticsWidgets() {
  localStorage.setItem("analyticsWidgets", JSON.stringify(analyticsWidgets));
}

function loadAnalyticsRangeState() {
  try {
    const saved = JSON.parse(localStorage.getItem("analyticsRange") || "null");
    state.analyticsRange = saved && typeof saved === "object" ? saved : { start: null, end: null };
  } catch (e) {
    state.analyticsRange = { start: null, end: null };
  }
}
function saveAnalyticsRangeState() {
  localStorage.setItem("analyticsRange", JSON.stringify(state.analyticsRange));
}
function analyticsRangeQS() {
  const { start, end } = state.analyticsRange || {};
  const parts = [];
  if (start) parts.push(`start=${encodeURIComponent(start)}`);
  if (end) parts.push(`end=${encodeURIComponent(end)}`);
  return parts.join("&");
}
/* Wie withFilter(), zusaetzlich mit dem Zeitraum der Auswertungsseite - der
   existiert nur hier (Uebersicht/Trades/Journal kennen keinen Datumsfilter).

   Baut bewusst AUF withFilter() auf, statt dessen Querystrings nachzubauen:
   die frueher hier wiederholte Liste [accountsQS(), tagsQS()] hatte den neu
   hinzugekommenen Strategie-Filter nicht mitbekommen, die Auswertungsseite
   zeigte deshalb als einzige weiterhin alle Trades. Ein kuenftiger vierter
   Filter greift jetzt automatisch auch hier. */
function withAnalyticsFilter(url) {
  const withGlobal = withFilter(url);
  const range = analyticsRangeQS();
  if (!range) return withGlobal;
  return withGlobal + (withGlobal.includes("?") ? "&" : "?") + range;
}

let cachedAnalyticsDimensions = null;
async function getAnalyticsDimensions() {
  if (!cachedAnalyticsDimensions) cachedAnalyticsDimensions = await api("/api/analytics/dimensions");
  return cachedAnalyticsDimensions;
}

export function shortenLabel(label, max = 13) {
  const s = String(label);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* Generisches Balkendiagramm - bedient sowohl breakdown-Widgets (rows aus
   /api/analytics/breakdown) als auch die P&L-Verteilung (rows synthetisch aus
   den Histogramm-Bins gebaut), damit fuer Letztere kein zweiter Chart-Baustein
   noetig ist. metric.field zeigt auf das Feld in jeder row, das die Balkenhoehe
   liefert; null-Werte (z.B. Profit-Faktor ohne Verlusttrade) werden als "∞"
   beschriftet statt als 0 fehlinterpretiert. */
function barChartSvg(rows, metric, w = 1000, h = 260) {
  const padL = 54, padR = 16, padT = 20, padB = 46;
  const values = rows.map(r => { const v = r[metric.field]; return v == null ? 0 : v; });
  const rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values);
  const range = (rawMax - rawMin) || 1;
  const y = v => padT + (h - padT - padB) * (1 - (v - rawMin) / range);
  const zeroY = y(0);
  const n = rows.length;
  const bandW = (w - padL - padR) / n;
  const barW = Math.min(58, bandW * 0.62);

  const cs = getComputedStyle(document.documentElement);
  const green = cs.getPropertyValue("--green").trim();
  const red = cs.getPropertyValue("--red").trim();
  const accent = cs.getPropertyValue("--accent").trim();
  const border = cs.getPropertyValue("--border").trim();
  const faint = cs.getPropertyValue("--text-faint").trim();
  const text = cs.getPropertyValue("--text").trim();

  const GRID_LINES = 4;
  let gridSvg = "";
  for (let i = 0; i <= GRID_LINES; i++) {
    const v = rawMin + (range * i / GRID_LINES);
    const gy = y(v);
    gridSvg += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="${border}" stroke-width="1" opacity="0.5" />`;
    gridSvg += `<text x="${padL - 8}" y="${gy + 3}" fill="${faint}" font-size="10" text-anchor="end">${fmtNum(v, 0)}</text>`;
  }

  // Wieviele x-Achsen-Beschriftungen unten Platz haben, bevor sie sich
  // ueberlappen - wie die Datums-Labels in lineChartSvg() nur eine Auswahl
  // zeigen statt jede Kategorie, wenn es viele sind (z.B. 24 Stunden) oder
  // die Kategorienamen selbst lang sind (z.B. Instrument-Ticker). Richtet
  // sich nach der tatsaechlichen Durchschnittslaenge der Labels, nicht nach
  // einer festen Breite - sonst ueberlappen sich lange Namen trotzdem.
  const avgLabelLen = rows.reduce((sum, r) => sum + shortenLabel(r.label).length, 0) / n || 6;
  const labelPxNeeded = Math.max(34, avgLabelLen * 6.2 + 8);
  const maxAxisLabels = Math.max(1, Math.floor((w - padL - padR) / labelPxNeeded));
  // Bei wenigen Kategorien lieber kuerzen als weglassen: ein Balken ohne
  // Beschriftung laesst sich nicht zuordnen. Bei drei Strategien mit langen
  // Namen fiel sonst ausgerechnet die mittlere weg (gleiches Problem bei
  // "Konto" mit "Nicht zugeordnet"). Erst darueber greift das Auslassen,
  // das fuer 24 Stunden-Balken gedacht ist.
  const ALWAYS_LABEL_UP_TO = 8;
  const axisLabelStep = n <= ALWAYS_LABEL_UP_TO ? 1 : Math.max(1, Math.ceil(n / maxAxisLabels));

  let barsSvg = "", labelsSvg = "", hitSvg = "";
  rows.forEach((r, i) => {
    const raw = r[metric.field];
    const v = values[i];
    const cx = padL + bandW * i + bandW / 2;
    const barTop = y(Math.max(v, 0));
    const barBottom = y(Math.min(v, 0));
    const barH = Math.max(1.5, barBottom - barTop);
    const color = metric.signed ? (v >= 0 ? green : red) : accent;
    const valueLabel = raw == null ? "∞" : `${fmtNum(v, metric.decimals ?? 0)}${metric.unit ? " " + metric.unit : ""}`;
    const labelY = v >= 0 ? barTop - 6 : barBottom + 14;
    barsSvg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}" opacity="0.85" />`;
    // Wertelabel nur zeichnen, wenn es grob in die eigene Bandbreite passt -
    // sonst ueberlappen sich Nachbarlabels bei vielen/schmalen Balken (z.B.
    // 24 Stunden) und werden unleserlich. Der exakte Wert bleibt per Tooltip
    // abrufbar, auch wenn das Label hier ausgelassen wird.
    const estWidth = valueLabel.length * 6.3;
    if (estWidth <= bandW - 2) {
      barsSvg += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${text}" font-size="11" font-weight="600" text-anchor="middle">${valueLabel}</text>`;
    }
    if (i % axisLabelStep === 0) {
      // Auf den Abstand zur naechsten ANGEZEIGTEN Beschriftung kuerzen, nicht
      // auf eine Balkenbreite: wenn oben ausgeduennt wurde, steht jedem Label
      // ein Vielfaches davon zur Verfuegung (sonst wuerde "07:00" bei 17
      // Balken auf "07…" gestutzt, obwohl reichlich Platz ist).
      const maxChars = Math.max(3, Math.floor((bandW * axisLabelStep - 2) / 6.2));
      labelsSvg += `<text x="${cx.toFixed(1)}" y="${h - padB + 18}" fill="${faint}" font-size="10" text-anchor="middle">${escapeHtml(shortenLabel(r.label, Math.min(13, maxChars)))}</text>`;
    }
    hitSvg += `<rect class="chart-dot-hit" x="${(cx - bandW / 2).toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${h - padT - padB}" fill="transparent" data-day="${escapeHtml(r.label)}" data-value="${raw == null ? "" : v}" data-count="${r.trade_count}" />`;
  });

  // Kein preserveAspectRatio="none" mehr: w/h kommen jetzt von mountBarChart()
  // in echten Pixelmassen der Kachel, die viewBox entspricht also bereits der
  // tatsaechlichen Seitenverhaeltnis - eine nicht-uniforme Streckung (und
  // damit verzerrter, schwer lesbarer Text) faellt dadurch weg.
  return `<svg viewBox="0 0 ${w} ${h}">
    ${gridSvg}
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${w - padR}" y2="${zeroY.toFixed(1)}" stroke="${text}" stroke-width="1" opacity="0.5" />
    ${barsSvg}
    ${labelsSvg}
    ${hitSvg}
  </svg>`;
}

/* Zeichnet das Balkendiagramm in einen bereits im DOM haengenden, leeren
   .chart-wrap - braucht ein eingehaengtes Element zum Ausmessen (nicht nur
   einen HTML-String), damit die viewBox exakt der gerenderten Kachelgroesse
   entspricht statt einer festen 1000x260-Einheit, die je nach Kachelbreite
   unterschiedlich stark nicht-uniform gestreckt wuerde. */
function mountBarChart(wrap, rows, metric, tooltipRenderer) {
  const w = Math.max(220, Math.round(wrap.clientWidth) || 1000);
  const h = Math.max(120, Math.round(wrap.clientHeight) || 260);
  wrap.innerHTML = barChartSvg(rows, metric, w, h) + `<div class="chart-tooltip"></div>`;
  attachChartTooltip(wrap, tooltipRenderer);
}

function barTooltipRenderer(metric) {
  return (hit) => {
    const raw = hit.dataset.value;
    const valueText = raw === "" ? "∞" : `${fmtNum(parseFloat(raw), metric.decimals ?? 2)}${metric.unit ? " " + metric.unit : ""}`;
    return `<div class="chart-tooltip-date">${escapeHtml(hit.dataset.day)}</div>`
      + `<div class="chart-tooltip-value">${valueText}</div>`
      + `<div class="chart-tooltip-date">${hit.dataset.count} Trade${hit.dataset.count === "1" ? "" : "s"}</div>`;
  };
}

async function renderKpiWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/summary"));
  if (!data.trade_count) {
    body.innerHTML = `<div class="empty-state">Keine Trades im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  body.innerHTML = tile("Netto-P&L", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Trefferquote", fmtNum(data.win_rate, 1) + " %")
    + tile("Profit-Faktor", data.profit_factor === null ? "∞" : fmtNum(data.profit_factor, 2))
    + tile("Ø pro Trade", fmtSigned(data.expectancy, 1) + " $", cls(data.expectancy))
    + tile("Anzahl Trades", data.trade_count)
    + tile("Ø Gewinn", fmtNum(data.avg_win, 1) + " $", "pos")
    + tile("Ø Verlust", fmtNum(Math.abs(data.avg_loss), 1) + " $", "neg")
    + tile("Ø Haltedauer", fmtDuration(data.avg_duration_sec))
    + tile("Bester Trade", fmtSigned(data.best_trade) + " $", "pos")
    + tile("Schwächster Trade", fmtSigned(data.worst_trade) + " $", "neg");
}

async function renderEquityWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/equity"));
  if (data.trading_days < 2) {
    body.innerHTML = `<div class="empty-state">Mindestens 2 Handelstage im gewählten Zeitraum/Filter nötig.</div>`;
    return;
  }
  const values = data.curve.map(p => p.cum_net);
  const labels = data.curve.map(p => p.day);
  body.innerHTML = `<div class="analytics-equity-meta">
      <span>Max. Drawdown: <strong class="neg">${fmtNum(data.max_drawdown)} $</strong>${data.max_drawdown_day ? ` (${fmtDate(data.max_drawdown_day)})` : ""}</span>
      <span>Gewinn-/Verlusttage: <strong class="pos">${data.win_days}</strong> / <strong class="neg">${data.loss_days}</strong> (${fmtNum(data.win_days_pct, 1)} %)</span>
    </div>
    <div class="chart-wrap analytics-equity-chart">${lineChartSvg(values, labels, data.start_balance)}<div class="chart-tooltip"></div></div>`;
  attachChartTooltip(body.querySelector(".analytics-equity-chart"));
}

async function renderStreaksWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/equity"));
  if (!data.trading_days) {
    body.innerHTML = `<div class="empty-state">Keine Handelstage im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  const curLabel = data.current_streak_type === "win" ? "Gewinn-Serie" : data.current_streak_type === "loss" ? "Verlust-Serie" : "–";
  const curClass = data.current_streak_type === "win" ? "pos" : data.current_streak_type === "loss" ? "neg" : "";
  body.innerHTML = tile("Aktuelle Serie", data.current_streak ? `${data.current_streak} Tage` : "–", curClass)
    + tile("Serientyp", curLabel, curClass)
    + tile("Längste Gewinn-Serie", data.longest_win_streak + " Tage", "pos")
    + tile("Längste Verlust-Serie", data.longest_loss_streak + " Tage", "neg")
    + tile("Profitable Handelstage", `${fmtNum(data.win_days_pct, 1)} %`, cls(data.win_days_pct - 50))
    + tile("Handelstage gesamt", data.trading_days);
}

async function renderDistributionWidget(body) {
  const data = await api(withAnalyticsFilter("/api/analytics/distribution?bins=10"));
  if (!data.trade_count) {
    body.innerHTML = `<div class="empty-state">Keine Trades im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  const rows = data.bins.map(b => ({ label: b.label, total_net: b.count, trade_count: b.count }));
  const metric = { field: "total_net", unit: "", decimals: 0, signed: false };
  body.innerHTML = `<div class="analytics-equity-meta">
      <span>Ø Gewinn: <strong class="pos">${fmtNum(data.avg_win)} $</strong></span>
      <span>Ø Verlust: <strong class="neg">${fmtNum(data.avg_loss)} $</strong></span>
      <span>Größter Gewinn: <strong class="pos">${fmtNum(data.largest_win)} $</strong></span>
      <span>Größter Verlust: <strong class="neg">${fmtNum(data.largest_loss)} $</strong></span>
    </div>
    <div class="chart-wrap analytics-bar-chart"></div>`;
  mountBarChart(body.querySelector(".analytics-bar-chart"), rows, metric, (hit) =>
    `<div class="chart-tooltip-date">${escapeHtml(hit.dataset.day)} $</div><div class="chart-tooltip-value">${hit.dataset.count} Trades</div>`);
}

async function renderBreakdownWidget(body, widget) {
  const metric = ANALYTICS_METRICS.find(m => m.key === widget.metric) || ANALYTICS_METRICS[0];
  const data = await api(withAnalyticsFilter(`/api/analytics/breakdown?dimension=${encodeURIComponent(widget.dimension)}`));
  const rows = data.rows.filter(r => r.trade_count > 0);
  if (!rows.length) {
    body.innerHTML = `<div class="empty-state">Keine Daten für diese Auswertung im gewählten Zeitraum/Filter.</div>`;
    return;
  }
  body.innerHTML = `<div class="chart-wrap analytics-bar-chart"></div>`;
  mountBarChart(body.querySelector(".analytics-bar-chart"), rows, metric, barTooltipRenderer(metric));
}

function analyticsWidgetRenderer(widget) {
  if (widget.type === "kpi") return renderKpiWidget;
  if (widget.type === "equity") return renderEquityWidget;
  if (widget.type === "streaks") return renderStreaksWidget;
  if (widget.type === "distribution") return renderDistributionWidget;
  if (widget.type === "breakdown") return (body) => renderBreakdownWidget(body, widget);
  return async (body) => { body.innerHTML = `<div class="empty-state">Unbekannter Auswertungstyp.</div>`; };
}

const ANALYTICS_WIDE_TYPES = new Set(["equity", "distribution"]);

function analyticsWidgetCardHtml(widget) {
  const wideClass = ANALYTICS_WIDE_TYPES.has(widget.type) ? " analytics-widget-wide" : "";
  const bodyClass = (widget.type === "kpi" || widget.type === "streaks") ? " stat-grid" : "";
  return `
    <div class="card analytics-widget${wideClass}" data-widget-id="${widget.id}" draggable="true">
      <div class="analytics-widget-header">
        <div class="analytics-widget-header-left">
          <span class="analytics-widget-handle" title="Ziehen zum Umsortieren">⠿</span>
          <div class="analytics-widget-title">${escapeHtml(widget.title)}</div>
        </div>
        <div class="analytics-widget-actions">
          <button type="button" class="analytics-widget-edit" title="Bearbeiten" aria-label="Auswertung bearbeiten">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="analytics-widget-remove" title="Entfernen" aria-label="Auswertung entfernen">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="analytics-widget-body${bodyClass}"><div class="empty-state">Lädt…</div></div>
    </div>`;
}

async function renderAnalyticsWidget(widget) {
  const card = document.querySelector(`.analytics-widget[data-widget-id="${widget.id}"]`);
  if (!card) return;
  const body = card.querySelector(".analytics-widget-body");
  try {
    await analyticsWidgetRenderer(widget)(body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
  }
}

export async function renderAllAnalyticsWidgets() {
  await Promise.all(analyticsWidgets.map(w => renderAnalyticsWidget(w)));
}

function mountAnalyticsGrid() {
  const grid = document.getElementById("analytics-grid");
  if (!grid) return;
  grid.innerHTML = analyticsWidgets.length
    ? analyticsWidgets.map(analyticsWidgetCardHtml).join("")
    : `<div class="empty-state">Noch keine Auswertungen. Klicke auf „+ Auswertung", um deine erste hinzuzufügen.</div>`;
  grid.querySelectorAll(".analytics-widget").forEach(card => {
    const widget = analyticsWidgets.find(w => w.id === card.dataset.widgetId);
    if (!widget) return;
    card.querySelector(".analytics-widget-edit").addEventListener("click", () => openAnalyticsWidgetEditor(widget));
    card.querySelector(".analytics-widget-remove").addEventListener("click", () => removeAnalyticsWidget(widget.id));
  });
  wireAnalyticsWidgetDrag(grid);
}

/* Kacheln per Drag & Drop umsortieren: anders als die einspaltigen Listen
   (Sidebar, Notizbuch-Baum) ist das Auswertungs-Grid zweispaltig, deshalb
   grid:true - die Zielposition entscheidet ueber Y (oberhalb/unterhalb der
   Karte) UND X (linke/rechte Haelfte), nicht nur ueber Y. */
function wireAnalyticsWidgetDrag(grid) {
  makeSortable(grid, ".analytics-widget", (ids) => {
    analyticsWidgets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    saveAnalyticsWidgets();
  }, { grid: true, keyAttr: "widgetId" });
}

function removeAnalyticsWidget(id) {
  analyticsWidgets = analyticsWidgets.filter(w => w.id !== id);
  saveAnalyticsWidgets();
  mountAnalyticsGrid();
  renderAllAnalyticsWidgets();
}

/* Hinzufuegen/Bearbeiten im bestehenden Modal (gleiche Ueberlagerung wie
   Tages-/Journal-Modal) statt einer eigenen Dialog-Komponente. */
async function openAnalyticsWidgetEditor(existingWidget) {
  const dims = await getAnalyticsDimensions();
  const isEdit = !!existingWidget;
  const w = existingWidget || { type: "breakdown", dimension: dims[0]?.key, metric: "net", title: "" };

  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <section class="view">
      <header class="view-header"><h1>${isEdit ? "Auswertung bearbeiten" : "Auswertung hinzufügen"}</h1></header>
      <form class="account-form" id="widget-form">
        <input type="text" name="title" placeholder="Titel" value="${escapeHtml(w.title || "")}" required>
        <label class="widget-form-label">Typ
          <select name="type">
            <option value="kpi">Kern-Kennzahlen</option>
            <option value="equity">Equity-Kurve &amp; Drawdown</option>
            <option value="streaks">Serien &amp; Konsistenz</option>
            <option value="breakdown">Balkendiagramm nach Kategorie</option>
            <option value="distribution">P&amp;L-Verteilung</option>
          </select>
        </label>
        <label class="widget-form-label" id="widget-dim-row">Gruppieren nach
          <select name="dimension">${dims.map(d => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join("")}</select>
        </label>
        <label class="widget-form-label" id="widget-metric-row">Kennzahl
          <select name="metric">${ANALYTICS_METRICS.map(m => `<option value="${m.key}">${escapeHtml(m.label)}</option>`).join("")}</select>
        </label>
        <button type="submit" class="btn btn-primary">${isEdit ? "Speichern" : "Hinzufügen"}</button>
      </form>
    </section>`;
  overlay.classList.add("visible");

  const form = document.getElementById("widget-form");
  form.type.value = w.type;
  form.dimension.value = w.dimension || dims[0]?.key;
  form.metric.value = w.metric || "net";

  const dimRow = document.getElementById("widget-dim-row");
  const metricRow = document.getElementById("widget-metric-row");
  const updateVisibility = () => {
    const show = form.type.value === "breakdown";
    dimRow.style.display = show ? "" : "none";
    metricRow.style.display = show ? "" : "none";
  };
  form.type.addEventListener("change", updateVisibility);
  updateVisibility();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    const type = form.type.value;
    const newWidget = {
      id: existingWidget ? existingWidget.id : "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type, title,
    };
    if (type === "breakdown") {
      newWidget.dimension = form.dimension.value;
      newWidget.metric = form.metric.value;
    }
    if (isEdit) {
      const idx = analyticsWidgets.findIndex(x => x.id === existingWidget.id);
      analyticsWidgets[idx] = newWidget;
    } else {
      analyticsWidgets.push(newWidget);
    }
    saveAnalyticsWidgets();
    closeModal();
    mountAnalyticsGrid();
    renderAllAnalyticsWidgets();
  });
}

function onAnalyticsRangeChange() {
  state.analyticsRange = {
    start: document.getElementById("an-range-start").value || null,
    end: document.getElementById("an-range-end").value || null,
  };
  saveAnalyticsRangeState();
  renderAllAnalyticsWidgets();
}

export async function openAnalytics() {
  state.view = "analytics";
  state.currentDay = null;
  setActiveNav("analytics");

  await mountView("tpl-analytics");
  loadAnalyticsRangeState();

  const accToggle = document.getElementById("an-account-filter-toggle");
  const accPanel = document.getElementById("an-account-filter-panel");
  accToggle.addEventListener("click", (e) => { e.stopPropagation(); accPanel.hidden = !accPanel.hidden; });
  await renderAccountFilter("an-account-filter-panel", "an-account-filter-count");

  const tagToggle = document.getElementById("an-tag-filter-toggle");
  const tagPanel = document.getElementById("an-tag-filter-panel");
  tagToggle.addEventListener("click", (e) => { e.stopPropagation(); tagPanel.hidden = !tagPanel.hidden; });
  await renderTagFilter("an-tag-filter-list", "an-tag-logic-toggle");

  document.getElementById("an-range-start").value = state.analyticsRange.start || "";
  document.getElementById("an-range-end").value = state.analyticsRange.end || "";
  document.getElementById("an-range-start").addEventListener("change", onAnalyticsRangeChange);
  document.getElementById("an-range-end").addEventListener("change", onAnalyticsRangeChange);
  document.getElementById("an-range-clear").addEventListener("click", () => {
    state.analyticsRange = { start: null, end: null };
    saveAnalyticsRangeState();
    document.getElementById("an-range-start").value = "";
    document.getElementById("an-range-end").value = "";
    renderAllAnalyticsWidgets();
  });

  document.getElementById("an-add-widget-btn").addEventListener("click", () => openAnalyticsWidgetEditor(null));

  analyticsWidgets = loadAnalyticsWidgets();
  mountAnalyticsGrid();
  await renderAllAnalyticsWidgets();
}

export async function openAccounts() {
  state.view = "accounts";
  state.currentDay = null;
  setActiveNav("accounts");

  const content = await mountView("tpl-accounts");

  const platforms = await getPlatforms();
  const platformSelect = document.getElementById("account-platform-select");
  platformSelect.innerHTML = platforms.map(p => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)}</option>`).join("");

  const credentialFields = [
    document.getElementById("account-login"),
    document.getElementById("account-password"),
    document.getElementById("account-server"),
  ];
  const hint = document.getElementById("account-hint");
  const updateFormForPlatform = () => {
    const platform = platforms.find(p => p.key === platformSelect.value);
    const manual = platform && platform.manual;
    credentialFields.forEach(f => { f.hidden = manual; f.required = !manual; });
    hint.textContent = manual
      ? "Dieses Konto hat keine automatische Sync-Anbindung. Trades ordnest du ihm weiter unten beim CSV-Import zu (Dropdown über \"Datei wählen\")."
      : "Nutze ausschließlich das Investor-/Read-Only-Passwort. Zugangsdaten werden nur lokal in deiner SQLite-Datenbank gespeichert und nie an Dritte übertragen.";
  };
  platformSelect.addEventListener("change", updateFormForPlatform);
  updateFormForPlatform();

  const form = document.getElementById("account-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.starting_balance = parseFloat(payload.starting_balance) || 0;
    try {
      await api("/api/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      form.reset();
      updateFormForPlatform();
      await renderAccounts();
      await renderAccountFilter();
      await renderImportAccountSelect();
    } catch (err) {
      showAppError(err.message);
    }
  });

  await renderAccounts();
  await renderImportAccountSelect();

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("csv-input").click();
  });

  document.getElementById("csv-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const accountId = document.getElementById("import-account-select").value;
    const statusEl = document.getElementById("import-status");
    statusEl.className = "import-status";
    statusEl.textContent = "Importiere…";
    const form = new FormData();
    form.append("file", file);
    if (accountId) form.append("account_id", accountId);
    try {
      const res = await api("/api/import", { method: "POST", body: form });
      statusEl.className = "import-status ok";
      statusEl.textContent = `${res.inserted} von ${res.parsed} Trades importiert.`;
      await renderAccountFilter();
      if (res.days && res.days.length) openDay(res.days[res.days.length - 1]);
    } catch (err) {
      statusEl.className = "import-status err";
      statusEl.textContent = err.message;
    }
    e.target.value = "";
  });
}

export async function renderAccounts() {
  const [accounts, platforms] = await Promise.all([api("/api/accounts"), getPlatforms()]);
  const list = document.getElementById("account-list");
  if (!accounts.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Konten verbunden.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const acc of accounts) {
    const platformInfo = platforms.find(p => p.key === acc.platform);
    const isManual = platformInfo ? platformInfo.manual : true;
    const platformName = platformInfo ? platformInfo.name : acc.platform;

    const row = document.createElement("div");
    row.className = "account-row";
    const lastSync = acc.last_sync ? fmtDateTime(acc.last_sync) : "noch nie";
    row.innerHTML = `
      <div class="account-info">
        <div class="account-name-row">
          <div class="account-name">${escapeHtml(acc.name)}</div>
          <button type="button" class="account-name-edit-btn" title="Konto umbenennen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
        <form class="account-name-edit-form" hidden>
          <input type="text" class="acc-name-input" value="${escapeHtml(acc.name)}" required>
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary acc-name-cancel">Abbrechen</button>
        </form>
        <div class="account-meta">${platformName}${isManual ? "" : ` · Login ${acc.login} · Server ${acc.server}`}</div>
        <div class="account-meta">${isManual ? "Zuordnung per CSV-Import" : `Letzter Sync: ${lastSync}`}</div>
        ${acc.synced_balance !== null
          ? `<div class="account-meta">Kontostand (aus Sync): ${fmtNum(acc.synced_balance)} $</div>`
          : `<div class="account-meta account-balance-edit">
               Startkapital: <input type="number" step="0.01" class="acc-starting-balance" value="${acc.starting_balance || 0}">
               <button type="button" class="btn btn-secondary acc-balance-save">Speichern</button>
             </div>`}
      </div>
      <div class="account-actions">
        ${isManual
          ? `<button class="btn btn-secondary acc-reassign">Bisherige nicht zugeordnete Trades zuweisen</button>`
          : `<button class="btn btn-secondary acc-sync">Jetzt synchronisieren</button>
             <button class="btn btn-secondary acc-sync-full">Vollständig neu synchronisieren</button>`}
        <button class="btn btn-secondary acc-delete">Entfernen</button>
      </div>
      <div class="account-status"></div>
    `;
    const statusEl = row.querySelector(".account-status");

    const nameRow = row.querySelector(".account-name-row");
    const nameForm = row.querySelector(".account-name-edit-form");
    const nameInput = row.querySelector(".acc-name-input");
    row.querySelector(".account-name-edit-btn").addEventListener("click", () => {
      nameRow.hidden = true;
      nameForm.hidden = false;
      nameInput.focus();
      nameInput.select();
    });
    row.querySelector(".acc-name-cancel").addEventListener("click", () => {
      nameInput.value = acc.name;
      nameForm.hidden = true;
      nameRow.hidden = false;
    });
    nameForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const newName = nameInput.value.trim();
      if (!newName || newName === acc.name) {
        nameForm.hidden = true;
        nameRow.hidden = false;
        return;
      }
      try {
        await api(`/api/accounts/${acc.id}/name`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        acc.name = newName;
        row.querySelector(".account-name").textContent = newName;
        nameForm.hidden = true;
        nameRow.hidden = false;
        statusEl.className = "account-status ok";
        statusEl.textContent = "Konto umbenannt.";
        await renderAccountFilter();
        await renderImportAccountSelect();
        if (state.view === "overview" || state.view === "trades") refreshCurrentView();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    });

    const balanceSaveBtn = row.querySelector(".acc-balance-save");
    if (balanceSaveBtn) balanceSaveBtn.addEventListener("click", async () => {
      const input = row.querySelector(".acc-starting-balance");
      const value = parseFloat(input.value) || 0;
      try {
        await api(`/api/accounts/${acc.id}/starting-balance`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starting_balance: value }),
        });
        statusEl.className = "account-status ok";
        statusEl.textContent = "Startkapital gespeichert.";
        if (state.view === "overview") refreshCurrentView();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    });

    async function runSync(full) {
      statusEl.textContent = full ? "Synchronisiere vollstaendig (kann etwas dauern)…" : "Synchronisiere…";
      statusEl.className = "account-status";
      try {
        const res = await api(`/api/accounts/${acc.id}/sync${full ? "?full=true" : ""}`, { method: "POST" });
        statusEl.className = "account-status ok";
        statusEl.textContent = `${res.inserted} neue Trades importiert (${res.parsed} gefunden).`;
        await renderAccountFilter();
      } catch (err) {
        statusEl.className = "account-status err";
        statusEl.textContent = err.message;
      }
    }

    const syncBtn = row.querySelector(".acc-sync");
    if (syncBtn) syncBtn.addEventListener("click", () => runSync(false));

    const syncFullBtn = row.querySelector(".acc-sync-full");
    if (syncFullBtn) {
      syncFullBtn.addEventListener("click", () => {
        if (!confirm("Die letzten 365 Tage komplett neu von MetaTrader abfragen? Geloeschte Trades aus diesem Zeitraum werden dabei wieder importiert.")) return;
        runSync(true);
      });
    }

    const reassignBtn = row.querySelector(".acc-reassign");
    if (reassignBtn) {
      reassignBtn.addEventListener("click", async () => {
        if (!confirm(`Alle bisher nicht zugeordneten "${platformName}"-Trades dem Konto "${acc.name}" zuweisen?`)) return;
        statusEl.textContent = "Ordne zu…";
        statusEl.className = "account-status";
        try {
          const res = await api("/api/trades/reassign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acc.id, source: acc.platform }),
          });
          statusEl.className = "account-status ok";
          statusEl.textContent = `${res.updated} Trade(s) zugeordnet.`;
          await renderAccountFilter();
        } catch (err) {
          statusEl.className = "account-status err";
          statusEl.textContent = err.message;
        }
      });
    }

    row.querySelector(".acc-delete").addEventListener("click", () => deleteAccountFlow(acc.id, acc.name));

    list.appendChild(row);
  }
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE");
}
