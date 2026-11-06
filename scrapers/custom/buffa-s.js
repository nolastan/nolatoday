import * as cheerio from 'cheerio';
import { fetchText } from '../../scripts/lib/http.js';

// Total CMS prints each show as an absolute instant on <time datetime>, then
// the page does moment(datetime).locale('en').format('MMMM DD, YYYY hh:mm A').
// moment() (not parseZone) displays that instant in the viewer's zone. In
// America/Chicago the 2026-10-07 list shows 8:00 PM for 2026-10-09T18:00:00-07:00
// and 11:00 AM for 2026-10-11T09:00:00-07:00. Returning the offset-bearing
// string lets normalizeEvents keep that same instant. parseLooseDate returns
// null for these stamps, so the html adapter cannot read them.
//
// Coverage is one /events/ document: the rendered articles plus the posts
// array the Load More button shifts through. There is no further request.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseBuffas(html, pageUrl = 'https://www.buffasbar.com/events/') {
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  const push = (title, datetime, href) => {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim();
    const start = String(datetime ?? '').trim();
    if (!name || name.includes('{{')) return;
    if (!INSTANT.test(start)) return;
    let url;
    try {
      url = href ? new URL(String(href), pageUrl).toString() : undefined;
    } catch {
      url = undefined;
    }
    if (url && !/^https?:\/\//.test(url)) url = undefined;
    const key = `${start}|${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const event = { title: name, start };
    if (url) event.url = url;
    events.push(event);
  };

  $('article').each((_, el) => {
    const datetime = $(el).find('time.post-date').attr('datetime');
    const link = $(el).find('h5.post-title a').first();
    push(link.text(), datetime, link.attr('href'));
  });

  const extra = $('#posts_stacks_in_250').first().text().trim();
  if (extra.startsWith('[')) {
    try {
      const posts = JSON.parse(extra);
      if (Array.isArray(posts)) {
        for (const post of posts) {
          push(post?.title, post?.datetime, post?.url || post?.permalink);
        }
      }
    } catch {
      // A broken Load More payload still leaves the rendered cards.
    }
  }
  return events;
}

export default async function scrapeBuffas(source) {
  const url = source.url ?? 'https://www.buffasbar.com/events/';
  return parseBuffas(await fetchText(url), url);
}
