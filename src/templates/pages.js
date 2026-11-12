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

/** /privacy: the privacy policy for the website and the iOS app (linked from App Store Connect). */
export function privacyPage(ctx) {
  const { url } = ctx;
  const body = `${siteHeader(ctx)}
<main class="wrap prose-page">
  <h1>Privacy policy</h1>
  <p class="lede">NOLA.Today has no accounts and doesn’t ask for your name, email or anything else about you. This page covers the website at nola.today and the NOLA.Today iPhone and iPad app.</p>
  <p class="muted">Last updated November 12, 2026.</p>

  <h2>The iPhone and iPad app</h2>
  <ul>
    <li><strong>No personal data is collected.</strong> The app has no analytics, advertising, crash-reporting or tracking code, and it doesn’t use an advertising identifier.</li>
    <li><strong>Show listings.</strong> The app downloads the public schedule files from nola.today (the same ones the website uses) and venue photos. Those requests carry nothing about you beyond what any web request does, such as your IP address, which the web host sees to deliver the file. The app keeps a copy of the schedule on your device so it opens quickly.</li>
    <li><strong>Location.</strong> If you tap the location button, the app asks for permission to show where you are on the map. Your location stays on your device and is never sent to NOLA.Today. You can turn it off any time in Settings.</li>
    <li><strong>Maps.</strong> Maps and directions come from Apple Maps, covered by <a href="https://www.apple.com/legal/privacy/">Apple’s privacy policy</a>.</li>
    <li><strong>Links out.</strong> Venue websites, ticket pages and anything you share open in other apps or sites, which have their own privacy policies.</li>
  </ul>

  <h2>The website</h2>
  <ul>
    <li><strong>Analytics.</strong> The site uses <a href="https://usefathom.com/legal/privacy">Fathom Analytics</a> to count page views. Fathom doesn’t use cookies or collect personal data, and it can’t identify individual visitors.</li>
    <li><strong>Maps and fonts.</strong> The map is drawn by <a href="https://www.mapbox.com/legal/privacy">Mapbox</a> and text uses <a href="https://policies.google.com/privacy">Google Fonts</a>; your browser loads these directly from them.</li>
    <li><strong>Hosting.</strong> The site is hosted on <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">GitHub Pages</a>, which may log your IP address for security.</li>
    <li><strong>Preferences.</strong> Display settings are saved only in your own browser.</li>
    <li><strong>Referral links.</strong> Some pages include referral links to other companies. If you follow one, that company’s privacy policy applies.</li>
  </ul>

  <h2>Children</h2>
  <p>NOLA.Today isn’t directed at children and doesn’t knowingly collect information from anyone.</p>

  <h2>Changes and questions</h2>
  <p>If this policy changes, the new version will be posted here with a new date. Questions? See the <a href="${url('/contact')}">contact page</a>.</p>
</main>
${siteFooter(ctx)}`;
  return layout(ctx, {
    title: 'Privacy Policy – NOLA.Today',
    description: 'NOLA.Today’s privacy policy for the website and the iPhone and iPad app.',
    canonical: `${ctx.config.siteUrl}/privacy`,
    body,
    bodyClass: 'page-privacy',
  });
}

/** /contact: how to reach NOLA.Today (also the App Store support URL). */
export function contactPage(ctx) {
  const { url, config } = ctx;
  const issues = `https://github.com/${config.repo}/issues`;
  const email = config.contactEmail
    ? `<li><strong>Email</strong> <a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a> for questions about the app, the site or a venue listing.</li>`
    : '';
  const body = `${siteHeader(ctx)}
<main class="wrap prose-page">
  <h1>Contact</h1>
  <p class="lede">Found a missing show, a wrong time or a closed venue? Having trouble with the app? Get in touch.</p>
  <ul>
    ${email}
    <li><strong>Report a problem or suggest a venue</strong> on <a href="${issues}">GitHub</a>.</li>
  </ul>
  <h2>The iPhone and iPad app</h2>
  <p>If the app isn’t showing tonight’s shows, pull down on the list to refresh. Schedules are gathered automatically from venue websites, so always confirm with the venue before heading out.</p>
  <p>Read the <a href="${url('/privacy')}">privacy policy</a>.</p>
</main>
${siteFooter(ctx)}`;
  return layout(ctx, {
    title: 'Contact – NOLA.Today',
    description: 'How to reach NOLA.Today about the website, the iPhone and iPad app, or a venue listing.',
    canonical: `${config.siteUrl}/contact`,
    body,
    bodyClass: 'page-contact',
  });
}
