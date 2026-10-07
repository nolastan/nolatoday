#!/usr/bin/env node
/**
 * Look up JamBase venue ids for the "jambase" adapter. Each lookup is one call
 * against the monthly quota.
 *
 *   JAMBASE_API_KEY=… node scripts/jambase-venues.js "Snug Harbor"
 */
import { jambaseAPI } from '../scrapers/jambase.js';

const venueName = process.argv.slice(2).join(' ');
if (!venueName) {
  console.error('Usage: node scripts/jambase-venues.js <venue name>');
  process.exit(1);
}

const data = await jambaseAPI('venues', { venueName, geoStateIso: 'US-LA', perPage: 50 });
const venues = data.venues ?? [];
for (const v of venues) {
  const a = v.address ?? {};
  console.log(`${v.identifier.padEnd(16)} ${v.name} — ${a.streetAddress ?? '?'}, ${a.addressLocality ?? '?'}  (${v['x-numUpcomingEvents'] ?? '?'} upcoming)  ${v.url ?? ''}`);
}
if (!venues.length) console.log(`No Louisiana venues match "${venueName}".`);
