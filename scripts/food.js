#!/usr/bin/env node
/**
 * Scrape the calendars in data/food/sources.json for food pop-ups and write
 * data/food/scraped/<place>.json (a host's calendar) or data/food/scraped/vendor-<slug>.json
 * (a vendor's own schedule page). A source that fails keeps its last good file.
 *
 *   node scripts/food.js          # all sources
 *   node scripts/food.js --dry    # print, write nothing
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runSource } from '../scrapers/index.js';
import { writeJSON } from './lib/data.js';
import { DateTime } from 'luxon';
import { now, iso } from './lib/time.js';
import { SCRAPED_DIR, loadFoodSources, foodFromCalendar, foodFromVendorSite } from './lib/food.js';

const { values: args } = parseArgs({ options: { dry: { type: 'boolean', default: false } } });

async function main() {
  const window = { from: now().startOf('day'), to: now().plus({ days: 60 }) };
  let failed = 0;
  for (const config of loadFoodSources()) {
    if (config.vendor) {
      failed += await vendorSite(config, window) ? 0 : 1;
      continue;
    }
    try {
      const raw = await runSource(config.source, { venue: { slug: config.place, name: config.place }, window, venues: [] });
      const events = foodFromCalendar(raw, config).filter((e) => (e.end ?? e.start) >= window.from.toISODate());
      console.log(`${config.place}: ${events.length} pop-ups (${raw.length} events in the calendar)`);
      if (args.dry) {
        for (const e of events) console.log(`  ${e.start}  ${e.vendor}  (${e.title})`);
        continue;
      }
      writeJSON(path.join(SCRAPED_DIR, `${config.place}.json`), { place: config.place, scrapedAt: iso(now()), events });
    } catch (err) {
      failed++;
      console.error(`${config.place}: ${err?.message ?? err}`);
    }
  }
  // A failed host keeps its last file; say so in the log without failing the whole scrape run.
  if (failed) console.warn(`${failed} food source(s) failed; their last scraped files were kept.`);
}

/** A vendor's own schedule page. Returns false when it failed. */
async function vendorSite(config, window) {
  try {
    const raw = await runSource(config.source, { venue: { slug: config.vendor, name: config.vendor }, window, venues: [] });
    const { events, unmapped } = foodFromVendorSite(raw, config);
    const upcoming = events.filter((e) => (e.allDay ? e.start >= window.from.toISODate() : DateTime.fromISO(e.end ?? e.start) >= window.from));
    console.log(`${config.vendor}: ${upcoming.length} upcoming stops (${raw.length} on the page)`);
    // A place we have no address for is left out rather than guessed; add it to places.json and `places`.
    for (const name of new Set(unmapped)) console.warn(`  ${config.vendor}: no place for "${name}", skipped`);
    if (args.dry) {
      for (const e of upcoming) console.log(`  ${e.start}  ${e.place}  (${e.title})`);
      return true;
    }
    writeJSON(path.join(SCRAPED_DIR, `vendor-${config.vendor}.json`), { vendor: config.vendor, scrapedAt: iso(now()), events: upcoming });
    return true;
  } catch (err) {
    console.error(`${config.vendor}: ${err?.message ?? err}`);
    return false;
  }
}

main();
