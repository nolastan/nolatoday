import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { parseHTML } from '../scrapers/html.js';
import { parseBamboulas, redirectProblem } from '../scrapers/custom/bamboulas.js';
import { normalizeEvents } from '../scripts/lib/normalize.js';
import { ZONE } from '../scripts/lib/time.js';

const captured = () => fs.readFileSync(new URL('./fixtures/bamboulas-2026-10-07.html', import.meta.url));
const pageUrl = 'https://bamboulasmusic.com/livemusicschedule/';
const reference = 'Tue, 06 Oct 2026 17:59:20 GMT';

function parseCapture(extra = {}) {
  const html = captured();
  return parseBamboulas(html.toString('utf8'), {
    url: pageUrl,
    reference,
    declaredBytes: html.length,
    ...extra,
  });
}

const iso = (dt) => dt.toISO({ suppressMilliseconds: true });

test('captured October page: confirmed sets, and the four 11:00PM ranges stay unresolved', () => {
  const html = captured();
  assert.equal(html.length, 199690);
  const parsed = parseCapture();
  assert.equal(parsed.coverage, 'complete');
  assert.equal(parsed.datesFound, 26);
  assert.deepEqual(parsed.identity.streetNumbers, ['514']);
  assert.equal(parsed.events.length, 85);
  assert.deepEqual(
    parsed.unresolved.map((row) => `${row.reason} ${row.date} ${row.raw}`),
    [
      'range_conflict OCTOBER 10 Aaron Levinson & friends 11:00PM-1:45PM',
      'range_conflict OCTOBER 17 Aaron Levinson & friends 11:00PM-1:45PM',
      'range_conflict OCTOBER 24 Aaron Levinson & friends 11:00PM-1:45PM',
      'range_conflict OCTOBER 31 Aaron Levinson & friends 11:00PM-1:45PM',
    ],
  );
  assert.equal(parsed.events.some((event) => /aaron/i.test(event.title)), false);

  const jacky = parsed.events.find((event) => event.title === 'JACKY BLAIR AND THE HOT BISCUITS');
  assert.equal(iso(jacky.start), '2026-10-07T12:00:00-05:00');
  assert.equal(iso(jacky.end), '2026-10-07T16:00:00-05:00');

  const giselle = parsed.events.find((event) => event.title === 'GISELLE ANGUIZOLA QUARTET');
  assert.equal(iso(giselle.start), '2026-10-06T16:30:00-05:00');

  const jj = parsed.events.find((event) => event.title === "J.J. and the A-Ok's");
  assert.equal(iso(jj.start), '2026-10-08T12:00:00-05:00', '12 noon is noon, not the end of the range');

  const sugar = parsed.events.find((event) => event.title === 'SUGAR & THE DADDIES');
  assert.equal(iso(sugar.start), '2026-10-09T18:30:00-05:00');

  const kat = parsed.events.find((event) => event.start.toISODate() === '2026-10-09' && event.title === 'KAT KILEY EXPERIENCE');
  assert.equal(iso(kat.start), '2026-10-09T22:00:00-05:00');
  assert.equal(iso(kat.end), '2026-10-10T02:00:00-05:00');

  assert.equal(parsed.events.filter((event) => event.title === 'fk-rRERA mUSIC gROUP').length, 4);
  assert.equal(parsed.events.some((event) => /^\d/.test(event.title)), false);
});

test('declarative html adapter does not pair these headings', () => {
  const html = captured().toString('utf8');
  assert.ok(cheerio.load(html)('h5').length > 20);
  const rows = parseHTML(html, { url: pageUrl, item: 'h5', title: 'span', dateHeader: 'h4', time: 'span' });
  assert.equal(rows.length, 0);
});

test('a short body is partial even when early October sets are present', () => {
  const slice = captured().subarray(0, 100000).toString('utf8');
  const parsed = parseBamboulas(slice, { url: pageUrl, reference });
  assert.equal(parsed.coverage, 'partial_document');
  assert.ok(parsed.datesFound > 0);
  assert.equal(parsed.datesFound < 26, true);
});

test('a declared length longer than the body is truncated, not an empty calendar', () => {
  const parsed = parseCapture({ declaredBytes: captured().length + 40 });
  assert.equal(parsed.coverage, 'truncated_body');
  assert.ok(parsed.events.length > 0);
});

test('hostname text is not a schedule, and a challenge page is not one either', () => {
  const hostOnly = '<html><head><title>bamboulasmusic.com</title></head><body><p>Attention Required</p></body></html>';
  assert.equal(parseBamboulas(hostOnly, { url: pageUrl, reference }).coverage, 'source_not_schedule');
  const challenge = '<html><head><title>tixr.com</title></head><body><p>Please enable JS and disable any ad blocker</p></body></html>';
  assert.equal(parseBamboulas(challenge, { url: pageUrl, reference }).coverage, 'source_not_schedule');
});

test('closed and private titles are not kept by the normalizer', () => {
  const html = `<!doctype html><html><head><title>LIVE MUSIC SCHEDULE | Bamboulasmusic.com</title></head><body>
    <h4>OCTOBER 18</h4>
    <h5>Closed</h5><h5>8:00PM-10:00PM</h5>
    <h5>Private party</h5><h5>9:00PM-11:00PM</h5>
    <h5>Real Set</h5><h5>6:00PM-8:00PM</h5>
    <h1>BOOKINGS AT BAMBOULA'S</h1>
    <p>Bamboula's is at 514 Frenchmen St.</p>
    </body></html>`;
  const parsed = parseBamboulas(html, { url: pageUrl, reference });
  assert.equal(parsed.coverage, 'complete');
  assert.deepEqual(parsed.events.map((event) => event.title), ['Closed', 'Private party', 'Real Set']);
  const window = {
    from: DateTime.fromISO('2026-10-05T00:00:00', { zone: ZONE }),
    to: DateTime.fromISO('2026-11-05T00:00:00', { zone: ZONE }),
  };
  const kept = normalizeEvents(parsed.events, { venue: 'bamboulas', window });
  assert.deepEqual(kept.map((event) => event.title), ['Real Set']);
});

test('redirect bound stays on the venue host', () => {
  assert.equal(redirectProblem(pageUrl, pageUrl), null);
  assert.equal(redirectProblem(pageUrl, 'https://www.bamboulasmusic.com/livemusicschedule'), null);
  assert.equal(redirectProblem(pageUrl, 'https://example.com/livemusicschedule/'), 'off_host_redirect');
  assert.equal(redirectProblem(pageUrl, 'http://bamboulasmusic.com/livemusicschedule/'), 'final_not_https');
  assert.equal(redirectProblem('http://bamboulasmusic.com/livemusicschedule/', pageUrl), 'unexpected_request_host');
  assert.equal(redirectProblem('https://evil.example/bamboulasmusic.com', pageUrl), 'unexpected_request_host');
});
