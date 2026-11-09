import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../scripts/lib/data.js';

export const MANUAL_DIR = path.join(DATA_DIR, 'manual');
export const KINDS = ['music', 'dj', 'trivia', 'comedy', 'sports', 'special', 'other'];
const DEFAULT_KINDS = ['music'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_KEYS = new Set(['date', 'time', 'doors', 'end', 'title', 'price', 'kind', 'url', 'note']);
const FILE_KEYS = new Set(['venue', 'updated', 'from', 'events']);

/**
 * Schedules written into the repo by hand or by an agent (e.g. Meta Muse
 * reading a venue's Instagram posts), one file per venue at
 * data/manual/<slug>.json. See CONTRIBUTING.md for the format.
 *
 * source: { type: "manual", kinds?: ["music", "dj"] }
 */
export default async function scrapeManual(source, { venue }) {
  const file = path.join(MANUAL_DIR, `${venue.slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`data/manual/${venue.slug}.json not found`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`data/manual/${venue.slug}.json is not valid JSON: ${err.message}`);
  }
  return parseManual(data, { slug: venue.slug, kinds: source.kinds });
}

/** Problems with a manual schedule file, as strings. Empty when it's fine. */
export function checkManual(data, slug) {
  const problems = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['must be a JSON object'];
  for (const key of Object.keys(data)) if (!FILE_KEYS.has(key)) problems.push(`unknown field "${key}"`);
  if (data.venue !== slug) problems.push(`"venue" must be "${slug}" (the file name)`);
  if (!DATE.test(data.updated ?? '')) problems.push('"updated" must be YYYY-MM-DD');
  if (data.from != null && !/^https?:\/\//.test(data.from)) problems.push('"from" must be an http(s) URL');
  if (!Array.isArray(data.events)) return [...problems, '"events" must be an array'];
  data.events.forEach((e, i) => {
    const at = `events[${i}]`;
    if (!e || typeof e !== 'object') return problems.push(`${at} must be an object`);
    for (const key of Object.keys(e)) if (!EVENT_KEYS.has(key)) problems.push(`${at}: unknown field "${key}"`);
    if (!DATE.test(e.date ?? '')) problems.push(`${at}: "date" must be YYYY-MM-DD`);
    for (const key of ['time', 'doors', 'end']) {
      if (e[key] != null && !TIME.test(e[key])) problems.push(`${at}: "${key}" must be 24-hour HH:MM or null`);
    }
    if (typeof e.title !== 'string' || !e.title.trim()) problems.push(`${at}: "title" is required`);
    if (!KINDS.includes(e.kind)) problems.push(`${at}: "kind" must be one of ${KINDS.join(', ')}`);
    if (e.url != null && !/^https?:\/\//.test(e.url)) problems.push(`${at}: "url" must be an http(s) URL`);
  });
  return problems;
}

/** Convert a checked manual file into raw scraper events, keeping only the wanted kinds. */
export function parseManual(data, { slug, kinds = DEFAULT_KINDS } = {}) {
  const problems = checkManual(data, slug);
  if (problems.length) throw new Error(`data/manual/${slug}.json: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}`);
  const wanted = new Set(kinds);
  return data.events
    .filter((e) => wanted.has(e.kind))
    .map((e) => {
      const time = e.time ?? e.doors;
      if (!time) return { title: e.title, start: e.date, allDay: true, url: e.url ?? undefined };
      const start = `${e.date}T${time}`;
      let end;
      if (e.end) {
        // An end time earlier than the start is after midnight.
        const endDate = e.end <= time ? nextDay(e.date) : e.date;
        end = `${endDate}T${e.end}`;
      }
      return { title: e.title, start, end, url: e.url ?? undefined };
    });
}

function nextDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
