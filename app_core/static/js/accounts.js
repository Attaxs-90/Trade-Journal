/* Konten-Seite, Broker-Sync und CSV-Import. */

import { api, escapeHtml } from './core.js';

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
