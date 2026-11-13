(function () {
  'use strict';

  // ---- Theme: always follows the system light/dark setting ---------------
  var media = window.matchMedia('(prefers-color-scheme: light)');
  function currentTheme() {
    return media.matches ? 'light' : 'dark';
  }
  media.addEventListener('change', function () {
    document.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
  });
  // Clear the choice saved by the old manual toggle; it is no longer read.
  try { localStorage.removeItem('theme'); } catch (e) { /* private mode */ }
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

  // ---- Photo strip: dots and arrows for a set of photos that already scrolls sideways ----
  document.querySelectorAll('[data-photo-strip]').forEach(function (strip) {
    var track = strip.querySelector('[data-photo-track]');
    var count = track.children.length;
    if (count < 2) return;
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dots = document.createElement('div');
    dots.className = 'photo-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < count; i++) dots.appendChild(document.createElement('span'));
    function current() {
      return Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / track.clientWidth)));
    }
    function go(index) {
      track.scrollTo({ left: index * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
    }
    function step(label, cls, by) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'photo-step ' + cls;
      button.setAttribute('aria-label', label);
      button.textContent = by < 0 ? '\u2039' : '\u203a';
      button.addEventListener('click', function () { go(current() + by); });
      strip.appendChild(button);
      return button;
    }
    var back = step('Previous photo', 'photo-step--back', -1);
    var on = step('Next photo', 'photo-step--on', 1);
    strip.appendChild(dots);
    function mark() {
      var at = current();
      for (var i = 0; i < count; i++) dots.children[i].classList.toggle('is-current', i === at);
      back.disabled = at === 0;
      on.disabled = at === count - 1;
    }
    var waiting = false;
    track.addEventListener('scroll', function () {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(function () { waiting = false; mark(); });
    }, { passive: true });
    mark();
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
