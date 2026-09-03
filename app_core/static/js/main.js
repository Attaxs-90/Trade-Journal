/* Einstiegspunkt: laedt alle Module und startet die App.

   Die Module registrieren ihre Event-Listener beim Laden selbst; hier steht nur
   die reihenfolgekritische Startsequenz - der gespeicherte Filter- und
   Ansichtszustand muss stehen, bevor die erste Ansicht gerendert wird. */

import './core.js';
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
import './nav.js';
import { initNewsbar } from './news.js';

loadFilterState();
loadTagFilterState();
loadNotebookExpandedState();
renderSidebarAccountStatus();
openOverview();
initNewsbar();
loadTodoWidget();
