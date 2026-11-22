import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fromTribe } from '../scrapers/tribe.js';
import { foodFromCalendar, checkVendor, checkPlaces } from '../scripts/lib/food.js';

const tribe = () => JSON.parse(fs.readFileSync(new URL('./fixtures/food-tribe.json', import.meta.url), 'utf8')).events.map(fromTribe);
const config = { include: 'pop-?up|food truck', rename: { '^Taste of Kultures': 'Taste of Kultures' } };

test('food: picks pop-ups from a host calendar and names the vendor', () => {
  const found = foodFromCalendar(tribe(), config);
  assert.deepEqual(
    found.map((e) => e.vendor),
    ['Après Vous', 'Taste of Kultures', 'Coop’s Burgers', 'Hatch & Harvest', 'Döner Party'],
  );
  // Trivia, the closure and the canceled pop-up are left out.
  assert.ok(!found.some((e) => /trivia|closed|waska/i.test(e.title)));
  assert.equal(found[0].start, '2026-11-22T18:00:00Z');
  assert.equal(found[0].end, '2026-11-22T23:00:00Z');
  assert.equal(found[0].url, 'https://example.com/event/apres-vous/');
});

const vendor = () => ({
  slug: 'porchettaboudit',
  name: 'Porchettaboudit',
  icon: 'pig',
  type: 'Pop-up',
  updated: '2026-11-15',
  events: [{ date: '2026-11-17', time: '18:00', place: 'the-kingpin', confirmedOn: '2026-11-02', url: 'https://www.instagram.com/p/x/' }],
});

test('food: checkVendor accepts a good file and reports problems', () => {
  const placeKeys = new Set(['the-kingpin']);
  assert.deepEqual(checkVendor(vendor(), 'porchettaboudit', { placeKeys }), []);
  const bad = vendor();
  bad.icon = 'taco-truck';
  bad.events[0].time = '6pm';
  bad.events[0].place = 'nowhere';
  delete bad.events[0].confirmedOn;
  bad.events[0].extra = 1;
  const problems = checkVendor(bad, 'porchettaboudit', { placeKeys }).join('\n');
  for (const want of ['"icon"', '"time"', 'place "nowhere"', '"confirmedOn"', 'unknown field "extra"']) assert.match(problems, new RegExp(want));
});

test('food: checkPlaces catches venue keys and coordinates outside New Orleans', () => {
  const problems = checkPlaces(
    {
      'friendly-bar': { name: 'The Friendly Bar', address: '2301 Chartres St', lat: 29.96, lng: -90.05 },
      'the-kingpin': { name: 'The Kingpin', address: '1307 Lyons St', lat: 29.92, lng: -90.1 },
      swapped: { name: 'Swapped', address: '1 Main St', lat: -90.05, lng: 29.96 },
    },
    new Set(['the-kingpin']),
  ).join('\n');
  assert.match(problems, /"the-kingpin" is a venue/);
  assert.match(problems, /"swapped": lat\/lng/);
  assert.doesNotMatch(problems, /friendly-bar/);
});

test('food: Hatch+Harvest schedule lines become stops with a year and the right meridiem', async () => {
  const { DateTime } = await import('luxon');
  const { parseHatchAndHarvest } = await import('../scrapers/custom/hatch-and-harvest.js');
  const html = fs.readFileSync(new URL('./fixtures/hatch-and-harvest.html', import.meta.url), 'utf8');
  const reference = DateTime.fromISO('2026-11-10T12:00:00', { zone: 'America/Chicago' });
  const events = parseHatchAndHarvest(html, { url: 'https://hatchandharvest.net/', reference });
  assert.deepEqual(
    events.map((e) => [e.location, e.start, e.end]),
    [
      ['Miel Brewery', '2026-11-12T17:00:00-06:00', '2026-11-12T21:00:00-06:00'],
      ['Miel Brewery', '2026-11-14T12:00:00-06:00', '2026-11-14T18:00:00-06:00'],
      ["Farmer's Butcher & Farm stop", '2026-11-15T11:00:00-06:00', '2026-11-15T15:00:00-06:00'],
      ['Miel Brewery', '2026-12-03T17:00:00-06:00', '2026-12-03T21:00:00-06:00'],
    ],
  );
  // Read in January, "December 3rd" (a Thursday) is still last year's, not a Thursday-less 2027 date.
  const january = parseHatchAndHarvest(html, { reference: DateTime.fromISO('2027-01-05', { zone: 'America/Chicago' }) });
  assert.equal(january.at(-1).start.slice(0, 10), '2026-12-03');
});

test('food: a vendor site maps location names to places, never addresses', async () => {
  const { extractEvents } = await import('../scrapers/jsonld.js');
  const { foodFromVendorSite } = await import('../scripts/lib/food.js');
  const html = fs.readFileSync(new URL('./fixtures/food-vendor-jsonld.html', import.meta.url), 'utf8');
  const raw = extractEvents(html, 'https://bugginoutboils.com/');
  assert.equal(raw[0].location, 'Bayou Beer Garden');
  const config = { places: { '^bayou beer garden': 'bayou-beer-garden' }, wallClock: true };
  const { events, unmapped } = foodFromVendorSite(raw, config);
  assert.deepEqual(unmapped, ['Somewhere New']);
  assert.equal(events.length, 1);
  assert.equal(events[0].place, 'bayou-beer-garden');
  // The page stamps -05:00 in November; with wallClock the 12:00 is New Orleans noon (CST, -06:00).
  assert.equal(events[0].start, '2026-11-22T12:00:00-06:00');
  assert.equal(events[0].end, '2026-11-22T16:00:00-06:00');
  assert.equal(foodFromVendorSite(raw, { ...config, wallClock: false }).events[0].start, '2026-11-22T12:00:00-05:00');
});
