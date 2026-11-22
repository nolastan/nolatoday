import { DateTime } from 'luxon';
import { fetchText } from '../../scripts/lib/http.js';
import { now, ZONE } from '../../scripts/lib/time.js';

/**
 * Hatch+Harvest's homepage lists the food truck's week under "Where to find the
 * food truck this week." as <br>-separated lines with no year:
 *
 *   Thursday, November 19th @ Miel Brewery 5-9pm
 *   Sunday, November 15th @ Farmer's Butcher & Farm stop 11-3pm
 *
 * Each line becomes an event whose `location` is the place text; the food source
 * config maps that name to a place (scripts/lib/food.js). Other lines (the standing
 * "every Thursday and Saturday" note, closures, the Tuesday prepared-meal pickup)
 * are ignored. The year is the one that puts the date nearest the reference day
 * on the right weekday.
 *
 * source: { type: "custom", name: "hatch-and-harvest", url }
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const LINE =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*@\s*(.+?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;

export default async function scrapeHatchAndHarvest(source) {
  return parseHatchAndHarvest(await fetchText(source.url), { url: source.url });
}

/** Text lines of the page: tags and <br> become line breaks, entities decoded. */
export function pageLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#039;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function parseHatchAndHarvest(html, { url, reference = now() } = {}) {
  const events = [];
  const seen = new Set();
  for (const line of pageLines(html)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, weekday, monthName, day, place, sh, sm, smer, eh, em, emer] = m;
    const month = MONTHS.findIndex((name) => name.startsWith(monthName.toLowerCase()) && monthName.length >= 3) + 1;
    if (!month) continue;
    const date = resolveYear(month, Number(day), WEEKDAYS.indexOf(weekday.toLowerCase()) + 1, reference);
    if (!date) continue;
    const end = to24(Number(eh), Number(em ?? 0), emer.toLowerCase());
    // "5-9pm" is 5pm; "11-3pm" is 11am: the start takes the end's meridiem unless that puts it after the end.
    let start = to24(Number(sh), Number(sm ?? 0), (smer ?? emer).toLowerCase());
    if (!smer && start > end) start = to24(Number(sh), Number(sm ?? 0), emer.toLowerCase() === 'pm' ? 'am' : 'pm');
    const key = `${date}|${place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = (minutes) => DateTime.fromISO(date, { zone: ZONE }).plus({ minutes }).toISO({ suppressMilliseconds: true });
    events.push({ title: `Hatch+Harvest @ ${place}`, location: place, start: at(start), end: at(end), url });
  }
  return events;
}

function to24(hour, minute, meridiem) {
  const h = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  return h * 60 + minute;
}

/** The date with this month/day on this weekday (1 = Monday) nearest the reference, or null. */
function resolveYear(month, day, weekday, reference) {
  const year = reference.setZone(ZONE).year;
  const candidates = [year - 1, year, year + 1]
    .map((y) => DateTime.fromObject({ year: y, month, day }, { zone: ZONE }))
    .filter((d) => d.isValid && d.weekday === weekday);
  if (!candidates.length) return null;
  const ref = reference.setZone(ZONE).startOf('day');
  candidates.sort((a, b) => Math.abs(a.diff(ref).toMillis()) - Math.abs(b.diff(ref).toMillis()));
  return candidates[0].toISODate();
}
