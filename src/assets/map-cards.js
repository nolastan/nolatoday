/*
 * PROTOTYPE: three pared-back directions for the map's marker cards, with a switcher to compare
 * them. Once one is picked, keep that renderer (and its block in map-cards.css), drop the other two
 * and the switcher, and fold what is left into map.js and styles.css.
 *
 * map.js describes a card as a plain model and this file turns it into HTML:
 *   { kind: 'venue' | 'food' | 'parade', name, href, image,
 *     rows: [{ type: 'show' | 'food' | 'parade', time: '7:00 PM', live: 'Live now' | '', html, icon, note }],
 *     note: a line under the rows, or '' }
 * `html` and `icon` are already escaped markup; everything else is plain text.
 *
 * Shared rules: the name is the one link to the venue's page (no separate button), "live" is said
 * once, on the row that is live, and nothing is shown that the rows already say.
 */
(function () {
  'use strict';

  var DESIGNS = [
    ['current', 'Current'],
    ['photo', 'Photo'],
    ['compact', 'Compact'],
    ['text', 'Text'],
  ];
  var KEY = 'nola-cards';
  var root = document.documentElement;

  function valid(d) {
    return DESIGNS.some(function (x) { return x[0] === d; }) ? d : null;
  }
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  // ?cards=compact links straight to one design; otherwise the last one picked, then the first new one.
  var design = valid(new URLSearchParams(location.search).get('cards')) || valid(stored()) || 'photo';
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
    return ' style="background-image:url(\'' + esc(image) + '\')"';
  }
  // The card's name, linked when the place has a page here (a bar that only hosts a pop-up has none).
  function nameHtml(m) {
    return m.href ? '<a href="' + m.href + '">' + esc(m.name) + '</a>' : esc(m.name);
  }
  // A live row says so where its time would be; the others give their time.
  function whenHtml(r) {
    return r.live ? '<span class="card-live">' + esc(r.live) + '</span>' : esc(r.time);
  }
  function rowsHtml(m, row) {
    return '<ul class="card-rows">' + m.rows.map(function (r) {
      return '<li class="card-row card-row--' + r.type + '">' + row(r) + '</li>';
    }).join('') + '</ul>' + (m.note ? '<p class="card-note">' + esc(m.note) + '</p>' : '');
  }
  function what(r) {
    return '<span class="card-what">' + (r.icon || '') + r.html + (r.note ? '<span class="card-row-note">' + esc(r.note) + '</span>' : '') + '</span>';
  }
  function when(r) {
    return '<span class="card-when">' + whenHtml(r) + '</span>';
  }

  // ---- 1. Photo: the photo edge to edge, the name on it, the night underneath -----------------
  // What's on reads first, with its time set quietly to the right. Without a photo there is no
  // banner at all, only the name.
  function photo(m) {
    var tag = m.href ? 'a' : 'div';
    var head = m.image
      ? '<' + tag + ' class="ph-photo"' + (m.href ? ' href="' + m.href + '"' : '') + bg(m.image) + '><h3>' + esc(m.name) + '</h3></' + tag + '>'
      : '<h3 class="ph-name">' + nameHtml(m) + '</h3>';
    return '<article class="ph">' + head + rowsHtml(m, function (r) { return what(r) + when(r); }) + '</article>';
  }

  // ---- 2. Compact: a small thumbnail beside the name, times in a column ------------------------
  // The smallest card that still shows the place. The only one with a close button, which sits in
  // the title row so it plainly belongs to the card.
  function compact(m) {
    return '<article class="cp">' +
      '<header class="cp-head">' +
      (m.image ? '<span class="cp-thumb"' + bg(m.image) + '></span>' : '') +
      '<h3>' + nameHtml(m) + '</h3>' +
      '</header>' +
      rowsHtml(m, function (r) { return when(r) + what(r); }) +
      '</article>';
  }

  // ---- 3. Text: no picture, just the name and the night ------------------------------------------
  // A frosted label on the map: each time sits small above what's on.
  function text(m) {
    return '<article class="tx">' +
      '<h3>' + nameHtml(m) + '</h3>' +
      rowsHtml(m, function (r) { return when(r) + what(r); }) +
      '</article>';
  }

  var RENDER = { photo: photo, compact: compact, text: text };

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
