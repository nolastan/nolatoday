import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { request } from '../../scripts/lib/http.js';
import { parseDay } from '../../scripts/lib/dates.js';
import { now, ZONE } from '../../scripts/lib/time.js';

/**
 * Bamboula's publishes one edit.site page of weekday headings and set lines.
 * A set is a heading followed by a clock range. The page names the club and
 * "514 Frenchmen St"; the venue record's 516 is not overwritten from here.
 * A range whose end is an earlier PM clock (the page's "11:00PM-1:45PM") is
 * kept as an unresolved row. It is not rewritten to 11:00 AM.
 *
 * source: { type: "custom", name: "bamboulas", url }
 */
const HOST = /^(www\.)?bamboulasmusic\.com$/;
const WEEKDAY = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
const DATE = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}$/i;
const OPEN = /^open at\b/i;
const FOOTER = /^bookings\b/i;
const BOILER = /^(live music schedule|music by new orleans' best musicians|open 7 days\b.*|every day|we play|live music|open 'til close|(?:0ctober|[a-z]+) music calendar)$/i;

function asReference(value) {
  if (!value) return now();
  if (DateTime.isDateTime(value)) return value.setZone(ZONE);
  if (value instanceof Date) {
    const dt = DateTime.fromJSDate(value).setZone(ZONE);
    return dt.isValid ? dt : now();
  }
  const http = DateTime.fromHTTP(String(value), { zone: 'utc' });
  if (http.isValid) return http.setZone(ZONE);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) return DateTime.fromJSDate(parsed).setZone(ZONE);
  return now();
}

export function redirectProblem(requested, finalUrl) {
  let requestedUrl;
  let final;
  try {
    requestedUrl = new URL(requested);
    final = new URL(finalUrl);
  } catch {
    return 'unreadable_url';
  }
  if (requestedUrl.protocol !== 'https:' || !HOST.test(requestedUrl.hostname)) return 'unexpected_request_host';
  if (!HOST.test(final.hostname)) return 'off_host_redirect';
  if (final.protocol !== 'https:') return 'final_not_https';
  return null;
}

function clock(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\./g, '');
  if (s === 'noon' || s === '12 noon') return { hour: 12, minute: 0, meridiem: 'pm' };
  if (s === 'midnight' || s === '12 midnight') return { hour: 0, minute: 0, meridiem: 'am' };
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const meridiem = m[3][0] === 'a' ? 'am' : 'pm';
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute, meridiem };
}

function range(text) {
  const m = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (!m) return null;
  const start = clock(m[1]);
  const end = clock(m[2]);
  if (!start || !end) return null;
  return { start, end, raw: text };
}

function blocks(html) {
  const $ = cheerio.load(html);
  const out = [];
  // One Draft block can hold a title and its clock on separate lines.
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    for (const part of $(el).text().split(/\n+/)) {
      const text = part.replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
    }
  });
  return out;
}

function pageIdentity(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const title = $('title').text().replace(/\s+/g, ' ').trim();
  return {
    title,
    namesBamboula: /bamboula/i.test(`${title} ${text}`),
    frenchmen: /frenchmen/i.test(text),
    streetNumbers: [...text.matchAll(/(\d{3,4})\s+Frenchmen\s+St/gi)].map((m) => m[1]),
  };
}

/**
 * @returns {{events: object[], unresolved: object[], coverage: string, identity: object, datesFound: number}}
 */
export function parseBamboulas(html, { url, reference = now(), declaredBytes, contentEncoding } = {}) {
  const when = asReference(reference);
  const identity = pageIdentity(html);
  const encoded = Boolean(contentEncoding && contentEncoding !== 'identity');
  const truncated = !encoded && declaredBytes != null && Buffer.byteLength(html) < Number(declaredBytes);
  const lines = blocks(html);
  const events = [];
  const unresolved = [];
  let dateText = '';
  let pending = '';
  let datesFound = 0;
  let sawFooter = false;

  const dropPending = (reason) => {
    if (!pending) return;
    unresolved.push({ reason, date: dateText || null, raw: pending });
    pending = '';
  };

  for (const text of lines) {
    if (FOOTER.test(text)) {
      dropPending('title_without_time');
      sawFooter = true;
      break;
    }
    if (WEEKDAY.test(text) || OPEN.test(text) || BOILER.test(text)) continue;
    if (!dateText && !DATE.test(text)) continue;
    if (DATE.test(text)) {
      dropPending('title_without_time');
      dateText = text;
      datesFound += 1;
      continue;
    }
    const clocks = range(text);
    if (clocks) {
      if (!dateText || !pending) {
        unresolved.push({ reason: 'time_without_title', date: dateText || null, raw: text });
        continue;
      }
      const day = parseDay(dateText, when);
      const title = pending;
      pending = '';
      if (!day) {
        unresolved.push({ reason: 'undated', date: dateText, raw: `${title} ${text}` });
        continue;
      }
      const start = day.set({ hour: clocks.start.hour, minute: clocks.start.minute });
      let end = day.set({ hour: clocks.end.hour, minute: clocks.end.minute });
      if (end <= start) {
        // "10:00PM-2:00AM" crosses midnight. "11:00PM-1:45PM" does not say AM.
        if (clocks.end.meridiem === 'am') end = end.plus({ days: 1 });
        else {
          unresolved.push({ reason: 'range_conflict', date: dateText, raw: `${title} ${clocks.raw}` });
          continue;
        }
      }
      events.push({ title, start, end, url });
      continue;
    }
    dropPending('title_without_time');
    pending = text;
  }
  dropPending('title_without_time');

  const closed = /<\/html>/i.test(html);
  const bound = identity.namesBamboula && identity.frenchmen && identity.streetNumbers.length > 0;
  let coverage;
  if (truncated) coverage = 'truncated_body';
  else if (!bound) coverage = datesFound > 0 ? 'partial_document' : 'source_not_schedule';
  else if (!closed || !sawFooter) coverage = 'partial_document';
  else if (datesFound === 0) coverage = 'no_schedule_headings';
  else coverage = 'complete';

  return { events, unresolved, coverage, identity, datesFound };
}

export default async function scrape(source = {}) {
  const requested = source.url;
  const problem = redirectProblem(requested, requested);
  if (problem) throw new Error(`bamboulas ${problem}: ${requested}`);
  const res = await request(requested, { retries: 1 });
  const landed = redirectProblem(requested, res.url);
  if (landed) throw new Error(`bamboulas ${landed}: ${res.url}`);
  const html = await res.text();
  const parsed = parseBamboulas(html, {
    url: res.url,
    reference: res.headers.get('last-modified') || now(),
    declaredBytes: res.headers.get('content-length'),
    contentEncoding: res.headers.get('content-encoding'),
  });
  if (parsed.coverage !== 'complete') {
    throw new Error(
      `bamboulas ${parsed.coverage} from ${res.url} `
      + `(dates ${parsed.datesFound}, street ${parsed.identity.streetNumbers.join(',') || 'none'})`,
    );
  }
  if (parsed.unresolved.length) {
    console.error(`bamboulas: ${parsed.unresolved.length} source rows not emitted`);
    for (const row of parsed.unresolved) console.error(`bamboulas unresolved ${row.reason}: ${row.date ?? ''} ${row.raw}`);
  }
  return parsed.events;
}
