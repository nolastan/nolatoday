import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { LINKS } from '../../scripts/lib/artists.js';
import { eventSchema } from './venue.js';

const MAX_LISTED = 60;

/**
 * An event title with the artists named in it linked to their pages. `matches` is what the artist
 * matcher returned for this title: [{ slug, start, end }].
 */
export function titleHtml(ctx, title, matches = []) {
  let html = '';
  let at = 0;
  for (const m of matches) {
    html += esc(title.slice(at, m.start));
    html += `<a class="artist-link" href="${ctx.url(`/artists/${m.slug}`)}">${esc(title.slice(m.start, m.end))}</a>`;
    at = m.end;
  }
  return html + esc(title.slice(at));
}

/** Every place to hear or follow an artist, Spotify first: [{ key, label, url }]. */
export function artistLinks(artist) {
  const links = [];
  if (artist.spotify) links.push({ key: 'spotify', label: 'Spotify', url: `https://open.spotify.com/artist/${artist.spotify}` });
  for (const [key, label] of Object.entries(LINKS)) {
    if (artist.links?.[key]) links.push({ key, label, url: artist.links[key] });
  }
  return links;
}

const clock = (e, dt) => (e.allDay ? 'All day' : dt.toFormat(dt.minute ? 'h:mm a' : 'h a').toLowerCase());

/** /artists/<slug>: who they are, where to hear them, and every upcoming show. `shows` is [{ event, venue }], soonest first. */
export function artistPage(ctx, artist, { shows }) {
  const { config, url } = ctx;
  const canonical = `${config.siteUrl}/artists/${artist.slug}`;
  const listed = shows.slice(0, MAX_LISTED);
  const links = artistLinks(artist);
  const venueNames = [...new Set(listed.map((s) => s.venue.name))];
  const next = listed[0];
  const description = next
    ? `${artist.name} live in New Orleans: ${listed.length} upcoming ${listed.length === 1 ? 'show' : 'shows'} at ${venueNames.slice(0, 3).join(', ')}${venueNames.length > 3 ? ' and more' : ''}.`
    : `${artist.name} in New Orleans: where to listen, and upcoming shows when they’re announced.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    '@id': canonical,
    name: artist.name,
    url: canonical,
  };
  if (links.length) jsonLd.sameAs = links.map((l) => l.url);
  if (listed.length) {
    jsonLd.event = listed.slice(0, 50).map(({ event, venue }) => ({ ...eventSchema(ctx, venue, event), performer: { '@id': canonical } }));
  }
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Artists', item: `${config.siteUrl}/artists` },
      { '@type': 'ListItem', position: 2, name: artist.name, item: canonical },
    ],
  };

  const hero = `<section class="artist-hero wrap">
    <span class="badge">Artist</span>
    <h1>${esc(artist.name)}</h1>
    ${artist.note ? `<p class="venue-note">${esc(artist.note)}</p>` : ''}
    ${
      links.length
        ? `<div class="button-row">${links
            .map((l) => `<a class="button provider provider-${esc(l.key)}" href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`)
            .join('')}</div>`
        : ''
    }
  </section>`;

  let schedule;
  if (!listed.length) {
    schedule = `<section class="wrap schedule">
      <h2>Upcoming shows</h2>
      <div class="notice"><p>No upcoming New Orleans shows are listed for ${esc(artist.name)} right now. See who’s playing tonight on the <a href="${url('/')}">map</a>.</p></div>
    </section>`;
  } else {
    const days = new Map();
    for (const s of listed) {
      const dt = DateTime.fromISO(s.event.start, { zone: ZONE });
      const key = dt.toISODate();
      if (!days.has(key)) days.set(key, { date: dt, shows: [] });
      days.get(key).shows.push({ ...s, dt });
    }
    schedule = `<section class="wrap schedule">
      <h2>Upcoming shows</h2>
      ${[...days.values()]
        .map(
          (day) => `<div class="day" data-day="${day.date.toISODate()}">
        <h3 class="day-heading"><span class="day-name">${day.date.toFormat('cccc')}</span> <span class="day-date">${day.date.toFormat('LLLL d')}</span></h3>
        <ul class="event-list">
          ${day.shows
            .map(
              ({ event: e, venue, dt }) => `<li class="event" data-start="${esc(e.start)}"${e.end ? ` data-end="${esc(e.end)}"` : ''}${e.allDay ? ' data-all-day' : ''}>
            <time class="event-time" datetime="${esc(e.start)}">${clock(e, dt)}</time>
            <span class="event-title"><a href="${url(`/venues/${venue.slug}`)}">${esc(venue.name)}</a>${e.title && e.title !== artist.name ? `<span class="event-billing muted">${esc(e.title)}</span>` : ''}</span>
          </li>`,
            )
            .join('')}
        </ul>
      </div>`,
        )
        .join('')}
    </section>`;
  }

  const player = artist.spotify
    ? `<aside class="artist-listen">
    <h2>Listen</h2>
    <iframe class="spotify-player" title="${esc(artist.name)} on Spotify" src="https://open.spotify.com/embed/artist/${esc(artist.spotify)}" width="100%" height="352" frameborder="0" loading="lazy" allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"></iframe>
  </aside>`
    : '';

  const reportUrl = `https://github.com/${config.repo}/issues/new?labels=data&title=${encodeURIComponent(`Artist data: ${artist.name}`)}&body=${encodeURIComponent(`Page: ${canonical}\n\nWhat's wrong?\n`)}`;
  const body = `${siteHeader(ctx, { current: 'artists' })}
<main class="artist-page">
  <div class="wrap artist-columns${player ? ' has-player' : ''}">
    <div class="artist-main">
      ${hero}
      ${schedule}
    </div>
    ${player}
  </div>
  <section class="wrap venue-foot muted">
    <p><a href="${esc(reportUrl)}" rel="noopener">Report a problem with this page</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `${artist.name} – New Orleans Shows – NOLA.Today`,
    description,
    canonical,
    bodyClass: 'page-artist',
    head: `<script type="application/ld+json">${jsonScript(jsonLd)}</script>\n<script type="application/ld+json">${jsonScript(breadcrumbs)}</script>`,
    body,
  });
}

/** /artists: artists with shows coming up (soonest first), then everyone else A to Z. */
export function artistsPage(ctx, artists, { showsBySlug }) {
  const { config, url } = ctx;
  const now = DateTime.now().setZone(ZONE);
  const today = now.toISODate();
  const nextOf = (a) => showsBySlug.get(a.slug)?.[0];
  const playing = artists.filter(nextOf).sort((a, b) => nextOf(a).event.start.localeCompare(nextOf(b).event.start) || a.name.localeCompare(b.name));
  const quiet = artists.filter((a) => !nextOf(a));

  const row = (a) => {
    const { event, venue } = nextOf(a);
    const dt = DateTime.fromISO(event.start, { zone: ZONE });
    const when = dt.toISODate() === today ? 'Today' : dt.toFormat('ccc, LLL d');
    const count = showsBySlug.get(a.slug).length;
    return `<li class="artist-row" data-name="${esc(a.name.toLowerCase())} ${esc(venue.name.toLowerCase())}">
      <a href="${url(`/artists/${a.slug}`)}">
        <span class="artist-row-name">${esc(a.name)}</span>
        <span class="artist-row-next muted">${esc(when)} at ${esc(venue.name)}${count > 1 ? ` · ${count} upcoming` : ''}</span>
      </a>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'artists' })}
<main class="wrap artists-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans artists</h1>
    <p class="lede">${playing.length} bands and musicians with shows coming up at New Orleans venues. Tap a name for every date and where to listen.</p>
    <label class="search"><span class="visually-hidden">Filter artists</span><input type="search" placeholder="Filter by artist or venue" data-venue-filter autocomplete="off"></label>
  </div>
  <ul class="artist-list" data-venue-grid>
    ${playing.map(row).join('')}
  </ul>
  <p class="muted" data-venue-empty hidden>No artists match that search.</p>
  ${
    quiet.length
      ? `<section class="closed-venues">
    <h2>No shows listed right now</h2>
    <ul class="closed-list">${quiet.map((a) => `<li><a href="${url(`/artists/${a.slug}`)}">${esc(a.name)}</a></li>`).join('')}</ul>
  </section>`
      : ''
  }
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `New Orleans Bands & Musicians – ${now.toFormat('LLLL yyyy')} Shows – NOLA.Today`,
    description: `${playing.length} New Orleans bands and musicians with upcoming shows, with dates, venues and links to listen.`,
    canonical: `${config.siteUrl}/artists`,
    bodyClass: 'page-artists',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: playing.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/artists/${a.slug}`, name: a.name })),
    })}</script>`,
    body,
  });
}
