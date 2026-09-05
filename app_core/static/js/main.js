/* Einstiegspunkt: laedt alle Module und startet die App.

   Die Module registrieren ihre Event-Listener beim Laden selbst; hier steht nur
   die reihenfolgekritische Startsequenz - der gespeicherte Filter- und
   Ansichtszustand muss stehen, bevor die erste Ansicht gerendert wird. */

import { showAppError } from './core.js';
import { loadFilterState, loadTagFilterState, renderSidebarAccountStatus } from './filters.js';
import './chrome.js';
import './settings.js';
import './tags.js';
import './dialogs.js';
import { openOverview } from './overview.js';
import './trades.js';
import './share.js';
import './journal.js';
import { loadNotebookExpandedState } from './notebooks.js';
import { loadTodoWidget } from './todos.js';
import './images.js';
import './calendar.js';
import './chart.js';
import './accounts.js';
import './analytics.js';
import './strategies.js';
import './nav.js';
import { initNewsbar } from './news.js';

/* Letztes Netz fuer fehlgeschlagene Server-Anfragen. Die Render-Funktionen der
   Ansichten fangen ihre api()-Fehler nicht einzeln ab - vorher endete ein
   Fehlschlag deshalb stumm in der Konsole, und der Nutzer sah eine Ansicht
   ohne Daten, ohne Hinweis worauf das zurueckgeht (z. B. wenn der lokale
   Server nicht mehr laeuft). Statt an ueber siebzig Aufrufstellen ein
   try/catch zu ergaenzen, wird hier zentral gemeldet. */
window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || String(e.reason || "Unbekannter Fehler");
  showAppError(`Aktion fehlgeschlagen: ${msg}`);
});
window.addEventListener("error", (e) => {
  // Fehler beim Laden eines Moduls/Skripts erreichen unhandledrejection nicht.
  if (e.target !== window && e.target?.tagName === "SCRIPT") {
    showAppError("Ein Teil der Anwendung konnte nicht geladen werden. Bitte die Seite neu laden.");
  }
}, true);

loadFilterState();
loadTagFilterState();
loadNotebookExpandedState();
renderSidebarAccountStatus();
openOverview();
initNewsbar();
loadTodoWidget();
