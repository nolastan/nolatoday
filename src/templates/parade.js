import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { SOURCES, encodePolyline, linesOf, simplify } from '../../scripts/lib/parades.js';

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

/** A Mapbox static image of a route, framed to fit it. Null without a token or a line. */
export function routeMapUrl(ctx, feature, { theme, width, height, retina = true }) {
  const { mapbox } = ctx.config;
  if (!mapbox.token || !feature?.geometry) return null;
  const style = theme === 'light' ? mapbox.styleLight : mapbox.styleDark;
  const color = theme === 'light' ? 'e8590c' : 'ffa500';
  // The address has to stay well under the API's 8,192 characters, so long routes are drawn more coarsely.
  let overlays = '';
  for (const tolerance of [0.00003, 0.00008, 0.0002, 0.0005, 0.001]) {
    overlays = linesOf(simplify(feature.geometry, tolerance))
      .map((line) => `path-5+${color}-0.9(${encodeURIComponent(encodePolyline(line))})`)
      .join(',');
    if (overlays.length < 6000) break;
  }
  if (overlays.length >= 6000) return null;
  return `https://api.mapbox.com/styles/v1/${style}/static/${overlays}/auto/${width}x${height}${retina ? '@2x' : ''}?padding=50&access_token=${mapbox.token}&attribution=false&logo=false`;
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
      name: p.start_address ?? p.formation ?? p.area ?? 'New Orleans',
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
    ? `${org.name} ${kind.toLowerCase()} in New Orleans: ${when}${next.properties.start_address ? `, starting at ${next.properties.start_address}` : ''}. Route map and details from City of New Orleans records.`
    : `${org.name} ${kind.toLowerCase()} in New Orleans. Last listed ${longDate(fp.date, today)}. Route map and details from City of New Orleans records.`;

  const banner = (theme, loading) => {
    const src = routeMapUrl(ctx, featured, { theme, width: 1280, height: 420 });
    return src ? `<img class="only-${theme}" src="${esc(src)}" alt="" width="1280" height="420" loading="${loading}" decoding="async">` : '';
  };
  const hasBanner = Boolean(routeMapUrl(ctx, featured, { theme: 'dark', width: 1280, height: 420 }));
  const bannerHtml = hasBanner
    ? `<div class="map-banner map-banner--route" role="img" aria-label="Map of the ${esc(org.name)} route">${banner('dark', 'eager')}${banner('light', 'lazy')}</div>`
    : '<div class="map-banner map-banner--empty" aria-hidden="true"></div>';

  const hero = `<section class="venue-hero parade-hero wrap">
    <div class="venue-hero-text">
      <span class="badge">${esc(kind)}</span>
      <h1>${esc(org.name)}</h1>
    </div>
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
    image: routeMapUrl(ctx, featured, { theme: 'dark', width: 1200, height: 630, retina: false }),
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
    const media = routeSvg(f) ?? `<span class="card-placeholder" aria-hidden="true">♪</span>`;
    return `<li class="venue-card parade-card" data-name="${esc(`${org.name} ${p.name} ${p.start_address ?? p.area ?? ''}`.toLowerCase())}">
      <a href="${url(`/parades/${org.slug}`)}">
        <div class="card-media">${media}</div>
        <div class="card-body">
          <h2>${esc(org.name)}</h2>
          <p class="card-address muted">${esc(KIND[org.category] ?? KIND.other)}${p.start_address || p.area ? ` · ${esc(p.start_address ?? p.area)}` : ''}</p>
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
