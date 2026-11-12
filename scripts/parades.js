#!/usr/bin/env node
/**
 * Pull parade routes and schedules from the City of New Orleans' official
 * sources and write data/parades/parades.geojson.
 *
 *   node scripts/parades.js            # fetch, normalize, write
 *   node scripts/parades.js --dry      # fetch and print, write nothing
 *   node scripts/parades.js --no-cache # ignore responses cached in the last hour
 *
 * Three City of New Orleans sources: the Mardi Gras Routes layer on the open
 * data portal, the layer behind Routewise, and special event permit applications
 * (second lines, walking krewes and other public parades). A permit's written
 * route is drawn along the city's street centerlines by scripts/lib/route-trace.js.
 *
 * Official sources only. If a source fails or its schema changes the run stops
 * without touching the file; it never fills a gap from anywhere else. Carnival
 * rows the city published without a name or date are left out and the run exits
 * 1. A written route that cannot be traced is published without a line.
 *
 * The permit feed is mostly private events (weddings, parties). Those are never
 * written anywhere but the local response cache, and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { ROOT, readJSON, writeJSON } from './lib/data.js';
import { ZONE } from './lib/time.js';
import { SOURCES, PARADES_FILE, TRACE_VERSION, loadKrewes, fromOpenData, fromRoutewise, buildFeatures, checkFeature, mergeWithPrevious, displayName } from './lib/parades.js';
import { fromPermit, traceRouteText } from './lib/permits.js';
import { buildNetwork } from './lib/route-trace.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const USE_CACHE = !args.has('--no-cache');
const CACHE_DIR = path.join(ROOT, '.cache', 'parades');
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
// Streets change rarely, and the layer is fifteen requests.
const CENTERLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Permit applications are read from this far back, so last season's parades stay current while they are still in the feed.
const PERMIT_MONTHS = 18;
// Says who is asking, so the city's GIS staff can reach the project if the polling is a problem.
const USER_AGENT = 'nolatoday-parades/1.0 (+https://nola.today; https://github.com/nolastan/nolatoday)';

let lastRequest = 0;
async function getJSON(url, maxAge = CACHE_MAX_AGE_MS) {
  const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if (USE_CACHE && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAge) {
    return { json: JSON.parse(fs.readFileSync(file, 'utf8')), retrieved_at: new Date(fs.statSync(file).mtimeMs).toISOString() };
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    // At most one request a second, to anyone.
    const wait = lastRequest + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      // ArcGIS reports failures as HTTP 200 with an error body.
      if (json?.error) throw new Error(`service error ${json.error.code}: ${json.error.message}`);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(json));
      return { json, retrieved_at: new Date().toISOString() };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError.message}`);
}

function featuresOf(json, source) {
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error(`${source}: response is not a GeoJSON FeatureCollection`);
  return json.features;
}

async function fetchOpenData() {
  const s = SOURCES.open_data;
  const meta = await getJSON(s.metaUrl);
  const data = await getJSON(s.dataUrl);
  const updated = meta.json.rowsUpdatedAt;
  return {
    features: featuresOf(data.json, s.id),
    retrieved_at: data.retrieved_at,
    last_modified: updated ? new Date(updated * 1000).toISOString() : null,
  };
}

async function fetchRoutewise() {
  const s = SOURCES.routewise;
  const meta = await getJSON(s.metaUrl);
  const pageSize = Math.min(meta.json.maxRecordCount ?? 1000, 1000);
  const features = [];
  let retrieved_at;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${s.dataUrl}/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${pageSize}&f=geojson`;
    const page = await getJSON(url);
    retrieved_at ??= page.retrieved_at;
    const batch = featuresOf(page.json, s.id);
    features.push(...batch);
    const more = page.json.exceededTransferLimit ?? page.json.properties?.exceededTransferLimit;
    if (!more || !batch.length) break;
    if (offset > 50 * pageSize) throw new Error('routewise: pagination did not end');
  }
  const edited = meta.json.editingInfo?.dataLastEditDate ?? meta.json.editingInfo?.lastEditDate;
  return { features, retrieved_at, last_modified: edited ? new Date(edited).toISOString() : null };
}

async function fetchPermits() {
  const s = SOURCES.permits;
  const meta = await getJSON(s.metaUrl);
  // From the start of a month, so the address is the same all month and caches.
  const since = DateTime.now().setZone(ZONE).minus({ months: PERMIT_MONTHS }).startOf('month').toISODate();
  const pageSize = 5000;
  const rows = [];
  let retrieved_at;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      $select: 'permitnumber,address,currentstatus,d_create,descr,latitude,longitude',
      $where: `type = 'Special Event - Master' AND d_create >= '${since}'`,
      $order: 'permitnumber',
      $limit: String(pageSize),
      $offset: String(offset),
    });
    const page = await getJSON(`${s.dataUrl}?${query}`);
    if (!Array.isArray(page.json)) throw new Error('permits: response is not a list of rows');
    retrieved_at ??= page.retrieved_at;
    rows.push(...page.json);
    if (page.json.length < pageSize) break;
    if (offset > 40 * pageSize) throw new Error('permits: pagination did not end');
  }
  // Socrata leaves empty fields out of a row, so check the columns across the whole pull.
  for (const field of ['permitnumber', 'currentstatus', 'd_create', 'descr']) {
    if (rows.length && !rows.some((r) => field in r)) throw new Error(`permits: expected field ${field} is gone. The dataset's schema changed; update scripts/lib/permits.js rather than guessing.`);
  }
  const updated = meta.json.rowsUpdatedAt;
  return { rows, retrieved_at, last_modified: updated ? new Date(updated * 1000).toISOString() : null };
}

/** The city's street centerlines, as a routable network. Only fetched when a route needs tracing. */
async function fetchNetwork() {
  const s = SOURCES.centerlines;
  const pageSize = 2000;
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${s.dataUrl}/query?where=1%3D1&outFields=FULLNAME,FROMLEFT,TOLEFT,FROMRIGHT,TORIGHT&outSR=4326&geometryPrecision=6&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${pageSize}&f=geojson`;
    const page = await getJSON(url, CENTERLINE_MAX_AGE_MS);
    const batch = featuresOf(page.json, s.id);
    features.push(...batch);
    const more = page.json.exceededTransferLimit ?? page.json.properties?.exceededTransferLimit;
    if (!more || !batch.length) break;
    if (offset > 100 * pageSize) throw new Error('centerlines: pagination did not end');
  }
  if (features.length < 10000 || !features.some((f) => f.properties?.FULLNAME)) throw new Error(`centerlines: got ${features.length} segments, expected the whole city. Not tracing against a partial street network.`);
  return buildNetwork(features);
}

/**
 * Give each permit record with a written route its line. A route already traced
 * from the same text by this version of the tracer is reused, so most runs never
 * ask for the centerlines at all.
 */
async function traceRoutes(records, previous) {
  const before = new Map();
  for (const f of previous) if (f.properties.permit_number && f.properties.trace_version === TRACE_VERSION) before.set(`${f.properties.permit_number}\n${f.properties.route_text}`, f);
  let net = null;
  for (const r of records) {
    if (r.source !== 'permits' || !r.route_text) continue;
    const saved = before.get(`${r.permit_number}\n${r.route_text}`);
    if (saved) {
      r.geometry = saved.properties.route_traced ? saved.geometry : null;
      r.route_notes = saved.properties.route_notes ?? [];
      r.route_problem = saved.properties.route_problem ?? null;
      continue;
    }
    net ??= await fetchNetwork();
    const traced = traceRouteText(net, r.route_text, r.start_address);
    r.geometry = traced.line ? { type: 'LineString', coordinates: traced.line.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]) } : null;
    r.route_notes = traced.notes;
    r.route_problem = traced.line ? null : traced.problems.join('; ');
  }
}

async function main() {
  const [openData, routewise, permits] = [await fetchOpenData(), await fetchRoutewise(), await fetchPermits()];
  const sources = {
    open_data: { retrieved_at: openData.retrieved_at, last_modified: openData.last_modified },
    routewise: { retrieved_at: routewise.retrieved_at, last_modified: routewise.last_modified },
    permits: { retrieved_at: permits.retrieved_at, last_modified: permits.last_modified },
  };

  const records = [];
  const refused = [];
  const warnings = [];
  for (const [rows, normalize, id] of [
    [openData.features, fromOpenData, 'open_data'],
    [routewise.features, fromRoutewise, 'routewise'],
  ]) {
    for (const row of rows) {
      const { record, skipped, quiet } = normalize(row);
      if (record) {
        records.push(record);
        if (record.warning) warnings.push(record.warning);
        delete record.warning;
      } else if (quiet) console.log(`  skip ${id}: ${skipped}`);
      else refused.push(`${id}: ${skipped}`);
    }
  }

  // Permit applications: only public parades come through. The rest are counted, never named.
  const leftOut = {};
  for (const row of permits.rows) {
    const { record, skipped } = fromPermit(row);
    if (record) records.push(record);
    else {
      const why = skipped.replace(/ ".*$/, '');
      leftOut[why] = (leftOut[why] ?? 0) + 1;
    }
  }
  const previous = readJSON(PARADES_FILE, { features: [] });
  await traceRoutes(records, previous.features ?? []);

  const { features, conflicts } = buildFeatures(records, { krewes: loadKrewes(), sources });
  const publishable = [];
  for (const f of features) {
    const problems = checkFeature(f);
    if (problems.length) refused.push(`${f.properties.id}: ${problems.join('; ')}`);
    else publishable.push(f);
  }

  const today = DateTime.now().setZone(ZONE).toISODate();
  // A parade that came only from an application the city still lists, but which no longer
  // qualifies (denied, withdrawn, rescheduled under a new date), is taken down, not kept.
  const pulled = new Set(permits.rows.map((r) => r.permitnumber));
  const fresh = new Set(publishable.map((f) => f.properties.id));
  const kept_previous = (previous.features ?? []).filter((f) => {
    const p = f.properties;
    return !(p.field_sources?.schedule === 'permits' && pulled.has(p.permit_number) && !fresh.has(p.id));
  });
  const merged = mergeWithPrevious(publishable, kept_previous, today);
  const kept = merged.length - publishable.length;

  console.log(`open data: ${openData.features.length} rows (updated ${openData.last_modified ?? 'unknown'})`);
  console.log(`routewise: ${routewise.features.length} rows (edited ${routewise.last_modified ?? 'unknown'})`);
  console.log(`permits:   ${permits.rows.length} special event applications (updated ${permits.last_modified ?? 'unknown'})`);
  for (const [why, n] of Object.entries(leftOut)) console.log(`  left out ${String(n).padStart(4)}: ${why}`);
  console.log(`→ ${publishable.length} parades from this pull${kept ? `, ${kept} kept from earlier pulls` : ''}`);
  const seasons = {};
  for (const f of merged) seasons[f.properties.date.slice(0, 4)] = (seasons[f.properties.date.slice(0, 4)] ?? 0) + 1;
  console.log(`  by year: ${Object.entries(seasons).map(([y, n]) => `${y}: ${n}`).join(', ') || 'none'}`);
  const unregistered = publishable.filter((f) => !f.properties.krewe);
  if (unregistered.length) console.log(`  not in krewes.json (using the city's name): ${unregistered.map((f) => f.properties.name).join(', ')}`);
  const noRoute = publishable.filter((f) => !f.geometry);
  if (noRoute.length) console.log(`  no route line: ${noRoute.map((f) => displayName(f.properties)).join(', ')}`);
  for (const f of publishable) {
    const p = f.properties;
    if (p.route_problem) console.log(`  could not trace ${p.id}: ${p.route_problem}`);
    else if (p.route_traced && p.route_notes.length) console.log(`  traced ${p.id} with notes: ${p.route_notes.join(' | ')}`);
  }
  for (const c of conflicts) console.log(`  sources disagree: ${c}`);
  for (const w of warnings) console.warn(`  warning: ${w}`);

  if (DRY) {
    for (const f of publishable) {
      const p = f.properties;
      console.log(`  ${p.date} ${p.start_time?.slice(11, 16) ?? '--:--'}  ${displayName(p).padEnd(34)} ${f.geometry ? f.geometry.type : 'no route'}  [${p.field_sources.geometry ?? '-'}/${p.field_sources.schedule}]`);
    }
  } else {
    const collection = {
      type: 'FeatureCollection',
      metadata: {
        description: 'Parade routes and schedules from official City of New Orleans sources. Generated by scripts/parades.js; do not edit by hand.',
        sources: Object.values(SOURCES).map((s) => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url, layer: s.layer, last_modified: sources[s.id]?.last_modified ?? null })),
      },
      features: merged,
    };
    const before = fs.existsSync(PARADES_FILE) ? fs.readFileSync(PARADES_FILE, 'utf8') : '';
    // One parade per line: small enough to commit every few hours, and a changed parade is a one-line diff.
    const { features: list, ...top } = collection;
    const after = `${JSON.stringify(top, null, 1).replace(/\n}$/, '')},\n "features": [\n${list.map((f) => JSON.stringify(f)).join(',\n')}\n ]\n}\n`;
    if (before === after) console.log('No change.');
    else {
      fs.mkdirSync(path.dirname(PARADES_FILE), { recursive: true });
      fs.writeFileSync(PARADES_FILE, after);
      console.log(`Wrote ${path.relative(ROOT, PARADES_FILE)}`);
    }
  }

  if (refused.length) {
    console.error(`\n${refused.length} row(s) left out because the official data is incomplete:`);
    for (const r of refused) console.error(`  ${r}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`parades: ${err.message}`);
  process.exit(1);
});
