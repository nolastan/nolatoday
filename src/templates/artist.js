import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { LINKS, TIPS } from '../../scripts/lib/artists.js';
import { eventSchema } from './venue.js';
import { GENRES, broadGenres, specificGenres, shownGenres, genreLabel } from '../../scripts/lib/genres.js';

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

/** The artist's tip jars as shown: [{ service, label, text, url? }]. `text` is the account name if given, else the handle. */
export function artistTips(artist) {
  return (artist.tips ?? []).map((t) => ({ service: t.service, label: TIPS[t.service].label, text: t.name ?? t.handle, url: t.url }));
}

/** An article about the artist (data/articles/), in full: headline, dek, byline, then the text. */
export function articleHtml(article) {
  const date = DateTime.fromISO(article.date, { zone: ZONE });
  return `<article class="wrap artist-article">
    <h2>${esc(article.title)}</h2>
    ${article.dek ? `<p class="lede">${esc(article.dek)}</p>` : ''}
    <p class="article-byline muted">By ${esc(article.author)} · <time datetime="${esc(article.date)}">${date.toFormat('LLLL d, yyyy')}</time></p>
    ${article.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n    ')}
  </article>`;
}

const clock = (e, dt) => (e.allDay ? 'All day' : dt.toFormat(dt.minute ? 'h:mm a' : 'h a').toLowerCase());

/** /artists/<slug>: who they are, where to hear them, and every upcoming show. `shows` is [{ event, venue }], soonest first. */
export function artistPage(ctx, artist, { shows, meta, articles = [] }) {
  const { config, url } = ctx;
  const canonical = `${config.siteUrl}/artists/${artist.slug}`;
  const listed = shows.slice(0, MAX_LISTED);
  const links = artistLinks(artist);
  // Only tip jars with a link make a button; a bare handle or email stays in the data.
  const tips = artistTips(artist).filter((t) => t.url);
  const venueNames = [...new Set(listed.map((s) => s.venue.name))];
  const genres = specificGenres(meta);
  const broad = shownGenres(broadGenres(artist, genres));
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
  if (meta?.image) jsonLd.image = meta.image;
  if (genres.length) jsonLd.genre = genres;
  if (listed.length) {
    jsonLd.event = listed.slice(0, 50).map(({ event, venue }) => ({ ...eventSchema(ctx, venue, event), performer: { '@id': canonical } }));
  }
  const articleLd = articles.map((a) => ({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    ...(a.dek ? { description: a.dek } : {}),
    author: { '@type': 'Person', name: a.author },
    datePublished: a.date,
    publisher: { '@type': 'Organization', name: config.siteName, url: config.siteUrl },
    mainEntityOfPage: canonical,
    about: { '@id': canonical },
  }));
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Artists', item: `${config.siteUrl}/artists` },
      { '@type': 'ListItem', position: 2, name: artist.name, item: canonical },
    ],
  };

  const hero = `<section class="artist-hero wrap${meta?.image ? ' has-photo' : ''}">
    ${meta?.image ? `<img class="artist-photo" src="${esc(meta.image)}" alt="${esc(artist.name)}" width="200" height="200" decoding="async" referrerpolicy="no-referrer">` : ''}
    <div class="artist-hero-text">
    <span class="badge">Artist</span>
    <h1>${esc(artist.name)}</h1>
    ${
      broad.length
        ? `<p class="artist-genres">${broad.map((g) => `<a href="${url(`/artists?genre=${g}`)}">${esc(genreLabel(g))}</a>`).join(' · ')}</p>`
        : ''
    }
    ${artist.note ? `<p class="venue-note">${esc(artist.note)}</p>` : ''}
    ${
      links.length
        ? `<div class="button-row">${links
            .map((l) => `<a class="button provider provider-${esc(l.key)}" href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`)
            .join('')}</div>`
        : ''
    }
    ${
      tips.length
        ? `<div class="button-row artist-tips"><span class="artist-tips-label">Tip</span>${tips
            .map((t) => `<a class="button provider provider-${esc(t.service)}" href="${esc(t.url)}" title="${esc(`${t.label}: ${t.text}`)}" rel="noopener">${esc(t.label)}</a>`)
            .join('')}</div>`
        : ''
    }
    </div>
  </section>`;

  let schedule;
  if (!listed.length) {
    schedule = `<section class="wrap schedule">
      <h2>Upcoming shows in New Orleans</h2>
      <div class="notice"><p>No upcoming shows are listed for ${esc(artist.name)} right now. See who’s playing tonight on the <a href="${url('/')}">map</a>.</p></div>
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
      <h2>Upcoming shows in New Orleans</h2>
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
    <iframe class="spotify-player" title="${esc(artist.name)} on Spotify" src="https://open.spotify.com/embed/artist/${esc(artist.spotify)}" width="100%" height="352" frameborder="0" loading="lazy" allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"></iframe>
  </aside>`
    : '';

  const reportUrl = `https://github.com/${config.repo}/issues/new?labels=data&title=${encodeURIComponent(`Artist data: ${artist.name}`)}&body=${encodeURIComponent(`Page: ${canonical}\n\nWhat's wrong?\n`)}`;
  const body = `${siteHeader(ctx, { current: 'artists' })}
<main class="artist-page">
  ${hero}
  <div class="wrap artist-columns${player ? ' has-player' : ''}">
    ${schedule}
    ${player}
  </div>
  ${articles.map(articleHtml).join('\n  ')}
  <section class="wrap venue-foot muted">
    <p><a href="${esc(reportUrl)}" rel="noopener">Report a problem with this page</a>.</p>
  </section>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `${artist.name} – New Orleans Shows – NOLA.Today`,
    description,
    canonical,
    image: meta?.image,
    bodyClass: 'page-artist',
    head: `<script type="application/ld+json">${jsonScript(jsonLd)}</script>\n<script type="application/ld+json">${jsonScript(breadcrumbs)}</script>${articleLd
      .map((ld) => `\n<script type="application/ld+json">${jsonScript(ld)}</script>`)
      .join('')}`,
    body,
  });
}

/** /artists: artists with shows coming up (soonest first), then everyone else A to Z. */
export function artistsPage(ctx, artists, { showsBySlug, meta = {} }) {
  const { config, url } = ctx;
  const now = DateTime.now().setZone(ZONE);
  const today = now.toISODate();
  const nextOf = (a) => showsBySlug.get(a.slug)?.[0];
  const playing = artists.filter(nextOf).sort((a, b) => nextOf(a).event.start.localeCompare(nextOf(b).event.start) || a.name.localeCompare(b.name));
  const quiet = artists.filter((a) => !nextOf(a));
  const broad = new Map(playing.map((a) => [a.slug, broadGenres(a, specificGenres(meta[a.slug]))]));
  // Only genres someone with a show coming up plays.
  const filters = GENRES.filter((g) => playing.some((a) => broad.get(a.slug).includes(g.slug)));

  const row = (a) => {
    const { event, venue } = nextOf(a);
    const dt = DateTime.fromISO(event.start, { zone: ZONE });
    const when = dt.toISODate() === today ? 'Today' : dt.toFormat('ccc, LLL d');
    const count = showsBySlug.get(a.slug).length;
    const genres = broad.get(a.slug);
    const shown = shownGenres(genres);
    const search = [a.name, venue.name, ...specificGenres(meta[a.slug]), ...genres.map(genreLabel)].join(' ').toLowerCase();
    return `<li class="artist-row" data-name="${esc(search)}" data-genres="${esc(genres.join(' '))}">
      <a href="${url(`/artists/${a.slug}`)}">
        ${
          meta[a.slug]?.image
            ? `<img class="artist-row-photo" src="${esc(meta[a.slug].imageSmall ?? meta[a.slug].image)}" alt="" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
            : `<span class="artist-row-photo artist-row-placeholder" aria-hidden="true">♪</span>`
        }
        <span class="artist-row-text">
          <span class="artist-row-name">${esc(a.name)}</span>
          ${shown.length ? `<span class="artist-row-genres muted">${esc(shown.map(genreLabel).join(' · '))}</span>` : ''}
          <span class="artist-row-next muted">${esc(when)} at ${esc(venue.name)}${count > 1 ? ` · ${count} upcoming` : ''}</span>
        </span>
      </a>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'artists' })}
<main class="wrap artists-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans artists</h1>
    <p class="lede">${playing.length} bands and musicians with shows coming up at New Orleans venues. Tap a name for every date and where to listen.</p>
    <label class="search"><span class="visually-hidden">Filter artists</span><input type="search" placeholder="Filter by artist, venue or genre" data-venue-filter autocomplete="off"></label>
    ${
      filters.length
        ? `<div class="genre-filter" role="group" aria-label="Genre">
      <button type="button" aria-pressed="true" data-genre="">All</button>
      ${filters.map((g) => `<button type="button" aria-pressed="false" data-genre="${g.slug}">${esc(g.label)}</button>`).join('')}
    </div>`
        : ''
    }
  </div>
  <ul class="artist-list" data-venue-grid>
    ${playing.map(row).join('')}
  </ul>
  <p class="muted" data-venue-empty hidden>No artists match.</p>
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
    bodyClass: 'page-venues page-artists',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: playing.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/artists/${a.slug}`, name: a.name })),
    })}</script>`,
    body,
  });
}
