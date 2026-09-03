/* Bestaetigungs-, Ja/Nein- und Texteingabe-Dialoge. */

import { renderImportAccountSelect } from './accounts.js';
import { renderAccounts } from './analytics.js';
import { api, attachOutsideClose, escapeHtml } from './core.js';
import { renderAccountFilter } from './filters.js';

/* ---------- Zweistufiger Loesch-Dialog ---------- */

/* requireTyping steuert die dritte Stufe (Eintippen von "Löschen"): fuer
   folgenreiche Loeschungen (Konto, Vorlage) bleibt sie an, fuer den Journal-
   Eintrag reicht ein einfacher Ja-Klick, weil der Inhalt selbst der einzige
   Verlust ist und die zwei Klicks (Loeschen-Button + Ja) schon vor
   Versehentlichem schuetzen. */
export function confirmDelete(message, requireTyping = true) {
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
      if (!requireTyping) { cleanup(true); return; }
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

/* Einfacher Ja/Nein-Dialog fuer nicht-destruktive Entscheidungen (z.B.
   "trotzdem weiter, obwohl ungespeichert?") - wie confirmDelete(msg, false),
   aber mit einem regulaeren statt rot eingefaerbten Bestaetigen-Button, damit
   eine haeufige, harmlose Aktion nicht wie eine Loeschung aussieht. */
export function confirmContinue(message, yesLabel = "Weiter") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
          <button class="btn btn-primary confirm-yes">${escapeHtml(yesLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }
    attachOutsideClose(overlay, () => cleanup(false));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(false));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => cleanup(true));
  });
}

/* Einzeiliges Texteingabe-Fenster (Umbenennen, Name beim Anlegen) - null bei
   Abbruch oder leerer Eingabe. */
export function promptDialog(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    overlay.innerHTML = `
      <div class="modal-card confirm-card">
        <div class="confirm-message">${escapeHtml(message)}</div>
        <input type="text" class="confirm-input" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-secondary confirm-no">Abbrechen</button>
          <button class="btn btn-primary confirm-yes">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".confirm-input");
    input.value = defaultValue;
    function cleanup(result) { overlay.remove(); resolve(result); }
    attachOutsideClose(overlay, () => cleanup(null));
    overlay.querySelector(".confirm-no").addEventListener("click", () => cleanup(null));
    overlay.querySelector(".confirm-yes").addEventListener("click", () => cleanup(input.value.trim() || null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); overlay.querySelector(".confirm-yes").click(); }
    });
    input.focus();
    input.select();
  });
}

/* Gemeinsamer Ablauf fuer Konto-Loeschung, aufgerufen sowohl von der
   Konten-Seite als auch von den Einstellungen - vermeidet doppelte
   Confirm-/Request-/Refresh-Logik an zwei Stellen. */
export async function deleteAccountFlow(accountId, accountName) {
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
