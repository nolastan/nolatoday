# NOLA.Today

Static site of New Orleans live music venues. Venue data is JSON in `data/venues/`; GitHub Actions scrape schedules into `data/events/` and build a static site for GitHub Pages. No database, no framework.

Read `CONTRIBUTING.md` before changing scrapers or venue data — it covers the venue file format, every adapter's options, and the scraper-repair workflow.

## Commands

- `node scripts/scrape.js --venue <slug> --dry` — run one venue's scrapers, print results, write nothing
- `node scripts/scrape.js --try '<source json>'` — test a source config
- `npm test` — unit tests (fixture-based, offline)
- `node scripts/validate.js` — check venue data
- `node scripts/build.js` — build `_site/`
- `node scripts/parades.js --dry` — pull official parade data, print, write nothing

## Rules

- Never change a venue's `slug` or delete a venue file: slugs are live URLs with search traffic. Rename with `name`; close with `"status": "closed"` + `note`; redirect non-venues via `data/redirects.json`.
- Don't hand-edit `data/events/` or `data/status.json`; they're generated.
- `data/manual/` holds schedules for Instagram-only venues, written by Meta Muse straight to `main` (format in CONTRIBUTING.md). Fix format problems there, but don't add a `manual` source to a venue that has a working feed.
- Prefer configuring a generic adapter in `scrapers/` over writing `scrapers/custom/*.js`. Any new adapter or custom scraper needs a fixture test in `test/`.
- Tests must not hit the network.
- Respect `robots.txt`; don't scrape sites that disallow it.
- For a scraper issue, reference it in the PR (`Fixes #N`). The issue closes itself after the next successful scrape anyway.
- Parades (`data/parades/parades.geojson`) come from City of New Orleans records; read `docs/parades.md` before touching them. The one exception: `data/parades/announced.json` holds a date and time an organization announced on its own website (the one in `websites.json`) for a parade the city has no record of yet, and the city's record replaces it once filed. Routes come only from the city. Never add dates, times or routes from third-party sites (aggregators, WWOZ, news), and never publish private events from the permit feed. Don't hand-edit the GeoJSON; `data/parades/krewes.json` (names only), `data/parades/websites.json` (each organization's own site, confirmed before adding), `data/parades/announced.json` (organizer-announced dates, no routes) and `data/parades/photos.json` (freely licensed photos, each with its credit) are the only hand-kept files.
