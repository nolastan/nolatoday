import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import { parse21stAmendment } from '../scrapers/custom/21st-amendment.js';
import { ZONE } from '../scripts/lib/time.js';

const html = fs.readFileSync(new URL('./fixtures/21st-amendment.html', import.meta.url), 'utf8');
const reference = DateTime.fromISO('2026-11-01T12:00:00', { zone: ZONE });

test('21st Amendment: one event per set, hour ranges read as PM', () => {
  const events = parse21stAmendment(html, { reference });
  assert.deepEqual(
    events.map((e) => `${e.start.toISO({ suppressMilliseconds: true, includeOffset: false })} ${e.title}`),
    [
      '2026-11-01T15:00:00 Coyote Anderson Organ Trio',
      '2026-11-01T20:00:00 Big Mike and the R&B Kings',
      '2026-11-02T20:00:00 The Jelly Roll Stompers',
      '2026-11-03T20:00:00 Dave Hammer',
      '2026-11-30T20:00:00 Coyote Anderson & James Beaumont',
    ],
  );
  assert.ok(events.every((e) => e.allDay === false && e.url.endsWith('/events.html')));
});
