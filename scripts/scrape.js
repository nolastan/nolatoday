#!/usr/bin/env node
/**
 * Scrape every venue's configured sources and write data/events/<slug>.json
 * plus data/status.json (health of each scraper, used to open repair issues).
 *
 *   node scripts/scrape.js                     # all venues
 *   node scripts/scrape.js --venue gasa-gasa   # one or more (comma-separated)
 *   node scripts/scrape.js --venue gasa-gasa --dry      # print, don't write
 *   node scripts/scrape.js --try '{"type":"ics","url":"…"}'   # test a source config
 *   node scripts/scrape.js --venue a,b --dry --strict          # exit 1 if any fail or find nothing (CI)
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runSource } from '../scrapers/index.js';
import { normalizeEvents } from './lib/normalize.js';
import { loadVenues, loadEvents, loadStatus, writeJSON, EVENTS_DIR, STATUS_FILE } from './lib/data.js';
import { now, iso } from './lib/time.js';

const SOURCE_TIMEOUT_MS = 120_000;
const CONCURRENCY = 6;

const { values: args } = parseArgs({
  options: {
    venue: { type: 'string' },
    dry: { type: 'boolean', default: false },
    try: { type: 'string' },
    verbose: { type: 'boolean', short: 'v', default: false },
    strict: { type: 'boolean', default: false },
  },
});

function window_() {
  return { from: now().startOf('day'), to: now().plus({ days: 90 }) };
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function scrapeVenue(venue, { window = window_() } = {}) {
  const results = [];
  for (const source of venue.sources ?? []) {
    const label = `${venue.slug} [${source.type}${source.name ? ':' + source.name : ''}]`;
    try {
      const raw = await withTimeout(runSource(source, { venue, window }), SOURCE_TIMEOUT_MS, label);
      if (!Array.isArray(raw)) throw new Error('Scraper did not return an array');
      const events = normalizeEvents(raw, { venue: venue.slug, source, window });
      results.push({ source, ok: true, raw: raw.length, events });
    } catch (err) {
      results.push({ source, ok: false, error: err?.message ?? String(err) });
    }
  }
  return results;
}

async function pool(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function mergeEvents(lists) {
  const byId = new Map();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

async function main() {
  if (args.try) {
    const source = JSON.parse(args.try);
    const venue = { slug: 'try', name: 'Test', sources: [source] };
    const [result] = await scrapeVenue(venue);
    if (!result.ok) {
      console.error('ERROR:', result.error);
      process.exit(1);
    }
    for (const e of result.events) console.log(`${e.start}  ${e.title}${e.url ? '  ' + e.url : ''}`);
    console.log(`\n${result.events.length} events (${result.raw} raw)`);
    return;
  }

  const only = args.venue ? new Set(args.venue.split(',')) : null;
  const venues = loadVenues().filter(
    (v) => (only ? only.has(v.slug) : v.status === 'active') && (v.sources?.length ?? 0) > 0,
  );
  if (only && venues.length === 0) {
    console.log(`No venues with sources match ${args.venue}; nothing to scrape.`);
    return;
  }

  const status = loadStatus();
  const runAt = iso(now());
  const window = window_();
  let ok = 0;
  let failed = 0;
  let empty = 0;

  await pool(venues, CONCURRENCY, async (venue) => {
    const results = await scrapeVenue(venue, { window });
    const succeeded = results.filter((r) => r.ok);
    const errors = results.filter((r) => !r.ok).map((r) => `${r.source.type}: ${r.error}`);
    const previous = loadEvents(venue.slug).events.filter((e) => (e.end ?? e.start) >= window.from.toISODate());

    // If every source failed, keep the last good data so the site doesn't go blank.
    const events = succeeded.length ? mergeEvents(succeeded.map((r) => r.events)) : previous;
    const prev = status.venues[venue.slug] ?? {};
    const entry = {
      ok: errors.length === 0,
      firstSeen: prev.firstSeen ?? runAt,
      count: succeeded.length ? events.length : prev.count ?? 0,
      lastRun: runAt,
      lastSuccess: errors.length === 0 ? runAt : prev.lastSuccess ?? null,
      lastNonEmpty: succeeded.length && events.length ? runAt : prev.lastNonEmpty ?? null,
      consecutiveFailures: errors.length ? (prev.consecutiveFailures ?? 0) + 1 : 0,
      sources: results.map((r) => ({ type: r.source.type, ok: r.ok, count: r.ok ? r.events.length : undefined, error: r.error })),
    };
    if (errors.length) entry.error = errors.join(' | ');
    status.venues[venue.slug] = entry;

    if (errors.length) failed++;
    else ok++;
    if (!errors.length && !events.length) empty++;
    const tag = errors.length ? 'FAIL' : events.length ? ' ok ' : 'EMPTY';
    console.log(`${tag} ${venue.slug.padEnd(32)} ${String(events.length).padStart(4)} events${errors.length ? '  ' + errors.join(' | ') : ''}`);
    if (args.verbose || args.dry) for (const e of events) console.log(`       ${e.start}  ${e.title}`);

    if (!args.dry) {
      const file = path.join(EVENTS_DIR, `${venue.slug}.json`);
      writeJSON(file, { venue: venue.slug, events });
    }
  });

  if (!args.dry) {
    status.generatedAt = runAt;
    status.venues = Object.fromEntries(Object.entries(status.venues).sort(([a], [b]) => a.localeCompare(b)));
    writeJSON(STATUS_FILE, status);
  }
  console.log(`\n${ok} ok, ${failed} failed, ${venues.length} venues scraped`);
  if (args.strict && (failed || empty)) {
    console.error(`--strict: ${failed} failed, ${empty} returned no events`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
