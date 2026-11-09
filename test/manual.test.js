import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import { parseManual, checkManual } from '../scrapers/manual.js';
import { normalizeEvents } from '../scripts/lib/normalize.js';
import { ZONE } from '../scripts/lib/time.js';

const data = () => JSON.parse(fs.readFileSync(new URL('./fixtures/manual.json', import.meta.url), 'utf8'));
const window = {
  from: DateTime.fromISO('2026-10-05T00:00:00', { zone: ZONE }),
  to: DateTime.fromISO('2026-11-05T00:00:00', { zone: ZONE }),
};
const normalize = (raw) => normalizeEvents(raw, { venue: 'test', window });

test('manual: keeps music by default, falls back to doors, all-day without a time, end after midnight', () => {
  const events = normalize(parseManual(data(), { slug: 'test' }));
  assert.deepEqual(
    events.map((e) => [e.start, e.title, e.end]),
    [
      ['2026-10-06T21:00:00-05:00', 'The Iguanas', undefined],
      ['2026-10-08T20:30:00-05:00', 'Doors-only Show', undefined],
      ['2026-10-09', 'Second Line Saturday', undefined],
      ['2026-10-10T22:00:00-05:00', 'Late Set', '2026-10-11T01:30:00-05:00'],
    ],
  );
  assert.equal(events[0].url, 'https://www.instagram.com/p/one/');
});

test('manual: kinds option widens the filter', () => {
  const titles = normalize(parseManual(data(), { slug: 'test', kinds: ['music', 'dj'] })).map((e) => e.title);
  assert.ok(titles.includes('DJ Soul Sister'));
  assert.ok(!titles.includes('Trivia Night'));
});

test('manual: checkManual reports format problems and parseManual refuses the file', () => {
  const bad = data();
  bad.venue = 'other';
  bad.events[0].date = 'Nov 13';
  bad.events[1].time = '7pm';
  bad.events[2].kind = 'concert';
  bad.events[3].price2 = '$5';
  const problems = checkManual(bad, 'test');
  assert.equal(problems.length, 5, problems.join('\n'));
  assert.match(problems.join('\n'), /"venue" must be "test"/);
  assert.match(problems.join('\n'), /events\[1\]: "time" must be 24-hour/);
  assert.throws(() => parseManual(bad, { slug: 'test' }), /data\/manual\/test\.json/);
  assert.deepEqual(checkManual(data(), 'test'), []);
});
