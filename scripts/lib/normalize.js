import crypto from 'node:crypto';
import { toDateTime, iso, now, ZONE } from './time.js';
import { DateTime } from 'luxon';
import { parseTime } from './dates.js';

// Listings that aren't shows. Venues can add their own with source.exclude.
const DEFAULT_EXCLUDE = [
  /^closed\b/i,
  /\bprivate (event|party)\b/i,
  /^(bar )?closed for/i,
  /^happy hour$/i,
  /^tbd$/i,
  /^tba$/i,
];

export function cleanTitle(title) {
  return String(title ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, '’')
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn raw scraper output into the stored event shape, dropping invalid,
 * excluded, out-of-window and duplicate events.
 */
export function normalizeEvents(raw, { venue, source = {}, window } = {}) {
  const from = window?.from ?? now().startOf('day');
  const to = window?.to ?? now().plus({ days: 90 });
  const exclude = [...DEFAULT_EXCLUDE, ...(source.exclude ?? []).map((p) => new RegExp(p, 'i'))];
  const include = source.include ? new RegExp(source.include, 'i') : null;
  const out = new Map();

  for (const e of raw) {
    const rawTitle = cleanTitle(e.title);
    let title = rawTitle;
    if (source.stripTitle) title = cleanTitle(title.replace(new RegExp(source.stripTitle, 'gi'), ''));
    if (!title || exclude.some((re) => re.test(title))) continue;
    if (include && !include.test(title)) continue;

    const allDay = Boolean(e.allDay) || (typeof e.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.start));
    let start = allDay
      ? DateTime.fromISO(String(e.start).slice(0, 10), { zone: ZONE })
      : toDateTime(e.start)?.startOf('minute');
    if (!start?.isValid) continue;
    // Some sites have the wrong timezone configured but put the real time in the title.
    if (source.timeFromTitle && !allDay) {
      const t = parseTime(rawTitle);
      if (t) start = start.set({ hour: t.hour, minute: t.minute });
    }
    let end = e.end && !allDay ? toDateTime(e.end)?.startOf('minute') : null;
    if (!end && e.durationMinutes) end = start.plus({ minutes: e.durationMinutes });
    if (end && (end <= start || end.diff(start, 'hours').hours > 18)) end = null;

    const lastMoment = end ?? (allDay ? start.endOf('day') : start.plus({ hours: 3 }));
    if (lastMoment < from || start > to) continue;

    const key = `${allDay ? start.toISODate() : start.toFormat("yyyy-MM-dd'T'HH:mm")}|${title.toLowerCase()}`;
    if (out.has(key)) continue;

    const event = {
      id: crypto.createHash('sha1').update(`${venue}|${key}`).digest('hex').slice(0, 12),
      title,
      start: allDay ? start.toISODate() : iso(start),
    };
    if (end) event.end = iso(end);
    if (allDay) event.allDay = true;
    if (e.url && /^https?:\/\//.test(e.url)) event.url = e.url;
    out.set(key, event);
  }

  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
