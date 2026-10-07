import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter, themeToggle } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';

export function homePage(ctx) {
  const { config, url, asset } = ctx;
  const body = `<main class="map-page">
  <h1 class="visually-hidden">Live music in New Orleans tonight</h1>
  <div id="map" class="map" role="region" aria-label="Map of New Orleans music venues with shows"></div>
  <div class="map-top">
    <a class="brand map-brand" href="${url('/')}">NOLA<span>.</span>Today</a>
    <div class="segmented" role="tablist" aria-label="When">
      <button type="button" role="tab" data-day="live" aria-selected="false">Live</button>
      <button type="button" role="tab" data-day="0" aria-selected="true">Today</button>
      <button type="button" role="tab" data-day="1" aria-selected="false">Tomorrow</button>
    </div>
    ${themeToggle()}
  </div>
  <p class="map-status" data-map-status role="status" aria-live="polite"></p>
  <div class="map-bottom">
    <a class="pill-button" href="${url('/venues')}">Venue directory</a>
  </div>
  <noscript><p class="map-status">The map needs JavaScript. Browse the <a href="${url('/venues')}">venue directory</a> instead.</p></noscript>
</main>`;
  const mapConfig = {
    token: config.mapbox.token,
    styleDark: `mapbox://styles/${config.mapbox.styleDark}`,
    styleLight: `mapbox://styles/${config.mapbox.styleLight}`,
    center: config.mapbox.center,
    zoom: config.mapbox.zoom,
    eventsUrl: asset('/events.json'),
    base: url(''),
  };
  return layout(ctx, {
    title: 'NOLA.Today – Live Music in New Orleans Tonight',
    description: config.description,
    canonical: `${config.siteUrl}/`,
    bodyClass: 'page-map',
    head: `<link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css">
<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: config.siteName,
      url: `${config.siteUrl}/`,
      description: config.description,
    })}</script>`,
    scripts: `<script>window.NOLA_MAP=${jsonScript(mapConfig)};</script>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js" defer></script>
<script src="${asset('/assets/map.js')}" defer></script>`,
    body,
  });
}

export function venuesPage(ctx, venues, { eventsBySlug }) {
  const { config, url, asset } = ctx;
  const now = DateTime.now().setZone(ZONE);
  const today = now.toISODate();
  const active = venues.filter((v) => v.status === 'active');
  const closed = venues.filter((v) => v.status === 'closed');

  const nextOf = (v) => (eventsBySlug.get(v.slug) ?? []).find((e) => (e.end ?? e.start) >= today);
  // Venues with shows first (soonest show first), then the rest alphabetically.
  active.sort((a, b) => {
    const na = nextOf(a)?.start;
    const nb = nextOf(b)?.start;
    if (na && nb) return na.localeCompare(nb) || a.name.localeCompare(b.name);
    if (na) return -1;
    if (nb) return 1;
    return a.name.localeCompare(b.name);
  });

  const card = (v) => {
    const events = eventsBySlug.get(v.slug) ?? [];
    const next = nextOf(v);
    let nextText = 'No shows listed';
    if (next) {
      const dt = DateTime.fromISO(next.start, { zone: ZONE });
      const when = dt.toISODate() === today ? 'Tonight' : dt.toFormat('ccc, LLL d');
      nextText = `${when}: ${next.title}`;
    }
    const img = v.image
      ? `<img src="${asset(`/images/venues/${v.image.replace(/\.jpg$/, '-600.jpg')}`)}" alt="" loading="lazy" decoding="async">`
      : `<span class="card-placeholder" aria-hidden="true">♪</span>`;
    return `<li class="venue-card" data-name="${esc(v.name.toLowerCase())} ${esc(v.address.toLowerCase())}">
      <a href="${url(`/venues/${v.slug}`)}">
        <div class="card-media">${img}</div>
        <div class="card-body">
          <h2>${esc(v.name)}</h2>
          <p class="card-address muted">${esc(v.address)}</p>
          <p class="card-next${next ? '' : ' muted'}">${esc(nextText)}</p>
          ${events.length > 1 ? `<p class="card-count muted">${events.length} upcoming</p>` : ''}
        </div>
      </a>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'venues' })}
<main class="wrap venues-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans music venues</h1>
    <p class="lede">${active.length} clubs, bars and halls with live music — from Frenchmen Street to Oak Street. Tap a venue for its full schedule.</p>
    <label class="search"><span class="visually-hidden">Filter venues</span><input type="search" placeholder="Filter by name or street" data-venue-filter autocomplete="off"></label>
  </div>
  <ul class="venue-grid" data-venue-grid>
    ${active.map(card).join('')}
  </ul>
  <p class="muted" data-venue-empty hidden>No venues match that search.</p>
  ${
    closed.length
      ? `<section class="closed-venues">
    <h2>Closed venues</h2>
    <ul class="closed-list">${closed
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => `<li><a href="${url(`/venues/${v.slug}`)}">${esc(v.name)}</a></li>`)
      .join('')}</ul>
  </section>`
      : ''
  }
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `New Orleans Music Venues – ${now.toFormat('LLLL yyyy')} Schedules – NOLA.Today`,
    description: `Directory of ${active.length} live music venues in New Orleans with upcoming show schedules, updated several times a day.`,
    canonical: `${config.siteUrl}/venues`,
    bodyClass: 'page-venues',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: active.map((v, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${config.siteUrl}/venues/${v.slug}`,
        name: v.name,
      })),
    })}</script>`,
    body,
  });
}

/** A static stand-in for an HTTP redirect (GitHub Pages can't send 301s). */
export function redirectPage(ctx, target) {
  const absolute = new URL(target, ctx.config.siteUrl).toString();
  // Search engines ignore fragments; keep the canonical on the page itself.
  const canonical = absolute.replace(/#.*$/, '');
  const local = ctx.url(target);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${esc(local)}">
<script>location.replace(${jsonScript(local)}${target.includes('#') ? '' : ' + location.hash'});</script>
</head>
<body>
<p>This page has moved to <a href="${esc(local)}">${esc(absolute)}</a>.</p>
</body>
</html>
`;
}

export function notFoundPage(ctx) {
  const { url } = ctx;
  const body = `${siteHeader(ctx)}
<main class="wrap not-found">
  <span class="badge">404</span>
  <h1>That page isn’t here</h1>
  <p class="lede">NOLA.Today now focuses on live music venues. Try the <a href="${url('/')}">map of tonight’s shows</a> or the <a href="${url('/venues')}">venue directory</a>.</p>
</main>
${siteFooter(ctx)}`;
  return layout(ctx, { title: 'Page not found – NOLA.Today', description: 'Page not found.', body, noindex: true, bodyClass: 'page-404' });
}
