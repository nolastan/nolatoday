import { fetchJSON } from '../scripts/lib/http.js';

/**
 * Ticketmaster / Live Nation venues, via the Discovery API. Needs the
 * TICKETMASTER_API_KEY environment variable (an Actions secret in CI).
 *
 * The venue id is the Discovery id ("KovZ…"), the same one livenation.com
 * venue URLs use (/venue/<id>/…). For other venues, find it with
 *   node scripts/ticketmaster-venues.js <name>
 *
 * source: { type: "ticketmaster", venueId: "KovZ917ALJx" }
 */
const API = 'https://app.ticketmaster.com/discovery/v2';

// Default limit is 5 requests/second; keep well under it when venues run concurrently.
const MIN_INTERVAL_MS = 300;
let nextSlot = 0;

export async function ticketmasterAPI(path, params) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error('TICKETMASTER_API_KEY is not set; the ticketmaster adapter needs a Discovery API key');
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Date.now() + wait + MIN_INTERVAL_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));

  const url = `${API}/${path}?${new URLSearchParams({ ...params, apikey: key })}`;
  try {
    return await fetchJSON(url);
  } catch (err) {
    // Errors end up in status.json and public repair issues; never leak the key.
    throw new Error(String(err?.message ?? err).replaceAll(key, '***'));
  }
}

export default async function scrapeTicketmaster(source, { window } = {}) {
  if (!source.venueId) throw new Error('ticketmaster source needs a "venueId"');
  const utc = (dt) => dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
  const data = await ticketmasterAPI('events.json', {
    venueId: source.venueId,
    size: 200,
    sort: 'date,asc',
    ...(window && { startDateTime: utc(window.from), endDateTime: utc(window.to) }),
  });
  return parseTicketmaster(data);
}

// Parking passes, VIP packages and similar add-ons are listed as separate events.
const ADD_ON = /\bparking\b|\bvip (package|upgrade|experience)s?\b/i;

export function parseTicketmaster(data) {
  return (data._embedded?.events ?? [])
    .filter((e) => e.dates?.status?.code !== 'cancelled' && e.dates?.status?.code !== 'canceled')
    .filter((e) => !ADD_ON.test(e.name) && !e.classifications?.some((c) => /upsell|add-on/i.test(c.type?.name ?? '')))
    .map((e) => {
      const s = e.dates?.start ?? {};
      if (s.dateTBD || s.dateTBA || !(s.localDate || s.dateTime)) return null;
      // localDate/localTime are New Orleans time; dateTime is the same moment in UTC.
      const allDay = s.timeTBA || s.noSpecificTime || (!s.localTime && !s.dateTime);
      let start;
      if (allDay) start = s.localDate;
      else if (s.localDate && s.localTime) start = `${s.localDate}T${s.localTime}`;
      else start = s.dateTime;
      return { uid: `ticketmaster-${e.id}`, title: e.name, start, allDay: Boolean(allDay), url: e.url };
    })
    .filter(Boolean);
}
