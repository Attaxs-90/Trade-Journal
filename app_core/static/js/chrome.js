/* Rahmen der App: Theme-Umschalter, Sidebar ein-/ausklappen, globaler Sync-Button. */

import { getPlatforms } from './accounts.js';
import { renderAccounts } from './analytics.js';
import { api, state } from './core.js';
import { refreshCurrentView, renderAccountFilter } from './filters.js';
import { renderNewsFilters, renderNewsSections } from './news.js';

/* ---------- Theme ---------- */

const ICON_SUN = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const ICON_MOON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const apply = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    btn.innerHTML = theme === "light" ? ICON_SUN : ICON_MOON;
  };
  apply(localStorage.getItem("theme") || "dark");
  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem("theme", next);
    apply(next);
    // Die Equity-Kurve und die Newsbar-Impact-Farben backen Theme-Farben als
    // feste Werte ein (per getComputedStyle beim Rendern) - ohne Neuzeichnen
    // blieben nach einem Theme-Wechsel die alten Farben stehen.
    refreshCurrentView();
    if (typeof renderNewsFilters === "function") { renderNewsFilters(); renderNewsSections(); }
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

/* ---------- Globaler Sync-Button ---------- */

function initGlobalSync() {
  const btn = document.getElementById("global-sync-btn");
  const defaultTitle = btn.title;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.classList.add("syncing");
    btn.title = "Synchronisiere…";
    try {
      const [accounts, platforms] = await Promise.all([api("/api/accounts"), getPlatforms()]);
      const autoAccounts = accounts.filter(acc => {
        const p = platforms.find(pl => pl.key === acc.platform);
        return p && !p.manual;
      });
      if (!autoAccounts.length) {
        btn.title = "Keine automatisch synchronisierbaren Konten verbunden.";
        return;
      }
      let inserted = 0, failed = 0;
      for (const acc of autoAccounts) {
        try {
          const res = await api(`/api/accounts/${acc.id}/sync`, { method: "POST" });
          inserted += res.inserted;
        } catch (err) {
          failed++;
        }
      }
      btn.title = failed
        ? `${inserted} neue Trades importiert, ${failed} Konto(en) fehlgeschlagen.`
        : `${inserted} neue Trades importiert.`;
      await renderAccountFilter();
      refreshCurrentView();
      if (state.view === "accounts") await renderAccounts();
    } finally {
      btn.disabled = false;
      btn.classList.remove("syncing");
      setTimeout(() => { btn.title = defaultTitle; }, 4000);
    }
  });
}
initGlobalSync();
