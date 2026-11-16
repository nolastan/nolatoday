/*
 * PROTOTYPE: three directions for the map's marker cards, with a switcher to compare them.
 * Once one is picked, keep that renderer (and its block in map-cards.css), drop the other two and the
 * switcher, and fold what is left into map.js and styles.css.
 *
 * map.js describes a card as a plain model and this file turns it into HTML:
 *   { kind: 'venue' | 'food' | 'parade', name, href, image, lngLat,
 *     when:    'Today' | 'Tomorrow' | 'Now' | 'Sun, Nov 22',
 *     summary: '4 shows' | '1 food pop-up' | 'Second line',
 *     live:    'Live now' | 'Open now' | 'Rolling now' | '',
 *     rows:    [{ type: 'show' | 'food' | 'parade', time: '7:00 PM', live, html, icon, note }],
 *     note:    a line under the rows, or '',
 *     more:    { href, text } }
 * `html` and `icon` are already escaped markup; everything else is plain text.
 */
(function () {
  'use strict';

  var DESIGNS = [
    ['current', 'Current'],
    ['marquee', 'Marquee'],
    ['postcard', 'Postcard'],
    ['sheet', 'Sheet'],
  ];
  var KEY = 'nola-cards';
  var root = document.documentElement;

  function valid(d) {
    return DESIGNS.some(function (x) { return x[0] === d; }) ? d : null;
  }
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  // ?cards=postcard links straight to one design; otherwise the last one picked, then the first new one.
  var design = valid(new URLSearchParams(location.search).get('cards')) || valid(stored()) || 'marquee';
  root.dataset.cards = design;

  function setDesign(d) {
    design = valid(d) || design;
    root.dataset.cards = design;
    try { localStorage.setItem(KEY, design); } catch (e) { /* private mode */ }
    var url = new URL(location.href);
    url.searchParams.set('cards', design);
    history.replaceState(null, '', url);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function bg(image) {
    return image ? ' style="background-image:url(\'' + esc(image) + '\')"' : '';
  }
  // The card's name, linked when the place has a page here (a bar that only hosts a pop-up has none).
  function nameHtml(m) {
    return m.href ? '<a href="' + m.href + '">' + esc(m.name) + '</a>' : esc(m.name);
  }
  function firstIcon(m) {
    for (var i = 0; i < m.rows.length; i++) if (m.rows[i].icon) return m.rows[i].icon;
    return '';
  }
  function glyph(m) {
    if (m.image) return '';
    if (m.kind === 'food') return '<span class="card-glyph" aria-hidden="true">' + firstIcon(m) + '</span>';
    if (m.kind === 'venue') return '<span class="card-glyph" aria-hidden="true">♪</span>';
    return '';
  }
  function directions(m) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + m.lngLat[1] + ',' + m.lngLat[0];
  }

  // ---- 1. Marquee: type only, the bill is the hero -------------------------------------------
  // No photo. The next act on is set big, like the top line of a theater marquee, with the time
  // in a column of display numerals beside it.
  function marquee(m) {
    var kicker = m.kind === 'parade' ? m.summary + ' · ' + m.when
      : m.kind === 'food' ? 'Food ' + m.when.toLowerCase() + ' at'
      : m.when + ' at';
    var rows = m.rows.map(function (r, i) {
      var cut = r.time.lastIndexOf(' ');
      var big = cut < 0 ? r.time : r.time.slice(0, cut);
      var small = cut < 0 ? '' : r.time.slice(cut + 1);
      return '<li class="mq-act mq-act--' + r.type + (i === 0 ? ' mq-act--lead' : '') + (r.live ? ' is-live' : '') + '">' +
        '<span class="mq-time"><b>' + esc(big) + '</b>' + (small ? '<i>' + esc(small) + '</i>' : '') + '</span>' +
        '<span class="mq-what">' +
        (r.live ? '<span class="mq-now">' + esc(r.live) + '</span>' : '') +
        '<span class="mq-title">' + (r.icon || '') + r.html + '</span>' +
        (r.note ? '<span class="mq-note">' + esc(r.note) + '</span>' : '') +
        '</span></li>';
    }).join('');
    return '<article class="mq mq--' + m.kind + '">' +
      '<div class="mq-bulbs" aria-hidden="true"></div>' +
      '<header class="mq-head"><p class="mq-kicker">' + esc(kicker) + '</p><h3>' + nameHtml(m) + '</h3></header>' +
      '<ol class="mq-bill">' + rows + '</ol>' +
      (m.note ? '<p class="mq-foot-note">' + esc(m.note) + '</p>' : '') +
      '<a class="mq-more" href="' + m.more.href + '">' + esc(m.more.text) + ' <span aria-hidden="true">→</span></a>' +
      '</article>';
  }

  // ---- 2. Postcard: the photo is the card ------------------------------------------------------
  // A tall photo with the name on it, a frosted body, and only the next three things on; the rest
  // fold away behind "more" so the card stays small enough to always fit beside its marker.
  var POSTCARD_ROWS = 3;
  function postcard(m) {
    function row(r) {
      return '<li class="pc-row pc-row--' + r.type + (r.live ? ' is-live' : '') + '">' +
        '<span class="pc-title">' + (r.icon || '') + r.html + (r.note ? '<span class="pc-note">' + esc(r.note) + '</span>' : '') + '</span>' +
        '<span class="pc-time">' + esc(r.live || r.time) + '</span>' +
        '</li>';
    }
    var rest = m.rows.slice(POSTCARD_ROWS);
    var tag = m.href ? 'a' : 'div';
    return '<article class="pc pc--' + m.kind + '">' +
      '<' + tag + ' class="pc-photo' + (m.image ? '' : ' pc-photo--none') + '"' + (m.href ? ' href="' + m.href + '"' : '') + bg(m.image) + '>' +
      glyph(m) +
      '<span class="pc-chips">' +
      (m.live ? '<span class="pc-chip pc-chip--live">' + esc(m.live) + '</span>' : '') +
      '<span class="pc-chip">' + esc(m.summary) + '</span>' +
      (m.kind === 'parade' ? '<span class="pc-chip">' + esc(m.when) + '</span>' : '') +
      '</span>' +
      '<h3>' + esc(m.name) + '</h3>' +
      '</' + tag + '>' +
      '<ul class="pc-rows">' + m.rows.slice(0, POSTCARD_ROWS).map(row).join('') + '</ul>' +
      (rest.length ? '<details class="pc-rest"><summary>' + rest.length + ' more</summary><ul class="pc-rows">' + rest.map(row).join('') + '</ul></details>' : '') +
      (m.note ? '<p class="pc-foot-note">' + esc(m.note) + '</p>' : '') +
      '<a class="pc-cta" href="' + m.more.href + '">' + esc(m.more.text) + '</a>' +
      '</article>';
  }

  // ---- 3. Sheet: a docked panel with the night as a timeline ----------------------------------
  // Not a bubble on the marker: a sheet along the bottom of a phone and a panel in the corner of a
  // desktop, so the map around the marker stays visible. Room for a timeline and for directions.
  function sheet(m) {
    var rows = m.rows.map(function (r) {
      return '<li class="sh-stop sh-stop--' + r.type + (r.live ? ' is-live' : '') + '">' +
        '<span class="sh-time">' + esc(r.time) + '</span>' +
        '<span class="sh-what"><span class="sh-title">' + (r.icon || '') + r.html + '</span>' +
        (r.live ? '<span class="sh-meta sh-meta--live">' + esc(r.live) + '</span>' : '') +
        (r.note ? '<span class="sh-meta">' + esc(r.note) + '</span>' : '') +
        '</span></li>';
    }).join('');
    var tag = m.href ? 'a' : 'span';
    return '<article class="sh sh--' + m.kind + '">' +
      '<header class="sh-head">' +
      '<' + tag + ' class="sh-thumb"' + (m.href ? ' href="' + m.href + '" tabindex="-1" aria-hidden="true"' : '') + bg(m.image) + '>' + glyph(m) + '</' + tag + '>' +
      '<div class="sh-id"><h3>' + nameHtml(m) + '</h3>' +
      '<p class="sh-sub">' + (m.live ? '<span class="sh-live">' + esc(m.live) + '</span>' : '') + esc(m.summary) + ' · ' + esc(m.when) + '</p></div>' +
      '</header>' +
      '<ol class="sh-line">' + rows + '</ol>' +
      (m.note ? '<p class="sh-foot-note">' + esc(m.note) + '</p>' : '') +
      '<div class="sh-actions">' +
      '<a class="sh-btn sh-btn--primary" href="' + m.more.href + '">' + esc(m.more.text) + '</a>' +
      '<a class="sh-btn" href="' + directions(m) + '" target="_blank" rel="noopener">Directions</a>' +
      '</div>' +
      '</article>';
  }

  var RENDER = { marquee: marquee, postcard: postcard, sheet: sheet };

  // The switcher sits under the time toggle. onChange redraws the map's cards in the new design.
  function mountSwitcher(parent, onChange) {
    var el = document.createElement('div');
    el.className = 'card-switch';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Card design (preview)');
    el.innerHTML = '<span class="card-switch-label">Cards</span>' + DESIGNS.map(function (d) {
      return '<button type="button" data-design="' + d[0] + '" aria-pressed="' + (d[0] === design) + '">' + d[1] + '</button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-design]');
      if (!b || b.dataset.design === design) return;
      setDesign(b.dataset.design);
      Array.prototype.forEach.call(el.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x.dataset.design === design));
      });
      onChange(design);
    });
    parent.appendChild(el);
  }

  window.NOLA_CARDS = {
    design: function () { return design; },
    /** The card in the chosen design, or null for "current", which map.js still draws itself. */
    html: function (model) { return RENDER[design] ? RENDER[design](model) : null; },
    mountSwitcher: mountSwitcher,
  };
})();
