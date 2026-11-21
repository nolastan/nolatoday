#!/usr/bin/env node
/**
 * Build the static site into _site/ from data/ (venues, scraped events) and src/.
 *
 *   node scripts/build.js
 *   BASE_PATH=/nolatoday node scripts/build.js   # when served from a sub-path (GitHub project pages)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { ROOT, readJSON, loadVenues, loadEvents, loadStatus, loadRecent, DATA_DIR } from './lib/data.js';
import { ZONE } from './lib/time.js';
import { isScheduleUrl, venuePageUrls } from './lib/normalize.js';
import { venuePage } from '../src/templates/venue.js';
import { homePage, venuesPage, redirectPage, notFoundPage, privacyPage, contactPage } from '../src/templates/pages.js';
import { paradePage, paradesPage } from '../src/templates/parade.js';
import { artistPage, artistsPage, artistLinks } from '../src/templates/artist.js';
import { loadArtists, buildMatcher } from './lib/artists.js';
import { specificGenres } from './lib/genres.js';
import { loadFood } from './lib/food.js';
import { foodPage, foodVendorPage } from '../src/templates/food.js';
import { FOOD_ICONS } from '../src/templates/food-icons.js';
import { loadCameras } from './lib/cameras.js';
import { loadArtistMeta } from './lib/spotify.js';
import { venueFeed, foodFeed, paradesFeed, artistBroadGenres } from './lib/feeds.js';
import { PARADES_FILE, SOURCES, loadParades, loadWebsites, loadPhotos, paradeOrgs, mapParade } from './lib/parades.js';

const OUT = path.join(ROOT, '_site');
const config = readJSON(path.join(ROOT, 'site.config.json'));
// The Mapbox token comes from the environment (an Actions variable in CI) so it
// isn't committed. Without it the site still builds, minus maps.
config.mapbox.token = process.env[config.mapbox.tokenEnv ?? 'MAPBOX_TOKEN'] || null;
if (!config.mapbox.token) console.warn('warning: MAPBOX_TOKEN is not set; maps will be omitted from the build.');
const base = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');

const hashes = new Map();
function fileHash(file) {
  if (!hashes.has(file)) {
    hashes.set(file, fs.existsSync(file) ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8) : null);
  }
  return hashes.get(file);
}

const ctx = {
  config,
  url: (p) => `${base}${p}`,
  /** URL for a static file with a cache-busting hash. */
  asset: (p) => {
    const candidates = [path.join(ROOT, 'public', p), path.join(ROOT, 'src', p)];
    const file = candidates.find((f) => fs.existsSync(f)) ?? path.join(OUT, p);
    const hash = fileHash(file);
    return `${base}${p}${hash ? `?v=${hash}` : ''}`;
  },
};

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyDir(path.join(ROOT, 'public'), OUT);
  copyDir(path.join(ROOT, 'src/assets'), path.join(OUT, 'assets'));
  write('.nojekyll', '');

  const venues = loadVenues().filter((v) => v.status === 'active' || v.status === 'closed');
  const status = loadStatus();
  const redirects = readJSON(path.join(DATA_DIR, 'redirects.json'), {});
  const now = DateTime.now().setZone(ZONE);
  const startOfToday = now.startOf('day').toISODate();

  // Artists are matched to event titles here, on every build; the scraped events never name them.
  const artists = loadArtists();
  const matcher = buildMatcher(artists);
  const showsByArtist = new Map(artists.map((a) => [a.slug, []]));

  const eventsBySlug = new Map();
  for (const v of venues) {
    const events = v.status === 'active' ? loadEvents(v.slug).events.filter((e) => (e.end ?? e.start) >= startOfToday) : [];
    // Only link events to their own page; drop links to the venue's general schedule (older scrapes kept them).
    const pageUrls = venuePageUrls(v);
    for (const e of events) {
      if (e.url && isScheduleUrl(e.url, pageUrls)) delete e.url;
      const found = matcher.match(e.title);
      if (!found.length) continue;
      e.artists = found;
      for (const slug of new Set(found.map((m) => m.slug))) showsByArtist.get(slug).push({ event: e, venue: v });
    }
    eventsBySlug.set(v.slug, events);
  }

  // Recent shows on venue pages: titles link to artist pages, but not to past events' own pages.
  const recent = loadRecent().venues;
  const recentBySlug = new Map(
    venues.map((v) => [
      v.slug,
      v.status === 'active' ? (recent[v.slug] ?? []).map((e) => ({ ...e, artists: matcher.match(e.title) })) : [],
    ]),
  );

  const venueImage = (v) => (v.image ? ctx.asset(`/images/venues/${v.image.replace(/\.jpg$/, '-600.jpg')}`) : null);
  const venueImageLarge = (v) => (v.image ? ctx.asset(`/images/venues/${v.image}`) : null);

  // Map data: the next week of shows, compact.
  const horizon = now.plus({ days: 8 }).toISODate();
  const mapVenues = {};
  const mapEvents = [];
  for (const v of venues) {
    if (v.status !== 'active') continue;
    const events = eventsBySlug.get(v.slug).filter((e) => e.start <= horizon);
    if (!events.length) continue;
    mapVenues[v.slug] = {
      name: v.name,
      lat: v.lat,
      lng: v.lng,
      image: venueImage(v),
    };
    for (const e of events) {
      const item = { v: v.slug, t: e.title, s: e.start };
      if (e.end) item.e = e.end;
      if (e.allDay) item.a = 1;
      // Artists in the title: [slug, start, end] character ranges, for linking names to artist pages.
      if (e.artists) item.ar = e.artists.map((m) => [m.slug, m.start, m.end]);
      mapEvents.push(item);
    }
  }
  mapEvents.sort((a, b) => a.s.localeCompare(b.s));

  // Parades: yesterday's (a late one may still be rolling) through the next year, so a parade page can link to its day on the map.
  const parades = loadParades();
  const paradePhotos = loadPhotos();
  const paradeFrom = now.minus({ days: 1 }).toISODate();
  const paradeTo = now.plus({ days: 400 }).toISODate();
  const mapParades = parades.filter((f) => f.properties.date >= paradeFrom && f.properties.date <= paradeTo && (f.geometry || f.properties.start_point)).map((f) => {
    // The organization's first photo tops its card on the map, as a venue's photo does.
    const item = mapParade(f);
    const photo = paradePhotos[item.slug]?.[0];
    if (photo) item.i = ctx.asset(`/images/parades/${photo.file.replace(/\.jpg$/, '-600.jpg')}`);
    return item;
  });
  // Food pop-ups (prototype): kept apart from `events` so apps reading the music schedule don't
  // mistake them for shows. A stop at a venue uses the venue's slug as its place, so the map can put
  // food and music on one marker.
  const food = loadFood(venues, { today: startOfToday });
  const foodPlaces = {};
  const foodEvents = [];
  for (const vendor of food) {
    for (const e of vendor.events) {
      if ((e.end ?? e.start) < startOfToday || e.start > horizon) continue;
      const p = e.place;
      foodPlaces[p.key] ??= { name: p.name, lat: p.lat, lng: p.lng, ...(p.venue ? { venue: p.venue } : {}), ...(p.approximate ? { far: 1 } : {}) };
      const item = { p: p.key, n: vendor.name, f: vendor.slug, i: FOOD_ICONS[vendor.icon] ? vendor.icon : 'default', s: e.start };
      if (e.end) item.e = e.end;
      if (e.allDay) item.a = 1;
      // Not confirmed by the vendor in the last 30 days: the card says so.
      if (e.stale) item.u = e.confirmedOn ?? 1;
      foodEvents.push(item);
    }
  }
  foodEvents.sort((a, b) => a.s.localeCompare(b.s));
  write('events.json', JSON.stringify({ generatedAt: now.toISO(), venues: mapVenues, events: mapEvents, parades: mapParades, foodPlaces, food: foodEvents, foodIcons: Object.fromEntries([...new Set(foodEvents.map((e) => e.i))].map((k) => [k, FOOD_ICONS[k]])), cameras: loadCameras().map(({ name, lat, lng, embed }) => ({ name, lat, lng, embed })) }));

  // Public venue list (handy for anyone building on this data).
  write(
    'venues.json',
    JSON.stringify(
      venues.map((v) => ({
        slug: v.slug,
        name: v.name,
        status: v.status,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        website: v.website,
        url: `${config.siteUrl}/venues/${v.slug}`,
        upcoming: eventsBySlug.get(v.slug).length,
        // What the venue page shows under the schedule and photo; the iOS app reads these here.
        sources: [...new Set((v.sources ?? []).map((s) => s.url).filter(Boolean))],
        imageCredit: v.imageCredit,
        // Added for apps; the full venue (schedule, recent shows, food) is at /venues/<slug>.json.
        image: venueImage(v) ?? undefined,
        json: `${config.siteUrl}/venues/${v.slug}.json`,
      })),
      null,
      1,
    ),
  );

  write('index.html', homePage(ctx));

  const directory = venuesPage(ctx, venues, { eventsBySlug });
  // GitHub Pages serves /venues from venues.html; venues/index.html covers /venues/.
  write('venues.html', directory);
  write('venues/index.html', directory);

  // Food pop-ups at a venue go on its page too.
  const foodByVenue = new Map();
  for (const vendor of food) {
    for (const e of vendor.events) {
      if (!e.place.venue || (e.end ?? e.start) < startOfToday) continue;
      if (!foodByVenue.has(e.place.venue)) foodByVenue.set(e.place.venue, []);
      foodByVenue.get(e.place.venue).push({ ...e, food: true, vendorName: vendor.name, icon: vendor.icon });
    }
  }
  for (const v of venues) {
    const pageData = { events: eventsBySlug.get(v.slug), recent: recentBySlug.get(v.slug), status: status.venues?.[v.slug], food: foodByVenue.get(v.slug) ?? [] };
    write(`venues/${v.slug}.html`, venuePage(ctx, v, pageData));
    // The same data for apps.
    write(
      `venues/${v.slug}.json`,
      JSON.stringify(venueFeed(v, { ...pageData, siteUrl: config.siteUrl, image: venueImage(v), imageLarge: venueImageLarge(v), generatedAt: now.toISO() })),
    );
  }

  // Artists: a directory, a page each, and the list for anyone building on this data.
  for (const shows of showsByArtist.values()) shows.sort((a, b) => a.event.start.localeCompare(b.event.start));
  const artistMeta = loadArtistMeta();
  const artistDirectory = artistsPage(ctx, artists, { showsBySlug: showsByArtist, meta: artistMeta });
  write('artists.html', artistDirectory);
  write('artists/index.html', artistDirectory);
  for (const a of artists) write(`artists/${a.slug}.html`, artistPage(ctx, a, { shows: showsByArtist.get(a.slug), meta: artistMeta[a.slug] }));
  write(
    'artists.json',
    JSON.stringify(
      artists.map((a) => ({
        slug: a.slug,
        name: a.name,
        url: `${config.siteUrl}/artists/${a.slug}`,
        upcoming: showsByArtist.get(a.slug).length,
        image: artistMeta[a.slug]?.image,
        genres: specificGenres(artistMeta[a.slug]).length ? specificGenres(artistMeta[a.slug]) : undefined,
        // The directory's genre filter: slugs from scripts/lib/genres.js GENRES.
        broadGenres: artistBroadGenres(a, artistMeta[a.slug]).length ? artistBroadGenres(a, artistMeta[a.slug]) : undefined,
        links: Object.fromEntries(artistLinks(a).map((l) => [l.key, l.url])),
      })),
      null,
      1,
    ),
  );

  // Parades: a directory, a page per krewe or club, and the combined data for anyone who wants it.
  const orgs = paradeOrgs(parades, startOfToday, { websites: loadWebsites(), photos: loadPhotos() });
  const paradeSources = [
    { ...SOURCES.permits, note: 'Second lines, walking krewes and other public parades' },
    { ...SOURCES.open_data, note: 'Carnival parade routes and times' },
    { ...SOURCES.routewise, note: 'Carnival times and services along the route' },
    { ...SOURCES.centerlines, note: 'The street map that written routes are drawn along' },
    { ...SOURCES.organizer, note: 'Dates and times a krewe or club announced before the city listed them, never routes' },
  ];
  const paradeDirectory = paradesPage(ctx, orgs, { today: startOfToday, sources: paradeSources });
  write('parades.html', paradeDirectory);
  write('parades/index.html', paradeDirectory);
  for (const org of orgs) write(`parades/${org.slug}.html`, paradePage(ctx, org, { today: startOfToday }));
  if (fs.existsSync(PARADES_FILE)) fs.copyFileSync(PARADES_FILE, path.join(OUT, 'parades.geojson'));
  write('parades.json', JSON.stringify(paradesFeed(orgs, { siteUrl: config.siteUrl, photoUrl: (file) => ctx.asset(`/images/parades/${file}`), generatedAt: now.toISO() })));

  // Old URLs: merged duplicates, aliases and removed venues.
  const venueSlugs = new Set(venues.map((v) => v.slug));
  const allRedirects = { ...redirects };
  for (const v of venues) for (const alias of v.aliases ?? []) allRedirects[alias] = `/venues/${v.slug}`;
  for (const [slug, target] of Object.entries(allRedirects)) {
    if (venueSlugs.has(slug)) throw new Error(`Redirect for "${slug}" would overwrite a venue page`);
    write(`venues/${slug}.html`, redirectPage(ctx, target));
  }
  // Old /stories/<slug> pages, now kept on the venue page they were about.
  let storyCount = 0;
  for (const v of venues) {
    for (const story of v.stories ?? []) {
      write(`stories/${story.slug}.html`, redirectPage(ctx, `/venues/${v.slug}#${story.slug}`));
      storyCount++;
    }
  }
  // Food pop-ups (prototype). /food was the old site's food directory; it is a page again.
  const foodDirectory = foodPage(ctx, food, { today: startOfToday });
  write('food.html', foodDirectory);
  write('food/index.html', foodDirectory);
  for (const vendor of food) write(`food/${vendor.slug}.html`, foodVendorPage(ctx, vendor, { today: startOfToday }));
  write('food.json', JSON.stringify(foodFeed(food, { siteUrl: config.siteUrl, today: startOfToday, icons: FOOD_ICONS, generatedAt: now.toISO() })));

  // The old site's music directory.
  write('music.html', redirectPage(ctx, '/venues'));

  write('404.html', notFoundPage(ctx));
  write('privacy.html', privacyPage(ctx));
  write('contact.html', contactPage(ctx));

  const today = now.toISODate();
  const urls = [
    { loc: `${config.siteUrl}/`, lastmod: today, priority: '1.0' },
    { loc: `${config.siteUrl}/venues`, lastmod: today, priority: '0.9' },
    { loc: `${config.siteUrl}/contact`, lastmod: today, priority: '0.1' },
    { loc: `${config.siteUrl}/privacy`, lastmod: today, priority: '0.1' },
    ...venues.map((v) => ({
      loc: `${config.siteUrl}/venues/${v.slug}`,
      lastmod: (status.venues?.[v.slug]?.lastNonEmpty ?? '').slice(0, 10) || today,
      priority: v.status === 'active' ? '0.8' : '0.3',
    })),
    ...(artists.length ? [{ loc: `${config.siteUrl}/artists`, lastmod: today, priority: '0.9' }] : []),
    ...artists.map((a) => ({ loc: `${config.siteUrl}/artists/${a.slug}`, lastmod: today, priority: showsByArtist.get(a.slug).length ? '0.7' : '0.3' })),
    { loc: `${config.siteUrl}/parades`, lastmod: today, priority: '0.9' },
    { loc: `${config.siteUrl}/food`, lastmod: today, priority: '0.8' },
    ...food.map((v) => ({ loc: `${config.siteUrl}/food/${v.slug}`, lastmod: v.updated ?? today, priority: '0.6' })),
    ...orgs.map((o) => ({
      loc: `${config.siteUrl}/parades/${o.slug}`,
      lastmod: (o.featured.properties.first_seen ?? today).slice(0, 10),
      priority: o.upcoming.length ? '0.8' : '0.4',
    })),
  ];
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`)
      .join('\n')}\n</urlset>\n`,
  );
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);

  const pages = venues.length + Object.keys(allRedirects).length + storyCount;
  console.log(`Built ${artists.length} artist pages, ${[...showsByArtist.values()].filter((s) => s.length).length} with shows`);
  console.log(`Built the food page: ${food.length} vendors, ${foodEvents.length} map stops`);
  console.log(`Built ${orgs.length} parade pages, ${mapParades.length} map parades`);
  console.log(`Built ${pages} venue pages/redirects, ${mapEvents.length} map events → ${path.relative(ROOT, OUT)}/`);
}

main();
