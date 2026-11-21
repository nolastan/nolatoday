import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatcher, candidateName, candidates, checkArtists, leadName, nameKey, slugify } from '../scripts/lib/artists.js';
import { pickArtist, linksFrom } from '../scripts/lib/musicbrainz.js';
import { metaFromApi, metaFromOEmbed } from '../scripts/lib/spotify.js';
import { titleHtml, artistPage, artistsPage, artistLinks } from '../src/templates/artist.js';
import { eventTitle } from '../src/templates/venue.js';
import { broadGenres, genresFromMusicBrainz, specificGenres } from '../scripts/lib/genres.js';

const ARTISTS = [
  { slug: 'kermit-ruffins', name: 'Kermit Ruffins', aliases: ['Kermit Ruffins & the BBQ Swingers'] },
  { slug: 'soul-rebels', name: 'The Soul Rebels' },
  { slug: 'corey-henry', name: 'Corey Henry', aliases: ['Corey Henry & the Treme Funktet'] },
  { slug: 'redline', name: 'Redline' },
  { slug: 'dr-john', name: 'Dr. John' },
  { slug: 'lous-bayou', name: 'Lou’s Bayou' },
];
const matcher = buildMatcher(ARTISTS);
const named = (title) => matcher.match(title).map((m) => [m.slug, title.slice(m.start, m.end)]);

test('nameKey: case, accents, "&", apostrophes and a leading "The" do not matter', () => {
  assert.equal(nameKey('The Soul Rebels'), nameKey('SOUL REBELS'));
  assert.equal(nameKey('Kermit Ruffins & The BBQ Swingers'), nameKey('kermit ruffins and the bbq swingers'));
  assert.equal(nameKey('Lou’s Bayou'), nameKey("Lou's Bayou"));
  assert.equal(nameKey('Tremé Brass Band'), nameKey('Treme Brass Band'));
  assert.equal(slugify('Lou’s Bayou & Friends'), 'lous-bayou-and-friends');
  assert.equal(slugify('The Soul Rebels'), 'soul-rebels');
});

test('matcher: links only the name, the longest name first, with its "The"', () => {
  assert.deepEqual(named('Kermit Ruffins & The BBQ Swingers'), [['kermit-ruffins', 'Kermit Ruffins & The BBQ Swingers']]);
  assert.deepEqual(named('Kermit Ruffins'), [['kermit-ruffins', 'Kermit Ruffins']]);
  assert.deepEqual(named('Corey Henry & the Treme Funktet : Red Beans & Ricely Yours'), [['corey-henry', 'Corey Henry & the Treme Funktet']]);
  assert.deepEqual(named('THE SOUL REBELS'), [['soul-rebels', 'THE SOUL REBELS']]);
  assert.deepEqual(named('NYE with the Soul Rebels and Kermit Ruffins'), [
    ['soul-rebels', 'the Soul Rebels'],
    ['kermit-ruffins', 'Kermit Ruffins'],
  ]);
  assert.deepEqual(named('T. Cherrelle & Lou’s Bayou'), [['lous-bayou', 'Lou’s Bayou']]);
});

test('matcher: whole words only, and not the subject of a tribute', () => {
  assert.deepEqual(named('Redliner'), []);
  assert.deepEqual(named('The Redline Band'), [['redline', 'The Redline']]);
  assert.deepEqual(named('A Tribute to Dr. John'), []);
  assert.deepEqual(named('Tribute to the Soul Rebels'), []);
  assert.deepEqual(named('The Music of Dr. John'), []);
  assert.deepEqual(named('Celebrating Kermit Ruffins'), []);
  assert.deepEqual(named('Purrsday Karaoke!'), []);
  assert.deepEqual(named(''), []);
});

test('candidateName: only a title that is nothing but one act', () => {
  for (const t of ['Charmaine Neville Band', 'Raphael Bas', 'Kermit Ruffins & The BBQ Swingers', 'Tuba Skinny', 'THE NEW ORLEANS RUG CUTTERS']) {
    assert.equal(candidateName(t), t);
  }
  for (const t of [
    'Purrsday Karaoke!',
    'Open Mic Night!!',
    'Thanksgiving',
    'Coyote Anderson & James Beaumont',
    'The Handgrenades with Neon 3dcd Party and Giovanni Ventello',
    'Van Ella Bordella (burlesque)',
    'Atsuko Okatsuka: The Big Bowl Tour',
    '80’s Night with DJ Shane Love',
    'Album Recording — Amber Rachelle + The Sweet Potatoes',
    'U2',
  ]) {
    assert.equal(candidateName(t), null, t);
  }
});

test('candidates: counts names no artist covers, most shows first', () => {
  const titles = [
    { title: 'Tuba Skinny', venue: 'dba' },
    { title: 'TUBA SKINNY', venue: 'buffa-s' },
    { title: 'Raphael Bas', venue: 'bacchanal' },
    { title: 'The Soul Rebels', venue: 'blue-nile' },
    { title: 'Open Mic Night!!', venue: 'hi-ho' },
  ];
  assert.deepEqual(candidates(titles, ARTISTS), [
    { name: 'Tuba Skinny', count: 2, venues: ['buffa-s', 'dba'] },
    { name: 'Raphael Bas', count: 1, venues: ['bacchanal'] },
  ]);
  assert.equal(leadName('Kermit Ruffins & the BBQ Swingers'), 'Kermit Ruffins');
  assert.equal(leadName('Charmaine Neville Band'), 'Charmaine Neville');
});

test('checkArtists: catches shared names and bad ids', () => {
  assert.deepEqual(checkArtists(ARTISTS), []);
  const problems = checkArtists([
    { slug: 'a', name: 'Soul Rebels' },
    { slug: 'b', name: 'Other', aliases: ['The Soul Rebels'], spotify: 'nope', links: { myspace: 'https://x.test', website: 'http://x.test' }, extra: 1 },
  ]).map((p) => p.message);
  assert.deepEqual(problems, [
    'unknown field "extra"',
    '"The Soul Rebels" is also a name of a',
    'spotify must be the 22-character artist id',
    'unknown link "myspace" (use appleMusic, bandcamp, youtube, soundcloud, instagram, website)',
    'links.website must be an https URL',
  ]);
});

const mb = (name, extra = {}) => ({ id: 'a05add38-ccf0-4e27-a701-d4a09079682e', name, type: 'Group', score: 100, ...extra });

test('pickArtist: exactly one Louisiana act by that exact name', () => {
  const nola = { 'begin-area': { name: 'New Orleans' } };
  assert.equal(pickArtist('The Soul Rebels', { artists: [mb('Soul Rebels', nola), mb('Soul Rebel')] })?.name, 'Soul Rebels');
  // From somewhere else, or no place known: not sure enough.
  assert.equal(pickArtist('Redline', { artists: [mb('Redline', { area: { name: 'Germany' } }), mb('Redline')] }), null);
  // Two Louisiana acts share the name.
  assert.equal(pickArtist('Willie Green', { artists: [mb('Willie Green', nola), mb('Willie Green', { area: { name: 'Louisiana' } })] }), null);
  // One Louisiana act, namesakes elsewhere.
  assert.equal(pickArtist('Willie Green', { artists: [mb('Willie Green', nola), mb('Willie Green', { area: { name: 'Texas' } })] })?.name, 'Willie Green');
  // A near miss is not a match.
  assert.equal(pickArtist('Soul Rebels Brass Band', { artists: [mb('Soul Rebels', nola)] }), null);
  assert.equal(pickArtist('Dr. John', { artists: [mb('Dr. John', { ...nola, type: 'Character' })] }), null);
  assert.equal(pickArtist('Nobody', {}), null);
  // A bandleader taken from a band's name has to be a person.
  assert.equal(pickArtist('3rd Street', { artists: [mb('3rd Street', nola)] }, { person: true }), null);
  assert.equal(pickArtist('Charmaine Neville', { artists: [mb('Charmaine Neville', { ...nola, type: 'Person' })] }, { person: true })?.name, 'Charmaine Neville');
});

test('linksFrom: the artist’s own pages, skipping ended links', () => {
  const rel = (type, resource, extra = {}) => ({ type, url: { resource }, ...extra });
  assert.deepEqual(
    linksFrom({
      relations: [
        rel('free streaming', 'https://open.spotify.com/artist/5Yk2yKWh1jbCJS7gfDyPbK'),
        rel('streaming', 'https://music.apple.com/us/artist/123'),
        rel('purchase for download', 'https://music.apple.com/us/album/999'),
        rel('bandcamp', 'https://tubaskinny.bandcamp.com/'),
        rel('official homepage', 'http://old.example.com/', { ended: true }),
        rel('official homepage', 'http://tubaskinny.com/'),
        rel('social network', 'https://www.instagram.com/tubaskinny/'),
        rel('social network', 'https://www.facebook.com/tubaskinny'),
        rel('youtube', 'https://www.youtube.com/user/tubaskinny'),
        rel('wikidata', 'https://www.wikidata.org/wiki/Q1'),
      ],
    }),
    {
      spotify: '5Yk2yKWh1jbCJS7gfDyPbK',
      links: {
        appleMusic: 'https://music.apple.com/us/artist/123',
        bandcamp: 'https://tubaskinny.bandcamp.com/',
        website: 'https://tubaskinny.com/',
        instagram: 'https://www.instagram.com/tubaskinny/',
        youtube: 'https://www.youtube.com/user/tubaskinny',
      },
    },
  );
  assert.deepEqual(linksFrom({}), { links: {} });
});

test('spotify: photos and genres from the Web API, photo only from oEmbed', () => {
  const img = (id, width) => ({ url: `https://i.scdn.co/image/${id}`, width, height: width });
  assert.deepEqual(metaFromApi({ images: [img('ab6761610000f178aaa', 160), img('ab6761610000e5ebaaa', 640), img('ab67616100005174aaa', 320)], genres: ['new orleans jazz', 'brass band'] }), {
    image: 'https://i.scdn.co/image/ab6761610000e5ebaaa',
    imageSmall: 'https://i.scdn.co/image/ab6761610000f178aaa',
    genres: ['new orleans jazz', 'brass band'],
  });
  assert.deepEqual(metaFromApi({ images: [img('ab6761610000e5ebaaa', 640)], genres: [] }), { image: 'https://i.scdn.co/image/ab6761610000e5ebaaa' });
  assert.equal(metaFromApi({ images: [], genres: ['jazz'] }), null);
  assert.equal(metaFromApi({ images: [{ url: 'https://evil.test/x.jpg', width: 640 }] }), null);
  assert.deepEqual(metaFromOEmbed({ thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/ab67616100005174cca3' }), { image: 'https://image-cdn-fa.spotifycdn.com/image/ab67616100005174cca3' });
  // An album cover standing in for a missing artist photo is not used.
  assert.equal(metaFromOEmbed({ thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02aadf' }), null);
  assert.equal(metaFromOEmbed({}), null);
});

const ctx = { config: { siteName: 'NOLA.Today', siteUrl: 'https://nola.today', description: '', repo: 'nolastan/nolatoday', mapbox: {} }, url: (p) => p, asset: (p) => p };

test('titleHtml and eventTitle: artist names link to their pages, the rest is escaped text', () => {
  const title = 'Corey Henry & the Treme Funktet : <Red Beans>';
  const artists = matcher.match(title);
  assert.equal(titleHtml(ctx, title, artists), '<a class="artist-link" href="/artists/corey-henry">Corey Henry &amp; the Treme Funktet</a> : &lt;Red Beans&gt;');
  assert.equal(
    eventTitle(ctx, { title: 'Redline', url: 'https://tix.test/1', artists: matcher.match('Redline') }),
    '<a class="artist-link" href="/artists/redline">Redline</a> <a class="event-details" href="https://tix.test/1" rel="noopener nofollow">Details</a>',
  );
  assert.equal(eventTitle(ctx, { title: 'Karaoke', url: 'https://tix.test/2' }), '<a href="https://tix.test/2" rel="noopener nofollow">Karaoke</a>');
  assert.equal(eventTitle(ctx, { title: 'Karaoke' }), 'Karaoke');
});

test('artistPage and artistsPage: shows, links and the player', () => {
  const artist = { slug: 'tuba-skinny', name: 'Tuba Skinny', spotify: '5Yk2yKWh1jbCJS7gfDyPbK', links: { bandcamp: 'https://tubaskinny.bandcamp.com/' } };
  const venue = { slug: 'dba', name: 'd.b.a.', address: '618 Frenchmen St' };
  const shows = [{ event: { title: 'Tuba Skinny', start: '2026-12-01T18:00:00-06:00' }, venue }];
  assert.deepEqual(artistLinks(artist).map((l) => l.key), ['spotify', 'bandcamp']);
  const html = artistPage(ctx, artist, { shows });
  assert.match(html, /<link rel="canonical" href="https:\/\/nola.today\/artists\/tuba-skinny">/);
  assert.match(html, /<a href="\/venues\/dba">d\.b\.a\.<\/a>/);
  assert.match(html, /open\.spotify\.com\/embed\/artist\/5Yk2yKWh1jbCJS7gfDyPbK/);
  assert.match(html, /href="https:\/\/tubaskinny\.bandcamp\.com\/"/);
  assert.match(html, /"@type":"MusicGroup"/);
  const withPhoto = artistPage(ctx, artist, { shows, meta: { image: 'https://i.scdn.co/image/ab6761610000e5ebaaa', spotifyGenres: ['new orleans jazz'], musicbrainzGenres: ['dixieland', 'New Orleans Jazz'] } });
  assert.match(withPhoto, /<img class="artist-photo" src="https:\/\/i\.scdn\.co\/image\/ab6761610000e5ebaaa" alt="Tuba Skinny"/);
  assert.match(withPhoto, /<p class="artist-genres"><a href="\/artists\?genre=traditional-jazz">Traditional jazz<\/a><\/p>/);
  assert.match(withPhoto, /"genre":\["new orleans jazz","dixieland"\]/);
  assert.doesNotMatch(html, /artist-photo/);
  const empty = artistPage(ctx, { slug: 'x', name: 'X Band' }, { shows: [] });
  assert.match(empty, /No upcoming shows are listed/);
  assert.doesNotMatch(empty, /spotify/i);
  const dir = artistsPage(ctx, [artist, { slug: 'x', name: 'X Band' }], { showsBySlug: new Map([['tuba-skinny', shows], ['x', []]]) });
  assert.match(dir, /href="\/artists\/tuba-skinny"/);
  assert.match(dir, /No shows listed right now/);
  assert.doesNotMatch(dir, /genre-filter/);
  const withGenres = artistsPage(ctx, [artist], { showsBySlug: new Map([['tuba-skinny', shows]]), meta: { 'tuba-skinny': { musicbrainzGenres: ['dixieland'] } } });
  assert.match(withGenres, /data-genres="jazz traditional-jazz"/);
  assert.match(withGenres, /data-genre="traditional-jazz">Traditional jazz</);
  assert.doesNotMatch(withGenres, /data-genre="rock"/);
  assert.match(withGenres, /<span class="artist-row-genres muted">Traditional jazz<\/span>/);
});

test('genres: broad genres from specific ones and from a band’s name', () => {
  const band = (name) => ({ name });
  assert.deepEqual(broadGenres(band('Stanton Moore'), ['jazz fusion', 'jazz rock', 'jazz-funk']), ['jazz', 'modern-jazz', 'funk-soul']);
  assert.deepEqual(broadGenres(band('Someone'), ['jazz piano', 'contemporary jazz']), ['jazz', 'modern-jazz']);
  assert.deepEqual(broadGenres(band('Tuba Skinny'), ['dixieland']), ['jazz', 'traditional-jazz']);
  assert.deepEqual(broadGenres(band('Rebirth Brass Band')), ['jazz', 'brass-band']);
  assert.deepEqual(broadGenres(band('Nathan & the Zydeco Cha Chas')), ['cajun-zydeco']);
  assert.deepEqual(broadGenres(band('Hash Cabbage'), ['psychedelic rock', 'alternative folk']), ['rock', 'folk-country']);
  assert.deepEqual(broadGenres(band('Jazzmine')), []);
  assert.deepEqual(broadGenres(band('Rap Battle')), []);
  assert.deepEqual(genresFromMusicBrainz({ genres: [{ name: 'funk', count: 1 }, { name: 'jazz', count: 2 }, { name: 'zero', count: 0 }] }), ['jazz', 'funk']);
  assert.deepEqual(genresFromMusicBrainz({}), []);
  assert.deepEqual(specificGenres({ spotifyGenres: ['brass band'], musicbrainzGenres: ['Brass Band', 'jazz'] }), ['brass band', 'jazz']);
  assert.deepEqual(specificGenres(undefined), []);
});

test('articles: parsed from front matter, checked, and shown in full on the artist page', async () => {
  const { parseArticle, checkArticles } = await import('../scripts/lib/articles.js');
  const { articleHtml } = await import('../src/templates/artist.js');
  const a = parseArticle('---\ntitle: Red & Green\ndek: A talk\nauthor: Landry von Bohn\ndate: 2022-06-08\nartist: tank-and-the-bangas\n---\n\nFirst line\nsame paragraph.\n\nSecond <one>.\n', 'red');
  assert.deepEqual(a.paragraphs, ['First line same paragraph.', 'Second <one>.']);
  assert.deepEqual(checkArticles([a], new Set(['tank-and-the-bangas'])), []);
  assert.deepEqual(
    checkArticles([{ ...a, artist: 'nobody', paragraphs: ['R&amp;B**'] }], new Set()).map((p) => p.message),
    ['artist "nobody" has no file in data/artists/', 'the text has HTML entities or ** left in it'],
  );
  const html = articleHtml(a);
  assert.match(html, /<h2>Red &amp; Green<\/h2>/);
  assert.match(html, /By Landry von Bohn · <time datetime="2022-06-08">June 8, 2022<\/time>/);
  assert.match(html, /<p>Second &lt;one&gt;\.<\/p>/);
});
