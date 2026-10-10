'use strict';
/* Runs before first paint so a saved light/dark preference never flashes the other theme. */
(() => {
  try {
    const theme = localStorage.getItem('minute.theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* Storage unavailable: follow the system theme. */ }
})();
