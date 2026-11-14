/**
 * Parade data: normalizing the City of New Orleans' official route layers into
 * one GeoJSON FeatureCollection (data/parades/parades.geojson), and the geometry
 * helpers the site build needs to draw it.
 *
 * Everything here is pure: fetching lives in scripts/parades.js. Nothing in a
 * feature may come from anywhere but an official source response. See
 * docs/parades.md for the rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { DATA_DIR, ROOT, readJSON } from './data.js';
import { ZONE } from './time.js';

export const PARADES_DIR = path.join(DATA_DIR, 'parades');
export const PARADES_FILE = path.join(PARADES_DIR, 'parades.geojson');
export const KREWES_FILE = path.join(PARADES_DIR, 'krewes.json');
export const WEBSITES_FILE = path.join(PARADES_DIR, 'websites.json');
export const ANNOUNCED_FILE = path.join(PARADES_DIR, 'announced.json');
export const PHOTOS_FILE = path.join(PARADES_DIR, 'photos.json');
export const PHOTOS_DIR = path.join(ROOT, 'public/images/parades');
export const MAX_PHOTOS = 3;

/** The official sources the pipeline reads. `id` is what a feature's `source_layer` refers to. */
export const SOURCES = {
  open_data: {
    id: 'open_data',
    title: 'Mardi Gras Routes',
    publisher: 'City of New Orleans, Office of Homeland Security & Emergency Preparedness (NOHSEP)',
    url: 'https://data.nola.gov/Arts-Culture-History/Mardi-Gras-Routes/tkeu-9s5e',
    layer: 'data.nola.gov tkeu-9s5e (Mardi Gras Routes)',
    dataUrl: 'https://data.nola.gov/resource/tkeu-9s5e.geojson?$limit=5000',
    metaUrl: 'https://data.nola.gov/api/views/tkeu-9s5e.json',
  },
  routewise: {
    id: 'routewise',
    title: 'Routewise Public View',
    publisher: 'City of New Orleans (NOLA Ready / Enterprise GIS)',
    url: 'https://routewise.nola.gov/',
    layer: 'routewise_public/FeatureServer/0 (parade_routes)',
    dataUrl: 'https://services.arcgis.com/VhMjCzR3cIjEkh7L/arcgis/rest/services/routewise_public/FeatureServer/0',
    metaUrl: 'https://services.arcgis.com/VhMjCzR3cIjEkh7L/arcgis/rest/services/routewise_public/FeatureServer/0?f=json',
  },
  permits: {
    id: 'permits',
    title: 'Permit Application Data for the Office of Business and External Services',
    publisher: 'City of New Orleans, Office of Business and External Services',
    url: 'https://data.nola.gov/d/aib5-en5t',
    layer: 'data.nola.gov aib5-en5t (type = Special Event - Master)',
    dataUrl: 'https://data.nola.gov/resource/aib5-en5t.json',
    metaUrl: 'https://data.nola.gov/api/views/aib5-en5t.json',
    /** The one application a parade came from. */
    recordUrl: (permit) => `https://data.nola.gov/resource/aib5-en5t.json?permitnumber=${encodeURIComponent(permit)}`,
  },
  // Not a source of parades: the street lines that written routes are traced along.
  // Not a feed: data/parades/announced.json, kept by hand from each organization's own website.
  organizer: {
    id: 'organizer',
    title: 'Organizers’ own websites',
    publisher: 'the krewe or club itself',
    url: 'https://github.com/nolastan/nolatoday/blob/main/data/parades/announced.json',
    layer: 'the organization’s own website (data/parades/announced.json)',
  },
  centerlines: {
    id: 'centerlines',
    title: 'CNO Road Centerlines (100 block)',
    publisher: 'City of New Orleans, Enterprise GIS',
    url: 'https://services.arcgis.com/VhMjCzR3cIjEkh7L/arcgis/rest/services/CNO_Road_Centerlines_100Blk/FeatureServer/0',
    layer: 'CNO_Road_Centerlines_100Blk/FeatureServer/0',
    dataUrl: 'https://services.arcgis.com/VhMjCzR3cIjEkh7L/arcgis/rest/services/CNO_Road_Centerlines_100Blk/FeatureServer/0',
  },
};

/** Bump when scripts/lib/route-trace.js changes what it draws, so saved traces are redone. */
export const TRACE_VERSION = 2;

export const CATEGORIES = ['mardi_gras', 'second_line', 'other'];
export const JURISDICTIONS = ['orleans_parish', 'jefferson_parish', 'other'];
const AMENITIES = { Portolet: 'portolets', FirstAid: 'first_aid', LostChild: 'lost_child', Vendors: 'vendors', Parking: 'parking_restrictions', Traffic: 'traffic_restrictions' };

// ---- Names ------------------------------------------------------------------

/** "Krewe d'État" → "krewe-d-etat". */
export function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ə/g, 'e')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PREFIXES = /^(the|mystic|magical|krewe|knights|legion|societe|society|club|of|de|des|du)\s+/;

/**
 * A loose key for matching the same parade across sources: "Krewe of Oshun",
 * "Oshun" and "OSHUN" all give "oshun"; "Knights of Sparta" gives "sparta";
 * "Krewe d'Etat" and "D'etat" give "detat".
 */
export function nameKey(name) {
  let s = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ə/g, 'e')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let prev;
  do {
    prev = s;
    s = s.replace(PREFIXES, '');
  } while (s !== prev);
  return s.replace(/\s+(parade|krewe)$/, '').replace(/\s+/g, '');
}

/** Rows the city left in from testing ("Test", "Wed Test"). */
export function isTestRow(name) {
  return /\btest\b/i.test(name ?? '');
}

/**
 * Krewe registry lookup. data/parades/krewes.json gives each organization a
 * stable slug and display name and lists the official event names that belong
 * to it. An event nobody has registered yet still gets through, under a slug
 * made from its official name.
 */
export function krewesIndex(krewes) {
  const byKey = new Map();
  for (const k of krewes) {
    for (const name of [k.name, ...(k.match ?? [])]) {
      const key = nameKey(name);
      if (byKey.has(key) && byKey.get(key) !== k) throw new Error(`krewes.json: "${name}" matches both ${byKey.get(key).slug} and ${k.slug}`);
      byKey.set(key, k);
    }
  }
  return { find: (eventName) => byKey.get(nameKey(eventName)) ?? null };
}

function categoryFor(name, krewe, fallback) {
  if (krewe?.category) return krewe.category;
  if (/second[\s-]?line/i.test(name)) return 'second_line';
  return fallback;
}

// ---- Times ------------------------------------------------------------------

/** "5:00pm" / "11:45 AM" → { hour, minute }, or null. */
export function parseClock(text) {
  const m = /^\s*(\d{1,2})(?:[:;.](\d{2}))?\s*([ap])\.?m\.?\s*$/i.exec(text ?? '');
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') hour += 12;
  const minute = Number(m[2] ?? 0);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

const isoLocal = (dt) => dt.toISO({ suppressMilliseconds: true });

/**
 * The city's ArcGIS layers store New Orleans wall-clock time as if it were UTC
 * (Routewise itself prints these with getUTCHours()). Read the UTC fields and
 * re-label them as America/Chicago.
 */
export function wallClockFromEpoch(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const u = DateTime.fromMillis(ms, { zone: 'utc' });
  return DateTime.fromObject({ year: u.year, month: u.month, day: u.day, hour: u.hour, minute: u.minute }, { zone: ZONE });
}

// ---- Geometry ---------------------------------------------------------------

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A geometry's lines as an array of coordinate arrays. */
export function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

export function lengthMeters(geometry) {
  let total = 0;
  for (const line of linesOf(geometry)) for (let i = 1; i < line.length; i++) total += distanceMeters(line[i - 1], line[i]);
  return total;
}

export function bbox(geometry) {
  let b = null;
  for (const line of linesOf(geometry)) {
    for (const [x, y] of line) {
      if (!b) b = [x, y, x, y];
      else b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    }
  }
  return b;
}

/** Keep WGS84 lines only, 2D, rounded to 6 places (~0.1 m), without empty or duplicate points. */
export function cleanGeometry(geometry) {
  const lines = linesOf(geometry)
    .map((line) => {
      const out = [];
      for (const p of line ?? []) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const q = [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))];
        const last = out[out.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
      }
      return out;
    })
    .filter((line) => line.length >= 2);
  if (!lines.length) return null;
  for (const [x, y] of lines.flat()) {
    // Catches a layer served in State Plane feet instead of WGS84.
    if (x < -180 || x > 180 || y < -90 || y > 90) throw new Error(`geometry is not WGS84 (saw ${x}, ${y})`);
  }
  return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
}

/** Douglas–Peucker on one line; tolerance in degrees (1e-5 ≈ 1 m). */
function simplifyLine(line, tolerance) {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = tolerance * tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = line[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > worstDist) {
        worst = i;
        worstDist = d;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** A lighter copy of a geometry for drawing: simplified and rounded to 5 places (~1 m). */
export function simplify(geometry, tolerance = 0.00002) {
  if (!geometry) return null;
  const lines = linesOf(geometry).map((line) => simplifyLine(line, tolerance).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]));
  return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
}

/** Google encoded polyline (precision 5) for one line of [lng, lat] pairs, as the Mapbox Static Images API wants. */
export function encodePolyline(line) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of line) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    enc(la - prevLat);
    enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

// ---- Normalizing each source ------------------------------------------------

function requireFields(props, fields, source) {
  const missing = fields.filter((f) => !(f in props));
  if (missing.length) throw new Error(`${source}: expected field(s) ${missing.join(', ')} are gone. The layer's schema changed; update scripts/lib/parades.js rather than guessing.`);
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null);

/**
 * One row of the open data portal's "Mardi Gras Routes" (Socrata tkeu-9s5e).
 * Returns { record } or { skipped: reason }.
 */
export function fromOpenData(feature) {
  const p = feature.properties ?? {};
  requireFields(p, ['parade', 'date', 'time'], 'open_data');
  const name = text(p.parade);
  if (!name) return { skipped: 'no parade name' };
  if (isTestRow(name)) return { skipped: `test row "${name}"`, quiet: true };
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(p.date ?? '')?.[1];
  if (!date) return { skipped: `"${name}" has no date` };
  const clock = parseClock(p.time);
  const start = clock ? DateTime.fromISO(date, { zone: ZONE }).set(clock) : null;
  const floats = Number(p.numfloats);
  return {
    record: {
      source: 'open_data',
      name,
      date,
      start_time: start ? isoLocal(start) : null,
      // A time the city wrote but we could not read is worth hearing about; a blank one is just unknown.
      warning: !clock && text(p.time) ? `"${name}": could not read start time "${p.time}"` : null,
      geometry: cleanGeometry(feature.geometry),
      extra: {
        area: text(p.location),
        formation: text(p.formation),
        disband: text(p.disband),
        num_floats: Number.isFinite(floats) && floats > 0 ? floats : null,
      },
    },
  };
}

/** One feature of the layer behind routewise.nola.gov. */
export function fromRoutewise(feature) {
  const p = feature.properties ?? {};
  requireFields(p, ['EventName', 'StartTime'], 'routewise');
  const name = text(p.EventName);
  if (!name) return { skipped: 'no EventName' };
  if (isTestRow(name)) return { skipped: `test row "${name}"`, quiet: true };
  const start = wallClockFromEpoch(p.StartTime);
  if (!start) return { skipped: `"${name}" has no StartTime` };
  // EndTime is usually a placeholder (midnight, or a date in another year); only keep one that could be real.
  const end = wallClockFromEpoch(p.EndTime);
  const endOk = end && end > start && end.diff(start, 'hours').hours <= 18;
  const flag = (v) => (v === 1 ? true : v === 0 ? false : null);
  const amenities = {};
  for (const [field, key] of Object.entries(AMENITIES)) amenities[key] = flag(p[field]);
  // A midnight StartTime is a date with no time attached.
  const hasTime = start.hour !== 0 || start.minute !== 0;
  return {
    record: {
      source: 'routewise',
      name,
      date: start.toISODate(),
      start_time: hasTime ? isoLocal(start) : null,
      end_time: endOk ? isoLocal(end) : null,
      geometry: cleanGeometry(feature.geometry),
      extra: {
        ...amenities,
        gps_tracked: p.notrac === 0 ? true : p.notrac === 1 ? false : null,
        official_link: /^https:\/\/([a-z0-9-]+\.)*nola\.gov\//.test(p.link ?? '') ? p.link : null,
      },
    },
  };
}

// ---- Merging ----------------------------------------------------------------

const newer = (a, b) => (a && b ? a > b : Boolean(a));

/**
 * Combine normalized records from every source into features. Records for the
 * same krewe in the same season become one feature: the route comes from the
 * open data portal when it has one, the time from whichever source was edited
 * most recently, and amenity flags from Routewise.
 *
 * `sources` is { open_data: { retrieved_at, last_modified }, … }.
 */
export function buildFeatures(records, { krewes = [], sources }) {
  const index = krewesIndex(krewes);
  const groups = new Map();
  const conflicts = [];
  const bySlug = new Map(krewes.map((k) => [k.slug, k]));
  for (const r of records) {
    const krewe = r.source === 'organizer' ? (bySlug.get(r.slug) ?? null) : index.find(r.organizer ?? r.name);
    const slug = krewe?.slug ?? r.slug ?? slugify(r.name);
    if (!slug) continue;
    const season = r.date.slice(0, 4);
    const category = r.source === 'permits' ? (krewe?.category ?? r.category) : r.source === 'organizer' ? (krewe?.category ?? 'other') : categoryFor(r.name, krewe, 'mardi_gras');
    // A krewe rolls once a season, so a rescheduled parade replaces itself. Anything else is keyed by day.
    const id = category === 'mardi_gras' ? `${slug}-${season}` : `${slug}-${r.date}`;
    if (!groups.has(id)) groups.set(id, { id, slug, krewe, category, records: [] });
    groups.get(id).records.push(r);
  }

  const features = [];
  for (const g of groups.values()) {
    const bySource = (s) => g.records.find((r) => r.source === s);
    const od = bySource('open_data');
    const rw = bySource('routewise');
    // Several applications for one parade (a refiling, a correction): the fullest, then the newest.
    const pm = g.records
      .filter((r) => r.source === 'permits')
      .sort((a, b) => Boolean(b.geometry) - Boolean(a.geometry) || Boolean(b.route_text) - Boolean(a.route_text) || (b.filed ?? '').localeCompare(a.filed ?? ''))[0];
    // A date the organizer announced stands in only until the city has a record of the parade.
    if (!od && !rw && !pm) {
      const org = bySource('organizer');
      if (org) features.push(organizerFeature(g, org));
      continue;
    }
    const preferRoutewiseTime = rw && (!od || newer(sources.routewise?.last_modified, sources.open_data?.last_modified));
    const timeRec = (preferRoutewiseTime ? [rw, od, pm] : [od, rw, pm]).find((r) => r?.start_time) ?? od ?? rw ?? pm;
    const geomRec = [od, rw, pm].find((r) => r?.geometry) ?? null;
    const primary = geomRec ?? timeRec;

    if (od && rw) {
      if (od.date !== rw.date) conflicts.push(`${g.id}: open data says ${od.date}, Routewise says ${rw.date}; using ${timeRec.date}`);
      else if (od.start_time && rw.start_time && od.start_time !== rw.start_time) {
        conflicts.push(`${g.id}: open data says ${od.start_time.slice(11, 16)}, Routewise says ${rw.start_time.slice(11, 16)}; using ${timeRec.start_time.slice(11, 16)}`);
      }
    }

    const used = [...new Set([primary, timeRec, od, rw, pm].filter(Boolean).map((r) => r.source))];
    const traced = geomRec?.source === 'permits';
    const sourceUrl = (r) => (r.source === 'permits' ? SOURCES.permits.recordUrl(r.permit_number) : SOURCES[r.source].url);
    const modified = used.map((s) => sources[s]?.last_modified).filter(Boolean).sort().pop() ?? null;
    features.push({
      type: 'Feature',
      id: g.id,
      geometry: geomRec?.geometry ?? null,
      properties: {
        id: g.id,
        // `name` is the city's own label for the event; `krewe` is the organization that puts it on.
        name: primary.name,
        krewe: g.krewe?.name ?? pm?.organizer ?? null,
        krewe_slug: g.slug,
        category: g.category,
        // Both sources are City of New Orleans layers, which only cover Orleans Parish.
        jurisdiction: 'orleans_parish',
        date: timeRec.date,
        start_time: timeRec.start_time ?? null,
        end_time: rw?.end_time ?? (timeRec === pm ? pm.end_time : null) ?? null,
        source_url: sourceUrl(primary),
        source_layer: SOURCES[primary.source].layer,
        sources: [...used.map((s) => sourceUrl(g.records.find((r) => r.source === s))), ...(traced ? [SOURCES.centerlines.url] : [])],
        field_sources: {
          geometry: geomRec?.source ?? null,
          schedule: timeRec.source,
          ...(od ? { route_description: 'open_data' } : pm?.route_text ? { route_description: 'permits' } : {}),
          ...(rw ? { amenities: 'routewise' } : {}),
        },
        retrieved_at: sources[primary.source]?.retrieved_at ?? null,
        last_modified: modified,
        ...(od?.extra ?? { area: null, formation: null, disband: null, num_floats: null }),
        ...(rw?.extra ?? {}),
        // From the permit application, when there is one. The route line is drawn from route_text
        // along the city's street centerlines; route_notes says where the text left something out.
        start_address: pm?.start_address ?? null,
        start_point: pm?.start_point ?? null,
        formation_time: pm?.formation_time ?? null,
        route_text: pm?.route_text ?? null,
        route_traced: traced,
        route_notes: traced ? (pm.route_notes ?? []) : [],
        route_problem: !geomRec && pm?.route_text ? (pm.route_problem ?? null) : null,
        trace_version: pm?.route_text ? TRACE_VERSION : null,
        permit_number: pm?.permit_number ?? null,
        permit_status: pm?.permit_status ?? null,
        permit_filed: pm?.filed ?? null,
      },
    });
  }
  features.sort((a, b) => (a.properties.start_time ?? a.properties.date).localeCompare(b.properties.start_time ?? b.properties.date) || a.id.localeCompare(b.id));
  return { features, conflicts };
}

/** A parade the city has no record of yet, from the date and time its organizer published. Never a route. */
function organizerFeature(g, r) {
  return {
    type: 'Feature',
    id: g.id,
    geometry: null,
    properties: {
      id: g.id,
      name: r.name,
      krewe: g.krewe?.name ?? null,
      krewe_slug: g.slug,
      category: g.category,
      jurisdiction: 'orleans_parish',
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      source_url: r.source_url,
      source_layer: SOURCES.organizer.layer,
      sources: [r.source_url],
      field_sources: { geometry: null, schedule: 'organizer' },
      retrieved_at: r.checked,
      last_modified: null,
      area: null,
      formation: null,
      disband: null,
      num_floats: null,
      start_address: null,
      start_point: null,
      formation_time: null,
      route_text: null,
      route_traced: false,
      route_notes: [],
      route_problem: null,
      trace_version: null,
      permit_number: null,
      permit_status: null,
      permit_filed: null,
    },
  };
}

const REQUIRED = ['id', 'name', 'krewe_slug', 'category', 'jurisdiction', 'date', 'source_url', 'source_layer', 'retrieved_at'];
// nola.gov, or the city's own ArcGIS Online organization (the one Routewise is served from).
const OFFICIAL_HOSTS = /^https:\/\/(([a-z0-9-]+\.)*nola\.gov\/|services\.arcgis\.com\/VhMjCzR3cIjEkh7L\/)/;

/** Problems that make a feature unpublishable. An empty array means it is fine. */
export function checkFeature(f) {
  const p = f.properties ?? {};
  const problems = [];
  for (const key of REQUIRED) if (p[key] == null || p[key] === '') problems.push(`missing ${key}`);
  if (p.category && !CATEGORIES.includes(p.category)) problems.push(`unknown category "${p.category}"`);
  if (p.jurisdiction && !JURISDICTIONS.includes(p.jurisdiction)) problems.push(`unknown jurisdiction "${p.jurisdiction}"`);
  if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) problems.push(`bad date "${p.date}"`);
  for (const key of ['start_time', 'end_time']) {
    if (p[key] != null && !DateTime.fromISO(p[key], { setZone: true }).isValid) problems.push(`bad ${key} "${p[key]}"`);
  }
  if (p.start_time && p.date && !p.start_time.startsWith(p.date)) problems.push('start_time is not on date');
  if (p.field_sources?.schedule === 'organizer') {
    // The organizer's own announcement: a date and time from its website, and nothing else.
    for (const url of [p.source_url, ...(p.sources ?? [])]) if (url && !/^https:\/\//.test(url)) problems.push(`source "${url}" is not an https address`);
    if (f.geometry != null || p.route_text || p.start_point) problems.push('an organizer announcement carries no route or start point');
  } else {
    for (const url of [p.source_url, ...(p.sources ?? [])]) {
      if (url && !OFFICIAL_HOSTS.test(url)) problems.push(`source "${url}" is not a City of New Orleans address`);
    }
  }
  if (f.geometry != null && !['LineString', 'MultiLineString'].includes(f.geometry.type)) problems.push(`geometry is a ${f.geometry.type}`);
  if (p.route_traced && !p.route_text) problems.push('traced route has no official route text behind it');
  return problems;
}

/**
 * Fold a fresh pull into what was already on disk. Features the city no longer
 * serves are kept as they were (they still trace to an official response, dated
 * by their retrieved_at); features it still serves are replaced. `first_seen`
 * records when each one first appeared, which is how lead time gets measured.
 */
export function mergeWithPrevious(fresh, previous, today) {
  const old = new Map((previous ?? []).map((f) => [f.properties.id, f]));
  const out = new Map();
  for (const f of fresh) {
    const before = old.get(f.properties.id);
    f.properties.first_seen = before?.properties.first_seen ?? today;
    if (before && sameIgnoringFetchTime(before, f)) out.set(f.properties.id, before);
    else out.set(f.properties.id, f);
    old.delete(f.properties.id);
  }
  for (const [id, f] of old) out.set(id, f);
  return [...out.values()].sort(
    (a, b) => (a.properties.start_time ?? a.properties.date).localeCompare(b.properties.start_time ?? b.properties.date) || a.properties.id.localeCompare(b.properties.id),
  );
}

function sameIgnoringFetchTime(a, b) {
  const strip = (f) => JSON.stringify({ g: f.geometry, p: { ...f.properties, retrieved_at: null } });
  return strip(a) === strip(b);
}

// ---- Reading the result (site build) ---------------------------------------

export function loadParades() {
  const collection = readJSON(PARADES_FILE, { type: 'FeatureCollection', features: [] });
  return collection.features ?? [];
}

export function loadKrewes() {
  return readJSON(KREWES_FILE, []);
}

/**
 * Parades the city has no record of yet, as their organizers announce them on their own websites
 * (data/parades/announced.json). Dates and times only, never a route. Each entry's `source_url` has
 * to be on the organization's own site as listed in websites.json, and `checked` says when someone
 * last read it there. The city's record replaces an entry as soon as one appears.
 */
export function loadAnnounced({ entries = readJSON(ANNOUNCED_FILE, []), websites = loadWebsites(), krewes = loadKrewes() } = {}) {
  const known = new Set(krewes.map((k) => k.slug));
  const clock = (date, hhmm, key, slug) => {
    if (hhmm == null) return null;
    if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new Error(`announced.json: ${slug} ${key} must be HH:MM, got "${hhmm}"`);
    return DateTime.fromISO(`${date}T${hhmm}`, { zone: ZONE }).toISO({ suppressMilliseconds: true });
  };
  return entries.map((e) => {
    const slug = e.krewe_slug;
    if (!known.has(slug)) throw new Error(`announced.json: "${slug}" is not in krewes.json`);
    const site = websites[slug];
    if (!site) throw new Error(`announced.json: ${slug} has no confirmed website in websites.json`);
    if (!e.source_url?.startsWith('https://') || new URL(e.source_url).hostname !== new URL(site).hostname) {
      throw new Error(`announced.json: ${slug} source_url must be on its own site (${new URL(site).hostname}), got "${e.source_url}"`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') || !DateTime.fromISO(e.date).isValid) throw new Error(`announced.json: ${slug} has a bad date "${e.date}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.checked ?? '')) throw new Error(`announced.json: ${slug} needs "checked" (the date someone read the site)`);
    if (!e.name) throw new Error(`announced.json: ${slug} needs a name`);
    return {
      source: 'organizer',
      name: e.name,
      slug,
      date: e.date,
      start_time: clock(e.date, e.start_time, 'start_time', slug),
      end_time: clock(e.date, e.end_time, 'end_time', slug),
      source_url: e.source_url,
      checked: e.checked,
    };
  });
}

/** Each organization's own website, by slug. Hand-kept: a link out, never a source of parade data. */
export function loadWebsites() {
  const sites = readJSON(WEBSITES_FILE, {});
  for (const [slug, href] of Object.entries(sites)) {
    if (!/^https:\/\/[^\s]+$/.test(href)) throw new Error(`websites.json: ${slug} needs an https address, got "${href}"`);
  }
  return sites;
}

/**
 * Photos of each organization's parades, by slug, best first. Hand-kept, and never a source of parade
 * data. Every photo is someone else's work under a free license, so each one has to say whose it is.
 */
export function loadPhotos() {
  const photos = readJSON(PHOTOS_FILE, {});
  for (const [slug, list] of Object.entries(photos)) {
    const bad = (why) => {
      throw new Error(`photos.json: ${slug}: ${why}`);
    };
    if (!Array.isArray(list) || !list.length || list.length > MAX_PHOTOS) bad(`needs one to ${MAX_PHOTOS} photos`);
    for (const photo of list) {
      if (!/^[a-z0-9-]+\.jpg$/.test(photo.file ?? '')) bad(`"${photo.file}" is not a .jpg file name`);
      for (const f of [photo.file, photo.file.replace(/\.jpg$/, '-600.jpg')]) {
        if (!fs.existsSync(path.join(PHOTOS_DIR, f))) bad(`public/images/parades/${f} not found`);
      }
      if (!(photo.width > 0 && photo.height > 0)) bad(`${photo.file} needs width and height`);
      if (!photo.alt) bad(`${photo.file} needs alt text`);
      const c = photo.credit ?? {};
      if (!c.author || !c.license) bad(`${photo.file} needs credit.author and credit.license`);
      for (const key of ['licenseUrl', 'source']) {
        if (!/^https:\/\//.test(c[key] ?? '')) bad(`${photo.file} credit.${key} must be an https address`);
      }
      for (const key of Object.keys(c)) {
        if (!['author', 'license', 'licenseUrl', 'source', 'via'].includes(key)) bad(`${photo.file} has an unknown credit field "${key}"`);
      }
    }
  }
  return photos;
}

/** What to call a parade on the site: the krewe's name when registered, else the city's label. */
export function displayName(properties) {
  return properties.krewe ?? properties.name;
}

/**
 * The street a parade starts on, from the city's start address: "3301 Higgins Blvd (Thrive 9th Ward)"
 * becomes "Higgins Blvd". The house number and any place name are dropped; corners are kept.
 */
export function startStreet(address) {
  if (!address) return null;
  const street = String(address)
    .replace(/\([^)]*\)?/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .split(/\s+(?:and|&)\s+/i)
    .map((part) =>
      part
        .trim()
        .replace(/^\d+[A-Za-z]?\s+/, '')
        .replace(/\s+\d+$/, '')
        .replace(/[.,\s]+$/, '')
        .replace(/\b[a-z][a-z']*\b/g, (w) => w[0].toUpperCase() + w.slice(1)),
    )
    .filter((part) => /[A-Za-z]/.test(part))
    .join(' and ');
  return street || null;
}

/**
 * Parades grouped by the organization that puts them on, for the site's pages:
 * one page per krewe or club, holding every parade of theirs the city has listed.
 */
export function paradeOrgs(features, today, { websites = {}, photos = {} } = {}) {
  const orgs = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!orgs.has(p.krewe_slug)) orgs.set(p.krewe_slug, { slug: p.krewe_slug, parades: [] });
    orgs.get(p.krewe_slug).parades.push(f);
  }
  const out = [];
  for (const org of orgs.values()) {
    org.parades.sort((a, b) => a.properties.date.localeCompare(b.properties.date));
    org.upcoming = org.parades.filter((f) => f.properties.date >= today);
    org.past = org.parades.filter((f) => f.properties.date < today).reverse();
    // Named and categorized by the parade people are most likely here for: the next one, else the latest.
    // A date the organizer announced has no map of its own; show the latest one the city mapped instead.
    const placed = (f) => f && (f.geometry || f.properties.start_point);
    org.featured = placed(org.upcoming[0]) || !org.upcoming.length ? (org.upcoming[0] ?? org.past[0]) : (org.past.find(placed) ?? org.upcoming[0]);
    org.name = displayName(org.featured.properties);
    org.category = org.featured.properties.category;
    org.website = websites[org.slug] ?? null;
    org.photos = photos[org.slug] ?? [];
    out.push(org);
  }
  // Soonest upcoming first. The rest: those with photos, then with a route, then neither; each by most recent.
  const tier = (o) => (o.photos.length ? 0 : o.featured.geometry ? 1 : 2);
  return out.sort((a, b) => {
    const [na, nb] = [a.upcoming[0]?.properties.date, b.upcoming[0]?.properties.date];
    if (na && nb) return na.localeCompare(nb) || a.name.localeCompare(b.name);
    if (na || nb) return na ? -1 : 1;
    return tier(a) - tier(b) || b.past[0].properties.date.localeCompare(a.past[0].properties.date) || a.name.localeCompare(b.name);
  });
}

/** The compact record the home map draws: one per parade, with a lighter line. */
export function mapParade(f) {
  const p = f.properties;
  const item = { id: p.id, slug: p.krewe_slug, n: displayName(p), c: p.category, d: p.date };
  if (p.start_time) item.s = p.start_time;
  if (p.end_time) item.e = p.end_time;
  if (f.geometry) item.g = simplify(f.geometry);
  if (p.start_point) item.p = p.start_point;
  else if (f.geometry) item.p = linesOf(item.g)[0][0];
  const street = startStreet(p.start_address);
  if (street) item.a = street;
  return item;
}
