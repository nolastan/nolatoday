import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { foodIcon } from './food-icons.js';


const clock = (dt) => dt.toFormat(dt.minute ? 'h:mm a' : 'h a').toLowerCase();

function timeRange(e) {
  if (e.allDay) return 'All day';
  const start = DateTime.fromISO(e.start, { zone: ZONE });
  if (!e.end) return clock(start);
  const end = DateTime.fromISO(e.end, { zone: ZONE });
  // "11 am–5 pm", or "5–11 pm" when both are on the same side of noon.
  const same = start.toFormat('a') === end.toFormat('a');
  return `${same ? clock(start).replace(/ [ap]m$/, '') : clock(start)}–${clock(end)}`;
}

function mapsLink(place) {
  const q = encodeURIComponent(`${place.name}, ${place.address}${/,/.test(place.address) ? '' : ', New Orleans'}, LA`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** For a stop the vendor hasn't confirmed in the last 30 days. */
function staleNote(e) {
  const since = e.confirmedOn ? ` since ${DateTime.fromISO(e.confirmedOn).toFormat('LLL d')}` : ' recently';
  return `<span class="food-stale">Not confirmed${since}. Check with them before heading out.</span>`;
}

function placeHtml(ctx, place) {
  const name = place.venue ? `<a href="${ctx.url(`/venues/${place.venue}`)}">${esc(place.name)}</a>` : esc(place.name);
  return `${name}<span class="food-where muted"><a class="food-address" href="${esc(mapsLink(place))}" rel="noopener">${esc(place.address)}</a></span>`;
}

/** /food: a prototype directory of food pop-ups and trucks, one tile each with its next stop. */
export function foodPage(ctx, vendors, { today }) {
  const { config, url } = ctx;
  // Like the venue directory: vendors with a stop coming up first (soonest first), then the rest.
  const nextOf = (v) => v.events.find((e) => (e.end ?? e.start) >= today);
  const sorted = [...vendors].sort((a, b) => {
    const na = nextOf(a)?.start;
    const nb = nextOf(b)?.start;
    if (na && nb) return na.localeCompare(nb) || a.name.localeCompare(b.name);
    if (na) return -1;
    if (nb) return 1;
    return a.name.localeCompare(b.name);
  });

  const card = (v) => {
    const next = nextOf(v);
    const count = v.events.filter((e) => (e.end ?? e.start) >= today).length;
    let nextText = 'No stops posted yet';
    if (next) {
      const dt = DateTime.fromISO(next.start, { zone: ZONE });
      nextText = `${dt.toISODate() === today ? 'Today' : dt.toFormat('ccc, LLL d')}, ${timeRange(next)}: ${next.place.name}`;
    }
    return `<li class="venue-card food-card" id="${esc(v.slug)}" data-name="${esc(`${v.name} ${v.type ?? ''} ${v.events.map((e) => e.place.name).join(' ')}`.toLowerCase())}">
      <a href="${url(`/food/${v.slug}`)}">
        <div class="card-media food-media">${foodIcon(v.icon, 64)}</div>
        <div class="card-body">
          <h2>${esc(v.name)}</h2>
          <p class="card-address muted">${esc(v.type ?? 'Pop-up')}</p>
          <p class="card-next${next ? '' : ' muted'}">${esc(nextText)}</p>
          ${next?.stale ? `<p class="food-stale">Not confirmed recently</p>` : ''}
          ${count > 1 ? `<p class="card-count muted">${count} upcoming</p>` : ''}
        </div>
      </a>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'food' })}
<main class="wrap venues-page food-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans food pop-ups</h1>
    <p class="lede">${vendors.length} pop-ups and food trucks, from bar kitchens to crawfish boils. Most move around, so each stop names the bar or lot they’re at.</p>
    <label class="search"><span class="visually-hidden">Filter vendors</span><input type="search" placeholder="Filter by name or bar" data-venue-filter autocomplete="off"></label>
  </div>
  <ul class="venue-grid" data-venue-grid>
    ${sorted.map(card).join('')}
  </ul>
  <p class="muted" data-venue-empty hidden>No vendors match that search.</p>
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: 'New Orleans Food Pop-ups & Trucks This Week – NOLA.Today',
    description: `Where ${vendors.length} New Orleans food pop-ups and trucks are this week, with times and the bars they’re at.`,
    canonical: `${config.siteUrl}/food`,
    bodyClass: 'page-venues page-food',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: vendors.map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/food/${v.slug}`, name: v.name })),
    })}</script>`,
    body,
  });
}

/** /food/<slug>: one vendor, where it is and when, like an artist page. */
export function foodVendorPage(ctx, vendor, { today }) {
  const { config, url } = ctx;
  const canonical = `${config.siteUrl}/food/${vendor.slug}`;
  const upcoming = vendor.events.filter((e) => (e.end ?? e.start) >= today);
  const places = [...new Set(upcoming.map((e) => e.place.name))];
  const description = upcoming.length
    ? `Where to find ${vendor.name} in New Orleans: ${upcoming.length} upcoming ${upcoming.length === 1 ? 'stop' : 'stops'} at ${places.slice(0, 3).join(', ')}${places.length > 3 ? ' and more' : ''}.`
    : `${vendor.name}, a New Orleans ${(vendor.type ?? 'pop-up').toLowerCase()}: upcoming stops when they’re announced.`;

  const links = [
    vendor.website && { key: 'website', label: 'Website', url: vendor.website },
    vendor.from && /instagram\.com/.test(vendor.from) && { key: 'instagram', label: 'Instagram', url: vendor.from },
  ].filter(Boolean);

  const hero = `<section class="artist-hero wrap has-photo">
    <span class="artist-photo food-photo">${foodIcon(vendor.icon, 96)}</span>
    <div class="artist-hero-text">
    <span class="badge">${esc(vendor.type ?? 'Pop-up')}</span>
    <h1>${esc(vendor.name)}</h1>
    ${vendor.description ? `<p class="venue-note">${esc(vendor.description)}</p>` : ''}
    ${links.length ? `<div class="button-row">${links.map((l) => `<a class="button provider provider-${l.key}" href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : ''}
    </div>
  </section>`;

  const days = new Map();
  for (const e of upcoming) {
    const dt = DateTime.fromISO(e.start, { zone: ZONE });
    const key = dt.toISODate();
    if (!days.has(key)) days.set(key, { date: dt, events: [] });
    days.get(key).events.push(e);
  }
  const schedule = upcoming.length
    ? `<section class="wrap schedule">
      <h2>Upcoming stops</h2>
      ${[...days.values()]
        .map(
          (day) => `<div class="day">
        <h3 class="day-heading"><span class="day-name">${day.date.toISODate() === today ? 'Today' : day.date.toFormat('cccc')}</span> <span class="day-date">${day.date.toFormat('LLLL d')}</span></h3>
        <ul class="event-list">
          ${day.events
            .map(
              (e) => `<li class="event food-event">
            <time class="event-time" datetime="${esc(e.start)}">${timeRange(e)}</time>
            <span>
              <span class="event-title">${placeHtml(ctx, e.place)}</span>
              ${e.stale ? staleNote(e) : ''}
              ${e.note ? `<span class="food-note muted">${esc(e.note)}</span>` : ''}
            </span>
          </li>`,
            )
            .join('')}
        </ul>
      </div>`,
        )
        .join('')}
    </section>`
    : `<section class="wrap schedule">
      <h2>Upcoming stops</h2>
      <div class="notice"><p>No stops are posted for ${esc(vendor.name)} right now.${vendor.from ? ` Check <a href="${esc(vendor.from)}" rel="noopener">their latest post</a> for this week’s schedule.` : ''}</p></div>
    </section>`;

  const body = `${siteHeader(ctx, { current: 'food' })}
<main class="artist-page food-vendor-page">
  ${hero}
  ${schedule}
</main>
${siteFooter(ctx)}`;

  return layout(ctx, {
    title: `${vendor.name} – Food ${vendor.type === 'Food truck' ? 'Truck' : 'Pop-up'} Schedule – NOLA.Today`,
    description,
    canonical,
    bodyClass: 'page-artist page-food-vendor',
    head: `<script type="application/ld+json">${jsonScript({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Food', item: `${config.siteUrl}/food` },
        { '@type': 'ListItem', position: 2, name: vendor.name, item: canonical },
      ],
    })}</script>`,
    body,
  });
}
