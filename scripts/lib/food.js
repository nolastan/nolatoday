import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { DATA_DIR, readJSON } from './data.js';
import { ZONE } from './time.js';
import { slugify, nameKey } from './artists.js';
import { FOOD_ICONS } from '../../src/templates/food-icons.js';

/**
 * Food pop-ups and trucks. See CONTRIBUTING.md ("Food pop-ups") for the file formats.
 *
 * - data/food/vendors/<slug>.json: one per vendor, its profile and the stops it posted (written by
 *   Meta Muse from Instagram, like data/manual/).
 * - data/food/places.json: where stops happen that aren't venues (bars, breweries, lots).
 * - data/food/sources.json: host calendars scraped for pop-ups by scripts/food.js, which writes
 *   data/food/scraped/<place>.json (generated; don't hand-edit).
 *
 * A stop's `place` is a venue slug when the host is a venue, otherwise a key in places.json.
 * `confirmedOn` is the date the stop was last posted; a stop not confirmed in the last 30 days is
 * shown with a disclaimer. `basis` is a note on where a stop came from, kept for us and not shown.
 */
export const RECENT_DAYS = 30;

export const FOOD_DIR = path.join(DATA_DIR, 'food');
export const VENDORS_DIR = path.join(FOOD_DIR, 'vendors');
export const SCRAPED_DIR = path.join(FOOD_DIR, 'scraped');
export const PLACES_FILE = path.join(FOOD_DIR, 'places.json');
export const SOURCES_FILE = path.join(FOOD_DIR, 'sources.json');

export const VENDOR_TYPES = ['Pop-up', 'Food truck'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const VENDOR_KEYS = new Set(['slug', 'name', 'icon', 'type', 'description', 'website', 'from', 'updated', 'events']);
const EVENT_KEYS = new Set(['date', 'time', 'end', 'place', 'price', 'note', 'url', 'confirmedOn', 'basis']);
const PLACE_KEYS = new Set(['name', 'address', 'lat', 'lng', 'approximate']);

export const loadPlaces = () => readJSON(PLACES_FILE, {});
export const loadFoodSources = () => readJSON(SOURCES_FILE, []);

function readVendorFiles() {
  if (!fs.existsSync(VENDORS_DIR)) return [];
  return fs
    .readdirSync(VENDORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, vendor: readJSON(path.join(VENDORS_DIR, f)) }));
}

function readScraped() {
  if (!fs.existsSync(SCRAPED_DIR)) return [];
  return fs
    .readdirSync(SCRAPED_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(SCRAPED_DIR, f)));
}

/** Problems with one vendor file, as strings. Empty when it's fine. */
export function checkVendor(data, slug, { placeKeys = new Set() } = {}) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['must be a JSON object'];
  for (const key of Object.keys(data)) if (!VENDOR_KEYS.has(key)) problems.push(`unknown field "${key}"`);
  if (data.slug !== slug) problems.push(`"slug" must be "${slug}" (the file name)`);
  if (typeof data.name !== 'string' || !data.name.trim()) problems.push('"name" is required');
  if (data.icon != null && !FOOD_ICONS[data.icon]) problems.push(`"icon" must be one of ${Object.keys(FOOD_ICONS).join(', ')}`);
  if (data.type != null && !VENDOR_TYPES.includes(data.type)) problems.push(`"type" must be one of ${VENDOR_TYPES.join(', ')}`);
  for (const key of ['website', 'from']) {
    if (data[key] != null && !/^https?:\/\//.test(data[key])) problems.push(`"${key}" must be an http(s) URL`);
  }
  if (data.updated != null && !DATE.test(data.updated)) problems.push('"updated" must be YYYY-MM-DD');
  if (data.events == null) return problems;
  if (!Array.isArray(data.events)) return [...problems, '"events" must be an array'];
  data.events.forEach((e, i) => {
    const at = `events[${i}]`;
    if (!e || typeof e !== 'object') return problems.push(`${at} must be an object`);
    for (const key of Object.keys(e)) if (!EVENT_KEYS.has(key)) problems.push(`${at}: unknown field "${key}"`);
    if (!DATE.test(e.date ?? '')) problems.push(`${at}: "date" must be YYYY-MM-DD`);
    for (const key of ['time', 'end']) {
      if (e[key] != null && !TIME.test(e[key])) problems.push(`${at}: "${key}" must be 24-hour HH:MM or null`);
    }
    if (e.end != null && e.time == null) problems.push(`${at}: "end" needs a "time"`);
    if (typeof e.place !== 'string' || !e.place) problems.push(`${at}: "place" is required`);
    else if (!placeKeys.has(e.place)) problems.push(`${at}: place "${e.place}" is not a venue slug or a key in data/food/places.json`);
    if (!DATE.test(e.confirmedOn ?? '')) problems.push(`${at}: "confirmedOn" must be YYYY-MM-DD (the date of the post that announced it)`);
    if (e.url != null && !/^https?:\/\//.test(e.url)) problems.push(`${at}: "url" must be an http(s) URL`);
  });
  return problems;
}

/** Problems with data/food/places.json, as strings. */
export function checkPlaces(places, venueSlugs = new Set()) {
  const problems = [];
  for (const [key, p] of Object.entries(places)) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) problems.push(`"${key}": keys are lowercase-with-dashes`);
    if (venueSlugs.has(key)) problems.push(`"${key}" is a venue; use the venue slug as the place instead`);
    for (const k of Object.keys(p)) if (!PLACE_KEYS.has(k)) problems.push(`"${key}": unknown field "${k}"`);
    if (typeof p.name !== 'string' || !p.name) problems.push(`"${key}": "name" is required`);
    if (typeof p.address !== 'string' || !p.address) problems.push(`"${key}": "address" is required`);
    // Roughly greater New Orleans, so a swapped or mistyped coordinate is caught.
    if (!(p.lat > 29.4 && p.lat < 30.6 && p.lng > -91 && p.lng < -89.4)) problems.push(`"${key}": lat/lng are not in the New Orleans area`);
  }
  return problems;
}

/**
 * Pop-ups found in a host's calendar. `raw` is what the source's adapter returned; the source config
 * picks the food events (`include`, `exclude`) and turns each title into a vendor name: the part
 * before a colon, without a trailing "Pop-up" or "Food Truck", then `rename` (regex → name).
 */
export function foodFromCalendar(raw, config) {
  const include = new RegExp(config.include ?? 'pop-?up|food truck', 'i');
  const exclude = config.exclude ? new RegExp(config.exclude, 'i') : null;
  const rename = Object.entries(config.rename ?? {}).map(([re, name]) => [new RegExp(re, 'i'), name]);
  const out = [];
  for (const e of raw) {
    const title = decode(e.title ?? '').trim();
    if (!include.test(title) || (exclude && exclude.test(title)) || /cancel+ed|postponed/i.test(title)) continue;
    let name = title.split(':')[0].replace(/\s*[-–—]?\s*(pop-?up|food truck)\b.*$/i, '').trim();
    for (const [re, to] of rename) if (re.test(title)) name = to;
    if (!name) continue;
    out.push({ vendor: name, title, start: e.start, end: e.end ?? null, allDay: !!e.allDay, url: e.url ?? null });
  }
  return out;
}

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'");
}

/** Vendors with their stops, from the vendor files and the scraped host calendars. */
export function loadFood(venues, { today = DateTime.now().setZone(ZONE).toISODate() } = {}) {
  const places = loadPlaces();
  const venueBySlug = new Map(venues.map((v) => [v.slug, v]));
  const resolve = (key, where) => {
    const v = venueBySlug.get(key);
    if (v) return { key, venue: v.slug, name: v.name, address: v.address, lat: v.lat, lng: v.lng };
    const p = places[key];
    if (!p) throw new Error(`${where}: unknown place "${key}"`);
    return { key: `food-${key}`, name: p.name, address: p.address, lat: p.lat, lng: p.lng, approximate: !!p.approximate };
  };
  const stale = (confirmedOn) => !confirmedOn || DateTime.fromISO(today).diff(DateTime.fromISO(confirmedOn), 'days').days > RECENT_DAYS;
  const at = (date, time) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toISO({ suppressMilliseconds: true });

  const vendors = new Map();
  const byName = new Map();
  for (const { file, vendor } of readVendorFiles()) {
    vendor.events = (vendor.events ?? []).map((e) => {
      const start = e.time ? at(e.date, e.time) : e.date;
      const end = e.time && e.end ? at(e.end <= e.time ? nextDay(e.date) : e.date, e.end) : undefined;
      return { ...e, start, end, allDay: !e.time, stale: stale(e.confirmedOn), place: resolve(e.place, `data/food/vendors/${file}`), vendor: vendor.slug };
    });
    vendors.set(vendor.slug, vendor);
    byName.set(nameKey(vendor.name), vendor);
  }

  // Host calendars: a vendor with no file of its own gets a plain profile from its name.
  for (const cal of readScraped()) {
    const place = resolve(cal.place, `data/food/scraped/${cal.place}.json`);
    const checked = (cal.scrapedAt ?? '').slice(0, 10);
    for (const s of cal.events ?? []) {
      let vendor = byName.get(nameKey(s.vendor)) ?? vendors.get(slugify(s.vendor));
      if (!vendor) {
        vendor = { slug: slugify(s.vendor), name: s.vendor, type: 'Pop-up', events: [] };
        vendors.set(vendor.slug, vendor);
        byName.set(nameKey(vendor.name), vendor);
      }
      const start = s.allDay ? s.start : DateTime.fromISO(s.start).setZone(ZONE).toISO({ suppressMilliseconds: true });
      const end = s.end ? DateTime.fromISO(s.end).setZone(ZONE).toISO({ suppressMilliseconds: true }) : undefined;
      // The same stop posted by the vendor and listed by the host: keep the vendor's.
      if (vendor.events.some((e) => e.place.key === place.key && e.start.slice(0, 10) === start.slice(0, 10))) continue;
      vendor.events.push({ start, end, allDay: s.allDay, url: s.url ?? undefined, confirmedOn: checked, stale: stale(checked), place, vendor: vendor.slug });
    }
  }

  for (const v of vendors.values()) v.events.sort((a, b) => a.start.localeCompare(b.start));
  return [...vendors.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function nextDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
