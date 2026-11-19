import { test } from 'node:test';
import assert from 'node:assert/strict';
import { venueFeed, foodFeed, paradesFeed, artistBroadGenres } from '../scripts/lib/feeds.js';

const siteUrl = 'https://nola.today';

test('venueFeed: schedule, recent shows and food, with optional fields left out', () => {
  const venue = { slug: 'blue-nile', name: 'Blue Nile', status: 'active', address: '532 Frenchmen St', lat: 29.96, lng: -90.05, website: 'https://example.com', sources: [{ url: 'https://example.com/cal' }, { url: 'https://example.com/cal' }, {}] };
  const feed = venueFeed(venue, {
    siteUrl,
    image: '/images/venues/blue-nile-600.jpg?v=1',
    imageLarge: '/images/venues/blue-nile.jpg?v=2',
    status: { lastSuccess: '2026-11-18T14:44:25-06:00' },
    events: [
      { id: 'a', title: 'Kermit Ruffins & The BBQ Swingers', start: '2026-11-20T22:00:00-06:00', url: 'https://example.com/e', artists: [{ slug: 'kermit-ruffins', start: 0, end: 14 }] },
      { id: 'b', title: 'Open mic', start: '2026-11-21', allDay: true },
    ],
    recent: [{ id: 'c', title: 'Street Legends', start: '2026-11-15T22:30:00-06:00', artists: [] }],
    food: [{ vendor: 'porchettaboudit', vendorName: 'Porchettaboudit', icon: 'pig', start: '2026-11-24T18:00:00-06:00', allDay: false, stale: true, confirmedOn: '2026-10-01', place: { key: 'blue-nile' } }],
  });
  assert.equal(feed.url, 'https://nola.today/venues/blue-nile');
  assert.deepEqual(feed.sources, ['https://example.com/cal']);
  assert.equal(feed.updated, '2026-11-18T14:44:25-06:00');
  assert.deepEqual(feed.events[0], { title: 'Kermit Ruffins & The BBQ Swingers', start: '2026-11-20T22:00:00-06:00', url: 'https://example.com/e', artists: [['kermit-ruffins', 0, 14]] });
  assert.deepEqual(feed.events[1], { title: 'Open mic', start: '2026-11-21', allDay: true });
  assert.deepEqual(feed.recent, [{ title: 'Street Legends', start: '2026-11-15T22:30:00-06:00' }]);
  assert.deepEqual(feed.food, [{ vendor: 'porchettaboudit', vendorName: 'Porchettaboudit', icon: 'pig', start: '2026-11-24T18:00:00-06:00', confirmedOn: '2026-10-01', unconfirmed: true }]);
  assert.ok(!('imageCredit' in feed) && !('note' in feed));
});

test('venueFeed: a venue with nothing listed has empty lists', () => {
  const feed = venueFeed({ slug: 'x', name: 'X', status: 'closed', note: 'Closed in 2025.' }, { siteUrl });
  assert.equal(feed.note, 'Closed in 2025.');
  assert.deepEqual([feed.events, feed.recent, feed.food, feed.sources], [[], [], [], []]);
  assert.ok(!('image' in feed));
});

test('foodFeed: upcoming stops only, places and icons that are used', () => {
  const place = { key: 'food-bayou', name: 'Bayou Beer Garden', address: '326 N Norman C Francis Pkwy', lat: 29.97, lng: -90.09, approximate: false };
  const far = { key: 'food-far', name: 'Somewhere', address: 'Covington', lat: 30.4, lng: -90.1, approximate: true };
  const vendors = [
    {
      slug: 'boils',
      name: 'Boils',
      icon: 'crawfish',
      type: 'Pop-up',
      description: 'Crawfish.',
      from: 'https://www.instagram.com/p/x/',
      events: [
        { start: '2026-11-10T14:00:00-06:00', place, stale: false },
        { start: '2026-11-21T14:00:00-06:00', end: '2026-11-21T18:30:00-06:00', price: '$10/lb', place, confirmedOn: '2026-11-15', stale: false },
        { start: '2026-11-28', allDay: true, note: 'LSU game', place: far, stale: true },
      ],
    },
    { slug: 'mystery', name: 'Mystery', icon: 'nope', events: [] },
  ];
  const feed = foodFeed(vendors, { siteUrl, today: '2026-11-19', icons: { crawfish: '<path/>', default: '<circle/>', pig: '<p/>' }, generatedAt: 'now' });
  assert.deepEqual(Object.keys(feed.icons), ['crawfish', 'default']);
  assert.deepEqual(feed.places, {
    'food-bayou': { name: 'Bayou Beer Garden', address: '326 N Norman C Francis Pkwy', lat: 29.97, lng: -90.09 },
    'food-far': { name: 'Somewhere', address: 'Covington', lat: 30.4, lng: -90.1, far: true },
  });
  const [boils, mystery] = feed.vendors;
  assert.equal(boils.instagram, 'https://www.instagram.com/p/x/');
  assert.equal(boils.url, 'https://nola.today/food/boils');
  assert.deepEqual(boils.stops, [
    { place: 'food-bayou', start: '2026-11-21T14:00:00-06:00', end: '2026-11-21T18:30:00-06:00', price: '$10/lb', confirmedOn: '2026-11-15' },
    { place: 'food-far', start: '2026-11-28', allDay: true, note: 'LSU game', unconfirmed: true },
  ]);
  assert.equal(mystery.icon, 'default');
  assert.equal(mystery.type, 'Pop-up');
  assert.deepEqual(mystery.stops, []);
});

test('paradesFeed: photos with credits, upcoming and recent parades, no route text', () => {
  const parade = (date, extra = {}) => ({
    geometry: extra.geometry ?? null,
    properties: { id: `nine-times-${date}`, krewe: 'Nine Times SA & PC', name: 'NINE TIMES', category: 'second_line', date, start_time: `${date}T12:00:00-06:00`, start_address: '3301 Higgins Blvd (Thrive)', start_point: [-90.03, 29.99], route_text: 'secret', ...extra.properties },
  });
  const org = {
    slug: 'nine-times',
    name: 'Nine Times SA & PC',
    category: 'second_line',
    website: null,
    photos: [{ file: 'nine-times-1.jpg', width: 1200, height: 800, alt: 'A second line', credit: { author: 'A', license: 'CC BY 2.0', licenseUrl: 'https://l', source: 'https://s' } }],
    upcoming: [parade('2026-11-22', { geometry: { type: 'LineString', coordinates: [] } })],
    past: [parade('2025-11-23'), parade('2024-11-24')],
  };
  const feed = paradesFeed([org], { siteUrl, photoUrl: (f) => `/images/parades/${f}`, maxRecent: 1, generatedAt: 'now' });
  const [o] = feed.organizations;
  assert.ok(!('website' in o));
  assert.deepEqual(o.photos[0], { image: '/images/parades/nine-times-1-600.jpg', imageLarge: '/images/parades/nine-times-1.jpg', width: 1200, height: 800, alt: 'A second line', credit: { author: 'A', license: 'CC BY 2.0', licenseUrl: 'https://l', source: 'https://s' } });
  assert.deepEqual(o.upcoming, [{ id: 'nine-times-2026-11-22', name: 'Nine Times SA & PC', category: 'second_line', date: '2026-11-22', start: '2026-11-22T12:00:00-06:00', street: 'Higgins Blvd', point: [-90.03, 29.99], route: true }]);
  assert.equal(o.recent.length, 1);
  assert.equal(o.recent[0].date, '2025-11-23');
  assert.ok(!JSON.stringify(feed).includes('secret'));
});

test('artistBroadGenres: specific genres and words in the name', () => {
  assert.deepEqual(artistBroadGenres({ name: 'Rebirth Brass Band' }, {}), ['jazz', 'brass-band']);
  assert.deepEqual(artistBroadGenres({ name: 'Someone' }, { spotifyGenres: ['dixieland'] }), ['jazz', 'traditional-jazz']);
});
