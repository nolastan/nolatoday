#!/usr/bin/env node
/** Sanity-check data/venues/*.json and data/redirects.json. Exits 1 on problems. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, loadVenues, readJSON } from './lib/data.js';
import { adapters } from '../scrapers/index.js';

const errors = [];
const err = (slug, msg) => errors.push(`${slug}: ${msg}`);

const STATUSES = new Set(['active', 'closed']);
// Generous box around greater New Orleans.
const BOUNDS = { latMin: 29.8, latMax: 30.2, lngMin: -90.35, lngMax: -89.85 };
const ALLOWED_KEYS = new Set(['slug', 'name', 'status', 'address', 'lat', 'lng', 'website', 'image', 'aliases', 'sources', 'note', 'stories']);

const venues = loadVenues();
const slugs = new Set(venues.map((v) => v.slug));
const aliases = new Map();
const storySlugs = new Map();

for (const v of venues) {
  for (const key of Object.keys(v)) if (!ALLOWED_KEYS.has(key)) err(v.slug, `unknown field "${key}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug)) err(v.slug, 'slug must be lowercase-kebab-case');
  if (!v.name) err(v.slug, 'missing name');
  if (!STATUSES.has(v.status)) err(v.slug, `status must be one of ${[...STATUSES].join(', ')}`);
  if (!v.address) err(v.slug, 'missing address');
  if (typeof v.lat !== 'number' || v.lat < BOUNDS.latMin || v.lat > BOUNDS.latMax) err(v.slug, `lat ${v.lat} is outside New Orleans`);
  if (typeof v.lng !== 'number' || v.lng < BOUNDS.lngMin || v.lng > BOUNDS.lngMax) err(v.slug, `lng ${v.lng} is outside New Orleans`);
  if (v.website != null && !/^https?:\/\//.test(v.website)) err(v.slug, 'website must be an http(s) URL or null');
  if (v.image) {
    for (const f of [v.image, v.image.replace(/\.jpg$/, '-600.jpg')]) {
      if (!fs.existsSync(path.join(ROOT, 'public/images/venues', f))) err(v.slug, `image public/images/venues/${f} not found`);
    }
  }
  if (!Array.isArray(v.sources)) err(v.slug, 'sources must be an array');
  if (v.status === 'closed' && v.sources?.length) err(v.slug, 'closed venues should not have sources');
  for (const s of v.sources ?? []) {
    if (s.type === 'custom') {
      if (!s.name || !fs.existsSync(path.join(ROOT, 'scrapers/custom', `${s.name}.js`))) err(v.slug, `custom scraper scrapers/custom/${s.name}.js not found`);
    } else if (!adapters[s.type]) {
      err(v.slug, `unknown source type "${s.type}"`);
    }
    for (const p of s.exclude ?? []) {
      try {
        new RegExp(p);
      } catch {
        err(v.slug, `invalid exclude regex ${p}`);
      }
    }
  }
  if (v.stories != null && !Array.isArray(v.stories)) err(v.slug, 'stories must be an array');
  for (const s of v.stories ?? []) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug ?? '')) err(v.slug, `story slug "${s.slug}" must be lowercase-kebab-case`);
    else if (storySlugs.has(s.slug)) err(v.slug, `story "${s.slug}" is also on ${storySlugs.get(s.slug)}`);
    else storySlugs.set(s.slug, v.slug);
    if (!s.title) err(v.slug, `story "${s.slug}" is missing a title`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? '')) err(v.slug, `story "${s.slug}" date must be YYYY-MM-DD`);
    if (!Array.isArray(s.body) || !s.body.length || s.body.some((p) => typeof p !== 'string' || !p)) err(v.slug, `story "${s.slug}" body must be a non-empty array of paragraphs`);
  }
  for (const a of v.aliases ?? []) {
    if (slugs.has(a)) err(v.slug, `alias "${a}" is also a venue slug`);
    if (aliases.has(a)) err(v.slug, `alias "${a}" is also claimed by ${aliases.get(a)}`);
    aliases.set(a, v.slug);
  }
}

const redirects = readJSON(path.join(DATA_DIR, 'redirects.json'), {});
for (const [from, to] of Object.entries(redirects)) {
  if (slugs.has(from)) err(`redirects.json`, `"${from}" redirects but is also a venue`);
  if (aliases.has(from)) err(`redirects.json`, `"${from}" is also an alias of ${aliases.get(from)}`);
  const m = /^\/venues\/(.+)$/.exec(to);
  if (m && !slugs.has(m[1])) err('redirects.json', `"${from}" points to missing venue ${to}`);
  if (!to.startsWith('/')) err('redirects.json', `"${from}" target must be a site path`);
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  console.error(`\n${errors.length} problem(s) in venue data.`);
  process.exit(1);
}
console.log(`✓ ${venues.length} venues and ${Object.keys(redirects).length} redirects look good.`);
