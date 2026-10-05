(function () {
  'use strict';

  // ---- Theme ------------------------------------------------------------
  var media = window.matchMedia('(prefers-color-scheme: light)');
  function currentTheme() {
    return document.documentElement.dataset.theme || (media.matches ? 'light' : 'dark');
  }
  function announce() {
    document.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
      announce();
    });
  });
  media.addEventListener('change', function () {
    if (!document.documentElement.dataset.theme) announce();
  });
  window.NOLA = { currentTheme: currentTheme };

  // ---- Venue schedule: hide finished shows, flag what's on now -----------
  var now = Date.now();
  var HOUR = 3600 * 1000;
  var liveTitle = null;
  document.querySelectorAll('.event[data-start]').forEach(function (el) {
    var start = Date.parse(el.dataset.start);
    var end = el.dataset.end ? Date.parse(el.dataset.end) : null;
    if (el.hasAttribute('data-all-day')) {
      // Date-only: keep through the end of that day (local to the venue, close enough).
      end = Date.parse(el.dataset.start + 'T23:59:59-05:00');
    }
    var effectiveEnd = end || start + 3 * HOUR;
    if (effectiveEnd < now) {
      el.remove();
      return;
    }
    if (!el.hasAttribute('data-all-day') && start - 30 * 60 * 1000 <= now && now <= (end || start + 2.5 * HOUR)) {
      el.classList.add('is-live');
      if (!liveTitle) liveTitle = el.querySelector('.event-title').textContent.trim();
    }
  });
  document.querySelectorAll('.day').forEach(function (day) {
    if (!day.querySelector('.event')) day.remove();
  });
  var liveBox = document.querySelector('[data-live-now]');
  if (liveBox && liveTitle) {
    liveBox.querySelector('[data-live-title]').textContent = liveTitle;
    liveBox.hidden = false;
  }

  // ---- "Updated 3 hours ago" ---------------------------------------------
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
  document.querySelectorAll('time[data-relative]').forEach(function (el) {
    if (!rtf) return;
    var diff = (Date.parse(el.getAttribute('datetime')) - now) / 1000;
    var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(diff) >= units[i][1] || units[i][0] === 'minute') {
        el.textContent = rtf.format(Math.round(diff / units[i][1]), units[i][0]);
        break;
      }
    }
  });

  // ---- Directory filter ------------------------------------------------------
  var filter = document.querySelector('[data-venue-filter]');
  if (filter) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.venue-card'));
    var empty = document.querySelector('[data-venue-empty]');
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var match = !q || card.dataset.name.indexOf(q) !== -1;
        card.hidden = !match;
        if (match) shown++;
      });
      if (empty) empty.hidden = shown !== 0;
    });
  }
})();
