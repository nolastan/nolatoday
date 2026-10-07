import { DateTime } from 'luxon';
import { ZONE, inferYear, now } from './time.js';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse the human-written dates venue websites use, e.g.
 *   "Friday, October 9th, 2026"  "Oct 9"  "10/09/2026"  "2026-10-09"
 * optionally combined with a time ("8pm", "8:30 PM", "20:00", "Doors 7pm / Show 8pm").
 * The first time found wins unless `preferShow` is set, in which case a time
 * labelled "show" is preferred over "doors".
 *
 * Returns { start: DateTime, allDay: boolean } or null.
 */
export function parseLooseDate(dateText, timeText = '', { reference = now(), preferShow = true } = {}) {
  const text = clean(dateText);
  const day = parseDay(text, reference);
  if (!day) return null;
  const time = parseTime(`${clean(timeText)} ${timeText ? '' : text}`, { preferShow });
  if (!time) return { start: day, allDay: true };
  return { start: day.set({ hour: time.hour, minute: time.minute }), allDay: false };
}

function clean(s) {
  return String(s ?? '')
    .replace(/ | /g, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDay(text, reference = now()) {
  let m;
  // ISO 2026-10-09
  if ((m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return make(+m[1], +m[2], +m[3]);
  // US numeric 10/09/2026 or 10/9/26 or 10/9
  if ((m = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/))) {
    const month = +m[1];
    const dayN = +m[2];
    let year = m[3] ? +m[3] : inferYear(month, dayN, reference);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12) return make(year, month, dayN);
  }
  // "October 9, 2026" / "Oct. 9" / "9 October 2026"
  const monthRe = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';
  if ((m = text.match(new RegExp(`\\b${monthRe}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i')))) {
    const month = MONTHS[m[1].toLowerCase()];
    const dayN = +m[2];
    return make(m[3] ? +m[3] : inferYear(month, dayN, reference), month, dayN);
  }
  if ((m = text.match(new RegExp(`\\b(\\d{1,2})\\s+${monthRe}(?:,?\\s+(\\d{4}))?`, 'i')))) {
    const month = MONTHS[m[2].toLowerCase()];
    const dayN = +m[1];
    return make(m[3] ? +m[3] : inferYear(month, dayN, reference), month, dayN);
  }
  return null;
}

function make(year, month, day) {
  const dt = DateTime.fromObject({ year, month, day }, { zone: ZONE });
  return dt.isValid ? dt : null;
}

export function parseTime(text, { preferShow = true } = {}) {
  const s = clean(text).toLowerCase();
  const re = /(?:(doors?|show|music|starts?)\s*(?:at|@|:)?\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?\b(?!\s*(?:\/|-)\s*\d{2,4})/g;
  const found = [];
  let m;
  while ((m = re.exec(s))) {
    const label = m[1] ?? '';
    let hour = +m[2];
    const minute = m[3] ? +m[3] : 0;
    const ampm = m[4]?.[0];
    if (!ampm && !m[3]) continue; // bare numbers are probably not times
    if (hour > 23 || minute > 59) continue;
    if (ampm === 'p' && hour < 12) hour += 12;
    if (ampm === 'a' && hour === 12) hour = 0;
    // Venue listings with no am/pm almost always mean evening.
    if (!ampm && hour >= 1 && hour <= 11) hour += 12;
    found.push({ hour, minute, label });
  }
  if (!found.length) return null;
  if (preferShow) {
    const show = found.find((t) => /show|music|start/.test(t.label));
    if (show) return show;
  }
  return found[0];
}
