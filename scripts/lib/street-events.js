/**
 * Street events: public festivals, markets, block parties and outdoor concerts
 * from the City of New Orleans' special event permit applications
 * (data.nola.gov aib5-en5t, type "Special Event - Master"), the same feed the
 * parades come from. Parades and second lines are left to scripts/lib/permits.js.
 *
 * The feed is mostly private: weddings, staff parties, galas, plus logistics
 * (concession stands, parking, reviewing stands) and vendors' own permits for
 * someone else's festival. Only rows that city staff wrote up in their usual
 * "Title - address - date" format, whose title names a festival, market, block
 * party or concert, and that read as open to the public get through. A row that
 * fails is counted, never named.
 *
 * Only the title, date, start and end times, the street and the city's point
 * are published. The staff notes ("Awaiting: ..."), organizer names and
 * attendance figures in the description are never copied.
 *
 * Everything here is pure: fetching lives in scripts/parades.js.
 */
import path from 'node:path';
import { DateTime } from 'luxon';
import { DATA_DIR, readJSON } from './data.js';
import { ZONE } from './time.js';
import { parseHeadline, DEAD_STATUS } from './permits.js';
import { slugify, startStreet } from './parades.js';

export const STREET_EVENTS_FILE = path.join(DATA_DIR, 'street-events.json');

/** The published events, for the site build. */
export function loadStreetEvents() {
  return readJSON(STREET_EVENTS_FILE, { events: [] }).events ?? [];
}

// What the title has to name. Checked in order; the first match is the event's category.
export const CATEGORIES = [
  ['block_party', 'Block party', /\bblock\s?party\b|\bstreet\s?party\b/i],
  ['market', 'Market', /\bmarket(place)?\b|\bbazaar\b|\bflea\b|\bart(s)? (walk|show)\b/i],
  ['festival', 'Festival', /\bfest(ival)?\b|\bf[eê]te\b|fest\b/i],
  ['concert', 'Concert', /\bconcerts?\b|\bjazz\b|\bmusic\b|\bbrass band\b|\bbonfire\b/i],
];

// Not a public event, or not one someone would go to: a vendor's or caterer's own permit for
// another event, logistics, ticketed dinners and galas, school and member events, races.
const NOT_PUBLIC = new RegExp(
  [
    'concession', 'alcohol', 'liquor', 'beverages?', '\\bbar\\b', 'satellite', 'booth', 'vendor', 'catering', 'merchandise', 'shuttle', 'on wheels',
    'hosts global',
    'parking', 'valet', 'reviewing stand', 'bleacher', 'bracing', 'tent\\b', 'closure', 'banner', 'filming',
    'wedding', 'bride', 'groom', 'reception', 'rehearsal', 'bachelor', 'birthday', 'private', 'staff', 'employee', 'team members', 'corporate',
    'company', 'holiday party', 'christmas party', 'office', 'reunion', 'graduation', 'retirement', 'funeral', 'memorial', 'repast', 'shower',
    'luncheon', 'dinner', 'brunch', 'gala', '\\bball\\b', 'mixer', 'fashion show', 'patron', 'member', 'sponsor', 'vip',
    'school', '\\bpta\\b', '\\bptsa\\b', '\\bpto\\b', 'charter', 'academy', 'alumni', 'homecoming',
    '\\d+\\s?k\\b', '\\brun\\b', 'race', '\\bwalk\\b', 'ride\\b', 'crawl', 'tailgate', 'watch party', 'tournament',
    'second\\s?-?\\s?line', 'parade', 'procession', 'social aid', 'pleasure club',
  ].join('|'),
  'i',
);
// Said anywhere in the write-up, these mean the public is not invited.
const CLOSED_DOORS = /corporate client|for (a|the|our) client|convention (group|attendees)|not (a )?publicly accessible|not open to the public|closed to the public|invitation only|by invitation|invite[- ]only|private (event|party|gathering)|no admission private|guests only|staff[- ]only|members[- ]only/i;

const DATE = /(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?!\d)/;

/** The longest a single application may run and still be shown day by day. Longer ones are seasons, not events. */
export const MAX_DAYS = 7;

/** The description up to the staff's checklist of missing paperwork. Nothing after "Awaiting" is about the event. */
function writeUp(descr) {
  return String(descr ?? '').split(/^\s*(?:Awaiting|Pending|Missing)\b/im)[0];
}

/** "Arts Market New Orleans (8)" → "Arts Market New Orleans"; staff notes, counters and the year come off. */
export function cleanTitle(title) {
  return String(title)
    .replace(/\*{2,}[^*]*\*{2,}/g, ' ')
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/\s+-\s*\d+\s*$/, '')
    .replace(/^\s*20\d\d\s+/, '')
    .replace(/\s+20\d\d\s*$/, '')
    .replace(/[\s'’]+20\d\d(?=\s*$)/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

/** The last day named in the headline: "12-11-2026 to 12-13-2026" ends on the 13th. */
function lastDay(descr, first) {
  const line = String(descr ?? '').split(/\r?\n/).slice(0, 2).join(' ');
  const m = new RegExp(`${DATE.source}\\s*(?:-|–|to|thru|through)\\s*${DATE.source}`).exec(line);
  if (!m) return first;
  const end = DateTime.fromObject({ year: Number(m[6]), month: Number(m[4]), day: Number(m[5]) }, { zone: ZONE });
  return end.isValid && end.toISODate() >= first ? end.toISODate() : first;
}

/**
 * The event's hours, from the first clock range in the write-up ("1 pm - 7 pm",
 * "12:30 pm - 7:00 pm", "7 - 9 pm"). Only the end needs to say AM or PM; a bare
 * start takes the end's half of the day unless that would put it after the end.
 * An end at or before the start runs past midnight. Returns null when no range is given.
 */
export function hours(descr) {
  const text = writeUp(descr);
  const re = new RegExp(String.raw`(?<![\d:/-])(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*(?:-|–|—|\bto\b|\buntil\b)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\b\.?`, 'gi');
  for (const m of text.matchAll(re)) {
    const endHalf = m[6].toLowerCase();
    const end = { hour: (Number(m[4]) % 12) + (endHalf === 'p' ? 12 : 0), minute: Number(m[5] ?? 0) };
    let startHalf = m[3]?.toLowerCase();
    let start = { hour: Number(m[1]) % 12, minute: Number(m[2] ?? 0) };
    if (Number(m[1]) > 12 || Number(m[4]) > 12 || start.minute > 59 || end.minute > 59) continue;
    if (!startHalf) {
      startHalf = endHalf;
      const asEnd = start.hour + (endHalf === 'p' ? 12 : 0);
      if (asEnd * 60 + start.minute > end.hour * 60 + end.minute) startHalf = endHalf === 'p' ? 'a' : 'p';
    }
    start = { hour: start.hour + (startHalf === 'p' ? 12 : 0), minute: start.minute };
    // Street closures are often written for set-up and tear-down ("5:00am - 2:00am", "12:00am - 11:59pm").
    // Hours like that say when the street is shut, not when to go, so the day is shown without times.
    let minutes = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
    if (minutes <= 0) minutes += 24 * 60;
    if (start.hour < 7 || minutes > 14 * 60 || minutes < 30 || (end.hour === 23 && end.minute === 59)) return null;
    return { start, end };
  }
  return null;
}

/** Is this row a public street event? Returns null when it is, or the reason it is not. */
export function streetEventVerdict(row) {
  const descr = String(row.descr ?? '');
  const head = parseHeadline(descr);
  if (!head) return 'not in the city’s "title - address - date" format';
  if (head.title.length > 90) return 'not in the city’s "title - address - date" format';
  if (DEAD_STATUS.test(row.currentstatus ?? '')) return 'withdrawn, denied or void';
  if (/^\s*\*{2,}/.test(head.title) || /incomplete|closed\b/i.test(head.title)) return 'withdrawn, denied or void';
  // Staff flag a stalled application in the description: "***NOT PROCESSED - INCOMPLETE- Likely a duplicate***".
  if (/\*{2,}[^*]*(not processed|incomplete|duplicate|cancel)[^*]*\*{2,}/i.test(descr)) return 'withdrawn, denied or void';
  if (NOT_PUBLIC.test(head.title)) return 'not a public event';
  if (CLOSED_DOORS.test(writeUp(descr))) return 'not a public event';
  if (!CATEGORIES.some(([, , re]) => re.test(head.title))) return 'not a festival, market, block party or concert';
  // City staff always say who runs it and whether there is a charge. Without that line it is not their write-up.
  if (!/\b(non-?\s?profit|for-?\s?profit)\b/i.test(descr) && !/charging admission/i.test(descr)) return 'no organizer line';
  // A business's party that sells nothing and charges nothing is for its own guests: a convention
  // group's block party, a client event. Public ones have vendors selling or a ticket price.
  const text = writeUp(descr);
  if (/for-?\s?profit/i.test(text) && /not charging admission|no admission/i.test(text) && !/vend|sell|sale/i.test(text)) return 'not a public event';
  // "042326 Fest": a name with nothing in it but a date code.
  if (!/[a-z]{3,}/i.test(cleanTitle(head.title).replace(/\b(fest(ival)?|f[eê]te|market(place)?|block|party|concerts?|annual)\b/gi, ''))) return 'no name';
  const filed = DateTime.fromISO(String(row.d_create ?? '').slice(0, 10), { zone: ZONE });
  const days = filed.isValid ? DateTime.fromISO(head.date, { zone: ZONE }).diff(filed, 'days').days : 0;
  if (days < -7 || days > 550) return 'date does not fit when the application was filed';
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!(lat > 29.8 && lat < 30.2 && lng > -90.3 && lng < -89.6)) return 'no location in New Orleans';
  const last = lastDay(descr, head.date);
  if (DateTime.fromISO(last).diff(DateTime.fromISO(head.date), 'days').days + 1 > MAX_DAYS) return 'runs longer than a week';
  return null;
}

/** A public street event from a permit row: { record } or { skipped }. */
export function fromStreetPermit(row) {
  const skipped = streetEventVerdict(row);
  if (skipped) return { skipped };
  const descr = String(row.descr ?? '');
  const head = parseHeadline(descr);
  const [category, label] = CATEGORIES.find(([, , re]) => re.test(head.title));
  const name = cleanTitle(head.title);
  const time = hours(descr);
  return {
    record: {
      id: `${slugify(name)}-${head.date}`,
      name,
      category,
      category_label: label,
      date: head.date,
      end_date: lastDay(descr, head.date),
      start_time: time ? `${String(time.start.hour).padStart(2, '0')}:${String(time.start.minute).padStart(2, '0')}` : null,
      end_time: time ? `${String(time.end.hour).padStart(2, '0')}:${String(time.end.minute).padStart(2, '0')}` : null,
      street: startStreet(head.address),
      point: [Number(Number(row.longitude).toFixed(6)), Number(Number(row.latitude).toFixed(6))],
      permit_number: row.permitnumber,
      permit_status: row.currentstatus ?? null,
      permit_filed: String(row.d_create ?? '').slice(0, 10) || null,
      source_url: `https://data.nola.gov/resource/aib5-en5t.json?permitnumber=${encodeURIComponent(row.permitnumber)}`,
    },
  };
}

/** Distance in metres between two [lng, lat] points. */
export function metres(a, b) {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

// Words that say what kind of event it is, not which one.
const GENERIC = new Set(['annual', 'festival', 'fest', 'fete', 'market', 'marketplace', 'block', 'party', 'street', 'concert', 'music', 'series', 'orleans', 'new', 'nola', 'the', 'and', 'holiday', 'christmas', 'fall', 'spring', 'summer', 'winter', 'community', 'day', 'night', 'live']);
function keyWords(name) {
  return new Set(slugify(name).split('-').filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d/.test(w)));
}
const overlaps = (a, b) => a.date <= b.end_date && b.date <= a.end_date;

/**
 * One event per happening. A festival often has more than one application (the
 * festival's own, a stage, a vendor's tent). Two records on overlapping days
 * within 400 m that share a distinctive word in their names are the same event;
 * the earliest-filed one is kept, since that is usually the organizer's own.
 * Returns { events, merged }.
 */
export function dedupe(records) {
  const pool = [...records];
  pool.sort((a, b) => (a.permit_filed ?? '').localeCompare(b.permit_filed ?? '') || a.permit_number.localeCompare(b.permit_number));
  const kept = [];
  const merged = [];
  for (const r of pool) {
    const words = keyWords(r.name);
    const same = kept.find((k) => overlaps(k, r) && metres(k.point, r.point) < 400 && [...keyWords(k.name)].some((w) => words.has(w)));
    if (same) {
      merged.push({ id: r.id, into: same.id });
      if (!same.start_time && r.start_time) Object.assign(same, { start_time: r.start_time, end_time: r.end_time });
      continue;
    }
    // The same application listed twice (a duplicate filing) is one event too.
    if (kept.some((k) => k.id === r.id)) {
      merged.push({ id: r.id, into: r.id });
      continue;
    }
    kept.push({ ...r });
  }
  kept.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.name.localeCompare(b.name));
  return { events: kept, merged };
}

/**
 * The map's compact form: one item per day the event runs, with ISO start and end
 * in New Orleans time, or `a: 1` for a day with no hours given.
 */
export function mapStreetEvent(e, { from, to }) {
  const items = [];
  for (let day = DateTime.fromISO(e.date, { zone: ZONE }); day.toISODate() <= e.end_date; day = day.plus({ days: 1 })) {
    const date = day.toISODate();
    if (date < from || date > to) continue;
    const item = { id: e.id, n: e.name, p: e.point };
    if (e.street) item.st = e.street;
    if (e.start_time) {
      const [sh, sm] = e.start_time.split(':').map(Number);
      const [eh, em] = e.end_time.split(':').map(Number);
      const start = day.set({ hour: sh, minute: sm });
      let end = day.set({ hour: eh, minute: em });
      if (end <= start) end = end.plus({ days: 1 });
      item.s = start.toISO({ suppressMilliseconds: true });
      item.e = end.toISO({ suppressMilliseconds: true });
    } else {
      item.s = date;
      item.a = 1;
    }
    items.push(item);
  }
  return items;
}
