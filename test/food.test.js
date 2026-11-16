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
