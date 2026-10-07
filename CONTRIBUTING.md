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

Options every source accepts (applied when events are normalized):

| Option | Effect |
| --- | --- |
| `exclude` | array of regexes; matching titles are dropped (`Closed`, `Private event`, `TBA` are dropped by default) |
| `include` | regex; keep only matching titles |
| `stripTitle` | regex removed from titles (e.g. `"\\s*•.*$"`) |
| `timeFromTitle` | `true` to take the time from the title when the source's timezone is wrong |

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

## Site code

`scripts/build.js` renders `src/templates/*.js` into `_site/`. Styles are in `src/assets/styles.css` (dark by default, light via `prefers-color-scheme` or the toggle), the map in `src/assets/map.js`. Keep dependencies minimal — the site has no framework or bundler on purpose.
