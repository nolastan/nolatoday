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
import { ROOT, readJSON, loadVenues, loadEvents, loadStatus, DATA_DIR } from './lib/data.js';
import { ZONE } from './lib/time.js';
import { venuePage } from '../src/templates/venue.js';
import { homePage, venuesPage, redirectPage, notFoundPage } from '../src/templates/pages.js';

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

  const eventsBySlug = new Map();
  for (const v of venues) {
    const events = v.status === 'active' ? loadEvents(v.slug).events.filter((e) => (e.end ?? e.start) >= startOfToday) : [];
    eventsBySlug.set(v.slug, events);
  }

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
      image: v.image ? ctx.asset(`/images/venues/${v.image.replace(/\.jpg$/, '-600.jpg')}`) : null,
    };
    for (const e of events) {
      const item = { v: v.slug, t: e.title, s: e.start };
      if (e.end) item.e = e.end;
      if (e.allDay) item.a = 1;
      mapEvents.push(item);
    }
  }
  mapEvents.sort((a, b) => a.s.localeCompare(b.s));
  write('events.json', JSON.stringify({ generatedAt: now.toISO(), venues: mapVenues, events: mapEvents }));

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

  for (const v of venues) {
    write(`venues/${v.slug}.html`, venuePage(ctx, v, { events: eventsBySlug.get(v.slug), status: status.venues?.[v.slug] }));
  }

  // Old URLs: merged duplicates, aliases and removed venues.
  const venueSlugs = new Set(venues.map((v) => v.slug));
  const allRedirects = { ...redirects };
  for (const v of venues) for (const alias of v.aliases ?? []) allRedirects[alias] = `/venues/${v.slug}`;
  for (const [slug, target] of Object.entries(allRedirects)) {
    if (venueSlugs.has(slug)) throw new Error(`Redirect for "${slug}" would overwrite a venue page`);
    write(`venues/${slug}.html`, redirectPage(ctx, target));
  }
  // The old site's directory pages.
  for (const old of ['music', 'food']) write(`${old}.html`, redirectPage(ctx, '/venues'));

  write('404.html', notFoundPage(ctx));

  const today = now.toISODate();
  const urls = [
    { loc: `${config.siteUrl}/`, lastmod: today, priority: '1.0' },
    { loc: `${config.siteUrl}/venues`, lastmod: today, priority: '0.9' },
    ...venues.map((v) => ({
      loc: `${config.siteUrl}/venues/${v.slug}`,
      lastmod: (status.venues?.[v.slug]?.lastNonEmpty ?? '').slice(0, 10) || today,
      priority: v.status === 'active' ? '0.8' : '0.3',
    })),
  ];
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`)
      .join('\n')}\n</urlset>\n`,
  );
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);

  const pages = venues.length + Object.keys(allRedirects).length;
  console.log(`Built ${pages} venue pages/redirects, ${mapEvents.length} map events → ${path.relative(ROOT, OUT)}/`);
}

main();
