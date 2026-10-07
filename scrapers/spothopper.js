import { fetchJSON } from '../scripts/lib/http.js';

/**
 * SpotHopper restaurant/bar sites (static.spotapps.co) load events from a
 * public JSON API. Find the spot id in the site's HTML ("spot_id=12345").
 *
 * source: { type: "spothopper", spotId: 83161, url?: "venue events page for links" }
 */
export default async function scrapeSpotHopper(source) {
  const data = await fetchJSON(`https://www.spothopperapp.com/api/spots/${source.spotId}/events`);
  return parseSpotHopper(data, source);
}

export function parseSpotHopper(data, source = {}) {
  return (data.events ?? [])
    .filter((e) => e.show_on_website !== false && !e.is_template)
    .map((e) => {
      const day = e.event_date.slice(0, 10);
      const allDay = e.all_day || !e.start_time;
      const start = allDay ? day : `${day}T${e.start_time}`;
      return {
        uid: `spothopper-${e.id}`,
        title: e.name,
        start,
        allDay,
        durationMinutes: e.duration_minutes || undefined,
        url: source.url,
        description: e.text,
      };
    });
}
