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

  // ---- Parades: routes drawn on the streets, clickable like a venue ----------
  var KIND = { mardi_gras: 'Carnival parade', second_line: 'Second line', other: 'Parade' };
  var PARADE_HOURS = 4;
  var dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  var params = new URLSearchParams(location.search);
  // /?date=2026-11-22&parade=nine-times-2026-11-22 opens the map on that day with that parade's card open.
  var linkedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;
  var linkedParade = params.get('parade');
  var shownParades = [];
  var paradePopup = null;

  function paradeTimes(p) {
    var start = p.s ? Date.parse(p.s) : null;
    // No time from the city: it is on for that calendar day.
    if (start === null) return { start: Date.parse(p.d + 'T00:00:00-06:00'), end: Date.parse(p.d + 'T23:59:59-05:00'), timed: false };
    return { start: start, end: p.e ? Date.parse(p.e) : start + PARADE_HOURS * HOUR, timed: true };
  }

  function selectParades(day) {
    var now = Date.now();
    var today = dateKeyFmt.format(new Date(now));
    return (data.parades || []).filter(function (p) {
      var t = paradeTimes(p);
      if (day === 'live') return t.timed && t.start - 30 * 60 * 1000 <= now && now <= t.end;
      if (String(day).length === 10) return p.d === day;
      return p.d === addDays(today, Number(day)) && t.end >= now;
    });
  }

  function paradePopupHtml(p) {
    var href = cfg.base + '/parades/' + p.slug;
    var t = paradeTimes(p);
    var when = dayFmt.format(new Date(p.d + 'T12:00:00Z')) + (t.timed ? ' · ' + timeFmt.format(new Date(t.start)) : '');
    var now = Date.now();
    var live = t.timed && t.start <= now && now <= t.end ? ' <span class="popup-live">• Rolling now</span>' : '';
    return (
      '<a class="popup-banner popup-banner--parade" href="' + href + '"><h3>' + esc(p.n) + '</h3></a>' +
      '<ul class="popup-gigs">' +
      '<li><span class="popup-time">' + esc(when) + live + '</span><span class="popup-title">' + esc(KIND[p.c] || KIND.other) + '</span></li>' +
      (p.a ? '<li><span class="popup-time">Starts at</span><span class="popup-title">' + esc(p.a) + '</span></li>' : '') +
      (p.g ? '' : '<li><span class="popup-time">Route</span><span class="popup-title">Not published as a line. See the parade page.</span></li>') +
      '</ul>' +
      '<a class="popup-more" href="' + href + '">Route and details →</a>'
    );
  }

  function paradeCollection() {
    return {
      type: 'FeatureCollection',
      features: shownParades
        .filter(function (p) { return p.g; })
        .map(function (p) { return { type: 'Feature', properties: { id: p.id }, geometry: p.g }; }),
    };
  }

  // Layers live in the style, so they are put back whenever the style (light/dark) is swapped.
  function addParadeLayers() {
    if (map.getSource('parades')) return;
    var color = theme === 'light' ? '#e8590c' : '#ffa500';
    map.addSource('parades', { type: 'geojson', data: paradeCollection() });
    var round = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'parade-casing', type: 'line', source: 'parades', layout: round, paint: { 'line-color': theme === 'light' ? '#ffffff' : '#1b1d1e', 'line-width': 8, 'line-opacity': 0.7 } });
    map.addLayer({ id: 'parade-line', type: 'line', source: 'parades', layout: round, paint: { 'line-color': color, 'line-width': 4.5 } });
    // A wide invisible line, so the route is easy to tap.
    map.addLayer({ id: 'parade-hit', type: 'line', source: 'parades', layout: round, paint: { 'line-color': color, 'line-width': 22, 'line-opacity': 0 } });
  }
  map.on('style.load', addParadeLayers);

  function openParade(p, lngLat) {
    if (paradePopup) paradePopup.remove();
    paradePopup = new mapboxgl.Popup({ offset: 12, focusAfterOpen: false, maxWidth: '320px' }).setLngLat(lngLat).setHTML(paradePopupHtml(p)).addTo(map);
  }
  map.on('click', 'parade-hit', function (e) {
    var id = e.features && e.features[0] && e.features[0].properties.id;
    var p = shownParades.filter(function (x) { return x.id === id; })[0];
    if (p) openParade(p, e.lngLat);
  });
  map.on('mouseenter', 'parade-hit', function () { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'parade-hit', function () { map.getCanvas().style.cursor = ''; });

  /** Draw the day's parades: the route when the city gave one, and a marker where it starts. */
  function renderParades(day, bounds) {
    shownParades = selectParades(day);
    if (paradePopup) paradePopup.remove();
    if (map.getSource('parades')) map.getSource('parades').setData(paradeCollection());
    shownParades.forEach(function (p) {
      (p.g ? (p.g.type === 'LineString' ? [p.g.coordinates] : p.g.coordinates) : []).forEach(function (line) {
        line.forEach(function (c) { bounds.extend(c); });
      });
      if (!p.p) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'marker marker--parade';
      el.setAttribute('aria-label', p.n + ': ' + (KIND[p.c] || KIND.other).toLowerCase() + (p.g ? ', start of route' : ''));
      var popup = new mapboxgl.Popup({ offset: 12, focusAfterOpen: false, maxWidth: '320px' }).setHTML(paradePopupHtml(p));
      popup.on('open', function () { el.classList.add('is-open'); });
      popup.on('close', function () { el.classList.remove('is-open'); });
      var marker = new mapboxgl.Marker({ element: el }).setLngLat(p.p).setPopup(popup).addTo(map);
      markers.push(marker);
      bounds.extend(p.p);
      if (linkedParade === p.id) {
        linkedParade = null;
        marker.togglePopup();
      }
    });
    return shownParades.length;
  }

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
      if (String(day).length === 10) return key === day;
      var target = addDays(today, Number(day));
      return key === target && t.end >= now;
    });
  }

  function hasShows(day) {
    return select(day).some(function (ev) { return data.venues[ev.v]; }) || selectParades(day).length > 0;
  }

  function button(day) {
    return buttons.filter(function (b) { return b.dataset.day === day; })[0];
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

    var paradeCount = renderParades(day, bounds);
    var labels = { live: 'right now', 0: 'tonight', 1: 'tomorrow' };
    var dated = String(day).length === 10;
    if (dated) labels[day] = 'for ' + dayFmt.format(new Date(day + 'T12:00:00Z'));
    if (!markers.length && !paradeCount) {
      setStatus('No shows listed ' + labels[day] + '. Try another day or browse the <a href="' + cfg.base + '/venues">venue directory</a>.');
    } else {
      setStatus(dated ? 'Showing ' + dayFmt.format(new Date(day + 'T12:00:00Z')) + '.' : '');
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
      var anyLive = hasShows('live');
      var liveBtn = button('live');
      if (liveBtn) {
        liveBtn.disabled = !anyLive;
        liveBtn.title = anyLive ? 'Shows happening now' : 'Nothing is live right now';
      }
      // Nothing left tonight: skip straight to tomorrow rather than an empty map.
      var anyToday = hasShows(0);
      var todayBtn = button('0');
      if (todayBtn && !anyToday) {
        todayBtn.disabled = true;
        todayBtn.title = 'No more shows listed tonight';
      }
      // A link to a particular day (from a parade page) wins over tonight.
      var start = function () { choose(linkedDate || (anyToday ? 0 : 1)); };
      if (map.loaded()) start();
      else map.once('load', start);
    })
    .catch(function () {
      setStatus('Couldn’t load tonight’s shows. Browse the <a href="' + cfg.base + '/venues">venue directory</a> instead.');
    });
})();
