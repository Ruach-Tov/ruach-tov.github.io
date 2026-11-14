/* Theme toggle — no cookies, URL-parameter based.
   Default → light mode (style-light.css loaded)
   ?dark → dark mode (style-light.css NOT loaded)
   
   This script is tiny and inline-safe. It runs before
   first paint to avoid a flash of wrong theme. */
(function() {
  var isDark = window.location.search.indexOf('dark') !== -1;
  if (!isDark) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/static/style-light.css';
    document.head.appendChild(link);
  }

  /* Add toggle link to nav after DOM loads */
  document.addEventListener('DOMContentLoaded', function() {
    var nav = document.querySelector('.nav-links');
    if (!nav) return;

    var toggle = document.createElement('a');
    toggle.href = '#';
    toggle.style.cursor = 'pointer';

    if (isDark) {
      toggle.textContent = '☀️';
      toggle.title = 'Light mode';
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        var url = new URL(window.location);
        url.searchParams.delete('dark');
        window.location = url.toString();
      });
    } else {
      toggle.textContent = '🌙';
      toggle.title = 'Dark mode';
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        var url = new URL(window.location);
        url.searchParams.set('dark', '');
        window.location = url.toString();
      });
    }

    nav.appendChild(toggle);
  });
})();
