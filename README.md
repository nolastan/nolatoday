# NOLA.Today

A map of live music in New Orleans tonight, plus a page with the upcoming schedule for every venue. It replaces the Rails app in [`nolastan/okra`](https://github.com/nolastan/okra) and runs entirely on GitHub:

- **Data** lives in this repo as JSON. No database.
- **Scrapers** run on a schedule in GitHub Actions and commit fresh schedules.
- **Broken scrapers** open GitHub issues automatically, for a coding agent (or a person) to fix.
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
| `data/venues/*.json` | One file per venue. `status` is `active` (scraped, on the map) or `closed` (page kept with a notice). |
| `data/redirects.json` | Old venue URLs that now redirect (merged duplicates, non-music venues). |
| `data/events/*.json` | Scraped events. Don't edit by hand — the next scrape overwrites them. |
| `scrapers/` | One adapter per platform (`ics`, `tribe`, `squarespace`, `jsonld`, `eventbrite`, `spothopper`, `wix`, `gigulator`, `html`), plus `custom/` for one-offs. |
| `scripts/` | `scrape.js`, `build.js`, `report-issues.js`, `validate.js`. |
| `src/` | Page templates, CSS and browser JS. |
| `public/` | Copied to the site as-is — includes the venue photos in `public/images/venues/`. |
| `archive/venue-photos/` | Original photos of venues that are no longer listed (not published). |

## Running it locally

Requires Node 20+.

```sh
npm install
node scripts/scrape.js --venue the-spotted-cat --dry   # try one scraper without writing files
node scripts/scrape.js                                  # scrape everything
node scripts/build.js && npx serve _site                # build and preview at http://localhost:3000
npm test                                                # unit tests (fixtures, no network)
node scripts/validate.js                                # check venue data
```

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

At most 10 new issues are opened per run. Issues close themselves with a comment once the problem clears. Each issue explains how to reproduce and fix the scraper; [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

## URLs and SEO

The old site's URLs are preserved:

- `/` — the map, `/venues` — the directory, `/venues/<slug>` — venue pages (same slugs as before).
- Duplicate and removed venues get a static redirect page (meta refresh + `rel=canonical`), since GitHub Pages can't send 301s. `/music` and `/food` redirect to `/venues`.
- Every page has a canonical URL on `https://nola.today`, and venue pages include `MusicVenue`/`MusicEvent` structured data.
- `sitemap.xml` and `robots.txt` are generated.

- Old `/stories/<slug>` pages about a venue live on that venue's page (the `stories` field in its venue file); the old URL redirects there.

Other pages that were dropped (artists, pop-ups, the remaining stories, permits) now 404 — see the open issue about them.

## Going live on nola.today

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables:** add `MAPBOX_TOKEN` with the public Mapbox token (`pk.…`) — the same one the old site uses. It's kept out of the repo because GitHub push protection treats Mapbox tokens as secrets. For local builds, `MAPBOX_TOKEN=pk.… node scripts/build.js`.
3. Run the *Scrape venues* workflow once (Actions tab → *Run workflow*) to populate data and deploy.
4. **Settings → Pages → Custom domain:** `nola.today`, then point DNS at GitHub Pages ([docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)). Enable *Enforce HTTPS*.
5. Restrict the Mapbox token to `nola.today` (and `nolastan.github.io` while testing) in your Mapbox account.

If `main` is branch-protected, allow GitHub Actions to push to it (the scraper commits data there).
