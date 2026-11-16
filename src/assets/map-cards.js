/*
 * PROTOTYPE: three variants of the photo card for the map's markers, with a switcher to compare
 * them. Once one is picked, keep that renderer (and its block in map-cards.css), drop the other two,
 * the switcher and the demo data, and fold what is left into map.js and styles.css.
 *
 * map.js describes a card as a plain model and this file turns it into HTML:
 *   { kind: 'venue' | 'food' | 'parade', name, href, image,
 *     rows: [{ type: 'show' | 'food' | 'parade', time: '7:00 PM', live: 'Live now' | '', html, icon, note }],
 *     note: a line under the rows, or '' }
 * `html` and `icon` are already escaped markup; everything else is plain text.
 *
 * Shared rules: every card has a banner of the same height, a photo when there is one and a plain
 * placeholder in the kind's color when there isn't. The name is the one link to the page (no
 * separate button), "live" is said once, on the row that is live, and nothing is shown that the
 * rows already say.
 */
(function () {
  'use strict';

  var DESIGNS = [
    ['current', 'Current'],
    ['overlay', 'Overlay'],
    ['caption', 'Caption'],
    ['inset', 'Inset'],
  ];
  var KEY = 'nola-cards';
  var root = document.documentElement;

  function valid(d) {
    return DESIGNS.some(function (x) { return x[0] === d; }) ? d : null;
  }
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  // ?cards=caption links straight to one design; otherwise the last one picked, then the first new one.
  var design = valid(new URLSearchParams(location.search).get('cards')) || valid(stored()) || 'overlay';
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
    return m.href ? '<a class="card-name" href="' + m.href + '">' + esc(m.name) + '</a>' : esc(m.name);
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

  // Placeholder marks, drawn in the banner when there is no photo: a note for a venue, the
  // vendor's icon for a food stop, the parade marker's ring for a parade.
  var NOTE = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  var RING = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>';
  function mark(m) {
    var icon = '';
    if (m.kind === 'food') m.rows.forEach(function (r) { icon = icon || r.icon; });
    return '<span class="card-mark" aria-hidden="true">' + (icon || (m.kind === 'parade' ? RING : NOTE)) + '</span>';
  }
  // The banner: the photo, or the placeholder at the same size. inner goes on top of either.
  function banner(m, cls, inner) {
    var tag = m.href ? 'a' : 'div';
    return '<' + tag + ' class="card-banner card-banner--' + m.kind + (m.image ? '' : ' card-banner--none') + ' ' + cls + '"' +
      (m.href ? ' href="' + m.href + '"' : '') + (m.image ? bg(m.image) : '') +
      (inner ? '' : ' aria-label="' + esc(m.name) + '"') + '>' +
      (m.image ? '' : mark(m)) + inner + '</' + tag + '>';
  }

  // ---- 1. Overlay: the name on the banner ---------------------------------------------------------
  // Round two's Photo card, with a placeholder banner where there is no photo.
  function overlay(m) {
    return '<article class="ov">' +
      banner(m, 'ov-banner', '<h3>' + esc(m.name) + '</h3>') +
      rowsHtml(m, function (r) { return what(r) + when(r); }) +
      '</article>';
  }

  // ---- 2. Caption: the banner left clean, the name under it ---------------------------------------
  // Nothing is printed on the photo. The name leads the text, and times line up in a column.
  function caption(m) {
    return '<article class="ca">' +
      banner(m, 'ca-banner', '') +
      '<div class="ca-body"><h3>' + nameHtml(m) + '</h3>' +
      rowsHtml(m, function (r) { return when(r) + what(r); }) +
      '</div></article>';
  }

  // ---- 3. Inset: a framed photo on a frosted card ---------------------------------------------------
  // The banner sits inside the card with its own rounded corners, and the map shows through the
  // card behind it. Name under the photo, times to the right.
  function inset(m) {
    return '<article class="in">' +
      banner(m, 'in-banner', '') +
      '<div class="in-body"><h3>' + nameHtml(m) + '</h3>' +
      rowsHtml(m, function (r) { return what(r) + when(r); }) +
      '</div></article>';
  }

  var RENDER = { overlay: overlay, caption: caption, inset: inset };

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
