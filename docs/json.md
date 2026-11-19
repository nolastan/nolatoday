# Public JSON

The build publishes the data behind the site's pages as JSON, for the iOS app and anyone else building on it. Keep these files backward compatible: add fields, never rename or remove one. Optional fields are left out rather than set to `null`. Times are ISO 8601 with an offset, or a bare date for all-day items. Image paths starting with `/` are relative to the site and may carry a `?v=` cache-buster.

| File | What it holds |
| --- | --- |
| `/events.json` | Map data: the next 8 days of shows and food stops, parades from yesterday to ~400 days out, compact keys. |
| `/venues.json` | Every venue: `slug, name, status, address, lat, lng, website?, url, upcoming, sources, imageCredit?, image?, json`. |
| `/venues/<slug>.json` | One venue page: the fields above plus `note?, imageLarge?, updated?` (last successful scrape), `events` (the full upcoming schedule), `recent` (recent shows) and `food` (pop-ups at the venue). |
| `/artists.json` | Every artist: `slug, name, url, upcoming, image?, genres?` (specific), `broadGenres?` (the directory's filter, slugs from `GENRES` in `scripts/lib/genres.js`), `links`. |
| `/food.json` | `places` (by key, same keys as `events.json` `foodPlaces`), `icons` (SVG path markup), `vendors` with `slug, name, type, icon, description?, website?, instagram?, url, stops`. |
| `/parades.json` | `organizations`, each with `slug, name, category, url, website?, photos` (with credit), `upcoming` and `recent` (latest 10) parades: `id, name, category, date, start?, end?, street?, point?, route?`. Routes are in `parades.geojson` and `events.json`. |
| `/parades.geojson` | Every parade the city has listed, with routes. |

Shows: `{ title, start, end?, allDay?, url?, artists? }`, where `artists` is `[[slug, start, end], …]`, UTF-16 index ranges of each artist's name in `title`. Recent shows have `title, start, artists?`.

Food stops: `{ start, end?, allDay?, price?, note?, url?, confirmedOn?, unconfirmed? }`, plus `place` in `food.json` and `vendor, vendorName, icon` on a venue. `unconfirmed: true` means the vendor hasn't confirmed the stop in the last 30 days.

The builders are in `scripts/lib/feeds.js`, tested in `test/feeds.test.js`.
