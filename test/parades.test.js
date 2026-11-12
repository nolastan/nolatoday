import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SOURCES,
  buildFeatures,
  checkFeature,
  fromOpenData,
  fromRoutewise,
  mapParade,
  mergeWithPrevious,
  nameKey,
  paradeOrgs,
  parseClock,
  wallClockFromEpoch,
} from '../scripts/lib/parades.js';
import { fromPermit, organizerSlug, parseHeadline, parseRoute, permitVerdict, routeText, traceRouteText } from '../scripts/lib/permits.js';
import { buildNetwork, resolveStreet, trace } from '../scripts/lib/route-trace.js';
import { paradePage, paradesPage, routeSvg } from '../src/templates/parade.js';

// Fixtures are rows the City of New Orleans published (trimmed), plus three made-up
// permit rows (TEST-…) for the cases that must be refused. Nothing here comes from
// a third-party site, and no private event from the real feed is stored.
const fixture = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/parades/${name}`, import.meta.url)), 'utf8'));
const openData = fixture('open-data.geojson').features;
const routewise = fixture('routewise.geojson').features;
const permits = fixture('permits.json');
const net = buildNetwork(fixture('centerlines-french-quarter.geojson').features);
const permit = (start) => permits.find((r) => r.descr.startsWith(start));

const sources = {
  open_data: { retrieved_at: '2026-11-12T07:00:00.000Z', last_modified: '2026-02-06T12:19:24.000Z' },
  routewise: { retrieved_at: '2026-11-12T07:00:00.000Z', last_modified: '2026-02-09T19:36:10.695Z' },
  permits: { retrieved_at: '2026-11-12T07:00:00.000Z', last_modified: '2026-11-12T05:58:22.000Z' },
};
const krewes = [
  { slug: 'muses', name: 'Krewe of Muses', match: ['Muses'], category: 'mardi_gras' },
  { slug: 'tucks', name: 'Krewe of Tucks', match: ['Tucks'], category: 'mardi_gras' },
  { slug: 'thoth', name: 'Krewe of Thoth', match: ['Thoth'], category: 'mardi_gras' },
];

function build() {
  const records = [];
  for (const f of openData) records.push(fromOpenData(f).record);
  for (const f of routewise) {
    const { record } = fromRoutewise(f);
    if (record) records.push(record);
  }
  for (const row of permits) {
    const { record } = fromPermit(row);
    if (!record) continue;
    if (record.route_text) {
      const traced = traceRouteText(net, record.route_text, record.start_address);
      record.geometry = traced.line ? { type: 'LineString', coordinates: traced.line } : null;
      record.route_notes = traced.notes;
      record.route_problem = traced.line ? null : traced.problems.join('; ');
    }
    records.push(record);
  }
  return buildFeatures(records, { krewes, sources });
}

test('names and times: loose matching, clock parsing, wall-clock epochs', () => {
  assert.equal(nameKey('Krewe of Oshun'), nameKey('OSHUN'));
  assert.equal(nameKey("Krewe d'Etat"), nameKey("D'etat"));
  assert.deepEqual(parseClock('5:00pm'), { hour: 17, minute: 0 });
  assert.deepEqual(parseClock('11:45 AM'), { hour: 11, minute: 45 });
  assert.equal(parseClock('noonish'), null);
  // The city stores New Orleans wall-clock time as if it were UTC.
  assert.equal(wallClockFromEpoch(Date.UTC(2026, 1, 12, 18, 0)).toISO({ suppressMilliseconds: true }), '2026-02-12T18:00:00-06:00');
});

test('Carnival sources merge into one feature per krewe, and say where each field came from', () => {
  const { features, conflicts } = build();
  const muses = features.find((f) => f.id === 'muses-2026');
  assert.equal(muses.properties.krewe, 'Krewe of Muses');
  assert.equal(muses.properties.name, 'Muses');
  assert.equal(muses.properties.category, 'mardi_gras');
  assert.equal(muses.properties.jurisdiction, 'orleans_parish');
  // The route is the open data portal's; the time is Routewise's, because it was edited later.
  assert.deepEqual(muses.properties.field_sources, { geometry: 'open_data', schedule: 'routewise', route_description: 'open_data', amenities: 'routewise' });
  assert.equal(muses.properties.start_time, '2026-02-12T18:00:00-06:00');
  assert.ok(conflicts.some((c) => c.startsWith('muses-2026: open data says 18:15, Routewise says 18:00')));
  assert.equal(muses.properties.source_url, SOURCES.open_data.url);
  assert.equal(muses.properties.route_traced, false);
  // In Routewise only.
  assert.equal(features.find((f) => f.id === 'thoth-2026').properties.field_sources.geometry, 'routewise');
  // The city's leftover test row never becomes a parade.
  assert.ok(!features.some((f) => /test/i.test(f.properties.name)));
  for (const f of features) assert.deepEqual(checkFeature(f), [], f.id);
});

test('permit applications: public parades get through, private and dead ones do not', () => {
  assert.equal(permitVerdict(permit('Krewe Mosaique')), null);
  assert.equal(permitVerdict(permit('Nine Times')), null);
  assert.equal(permitVerdict(permit('Example Wedding')), 'private event');
  assert.match(permitVerdict(permit('Example Steppers')), /^status "Permit Denied"/);
  assert.match(permitVerdict(permit('Non-profit')), /format/);
  // A private occasion is refused even when everything else about the row is in order.
  const row = { ...permit('Krewe Mosaique') };
  for (const word of ['Smith Birthday Second Line Parade', 'Acme Corporate Second Line', 'Jones Memorial Parade']) {
    assert.equal(permitVerdict({ ...row, descr: row.descr.replace('Krewe Mosaique Parade MG 2027', word) }), 'private event', word);
  }
  const { features } = build();
  assert.ok(!features.some((f) => /example/i.test(JSON.stringify(f.properties))));
});

test('permit applications: headline, organizer, times and route text', () => {
  assert.deepEqual(parseHeadline('Men & Ladies of Class SA&PC Second Line Parade 2025- 1738 Washington Ave - Verret Lounge- 10-19-2025'), {
    title: 'Men & Ladies of Class SA&PC Second Line Parade 2025',
    address: '1738 Washington Ave - Verret Lounge',
    date: '2025-10-19',
  });
  assert.equal(parseHeadline('second line parade from one hotel to another, 6:30 - 7:00 PM'), null);
  assert.equal(organizerSlug('Nine Times SA & PC Second Line Parade 2026'), 'nine-times');
  assert.equal(organizerSlug('Krewe Mosaique Parade MG 2027'), 'mosaique');
  assert.equal(organizerSlug('Krewe Du Vieux Mardi Gras Parade 2026'), 'krewe-du-vieux');

  const { record } = fromPermit(permit('Nine Times'));
  assert.equal(record.date, '2026-11-22');
  assert.equal(record.start_time, '2026-11-22T12:00:00-06:00');
  assert.equal(record.formation_time, '2026-11-22T11:00:00-06:00');
  assert.equal(record.end_time, '2026-11-22T16:00:00-06:00');
  assert.equal(record.category, 'second_line');
  assert.equal(record.start_address, '3301 Higgins Blvd (Thrive 9th Ward)');
  // "Route Sheet" means the route is on paper the city has not published.
  assert.equal(record.route_text, null);

  // A start time that cannot be right is dropped, not published.
  const slip = fromPermit({ ...permit('Nine Times'), descr: permit('Nine Times').descr.replace('Start: 12:00 PM', 'Start: 12:00 AM') }).record;
  assert.equal(slip.start_time, null);
  assert.equal(slip.formation_time, '2026-11-22T11:00:00-06:00');
});

test('route text stops before staffing notes and contact details', () => {
  const descr = 'Example Club SA & PC Second Line - 701 N Rampart - 1-09-2027\r\nRoute: 701 N Rampart right on St. Ann St.\r\nLeft on Bourbon St. Disband: Bourbon and Dumaine Formation: 4:00PM\r\n250 marchers\r\nOfficer A. Example, 504-555-0100';
  assert.equal(routeText(descr), '701 N Rampart right on St. Ann St. Left on Bourbon St. Disband: Bourbon and Dumaine');
  assert.equal(routeText('Title - 1 Main St - 1-09-2027\r\nRoute: call 504-555-0100 for the route'), null);
  assert.equal(routeText('Title - 1 Main St - 1-09-2027\r\nRoute: Route Sheet Attached'), null);
});

test('street names resolve against the city centerlines, typos and all', () => {
  assert.deepEqual(resolveStreet(net, 'St. Ann St.'), ['saint ann street']);
  assert.deepEqual(resolveStreet(net, 'Governor Nichols Street'), ['governor nicholls street']);
  assert.deepEqual(resolveStreet(net, 'N. Rampart'), ['north rampart street']);
  // Half a name is not a street.
  assert.deepEqual(resolveStreet(net, 'S.'), []);
  assert.deepEqual(resolveStreet(net, 'Nonesuch Blvd'), []);
});

test('a written route becomes a line along the streets it names', () => {
  const { record } = fromPermit(permit('Krewe Mosaique'));
  const parsed = parseRoute(net, record.route_text, record.start_address);
  assert.deepEqual(parsed.start, { number: 701, street: 'N Rampart' });
  assert.deepEqual(
    parsed.steps.map((s) => `${s.turn ?? '-'} ${s.street}`),
    ['- St. Ann Street', 'left Bourbon Street', 'right Governor Nichols Street', 'right Royal Street', 'left St. Ann Street', 'left Chartres Street', '- St. Philip Street'],
  );
  const traced = traceRouteText(net, record.route_text, record.start_address);
  assert.deepEqual(traced.problems, []);
  assert.ok(traced.meters > 1500 && traced.meters < 2100, `length ${traced.meters}`);
  const [startLng, startLat] = traced.line[0];
  assert.ok(Math.abs(startLng - -90.0687) < 0.002 && Math.abs(startLat - 29.9614) < 0.002);

  // A loop back to where it began (the Lafcadio route), ending at the address the text gives.
  const loop = fromPermit(permit('Krewe of Lafcadio')).record;
  const lafcadio = traceRouteText(net, loop.route_text, loop.start_address);
  assert.deepEqual(lafcadio.problems, []);
  assert.ok(lafcadio.meters > 3000 && lafcadio.meters < 4000, `length ${lafcadio.meters}`);
});

test('the tracer refuses rather than guesses', () => {
  // A made-up corner: Main Street runs east and ends at Oak Avenue, which runs north from there.
  const corner = buildNetwork([
    { properties: { FULLNAME: 'Main Street', FROMLEFT: 100, TOLEFT: 198, FROMRIGHT: 101, TORIGHT: 199 }, geometry: { type: 'LineString', coordinates: [[-90.07, 29.96], [-90.069, 29.96]] } },
    { properties: { FULLNAME: 'Main Street', FROMLEFT: 200, TOLEFT: 298, FROMRIGHT: 201, TORIGHT: 299 }, geometry: { type: 'LineString', coordinates: [[-90.069, 29.96], [-90.068, 29.96]] } },
    { properties: { FULLNAME: 'Oak Avenue', FROMLEFT: 100, TOLEFT: 198, FROMRIGHT: 101, TORIGHT: 199 }, geometry: { type: 'LineString', coordinates: [[-90.068, 29.96], [-90.068, 29.961]] } },
    { properties: { FULLNAME: 'Elm Street', FROMLEFT: 100, TOLEFT: 198, FROMRIGHT: 101, TORIGHT: 199 }, geometry: { type: 'LineString', coordinates: [[-90.07, 29.97], [-90.068, 29.97]] } },
  ]);
  const start = { number: 100, street: 'Main St' };
  assert.deepEqual(trace(corner, { start, steps: [{ street: 'Oak Ave', turn: 'left' }, { address: { number: 198, street: 'Oak Ave' } }] }).problems, []);
  // The text says right, the streets say left.
  const wrongWay = trace(corner, { start, steps: [{ street: 'Oak Ave', turn: 'right' }] });
  assert.equal(wrongWay.line, null);
  assert.match(wrongWay.problems[0], /the text says right, but the streets meet the other way/);
  // A street the city has no record of.
  const unknown = trace(corner, { start, steps: [{ street: 'Nonesuch Blvd', turn: 'left' }] });
  assert.equal(unknown.line, null);
  assert.match(unknown.problems[0], /no such street/);
  // Two streets that never meet.
  const apart = trace(corner, { start, steps: [{ street: 'Elm Street', turn: 'left' }] });
  assert.equal(apart.line, null);
  assert.match(apart.problems[0], /does not meet/);
  // A stop the text lists by address, far from where the line went.
  const stray = trace(corner, { start, steps: [{ street: 'Oak Ave', turn: 'left' }, { address: { number: 150, street: 'Elm Street' } }] });
  assert.equal(stray.line, null);
  assert.match(stray.problems[0], /which the text lists as a stop/);
  // No start, no line.
  assert.equal(traceRouteText(net, 'Left on Bourbon Street', 'Armstrong Park').line, null);
});

test('permit parades carry their application, and a traced line is labelled as traced', () => {
  const { features } = build();
  const mosaique = features.find((f) => f.id === 'mosaique-2027');
  const p = mosaique.properties;
  assert.equal(p.category, 'mardi_gras');
  assert.equal(p.krewe, 'Krewe Mosaique');
  assert.equal(p.source_url, 'https://data.nola.gov/resource/aib5-en5t.json?permitnumber=26-25432-SPMA');
  assert.deepEqual(p.sources, [p.source_url, SOURCES.centerlines.url]);
  assert.equal(p.route_traced, true);
  assert.equal(p.permit_status, 'Application Review');
  assert.equal(mosaique.geometry.type, 'LineString');
  assert.deepEqual(checkFeature(mosaique), []);

  const nineTimes = features.find((f) => f.id === 'nine-times-2026-11-22');
  assert.equal(nineTimes.geometry, null);
  assert.equal(nineTimes.properties.route_traced, false);
  assert.deepEqual(nineTimes.properties.start_point, [-90.03298, 29.9951]);
});

test('checkFeature: nothing is publishable without an official source', () => {
  const { features } = build();
  const f = structuredClone(features.find((x) => x.id === 'muses-2026'));
  f.properties.source_url = 'https://example.com/parades/muses';
  assert.match(checkFeature(f).join(' '), /not a City of New Orleans address/);
  const g = structuredClone(features.find((x) => x.id === 'mosaique-2027'));
  g.properties.route_text = null;
  assert.match(checkFeature(g).join(' '), /no official route text/);
});

test('mergeWithPrevious keeps parades the city no longer serves, and remembers when each first appeared', () => {
  const { features } = build();
  const first = mergeWithPrevious(structuredClone(features), [], '2026-11-12');
  const later = mergeWithPrevious(structuredClone(features).filter((f) => f.id !== 'muses-2026'), first, '2026-12-01');
  assert.equal(later.length, first.length);
  assert.equal(later.find((f) => f.id === 'muses-2026').properties.first_seen, '2026-11-12');
  assert.equal(later.find((f) => f.id === 'mosaique-2027').properties.first_seen, '2026-11-12');
});

test('site: parades group by organization, and pages show the city record honestly', () => {
  const { features } = build();
  for (const f of features) f.properties.first_seen = '2026-11-12';
  const orgs = paradeOrgs(features, '2026-11-12');
  // Coming parades first, soonest first.
  assert.deepEqual(orgs.slice(0, 2).map((o) => o.slug), ['nine-times', 'mosaique']);
  const ctx = { config: { siteName: 'NOLA.Today', siteUrl: 'https://nola.today', repo: 'x/y', mapbox: { token: null } }, url: (p) => p, asset: (p) => p };

  const page = paradePage(ctx, orgs.find((o) => o.slug === 'mosaique'), { today: '2026-11-12' });
  assert.match(page, /<h1>Krewe Mosaique<\/h1>/);
  assert.match(page, /Route, as filed with the city/);
  assert.match(page, /Turn left onto Bourbon Street/);
  assert.match(page, /which the city lists as “Application Review”/);
  assert.match(page, /href="https:\/\/data\.nola\.gov\/resource\/aib5-en5t\.json\?permitnumber=26-25432-SPMA"/);
  assert.match(page, /href="\/\?date=2027-01-09&parade=mosaique-2027"/);

  const noRoute = paradePage(ctx, orgs.find((o) => o.slug === 'nine-times'), { today: '2026-11-12' });
  assert.match(noRoute, /The city has not published a route for this parade/);

  const directory = paradesPage(ctx, orgs, { today: '2026-11-12', sources: [SOURCES.permits] });
  assert.match(directory, /href="\/parades\/mosaique"/);
  assert.match(directory, /Permit Application Data/);

  const onMap = mapParade(features.find((f) => f.id === 'mosaique-2027'));
  assert.equal(onMap.slug, 'mosaique');
  assert.equal(onMap.g.type, 'LineString');
  assert.match(routeSvg(features.find((f) => f.id === 'mosaique-2027')), /^<svg class="route-thumb"/);
  assert.equal(routeSvg(features.find((f) => f.id === 'nine-times-2026-11-22')), null);
});
