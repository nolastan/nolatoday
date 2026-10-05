import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { parseLooseDate, parseTime } from '../scripts/lib/dates.js';
import { inferYear, ZONE } from '../scripts/lib/time.js';
import { extractJSONValue } from '../scripts/lib/extract.js';
import { diagnose, issueBody, parseMarker, marker } from '../scripts/lib/diagnose.js';

const ref = DateTime.fromISO('2026-10-05T12:00:00', { zone: ZONE });

test('parseLooseDate handles the formats venue sites use', () => {
  const cases = [
    ['Friday, October 9th, 2026', '8pm', '2026-10-09T20:00'],
    ['Oct 9', '9:30 PM', '2026-10-09T21:30'],
    ['10/09/2026', 'Doors: 7:00 pm / Show: 8:00 pm', '2026-10-09T20:00'],
    ['10.07', 'Show: 10:00PM', '2026-10-07T22:00'],
    ['22 Oct', '6:00 pm', '2026-10-22T18:00'],
    ['2026-10-09', '20:00', '2026-10-09T20:00'],
    ['Thursday, October 8, 2026, 8:00 PM – 11:59 PM', '', '2026-10-08T20:00'],
  ];
  for (const [date, time, expected] of cases) {
    const r = parseLooseDate(date, time, { reference: ref });
    assert.ok(r, `${date} ${time}`);
    assert.equal(r.start.toFormat("yyyy-MM-dd'T'HH:mm"), expected, `${date} ${time}`);
  }
  assert.equal(parseLooseDate('Saturday, Oct 10', '', { reference: ref }).allDay, true);
  assert.equal(parseLooseDate('no date here'), null);
});

test('parseTime: bare evening hours, noon/midnight', () => {
  assert.deepEqual(parseTime('9:00'), { hour: 21, minute: 0, label: '' });
  assert.equal(parseTime('12pm').hour, 12);
  assert.equal(parseTime('12am').hour, 0);
  assert.equal(parseTime('Ages 21+'), null);
});

test('inferYear rolls early-year dates forward in the fall', () => {
  assert.equal(inferYear(1, 3, DateTime.fromISO('2026-12-15', { zone: ZONE })), 2027);
  assert.equal(inferYear(10, 1, ref), 2026);
  assert.equal(inferYear(9, 20, ref), 2026);
});

test('extractJSONValue handles strings containing brackets', () => {
  const html = 'x = {"a":1,"items":[{"t":"]["},{"t":"b\\"}"}],"z":2}';
  assert.deepEqual(extractJSONValue(html, 'items'), [{ t: '][' }, { t: 'b"}' }]);
  assert.equal(extractJSONValue(html, 'missing'), undefined);
});

test('diagnose: classifies broken, empty, and source-less venues', () => {
  const now = DateTime.fromISO('2026-10-20T12:00:00Z');
  const venues = [
    { slug: 'broken', name: 'Broken', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'x' }] },
    { slug: 'flaky', name: 'Flaky', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'x' }] },
    { slug: 'empty', name: 'Empty', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'x' }] },
    { slug: 'new', name: 'New', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'x' }] },
    { slug: 'fine', name: 'Fine', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'x' }] },
    { slug: 'nosource', name: 'No Source', status: 'active', address: '1 St', sources: [] },
    { slug: 'closed', name: 'Closed', status: 'closed', address: '1 St', sources: [] },
  ];
  const status = {
    venues: {
      broken: { ok: false, consecutiveFailures: 3, error: 'HTTP 404', count: 5 },
      flaky: { ok: false, consecutiveFailures: 1, count: 5 },
      empty: { ok: true, count: 0, lastNonEmpty: '2026-09-01T00:00:00Z', firstSeen: '2026-08-01T00:00:00Z' },
      new: { ok: true, count: 0, lastNonEmpty: null, firstSeen: '2026-10-19T00:00:00Z' },
      fine: { ok: true, count: 12 },
    },
  };
  const result = diagnose(venues, status, now).map((p) => `${p.kind}:${p.slug}`);
  assert.deepEqual(result, ['broken:broken', 'empty:empty', 'needs-source:nosource']);

  const body = issueBody(diagnose(venues, status, now)[0], { repo: 'o/r' });
  assert.deepEqual(parseMarker(body), { slug: 'broken', kind: 'broken' });
  assert.match(body, /HTTP 404/);
  assert.match(body, /node scripts\/scrape\.js --venue broken --dry/);
  assert.equal(parseMarker(marker('a-b', 'empty')).slug, 'a-b');
});
