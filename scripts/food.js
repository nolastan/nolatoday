#!/usr/bin/env node
/**
 * Scrape the host calendars in data/food/sources.json for food pop-ups and write
 * data/food/scraped/<place>.json. A source that fails keeps its last good file.
 *
 *   node scripts/food.js          # all sources
 *   node scripts/food.js --dry    # print, write nothing
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runSource } from '../scrapers/index.js';
import { writeJSON } from './lib/data.js';
import { now, iso } from './lib/time.js';
import { SCRAPED_DIR, loadFoodSources, foodFromCalendar } from './lib/food.js';

const { values: args } = parseArgs({ options: { dry: { type: 'boolean', default: false } } });

async function main() {
  const window = { from: now().startOf('day'), to: now().plus({ days: 60 }) };
  let failed = 0;
  for (const config of loadFoodSources()) {
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

main();
