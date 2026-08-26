const state = { view: "overview", currentDay: null, filterMode: "all", filterKeys: [] };

/* ---------- Konten-Filter ---------- */

function loadFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem("accountFilter") || "null");
    if (saved && saved.mode) {
      state.filterMode = saved.mode;
      state.filterKeys = saved.keys || [];
    }
  } catch (e) { /* ignore */ }
}
function saveFilterState() {
  localStorage.setItem("accountFilter", JSON.stringify({ mode: state.filterMode, keys: state.filterKeys }));
}
function accountsQS() {
  if (state.filterMode !== "selected" || !state.filterKeys.length) return "";
  return `accounts=${encodeURIComponent(state.filterKeys.join(","))}`;
}
function withFilter(url) {
  const qs = accountsQS();
  if (!qs) return url;
  return url + (url.includes("?") ? "&" : "?") + qs;
}

async function renderAccountFilter() {
  const options = await api("/api/account-options");
  const list = document.getElementById("account-filter-list");
  list.innerHTML = "";

  const masterLabel = document.createElement("label");
  masterLabel.className = "filter-item master";
  masterLabel.innerHTML = `<input type="checkbox" id="filter-all"> Alle Konten`;
  list.appendChild(masterLabel);
  const masterInput = masterLabel.querySelector("input");
  masterInput.checked = state.filterMode === "all";
  masterInput.addEventListener("change", () => {
    state.filterMode = "all";
    state.filterKeys = [];
    saveFilterState();
    renderAccountFilter();
    refreshCurrentView();
  });

  if (!options.length) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.style.padding = "6px 0";
    hint.textContent = "Noch keine Konten/Importe.";
    list.appendChild(hint);
    return;
  }

  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "filter-item";
    label.innerHTML = `<input type="checkbox" data-key="${opt.key}"> ${opt.name}`;
    const input = label.querySelector("input");
    input.checked = state.filterMode === "selected" && state.filterKeys.includes(opt.key);
    input.addEventListener("change", () => {
      const checked = Array.from(list.querySelectorAll("input[data-key]:checked")).map(i => i.dataset.key);
      if (!checked.length) {
        state.filterMode = "all";
        state.filterKeys = [];
      } else {
        state.filterMode = "selected";
        state.filterKeys = checked;
      }
      saveFilterState();
      renderAccountFilter();
      refreshCurrentView();
    });
    list.appendChild(label);
  }
}

function refreshCurrentView() {
  refreshDayList();
  if (state.view === "overview") openOverview();
  else if (state.view === "month") renderMonth();
  else if (state.view === "day" && state.currentDay) populateDay(document.getElementById("content"), state.currentDay);
}

/* ---------- Theme ---------- */

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const apply = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    btn.textContent = theme === "light" ? "☀️" : "🌙";
  };
  apply(localStorage.getItem("theme") || "dark");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    apply(next);
  });
}
initTheme();

/* ---------- Sidebar ein-/ausklappen ---------- */

function initSidebarCollapse() {
  const btn = document.getElementById("sidebar-collapse");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-sidebar") !== "collapsed";
    document.documentElement.setAttribute("data-sidebar", next ? "collapsed" : "expanded");
    localStorage.setItem("sidebarCollapsed", String(next));
  });
}
initSidebarCollapse();

/* ---------- Schriftart ---------- */

const FONT_OPTIONS = [
  { key: "system", name: "Standard (System)", stack: "-apple-system, 'Segoe UI', Inter, Roboto, sans-serif" },
  { key: "mono", name: "Monospace (Terminal)", stack: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace" },
  { key: "serif", name: "Serif (Editorial)", stack: "Georgia, 'Times New Roman', Times, serif" },
  { key: "verdana", name: "Verdana (Klar & breit)", stack: "Verdana, Tahoma, Geneva, sans-serif" },
  { key: "trebuchet", name: "Trebuchet (Rund & modern)", stack: "'Trebuchet MS', 'Century Gothic', sans-serif" },
];

function applyFont(key) {
  document.documentElement.setAttribute("data-font", key);
}

function renderFontSettings() {
  const grid = document.getElementById("font-grid");
  const current = localStorage.getItem("fontOption") || "system";
  grid.innerHTML = "";
  for (const opt of FONT_OPTIONS) {
    const card = document.createElement("button");
    card.className = "font-card" + (opt.key === current ? " active" : "");
    card.style.fontFamily = opt.stack;
    card.innerHTML = `
      <div class="font-name">${opt.name}</div>
      <div class="font-preview-title">Aa Bb Trade Journal</div>
      <div class="font-preview-body">Der schnelle Fuchs springt über den Handelstag.</div>
      <div class="font-preview-nums">253,84 $ · 14,00 Pkt · -114,36 $</div>
    `;
    card.addEventListener("click", () => {
      localStorage.setItem("fontOption", opt.key);
      applyFont(opt.key);
      renderFontSettings();
    });
    grid.appendChild(card);
  }
}

async function openSettings() {
  state.view = "settings";
  state.currentDay = null;
  setActiveNav("settings");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-settings").content.cloneNode(true));
  renderFontSettings();
  await renderSettingsAccountDelete();
}

async function renderSettingsAccountDelete() {
  const select = document.getElementById("settings-account-select");
  const btn = document.getElementById("settings-account-delete-btn");
  const accounts = await api("/api/accounts");

  if (!accounts.length) {
    select.innerHTML = "";
    select.disabled = true;
    btn.disabled = true;
    document.getElementById("settings-account-hint").textContent = "Keine Konten vorhanden.";
    return;
  }
  select.disabled = false;
  btn.disabled = false;
  document.getElementById("settings-account-hint").textContent = "";
  select.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("");

  btn.onclick = async () => {
    const acc = accounts.find(a => String(a.id) === select.value);
    if (!acc) return;
    const deleted = await deleteAccountFlow(acc.id, acc.name);
    if (deleted) await renderSettingsAccountDelete();
  };
}

function fmtNum(n, decimals = 2) {
  return Number(n).toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtSigned(n, decimals = 2) {
  const s = fmtNum(Math.abs(n), decimals);
  return (n < 0 ? "-" : "") + s;
}
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} Sek`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} Min`;
}
function cls(n) { return n >= 0 ? "pos" : "neg"; }

function attachOutsideClose(overlayEl, closeFn) {
  // Schliesst nur, wenn Mousedown UND Click beide direkt auf dem Hintergrund
  // (nicht auf der Karte) lagen - verhindert versehentliches Schliessen,
  // wenn z.B. ein Resize-Drag am Kartenrand endet oder Text ausserhalb selektiert wird.
  let downOnOverlay = false;
  overlayEl.addEventListener("mousedown", (e) => {
    downOnOverlay = e.target === overlayEl;
  });
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl && downOnOverlay) closeFn();
  });
}

/* ---------- Zweistufiger Loesch-Dialog ---------- */

function confirmDelete(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Nein</button>
          <button class="btn btn-danger confirm-yes">Ja</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }
    attachOutsideClose(overlay, () => cleanup(false));

    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => {
      const card = overlay.querySelector(".modal-card");
      card.innerHTML = `
        <div class="confirm-message">Zum endgültigen Bestätigen bitte "Löschen" eintippen:</div>
        <input type="text" class="confirm-input" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-cancel">Abbrechen</button>
          <button class="btn btn-danger confirm-final" disabled>Endgültig löschen</button>
        </div>`;
      const input = card.querySelector(".confirm-input");
      const finalBtn = card.querySelector(".confirm-final");
      input.addEventListener("input", () => {
        finalBtn.disabled = input.value !== "Löschen";
      });
      card.querySelector(".confirm-cancel").addEventListener("click", () => cleanup(false));
      finalBtn.addEventListener("click", () => cleanup(true));
      input.focus();
    });
  });
}

/* Gemeinsamer Ablauf fuer Konto-Loeschung, aufgerufen sowohl von der
   Konten-Seite als auch von den Einstellungen - vermeidet doppelte
   Confirm-/Request-/Refresh-Logik an zwei Stellen. */
async function deleteAccountFlow(accountId, accountName) {
  const ok = await confirmDelete(
    `Konto "${accountName}" wirklich entfernen? Bereits importierte Trades bleiben erhalten, verlieren aber die Zuordnung zu diesem Konto.`
  );
  if (!ok) return false;
  await api(`/api/accounts/${accountId}`, { method: "DELETE" });
  await renderAccounts();
  await renderAccountFilter();
  await renderImportAccountSelect();
  return true;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Fehler");
  }
  return res.json();
}

/* ---------- Sidebar / Day list ---------- */

async function refreshDayList() {
  const days = await api(withFilter("/api/days"));
  const list = document.getElementById("day-list");
  list.innerHTML = "";
  if (!days.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Daten.<br>CSV importieren.</div>`;
    return;
  }
  for (const d of days) {
    const btn = document.createElement("button");
    btn.className = "day-row" + (state.currentDay === d.day ? " active" : "");
    btn.innerHTML = `<span class="d-date">${d.day}</span><span class="d-net ${cls(d.net_usd)}">${fmtSigned(d.net_usd)} $</span>`;
    btn.addEventListener("click", () => openDay(d.day));
    list.appendChild(btn);
  }
}

/* ---------- Views ---------- */

function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
}

async function openOverview() {
  state.view = "overview";
  state.currentDay = null;
  setActiveNav("overview");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-overview").content.cloneNode(true));

  const data = await api(withFilter("/api/overview"));

  const statGrid = document.getElementById("ov-stats");
  statGrid.innerHTML = tile("Netto gesamt", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Trades gesamt", data.total_trades)
    + tile("Handelstage", data.trading_days)
    + tile("Bester Tag", data.best_day ? `${data.best_day.day} (${fmtSigned(data.best_day.net_usd)} $)` : "–")
    + tile("Schwächster Tag", data.worst_day ? `${data.worst_day.day} (${fmtSigned(data.worst_day.net_usd)} $)` : "–");

  const chartWrap = document.getElementById("ov-chart");
  if (data.curve.length > 1) {
    chartWrap.innerHTML = lineChartSvg(data.curve.map(p => p.cum_net), data.curve.map(p => p.day));
  } else {
    chartWrap.innerHTML = `<div class="empty-state">Mindestens 2 Tage nötig für eine Kurve.</div>`;
  }

  const tbody = document.querySelector("#ov-days-table tbody");
  tbody.innerHTML = "";
  for (const d of data.days) {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `<td>${d.day}</td><td>${d.trade_count}</td><td>${fmtSigned(d.points, 2)}</td><td class="${cls(d.net_usd)}">${fmtSigned(d.net_usd)} $</td>`;
    tr.addEventListener("click", () => openDay(d.day));
    tbody.appendChild(tr);
  }
}

function tile(label, value, extraClass = "") {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value ${extraClass}">${value}</div></div>`;
}

async function openDay(day) {
  state.view = "day";
  state.currentDay = day;
  setActiveNav("");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-day").content.cloneNode(true));
  await populateDay(content, day);
}

async function populateDay(container, day) {
  container.querySelector(".day-title").textContent = fmtDate(day);

  const data = await api(withFilter(`/api/days/${day}`));
  const s = data.stats;

  container.querySelector(".day-stats").innerHTML =
    tile("Punkte", fmtSigned(s.total_points))
    + tile("Netto", fmtSigned(s.total_net) + " $", cls(s.total_net))
    + tile("Trades", s.trade_count)
    + tile("Tagestief (kum.)", fmtSigned(s.lowest_cum) + " $", "neg")
    + tile("Tageshoch (kum.)", fmtSigned(s.highest_cum) + " $", "pos")
    + tile("Peak-to-Valley Drawdown", fmtSigned(s.max_drawdown) + " $");

  const tbody = container.querySelector(".day-table tbody");
  tbody.innerHTML = "";
  let cum = 0;
  const cumVals = data.trades.map(t => (cum += t.net_usd));
  const highIdx = cumVals.indexOf(Math.max(...cumVals));
  const lowIdx = cumVals.indexOf(Math.min(...cumVals));

  data.trades.forEach((t, i) => {
    const tr = document.createElement("tr");
    const cumClass = i === highIdx ? "cum-high" : (i === lowIdx ? "cum-low" : "");
    const tag = i === highIdx ? '<span class="badge-tag">← Tageshoch</span>' : (i === lowIdx ? '<span class="badge-tag">← Tagestief</span>' : "");
    tr.innerHTML = `
      <td>${fmtTime(t.entry_time)}</td>
      <td>${fmtTime(t.exit_time)}</td>
      <td class="${t.direction === "Long" ? "dir-long" : "dir-short"}">${t.direction}</td>
      <td>${fmtNum(t.entry_price)}</td>
      <td>${fmtNum(t.exit_price)}</td>
      <td>${t.exit_type || ""}</td>
      <td class="${cls(t.points)}">${fmtSigned(t.points)}</td>
      <td class="${cls(t.net_usd)}">${fmtSigned(t.net_usd)} $</td>
      <td class="${cumClass}">${fmtSigned(cumVals[i])} $${tag}</td>
      <td><input class="row-note" data-id="${t.id}" value="${(t.notes || "").replace(/"/g, "&quot;")}" placeholder="Notiz…"></td>
      <td class="image-cell"></td>
      <td><button class="btn btn-danger row-delete" data-id="${t.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);

    const cell = tr.querySelector(".image-cell");
    const tradeImages = (data.images || []).filter(im => im.trade_id === t.id);
    tradeImages.forEach(img => cell.appendChild(imageThumbEl(img, "image-thumb-sm")));
    cell.appendChild(imageAddButton(day, t.id, container));

    tr.querySelector(".row-delete").addEventListener("click", async () => {
      if (!confirm("Trade wirklich löschen?")) return;
      await api(`/api/trades/${t.id}`, { method: "DELETE" });

      if (data.trades.length === 1) {
        // letzter Trade des Tages - Tag existiert danach nicht mehr,
        // GET /api/days/{day} liefert 404. Statt populateDay() erneut
        // aufzurufen (wuerde dort abbrechen und die alte Zeile stehen
        // lassen), die Ansicht verlassen, die es nicht mehr gibt.
        refreshDayList();
        if (container.closest("#modal-overlay")) {
          closeModal();
          if (state.view === "month") renderMonth();
        } else {
          openOverview();
        }
        return;
      }

      await populateDay(container, day);
    });
  });

  tbody.querySelectorAll(".row-note").forEach(inp => {
    inp.addEventListener("blur", async () => {
      await api(`/api/trades/${inp.dataset.id}/notes`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: inp.value }),
      });
    });
  });

  renderDayImages(container, day, data.images || []);

  container.querySelector(".day-observations").innerHTML =
    obsTile("Ø Haltedauer", fmtDuration(s.avg_duration_sec))
    + obsTile("Größte Pause zw. Trades", fmtDuration(s.max_gap_sec))
    + obsTile("Richtung", `${s.long_count}x Long / ${s.short_count}x Short`)
    + obsTile("Preisspanne", `${fmtNum(s.price_low)} – ${fmtNum(s.price_high)}`)
    + obsTile("Erster Trade", fmtTime(data.trades[0].entry_time))
    + obsTile("Letzter Trade", fmtTime(data.trades[data.trades.length - 1].exit_time));

  const noteArea = container.querySelector(".day-note");
  noteArea.value = data.note || "";
  // onblur= statt addEventListener: populateDay() wird auf demselben Container
  // mehrfach neu aufgerufen (z.B. nach jedem Bild-Upload), das Notizfeld selbst
  // wird dabei aber nicht neu erzeugt - addEventListener wuerde sich also bei
  // jedem Aufruf einen weiteren Handler dazu-stapeln und beim Verlassen des
  // Felds mehrfach denselben Request abschicken.
  noteArea.onblur = async () => {
    await api(`/api/days/${day}/notes`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: noteArea.value }),
    });
  };
}

/* ---------- Bilder & Lightbox ---------- */

function imageThumbEl(img, sizeClass) {
  const div = document.createElement("div");
  div.className = sizeClass;
  div.innerHTML = `<img src="/media/${img.thumb_filename}" alt="" loading="lazy">`;
  div.addEventListener("click", () => openLightbox(img));
  return div;
}

function imageAddButton(day, tradeId, container) {
  const label = document.createElement("label");
  label.className = "image-add";
  label.textContent = "+";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    await uploadImage(day, file, tradeId);
    await populateDay(container, day);
  });
  label.appendChild(input);
  return label;
}

async function uploadImage(day, file, tradeId) {
  const fd = new FormData();
  fd.append("file", file);
  if (tradeId !== null && tradeId !== undefined) fd.append("trade_id", tradeId);
  await api(`/api/days/${day}/images`, { method: "POST", body: fd });
}

function renderDayImages(container, day, images) {
  const strip = container.querySelector(".day-images");
  strip.innerHTML = "";
  images.filter(im => im.trade_id === null).forEach(img => {
    strip.appendChild(imageThumbEl(img, "image-thumb"));
  });

  const input = container.querySelector(".day-image-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    await uploadImage(day, file, null);
    await populateDay(container, day);
  };
}

const LIGHTBOX_DEFAULT_SIZE = { width: 720, height: 520 };
let lightboxCurrentImage = null;
let lightboxOpenDay = null;

function getLightboxSize() {
  try {
    const saved = JSON.parse(localStorage.getItem("lightboxSize") || "null");
    if (saved && saved.width && saved.height) return saved;
  } catch (e) { /* ignore */ }
  return { ...LIGHTBOX_DEFAULT_SIZE };
}
function saveLightboxSize(size) {
  localStorage.setItem("lightboxSize", JSON.stringify(size));
}

function positionLightboxBox(size) {
  const box = document.getElementById("lightbox-box");
  // top/left einmalig fest setzen (nicht ueber Flexbox zentrieren) - sonst
  // verschiebt sich der Anker waehrend des Resize-Drags mit dem Mauszeiger mit.
  const left = Math.max(10, Math.round((window.innerWidth - size.width) / 2));
  const top = Math.max(10, Math.round((window.innerHeight - size.height) / 2));
  box.style.left = left + "px";
  box.style.top = top + "px";
  box.style.width = size.width + "px";
  box.style.height = size.height + "px";
}

function openLightbox(img) {
  lightboxCurrentImage = img;
  lightboxOpenDay = img.day || state.currentDay;

  const overlay = document.getElementById("lightbox-overlay");
  const imgEl = document.getElementById("lightbox-img");
  imgEl.src = `/media/${img.filename}`;

  positionLightboxBox(getLightboxSize());
  overlay.classList.add("visible");
}

function closeLightbox() {
  document.getElementById("lightbox-overlay").classList.remove("visible");
  lightboxCurrentImage = null;
}

/* Eigener Resize-Griff statt natives CSS resize: waechst symmetrisch um den
   Mittelpunkt der Box, statt nur von der oben-links-Ecke aus - die gezogene
   Ecke folgt dabei exakt dem Mauszeiger, da centerX/centerY beim Start fix
   eingefroren werden und Breite/Hoehe direkt aus dem Abstand zum Zeiger
   berechnet werden (kein Nachlaufen, kein Drift). */
(function setupLightboxResize() {
  const handle = document.getElementById("lightbox-handle");
  const box = document.getElementById("lightbox-box");
  let centerX = 0, centerY = 0;

  const minWidth = 280, minHeight = 220;

  function onMove(e) {
    const maxWidth = window.innerWidth * 0.96;
    const maxHeight = window.innerHeight * 0.9;
    const width = Math.min(maxWidth, Math.max(minWidth, Math.abs(e.clientX - centerX) * 2));
    const height = Math.min(maxHeight, Math.max(minHeight, Math.abs(e.clientY - centerY) * 2));
    box.style.width = width + "px";
    box.style.height = height + "px";
    box.style.left = (centerX - width / 2) + "px";
    box.style.top = (centerY - height / 2) + "px";
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
  }

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
attachOutsideClose(document.getElementById("lightbox-overlay"), closeLightbox);
document.getElementById("lightbox-reset").addEventListener("click", () => {
  positionLightboxBox(LIGHTBOX_DEFAULT_SIZE);
  saveLightboxSize({ ...LIGHTBOX_DEFAULT_SIZE });
});
document.getElementById("lightbox-save").addEventListener("click", (e) => {
  const box = document.getElementById("lightbox-box");
  const rect = box.getBoundingClientRect();
  saveLightboxSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.textContent = "✓ Gespeichert";
  setTimeout(() => { btn.textContent = original; }, 1200);
});
document.getElementById("lightbox-delete").addEventListener("click", async () => {
  if (!lightboxCurrentImage) return;
  if (!confirm("Bild wirklich löschen?")) return;
  await api(`/api/images/${lightboxCurrentImage.id}`, { method: "DELETE" });
  closeLightbox();
  if (document.getElementById("modal-overlay").classList.contains("visible")) {
    await populateDay(document.getElementById("modal-body"), lightboxOpenDay);
  } else if (state.view === "day" && state.currentDay) {
    await populateDay(document.getElementById("content"), state.currentDay);
  }
});

/* ---------- Monatsübersicht ---------- */

async function openMonth() {
  state.view = "month";
  state.currentDay = null;
  setActiveNav("month");
  refreshDayList();

  const now = new Date();
  if (!state.monthYear) state.monthYear = now.getFullYear();
  if (!state.monthNum) state.monthNum = now.getMonth() + 1;

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-month").content.cloneNode(true));

  content.querySelector(".month-prev").addEventListener("click", () => shiftMonth(-1));
  content.querySelector(".month-next").addEventListener("click", () => shiftMonth(1));

  await renderMonth();
}

function shiftMonth(delta) {
  let y = state.monthYear, m = state.monthNum + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.monthYear = y;
  state.monthNum = m;
  renderMonth();
}

async function renderMonth() {
  const data = await api(withFilter(`/api/month/${state.monthYear}/${state.monthNum}`));
  const content = document.getElementById("content");
  content.querySelector(".month-label").textContent = monthLabel(state.monthYear, state.monthNum);

  content.querySelector(".month-stats").innerHTML =
    tile("Netto gesamt", fmtSigned(data.total_net) + " $", cls(data.total_net))
    + tile("Punkte gesamt", fmtSigned(data.total_points))
    + tile("Trades gesamt", data.total_trades)
    + tile("Handelstage", data.trading_days);

  const grid = content.querySelector(".month-grid");
  grid.innerHTML = "";
  ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((wd, idx) => {
    const el = document.createElement("div");
    el.className = "month-grid-head" + (idx >= 5 ? " weekend" : "");
    el.textContent = wd;
    grid.appendChild(el);
  });
  for (let i = 1; i < data.first_weekday; i++) {
    const el = document.createElement("div");
    el.className = "month-cell empty";
    grid.appendChild(el);
  }
  for (const d of data.days) {
    const el = document.createElement("div");
    const dayNum = parseInt(d.date.split("-")[2], 10);
    const hasTrades = d.trades > 0;
    const isWeekend = [0, 6].includes(new Date(d.date + "T00:00:00").getDay());
    el.className = "month-cell" + (isWeekend ? " weekend" : "") + (hasTrades ? " has-trades " + (d.net >= 0 ? "cell-pos" : "cell-neg") : "");
    el.innerHTML = `<div class="cell-date">${dayNum}</div>`
      + (hasTrades ? `<div class="cell-net">${fmtSigned(d.net)} $</div><div class="cell-count">${d.trades} Trades</div>` : "");
    if (hasTrades) el.addEventListener("click", () => openDayModal(d.date));
    grid.appendChild(el);
  }
}

function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

/* ---------- Tages-Modal ---------- */

async function openDayModal(day) {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.innerHTML = "";
  body.appendChild(document.getElementById("tpl-day").content.cloneNode(true));
  overlay.classList.add("visible");
  await populateDay(body, day);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("visible");
}

document.getElementById("modal-close").addEventListener("click", closeModal);
attachOutsideClose(document.getElementById("modal-overlay"), closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("lightbox-overlay").classList.contains("visible")) {
    closeLightbox();
  } else {
    closeModal();
  }
});

function obsTile(label, value) {
  return `<div class="obs-tile"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

/* ---------- Chart (inline SVG, keine externe Lib) ---------- */

function lineChartSvg(values, labels) {
  const w = 1000, h = 220, padL = 50, padR = 10, padT = 16, padB = 24;
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = (max - min) || 1;
  const stepX = (w - padL - padR) / (values.length - 1 || 1);

  const x = i => padL + i * stepX;
  const y = v => padT + (h - padT - padB) * (1 - (v - min) / range);

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const zeroY = y(0);
  const last = values[values.length - 1];
  const cs = getComputedStyle(document.documentElement);
  const green = cs.getPropertyValue("--green").trim();
  const red = cs.getPropertyValue("--red").trim();
  const border = cs.getPropertyValue("--border").trim();
  const faint = cs.getPropertyValue("--text-faint").trim();
  const lineColor = last >= 0 ? green : red;

  return `
  <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${padL}" y1="${zeroY}" x2="${w - padR}" y2="${zeroY}" stroke="${border}" stroke-dasharray="4 4" />
    <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" />
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="3.5" fill="${lineColor}" />
    <text x="${padL}" y="${h - 6}" fill="${faint}" font-size="10">${labels[0]}</text>
    <text x="${w - padR}" y="${h - 6}" fill="${faint}" font-size="10" text-anchor="end">${labels[labels.length - 1]}</text>
  </svg>`;
}

/* ---------- Konten & Sync ---------- */

let cachedPlatforms = null;

async function getPlatforms() {
  if (!cachedPlatforms) cachedPlatforms = await api("/api/platforms");
  return cachedPlatforms;
}

async function openAccounts() {
  state.view = "accounts";
  state.currentDay = null;
  setActiveNav("accounts");
  refreshDayList();

  const content = document.getElementById("content");
  content.innerHTML = "";
  content.appendChild(document.getElementById("tpl-accounts").content.cloneNode(true));

  const platforms = await getPlatforms();
  const platformSelect = document.getElementById("account-platform-select");
  platformSelect.innerHTML = platforms.map(p => `<option value="${p.key}">${p.name}</option>`).join("");

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
      ? "Dieses Konto hat keine automatische Sync-Anbindung. Trades ordnest du ihm beim CSV-Import in der Sidebar zu (Dropdown über \"Datei wählen\")."
      : "Nutze ausschließlich das Investor-/Read-Only-Passwort. Zugangsdaten werden nur lokal in deiner SQLite-Datenbank gespeichert und nie an Dritte übertragen.";
  };
  platformSelect.addEventListener("change", updateFormForPlatform);
  updateFormForPlatform();

  const form = document.getElementById("account-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
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
      alert(err.message);
    }
  });

  await renderAccounts();
}

async function renderAccounts() {
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
        <div class="account-name">${acc.name}</div>
        <div class="account-meta">${platformName}${isManual ? "" : ` · Login ${acc.login} · Server ${acc.server}`}</div>
        <div class="account-meta">${isManual ? "Zuordnung per CSV-Import" : `Letzter Sync: ${lastSync}`}</div>
      </div>
      <div class="account-actions">
        ${isManual
          ? `<button class="btn btn-secondary acc-reassign">Bisherige nicht zugeordnete Trades zuweisen</button>`
          : `<button class="btn btn-secondary acc-sync">Jetzt synchronisieren</button>`}
        <button class="btn btn-secondary acc-delete">Entfernen</button>
      </div>
      <div class="account-status"></div>
    `;
    const statusEl = row.querySelector(".account-status");

    const syncBtn = row.querySelector(".acc-sync");
    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        statusEl.textContent = "Synchronisiere…";
        statusEl.className = "account-status";
        try {
          const res = await api(`/api/accounts/${acc.id}/sync`, { method: "POST" });
          statusEl.className = "account-status ok";
          statusEl.textContent = `${res.inserted} neue Trades importiert (${res.parsed} gefunden).`;
          await refreshDayList();
          await renderAccountFilter();
        } catch (err) {
          statusEl.className = "account-status err";
          statusEl.textContent = err.message;
        }
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
          await refreshDayList();
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

/* ---------- Import ---------- */

async function renderImportAccountSelect() {
  const select = document.getElementById("import-account-select");
  const current = select.value;
  const accounts = await api("/api/accounts");
  select.innerHTML = '<option value="">Kein Konto (freier Import)</option>'
    + accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
  if (accounts.some(a => String(a.id) === current)) select.value = current;
}
renderImportAccountSelect();

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
    await refreshDayList();
    await renderAccountFilter();
    if (state.view === "overview") openOverview();
    if (res.days && res.days.length) openDay(res.days[res.days.length - 1]);
  } catch (err) {
    statusEl.className = "import-status err";
    statusEl.textContent = err.message;
  }
  e.target.value = "";
});

/* ---------- Nav ---------- */

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", () => {
    if (el.dataset.view === "overview") openOverview();
    if (el.dataset.view === "month") openMonth();
    if (el.dataset.view === "accounts") openAccounts();
    if (el.dataset.view === "settings") openSettings();
  });
});

loadFilterState();
renderAccountFilter();
openOverview();
