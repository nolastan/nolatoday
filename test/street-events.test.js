import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanTitle, dedupe, fromStreetPermit, hours, mapStreetEvent, streetEventVerdict } from '../scripts/lib/street-events.js';

// Five rows the City of New Orleans published (staff checklists trimmed off), plus made-up
// rows (TEST-…) for the cases that must be refused or merged. No private event from the
// real feed is stored here.
const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/street-events/permits.json', import.meta.url), 'utf8'));
const row = (id) => rows.find((r) => r.permitnumber === id);

test('public festivals, markets, block parties and concerts come through', () => {
  const fries = fromStreetPermit(row('26-30049-SPMA')).record;
  assert.equal(fries.name, 'French Fry Festival');
  assert.equal(fries.category, 'festival');
  assert.equal(fries.date, '2026-11-20');
  assert.equal(fries.end_date, '2026-11-21');
  assert.equal(fries.start_time, null);
  assert.equal(fries.street, 'N. Peters St');
  assert.deepEqual(fries.point, [-90.054472, 29.961359]);

  const market = fromStreetPermit(row('26-33380-SPMA')).record;
  assert.equal(market.name, 'Arts Market New Orleans', 'the counter "(8)" comes off');
  assert.equal(market.category, 'market');

  const concert = fromStreetPermit(row('25-35933-SPMA')).record;
  assert.equal(concert.category, 'concert');
  assert.equal(concert.start_time, '16:00');
  assert.equal(concert.end_time, '21:00');

  const block = fromStreetPermit(row('26-31737-SPMA')).record;
  assert.equal(block.category, 'block_party');
  assert.deepEqual([block.start_time, block.end_time], ['12:00', '20:00']);
});

test('nothing but the title, date, hours, street and point is published', () => {
  const record = fromStreetPermit(row('26-30049-SPMA')).record;
  const text = JSON.stringify(record);
  assert.doesNotMatch(text, /Fry Forward Foundation|vending|Portolets|NOFD/);
});

test('private, logistics, corporate, closed and withdrawn applications are refused', () => {
  assert.equal(streetEventVerdict(row('TEST-1')), 'not a public event');
  assert.equal(streetEventVerdict(row('TEST-2')), 'not a public event');
  assert.equal(streetEventVerdict(row('TEST-3')), 'not a public event', 'a business party that sells nothing and charges nothing');
  assert.equal(streetEventVerdict(row('TEST-4')), 'not a public event');
  assert.equal(streetEventVerdict(row('TEST-5')), 'withdrawn, denied or void');
  assert.equal(streetEventVerdict(row('26-31839-SPMA')), 'withdrawn, denied or void', 'staff flagged it as incomplete');
  assert.equal(streetEventVerdict(row('TEST-8')), 'not a public event', 'parades are left to the parade pipeline');
});

test('hours: only the end needs AM or PM, and set-up hours are not event hours', () => {
  assert.deepEqual(hours('Live music. 1 pm - 7 pm, Attendees: 3,000.'), { start: { hour: 13, minute: 0 }, end: { hour: 19, minute: 0 } });
  assert.deepEqual(hours('7 - 9 pm 11/19/2026'), { start: { hour: 19, minute: 0 }, end: { hour: 21, minute: 0 } });
  assert.deepEqual(hours('11:00 AM - 6:00 PM'), { start: { hour: 11, minute: 0 }, end: { hour: 18, minute: 0 } });
  assert.equal(hours('Street closure 5:00 am - 2:00 am'), null);
  assert.equal(hours('12:00 AM to 11:59 PM'), null);
  assert.equal(hours('No times here.'), null);
  assert.equal(hours('Ok.\nAwaiting:\nVendor list 1 pm - 7 pm'), null, 'the staff checklist is not read');
});

test('cleanTitle drops staff notes, counters, years and block numbers', () => {
  assert.equal(cleanTitle('Freret Market(1)'), 'Freret Market');
  assert.equal(cleanTitle('2026 Willow Block Party'), 'Willow Block Party');
  assert.equal(cleanTitle('Freret Street Festival 2026 - 4400'), 'Freret Street Festival');
  assert.equal(cleanTitle('Greek Festival 2026'), 'Greek Festival');
});

test('applications for the same event are merged; the earliest-filed one is kept', () => {
  const records = ['TEST-6', 'TEST-7', '26-30049-SPMA'].map((id) => fromStreetPermit(row(id)).record);
  assert.ok(records.every(Boolean));
  const { events, merged } = dedupe(records);
  assert.equal(events.length, 2);
  const festival = events.find((e) => e.permit_number === 'TEST-6');
  assert.deepEqual(merged, [{ id: 'example-festival-stage-2026-11-22', into: festival.id }]);
  // The kept record had no usable hours (set-up times); it takes the merged one's.
  assert.deepEqual([festival.start_time, festival.end_time], ['19:00', '21:00']);
});

test('the map gets one item per day, with hours when the city gave them', () => {
  const fries = fromStreetPermit(row('26-30049-SPMA')).record;
  assert.deepEqual(mapStreetEvent(fries, { from: '2026-11-18', to: '2026-11-26' }).map((i) => [i.s, i.a]), [['2026-11-20', 1], ['2026-11-21', 1]]);
  const block = fromStreetPermit(row('26-31737-SPMA')).record;
  const items = mapStreetEvent(block, { from: '2026-11-27', to: '2026-12-01' });
  assert.equal(items.length, 1, 'days before the window are left out');
  assert.equal(items[0].s, '2026-11-27T12:00:00-06:00');
  assert.equal(items[0].e, '2026-11-27T20:00:00-06:00');
  assert.equal(items[0].c, 'Block party');
  assert.equal(items[0].st, 'Saint Joseph Street');
});
