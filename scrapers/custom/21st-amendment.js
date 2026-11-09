import * as cheerio from 'cheerio';
import { fetchText } from '../../scripts/lib/http.js';
import { parseDay } from '../../scripts/lib/dates.js';
import { now } from '../../scripts/lib/time.js';

/**
 * 21st Amendment at La Louisiane lists the month as `.day` blocks: a
 * "<strong>Sunday, 11/1</strong>" heading and one `<li>` per set, written as an
 * hour range with no am/pm ("3-7 Coyote Anderson Organ Trio", "8-12 Big Mike…").
 * The bar opens in the afternoon, so every start hour from 1 to 11 is PM.
 *
 * source: { type: "custom", name: "21st-amendment", url? }
 */
const URL_DEFAULT = 'https://www.21stamendmentlalouisiane.com/events.html';
const SET = /^(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s+(.+)$/i;

export default async function scrape(source) {
  const url = source.url ?? URL_DEFAULT;
  return parse21stAmendment(await fetchText(url), { url });
}

export function parse21stAmendment(html, { url = URL_DEFAULT, reference = now() } = {}) {
  const $ = cheerio.load(html);
  const events = [];
  $('.schedule .day').each((_, day) => {
    const date = parseDay($(day).children('strong').first().text().replace(/\s+/g, ' ').trim(), reference);
    if (!date) return;
    $(day).find('li').each((__, li) => {
      const m = $(li).text().replace(/\s+/g, ' ').trim().match(SET);
      if (!m) return;
      let hour = +m[1];
      if (hour >= 1 && hour < 12) hour += 12;
      if (hour > 23) return;
      events.push({ title: m[3], start: date.set({ hour, minute: m[2] ? +m[2] : 0 }), allDay: false, url });
    });
  });
  return events;
}
