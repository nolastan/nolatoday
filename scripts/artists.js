#!/usr/bin/env node
/**
 * Artist files (data/artists/*.json).
 *
 *   node scripts/artists.js candidates          # names on the schedules that have no artist file yet
 *   node scripts/artists.js discover            # look those names up on MusicBrainz, print the sure ones
 *   node scripts/artists.js discover --write    # ...and create their files
 *   node scripts/artists.js discover --limit 50 # only the 50 most-booked names
 *
 * `discover` only creates an artist when MusicBrainz has exactly one Louisiana act by that exact name
 * (see scripts/lib/musicbrainz.js). Everyone else is skipped: a missing page is better than a wrong one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { loadVenues, loadEvents, writeJSON } from './lib/data.js';
import { ZONE } from './lib/time.js';
import { fetchJSON } from './lib/http.js';
import { ARTISTS_DIR, loadArtists, candidates, leadName, slugify, nameKey } from './lib/artists.js';
import { pickArtist, linksFrom } from './lib/musicbrainz.js';

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

function upcomingTitles() {
  const today = DateTime.now().setZone(ZONE).toISODate();
  const titles = [];
  for (const v of loadVenues()) {
    if (v.status !== 'active') continue;
    for (const e of loadEvents(v.slug).events) if ((e.end ?? e.start) >= today) titles.push({ title: e.title, venue: v.slug });
  }
  return titles;
}

// MusicBrainz asks for at most one request a second.
const MB = 'https://musicbrainz.org/ws/2';
let last = 0;
async function musicbrainz(pathAndQuery) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return fetchJSON(`${MB}/${pathAndQuery}`);
}

async function discover() {
  const artists = loadArtists();
  const slugs = new Set(artists.map((a) => a.slug));
  const mbids = new Set(artists.map((a) => a.musicbrainz).filter(Boolean));
  const spotifyIds = new Set(artists.map((a) => a.spotify).filter(Boolean));
  const limit = Number(option('limit') ?? Infinity);
  const list = candidates(upcomingTitles(), artists).slice(0, limit);
  let created = 0;
  for (const c of list) {
    let hit;
    try {
      // The billed name first, then the bandleader's ("Charmaine Neville Band" → "Charmaine Neville").
      // A leader has to be a person: "3rd Street Band" is not surely the group "3rd Street".
      for (const name of new Set([c.name, leadName(c.name)])) {
        const search = await musicbrainz(`artist?query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}&limit=25&fmt=json`);
        hit = pickArtist(name, search, { person: name !== c.name });
        if (hit) break;
      }
    } catch (err) {
      console.error(`! ${c.name}: ${err.message}`);
      continue;
    }
    if (!hit) continue;
    const slug = slugify(hit.name);
    if (!slug || slugs.has(slug) || mbids.has(hit.id)) continue;
    const { spotify, links } = linksFrom(await musicbrainz(`artist/${hit.id}?inc=url-rels&fmt=json`));
    const artist = { slug, name: hit.name };
    if (nameKey(c.name) !== nameKey(hit.name)) artist.aliases = [c.name];
    if (spotify && !spotifyIds.has(spotify)) artist.spotify = spotify;
    artist.musicbrainz = hit.id;
    if (Object.keys(links).length) artist.links = links;
    console.log(`+ ${hit.name} (${c.count} shows)${artist.spotify ? ' spotify' : ''}${Object.keys(links).map((k) => ` ${k}`).join('')}`);
    if (flag('write')) writeJSON(path.join(ARTISTS_DIR, `${slug}.json`), artist);
    slugs.add(slug);
    mbids.add(hit.id);
    if (artist.spotify) spotifyIds.add(artist.spotify);
    created++;
  }
  console.log(`${created} of ${list.length} names matched${flag('write') ? ' and were written to data/artists/' : ' (run with --write to create them)'}.`);
}

if (command === 'candidates') {
  const list = candidates(upcomingTitles(), loadArtists());
  for (const c of list) console.log(`${String(c.count).padStart(4)}  ${c.name}  (${c.venues.join(', ')})`);
  console.log(`${list.length} names without an artist file.`);
} else if (command === 'discover') {
  fs.mkdirSync(ARTISTS_DIR, { recursive: true });
  await discover();
} else {
  console.error('Usage: node scripts/artists.js candidates | discover [--write] [--limit N]');
  process.exit(1);
}
