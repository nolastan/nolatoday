import * as cheerio from 'cheerio';
import { fetchText } from '../scripts/lib/http.js';

const EVENT_TYPES = new Set([
  'Event', 'MusicEvent', 'ComedyEvent', 'DanceEvent', 'TheaterEvent', 'SocialEvent',
  'Festival', 'FoodEvent', 'LiteraryEvent', 'ScreeningEvent', 'EducationEvent', 'ExhibitionEvent',
]);

/**
 * Pages that embed schema.org Event objects as JSON-LD — TicketWeb, Tixr,
 * Eventbrite organizer pages, DICE, many WordPress plugins, etc.
 *
 * source: {
 *   type: "jsonld",
 *   url: "https://…" | urls: ["https://…", …],
 *   location?: "Saturn Bar",   // keep only events whose location name contains this (case-insensitive)
 * }
 */
export default async function scrapeJSONLD(source) {
  const urls = source.urls ?? [source.url];
  const events = [];
  for (const url of urls) {
    const html = await fetchText(url);
    events.push(...extractEvents(html, url, source));
  }
  return events;
}

export function extractEvents(html, pageUrl, { location } = {}) {
  const $ = cheerio.load(html);
  const found = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // Some sites emit control characters or trailing commas.
      try {
        data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
      } catch {
        return;
      }
    }
    collect(data, found);
  });
  return found
    .filter((e) => e.startDate && e.name)
    .filter((e) => !location || locationName(e).toLowerCase().includes(location.toLowerCase()))
    .map((e) => ({
      uid: e['@id'] || e.url,
      title: decode(e.name),
      start: e.startDate,
      end: e.endDate ?? null,
      url: e.url ? safeUrl(Array.isArray(e.url) ? e.url[0] : e.url, pageUrl) : undefined,
      description: typeof e.description === 'string' ? decode(e.description) : undefined,
      image: imageUrl(e.image),
      status: e.eventStatus,
    }))
    .filter((e) => !String(e.status ?? '').includes('Cancelled'));
}

function collect(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, depth + 1);
    return;
  }
  const types = [].concat(node['@type'] ?? []);
  if (types.some((t) => EVENT_TYPES.has(t))) out.push(node);
  for (const key of ['@graph', 'itemListElement', 'item', 'events', 'event', 'subEvent', 'mainEntity']) {
    if (node[key]) collect(node[key], out, depth + 1);
  }
}

function locationName(e) {
  const loc = [].concat(e.location ?? [])[0];
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  return [loc.name, typeof loc.address === 'string' ? loc.address : loc.address?.streetAddress].filter(Boolean).join(' ');
}

function imageUrl(img) {
  const first = [].concat(img ?? [])[0];
  if (!first) return undefined;
  return typeof first === 'string' ? first : first.url;
}

function safeUrl(u, base) {
  try {
    return new URL(u, base).toString();
  } catch {
    return undefined;
  }
}

function decode(s) {
  return cheerio.load(`<p>${s}</p>`)('p').text().trim();
}
