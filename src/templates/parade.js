import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { SOURCES, encodePolyline, linesOf, mardiGras, simplify, startStreet } from '../../scripts/lib/parades.js';

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

/** Where an organization's parades came from: city records, and any date its organizer announced first. */
function sourceLine(features) {
  const city = new Map();
  const own = new Map();
  for (const f of features) {
    const p = f.properties;
    if (p.field_sources?.schedule === 'organizer') {
      if (!own.has(p.source_url)) own.set(p.source_url, 'the organizer’s website');
      continue;
    }
    const label = p.field_sources?.schedule === 'permits' ? `permit application ${p.permit_number}` : (SOURCES[p.field_sources?.schedule]?.title ?? 'official data');
    if (!city.has(p.source_url)) city.set(p.source_url, label);
  }
  const links = (m) => [...m].map(([href, label]) => `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`).join(', ');
  return [city.size ? `City of New Orleans, ${links(city)}` : '', own.size ? `${links(own)} (dates the city has not listed yet)` : ''].filter(Boolean).join('; ');
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
      name: startStreet(p.start_address) ?? clean(p.formation) ?? p.area ?? 'New Orleans',
      address: { '@type': 'PostalAddress', addressLocality: 'New Orleans', addressRegion: 'LA', addressCountry: 'US' },
    },
    organizer: { '@type': 'Organization', name: org.name },
  };
  const street = startStreet(p.start_address) ?? clean(p.formation);
  if (street) schema.location.address.streetAddress = street;
  // Coordinates only where the city gives a start address. A route line's first point isn't always its start:
  // some of the city's Carnival lines are drawn from the end.
  if (p.start_point) schema.location.geo = { '@type': 'GeoCoordinates', latitude: p.start_point[1], longitude: p.start_point[0] };
  const photo = org.photos?.[0];
  const image = photo ? `${ctx.config.siteUrl}/images/parades/${photo.file}` : paradeMapUrl(ctx, f, 'dark', 'share');
  if (image) schema.image = [image];
  if (p.end_time) schema.endDate = p.end_time;
  return schema;
}

/** One organization's page: its next parade, the route, and what it has rolled before. */
export function paradePage(ctx, org, { today, orgs = [] }) {
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
    ? `${org.name} ${kind.toLowerCase()} in New Orleans: ${when}${startStreet(next.properties.start_address) ? `, starting on ${startStreet(next.properties.start_address)}` : ''}. ${next.properties.field_sources?.schedule === 'organizer' ? 'Date from the organizer’s own website.' : 'Route map and details from City of New Orleans records.'}`
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

  const where = startAndEnd(fp);
  const photos = photoStrip(ctx, org);
  const hero = `<section class="venue-hero parade-hero${hasBanner ? ' parade-hero--below' : ''}${photos ? ' parade-hero--photos' : ''} wrap">
    <div class="venue-hero-text">
      <span class="badge">${esc(kind)}</span>
      <h1>${esc(org.name)}</h1>
      ${where ? `<p class="venue-address">${esc(where)}</p>` : ''}
      ${org.website ? `<div class="button-row"><a class="button primary" href="${esc(org.website)}" rel="noopener">Visit website</a></div>` : ''}
    </div>
    ${photos}
  </section>`;

  // The day's other parades, shown with this organization's next (or latest) one: krewes that share a route roll one after another.
  const key = org.upcoming[0] ?? org.past[0];
  const others = orgs.filter((o) => o.slug !== org.slug).flatMap((o) => o.parades.filter((f) => f.properties.date === key.properties.date).map((feature) => ({ org: o, feature })));
  const keyDay = day(key.properties.date);
  const sameDay = others.length
    ? `<section class="wrap schedule same-day">
      <h2>Also on ${esc(keyDay.toFormat(keyDay.year === day(today).year ? 'cccc, LLLL d' : 'cccc, LLLL d, yyyy'))}</h2>
      <ul class="event-list">${scheduleRows(ctx, others)}</ul>
    </section>`
    : '';
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
  ${org.upcoming.length ? sameDay : ''}
  ${past}
  ${org.upcoming.length ? '' : sameDay}
  <section class="wrap venue-foot muted">
    <p>Source: ${sourceLine([...org.upcoming, ...shownPast])}. <a href="${esc(reportUrl)}" rel="noopener">Report a problem with this page</a>.</p>
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

/** The Carnival season a date belongs to: the year of the Mardi Gras on or after it. */
export function carnivalSeason(iso) {
  const year = Number(iso.slice(0, 4));
  return iso <= mardiGras(year) ? year : year + 1;
}

const clean = (text) => text?.trim().replace(/\.$/, '') || null;

/** Where a parade starts and, when the city says, where it ends: "Starts at Jefferson and Magazine, ends at Poydras and Tchoupitoulas". */
function startAndEnd(p) {
  const start = startLine(p);
  const end = clean(p.disband);
  if (!start) return end ? `Ends at ${end}` : '';
  return end ? `${start}, ends at ${end}` : start;
}

/** Where a parade sets off, in a few words: the start street, else the city's formation point. */
function startLine(p) {
  const street = startStreet(p.start_address);
  if (street) return `Starts on ${street}`;
  return p.formation ? `Starts at ${p.formation.replace(/\.$/, '')}` : '';
}

// Hugeicons MaskTheater02Icon (MIT, https://hugeicons.com), the parade mark the map cards use when there's no photo.
const MASK_ICON = '<svg class="thumb-mark" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.44505 14.2749C5.60832 13.9695 5.88358 13.7462 6.22227 13.6851C6.56095 13.624 6.89427 13.7375 7.14978 13.9674M11.2356 17.2768C10.909 17.8876 10.3585 18.3342 9.68113 18.4564C9.00377 18.5786 8.33713 18.3516 7.82611 17.8919M10.5592 13.3523C10.7225 13.0469 10.9978 12.8235 11.3365 12.7624C11.6751 12.7013 12.0085 12.8149 12.264 13.0447M13.0697 7.14205C11.9191 8.2281 10.171 9.09181 8.13072 9.45991C6.09043 9.828 4.15906 9.6281 2.7148 9.01019C2.62237 8.97065 2.52281 8.95715 2.42629 8.97456C2.14172 9.0259 1.95507 9.32308 2.0094 9.63832L2.94728 15.0805C3.64672 19.1391 7.04654 21.0881 8.62355 21.7854C9.14604 22.0165 9.72177 22.046 10.2823 21.9449C10.8429 21.8437 11.374 21.6145 11.7877 21.2146C13.0366 20.0074 15.5798 16.9863 14.8804 12.9276L13.9425 7.48545C13.8882 7.1702 13.6135 6.95627 13.3289 7.00761C13.2324 7.02502 13.1433 7.07255 13.0697 7.14205Z"/><path d="M14.3157 17C14.6792 16.9998 15.039 16.9347 15.3764 16.7854C16.9535 16.0881 20.3533 14.1391 21.0527 10.0805L21.9906 4.63832C22.0449 4.32308 21.8583 4.0259 21.5737 3.97456C21.4772 3.95715 21.3776 3.97065 21.2852 4.01019C19.8409 4.6281 17.9096 4.828 15.8693 4.45991C13.829 4.09181 12.0809 3.2281 10.9303 2.14205C10.8567 2.07255 10.7676 2.02502 10.6711 2.00761C10.3865 1.95627 10.1118 2.1702 10.0575 2.48545L9.1196 7.92763C9.0374 8.40465 8.99998 8.86734 9 9.31444"/></svg>';

/**
 * A schedule row's picture, as the directory cards had: the organization's first photo, else a map of this
 * parade's route (or the area it starts in, or its latest mapped parade), else the bare route shape, else the mask mark.
 */
function thumbnail(ctx, org, feature) {
  const photo = org.photos?.[0];
  if (photo) return `<img src="${photoUrl(ctx, smallPhoto(photo.file))}" alt="" loading="lazy" decoding="async">`;
  const mapped = feature.geometry || feature.properties.start_point ? feature : org.featured;
  if (paradeMapUrl(ctx, mapped, 'dark', 'card')) {
    return ['dark', 'light'].map((theme) => `<img class="only-${theme}" src="${esc(paradeMapUrl(ctx, mapped, theme, 'card'))}" alt="" width="400" height="225" loading="lazy" decoding="async">`).join('');
  }
  return routeSvg(mapped) ?? MASK_ICON;
}

/** Schedule rows in time order: a time, the krewe or club linked to its page, where it starts and a picture. */
function scheduleRows(ctx, items) {
  return items
    .sort((a, b) => (a.feature.properties.start_time ?? '').localeCompare(b.feature.properties.start_time ?? '') || a.org.name.localeCompare(b.org.name))
    .map(({ org, feature }) => {
      const p = feature.properties;
      const start = startLine(p);
      return `<li class="event parade-event">
        <time class="event-time" datetime="${esc(p.start_time ?? p.date)}">${p.start_time ? clock(p.start_time) : ''}</time>
        <span><span class="event-title"><a href="${ctx.url(`/parades/${org.slug}`)}">${esc(org.name)}</a></span>${start ? `<span class="event-meta muted">${esc(start)}</span>` : ''}</span>
        <a class="parade-thumb" href="${ctx.url(`/parades/${org.slug}`)}" tabindex="-1" aria-hidden="true">${thumbnail(ctx, org, feature)}</a>
      </li>`;
    })
    .join('');
}

/** Parades grouped under one heading per day, each row a time and the krewe or club, linked to its page. */
function scheduleDays(ctx, items, today) {
  const days = new Map();
  for (const item of items) {
    const date = item.feature.properties.date;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(item);
  }
  return [...days]
    .map(([date, list]) => {
      const dt = day(date);
      const rows = scheduleRows(ctx, list);
      return `<div class="day">
        <h3 class="day-heading"><span class="day-name">${dt.toFormat('cccc')}</span> <span class="day-date">${dt.toFormat(dt.year === day(today).year ? 'LLLL d' : 'LLLL d, yyyy')}</span></h3>
        <ul class="event-list">${rows}</ul>
      </div>`;
    })
    .join('\n');
}

/**
 * The parades directory, laid out as a schedule: coming second lines and other parades, the coming
 * Mardi Gras season by day (or, until the city lists it each January, the season just past), then
 * every krewe and club by name so each one's page is a click away.
 */
export function paradesPage(ctx, orgs, { today, sources = [] }) {
  const { config, url } = ctx;
  const all = orgs.flatMap((org) => org.parades.map((feature) => ({ org, feature })));
  const isCarnival = ({ feature }) => feature.properties.category === 'mardi_gras';
  const sorted = (items) => items.sort((a, b) => a.feature.properties.date.localeCompare(b.feature.properties.date));
  const upcoming = sorted(all.filter(({ feature }) => feature.properties.date >= today));

  const season = carnivalSeason(today);
  const mardiGrasDay = day(mardiGras(season));
  const carnival = upcoming.filter((i) => isCarnival(i) && carnivalSeason(i.feature.properties.date) === season);
  // Until the city publishes the season's Carnival routes (its Mardi Gras layers, not a single permit),
  // last season shows the order krewes roll in.
  const cityListed = carnival.some(({ feature }) => ['open_data', 'routewise'].includes(feature.properties.field_sources?.schedule));
  const lastSeason = cityListed ? [] : all.filter((i) => isCarnival(i) && i.feature.properties.date < today && carnivalSeason(i.feature.properties.date) === season - 1);
  const others = upcoming.filter((i) => !carnival.includes(i));

  const mardiGrasDate = mardiGrasDay.toFormat('cccc, LLLL d, yyyy');
  const carnivalSection = `<section class="schedule parade-schedule" id="mardi-gras">
    <h2>Mardi Gras ${season} parade schedule</h2>
    <p class="schedule-meta muted">Mardi Gras day is ${esc(mardiGrasDate)}.</p>
    ${scheduleDays(ctx, carnival, today)}
  </section>`;
  const othersSection = `<section class="schedule parade-schedule" id="second-lines">
    <h2>Second lines and other parades</h2>
    ${others.length ? scheduleDays(ctx, others, today) : '<p class="muted">None listed right now.</p>'}
  </section>`;
  // Whichever rolls first comes first: second lines through the fall, Carnival from January.
  const firstDate = (items) => items[0]?.feature.properties.date ?? '9999';
  const sections = firstDate(carnival) < firstDate(others) ? [carnivalSection, othersSection] : [othersSection, carnivalSection];
  const lastSeasonSection = lastSeason.length
    ? `<section class="schedule parade-schedule parade-schedule--past" id="mardi-gras-${season - 1}">
    <h2>Mardi Gras ${season - 1} parade schedule</h2>
    ${scheduleDays(ctx, sorted(lastSeason), today)}
  </section>`
    : '';

  // Every krewe or club not already on the page appears once more, by its latest parade, newest first,
  // so each organization's page has a link from here.
  const shown = new Set([...upcoming, ...lastSeason].map(({ org }) => org.slug));
  const recent = orgs
    .filter((o) => !shown.has(o.slug) && o.past.length)
    .map((org) => ({ org, feature: org.past[0] }))
    .sort((a, b) => b.feature.properties.date.localeCompare(a.feature.properties.date));
  const index = recent.length
    ? `<section class="schedule parade-schedule parade-schedule--past" id="recent">
    <h2>Recent second lines and parades</h2>
    ${scheduleDays(ctx, recent, today)}
  </section>`
    : '';

  const body = `${siteHeader(ctx, { current: 'parades' })}
<main class="wrap parades-page">
  <div class="page-intro">
    <h1>New Orleans parade schedule</h1>
  </div>
  ${sections.join('\n  ')}
  ${lastSeasonSection}
  ${index}
  <section class="parade-attribution muted" id="sources">
    <h2>Where this comes from</h2>
    <p>Routes, and nearly every date and time, come from records the City of New Orleans publishes. When a krewe or club announces a parade on its own website before the city has a record of it, the date and time are shown from that site until the city’s record appears. Routes never come from anywhere but the city.</p>
    <ul>
      ${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>, ${esc(s.publisher)}${s.note ? `. ${esc(s.note)}` : ''}</li>`).join('\n      ')}
    </ul>
    <p>The city offers this data for general information and does not guarantee it. Second lines and walking parades are shown from permit applications, which are requests, not approvals, and only public parades are included. Routes written out in words are drawn along the city’s street map by NOLA.Today; where that could not be done with confidence, no line is shown. Always check with the krewe or club before heading out. The combined data is available as <a href="${url('/parades.geojson')}">GeoJSON</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `New Orleans Parade Schedule – Mardi Gras ${season} Parades & Second Lines – NOLA.Today`,
    description: `Mardi Gras ${season} parade schedule and New Orleans second lines by day, with start times and routes from City of New Orleans records. Mardi Gras day is ${mardiGrasDate}.`,
    canonical: `${config.siteUrl}/parades`,
    bodyClass: 'page-parades',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ItemList',
          name: 'New Orleans parade schedule',
          itemListElement: orgs.map((o, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/parades/${o.slug}`, name: o.name })),
        },
        ...upcoming.slice(0, 50).map(({ org, feature }) => eventSchema(ctx, org, feature)),
      ],
    })}</script>`,
    body,
  });
}
