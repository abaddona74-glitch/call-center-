// Applies the saved color theme before the first paint, so a light-theme user never sees a dark flash.
// A separate file, not an inline <script>: the production CSP (infra/caddy) allows scripts from 'self' only.
// Keep the key and class names in sync with src/shared/lib/theme.ts.
(function () {
  var theme = 'dark';
  try {
    if (localStorage.getItem('cc.theme') === 'light') theme = 'light';
  } catch (e) {
    /* storage unavailable: keep the default */
  }
  var root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
})();
