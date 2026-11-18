# Street events

Public festivals, markets, block parties and outdoor concerts on the home map come from the City of New Orleans' special event permit applications, the same feed second lines come from ([data.nola.gov `aib5-en5t`](https://data.nola.gov/d/aib5-en5t), rows with `type = 'Special Event - Master'`). Decided by Stan on 2026-11-18: filtered automatically, no review step.

```sh
node scripts/parades.js --dry   # pull parades and street events, print, write nothing
node scripts/parades.js         # also writes data/street-events.json
```

`scripts/parades.js` reads the feed once for both, and `.github/workflows/parades.yml` runs it twice a day. The filters are in `scripts/lib/street-events.js`; tests in `test/street-events.test.js`.

## What gets through

An application is shown only when all of these hold:

1. City staff wrote it up in their usual `Title - address - date` headline, followed by the organizer line ("… non-profit event not charging admission"). Organizers' own prose, vendors' notes and anything else is left out.
2. The title names a festival, fest, fête, market, bazaar, block party, concert or music event. Parades and second lines are left to the parade pipeline.
3. Nothing marks it as private or not something to go to: weddings, birthdays, staff and holiday parties, galas, luncheons, school and member events, races and walks, tailgates, and logistics (concession stands, a bar's or caterer's alcohol permit for someone else's festival, parking, reviewing stands, cell towers, banners).
4. The write-up doesn't say the public isn't invited ("not publicly accessible", "corporate client", "invitation only").
5. A business's party that charges nothing and sells nothing is treated as private (a convention group's block party on Fulton St, for example). Public events have vendors selling or a ticket price.
6. The status isn't denied, voided, withdrawn or a duplicate, and staff haven't flagged it as not processed or incomplete.
7. It has a point in New Orleans and runs a week or less.

A festival often files more than one application (the festival's own, a stage, a vendor's tent). Applications on overlapping days within 400 m that share a distinctive word in their names are merged into the earliest-filed one.

Measured on 2026-11-18 against the 3,871 applications filed in the previous 18 months: 165 qualified (161 after merging), about two a week, heavily seasonal (spring and October). Roughly 9 in 10 applications are not in the staff headline format at all; those are mostly parades, weddings and second lines.

## What is published

Only the title (the city's own, with staff notes, counters like "(8)" and the year taken off), the dates, the hours, the street, the city's point and the permit number and status. The description is never copied: it holds organizer names, attendance, vendor and alcohol details and the staff's checklist of missing paperwork. Rows that don't qualify are counted in the run's output, never named.

Hours come from the first clock range in the write-up ("1 pm - 7 pm", "7 - 9 pm"). Ranges that look like street-closure hours (starting before 7 AM, running past 14 hours or to 11:59 PM) are dropped, and the event is shown for the day without a time. About half the events have no hours.

`data/street-events.json` is rewritten on every pull, so an application that is later denied or withdrawn disappears. Only events not yet over are kept.

## On the map

The build (`scripts/build.js`) puts the next eight days of street events in `events.json` as `street`, one item per day. Each gets a green marker and a card with the title, the kind of event and its street. One within 60 m of a venue that has shows that day is listed on the venue's card instead.

## Limits

- These are applications, not approvals. Most upcoming ones are still under review until a week or two before the date, and some never happen. The site footer says so.
- Median lead time is about 25 days, so the next week is well covered and next month thinly.
- Resident block parties often come without the organizer line and are left out; so are school fairs.
- No license is stated on the dataset (see [docs/parades.md](parades.md#sources)).
