import { fetchText } from '../scripts/lib/http.js';
import { extractJSONValue } from '../scripts/lib/extract.js';

/**
 * Eventbrite organizer pages (https://www.eventbrite.com/o/<name>-<id>) embed
 * an "upcomingEvents" array in their hydration data.
 *
 * source: { type: "eventbrite", url: "https://www.eventbrite.com/o/…-123", location?: "venue name filter" }
 */
export default async function scrapeEventbrite(source) {
  const html = await fetchText(source.url);
  const events = extractJSONValue(html, 'upcomingEvents');
  if (!Array.isArray(events)) throw new Error('Could not find "upcomingEvents" on Eventbrite organizer page');
  return parseEventbrite(events, source);
}

export function parseEventbrite(events, { location } = {}) {
  return events
    .filter((e) => !e.is_cancelled && !e.is_online_event)
    .filter((e) => !location || JSON.stringify(e.primary_venue ?? e.venue ?? '').toLowerCase().includes(location.toLowerCase()))
    .map((e) => ({
      uid: `eventbrite-${e.id}`,
      title: e.name?.text ?? e.name,
      start: `${e.start_date}T${e.start_time ?? '00:00:00'}`,
      end: e.end_date && e.end_time && e.end_time !== e.start_time ? `${e.end_date}T${e.end_time}` : null,
      url: e.url,
      description: e.summary || undefined,
    }));
}
