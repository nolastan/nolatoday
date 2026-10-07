(function () {
  'use strict';

  var cfg = window.NOLA_MAP;
  var statusEl = document.querySelector('[data-map-status]');
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.segmented [data-day]'));
  var ZONE = 'America/Chicago';
  var HOUR = 3600 * 1000;
  // Nightlife day: a 1am show on Saturday morning belongs to Friday night.
  var DAY_ROLLOVER_HOURS = 4;

  function setStatus(html) {
    statusEl.innerHTML = html || '';
  }

  if (!window.mapboxgl || !cfg.token) {
    setStatus('The map couldn’t load. Browse the <a href="' + cfg.base + '/venues">venue directory</a> instead.');
    return;
  }

  var dateKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });

  function nightKey(ms) {
    return dateKeyFmt.format(new Date(ms - DAY_ROLLOVER_HOURS * HOUR));
  }
  function addDays(key, n) {
    var d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function styleFor(theme) {
    return theme === 'light' ? cfg.styleLight : cfg.styleDark;
  }

  mapboxgl.accessToken = cfg.token;
  var theme = window.NOLA ? window.NOLA.currentTheme() : 'dark';
  var map = new mapboxgl.Map({
    container: 'map',
    style: styleFor(theme),
    center: cfg.center,
    zoom: cfg.zoom,
    attributionControl: false,
    cooperativeGestures: false,
  });
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, showUserHeading: true }), 'bottom-right');

  document.addEventListener('themechange', function (e) {
    if (e.detail !== theme) {
      theme = e.detail;
      map.setStyle(styleFor(theme));
    }
  });

  var data = null;
  var markers = [];

  function eventTimes(ev) {
    if (ev.a) {
      var startDay = Date.parse(ev.s + 'T00:00:00-06:00');
      return { start: startDay, end: startDay + 24 * HOUR, allDay: true };
    }
    var start = Date.parse(ev.s);
    var end = ev.e ? Date.parse(ev.e) : start + 3 * HOUR;
    return { start: start, end: end, allDay: false };
  }

  function isLive(ev, now) {
    if (ev.a) return false;
    var start = Date.parse(ev.s);
    var end = ev.e ? Date.parse(ev.e) : start + 2.5 * HOUR;
    return start - 30 * 60 * 1000 <= now && now <= end;
  }

  function select(day) {
    var now = Date.now();
    var today = nightKey(now);
    return data.events.filter(function (ev) {
      var t = eventTimes(ev);
      if (day === 'live') return isLive(ev, now);
      var key = ev.a ? ev.s : nightKey(t.start);
      var target = addDays(today, Number(day));
      return key === target && t.end >= now;
    });
  }

  function popupHtml(slug, venue, events, now) {
    var href = cfg.base + '/venues/' + slug;
    var banner = venue.image
      ? '<a class="popup-banner" href="' + href + '" style="background-image:url(\'' + esc(venue.image) + '\')">'
      : '<a class="popup-banner" href="' + href + '">';
    var items = events
      .map(function (ev) {
        var time = ev.a ? 'All day' : timeFmt.format(new Date(Date.parse(ev.s)));
        var live = isLive(ev, now) ? ' <span class="popup-live">• Live now</span>' : '';
        return '<li><span class="popup-time">' + esc(time) + live + '</span><span class="popup-title">' + esc(ev.t) + '</span></li>';
      })
      .join('');
    return (
      banner + '<h3>' + esc(venue.name) + '</h3></a>' +
      '<ul class="popup-gigs">' + items + '</ul>' +
      '<a class="popup-more" href="' + href + '">Full schedule →</a>'
    );
  }

  function render(day) {
    markers.forEach(function (m) { m.remove(); });
    markers = [];
    var now = Date.now();
    var events = select(day);
    var byVenue = {};
    events.forEach(function (ev) {
      (byVenue[ev.v] = byVenue[ev.v] || []).push(ev);
    });
    var liveVenues = {};
    data.events.forEach(function (ev) {
      if (isLive(ev, now)) liveVenues[ev.v] = true;
    });

    var bounds = new mapboxgl.LngLatBounds();
    Object.keys(byVenue).forEach(function (slug) {
      var venue = data.venues[slug];
      if (!venue) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'marker' + (liveVenues[slug] ? ' live' : '');
      el.setAttribute('aria-label', venue.name + ': ' + byVenue[slug].length + (byVenue[slug].length === 1 ? ' show' : ' shows'));
      el.style.setProperty('--delay', (Math.random() * 4).toFixed(2) + 's');
      var popup = new mapboxgl.Popup({ offset: 12, focusAfterOpen: false, maxWidth: '320px' }).setHTML(
        popupHtml(slug, venue, byVenue[slug], now),
      );
      popup.on('open', function () { el.classList.add('is-open'); });
      popup.on('close', function () { el.classList.remove('is-open'); });
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat([venue.lng, venue.lat]).setPopup(popup).addTo(map));
      bounds.extend([venue.lng, venue.lat]);
    });

    var labels = { live: 'right now', 0: 'tonight', 1: 'tomorrow' };
    if (!markers.length) {
      setStatus('No shows listed ' + labels[day] + '. Try another day or browse the <a href="' + cfg.base + '/venues">venue directory</a>.');
    } else {
      setStatus('');
      var pad = Math.max(40, Math.min(window.innerWidth, window.innerHeight) / 10);
      map.fitBounds(bounds, { padding: { top: pad + 50, bottom: pad + 40, left: pad, right: pad }, maxZoom: 15, duration: 600 });
    }
  }

  function choose(day) {
    buttons.forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.day === String(day)));
    });
    render(day);
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (!b.disabled) choose(b.dataset.day);
    });
  });

  fetch(cfg.eventsUrl)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      data = json;
      var anyLive = select('live').length > 0;
      var liveBtn = buttons.filter(function (b) { return b.dataset.day === 'live'; })[0];
      if (liveBtn) {
        liveBtn.disabled = !anyLive;
        liveBtn.title = anyLive ? 'Shows happening now' : 'Nothing is live right now';
      }
      var start = function () { choose(0); };
      if (map.loaded()) start();
      else map.once('load', start);
    })
    .catch(function () {
      setStatus('Couldn’t load tonight’s shows. Browse the <a href="' + cfg.base + '/venues">venue directory</a> instead.');
    });
})();
