import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { DATA_DIR, readJSON } from './data.js';
import { ZONE } from './time.js';

/**
 * Food pop-ups and trucks (prototype). One file per vendor in data/food/vendors/, each listing its
 * stops. A stop's `place` is a venue slug when the host is already a venue, otherwise a key in
 * data/food/places.json. `confirmedOn` is the date the vendor last posted this stop (or the weekly
 * pattern it follows); a stop not confirmed in the last 30 days is shown with a disclaimer.
 * `basis` is a note on where the stop came from, kept for us and not shown.
 */
export const RECENT_DAYS = 30;

export const FOOD_DIR = path.join(DATA_DIR, 'food');

export function loadFood(venues, { today = DateTime.now().setZone(ZONE).toISODate() } = {}) {
  const dir = path.join(FOOD_DIR, 'vendors');
  if (!fs.existsSync(dir)) return [];
  const places = readJSON(path.join(FOOD_DIR, 'places.json'), {});
  const venueBySlug = new Map(venues.map((v) => [v.slug, v]));
  const resolve = (key, file) => {
    const v = venueBySlug.get(key);
    if (v) return { key, venue: v.slug, name: v.name, address: v.address, lat: v.lat, lng: v.lng };
    const p = places[key];
    if (!p) throw new Error(`data/food/vendors/${file}: unknown place "${key}"`);
    return { key: `food-${key}`, name: p.name, address: p.address, lat: p.lat, lng: p.lng, approximate: !!p.approximate };
  };
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const vendor = readJSON(path.join(dir, f));
      vendor.events = (vendor.events ?? [])
        .map((e) => {
          // Full ISO times with the New Orleans offset, as scraped shows have.
          const at = (date, time) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toISO({ suppressMilliseconds: true });
          const start = e.time ? at(e.date, e.time) : e.date;
          const end = e.time && e.end ? at(e.end <= e.time ? nextDay(e.date) : e.date, e.end) : undefined;
          return { ...e, start, end, allDay: !e.time, stale: !e.confirmedOn || DateTime.fromISO(today).diff(DateTime.fromISO(e.confirmedOn), 'days').days > RECENT_DAYS, place: resolve(e.place, f), vendor: vendor.slug };
        })
        .sort((a, b) => a.start.localeCompare(b.start));
      return vendor;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nextDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
