import { DateTime } from 'luxon';

export const ZONE = 'America/Chicago';

/**
 * Parse a date/time value into a Luxon DateTime in New Orleans time.
 * Accepts Date objects, epoch milliseconds, ISO strings (with or without an
 * offset — strings without one are treated as local New Orleans time), or
 * Luxon DateTimes.
 */
export function toDateTime(value, { zone = ZONE } = {}) {
  if (value == null || value === '') return null;
  let dt;
  if (DateTime.isDateTime(value)) dt = value;
  else if (value instanceof Date) dt = DateTime.fromJSDate(value);
  else if (typeof value === 'number') dt = DateTime.fromMillis(value);
  else if (typeof value === 'string') {
    const s = value.trim();
    dt = DateTime.fromISO(s, { zone, setZone: false });
    if (!dt.isValid) dt = DateTime.fromSQL(s, { zone });
    if (!dt.isValid) dt = DateTime.fromRFC2822(s, { zone });
    if (!dt.isValid) dt = DateTime.fromHTTP(s, { zone });
  } else return null;
  if (!dt || !dt.isValid) return null;
  return dt.setZone(ZONE);
}

/** Parse a local wall-clock time using a Luxon format string, e.g. ('Oct 5 2026 8:00 PM', 'LLL d yyyy h:mm a'). */
export function parseLocal(text, format) {
  const dt = DateTime.fromFormat(text.replace(/\s+/g, ' ').trim(), format, { zone: ZONE, locale: 'en-US' });
  return dt.isValid ? dt : null;
}

export function now() {
  return DateTime.now().setZone(ZONE);
}

/** ISO 8601 with offset and no milliseconds, e.g. 2026-10-05T20:00:00-05:00 */
export function iso(dt) {
  return dt ? dt.setZone(ZONE).toISO({ suppressMilliseconds: true }) : null;
}

/**
 * Given a month/day with no year (common on venue sites), pick the year.
 * Listings are almost always upcoming, so a date more than two months in the
 * past is assumed to be next year's (e.g. "Jan 3" seen in December).
 */
export function inferYear(month, day, reference = now()) {
  const thisYear = DateTime.fromObject({ year: reference.year, month, day }, { zone: ZONE });
  return thisYear < reference.minus({ days: 60 }) ? reference.year + 1 : reference.year;
}
