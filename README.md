# NOLA.Today

A map of live music happening tonight, plus a page with the upcoming schedule for every venue. It powers [nola.today](https://nola.today) for New Orleans, and you can fork it for your own city.

It runs entirely on GitHub, with no server and no database:

- **Data** lives in the repo as JSON files, one per venue.
- **Scrapers** run on a schedule in GitHub Actions, read each venue's calendar (ICS feeds, WordPress, Squarespace, Wix, Eventbrite, structured data, plain HTML…) and commit the results.
- **Broken scrapers** open GitHub issues on their own, so a person or a coding agent can fix them.
- **The site** is plain static HTML built from the JSON and served by GitHub Pages.

## How it works

```
data/venues/<slug>.json     hand-curated: name, address, coordinates, photo, schedule sources
        │
        ▼  scripts/scrape.js  (Actions, every 6 hours)
data/events/<slug>.json     upcoming shows (generated)
data/status.json            health of every scraper (generated)
        │                       │
        │                       ▼  scripts/report-issues.js
        │                   opens/closes "scraper" issues
        ▼  scripts/build.js
_site/                      static site → GitHub Pages
```

| Path | What it is |
| --- | --- |
| `site.config.json` | Site name, URL, map settings, analytics and other per-site settings. |
| `data/venues/*.json` | One file per venue. `status` is `active` (scraped, on the map) or `closed` (page kept with a notice). |
| `data/redirects.json` | Old venue URLs that redirect elsewhere (merged duplicates, non-music venues). |
| `data/events/*.json` | Scraped events. Generated — the next scrape overwrites them. |
| `scrapers/` | One adapter per platform (`ics`, `tribe`, `squarespace`, `jsonld`, `eventbrite`, `spothopper`, `wix`, `gigulator`, `html`), plus `custom/` for one-offs. |
| `scripts/` | `scrape.js`, `build.js`, `report-issues.js`, `validate.js`. |
| `src/` | Page templates, CSS and browser JS. |
| `public/` | Copied to the site as-is, including venue photos in `public/images/venues/`. |

## Running it locally

Requires Node 20+.

```sh
npm install
node scripts/scrape.js --venue the-spotted-cat --dry   # try one venue's scrapers without writing files
node scripts/scrape.js                                  # scrape everything
node scripts/build.js && npx serve _site                # build and preview at http://localhost:3000
npm test                                                # unit tests (fixtures, no network)
node scripts/validate.js                                # check venue data
```

The map needs a public [Mapbox](https://www.mapbox.com) token: `MAPBOX_TOKEN=pk.… node scripts/build.js`. Everything else works without one.

## Making one for your city

1. **Fork the repo** and clear out the New Orleans data: empty `data/venues/`, `data/events/`, `public/images/venues/` and `public/images/stories/`, reset `data/redirects.json` to `{}`, and delete `data/status.json` (the next scrape recreates it). Replace `public/images/og-default.jpg`, the default social-sharing image.
2. **Edit `site.config.json`:** `siteName`, `siteUrl`, `description`, `repo` (your `owner/name`, used for "report a problem" links), the map `center` (`[lng, lat]`) and `zoom`, and your Mapbox styles. Remove `fathomSite` and `referrals`, or replace them with your own.
3. **Replace the remaining city-specific bits**, which aren't in the config yet:
   - the time zone (`America/Chicago`) in `scripts/lib/time.js` and `src/assets/map.js`,
   - the coordinate bounds in `scripts/validate.js`,
   - the city name and site name in `src/templates/` (page titles, descriptions, the footer and the venue address/structured data),
   - the scraper's user agent in `scripts/lib/http.js` and the bot name in `.github/workflows/scrape.yml`.

   `grep -rn "New Orleans\|nola\|America/Chicago" scripts src scrapers .github` finds them.
4. **Add venues.** Each one is a JSON file in `data/venues/` with a name, address, coordinates and one or more schedule `sources`. [`CONTRIBUTING.md`](CONTRIBUTING.md) documents the format, every adapter's options, and how to find where a venue's calendar really comes from. Test each source with `node scripts/scrape.js --venue <slug> --dry` and run `node scripts/validate.js` when you're done.
5. **Deploy** (below).

Please respect each venue's `robots.txt`, and don't scrape anything behind a login or paywall.

## Deploying to GitHub Pages

1. **Settings → Pages → Build and deployment → Source:** GitHub Actions.
2. **Settings → Secrets and variables → Actions → Variables:** add `MAPBOX_TOKEN` with your public Mapbox token (`pk.…`). It's a variable rather than a committed value because GitHub push protection treats Mapbox tokens as secrets.
3. Run the *Scrape venues* workflow once (Actions tab → *Run workflow*) to fetch schedules and deploy.
4. Optionally set a **custom domain** under Settings → Pages and point DNS at GitHub Pages ([docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)), then enable *Enforce HTTPS*. Without one, the site is served from `<user>.github.io/<repo>` and the build handles the sub-path automatically.
5. In your Mapbox account, restrict the token to your domain.

If `main` is branch-protected, allow GitHub Actions to push to it — the scraper commits data there.

## Workflows

| Workflow | When | Does |
| --- | --- | --- |
| `scrape.yml` | every 6 hours, or manually | scrape → commit `data/` → open/close repair issues → deploy |
| `deploy.yml` | push to `main`, manually, or after a scrape | build and publish to GitHub Pages |
| `ci.yml` | pull requests | validate data, run tests, build, and live-scrape any venue whose file changed |

### Repair issues

After each full scrape, `scripts/report-issues.js` compares `data/status.json` with the venue list and keeps one issue per problem, labelled `scraper` plus one of:

- `scraper: broken` — the scraper errored two runs in a row,
- `scraper: no events` — it runs but has found nothing for 14 days (3 days for a new source),
- `scraper: needs source` — an active venue with no schedule source yet.

At most 10 new issues are opened per run, and each closes itself with a comment once the problem clears. Every issue explains how to reproduce and fix the scraper; [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

## SEO

- Pages live at `/` (the map), `/venues` (the directory) and `/venues/<slug>`. A venue's slug is its permanent URL, so rename a venue by changing its `name`, never its slug.
- Every page has a canonical URL on `siteUrl`, and venue pages include `MusicVenue`/`MusicEvent` structured data.
- Merged or removed venues get a static redirect page (meta refresh + `rel=canonical`), since GitHub Pages can't send 301s. List them in a venue's `aliases` or in `data/redirects.json`.
- `sitemap.xml` and `robots.txt` are generated.

## Contributing

Fixes to venue data and scrapers are welcome. Venue info wrong on nola.today? Use the "report a problem" link on its page, or open an issue. To fix a scraper or add a venue, see [`CONTRIBUTING.md`](CONTRIBUTING.md).
