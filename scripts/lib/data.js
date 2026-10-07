import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const VENUES_DIR = path.join(DATA_DIR, 'venues');
export const EVENTS_DIR = path.join(DATA_DIR, 'events');
export const STATUS_FILE = path.join(DATA_DIR, 'status.json');

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${err.message}`);
  }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** All venues from data/venues/*.json, sorted by name. */
export function loadVenues() {
  return fs
    .readdirSync(VENUES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const venue = readJSON(path.join(VENUES_DIR, f));
      const slug = f.replace(/\.json$/, '');
      if (venue.slug !== slug) throw new Error(`data/venues/${f}: slug "${venue.slug}" doesn't match filename`);
      return venue;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadEvents(slug) {
  return readJSON(path.join(EVENTS_DIR, `${slug}.json`), { venue: slug, events: [] });
}

export function loadStatus() {
  return readJSON(STATUS_FILE, { venues: {} });
}
