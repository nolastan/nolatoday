#!/usr/bin/env node
/**
 * Look up Ticketmaster Discovery venue ids for the "ticketmaster" adapter.
 *
 *   TICKETMASTER_API_KEY=… node scripts/ticketmaster-venues.js "Poor Boys"
 */
import { ticketmasterAPI } from '../scrapers/ticketmaster.js';

const keyword = process.argv.slice(2).join(' ');
if (!keyword) {
  console.error('Usage: node scripts/ticketmaster-venues.js <venue name>');
  process.exit(1);
}

const data = await ticketmasterAPI('venues.json', { keyword, stateCode: 'LA', size: 50 });
const venues = data._embedded?.venues ?? [];
for (const v of venues) {
  console.log(`${v.id.padEnd(16)} ${v.name} — ${v.address?.line1 ?? '?'}, ${v.city?.name ?? '?'}  (${v.upcomingEvents?._total ?? 0} upcoming)`);
}
if (!venues.length) console.log(`No Louisiana venues match "${keyword}".`);
