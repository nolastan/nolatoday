import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPast } from '../scripts/lib/recent.js';
import { venuePage } from '../src/templates/venue.js';

const ev = (id, start, title = id) => ({ id, title, start, url: `https://example.com/${id}` });

test('recordPast: keeps the last three shows that have passed, newest first, without links', () => {
  const recent = [ev('a', '2026-11-10T20:00:00-06:00'), ev('b', '2026-11-12T20:00:00-06:00')].map(({ url, ...e }) => e);
  const stored = [ev('c', '2026-11-14T21:00:00-06:00'), ev('d', '2026-11-16T21:00:00-06:00'), ev('e', '2026-11-17T21:00:00-06:00')];
  const out = recordPast(recent, stored, '2026-11-17');
  assert.deepEqual(out.map((e) => e.id), ['d', 'c', 'b']);
  assert.equal(out[0].url, undefined);
});

test('recordPast: a show seen again keeps one entry; nothing passed leaves the list alone', () => {
  const once = recordPast([], [ev('a', '2026-11-10')], '2026-11-11');
  assert.deepEqual(recordPast(once, [ev('a', '2026-11-10')], '2026-11-12'), once);
  assert.deepEqual(recordPast(once, [ev('b', '2026-11-12T20:00:00-06:00')], '2026-11-12'), once);
});

const ctx = {
  config: { siteName: 'NOLA.Today', siteUrl: 'https://nola.today', description: '', mapbox: {}, repo: 'x/y' },
  url: (p) => p,
  asset: (p) => p,
};
const venue = { slug: 'v', name: 'Venue', address: '1 St', lat: 30, lng: -90, status: 'active' };
const past = [{ id: 'p', title: 'Past Band', start: '2026-11-10T20:00:00-06:00' }];

test('venuePage: recent shows sit below the schedule', () => {
  const html = venuePage(ctx, venue, { events: [ev('u', '2099-01-01T20:00:00-06:00', 'Future Band')], recent: past });
  assert.ok(html.indexOf('Upcoming shows') < html.indexOf('Recent shows'));
  assert.match(html, /Nov 10<\/time>\s*<span class="event-title">Past Band<\/span>/);
});

test('venuePage: with nothing upcoming the schedule is hidden and recent shows remain', () => {
  const html = venuePage(ctx, venue, { events: [], recent: past });
  assert.doesNotMatch(html, /Upcoming shows|No upcoming shows/);
  assert.match(html, /Recent shows/);
  assert.match(venuePage(ctx, venue, { events: [] }), /No upcoming shows/);
});
