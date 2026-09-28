/* Konten-Seite, Broker-Sync und CSV-Import. */

import { api, escapeHtml } from './core.js';
import { refreshCurrentView, renderSidebarAccountStatus } from './filters.js';

/* ---------- Konten & Sync ---------- */

let cachedPlatforms = null;

export async function getPlatforms() {
  if (!cachedPlatforms) cachedPlatforms = await api("/api/platforms");
  return cachedPlatforms;
}

/* ---------- Import ---------- */

/* Existiert nur, waehrend die Konten-Seite gemountet ist (Karte "CSV
   importieren") - wird aber auch von der Konto-Loeschung in den
   Einstellungen aus aufgerufen, deshalb hier bewusst ein No-Op statt
   Crash, wenn das Element gerade nicht im DOM ist. */
export async function renderImportAccountSelect() {
  const select = document.getElementById("import-account-select");
  if (!select) return;
  const current = select.value;
  const accounts = await api("/api/accounts");
  select.innerHTML = '<option value="">Kein Konto (freier Import)</option>'
    + accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  if (accounts.some(a => String(a.id) === current)) select.value = current;
}

/* ---------- Start-Sync ---------- */

/* Der Server synct die Konten beim Start im Hintergrund (siehe
   _startup_tasks in main.py), die App ist schon vorher bedienbar. Solange
   er laeuft, zeigt die Sidebar einen Hinweis; kamen dabei neue Trades
   herein, wird die aktuelle Ansicht einmal neu geladen. */
export async function watchStartupSync() {
  const indicator = document.getElementById("sidebar-sync-indicator");
  let status;
  try {
    status = await api("/api/startup-status");
  } catch (e) {
    return;  // Server weg - meldet die naechste Aktion ohnehin
  }
  if (!status.running) {
    indicator.hidden = true;
    if (indicator.dataset.watching) {
      delete indicator.dataset.watching;
      if (status.inserted > 0) {
        renderSidebarAccountStatus();
        refreshCurrentView();
      }
    }
    return;
  }
  indicator.hidden = false;
  indicator.dataset.watching = "1";
  setTimeout(watchStartupSync, 2000);
}
