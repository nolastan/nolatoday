# Parade data validation

`compare.js` measures the official parade data in `data/parades/parades.geojson` against a third-party schedule (the answer key). It prints a coverage and accuracy table and writes nothing but a local cache.

```sh
node validation/parades/compare.js               # the schedule page as it is today
node validation/parades/compare.js --season 2026 # an earlier season, from the Internet Archive
```

Rules for this folder:

- Answer-key data stays here. It never goes into `data/`, test fixtures, default values or anything the site publishes.
- The site build and `scripts/parades.js` do not read this folder.
- `.cache/` is not committed.
- WWOZ is not used, even for checking: its `robots.txt` turns automated readers away.
