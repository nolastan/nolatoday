import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { SOURCES, encodePolyline, linesOf, simplify, startStreet } from '../../scripts/lib/parades.js';

const KIND = { mardi_gras: 'Carnival parade', second_line: 'Second line', other: 'Parade' };
const MAX_PAST = 10;

const day = (iso) => DateTime.fromISO(iso, { zone: ZONE });
const clock = (iso) => {
  const dt = DateTime.fromISO(iso, { zone: ZONE });
  return dt.toFormat(dt.minute ? 'h:mm a' : 'h a').toLowerCase();
};

/** "Sunday, November 22" plus the year when it is not this one. */
function longDate(iso, today) {
  const dt = day(iso);
  return dt.toFormat(dt.year === day(today).year ? 'cccc, LLLL d' : 'cccc, LLLL d, yyyy');
}

const ROUTE_COLOR = { light: 'e8590c', dark: 'ffa500' };

/**
 * The picture sizes a parade map is drawn at. `padding` (top, right, bottom, left) keeps the route
 * inside the part of the picture that stays visible once the page crops and fades it.
 */
const MAP_SIZES = {
  // Wide screens crop the top and bottom, and the bottom quarter fades into the page.
  banner: { width: 1280, height: 460, padding: [90, 70, 150, 70], zoom: 14.5 },
  // Phones show the whole picture at 16:9.
  bannerSmall: { width: 640, height: 360, padding: [36, 36, 96, 36], zoom: 14 },
  card: { width: 400, height: 225, padding: [28, 28, 28, 28], zoom: 13.5 },
  share: { width: 1200, height: 630, padding: [60, 60, 60, 60], zoom: 14.5, retina: false },
};

/** A Mapbox static image of a route, framed to fit it. Null without a token or a line. */
export function routeMapUrl(ctx, feature, { theme, width, height, retina = true, padding = [50, 50, 50, 50] }) {
  const { mapbox } = ctx.config;
  if (!mapbox.token || !feature?.geometry) return null;
  const style = theme === 'light' ? mapbox.styleLight : mapbox.styleDark;
  const color = ROUTE_COLOR[theme] ?? ROUTE_COLOR.dark;
  // The address has to stay well under the API's 8,192 characters, so long routes are drawn more coarsely.
  let overlays = '';
  for (const tolerance of [0.00003, 0.00008, 0.0002, 0.0005, 0.001]) {
    overlays = linesOf(simplify(feature.geometry, tolerance))
      .map((line) => `path-5+${color}-0.9(${encodeURIComponent(encodePolyline(line))})`)
      .join(',');
    if (overlays.length < 6000) break;
  }
  if (overlays.length >= 6000) return null;
  return `https://api.mapbox.com/styles/v1/${style}/static/${overlays}/auto/${width}x${height}${retina ? '@2x' : ''}?padding=${padding.join(',')}&access_token=${mapbox.token}&attribution=false&logo=false`;
}

/**
 * A Mapbox static image of the neighborhood a parade starts in, for parades with no route line.
 * Nothing is drawn on it: the city gives the start as an address only, so the map shows the general area.
 */
export function areaMapUrl(ctx, feature, { theme, width, height, retina = true, zoom = 14, padding = [0, 0, 0, 0] }) {
  const { mapbox } = ctx.config;
  const point = feature?.properties?.start_point;
  if (!mapbox.token || !point) return null;
  const style = theme === 'light' ? mapbox.styleLight : mapbox.styleDark;
  // Centre the start in the part of the picture that doesn't fade into the page.
  const metersPerPixel = (156543.03 * Math.cos((point[1] * Math.PI) / 180)) / 2 ** (zoom + 1);
  const lat = point[1] - (((padding[2] - padding[0]) / 2) * metersPerPixel) / 111320;
  return `https://api.mapbox.com/styles/v1/${style}/static/${point[0].toFixed(6)},${lat.toFixed(6)},${zoom},0/${width}x${height}${retina ? '@2x' : ''}?access_token=${mapbox.token}&attribution=false&logo=false`;
}

/** The map picture for a parade at one of the sizes above: its route, else the area it starts in. */
export function paradeMapUrl(ctx, feature, theme, size) {
  const opts = { theme, ...MAP_SIZES[size] };
  return routeMapUrl(ctx, feature, opts) ?? areaMapUrl(ctx, feature, opts);
}

/** A small drawing of the route's shape for a directory card. No map tiles, so it costs nothing to show. */
export function routeSvg(feature, { width = 320, height = 180, pad = 18 } = {}) {
  const lines = linesOf(simplify(feature?.geometry, 0.00008));
  if (!lines.length) return null;
  const k = Math.cos((lines[0][0][1] * Math.PI) / 180);
  const pts = lines.map((line) => line.map(([lng, lat]) => [lng * k, -lat]));
  const xs = pts.flat().map((p) => p[0]);
  const ys = pts.flat().map((p) => p[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const scale = Math.min((width - 2 * pad) / (Math.max(...xs) - minX || 1e-9), (height - 2 * pad) / (Math.max(...ys) - minY || 1e-9));
  const offX = (width - (Math.max(...xs) - minX) * scale) / 2;
  const offY = (height - (Math.max(...ys) - minY) * scale) / 2;
  const d = pts.map((line) => line.map(([x, y], i) => `${i ? 'L' : 'M'}${(offX + (x - minX) * scale).toFixed(1)} ${(offY + (y - minY) * scale).toFixed(1)}`).join('')).join('');
  const [sx, sy] = [offX + (pts[0][0][0] - minX) * scale, offY + (pts[0][0][1] - minY) * scale];
  return `<svg class="route-thumb" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="currentColor"/></svg>`;
}

const photoUrl = (ctx, file) => ctx.asset(`/images/parades/${file}`);
const smallPhoto = (file) => file.replace(/\.jpg$/, '-600.jpg');

/** Whose photo it is and under what license, as venue photos are credited. */
function photoCredit(credit) {
  return `<figcaption class="photo-credit">Photo by <a href="${esc(credit.source)}" rel="noopener">${esc(credit.author)}</a>, <a href="${esc(credit.licenseUrl)}" rel="license noopener">${esc(credit.license)}</a>${credit.via ? `, via ${esc(credit.via)}` : ''}</figcaption>`;
}

/**
 * An organization's photos beside its name. More than one becomes a strip that is swiped or scrolled
 * sideways, one photo at a time; site.js adds the dots and arrows, and without it the strip still scrolls.
 */
function photoStrip(ctx, org) {
  const photos = org.photos ?? [];
  if (!photos.length) return '';
  const slides = photos
    .map((photo, i) => {
      const [small, large] = [photoUrl(ctx, smallPhoto(photo.file)), photoUrl(ctx, photo.file)];
      return `<figure class="photo-slide"><img src="${small}" srcset="${small} 600w, ${large} 1200w" sizes="(min-width: 900px) 520px, 100vw" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="${i ? 'lazy' : 'eager'}" decoding="async">${photoCredit(photo.credit)}</figure>`;
    })
    .join('');
  if (photos.length === 1) return `<div class="venue-photo parade-photos">${slides}</div>`;
  return `<div class="venue-photo parade-photos" data-photo-strip role="group" aria-roledescription="carousel" aria-label="${esc(`Photos of ${org.name}`)}"><div class="photo-track" data-photo-track tabindex="0">${slides}</div></div>`;
}

/** Parades as a schedule, the way a venue's shows are listed: a day heading, then a time and a title. */
function paradeList(ctx, features, today) {
  return features
    .map((f) => {
      const p = f.properties;
      const dt = day(p.date);
      const onMap = p.date >= today && (f.geometry || p.start_point);
      const title = onMap ? `<a href="${ctx.url(`/?date=${p.date}&parade=${encodeURIComponent(p.id)}`)}">${esc(p.name)}</a>` : esc(p.name);
      return `<div class="day" id="${esc(p.id)}">
        <h3 class="day-heading"><span class="day-name">${dt.toFormat('cccc')}</span> <span class="day-date">${dt.toFormat(dt.year === day(today).year ? 'LLLL d' : 'LLLL d, yyyy')}</span></h3>
        <ul class="event-list">
          <li class="event">
            <time class="event-time" datetime="${esc(p.start_time ?? p.date)}">${p.start_time ? clock(p.start_time) : ''}</time>
            <span class="event-title">${title}</span>
          </li>
        </ul>
      </div>`;
    })
    .join('\n');
}

/** Links to the city records an organization's parades came from. */
function sourceLinks(features) {
  const seen = new Map();
  for (const f of features) {
    const p = f.properties;
    const label = p.field_sources?.schedule === 'permits' ? `permit application ${p.permit_number}` : (SOURCES[p.field_sources?.schedule]?.title ?? 'official data');
    if (!seen.has(p.source_url)) seen.set(p.source_url, label);
  }
  return [...seen].map(([href, label]) => `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`).join(', ');
}

function eventSchema(ctx, org, f) {
  const p = f.properties;
  const schema = {
    '@type': 'Event',
    name: p.name,
    startDate: p.start_time ?? p.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true,
    url: `${ctx.config.siteUrl}/parades/${org.slug}#${p.id}`,
    location: {
      '@type': 'Place',
      name: startStreet(p.start_address) ?? p.formation ?? p.area ?? 'New Orleans',
      address: { '@type': 'PostalAddress', addressLocality: 'New Orleans', addressRegion: 'LA', addressCountry: 'US' },
    },
    organizer: { '@type': 'Organization', name: org.name },
  };
  if (p.end_time) schema.endDate = p.end_time;
  return schema;
}

/** One organization's page: its next parade, the route, and what it has rolled before. */
export function paradePage(ctx, org, { today }) {
  const { config, url } = ctx;
  const canonical = `${config.siteUrl}/parades/${org.slug}`;
  const kind = KIND[org.category] ?? KIND.other;
  const next = org.upcoming[0];
  const featured = org.featured;
  const fp = featured.properties;

  const when = next
    ? `${longDate(next.properties.date, today)}${next.properties.start_time ? ` at ${clock(next.properties.start_time)}` : ''}`
    : null;
  const title = next
    ? `${org.name} ${kind === 'Second line' ? 'Second Line' : 'Parade'} ${day(next.properties.date).toFormat('yyyy')} – Route & Start Time – NOLA.Today`
    : `${org.name} – New Orleans ${kind === 'Second line' ? 'Second Line' : 'Parade'} Route – NOLA.Today`;
  const description = next
    ? `${org.name} ${kind.toLowerCase()} in New Orleans: ${when}${startStreet(next.properties.start_address) ? `, starting on ${startStreet(next.properties.start_address)}` : ''}. Route map and details from City of New Orleans records.`
    : `${org.name} ${kind.toLowerCase()} in New Orleans. Last listed ${longDate(fp.date, today)}. Route map and details from City of New Orleans records.`;

  // One picture per theme, each with a 16:9 version for phones, so the route is never cropped away.
  const banner = (theme, loading) => {
    const wide = paradeMapUrl(ctx, featured, theme, 'banner');
    const small = paradeMapUrl(ctx, featured, theme, 'bannerSmall');
    return `<picture class="only-${theme}"><source media="(max-width: 700px)" srcset="${esc(small)}" width="640" height="360"><img src="${esc(wide)}" alt="" width="1280" height="460" loading="${loading}" decoding="async"></picture>`;
  };
  const hasBanner = Boolean(paradeMapUrl(ctx, featured, 'dark', 'banner'));
  const bannerLabel = featured.geometry ? `Map of the ${org.name} route` : `Map of the area where ${org.name} starts`;
  const bannerHtml = hasBanner
    ? `<div class="map-banner map-banner--route" role="img" aria-label="${esc(bannerLabel)}">${banner('dark', 'eager')}${banner('light', 'lazy')}</div>`
    : '<div class="map-banner map-banner--empty" aria-hidden="true"></div>';

  const street = startStreet(fp.start_address);
  const photos = photoStrip(ctx, org);
  const hero = `<section class="venue-hero parade-hero${hasBanner ? ' parade-hero--below' : ''}${photos ? ' parade-hero--photos' : ''} wrap">
    <div class="venue-hero-text">
      <span class="badge">${esc(kind)}</span>
      <h1>${esc(org.name)}</h1>
      ${street ? `<p class="venue-address">Starts on ${esc(street)}</p>` : ''}
      ${org.website ? `<div class="button-row"><a class="button primary" href="${esc(org.website)}" rel="noopener">Visit website</a></div>` : ''}
    </div>
    ${photos}
  </section>`;

  const upcoming = org.upcoming.length
    ? `<section class="wrap schedule">
      <h2>Upcoming parades</h2>
      ${paradeList(ctx, org.upcoming, today)}
    </section>`
    : '';
  const shownPast = org.past.slice(0, MAX_PAST);
  const past = shownPast.length
    ? `<section class="wrap schedule">
      <h2>Recent parades</h2>
      ${paradeList(ctx, shownPast, today)}
    </section>`
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Parades', item: `${config.siteUrl}/parades` },
          { '@type': 'ListItem', position: 2, name: org.name, item: canonical },
        ],
      },
      ...org.upcoming.slice(0, 10).map((f) => eventSchema(ctx, org, f)),
    ],
  };
  const reportUrl = `https://github.com/${config.repo}/issues/new?labels=data&title=${encodeURIComponent(`Parade data: ${org.name}`)}&body=${encodeURIComponent(`Page: ${canonical}\n\nWhat's wrong?\n`)}`;

  const body = `${siteHeader(ctx, { current: 'parades' })}
<main class="venue-page parade-page">
  ${bannerHtml}
  ${hero}
  ${upcoming}
  ${past}
  <section class="wrap venue-foot muted">
    <p>Source: City of New Orleans, ${sourceLinks([...org.upcoming, ...shownPast])}. <a href="${esc(reportUrl)}" rel="noopener">Report a problem with this page</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title,
    description,
    canonical,
    image: org.photos?.[0] ? `${config.siteUrl}/images/parades/${org.photos[0].file}` : paradeMapUrl(ctx, featured, 'dark', 'share'),
    bodyClass: 'page-venue page-parade',
    head: `<script type="application/ld+json">${jsonScript(jsonLd)}</script>`,
    body,
  });
}

/** The parades directory: every krewe and club the city has listed, soonest first. */
export function paradesPage(ctx, orgs, { today, sources = [] }) {
  const { config, url } = ctx;
  const coming = orgs.filter((o) => o.upcoming.length);
  const earlier = orgs.filter((o) => !o.upcoming.length);

  const card = (org) => {
    const f = org.featured;
    const p = f.properties;
    const upcoming = org.upcoming.length > 0;
    const dt = day(p.date);
    const whenText = upcoming
      ? `${p.date === today ? 'Today' : dt.toFormat(dt.year === day(today).year ? 'ccc, LLL d' : 'ccc, LLL d, yyyy')}${p.start_time ? ` · ${clock(p.start_time)}` : ''}`
      : `Last listed ${dt.toFormat('LLL d, yyyy')}`;
    const where = startStreet(p.start_address) ?? p.area;
    const mapImg = (theme) => `<img class="only-${theme}" src="${esc(paradeMapUrl(ctx, f, theme, 'card'))}" alt="" width="400" height="225" loading="lazy" decoding="async">`;
    // The organization's first photo. Without one, a map of the route or of the area it starts in, and without a map token, the bare route shape.
    const photo = org.photos?.[0];
    let media;
    if (photo) media = `<img src="${photoUrl(ctx, smallPhoto(photo.file))}" alt="" loading="lazy" decoding="async">`;
    else if (paradeMapUrl(ctx, f, 'dark', 'card')) media = `${mapImg('dark')}${mapImg('light')}`;
    else media = routeSvg(f) ?? `<span class="card-placeholder" aria-hidden="true">♪</span>`;
    return `<li class="venue-card parade-card" data-name="${esc(`${org.name} ${p.name} ${where ?? ''}`.toLowerCase())}">
      <a href="${url(`/parades/${org.slug}`)}">
        <div class="card-media">${media}</div>
        <div class="card-body">
          <h2>${esc(org.name)}</h2>
          <p class="card-address muted">${esc(KIND[org.category] ?? KIND.other)}${where ? ` · ${esc(where)}` : ''}</p>
          <p class="card-next${upcoming ? '' : ' muted'}">${esc(whenText)}</p>
          ${f.geometry ? '' : '<p class="card-count muted">No route published</p>'}
        </div>
      </a>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'parades' })}
<main class="wrap venues-page parades-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans parades</h1>
    <p class="lede">Second lines, walking krewes and Carnival parades, with routes and start times from City of New Orleans records. Tap a parade for its route.</p>
    <label class="search"><span class="visually-hidden">Filter parades</span><input type="search" placeholder="Filter by name or street" data-venue-filter autocomplete="off"></label>
  </div>
  ${coming.length ? '' : '<div class="notice"><p>No coming parades are listed by the city right now. Second lines usually appear a few weeks ahead, and Carnival routes each January.</p></div>'}
  <ul class="venue-grid" data-venue-grid>
    ${coming.map(card).join('')}
    ${earlier.map(card).join('')}
  </ul>
  <p class="muted" data-venue-empty hidden>No parades match that search.</p>
  <section class="parade-attribution muted" id="sources">
    <h2>Where this comes from</h2>
    <p>Everything here comes from records the City of New Orleans publishes:</p>
    <ul>
      ${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>, ${esc(s.publisher)}${s.note ? `. ${esc(s.note)}` : ''}</li>`).join('\n      ')}
    </ul>
    <p>The city offers this data for general information and does not guarantee it. Second lines and walking parades are shown from permit applications, which are requests, not approvals, and only public parades are included. Routes written out in words are drawn along the city’s street map by NOLA.Today; where that could not be done with confidence, no line is shown. Always check with the krewe or club before heading out. The combined data is available as <a href="${url('/parades.geojson')}">GeoJSON</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `New Orleans Parades & Second Lines – Routes and Start Times – NOLA.Today`,
    description: `Routes and start times for ${orgs.length} New Orleans second lines, walking krewes and Carnival parades, from City of New Orleans records.`,
    canonical: `${config.siteUrl}/parades`,
    bodyClass: 'page-venues page-parades',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: orgs.map((o, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/parades/${o.slug}`, name: o.name })),
    })}</script>`,
    body,
  });
}
