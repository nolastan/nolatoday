import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { parseLooseDate, parseTime } from '../scripts/lib/dates.js';
import { inferYear, ZONE } from '../scripts/lib/time.js';
import { extractJSONValue } from '../scripts/lib/extract.js';
import {
  diagnose,
  issueBody,
  issueDisposition,
  closeReason,
  quotaProbeHoldBody,
  quotaProbeHoldTitle,
  parseMarker,
  marker,
} from '../scripts/lib/diagnose.js';

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
  assert.match(body, /Find where the venue publishes its schedule/);
  assert.match(body, /node scripts\/scrape\.js --venue broken --dry/);
  assert.equal(parseMarker(marker('a-b', 'empty')).slug, 'a-b');
});

// Copied from data/status.json at 9ae911957039dbb80f6e72ecd78b8355af8ca12f.
// generatedAt 2026-10-10T07:45:22.364-05:00. Issues 80 and 81 quoted this error.
const QUOTA_PROBE = 'HTTP 503 for https://api.data.jambase.com/v3/quota';

function quotaEntry(count) {
  return {
    ok: false,
    consecutiveFailures: 2,
    count,
    lastSuccess: '2026-10-09T17:46:09.479-05:00',
    lastRun: '2026-10-10T07:45:22.364-05:00',
    error: `jambase: ${QUOTA_PROBE}`,
    sources: [{ type: 'jambase', ok: false, error: QUOTA_PROBE }],
  };
}

test('diagnose: the recorded JamBase quota probe is not a venue-source repair', () => {
  const now = DateTime.fromISO('2026-10-10T12:45:35Z');
  const venues = [
    { slug: 'snug-harbor', name: 'Snug Harbor', status: 'active', address: '626 Frenchmen Street', website: 'https://www.snugjazz.com', sources: [{ type: 'jambase', venueId: 'jambase:357128' }] },
    { slug: 'chickie-wah-wah', name: 'Chickie Wah Wah', status: 'active', address: '2828 Canal Street', website: 'https://chickiewahwah.com', sources: [{ type: 'jambase', venueId: 'jambase:65930' }] },
    { slug: 'events-down', name: 'Events Down', status: 'active', address: '1 St', sources: [{ type: 'jambase', venueId: 'jambase:1' }] },
    { slug: 'not-found', name: 'Not Found', status: 'active', address: '1 St', sources: [{ type: 'ics', url: 'https://example.test/cal.ics' }] },
    { slug: 'forbidden', name: 'Forbidden', status: 'active', address: '1 St', sources: [{ type: 'jsonld', url: 'https://example.test/tixr' }] },
    { slug: 'quota-low', name: 'Quota Low', status: 'active', address: '1 St', sources: [{ type: 'jambase', venueId: 'jambase:2' }] },
    { slug: 'mixed', name: 'Mixed', status: 'active', address: '1 St', sources: [{ type: 'jambase' }, { type: 'ics', url: 'https://example.test/cal.ics' }] },
    { slug: 'probe-500', name: 'Probe 500', status: 'active', address: '1 St', sources: [{ type: 'jambase' }] },
    { slug: 'probe-401', name: 'Probe 401', status: 'active', address: '1 St', sources: [{ type: 'jambase' }] },
    { slug: 'probe-502', name: 'Probe 502', status: 'active', address: '1 St', sources: [{ type: 'jambase' }] },
  ];
  const eventsError = 'HTTP 503 for https://api.data.jambase.com/v3/events?venueId=jambase%3A1&perPage=100&page=1';
  const status = {
    venues: {
      'snug-harbor': quotaEntry(16),
      'chickie-wah-wah': quotaEntry(24),
      'events-down': { ok: false, consecutiveFailures: 2, error: `jambase: ${eventsError}`, sources: [{ type: 'jambase', ok: false, error: eventsError }] },
      'not-found': { ok: false, consecutiveFailures: 2, error: 'ics: HTTP 404 for https://example.test/cal.ics', sources: [{ type: 'ics', ok: false, error: 'HTTP 404 for https://example.test/cal.ics' }] },
      forbidden: { ok: false, consecutiveFailures: 2, error: 'jsonld: HTTP 403 for https://example.test/tixr', sources: [{ type: 'jsonld', ok: false, error: 'HTTP 403 for https://example.test/tixr' }] },
      'quota-low': {
        ok: false,
        consecutiveFailures: 2,
        error: 'jambase: JamBase API quota is low (20 of 1000 calls left until 2026-11-01); skipped this run to avoid overage charges',
        sources: [{ type: 'jambase', ok: false, error: 'JamBase API quota is low (20 of 1000 calls left until 2026-11-01); skipped this run to avoid overage charges' }],
      },
      mixed: {
        ok: false,
        consecutiveFailures: 2,
        error: `jambase: ${QUOTA_PROBE} | ics: HTTP 404 for https://example.test/cal.ics`,
        sources: [
          { type: 'jambase', ok: false, error: QUOTA_PROBE },
          { type: 'ics', ok: false, error: 'HTTP 404 for https://example.test/cal.ics' },
        ],
      },
      'probe-500': { ok: false, consecutiveFailures: 2, error: 'jambase: HTTP 500 for https://api.data.jambase.com/v3/quota', sources: [{ type: 'jambase', ok: false, error: 'HTTP 500 for https://api.data.jambase.com/v3/quota' }] },
      'probe-401': { ok: false, consecutiveFailures: 2, error: 'jambase: HTTP 401 for https://api.data.jambase.com/v3/quota', sources: [{ type: 'jambase', ok: false, error: 'HTTP 401 for https://api.data.jambase.com/v3/quota' }] },
      'probe-502': { ok: false, consecutiveFailures: 2, error: 'HTTP 502 for https://api.data.jambase.com/v3/quota' },
    },
  };
  assert.deepEqual(diagnose(venues, status, now).map((problem) => `${problem.kind}:${problem.slug}`), [
    'broken:events-down',
    'broken:not-found',
    'broken:forbidden',
    'broken:quota-low',
    'broken:mixed',
    'broken:probe-500',
    'broken:probe-401',
  ]);

  const entry = status.venues['snug-harbor'];
  const venue = venues[0];
  assert.equal(issueDisposition({ wanted: new Set(), key: 'snug-harbor|broken', entry, venueActive: true }), 'hold');
  assert.equal(issueDisposition({ wanted: new Set(['snug-harbor|broken']), key: 'snug-harbor|broken', entry, venueActive: true }), 'keep');
  assert.equal(issueDisposition({ wanted: new Set(), key: 'snug-harbor|broken', entry, venueActive: false }), 'close');
  assert.equal(
    issueDisposition({
      wanted: new Set(),
      key: 'snug-harbor|broken',
      entry: { ok: true, count: 16, consecutiveFailures: 0 },
      venueActive: true,
    }),
    'close',
  );
  assert.equal(issueDisposition({ wanted: new Set(), key: 'not-found|broken', entry: status.venues['not-found'], venueActive: true }), 'close');
  const held = quotaProbeHoldBody({ slug: venue.slug, venue, entry }, { repo: 'nolastan/nolatoday' });
  assert.equal(quotaProbeHoldTitle(venue), 'JamBase quota probe failed: Snug Harbor');
  assert.match(held, /HTTP 503 for https:\/\/api\.data\.jambase\.com\/v3\/quota/);
  assert.match(held, /2026-10-09T17:46:09\.479-05:00/);
  assert.doesNotMatch(held, /Find where the venue publishes/);
  assert.equal(parseMarker(held).kind, 'broken');
  assert.match(closeReason({ venue, entry }), /found 16 upcoming events/);
});
