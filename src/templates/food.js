import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';
import { foodIcon } from './food-icons.js';

const EXPECTED_HINT = 'Not announced yet. Based on the vendor’s usual weekly schedule.';

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

function expectedTag() {
  return `<span class="food-expected" title="${esc(EXPECTED_HINT)}">Expected</span>`;
}

function placeHtml(ctx, place) {
  const name = place.venue ? `<a href="${ctx.url(`/venues/${place.venue}`)}">${esc(place.name)}</a>` : esc(place.name);
  return `${name} <span class="muted">· <a class="food-address" href="${esc(mapsLink(place))}" rel="noopener">${esc(place.address)}</a></span>`;
}

/** /food: a prototype directory of food pop-ups and trucks, with where each one is this week. */
export function foodPage(ctx, vendors, { today }) {
  const { config, url } = ctx;
  const upcoming = vendors
    .flatMap((v) => v.events.filter((e) => (e.end ?? e.start) >= today).map((e) => ({ ...e, vendorName: v.name })))
    .sort((a, b) => a.start.localeCompare(b.start) || a.vendorName.localeCompare(b.vendorName));

  const days = new Map();
  for (const e of upcoming) {
    const dt = DateTime.fromISO(e.start, { zone: ZONE });
    const key = dt.toISODate();
    if (!days.has(key)) days.set(key, { date: dt, events: [] });
    days.get(key).events.push(e);
  }

  const schedule = upcoming.length
    ? [...days.values()]
        .map(
          (day) => `<div class="day">
        <h3 class="day-heading"><span class="day-name">${day.date.toISODate() === today ? 'Today' : day.date.toFormat('cccc')}</span> <span class="day-date">${day.date.toFormat('LLLL d')}</span></h3>
        <ul class="event-list">
          ${day.events
            .map(
              (e) => `<li class="event food-event${e.confirmed ? '' : ' is-expected'}">
            <time class="event-time" datetime="${esc(e.start)}">${timeRange(e)}</time>
            <span>
              <span class="event-title"><a href="#${esc(e.vendor)}">${esc(e.vendorName)}</a>${e.confirmed ? '' : ` ${expectedTag()}`}</span>
              <span class="food-where">${placeHtml(ctx, e.place)}</span>
              ${e.note ? `<span class="food-note muted">${esc(e.note)}</span>` : ''}
            </span>
          </li>`,
            )
            .join('')}
        </ul>
      </div>`,
        )
        .join('')
    : '<div class="notice"><p>No pop-ups are listed right now.</p></div>';

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

  // No vendor pages yet, so a tile leads to the vendor's own site, else the Instagram post the stops came from.
  const card = (v) => {
    const next = nextOf(v);
    const count = v.events.filter((e) => (e.end ?? e.start) >= today).length;
    let nextText = 'No stops posted yet';
    if (next) {
      const dt = DateTime.fromISO(next.start, { zone: ZONE });
      nextText = `${dt.toISODate() === today ? 'Today' : dt.toFormat('ccc, LLL d')}, ${timeRange(next)}: ${next.place.name}`;
    }
    const href = v.website ?? v.from;
    return `<li class="venue-card food-card" id="${esc(v.slug)}" data-name="${esc(`${v.name} ${v.type ?? ''} ${v.events.map((e) => e.place.name).join(' ')}`.toLowerCase())}">
      <a href="${esc(href)}" rel="noopener">
        <div class="card-media food-media">${foodIcon(v.icon, 64)}</div>
        <div class="card-body">
          <h2>${esc(v.name)}</h2>
          <p class="card-address muted">${esc(v.type ?? 'Pop-up')}</p>
          <p class="card-next${next ? '' : ' muted'}">${esc(nextText)}${next && !next.confirmed ? ` ${expectedTag()}` : ''}</p>
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
  <section class="schedule food-schedule">
    <h2>Day by day</h2>
    <p class="muted schedule-meta">${expectedTag()} stops follow a vendor’s usual weekly schedule but haven’t been announced yet. Check their Instagram before heading out.</p>
    ${schedule}
  </section>
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
      itemListElement: vendors.map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${config.siteUrl}/food#${v.slug}`, name: v.name })),
    })}</script>`,
    body,
  });
}
