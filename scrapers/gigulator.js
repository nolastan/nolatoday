import * as cheerio from 'cheerio';
import { fetchText } from '../scripts/lib/http.js';
import { parseLooseDate } from '../scripts/lib/dates.js';

/**
 * Bill's Gigulator (billsgigulator.com) calendar widgets, used by several
 * Frenchmen Street clubs on Squarespace. The site id appears in the widget
 * script URL: publish.billsgigulator.com/app/sqs/<id>/…
 *
 * source: { type: "gigulator", site: 1048, url?: "venue calendar page for links" }
 */
export default async function scrapeGigulator(source) {
  const html = await fetchText(`https://publish.billsgigulator.com/shows.html?site=${source.site}&hdr=0&unit=d&lim=90`);
  return parseGigulator(html, source);
}

export function parseGigulator(html, source = {}) {
  const $ = cheerio.load(html);
  const events = [];
  let currentDate = '';
  $('.bgig-gig').each((_, el) => {
    const date = $(el).find('.bgig-date').text().trim();
    if (date) currentDate = date;
    const names = $(el)
      .find('.bgig-event, .bgig-proj-name')
      .map((_, n) => $(n).text().trim())
      .get()
      .filter(Boolean);
    const title = [...new Set(names)].join(' — ');
    const time = $(el).find('.bgig-time-show').text().trim() || $(el).find('.bgig-time').text().trim();
    const parsed = parseLooseDate(currentDate, time);
    if (!title || !parsed) return;
    const ticket = $(el).find('.bgig-ticket a').attr('href');
    events.push({
      title,
      start: parsed.allDay ? parsed.start.toISODate() : parsed.start,
      allDay: parsed.allDay,
      url: ticket || source.url,
    });
  });
  return events;
}
