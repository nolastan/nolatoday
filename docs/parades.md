# Parades

Parade routes and schedules on NOLA.Today come from records the City of New Orleans publishes, and from nowhere else. `scripts/parades.js` pulls them into one file, `data/parades/parades.geojson`, which the site build turns into routes on the home map, a page per krewe or club (`/parades/<slug>`), the directory (`/parades`) and a public copy at `/parades.geojson`.

```sh
node scripts/parades.js --dry        # fetch and print, write nothing
node scripts/parades.js              # fetch and write data/parades/parades.geojson
node scripts/parades.js --no-cache   # ignore responses cached in .cache/parades
node validation/parades/compare.js   # coverage and accuracy against the answer key
```

`.github/workflows/parades.yml` runs the pull twice a day, commits any change and deploys.

## The rules

1. **Official sources only.** Every feature carries `source_url`, `sources` and `field_sources`, and `checkFeature` refuses anything whose sources are not City of New Orleans addresses. If a source is down or its fields change, the run stops without writing. It never fills a gap from somewhere else.
2. **Third-party sites are answer keys, not sources.** `validation/parades/` may read one to measure coverage. Nothing from it goes into `data/`, test fixtures or defaults. WWOZ is not read at all: its `robots.txt` turns automated readers away.
3. **No route from third-party words.** A line is drawn from text only when the text is the city's own record (a permit application). If that cannot be done with confidence, the parade is published with `geometry: null` and the reason in `route_problem`.
4. **Public parades only.** The permit feed is mostly weddings and private parties. Those are filtered out before anything is written or printed, and the raw rows live only in the uncommitted response cache. Only the route line of an application is ever published, never its staffing notes or contact details.

## Sources

Checked on 2026-11-12. "Verified" means read by script on that date; "inferred" is marked as such.

| Source | What it gives | Refresh | Terms |
| --- | --- | --- | --- |
| [Mardi Gras Routes](https://data.nola.gov/Arts-Culture-History/Mardi-Gras-Routes/tkeu-9s5e) (data.nola.gov `tkeu-9s5e`, mirror of `maps.nola.gov` SpecialEvents/Special_Events layer 3) | Route geometry, date, start time, formation and disband text for 36 Carnival parades. Held only the 2026 season. | Rows last updated 2026-02-06. Inferred: reloaded once a season, in January. | **Unclear.** The dataset has no license field. |
| [Routewise public layer](https://routewise.nola.gov/) (`routewise_public/FeatureServer/0` in the city's ArcGIS Online organization) | Route geometry and start time for 33 Carnival parades, plus portable toilets, first aid, lost child, vendor, parking and traffic flags. Has Thoth, which the open data layer lacks. | Last edited 2026-02-09. | **Unclear.** No license; the city's ArcGIS items carry a "general informational purposes only" disclaimer. |
| [Permit applications](https://data.nola.gov/d/aib5-en5t) (data.nola.gov `aib5-en5t`, rows with `type = 'Special Event - Master'`) | Second lines, walking krewes, school and holiday parades: date, line-up, start and end times, start address, and often the route written out street by street. About 2,500 applications a year, nearly all private. | Daily (last updated 2026-11-12). | **Unclear.** No license field. |
| [CNO Road Centerlines](https://services.arcgis.com/VhMjCzR3cIjEkh7L/arcgis/rest/services/CNO_Road_Centerlines_100Blk/FeatureServer/0) | The street network (28,523 segments with address ranges) that written routes are drawn along. Not a source of parades. | Fetched only when a new route needs drawing, cached for a week. | **Unclear**, same disclaimer. |

Checked and not used: `eocgis` SpecialEventsRouted (a 2019 snapshot), `MG_ParadeDayof` (empty), the old `routewise` layer (2020 rows), NOLA Ready's parade pages (404 out of season; its second line route posts stopped in 2022), RTA's event list (names and dates, no routes).

Because none of the sources states a license, the attribution below credits the city and repeats its disclaimer. **This is worth a human check before relying on it commercially.**

### Attribution block

Shown on `/parades` and summarized in the site footer:

> Parade dates, times and routes come from records published by the City of New Orleans: Permit Application Data (Office of Business and External Services), Mardi Gras Routes (NOHSEP), the Routewise public layer and CNO Road Centerlines (Enterprise GIS). The city offers this data for general information and does not guarantee it. Second lines and walking parades are shown from permit applications, which are requests, not approvals. Routes written out in words are drawn along the city's street map by NOLA.Today.

## What the data covers

Verified on 2026-11-12:

- **83 parades**: 39 Carnival, 38 second lines, 6 others, dated June 2025 to January 2027. 64 have a route line.
- **Carnival**: 37 parades with city geometry for the 2026 season. Against the answer key, the city's layers cover 36 of the 46 Orleans Parish parades it lists and none of the 32 in other parishes. The other parishes are outside the city's data by design, not a gap in it. Missing inside Orleans Parish are mostly small walking krewes; one of them (Mosaique) now arrives through its permit application. Where both Carnival layers have a parade they agreed on every date and disagreed on two start times (Muses, Tucks); the pipeline takes the more recently edited layer and prints the disagreement.
- **Permit parades**: 48 public parades passed the filter out of 3,838 applications filed in the last 18 months. Two are Carnival krewes the city already maps. Of the other 46, 40 have a written route; 27 of those were drawn, 11 of them with no inference at all.
- **Lead time**: permit parades were filed a median of 23 days before the parade (3 to 191 days). The Carnival layers are for the season just past until the city reloads them; when they first appear each year has not been observed yet, and `first_seen` on each feature will record it from now on.
- **No answer key for second lines.** The one complete public calendar is on a site that does not allow automated reading, so second line coverage is unmeasured. Inferred from the club names present: most of the Sunday season is in the feed, but not all of it.

## How a written route becomes a line

`scripts/lib/permits.js` reads the city's write-up (`Title - address - date`, then `Route:`, `Formation:`, `Start:`, `End:`), and `scripts/lib/route-trace.js` walks the route along the centerlines:

- Every street named has to exist in the centerline data (typos within two letters and common short forms like "MLK" are accepted) and has to meet the street before it.
- A stated "left" or "right" has to agree with the geometry.
- Addresses on the street the route is on are walked to. Addresses of stops elsewhere have to end up within 300 m of the finished line, which catches a route read the wrong way.
- Three kinds of inference are allowed, and each is recorded in `route_notes`: bridging a gap of a block or two that the text skips, following a street on where it changes name (Simon Bolivar becomes La Salle), and reading "to X" as a point passed rather than a turn when the next street is further along the same way.
- Anything else fails the whole route. The parade is still published, with its start address as a point on the map. The city's route text stays in the data file (`route_text`) but is not shown on the page.

Known limits: a route sheet "attached" to the application is not public, so those parades have no route. A description cut off mid-route in the city's record is drawn as far as it goes. Bump `TRACE_VERSION` in `scripts/lib/parades.js` whenever the tracer's output could change, so saved lines are redrawn.

## Fields

Each feature is a `LineString`, `MultiLineString` or `null` geometry in WGS84 with:

`id`, `name` (the city's label for the event), `krewe` (the organization) and `krewe_slug`, `category` (`mardi_gras`, `second_line`, `other`), `jurisdiction` (`orleans_parish`), `date`, `start_time`, `end_time`, `formation_time` (ISO 8601, America/Chicago), `source_url`, `source_layer`, `sources`, `field_sources`, `retrieved_at`, `last_modified`, `first_seen`, `area`, `formation`, `disband`, `num_floats`, the Routewise flags (`portolets`, `first_aid`, `lost_child`, `vendors`, `parking_restrictions`, `traffic_restrictions`, `gps_tracked`), and for permit parades `start_address`, `start_point`, `route_text`, `route_traced`, `route_notes`, `route_problem`, `permit_number`, `permit_status`, `permit_filed`.

A Carnival krewe is keyed by season (`muses-2026`), so a rescheduled parade replaces itself. Everything else is keyed by day (`nine-times-2026-11-22`). Parades the city stops serving stay in the file as last seen; a permit parade whose application is later denied, withdrawn or re-dated is removed.

Three files are kept by hand, and none holds dates, times or routes:

- `data/parades/krewes.json` gives an organization a display name and slug and lists the city's labels that belong to it ("Muses" is the Krewe of Muses). Names only.
- `data/parades/websites.json` maps an organization's slug to its own website, for the "Visit website" button on its page. It is a link out, not a source: nothing is read from those sites. Add an address only after confirming the site is the organization's own; leave an organization out when that can't be confirmed.

- `data/parades/photos.json` gives an organization up to three photos, best first, with the files in `public/images/parades/` (`<name>.jpg` at 1200px at most, plus `<name>-600.jpg`). Photos are pictures of past parades, not a source: no date, time or route is read from them. Each entry is `{ "file", "width", "height", "alt", "credit": { "author", "license", "licenseUrl", "source" (the photo's own page), "via"? } }`, and the build refuses a photo without its credit. Only freely licensed photos (CC BY, CC BY-SA, CC0, public domain) go in, and only when the photo's own page says which organization's parade it shows. Resize them, nothing more: cropping or editing a share-alike (`BY-SA`) photo makes the edited file share-alike too. The page crops with CSS only. The ones there now were chosen from Wikimedia Commons on 2026-11-13; organizations with nothing usable there have no entry.

On the site, an organization's photos sit beside its name, each with its credit, and scroll sideways when there is more than one. The directory card shows the first photo, or the route map when there is none. A parade's start is shown as its street only ("Higgins Blvd", not the house number or place name in the city's `start_address`), and a parade with no route line gets a zoomed-out map of the area around its `start_point` in place of a route map.

## Gaps and what would close them

- Ten Orleans Parish walking krewes and most Twelfth Night groups are in no city layer. Some file permits that fit the format; the rest would need the organizers' own announcements.
- About a third of written routes cannot be drawn with confidence, and six permit parades have no written route.
- Suburban parades need Jefferson, St. Bernard and St. Tammany sources. None has been checked.
- Whether next season's Carnival routes appear early enough to be useful will only be known in January.
