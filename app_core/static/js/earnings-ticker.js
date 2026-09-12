/* Earnings-Ticker: Laufband oben auf jeder Seite mit den naechsten
   Quartalszahlen der aktuell verfolgten Unternehmen (Top 10 nach Nasdaq-100-
   Gewichtung, siehe app/weights.py). Backend liefert nur Rohdaten (Symbol,
   Name, Datum oder null, Handelszeitpunkt) - die Dringlichkeits-Einstufung
   (heute/morgen/...) und deren Farbe passiert hier, analog dazu wie andere
   Module ihre Anzeige clientseitig aus rohen API-Daten aufbauen. Welche der
   verfolgten Firmen im Ticker erscheinen, ist reine Client-Praeferenz
   (localStorage "earningsTickerExcluded", analog zu overviewHiddenColumns). */

import { api, escapeHtml, readStoredArray, writeStored } from './core.js';

const SPEED_SECONDS = { slow: 52, normal: 34, fast: 18 };

const WEEKDAY_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const DATE_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" });
const PCT_FMT = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const TIME_LABEL = {
  "time-pre-market": "vor Handelsstart",
  "time-after-hours": "nach Handelsschluss",
};

function parseIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayDiff(target) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function countdownLabel(diff) {
  if (diff <= 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff <= 6) return `in ${diff} Tagen`;
  if (diff <= 13) return "nächste Woche";
  if (diff <= 27) return `in ${Math.round(diff / 7)} Wochen`;
  if (diff <= 45) return "in 1 Monat";
  return `in ${Math.round(diff / 30)} Monaten`;
}

function severityClass(diff) {
  if (diff <= 1) return "sev-today";
  if (diff <= 13) return "sev-week";
  if (diff <= 31) return "sev-month";
  return "sev-later";
}

function renderItem(item) {
  if (!item.date) {
    return `<span class="earnings-ticker-item unknown">`
      + `<span class="earnings-ticker-co">${escapeHtml(item.name)}</span>`
      + `<span class="earnings-ticker-when">Termin noch nicht bekannt</span>`
      + `</span>`;
  }
  const target = parseIsoDate(item.date);
  const diff = dayDiff(target);
  const sev = severityClass(diff);
  const dateText = `${WEEKDAY_FMT.format(target)}, ${DATE_FMT.format(target)}`;
  const timeText = TIME_LABEL[item.time] ? ` · ${TIME_LABEL[item.time]}` : "";
  return `<span class="earnings-ticker-item">`
    + `<span class="earnings-ticker-co">${escapeHtml(item.name)}</span>`
    + `<span class="earnings-ticker-when ${sev}">${countdownLabel(diff)}</span>`
    + `<span class="earnings-ticker-date">${dateText}${timeText}</span>`
    + `</span>`;
}

function excludedTickers() {
  return new Set(readStoredArray("earningsTickerExcluded") || []);
}

let allItems = [];

function renderMarquee() {
  const marquee = document.getElementById("earnings-ticker-marquee");
  if (!marquee) return;
  const excluded = excludedTickers();
  const visible = allItems.filter(i => !excluded.has(i.symbol));
  if (!visible.length) {
    marquee.innerHTML = `<span class="earnings-ticker-item earnings-ticker-empty">Keine verfolgten Unternehmen ausgewählt</span>`;
    return;
  }
  const html = visible.map(renderItem).join("");
  // Inhalt doppelt einfuegen, damit die Endlos-Schleife (-50%) nahtlos ist.
  marquee.innerHTML = html + html;
}

async function loadItems() {
  try {
    const res = await api("/api/earnings/upcoming");
    // Termine zuerst (aufsteigend), Firmen ohne bekannten Termin ans Ende -
    // das Backend sortiert bereits so, hier nur zur Robustheit falls sich das
    // mal aendert.
    allItems = (res.items || []).sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    renderMarquee();
  } catch (e) {
    // Ticker darf beim Fehlschlagen (Server kurz nicht erreichbar, noch kein
    // erster Scan gelaufen) einfach leer/alt bleiben - kein showAppError, das
    // waere fuer eine reine Zusatzinfo zu aufdringlich.
  }
}

/* ---------- Modus: durchlaufend vs. statisch ---------- */

function currentSpeedSeconds() {
  const key = localStorage.getItem("earningsTickerSpeed") || "normal";
  return SPEED_SECONDS[key] || SPEED_SECONDS.normal;
}

function isAutoScroll() {
  return localStorage.getItem("earningsTickerAutoScroll") !== "false";
}

function applyRestState(marquee) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    marquee.style.animation = "none";
    marquee.style.transform = "translateX(0)";
    return;
  }
  if (isAutoScroll()) {
    marquee.style.transform = "";
    marquee.style.animation = `earnings-ticker-scroll ${currentSpeedSeconds()}s linear infinite`;
    marquee.style.animationPlayState = "running";
  } else {
    marquee.style.animation = "none";
    marquee.style.transform = "translateX(0)";
  }
}

export function applyTickerMode() {
  const marquee = document.getElementById("earnings-ticker-marquee");
  if (marquee) applyRestState(marquee);
}

function setupHoverBehaviour() {
  const track = document.getElementById("earnings-ticker-track");
  const marquee = document.getElementById("earnings-ticker-marquee");
  if (!track || !marquee) return;

  track.addEventListener("mouseenter", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (isAutoScroll()) {
      marquee.style.animationPlayState = "paused";
    } else {
      marquee.style.animation = `earnings-ticker-scroll ${currentSpeedSeconds()}s linear infinite`;
    }
  });
  track.addEventListener("mouseleave", () => applyRestState(marquee));
}

/* ---------- Ein-/Ausblenden ---------- */

function applyEnabledState() {
  const enabled = localStorage.getItem("earningsTickerEnabled") !== "false";
  document.documentElement.setAttribute("data-earnings-ticker", enabled ? "" : "hidden");
  return enabled;
}

function setEnabled(enabled) {
  localStorage.setItem("earningsTickerEnabled", String(enabled));
  applyEnabledState();
}

export function initEarningsTicker() {
  applyEnabledState();
  setupHoverBehaviour();
  applyTickerMode();
  loadItems();
  // Termine aendern sich hoechstens einmal taeglich (siehe main.py) - stuendlich
  // reicht, damit ein neuer Scan-Stand zeitnah ankommt, ohne staendig zu fragen.
  setInterval(loadItems, 60 * 60 * 1000);

  document.getElementById("earnings-ticker-collapse")?.addEventListener("click", () => {
    setEnabled(false);
  });
}

/* ---------- Einstellungen: allgemeine Ticker-Optionen ---------- */

export function renderEarningsTickerSettings() {
  const enabledToggle = document.getElementById("earnings-ticker-enabled-toggle");
  const autoScrollToggle = document.getElementById("earnings-ticker-autoscroll-toggle");
  const speedSelect = document.getElementById("earnings-ticker-speed-select");
  const speedHint = document.getElementById("earnings-ticker-speed-hint");
  if (!enabledToggle || !autoScrollToggle || !speedSelect) return;

  enabledToggle.checked = localStorage.getItem("earningsTickerEnabled") !== "false";
  autoScrollToggle.checked = isAutoScroll();
  speedSelect.value = localStorage.getItem("earningsTickerSpeed") || "normal";

  const updateSpeedHint = () => {
    speedHint.textContent = autoScrollToggle.checked
      ? "Wie schnell der Text durchlaeuft."
      : "Wie schnell der Text durchlaeuft, wenn du mit der Maus draueber gehst.";
  };
  updateSpeedHint();

  enabledToggle.addEventListener("change", () => setEnabled(enabledToggle.checked));

  autoScrollToggle.addEventListener("change", () => {
    localStorage.setItem("earningsTickerAutoScroll", String(autoScrollToggle.checked));
    updateSpeedHint();
    applyTickerMode();
  });

  speedSelect.addEventListener("change", () => {
    localStorage.setItem("earningsTickerSpeed", speedSelect.value);
    applyTickerMode();
  });

  renderTrackedCompaniesSettings();
}

/* ---------- Einstellungen: verfolgte Unternehmen (Top 10 nach Gewichtung) ---------- */

const SYNC_FMT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function formatLastSync(iso) {
  if (!iso) return "noch nie";
  try {
    return SYNC_FMT.format(new Date(iso));
  } catch (e) {
    return "noch nie";
  }
}

function renderCompanyRows(companies) {
  const list = document.getElementById("earnings-companies-list");
  if (!list) return;
  const excluded = excludedTickers();
  if (!companies.length) {
    list.innerHTML = `<div class="empty-state">Noch kein Gewichtungsabgleich gelaufen.</div>`;
    return;
  }
  list.innerHTML = companies.map(c => `
    <div class="weight-row">
      <span class="weight-rank">${c.rank}</span>
      <input type="checkbox" class="weight-checkbox" data-ticker="${escapeHtml(c.ticker)}" ${excluded.has(c.ticker) ? "" : "checked"}>
      <span class="weight-badge">${escapeHtml(c.ticker)}</span>
      <span class="weight-name">
        <span class="n">${escapeHtml(c.name)}</span>
        ${c.is_new ? `<span class="weight-new">NEU</span>` : ""}
      </span>
      <span class="weight-bar-wrap">
        <span class="weight-pct">${PCT_FMT.format(c.weight_pct)} %</span>
        <span class="weight-bar-track"><span class="weight-bar-fill" style="width:${Math.min(100, c.weight_pct * 10)}%"></span></span>
      </span>
    </div>
  `).join("");

  list.querySelectorAll(".weight-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const current = excludedTickers();
      if (cb.checked) current.delete(cb.dataset.ticker);
      else current.add(cb.dataset.ticker);
      writeStored("earningsTickerExcluded", [...current]);
      renderMarquee();
    });
  });
}

async function renderTrackedCompaniesSettings() {
  const syncInfo = document.getElementById("earnings-companies-sync-info");
  const resyncBtn = document.getElementById("earnings-companies-resync-btn");
  if (!syncInfo || !resyncBtn) return;

  async function load() {
    const res = await api("/api/earnings/companies");
    syncInfo.textContent = `Zuletzt mit dem Nasdaq-100 abgeglichen: ${formatLastSync(res.last_sync)} (automatisch wöchentlich)`;
    renderCompanyRows(res.companies || []);
  }

  resyncBtn.onclick = async () => {
    resyncBtn.disabled = true;
    resyncBtn.textContent = "Gleiche ab …";
    try {
      await api("/api/earnings/companies/resync", { method: "POST" });
      await load();
      await loadItems();
    } finally {
      resyncBtn.disabled = false;
      resyncBtn.textContent = "Jetzt abgleichen";
    }
  };

  await load();
}
