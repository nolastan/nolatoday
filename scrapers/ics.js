import ical from 'node-ical';
import { fetchText } from '../scripts/lib/http.js';
import { now } from '../scripts/lib/time.js';

/**
 * iCalendar feeds: Google Calendar public .ics URLs, WordPress "The Events
 * Calendar" (?ical=1), Squarespace, etc. Recurring events are expanded.
 *
 * source: { type: "ics", url }
 */
export default async function scrapeICS(source, { window } = {}) {
  const text = await fetchText(source.url, { headers: { accept: 'text/calendar,*/*' } });
  return parseICS(text, { window });
}

export function parseICS(text, { window } = {}) {
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Response is not an iCalendar feed');
  const from = (window?.from ?? now().startOf('day')).toJSDate();
  const to = (window?.to ?? now().plus({ days: 90 })).toJSDate();
  const data = ical.sync.parseICS(text);
  const events = [];
  for (const item of Object.values(data)) {
    if (item.type !== 'VEVENT' || !item.start) continue;
    if (item.status && String(item.status).toUpperCase() === 'CANCELLED') continue;
    let instances;
    if (item.rrule) {
      instances = ical.expandRecurringEvent(item, { from, to });
    } else {
      instances = [item];
    }
    for (const inst of instances) {
      const ev = inst.event ?? inst;
      const title = text_(inst.summary ?? ev.summary);
      if (!title) continue;
      const start = inst.start;
      const allDay = Boolean(inst.isFullDay ?? start?.dateOnly ?? ev.datetype === 'date');
      if (!item.rrule && (start > to || (inst.end ?? start) < from)) continue;
      events.push({
        uid: `${ev.uid ?? title}${item.rrule ? '@' + start.toISOString() : ''}`,
        title,
        start: allDay ? localDay(start) : start,
        end: allDay ? null : inst.end ?? null,
        allDay,
        url: text_(ev.url?.val ?? ev.url) || undefined,
        description: text_(ev.description) || undefined,
      });
    }
  }
  return events;
}

// node-ical returns objects like { params, val } for some properties.
function text_(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'val' in v) v = v.val;
  return String(v).trim();
}

// All-day dates are floating; keep the calendar date rather than the UTC instant.
function localDay(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (date.tz && date.tz !== 'Etc/UTC') {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: date.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(date);
  }
  return `${y}-${m}-${d}`;
}
