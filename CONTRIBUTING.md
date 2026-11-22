# Contributing

Most work on this repo is keeping venue schedules flowing: fixing a scraper that broke, giving a venue its first schedule source, adding a venue, or marking one closed. All of it happens in `data/venues/<slug>.json`, and sometimes `scrapers/`.

## Venue files

```json
{
  "slug": "the-spotted-cat",
  "name": "The Spotted Cat",
  "status": "active",
  "address": "623 Frenchmen Street",
  "lat": 29.964081,
  "lng": -90.057633,
  "website": "https://www.spottedcatmusicclub.com",
  "image": "the-spotted-cat.jpg",
  "aliases": [],
  "sources": [
    { "type": "gigulator", "site": 1052, "url": "https://www.spottedcatmusicclub.com/calendar" }
  ]
}
```

- **`slug`** must match the filename and **never change** — it is the page URL (`/venues/<slug>`) and search engines know it. To rename a venue, change `name` and keep the slug.
- **`status`**: `active` (scraped, on the map) or `closed` (page stays up with a "closed" notice; no `sources`). Add a one-sentence `note` explaining a closure or rename.
- **`aliases`**: old slugs that should redirect here (e.g. a merged duplicate).
- **`image`**: a file in `public/images/venues/`. Provide `<slug>.jpg` (max 1200px) **and** `<slug>-600.jpg`.
- **`imageCredit`** (optional): required for any photo that isn't the site's own, e.g. a Creative Commons image. `{ "author", "license": "CC BY 2.0", "licenseUrl", "source" (the photo's page), "via"? ("Wikimedia Commons") }`. Shown over the photo as "Photo by …, CC BY 2.0, via Wikimedia Commons". Only resize such photos; cropping or editing a share-alike (`BY-SA`) image makes the edited file share-alike too.
- **`liveCamera`** (optional): an https link to a public live camera at the venue, shown as a "Live camera" button. A link, not an embed: camera players such as EarthCam's only play on sites they have approved.
- **`sources`**: one or more schedule sources; events from all of them are merged and de-duplicated.
- **`stories`** (optional): news stories from the old site's `/stories/<slug>` pages, shown on the venue page. Each is `{ "slug", "title", "date": "YYYY-MM-DD", "body": ["paragraph", …] }`, plus optional `summary`, `author`, `updated` (YYYY-MM-DD) and `image` (a file in `public/images/stories/`). Copy the text exactly as the old page had it. The build writes a redirect from `/stories/<slug>` to `/venues/<venue>#<slug>`, so keep `slug` exactly as the old URL had it.

Venues that aren't music venues at all go in `data/redirects.json` instead (old slug → `/venues`).

Run `node scripts/validate.js` after editing.

## Fixing a scraper

Repair issues are opened automatically and name the venue, the error, and the current config. To fix one:

1. **Reproduce.** `node scripts/scrape.js --venue <slug> --dry` prints what the scraper finds without writing anything.
2. **Find the schedule.** Open the venue's website and look for where its calendar actually comes from. View the page source and the browser's network tab — the data is often in a feed or API behind the page:
   - Google Calendar embed → its public `.ics` URL (`https://calendar.google.com/calendar/ical/<id>/public/basic.ics`)
   - WordPress with *The Events Calendar* (`tribe-events` in the HTML, `/wp-json/tribe/…`) → `tribe`
   - Squarespace events page → `squarespace` (or a calendar block's `collectionId`)
   - Wix Events → `wix`; Tockify → `ics` with `https://tockify.com/api/feeds/ics/<name>`
   - TicketWeb, Tixr, DICE, many WordPress plugins embed `application/ld+json` events → `jsonld`
   - Eventbrite organizer page → `eventbrite`
   - SpotHopper sites (`static.spotapps.co`, `spot_id=` in the HTML) → `spothopper`
   - Bill's Gigulator widget (`billsgigulator.com/app/sqs/<id>`) → `gigulator`
   - Ticketmaster or Live Nation ticketing → `ticketmaster` with the Discovery venue id: the `KovZ…` in the venue's livenation.com URL, or `TICKETMASTER_API_KEY=… node scripts/ticketmaster-venues.js <name>`
   - Listed on JamBase (`jambase.com/venue/…`) but the venue's own site has no usable feed → `jambase` with the JamBase venue id from `JAMBASE_API_KEY=… node scripts/jambase-venues.js <name>`. The key is on a free plan with 1,000 calls a month, so use it only where no direct source works
   - Anything server-rendered → `html` with CSS selectors
   - Schedule posted only on Instagram or other social media → `manual` (see [Manual schedules](#manual-schedules))
3. **Try a config** before saving it: `node scripts/scrape.js --try '{"type":"html","url":"…","item":".event","title":"h3","date":".date"}'`
4. **Save** the working config in the venue's `sources`, then run `node scripts/scrape.js --venue <slug> --dry` again.
5. If no generic adapter fits, write `scrapers/custom/<name>.js` (below) and reference it as `{ "type": "custom", "name": "<name>" }`.
6. **Add a test** with a small saved fixture in `test/fixtures/` for any new adapter, custom scraper, or adapter change. Tests must not hit the network.
7. Run `npm test` and `node scripts/validate.js`, then open a PR that says `Fixes #<issue>`. CI live-scrapes the venues your PR touches and fails if they return nothing.

If the venue has **closed**, set `"status": "closed"`, remove `sources`, and add a `note` with what you found. If it is open but genuinely publishes no schedule anywhere online, say so on the issue rather than inventing a source.

Please don't scrape sites whose `robots.txt` forbids it, and don't add sources behind logins or paywalls.

### Adapter reference

| `type` | Options |
| --- | --- |
| `ics` | `url` |
| `tribe` | `url` (site root), `categories?`, `venue?` |
| `squarespace` | `url` (events page) **or** `url` + `collectionId` (calendar block) |
| `jsonld` | `url` or `urls`, `location?` (keep events whose location contains this text) |
| `eventbrite` | `url` (organizer page `https://www.eventbrite.com/o/…`), `location?` |
| `spothopper` | `spotId`, `url?` (link for events) |
| `wix` | `url` (page with the events widget), `eventUrl?` (`https://…/{slug}`) |
| `gigulator` | `site` (numeric id), `url?` |
| `ticketmaster` | `venueId` (Discovery id, `KovZ…`). Needs the `TICKETMASTER_API_KEY` env var (an Actions secret in CI); parking and VIP add-on listings are dropped |
| `jambase` | `venueId` (`jambase:<id>`), `url` (the venue's `jambase.com/venue/…` page, shown as the schedule source: attribution is required). Needs the `JAMBASE_API_KEY` env var (an Actions secret in CI). All jambase venues in a run share one API request; the run is skipped when the monthly quota runs low. Cancelled and postponed shows are dropped |
| `html` | `url`/`urls`, `item`, `title`, `date`, `time?`, `link?`, `dateHeader?`, `next?`, `maxPages?` — selectors are CSS, `sel@attr` reads an attribute |
| `manual` | `url` (the venue's Instagram page, shown as the schedule source), `kinds?` (default `["music"]`). Reads `data/manual/<slug>.json`; see [Manual schedules](#manual-schedules) |

Options every source accepts (applied when events are normalized):

| Option | Effect |
| --- | --- |
| `exclude` | array of regexes; matching titles are dropped (`Closed`, `Private event`, `TBA` are dropped by default) |
| `include` | regex; keep only matching titles |
| `stripTitle` | regex removed from titles (e.g. `"\\s*•.*$"`) |
| `timeFromTitle` | `true` to take the time from the title when the source's timezone is wrong |

### Manual schedules

Some venues only post their schedule on Instagram, which we can't scrape. For those, a person or an agent (currently Meta Muse, which reads the venue's posts) writes the schedule to `data/manual/<slug>.json`, and the venue gets `{ "type": "manual", "url": "https://www.instagram.com/<handle>/" }` in its `sources`; the venue page links that `url` as the schedule source. Pushing a change under `data/manual/` to `main` validates the files and rescrapes those venues straight away, so the site updates within a few minutes.

```json
{
  "venue": "bar-redux",
  "updated": "2026-11-09",
  "from": "https://www.instagram.com/p/DfdHNi-hUog/",
  "events": [
    {
      "date": "2026-11-13",
      "time": "21:00",
      "doors": "20:00",
      "title": "Children of Judas, Redder Moon, Stripper Funeral, DJ Mange",
      "price": "$10",
      "kind": "music",
      "url": "https://www.instagram.com/p/DfdHNi-hUog/"
    }
  ]
}
```

| Field | Rules |
| --- | --- |
| `venue` | the venue slug; must match the file name |
| `updated` | `YYYY-MM-DD` the schedule was last checked |
| `from` | optional: the account or post the schedule came from |
| `events[].date` | `YYYY-MM-DD`, with the year |
| `events[].time` | show start, 24-hour New Orleans time (`"21:00"`), or `null` if the post gives none (the event shows as all-day) |
| `events[].doors` | optional door time, same format; used as the start when `time` is `null` |
| `events[].end` | optional end time, same format; an end earlier than the start means after midnight |
| `events[].title` | the performers (`"Band A, Band B"`) or the event's name. No dates, times, prices or emoji |
| `events[].kind` | `music`, `dj`, `trivia`, `comedy`, `sports`, `special` or `other`. Only `music` is shown unless the source sets `kinds` |
| `events[].price` | optional, free text (`"$10"`, `"free"`); stored but not shown yet |
| `events[].url` | optional: the post announcing it |
| `events[].note` | optional, free text; not shown |

Replace the whole file each time; past events are dropped automatically. Don't add a `manual` source for a venue that already has a working feed, or its shows appear twice under slightly different titles.

### Custom scrapers

```js
// scrapers/custom/example-venue.js
import * as cheerio from 'cheerio';
import { fetchText } from '../../scripts/lib/http.js';
import { parseLooseDate } from '../../scripts/lib/dates.js';

export default async function scrape(source, { window }) {
  const $ = cheerio.load(await fetchText('https://example.com/music'));
  return $('.show').map((_, el) => {
    const parsed = parseLooseDate($(el).find('.date').text(), $(el).find('.time').text());
    return parsed && { title: $(el).find('h2').text(), start: parsed.start, allDay: parsed.allDay };
  }).get().filter(Boolean);
}
```

Return an array of `{ title, start, end?, allDay?, url? }`. `start`/`end` may be ISO strings (no offset = New Orleans time), epoch milliseconds, `Date`s or Luxon `DateTime`s. Normalization handles cleanup, the date window and de-duplication.

## Adding a venue

1. Create `data/venues/<slug>.json` (lowercase, hyphenated slug).
2. Get coordinates from the address (e.g. OpenStreetMap) — they must fall inside New Orleans.
3. Add a schedule source as above, or leave `sources: []` and an issue will be opened for it.
4. Optional photo: `public/images/venues/<slug>.jpg` + `<slug>-600.jpg`.

## Artists

`data/artists/<slug>.json` is one band or musician (musicians only: no comedians, burlesque or DJ nights). The build finds each artist's name in scraped event titles and links it to `/artists/<slug>`, which lists their upcoming shows at every venue. Events on disk are never changed; the match is redone on every build.

```json
{
  "slug": "kermit-ruffins",
  "name": "Kermit Ruffins",
  "aliases": ["Kermit Ruffins & the BBQ Swingers"],
  "spotify": "22-character Spotify artist id",
  "musicbrainz": "MusicBrainz artist id",
  "links": { "appleMusic": "https://…", "bandcamp": "https://…", "youtube": "https://…", "soundcloud": "https://…", "instagram": "https://…", "website": "https://…" },
  "tips": [
    { "service": "venmo", "handle": "@kermitruffins", "url": "https://venmo.com/u/kermitruffins", "source": "https://kermitruffins.com/faq" }
  ]
}
```

- Only `slug` and `name` are required. `aliases` are other billings that mean this artist. Case, accents, `&` vs `and`, apostrophes and a leading "The" are ignored when matching, so don't list those variants.
- A name matches only as whole words, longest name first, and not after phrases like "tribute to" or "music of". Two artists can't share a name or alias (`node scripts/validate.js` checks).
- Like venues, an artist's `slug` is a live URL: don't change or delete it.
- Not every act needs a page. A wrong match is worse than a missing one, so add an artist only when you're sure who it is, and a link only when it's the artist's own.
- `tips` are the artist's tip jars, shown on their page as small brand-colored buttons in a "Tip jar" box under the music links (only entries with a `url` get a button). `service` is `venmo`, `cashApp` or `paypal`; `handle` is the account as the artist published it (`@Tubaskinny`, `$tedhefko`, `tubaskinny@gmail.com`); `url` is the payment link (`https://venmo.com/u/<name>`, `https://cash.app/$<name>`, `https://paypal.me/<name>`), left out when there's none; `name` is optional and shown instead of the handle when the account's display name differs from it (an account in a manager's name). `source` is required: the page where the artist published it, as a URL, or a short note when there is no URL ("OffBeat listing, 2020"). Add a tip jar only from the artist's own site or social profiles, or a page that clearly names the artist, never a guessed handle.

`node scripts/artists.js candidates` lists names on the schedules with no artist file. `node scripts/artists.js discover --write` looks them up on MusicBrainz and creates a file only when exactly one Louisiana act has that exact name, taking its Spotify id, links and any Venmo, Cash App or PayPal links (as `tips`) from MusicBrainz. Everything else is skipped.

Photos and genres go into `data/artist-meta.json`, which is generated: `node scripts/artists.js refresh` rewrites it. Photos come from Spotify for every artist with a `spotify` id: without `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from Spotify's public oEmbed endpoint, with them larger ones from the Web API. Genres come from MusicBrainz for every artist with a `musicbrainz` id, and from Spotify too when the keys are set (the client id may be saved as an Actions secret or variable).

The artists directory filters by a dozen broad genres (Traditional jazz, Modern jazz, Brass band…), worked out at build time in `scripts/lib/genres.js` from those specific genres and from words in a band's name that leave no doubt ("Brass Band", "Jazz", "Zydeco"). To file a new specific genre under a broad one, add it to that genre's `match` there, with a test. Photos are linked from Spotify's CDN, never copied into the repo. The weekly "Update artists" workflow runs `discover --write` and `refresh` and commits the result.

### Articles

`data/articles/<slug>.md` is original writing for the site about one artist, shown in full on that artist's page under the shows. Front matter, then plain paragraphs separated by blank lines (no Markdown formatting):

```
---
title: The Rise of Red Balloon
dek: One-line summary under the headline (optional)
author: Landry von Bohn
date: 2022-06-08
artist: tank-and-the-bangas
---

First paragraph.
```

`artist` must be a file in `data/artists/`. `node scripts/validate.js` also rejects leftover HTML entities (`&#34;`) and `**`.

## Food pop-ups

Food trucks and pop-ups move around, so they aren't venues. They get a page each at `/food/<slug>`, a purple marker on the map (a venue with a show and food the same day keeps the music color), and a line on the host venue's page when they're at a venue. Everything lives in `data/food/`:

- `vendors/<slug>.json`: one per vendor, its profile and the stops it posted. Meta Muse writes these from Instagram and pushes to `main`, like `data/manual/`; a push under `data/food/` validates and redeploys without a scrape. The slug is a live URL: never change or delete one.
- `places.json`: where stops happen that aren't venues, keyed by a lowercase-with-dashes id: `{ "name", "address", "lat", "lng", "approximate"? }`. A venue is never repeated here; use its slug as the stop's place.
- `sources.json`: host calendars scraped for pop-ups by `node scripts/food.js` (every scheduled scrape run). Each entry is `{ "place", "source", "include"?, "exclude"?, "rename"? }`: `source` is any adapter config from the table above, `include` is a regex for the food events (default `pop-?up|food truck`), and each vendor is named from the event title (the part before a colon, without a trailing "Pop-up" or "Food Truck"), then `rename` maps title regexes to names. A vendor with no file of its own gets a plain page from its name; add a vendor file with just `slug`, `name`, `icon` and `type` to give it an icon.
- `scraped/<place>.json`: written by `scripts/food.js`. Don't hand-edit.

```json
{
  "slug": "porchettaboudit",
  "name": "Porchettaboudit",
  "icon": "pig",
  "type": "Pop-up",
  "description": "Porchetta pop-up: Tuesdays at The Kingpin, Saturdays at The Friendly Bar.",
  "website": "https://example.com",
  "from": "https://www.instagram.com/p/DfQd3Edq56M/",
  "updated": "2026-11-15",
  "events": [
    { "date": "2026-11-17", "time": "18:00", "end": "22:00", "place": "the-kingpin", "confirmedOn": "2026-11-02", "url": "https://www.instagram.com/p/DfQd3Edq56M/" }
  ]
}
```

| Field | Rules |
| --- | --- |
| `slug`, `name` | required; `slug` matches the file name |
| `icon` | one of the keys in `src/templates/food-icons.js` (Hugeicons free set, MIT); the placeholder until vendors have photos |
| `type` | `Pop-up` or `Food truck` |
| `description`, `website`, `from`, `updated` | optional; `from` is the latest post the stops came from (the page's Instagram button) |
| `events[].date`, `time`, `end` | `YYYY-MM-DD`; 24-hour New Orleans times, `time` `null` if none given; an `end` earlier than `time` is after midnight |
| `events[].place` | a venue slug or a key in `places.json` |
| `events[].confirmedOn` | the date of the post that announced the stop, or the weekly schedule it follows. Older than 30 days, the site says "Not confirmed since …" |
| `events[].price`, `note`, `url`, `basis` | optional; `note` is shown, `basis` (how the stop was worked out) is not |

## Parades

Parade data has its own pipeline and stricter sourcing rules than venues: routes and nearly all dates from official City of New Orleans records only, plus dates organizers announce on their own sites (`data/parades/announced.json`). See [docs/parades.md](docs/parades.md) before changing `scripts/parades.js`, `scripts/lib/permits.js`, `scripts/lib/route-trace.js` or anything in `data/parades/`.

## Site code

`scripts/build.js` renders `src/templates/*.js` into `_site/`. Styles are in `src/assets/styles.css` (dark by default, light via `prefers-color-scheme` or the toggle), the map in `src/assets/map.js`. Keep dependencies minimal — the site has no framework or bundler on purpose.
