import * as cheerio from 'cheerio';
import { fetchText } from '../scripts/lib/http.js';
import { parseLooseDate } from '../scripts/lib/dates.js';

/**
 * Declarative scraper for server-rendered event lists. Selectors are CSS,
 * optionally suffixed with "@attr" to read an attribute instead of text.
 *
 * source: {
 *   type: "html",
 *   url: "https://example.com/events",     // or urls: [...]
 *   item: ".event",                         // one element per event
 *   title: "h2",
 *   date: ".date",                          // text like "Friday, Oct 9" or "2026-10-09"
 *   time?: ".time",                         // text like "8pm"; falls back to the date text
 *   link?: "a@href",                        // defaults to the first link in the item
 *   dateHeader?: "h3.day",                  // for lists grouped under date headings: the
 *                                           // closest preceding match supplies the date
 *   next?: "a.next@href",                   // follow pagination (up to `maxPages`, default 5)
 * }
 */
export default async function scrapeHTML(source) {
  const queue = [...(source.urls ?? [source.url])];
  const seen = new Set();
  const events = [];
  const maxPages = source.maxPages ?? 5;
  while (queue.length && seen.size < maxPages) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await fetchText(url);
    events.push(...parseHTML(html, { ...source, url }));
    if (source.next) {
      const $ = cheerio.load(html);
      const href = select($, $.root(), source.next);
      if (href) queue.push(new URL(href, url).toString());
    }
  }
  return events;
}

export function select($, root, selector) {
  if (!selector) return '';
  const [css, attr] = selector.split('@');
  const el = css ? $(root).find(css).first() : $(root);
  if (!el.length) return '';
  return (attr ? el.attr(attr) : el.text())?.replace(/\s+/g, ' ').trim() ?? '';
}

export function parseHTML(html, source) {
  const $ = cheerio.load(html);
  const events = [];
  let headerDate = '';
  const selector = source.dateHeader ? `${source.dateHeader}, ${source.item}` : source.item;
  $(selector).each((_, el) => {
    if (source.dateHeader && $(el).is(source.dateHeader)) {
      headerDate = $(el).text().replace(/\s+/g, ' ').trim();
      return;
    }
    const title = select($, el, source.title);
    const dateText = source.date ? select($, el, source.date) : headerDate;
    const timeText = source.time ? select($, el, source.time) : '';
    const parsed = parseLooseDate(dateText || headerDate, timeText);
    if (!title || !parsed) return;
    const href = select($, el, source.link ?? 'a@href');
    let url;
    try {
      url = href ? new URL(href, source.url).toString() : undefined;
    } catch {
      url = undefined;
    }
    events.push({ title, start: parsed.allDay ? parsed.start.toISODate() : parsed.start, allDay: parsed.allDay, url });
  });
  return events;
}
