import { DateTime } from 'luxon';
import { esc, jsonScript, layout, siteHeader, siteFooter } from './layout.js';
import { ZONE } from '../../scripts/lib/time.js';

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

const FORK = `<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6"/><path d="M17 21V3c-2 1-3.5 4-3.5 8 0 1.5.8 2.5 3.5 2.5"/></svg>`;

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

  const card = (v) => {
    const next = v.events.find((e) => (e.end ?? e.start) >= today);
    let nextText = 'No stops posted yet';
    if (next) {
      const dt = DateTime.fromISO(next.start, { zone: ZONE });
      nextText = `${dt.toISODate() === today ? 'Today' : dt.toFormat('ccc, LLL d')} · ${next.place.name}`;
    }
    const links = [
      v.website && `<a href="${esc(v.website)}" rel="noopener">Website</a>`,
      v.from && /instagram\.com/.test(v.from) && `<a href="${esc(v.from)}" rel="noopener">Latest post on Instagram</a>`,
    ].filter(Boolean);
    return `<li class="food-card" id="${esc(v.slug)}" data-name="${esc(`${v.name} ${v.description ?? ''} ${v.events.map((e) => e.place.name).join(' ')}`.toLowerCase())}">
      <div class="card-media food-media">${FORK}</div>
      <div class="card-body">
        <h2>${esc(v.name)}</h2>
        <p class="card-address muted">${esc(v.type ?? 'Pop-up')}</p>
        <p class="card-next${next ? '' : ' muted'}">${esc(nextText)}${next && !next.confirmed ? ` ${expectedTag()}` : ''}</p>
        ${v.description ? `<p class="food-desc muted">${esc(v.description)}</p>` : ''}
        ${links.length ? `<p class="food-links">${links.join(' · ')}</p>` : ''}
      </div>
    </li>`;
  };

  const body = `${siteHeader(ctx, { current: 'food' })}
<main class="wrap venues-page food-page">
  <div class="page-intro">
    <span class="badge">Directory</span>
    <h1>New Orleans food pop-ups</h1>
    <p class="lede">Where ${vendors.length} pop-ups and food trucks are setting up this week, from bar kitchens to crawfish boils. Most move around, so each stop names the bar or lot they’re at.</p>
  </div>
  <section class="schedule food-schedule">
    <h2>Coming up</h2>
    <p class="muted schedule-meta">${expectedTag()} stops follow a vendor’s usual weekly schedule but haven’t been announced yet. Check their Instagram before heading out.</p>
    ${schedule}
  </section>
  <section class="food-vendors">
    <h2>Vendors</h2>
    <ul class="food-grid">
      ${vendors.map(card).join('')}
    </ul>
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
