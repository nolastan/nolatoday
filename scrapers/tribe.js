import { fetchJSON } from '../scripts/lib/http.js';
import { now } from '../scripts/lib/time.js';

/**
 * WordPress sites running "The Events Calendar" (Modern Tribe) expose a REST
 * API at /wp-json/tribe/events/v1/events.
 *
 * source: { type: "tribe", url: "https://example.com", categories?: "live-music", venue?: 123 }
 */
export default async function scrapeTribe(source, { window } = {}) {
  const base = source.url.replace(/\/+$/, '');
  const start = (window?.from ?? now().startOf('day')).toFormat('yyyy-MM-dd HH:mm:ss');
  const end = (window?.to ?? now().plus({ days: 90 })).toFormat('yyyy-MM-dd HH:mm:ss');
  const params = new URLSearchParams({ per_page: '50', start_date: start, end_date: end });
  if (source.categories) params.set('categories', source.categories);
  if (source.venue) params.set('venue', String(source.venue));
  let url = `${base}/wp-json/tribe/events/v1/events?${params}`;
  const events = [];
  for (let page = 0; url && page < 10; page++) {
    const data = await fetchJSON(url);
    for (const e of data.events ?? []) events.push(fromTribe(e));
    url = data.next_rest_url;
  }
  return events;
}

export function fromTribe(e) {
  const allDay = Boolean(e.all_day);
  return {
    uid: String(e.id),
    title: e.title,
    // utc_start_date is "YYYY-MM-DD HH:MM:SS" in UTC.
    start: allDay ? e.start_date.slice(0, 10) : e.utc_start_date.replace(' ', 'T') + 'Z',
    end: allDay || !e.utc_end_date ? null : e.utc_end_date.replace(' ', 'T') + 'Z',
    allDay,
    url: e.url,
    description: e.excerpt || e.description,
    image: e.image?.url,
  };
}
