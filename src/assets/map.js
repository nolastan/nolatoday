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

  // On phones the header floats over the map (see styles.css). Track how much of the map it
  // covers so the time toggle can sit below it and fitted bounds stay clear of it.
  var header = document.querySelector('.page-map .site-header');
  function headerOverlap() {
    return header && getComputedStyle(header).position === 'absolute' ? header.offsetHeight : 0;
  }
  function syncHeaderHeight() {
    if (header) document.documentElement.style.setProperty('--map-header-h', header.offsetHeight + 'px');
  }
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);

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

  // ---- Cards: what opens from a marker ---------------------------------------
  // Venues, food stops, parades and street events all open the same card, described as a plain model:
  //   { kind: 'venue' | 'food' | 'parade' | 'street', name, href, image,
  //     rows: [{ type: 'show' | 'food' | 'parade' | 'street', time, live, html, icon, note }], note }
  // `html` and `icon` are already escaped markup; everything else is plain text. The banner is
  // the same height on every card: the photo, or a plain field in the kind's color. The name on
  // it is the one link to the page, and a live row says so where its time would be.
  // Placeholder marks, from Hugeicons free icons (MIT, https://hugeicons.com), like the food icons:
  // MusicNote03Icon for a venue, MaskTheater02Icon for a parade and TentIcon for a street event.
  function markSvg(paths) {
    return '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }
  var NOTE_ICON = markSvg('<circle cx="6.5" cy="18.5" r="3.5"/><circle cx="18" cy="16" r="3"/><path d="M10 18.5L10 7C10 6.07655 10 5.61483 10.2635 5.32794C10.5269 5.04106 11.0175 4.9992 11.9986 4.91549C16.022 4.57222 18.909 3.26005 20.3553 2.40978C20.6508 2.236 20.7986 2.14912 20.8993 2.20672C21 2.26432 21 2.4315 21 2.76587V16"/><path d="M10 10C15.8667 10 19.7778 7.66667 21 7"/>');
  var MASK_ICON = markSvg('<path d="M5.44505 14.2749C5.60832 13.9695 5.88358 13.7462 6.22227 13.6851C6.56095 13.624 6.89427 13.7375 7.14978 13.9674M11.2356 17.2768C10.909 17.8876 10.3585 18.3342 9.68113 18.4564C9.00377 18.5786 8.33713 18.3516 7.82611 17.8919M10.5592 13.3523C10.7225 13.0469 10.9978 12.8235 11.3365 12.7624C11.6751 12.7013 12.0085 12.8149 12.264 13.0447M13.0697 7.14205C11.9191 8.2281 10.171 9.09181 8.13072 9.45991C6.09043 9.828 4.15906 9.6281 2.7148 9.01019C2.62237 8.97065 2.52281 8.95715 2.42629 8.97456C2.14172 9.0259 1.95507 9.32308 2.0094 9.63832L2.94728 15.0805C3.64672 19.1391 7.04654 21.0881 8.62355 21.7854C9.14604 22.0165 9.72177 22.046 10.2823 21.9449C10.8429 21.8437 11.374 21.6145 11.7877 21.2146C13.0366 20.0074 15.5798 16.9863 14.8804 12.9276L13.9425 7.48545C13.8882 7.1702 13.6135 6.95627 13.3289 7.00761C13.2324 7.02502 13.1433 7.07255 13.0697 7.14205Z"/><path d="M14.3157 17C14.6792 16.9998 15.039 16.9347 15.3764 16.7854C16.9535 16.0881 20.3533 14.1391 21.0527 10.0805L21.9906 4.63832C22.0449 4.32308 21.8583 4.0259 21.5737 3.97456C21.4772 3.95715 21.3776 3.97065 21.2852 4.01019C19.8409 4.6281 17.9096 4.828 15.8693 4.45991C13.829 4.09181 12.0809 3.2281 10.9303 2.14205C10.8567 2.07255 10.7676 2.02502 10.6711 2.00761C10.3865 1.95627 10.1118 2.1702 10.0575 2.48545L9.1196 7.92763C9.0374 8.40465 8.99998 8.86734 9 9.31444"/>');
  var TENT_ICON = markSvg('<path d="M10.2112 16.4234L8.00003 21L16 21L13.7889 16.4234C13.0083 14.8078 12.6181 14 12 14C11.382 14 10.9917 14.8078 10.2112 16.4234Z"/><path d="M9.99997 3L19.2905 14.8243C20.1372 15.9019 20.5605 16.4407 20.7803 17.076C21 17.7113 21 18.3965 21 19.7669V21"/><path d="M14 3L4.70943 14.8244C3.86277 15.902 3.43945 16.4407 3.21973 17.076C3.00002 17.7112 3.00001 18.3964 2.99999 19.7668L2.99997 21"/><path d="M2 21H22"/>');
  function cardHtml(m) {
    var tag = m.href ? 'a' : 'div';
    // No photo: one mark, top right. A note for a venue, masks for a parade, the vendor's icon for a food stop.
    var mark = '';
    if (!m.image && m.kind === 'venue') mark = NOTE_ICON;
    if (!m.image && m.kind === 'parade') mark = MASK_ICON;
    if (!m.image && m.kind === 'street') mark = TENT_ICON;
    if (!m.image && m.kind === 'food') m.rows.forEach(function (r) { mark = mark || r.icon; });
    var rows = m.rows.map(function (r) {
      return '<li class="popup-row popup-row--' + r.type + '">' +
        '<span class="popup-what">' + (r.icon || '') + r.html + (r.note ? '<span class="popup-note">' + esc(r.note) + '</span>' : '') + '</span>' +
        '<span class="popup-when">' + (r.live ? '<span class="popup-live">' + esc(r.live) + '</span>' : esc(r.time)) + '</span>' +
        '</li>';
    }).join('');
    return '<' + tag + ' class="popup-banner popup-banner--' + m.kind + (m.image ? '' : ' popup-banner--none') + '"' +
      (m.href ? ' href="' + m.href + '"' : '') +
      (m.image ? ' style="background-image:url(\'' + esc(m.image) + '\')"' : '') + '>' +
      (mark ? '<span class="popup-mark" aria-hidden="true">' + mark + '</span>' : '') +
      '<h3>' + esc(m.name) + '</h3></' + tag + '>' +
      '<ul class="popup-rows">' + rows + '</ul>' +
      (m.note ? '<p class="popup-note popup-note--card">' + esc(m.note) + '</p>' : '');
  }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // A card always ends up fully on screen: the map slides just far enough to fit it below the
  // header and time toggle.
  function keepInView(popup) {
    requestAnimationFrame(function () {
      var el = popup.getElement();
      if (!el) return;
      var m = map.getContainer().getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var bar = document.querySelector('.map-top');
      var top = Math.max(m.top, bar ? bar.getBoundingClientRect().bottom : 0) + 8;
      var dx = 0;
      var dy = 0;
      if (r.bottom > m.bottom - 8) dy = r.bottom - (m.bottom - 8);
      if (r.top - dy < top) dy = r.top - top;
      if (r.right > m.right - 8) dx = r.right - (m.right - 8);
      if (r.left - dx < m.left + 8) dx = r.left - (m.left + 8);
      if (dx || dy) map.panBy([dx, dy], { duration: 350 });
    });
  }
  function makePopup(model) {
    var popup = new mapboxgl.Popup({ offset: 12, focusAfterOpen: false, maxWidth: '280px' }).setHTML(cardHtml(model));
    popup.on('open', function () { keepInView(popup); });
    return popup;
  }

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

  function isParadeLive(p, now) {
    var t = paradeTimes(p);
    return t.timed && t.start - 30 * 60 * 1000 <= now && now <= t.end;
  }

  function selectParades(day) {
    var now = Date.now();
    var today = dateKeyFmt.format(new Date(now));
    return (data.parades || []).filter(function (p) {
      var t = paradeTimes(p);
      if (day === 'live') return isParadeLive(p, now);
      if (String(day).length === 10) return p.d === day;
      return p.d === addDays(today, Number(day)) && t.end >= now;
    });
  }

  function paradeModel(p) {
    var t = paradeTimes(p);
    var now = Date.now();
    var kind = KIND[p.c] || KIND.other;
    return {
      kind: 'parade',
      name: p.n,
      href: cfg.base + '/parades/' + p.slug,
      image: p.i || null,
      rows: [{
        type: 'parade',
        time: t.timed ? timeFmt.format(new Date(t.start)) : 'All day',
        live: t.timed && t.start <= now && now <= t.end ? 'Rolling now' : '',
        html: esc(kind) + (p.a ? ', starts on ' + esc(p.a) : ''),
      }],
      note: p.g ? '' : 'Route not published as a line. See the parade page.',
    };
  }
  function paradeCollection() {
    return {
      type: 'FeatureCollection',
      features: shownParades
        .filter(function (p) { return p.g; })
        .map(function (p) { return { type: 'Feature', properties: { id: p.id }, geometry: p.g }; }),
    };
  }

  // Hover and selection are drawn as copies of one route on top of the rest, since routes often
  // share streets (St. Charles) and the highlighted one has to stay visible over its neighbors.
  var hoverId = null;
  var selectedId = null;
  var paradeMarkerEls = {};
  var NONE = '\u0000';
  var liveIds = [];
  var markerHoverId = null;

  function liveFilter() {
    return ['in', ['get', 'id'], ['literal', liveIds.length ? liveIds : [NONE]]];
  }

  // Same rhythm as the venue ripple: grow and fade over the first half of a 4s loop, then rest.
  var RIPPLE_MS = 4000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rippleFrame = null;
  function animateLiveRoutes() {
    rippleFrame = null;
    if (!liveIds.length || !map.getLayer('parade-live-glow')) return;
    if (reduceMotion) {
      map.setPaintProperty('parade-live-glow', 'line-width', 14);
      map.setPaintProperty('parade-live-glow', 'line-opacity', 0.35);
      return;
    }
    var phase = (performance.now() % RIPPLE_MS) / RIPPLE_MS;
    var k = Math.min(phase / 0.5, 1);
    var ease = 1 - Math.pow(1 - k, 2);
    map.setPaintProperty('parade-live-glow', 'line-width', 6 + 28 * ease);
    map.setPaintProperty('parade-live-glow', 'line-opacity', k < 1 ? 0.75 * (1 - ease) : 0);
    rippleFrame = requestAnimationFrame(animateLiveRoutes);
  }
  function startLiveRipple() {
    if (map.getLayer('parade-live-glow')) map.setFilter('parade-live-glow', liveFilter());
    if (liveIds.length && rippleFrame === null) rippleFrame = requestAnimationFrame(animateLiveRoutes);
  }

  function paradeColors() {
    return { line: theme === 'light' ? '#e8590c' : '#ffa500', casing: theme === 'light' ? '#ffffff' : '#1b1d1e' };
  }

  function syncParadeHighlight() {
    if (!map.getLayer('parade-hover-line')) return;
    var hover = hoverId && hoverId !== selectedId ? hoverId : NONE;
    ['parade-hover-casing', 'parade-hover-line'].forEach(function (l) { map.setFilter(l, ['==', ['get', 'id'], hover]); });
    ['parade-selected-casing', 'parade-selected-line'].forEach(function (l) { map.setFilter(l, ['==', ['get', 'id'], selectedId || NONE]); });
    // With one route picked, the others step back.
    map.setPaintProperty('parade-line', 'line-opacity', selectedId ? 0.45 : 1);
    map.setPaintProperty('parade-casing', 'line-opacity', selectedId ? 0.3 : 0.7);
  }

  function setParadeHover(id) {
    if (hoverId === id) return;
    if (hoverId && paradeMarkerEls[hoverId]) paradeMarkerEls[hoverId].classList.remove('is-hover');
    hoverId = id;
    if (id && paradeMarkerEls[id]) paradeMarkerEls[id].classList.add('is-hover');
    syncParadeHighlight();
  }

  function setParadeSelected(id) {
    if (selectedId && paradeMarkerEls[selectedId]) paradeMarkerEls[selectedId].classList.remove('is-open');
    selectedId = id;
    if (id && paradeMarkerEls[id]) paradeMarkerEls[id].classList.add('is-open');
    syncParadeHighlight();
  }

  // Layers live in the style, so they are put back whenever the style (light/dark) is swapped.
  function addParadeLayers() {
    if (map.getSource('parades')) return;
    var c = paradeColors();
    map.addSource('parades', { type: 'geojson', data: paradeCollection() });
    var round = { 'line-join': 'round', 'line-cap': 'round' };
    var none = ['==', ['get', 'id'], NONE];
    // Live routes ripple outward like a live venue's marker; animateLiveRoutes drives width and opacity.
    map.addLayer({ id: 'parade-live-glow', type: 'line', source: 'parades', layout: round, filter: liveFilter(), paint: {
      'line-color': c.line, 'line-width': 6, 'line-opacity': 0, 'line-blur': 4,
      // Mapbox eases every paint change over 300ms by default. Updated each frame, that easing lags
      // behind, so at the loop's reset the line shrank slowly while its opacity jumped back up: a
      // flash of a wide, solid glow, the same flicker the venue ripple once had in Safari.
      'line-width-transition': { duration: 0, delay: 0 }, 'line-opacity-transition': { duration: 0, delay: 0 },
    } });
    map.addLayer({ id: 'parade-casing', type: 'line', source: 'parades', layout: round, paint: { 'line-color': c.casing, 'line-width': 8, 'line-opacity': 0.7 } });
    map.addLayer({ id: 'parade-line', type: 'line', source: 'parades', layout: round, paint: { 'line-color': c.line, 'line-width': 4.5 } });
    map.addLayer({ id: 'parade-hover-casing', type: 'line', source: 'parades', layout: round, filter: none, paint: { 'line-color': c.casing, 'line-width': 11, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'parade-hover-line', type: 'line', source: 'parades', layout: round, filter: none, paint: { 'line-color': c.line, 'line-width': 6.5 } });
    map.addLayer({ id: 'parade-selected-casing', type: 'line', source: 'parades', layout: round, filter: none, paint: { 'line-color': c.casing, 'line-width': 13 } });
    map.addLayer({ id: 'parade-selected-line', type: 'line', source: 'parades', layout: round, filter: none, paint: { 'line-color': c.line, 'line-width': 8 } });
    // A wide invisible line, so the route is easy to tap.
    map.addLayer({ id: 'parade-hit', type: 'line', source: 'parades', layout: round, paint: { 'line-color': c.line, 'line-width': 22, 'line-opacity': 0 } });
    syncParadeHighlight();
    startLiveRipple();
  }
  map.on('style.load', addParadeLayers);

  /** A parade's card selects its route while it is open, whether it was opened from the route or the marker. */
  function bindSelection(popup, p) {
    popup.on('open', function () { setParadeSelected(p.id); });
    popup.on('close', function () { if (selectedId === p.id) setParadeSelected(null); });
    return popup;
  }

  function openParade(p, lngLat) {
    if (paradePopup) paradePopup.remove();
    paradePopup = bindSelection(makePopup(paradeModel(p)), p).setLngLat(lngLat).addTo(map);
  }
  // When routes overlap, prefer the one already picked, so a click along it doesn't jump to a neighbor.
  function hitParadeId(e) {
    var ids = (e.features || []).map(function (f) { return f.properties.id; });
    return ids.indexOf(selectedId) >= 0 ? selectedId : ids[0];
  }
  // Markers sit over the canvas and their mouse events still reach the map. A start marker
  // speaks only for its own parade, so the routes passing under it ignore those events.
  function fromMarker(e) {
    var t = e.originalEvent && e.originalEvent.target;
    return !!(t && t.closest && t.closest('.mapboxgl-marker'));
  }
  map.on('click', 'parade-hit', function (e) {
    if (fromMarker(e)) return;
    var id = hitParadeId(e);
    var p = shownParades.filter(function (x) { return x.id === id; })[0];
    if (p) openParade(p, e.lngLat);
  });
  map.on('mousemove', 'parade-hit', function (e) {
    if (fromMarker(e)) return;
    map.getCanvas().style.cursor = 'pointer';
    setParadeHover(hitParadeId(e));
  });
  map.on('mouseleave', 'parade-hit', function () {
    map.getCanvas().style.cursor = '';
    setParadeHover(markerHoverId);
  });

  /** Draw the day's parades: the route when the city gave one, and a marker where it starts. */
  function renderParades(day, bounds) {
    shownParades = selectParades(day);
    if (paradePopup) paradePopup.remove();
    paradeMarkerEls = {};
    hoverId = null;
    markerHoverId = null;
    setParadeSelected(null);
    var now = Date.now();
    liveIds = shownParades.filter(function (p) { return p.g && isParadeLive(p, now); }).map(function (p) { return p.id; });
    startLiveRipple();
    if (map.getSource('parades')) map.getSource('parades').setData(paradeCollection());
    shownParades.forEach(function (p) {
      (p.g ? (p.g.type === 'LineString' ? [p.g.coordinates] : p.g.coordinates) : []).forEach(function (line) {
        line.forEach(function (c) { bounds.extend(c); });
      });
      if (!p.p) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'marker marker--parade' + (isParadeLive(p, now) ? ' live' : '');
      el.setAttribute('aria-label', p.n + ': ' + (KIND[p.c] || KIND.other).toLowerCase() + (p.g ? ', start of route' : ''));
      paradeMarkerEls[p.id] = el;
      el.addEventListener('mouseenter', function () { markerHoverId = p.id; setParadeHover(p.id); });
      el.addEventListener('mouseleave', function () { markerHoverId = null; setParadeHover(null); });
      var popup = bindSelection(makePopup(paradeModel(p)), p);
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

  // Food pop-ups: the same day rules as shows, from their own list.
  function selectFood(day) {
    var now = Date.now();
    var today = nightKey(now);
    return (data.food || []).filter(function (ev) {
      var t = eventTimes(ev);
      if (day === 'live') return isLive(ev, now);
      var key = ev.a ? ev.s : nightKey(t.start);
      if (String(day).length === 10) return key === day;
      return key === addDays(today, Number(day)) && t.end >= now;
    });
  }

  // Street events (festivals, markets, block parties from city permits): the same day rules again.
  function selectStreet(day) {
    var now = Date.now();
    var today = nightKey(now);
    return (data.street || []).filter(function (ev) {
      var t = eventTimes(ev);
      if (day === 'live') return isLive(ev, now);
      var key = ev.a ? ev.s : nightKey(t.start);
      if (String(day).length === 10) return key === day;
      return key === addDays(today, Number(day)) && t.end >= now;
    });
  }

  function hasShows(day) {
    return select(day).some(function (ev) { return data.venues[ev.v]; }) || selectFood(day).length > 0 || selectParades(day).length > 0 || selectStreet(day).length > 0;
  }

  function button(day) {
    return buttons.filter(function (b) { return b.dataset.day === day; })[0];
  }

  // An event title with the artists in it (ev.ar: [slug, start, end]) linked to their pages.
  function titleHtml(ev) {
    var html = '';
    var at = 0;
    (ev.ar || []).forEach(function (m) {
      html += esc(ev.t.slice(at, m[1])) + '<a href="' + cfg.base + '/artists/' + m[0] + '">' + esc(ev.t.slice(m[1], m[2])) + '</a>';
      at = m[2];
    });
    return html + esc(ev.t.slice(at));
  }

  function foodIconHtml(ev) {
    var paths = (data.foodIcons || {})[ev.i];
    return paths ? '<span class="popup-food-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' + paths + '</svg></span>' : '';
  }
  function showRow(ev, now) {
    return { type: 'show', time: ev.a ? 'All day' : timeFmt.format(new Date(Date.parse(ev.s))), live: isLive(ev, now) ? 'Live now' : '', html: titleHtml(ev) };
  }
  function foodRow(ev, now) {
    return {
      type: 'food',
      time: ev.a ? 'All day' : timeFmt.format(new Date(Date.parse(ev.s))),
      live: isLive(ev, now) ? 'Open now' : '',
      html: '<a href="' + cfg.base + '/food/' + esc(ev.f) + '">' + esc(ev.n) + '</a>',
      icon: foodIconHtml(ev),
      note: ev.u ? 'Not confirmed recently' : '',
    };
  }
  // A street event's own card says what kind of event it is and where; on a venue's card its name
  // stands in for a show title. The city gives hours for only some of them.
  function streetTime(ev) {
    return ev.a ? '' : timeFmt.format(new Date(Date.parse(ev.s)));
  }
  function streetRow(ev, now) {
    return { type: 'street', time: streetTime(ev), live: isLive(ev, now) ? 'Happening now' : '', html: esc(ev.st || '') };
  }
  function streetModel(ev, now) {
    return { kind: 'street', name: ev.n, href: null, image: null, rows: [streetRow(ev, now)], note: '' };
  }
  // Shows first, then any street event next door, then the food there the same day.
  function venueModel(slug, venue, events, now, foodEvents, streetEvents) {
    return {
      kind: 'venue',
      name: venue.name,
      href: cfg.base + '/venues/' + slug,
      image: venue.image,
      rows: events.map(function (ev) { return showRow(ev, now); })
        .concat((streetEvents || []).map(function (ev) { return { type: 'street', time: streetTime(ev), live: isLive(ev, now) ? 'Happening now' : '', html: esc(ev.n) }; }))
        .concat(foodEvents.map(function (ev) { return foodRow(ev, now); })),
      note: '',
    };
  }
  function foodModel(place, events, now) {
    // A pop-up at a music venue with no show that day still gets the venue's page and photo.
    var venue = place.venue ? data.venues[place.venue] : null;
    return {
      kind: 'food',
      name: place.name,
      href: place.venue ? cfg.base + '/venues/' + place.venue : null,
      image: venue ? venue.image : null,
      rows: events.map(function (ev) { return foodRow(ev, now); }),
      note: '',
    };
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

    // Food pop-ups by place. A place that is also a venue shares the venue's key, so a bar with
    // both a band and a pop-up gets one marker in the music color.
    var foodByPlace = {};
    selectFood(day).forEach(function (ev) {
      (foodByPlace[ev.p] = foodByPlace[ev.p] || []).push(ev);
    });
    (data.food || []).forEach(function (ev) {
      if (isLive(ev, now)) liveVenues[ev.p] = true;
    });

    var bounds = new mapboxgl.LngLatBounds();
    function addMarker(key, lngLat, className, label, model, far) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = className + (liveVenues[key] ? ' live' : '');
      el.setAttribute('aria-label', label);
      el.style.setProperty('--delay', (Math.random() * 4).toFixed(2) + 's');
      var popup = makePopup(model);
      popup.on('open', function () { el.classList.add('is-open'); });
      popup.on('close', function () { el.classList.remove('is-open'); });
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat(lngLat).setPopup(popup).addTo(map));
      // A truck parked out of town still gets its marker, but the map stays framed on the city.
      if (!far) bounds.extend(lngLat);
    }

    // A street event next to a venue with shows that day goes on the venue's card; the rest get their own marker.
    var streetByVenue = {};
    var streetAlone = [];
    selectStreet(day).forEach(function (ev) {
      if (ev.v && byVenue[ev.v] && data.venues[ev.v]) (streetByVenue[ev.v] = streetByVenue[ev.v] || []).push(ev);
      else streetAlone.push(ev);
    });
    (data.street || []).forEach(function (ev) {
      if (isLive(ev, now)) liveVenues[ev.v && byVenue[ev.v] ? ev.v : 'street:' + ev.id] = true;
    });

    Object.keys(byVenue).forEach(function (slug) {
      var venue = data.venues[slug];
      if (!venue) return;
      var food = foodByPlace[slug] || [];
      delete foodByPlace[slug];
      var street = streetByVenue[slug] || [];
      addMarker(slug, [venue.lng, venue.lat], 'marker',
        venue.name + ': ' + count(byVenue[slug].length, 'show', 'shows') + (food.length ? ', ' + count(food.length, 'food pop-up', 'food pop-ups') : ''),
        venueModel(slug, venue, byVenue[slug], now, food, street));
    });
    streetAlone.forEach(function (ev) {
      addMarker('street:' + ev.id, ev.p, 'marker marker--street', ev.n + (ev.st ? ', ' + ev.st : ''), streetModel(ev, now));
    });
    Object.keys(foodByPlace).forEach(function (key) {
      var place = (data.foodPlaces || {})[key];
      if (!place) return;
      addMarker(key, [place.lng, place.lat], 'marker marker--food',
        place.name + ': ' + count(foodByPlace[key].length, 'food pop-up', 'food pop-ups'),
        foodModel(place, foodByPlace[key], now), place.far);
    });

    var paradeCount = renderParades(day, bounds);
    var labels = { live: 'right now', 0: 'tonight', 1: 'tomorrow' };
    var dated = String(day).length === 10;
    if (dated) labels[day] = 'for ' + dayFmt.format(new Date(day + 'T12:00:00Z'));
    // "Showing <date>" is a note, not an empty state: it sits at the foot of the map, clear of the cards.
    statusEl.classList.toggle('map-status--note', dated && !!(markers.length || paradeCount));
    if (!markers.length && !paradeCount) {
      setStatus('No shows listed ' + labels[day] + '. Try another day or browse the <a href="' + cfg.base + '/venues">venue directory</a>.');
    } else {
      setStatus(dated ? 'Showing ' + dayFmt.format(new Date(day + 'T12:00:00Z')) + '.' : '');
      var pad = Math.max(40, Math.min(window.innerWidth, window.innerHeight) / 10);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: pad + 50 + headerOverlap(), bottom: pad + 40, left: pad, right: pad }, maxZoom: 15, duration: 600 });
    }
  }

  function choose(day) {
    buttons.forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.day === String(day)));
    });
    render(day);
  }

  // /?when=live and /?when=tomorrow keep the choice in the address, for a bookmark or a shared link.
  // Today is the plain address. Picking a day drops a linked date and parade.
  var WHEN = { live: 'live', tomorrow: '1' };
  function rememberDay(day) {
    var url = new URL(location.href);
    var when = Object.keys(WHEN).filter(function (k) { return WHEN[k] === String(day); })[0];
    if (when) url.searchParams.set('when', when);
    else url.searchParams.delete('when');
    url.searchParams.delete('date');
    url.searchParams.delete('parade');
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      choose(b.dataset.day);
      rememberDay(b.dataset.day);
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
      // A link to a particular day (from a parade page) wins over tonight, then a bookmarked ?when=.
      var linkedWhen = WHEN[params.get('when')];
      if (linkedWhen && button(linkedWhen) && button(linkedWhen).disabled) linkedWhen = null;
      var start = function () { choose(linkedDate || linkedWhen || (anyToday ? 0 : 1)); };
      if (map.loaded()) start();
      else map.once('load', start);
    })
    .catch(function () {
      setStatus('Couldn’t load tonight’s shows. Browse the <a href="' + cfg.base + '/venues">venue directory</a> instead.');
    });
})();
