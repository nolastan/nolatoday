# NOLA.Today

Static site of New Orleans live music venues. Venue data is JSON in `data/venues/`; GitHub Actions scrape schedules into `data/events/` and build a static site for GitHub Pages. No database, no framework.

Read `CONTRIBUTING.md` before changing scrapers or venue data — it covers the venue file format, every adapter's options, and the scraper-repair workflow.

## Commands

- `node scripts/scrape.js --venue <slug> --dry` — run one venue's scrapers, print results, write nothing
- `node scripts/scrape.js --try '<source json>'` — test a source config
- `npm test` — unit tests (fixture-based, offline)
- `node scripts/validate.js` — check venue data
- `node scripts/build.js` — build `_site/`

## Rules

- Never change a venue's `slug` or delete a venue file: slugs are live URLs with search traffic. Rename with `name`; close with `"status": "closed"` + `note`; redirect non-venues via `data/redirects.json`.
- Don't hand-edit `data/events/` or `data/status.json`; they're generated.
- Prefer configuring a generic adapter in `scrapers/` over writing `scrapers/custom/*.js`. Any new adapter or custom scraper needs a fixture test in `test/`.
- Tests must not hit the network.
- Respect `robots.txt`; don't scrape sites that disallow it.
- For a scraper issue, reference it in the PR (`Fixes #N`). The issue closes itself after the next successful scrape anyway.
