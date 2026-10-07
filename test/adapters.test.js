import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import { parseICS } from '../scrapers/ics.js';
import { fromTribe } from '../scrapers/tribe.js';
import { fromSquarespace } from '../scrapers/squarespace.js';
import { extractEvents } from '../scrapers/jsonld.js';
import { parseEventbrite } from '../scrapers/eventbrite.js';
import { extractJSONValue } from '../scripts/lib/extract.js';
import { parseSpotHopper } from '../scrapers/spothopper.js';
import { parseWix } from '../scrapers/wix.js';
import { parseGigulator } from '../scrapers/gigulator.js';
import { parseHTML } from '../scrapers/html.js';
import scrapeTicketmaster, { parseTicketmaster } from '../scrapers/ticketmaster.js';
import { normalizeEvents } from '../scripts/lib/normalize.js';
import { ZONE } from '../scripts/lib/time.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const window = {
  from: DateTime.fromISO('2026-10-05T00:00:00', { zone: ZONE }),
  to: DateTime.fromISO('2026-11-05T00:00:00', { zone: ZONE }),
};
const normalize = (raw, source = {}) => normalizeEvents(raw, { venue: 'test', source, window });

test('ics: expands recurrences, honours EXDATE, skips cancelled, keeps all-day dates', () => {
  const events = normalize(parseICS(fixture('calendar.ics'), { window }));
  const titles = events.map((e) => `${e.start} ${e.title}`);
  assert.deepEqual(titles, [
    '2026-10-05T20:00:00-05:00 Monday Night Jam',
    '2026-10-09T22:00:00-05:00 Kermit Ruffins & the BBQ Swingers',
    '2026-10-11 Second Line Sunday',
    '2026-10-19T20:00:00-05:00 Monday Night Jam',
    '2026-10-26T20:00:00-05:00 Monday Night Jam',
  ]);
  const kermit = events.find((e) => e.title.startsWith('Kermit'));
  assert.equal(kermit.end, '2026-10-10T01:00:00-05:00');
  assert.equal(kermit.url, 'https://example.com/kermit');
  assert.equal(events.find((e) => e.title === 'Second Line Sunday').allDay, true);
});

test('tribe: converts UTC times and all-day events', () => {
  const data = JSON.parse(fixture('tribe.json'));
  const events = normalize(data.events.map(fromTribe));
  assert.equal(events[0].title, 'Trad Jazz Night – Duke Heitger');
  assert.equal(events[0].start, '2026-10-09T20:00:00-05:00');
  assert.equal(events[0].end, '2026-10-09T23:00:00-05:00');
  assert.deepEqual(events[1], { id: events[1].id, title: 'Jazz Fest Preview', start: '2026-10-11', allDay: true, url: 'https://example.com/event/preview/' });
});

test('squarespace: epoch-millisecond dates and absolute URLs', () => {
  const data = JSON.parse(fixture('squarespace.json'));
  const [e] = normalize(data.upcoming.map((i) => fromSquarespace(i, 'https://venue.example')));
  assert.equal(e.title, "Big Sam's Funky Nation");
  assert.equal(e.start, DateTime.fromMillis(1791860400000).setZone(ZONE).toISO({ suppressMilliseconds: true }));
  assert.equal(e.url, 'https://venue.example/events/big-sam');
});

test('jsonld: finds events in arrays and @graph, filters by location and cancellations', () => {
  const all = extractEvents(fixture('jsonld.html'), 'https://example.com/');
  assert.deepEqual(all.map((e) => e.title), ['Tank and the Bangas', 'Other Venue Show', 'Graph & Event']);
  const howlin = extractEvents(fixture('jsonld.html'), 'https://example.com/', { location: "howlin' wolf" });
  assert.deepEqual(howlin.map((e) => e.title), ['Tank and the Bangas']);
});

test('eventbrite: reads upcomingEvents from hydration data, skips online events', () => {
  const raw = extractJSONValue(fixture('eventbrite.html'), 'upcomingEvents');
  const events = normalize(parseEventbrite(raw));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Rebirth Brass Band');
  assert.equal(events[0].start, '2026-10-06T21:00:00-05:00');
  assert.equal(events[0].end, undefined, 'end equal to start is dropped');
});

test('spothopper: local date + time, duration, hidden events skipped, title prefix stripped', () => {
  const events = normalize(parseSpotHopper(JSON.parse(fixture('spothopper.json'))), { stripTitle: '^FREE LIVE MUSIC:\\s*' });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'NWB');
  assert.equal(events[0].start, '2026-10-09T19:00:00-05:00');
  assert.equal(events[0].end, '2026-10-09T21:00:00-05:00');
});

test('wix: reads Wix Events warmup data and builds event URLs', () => {
  const events = normalize(parseWix(fixture('wix.html'), { url: 'https://bar.example/', eventUrl: 'https://bar.example/events/{slug}' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-10-09T20:00:00-05:00');
  assert.equal(events[0].url, 'https://bar.example/events/george-porter-jr-trio');
});

test("gigulator: carries the date forward to repeat rows", () => {
  const events = normalize(parseGigulator(fixture('gigulator.html'), { url: 'https://club.example/calendar' }));
  assert.deepEqual(
    events.map((e) => [e.start, e.title, e.url]),
    [
      ['2026-10-09T18:00:00-05:00', 'Paradise Jazz Band', 'https://club.example/calendar'],
      ['2026-10-09T22:30:00-05:00', 'The Jump Hounds', 'https://tix.example/jump'],
    ],
  );
});

test('ticketmaster: local date + time, UTC fallback, drops add-ons, day passes, cancellations and TBD dates', () => {
  const events = normalize(parseTicketmaster(JSON.parse(fixture('ticketmaster.json'))));
  assert.deepEqual(events.map((e) => [e.start, e.title]), [
    ['2026-10-09T20:00:00-05:00', 'Trombone Shorty & Orleans Avenue'],
    ['2026-10-16T21:00:00-05:00', 'Galactic'],
    ['2026-10-24', 'Mardi Gras Ball'],
  ]);
  assert.equal(events[0].url, 'https://www.ticketmaster.com/event/1B006123ABCD1234');
  assert.equal(events[2].allDay, true);
  assert.deepEqual(parseTicketmaster({ page: { totalElements: 0 } }), [], 'no _embedded when a venue has no events');
});

test('ticketmaster: a missing API key is a clear error', async () => {
  const saved = process.env.TICKETMASTER_API_KEY;
  delete process.env.TICKETMASTER_API_KEY;
  try {
    await assert.rejects(scrapeTicketmaster({ venueId: 'KovZ917ALJx' }), /TICKETMASTER_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.TICKETMASTER_API_KEY = saved;
  }
});

test('html: selectors, date headers, missing times become all-day', () => {
  const source = {
    url: 'https://dos.example/events/',
    item: '.em-event',
    title: '.em-item-title',
    date: '.em-event-date',
    time: '.em-event-time',
  };
  const events = parseHTML(fixture('html-list.html'), source);
  assert.equal(events[0].title, 'Kris Tokarski');
  assert.equal(events[0].start.toISO({ suppressMilliseconds: true }), '2026-10-09T20:30:00.000-05:00'.replace('.000', ''));
  assert.equal(events[0].url, 'https://dos.example/events/kris');
  assert.equal(events[1].allDay, true);
  assert.equal(events[1].start, '2026-10-10');

  const grouped = parseHTML(fixture('html-list.html'), { ...source, date: undefined, dateHeader: 'h3.day' });
  const show = grouped.find((e) => e.title === 'Grouped Show');
  assert.equal(show.start.toFormat('LL-dd HH:mm'), '10-11 20:00', 'prefers the "show" time over doors');
});

test('normalize: excludes non-shows, dedupes, drops past events, applies timeFromTitle', () => {
  const raw = [
    { title: 'CLOSED for private event', start: '2026-10-09T20:00:00-05:00' },
    { title: 'Big Show', start: '2026-10-09T20:00:00-05:00' },
    { title: 'Big  Show', start: '2026-10-09T20:00:00-05:00' },
    { title: 'Last Year', start: '2025-10-09T20:00:00-05:00' },
    { title: 'Wrong TZ • FRI OCT. 9 • @10PM', start: '2026-10-09T21:00:00-05:00' },
  ];
  const events = normalize(raw, { timeFromTitle: true, stripTitle: '\\s*•.*$' });
  assert.deepEqual(events.map((e) => [e.title, e.start]), [
    ['Big Show', '2026-10-09T20:00:00-05:00'],
    ['Wrong TZ', '2026-10-09T22:00:00-05:00'],
  ]);
});
