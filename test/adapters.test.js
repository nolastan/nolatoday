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
import scrapeJamBase, { parseJamBase, quotaProblem, readQuota, QUOTA_PROBE_ATTEMPTS, isQuotaProbeMessage } from '../scrapers/jambase.js';
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

test('jambase: per-venue events, local times, strips "at <venue>", custom titles, drops cancelled and postponed shows', () => {
  const { events } = JSON.parse(fixture('jambase.json'));
  const snug = normalize(parseJamBase(events, 'jambase:111'));
  assert.deepEqual(snug.map((e) => [e.start, e.title]), [
    ['2026-10-12T19:30:00-05:00', 'Charmaine Neville Band'],
    ['2026-10-12T21:30:00-05:00', 'Charmaine Neville Band'],
    ['2026-10-14T19:30:00-05:00', 'Uptown Jazz Orchestra'],
  ]);
  assert.equal(snug[0].url, 'https://www.jambase.com/show/charmaine-neville-band-snug-harbor-20261012');

  const chickie = normalize(parseJamBase(events, 'jambase:222'));
  assert.deepEqual(chickie.map((e) => [e.start, e.title]), [
    ['2026-10-06T20:00:00-05:00', 'Chris Smither: Album Release Show'],
    ['2026-10-09', 'John Boutté'],
  ]);
  assert.equal(chickie[1].allDay, true);
});

test('jambase: quota guard', () => {
  const quota = { plan: 'developer', quota: 1000, usedCalls: 300, remainingCalls: 700, overageCalls: 0, noMonthlyCap: false, limitType: 'soft', periodEnd: '2026-11-01T00:00:00.000Z' };
  assert.equal(quotaProblem(quota), null);
  assert.match(quotaProblem({ ...quota, usedCalls: 950, remainingCalls: 50 }), /50 of 1000 calls left until 2026-11-01/);
  assert.match(quotaProblem({ ...quota, remainingCalls: 0, overageCalls: 3 }), /3 calls over/);
  assert.match(quotaProblem({ ...quota, remainingCalls: null }), /did not report/);
  assert.equal(quotaProblem({ ...quota, quota: null, remainingCalls: null, noMonthlyCap: true, limitType: 'no_monthly_cap' }), null);
});

// Stub fetch for the API calls; records each request.
async function withJamBase(responses, fn) {
  const saved = { fetch: globalThis.fetch, key: process.env.JAMBASE_API_KEY };
  const calls = [];
  process.env.JAMBASE_API_KEY = 'jbd_test';
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), auth: init.headers.authorization });
    const [status, body] = responses(u);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.JAMBASE_API_KEY;
    else process.env.JAMBASE_API_KEY = saved.key;
  }
}

const roomyQuota = { plan: 'developer', quota: 1000, remainingCalls: 800, overageCalls: 0, noMonthlyCap: false, limitType: 'soft' };

test('jambase: one batched request per run for every jambase venue, following pages', async () => {
  const { events } = JSON.parse(fixture('jambase.json'));
  const venues = [
    { slug: 'snug-harbor', sources: [{ type: 'jsonld', url: 'https://example.com' }, { type: 'jambase', venueId: 'jambase:111' }] },
    { slug: 'chickie-wah-wah', sources: [{ type: 'jambase', venueId: '222' }] },
    { slug: 'other', sources: [{ type: 'ics', url: 'https://example.com/c.ics' }] },
  ];
  await withJamBase(
    (u) => {
      if (u.pathname === '/v3/quota') return [200, roomyQuota];
      const page = Number(u.searchParams.get('page'));
      return [200, { success: true, pagination: { page, totalPages: 2 }, events: page === 1 ? events.slice(0, 3) : events.slice(3) }];
    },
    async (calls) => {
      const ctx = { window, venues };
      const [snug, chickie] = await Promise.all([
        scrapeJamBase(venues[0].sources[1], { ...ctx, venue: venues[0] }),
        scrapeJamBase(venues[1].sources[0], { ...ctx, venue: venues[1] }),
      ]);
      assert.equal(snug.length, 3);
      assert.equal(chickie.length, 2);
      assert.deepEqual(calls.map((c) => [c.path, c.params.page]), [['/v3/quota', undefined], ['/v3/events', '1'], ['/v3/events', '2']]);
      assert.equal(calls[1].params.venueId, 'jambase:111|jambase:222');
      assert.equal(calls[1].params.eventDateTo, '2026-11-05');
      assert.equal(calls[1].params.eventDateFrom, undefined);
      assert.equal(calls[1].auth, 'Bearer jbd_test');
    },
  );
});

test('jambase: skips the run when the quota is low, and never retries a failed call', async () => {
  await withJamBase(
    () => [200, { ...roomyQuota, remainingCalls: 20, periodEnd: '2026-11-01T00:00:00Z' }],
    async (calls) => {
      await assert.rejects(scrapeJamBase({ venueId: 'jambase:111' }, { window, venues: [] }), /quota is low \(20 of 1000 calls left until 2026-11-01\)/);
      assert.deepEqual(calls.map((c) => c.path), ['/v3/quota']);
    },
  );
  await withJamBase(
    (u) => (u.pathname === '/v3/quota' ? [200, roomyQuota] : [429, { success: false }]),
    async (calls) => {
      await assert.rejects(scrapeJamBase({ venueId: 'jambase:111' }, { window, venues: [] }), /HTTP 429/);
      assert.deepEqual(calls.map((c) => c.path), ['/v3/quota', '/v3/events']);
    },
  );
});

test('jambase: retries only the unmetered quota probe and never calls events while it is down', async () => {
  assert.equal(QUOTA_PROBE_ATTEMPTS, 3);
  assert.equal(isQuotaProbeMessage('HTTP 503 for https://api.data.jambase.com/v3/quota'), true);
  assert.equal(isQuotaProbeMessage('jambase: HTTP 504 for https://api.data.jambase.com/v3/quota'), true);
  assert.equal(isQuotaProbeMessage('HTTP 500 for https://api.data.jambase.com/v3/quota'), false);
  assert.equal(isQuotaProbeMessage('HTTP 401 for https://api.data.jambase.com/v3/quota'), false);
  assert.equal(isQuotaProbeMessage('HTTP 503 for https://api.data.jambase.com/v3/events?venueId=jambase:357128'), false);

  const outage = new Error('HTTP 503 for https://api.data.jambase.com/v3/quota');
  const quota = { ...roomyQuota };
  let calls = 0;
  const got = await readQuota(
    async () => {
      calls += 1;
      if (calls < 3) throw outage;
      return quota;
    },
    { wait: async () => {} },
  );
  assert.equal(got, quota);
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    readQuota(
      async () => {
        calls += 1;
        throw outage;
      },
      { wait: async () => {} },
    ),
    /HTTP 503 for https:\/\/api\.data\.jambase\.com\/v3\/quota$/,
  );
  assert.equal(calls, 3);

  for (const message of [
    'HTTP 401 for https://api.data.jambase.com/v3/quota',
    'HTTP 500 for https://api.data.jambase.com/v3/quota',
    'HTTP 503 for https://api.data.jambase.com/v3/events?venueId=jambase:357128',
    'fetch failed',
  ]) {
    calls = 0;
    await assert.rejects(
      readQuota(
        async () => {
          calls += 1;
          throw new Error(message);
        },
        { wait: async () => {} },
      ),
      new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.equal(calls, 1, message);
  }
});

test('jambase: a quota probe 503 is retried and does not fetch events until quota is known', async () => {
  let quotaHits = 0;
  await withJamBase(
    (u) => {
      if (u.pathname === '/v3/quota') {
        quotaHits += 1;
        if (quotaHits < 3) return [503, { title: 'unavailable' }];
        return [200, roomyQuota];
      }
      return [200, { success: true, pagination: { page: 1, totalPages: 1 }, events: [] }];
    },
    async (calls) => {
      const events = await scrapeJamBase({ venueId: 'jambase:357128' }, { window, venues: [] });
      assert.deepEqual(events, []);
      assert.deepEqual(
        calls.map((call) => call.path),
        ['/v3/quota', '/v3/quota', '/v3/quota', '/v3/events'],
      );
      assert.equal(calls[0].auth, 'Bearer jbd_test');
    },
  );
});

test('jambase: an exhausted quota probe does not call the metered events endpoint', async () => {
  await withJamBase(
    (u) => (u.pathname === '/v3/quota' ? [503, {}] : [200, { events: [{ identifier: 'should-not-run' }] }]),
    async (calls) => {
      await assert.rejects(
        scrapeJamBase({ venueId: 'jambase:65930' }, { window, venues: [] }),
        (err) => {
          assert.equal(err.message, 'HTTP 503 for https://api.data.jambase.com/v3/quota');
          assert.equal(err.message.includes('jbd_test'), false);
          return true;
        },
      );
      assert.deepEqual(calls.map((call) => call.path), ['/v3/quota', '/v3/quota', '/v3/quota']);
    },
  );
});

test('jambase: events 503, quota 401, and a network error fail closed without probe retries', async () => {
  await withJamBase(
    (u) => (u.pathname === '/v3/quota' ? [200, roomyQuota] : [503, {}]),
    async (calls) => {
      await assert.rejects(
        scrapeJamBase({ venueId: 'jambase:111' }, { window, venues: [] }),
        /HTTP 503 for https:\/\/api\.data\.jambase\.com\/v3\/events\?/,
      );
      assert.deepEqual(calls.map((call) => call.path), ['/v3/quota', '/v3/events']);
    },
  );
  await withJamBase(
    () => [401, { title: 'Unauthorized', detail: 'Missing Authorization header' }],
    async (calls) => {
      await assert.rejects(
        scrapeJamBase({ venueId: 'jambase:111' }, { window, venues: [] }),
        /HTTP 401 for https:\/\/api\.data\.jambase\.com\/v3\/quota$/,
      );
      assert.deepEqual(calls.map((call) => call.path), ['/v3/quota']);
    },
  );
  await withJamBase(
    () => {
      throw new TypeError('fetch failed');
    },
    async (calls) => {
      await assert.rejects(scrapeJamBase({ venueId: 'jambase:111' }, { window, venues: [] }), /fetch failed/);
      assert.deepEqual(calls.map((call) => call.path), ['/v3/quota']);
    },
  );
});

test('jambase: a missing API key is a clear error', async () => {
  const saved = process.env.JAMBASE_API_KEY;
  delete process.env.JAMBASE_API_KEY;
  try {
    await assert.rejects(scrapeJamBase({ venueId: 'jambase:111' }, { venues: [] }), /JAMBASE_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.JAMBASE_API_KEY = saved;
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
