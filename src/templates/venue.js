import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';

const MAX_LISTED = 120;

export function staticMapUrl(ctx, venue, { theme, width, height, zoom = 14.5, retina = true }) {
  const { mapbox } = ctx.config;
  const style = theme === 'light' ? mapbox.styleLight : mapbox.styleDark;
  const pin = `pin-l-music+${theme === 'light' ? 'e8590c' : 'ffa500'}(${venue.lng},${venue.lat})`;
  // Center the camera slightly south so the pin sits in the upper part of the banner, clear of the title.
  return `https://api.mapbox.com/styles/v1/${style}/static/${pin}/${venue.lng},${(venue.lat - 0.0007).toFixed(6)},${zoom},0/${width}x${height}${retina ? '@2x' : ''}?access_token=${mapbox.token}&attribution=false&logo=false`;
}

function mapsLink(venue) {
  const q = encodeURIComponent(`${venue.name}, ${venue.address}, New Orleans, LA`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Group events by local calendar date. */
function groupByDay(events) {
  const days = new Map();
  for (const e of events) {
    const dt = DateTime.fromISO(e.start, { zone: ZONE });
    const key = dt.toISODate();
    if (!days.has(key)) days.set(key, { date: dt, events: [] });
    days.get(key).events.push({ ...e, dt });
  }
  return [...days.values()];
}

function storyDate(iso) {
  return `<time datetime="${esc(iso)}">${esc(DateTime.fromISO(iso).toFormat('LLLL d, yyyy'))}</time>`;
}

function formatTime(e) {
  if (e.allDay) return 'All day';
  return e.dt.toFormat(e.dt.minute ? 'h:mm a' : 'h a').toLowerCase();
}

export function eventSchema(ctx, venue, e) {
  const schema = {
    '@type': 'MusicEvent',
    name: e.title,
    startDate: e.start,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'MusicVenue',
      name: venue.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: venue.address,
        addressLocality: 'New Orleans',
        addressRegion: 'LA',
        addressCountry: 'US',
      },
    },
  };
  if (e.end) schema.endDate = e.end;
  if (e.url) schema.url = e.url;
  if (venue.image) schema.image = `${ctx.config.siteUrl}/images/venues/${venue.image}`;
  return schema;
}

export function venuePage(ctx, venue, { events, status }) {
  const { config, url, asset } = ctx;
  const canonical = `${config.siteUrl}/venues/${venue.slug}`;
  const month = DateTime.now().setZone(ZONE).toFormat('LLLL yyyy');
  const closed = venue.status === 'closed';
  const title = closed
    ? `${venue.name} (New Orleans) – Closed – NOLA.Today`
    : `${venue.name} (New Orleans) – ${month} Schedule – NOLA.Today`;
  const listed = events.slice(0, MAX_LISTED);
  const upcomingNames = [...new Set(listed.map((e) => e.title))].slice(0, 4);
  const description = closed
    ? `${venue.name} at ${venue.address}, New Orleans has closed. ${venue.note ?? ''} Find live music at other New Orleans venues.`.trim()
    : `Live music schedule for ${venue.name}, ${venue.address}, New Orleans.` +
      (upcomingNames.length ? ` Upcoming: ${upcomingNames.join(', ')}.` : ' See who’s playing tonight and this week.');

  const imageUrl = venue.image ? `/images/venues/${venue.image}` : null;
  const credit = venue.imageCredit;
  const creditHtml = credit
    ? `<figcaption class="photo-credit">Photo by <a href="${esc(credit.source)}" rel="noopener">${esc(credit.author)}</a>, <a href="${esc(credit.licenseUrl)}" rel="license noopener">${esc(credit.license)}</a>${credit.via ? `, via ${esc(credit.via)}` : ''}</figcaption>`
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicVenue',
    '@id': canonical,
    name: venue.name,
    url: canonical,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venue.address,
      addressLocality: 'New Orleans',
      addressRegion: 'LA',
      addressCountry: 'US',
    },
    geo: { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng },
  };
  if (venue.image) jsonLd.image = `${config.siteUrl}${imageUrl}`;
  if (venue.website) jsonLd.sameAs = [venue.website];
  const stories = venue.stories ?? [];
  if (stories.length) {
    jsonLd.subjectOf = stories.map((story) => {
      const article = {
        '@type': 'NewsArticle',
        headline: story.title,
        datePublished: story.date,
        url: `${canonical}#${story.slug}`,
        publisher: { '@type': 'Organization', name: config.siteName, url: config.siteUrl },
      };
      if (story.summary) article.description = story.summary;
      if (story.updated) article.dateModified = story.updated;
      if (story.author) article.author = { '@type': 'Person', name: story.author };
      if (story.image) article.image = `${config.siteUrl}/images/stories/${story.image}`;
      return article;
    });
  }
  if (!closed && listed.length) jsonLd.event = listed.slice(0, 50).map((e) => eventSchema(ctx, venue, e));

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Venues', item: `${config.siteUrl}/venues` },
      { '@type': 'ListItem', position: 2, name: venue.name, item: canonical },
    ],
  };

  const banner = !config.mapbox.token ? '<div class="map-banner map-banner--empty" aria-hidden="true"></div>' : `<div class="map-banner" aria-hidden="true">
    <img class="only-dark" src="${staticMapUrl(ctx, venue, { theme: 'dark', width: 1280, height: 360 })}" alt="" width="1280" height="360" loading="eager" decoding="async">
    <img class="only-light" src="${staticMapUrl(ctx, venue, { theme: 'light', width: 1280, height: 360 })}" alt="" width="1280" height="360" loading="lazy" decoding="async">
  </div>`;

  const hero = `<section class="venue-hero wrap">
    <div class="venue-hero-text">
      <span class="badge">${closed ? 'Closed' : 'Venue'}</span>
      <h1>${esc(venue.name)}</h1>
      <p class="venue-address">${esc(venue.address)}, New Orleans</p>
      ${venue.note ? `<p class="venue-note">${esc(venue.note)}</p>` : ''}
      <p class="live-now" data-live-now hidden><span class="live-dot"></span> Live now: <strong data-live-title></strong></p>
      <div class="button-row">
        ${venue.website && !closed ? `<a class="button primary" href="${esc(venue.website)}" rel="noopener">Visit website</a>` : ''}
        <a class="button" href="${esc(mapsLink(venue))}" rel="noopener">Directions</a>
      </div>
    </div>
    ${
      imageUrl
        ? `<figure class="venue-photo"><img src="${asset(imageUrl.replace(/\.jpg$/, '-600.jpg'))}" srcset="${asset(imageUrl.replace(/\.jpg$/, '-600.jpg'))} 600w, ${asset(imageUrl)} 1200w" sizes="(min-width: 900px) 520px, 100vw" alt="${esc(venue.name)}, New Orleans" loading="eager">${creditHtml}</figure>`
        : ''
    }
  </section>`;

  let schedule;
  if (closed) {
    schedule = `<section class="wrap schedule">
      <div class="notice">
        <h2>This venue has closed</h2>
        <p>${esc(venue.note ?? `${venue.name} is no longer operating.`)} Looking for music tonight? Check the <a href="${url('/')}">map</a> or browse <a href="${url('/venues')}">all venues</a>.</p>
      </div>
    </section>`;
  } else if (!listed.length) {
    schedule = `<section class="wrap schedule">
      <h2>Upcoming shows</h2>
      <div class="notice">
        <p>No upcoming shows are listed for ${esc(venue.name)} right now.${venue.website ? ` Check <a href="${esc(venue.website)}" rel="noopener">their website</a> for the latest.` : ''}</p>
      </div>
    </section>`;
  } else {
    const days = groupByDay(listed);
    schedule = `<section class="wrap schedule">
      <h2>Upcoming shows</h2>
      ${status?.lastSuccess ? `<p class="muted schedule-meta">Updated <time datetime="${esc(status.lastSuccess)}" data-relative>${esc(DateTime.fromISO(status.lastSuccess).setZone(ZONE).toFormat('LLL d, h:mm a'))}</time>.</p>` : ''}
      ${days
        .map(
          (day) => `<div class="day" data-day="${day.date.toISODate()}">
        <h3 class="day-heading"><span class="day-name">${day.date.toFormat('cccc')}</span> <span class="day-date">${day.date.toFormat('LLLL d')}</span></h3>
        <ul class="event-list">
          ${day.events
            .map(
              (e) => `<li class="event" data-start="${esc(e.start)}"${e.end ? ` data-end="${esc(e.end)}"` : ''}${e.allDay ? ' data-all-day' : ''}>
            <time class="event-time" datetime="${esc(e.start)}">${formatTime(e)}</time>
            <span class="event-title">${e.url ? `<a href="${esc(e.url)}" rel="noopener nofollow">${esc(e.title)}</a>` : esc(e.title)}</span>
          </li>`,
            )
            .join('')}
        </ul>
      </div>`,
        )
        .join('')}
    </section>`;
  }

  const storySections = stories
    .map(
      (story) => `<article class="wrap venue-story" id="${esc(story.slug)}">
    <h2>${esc(story.title)}</h2>
    ${story.summary ? `<p class="story-summary">${esc(story.summary)}</p>` : ''}
    <p class="muted">${story.author ? `By ${esc(story.author)} · ` : ''}${storyDate(story.date)}${story.updated ? ` (Updated ${storyDate(story.updated)})` : ''}</p>
    ${story.image ? `<figure class="story-photo"><img src="${asset(`/images/stories/${story.image}`)}" alt="${esc(story.title)}" loading="lazy" decoding="async"></figure>` : ''}
    ${story.body.map((p) => `<p>${esc(p)}</p>`).join('\n    ')}
  </article>`,
    )
    .join('\n  ');

  const sourceLinks = (venue.sources ?? []).map((s) => s.url).filter(Boolean);
  const reportUrl = `https://github.com/${config.repo}/issues/new?labels=data&title=${encodeURIComponent(`Venue data: ${venue.name}`)}&body=${encodeURIComponent(`Page: ${canonical}\n\nWhat's wrong?\n`)}`;

  const body = `${siteHeader(ctx, { current: 'venues' })}
<main class="venue-page">
  ${banner}
  ${hero}
  ${schedule}
  ${storySections}
  <section class="wrap venue-foot muted">
    <p>${sourceLinks.length ? `Schedule source: ${sourceLinks.map((u) => `<a href="${esc(u)}" rel="noopener nofollow">${esc(new URL(u).hostname.replace(/^www\./, ''))}</a>`).join(', ')}. ` : ''}<a href="${esc(reportUrl)}" rel="noopener">Report a problem with this page</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title,
    description,
    canonical,
    image: imageUrl ?? (config.mapbox.token ? staticMapUrl(ctx, venue, { theme: 'dark', width: 1200, height: 630, retina: false, zoom: 14 }) : null),
    bodyClass: 'page-venue',
    head: `<script type="application/ld+json">${jsonScript(jsonLd)}</script>\n<script type="application/ld+json">${jsonScript(breadcrumbs)}</script>`,
    body,
  });
}
