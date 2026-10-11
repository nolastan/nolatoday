import { DateTime } from 'luxon';
import { isUnmeteredQuotaOutage } from './jambase-quota.js';

export { isUnmeteredQuotaOutage };

export const LABEL = 'scraper';
export const KIND_LABELS = {
  broken: 'scraper: broken',
  empty: 'scraper: no events',
  'needs-source': 'scraper: needs source',
};

// How long a problem must persist before we open an issue for it.
export const THRESHOLDS = {
  failuresBeforeIssue: 2, // consecutive failed runs (~12h at the default schedule)
  emptyDays: 14, // no events for this long, though the scraper "works"
  newVenueGraceDays: 3, // a brand-new source gets this long to produce events
};

export function marker(slug, kind) {
  return `<!-- nolatoday:scraper venue=${slug} kind=${kind} -->`;
}

export function parseMarker(body) {
  const m = /<!-- nolatoday:scraper venue=([a-z0-9-]+) kind=([a-z-]+) -->/.exec(body ?? '');
  return m ? { slug: m[1], kind: m[2] } : null;
}

/**
 * Decide which active venues need attention.
 * Returns [{ slug, kind: 'broken' | 'empty' | 'needs-source', venue, entry }].
 */
export function diagnose(venues, status, now = DateTime.now()) {
  const problems = [];
  for (const venue of venues) {
    if (venue.status !== 'active') continue;
    const entry = status.venues?.[venue.slug];
    if (!venue.sources?.length) {
      problems.push({ slug: venue.slug, kind: 'needs-source', venue, entry });
      continue;
    }
    if (!entry) continue; // never scraped yet
    if (!entry.ok && (entry.consecutiveFailures ?? 0) >= THRESHOLDS.failuresBeforeIssue) {
      // The quota probe is not a venue schedule. Keep the failure in status,
      // and do not ask for a replacement source.
      if (isUnmeteredQuotaOutage(entry)) continue;
      problems.push({ slug: venue.slug, kind: 'broken', venue, entry });
      continue;
    }
    if (entry.ok && entry.count === 0) {
      const since = entry.lastNonEmpty ?? entry.firstSeen;
      const grace = entry.lastNonEmpty ? THRESHOLDS.emptyDays : THRESHOLDS.newVenueGraceDays;
      if (since && now.diff(DateTime.fromISO(since), 'days').days >= grace) {
        problems.push({ slug: venue.slug, kind: 'empty', venue, entry });
      }
    }
  }
  return problems;
}

/**
 * What to do with an already-open repair issue.
 * `hold` keeps a broken issue open without calling the failure recovered.
 */
export function issueDisposition({ wanted, key, entry, venueActive }) {
  if (wanted.has(key)) return 'keep';
  const kind = String(key ?? '').split('|')[1];
  if (kind === 'broken' && venueActive && isUnmeteredQuotaOutage(entry)) return 'hold';
  return 'close';
}

export function closeReason({ venue, entry }) {
  if (!venue) return 'the venue was removed from `data/venues/`';
  if (venue.status !== 'active') return `the venue is now marked \`${venue.status}\``;
  return `the latest run found ${entry?.count ?? 0} upcoming events`;
}

export function quotaProbeHoldTitle(venue) {
  return `JamBase quota probe failed: ${venue.name}`;
}

export function quotaProbeHoldBody({ slug, venue, entry }, { repo } = {}) {
  const file = `data/venues/${slug}.json`;
  const lines = [
    marker(slug, 'broken'),
    '',
    `The JamBase source for **${venue.name}** is unchanged. The latest failure is the unmetered quota probe, not a missing schedule.`,
    '',
    '**Error**',
    '```',
    entry?.error ?? 'unknown',
    '```',
    '',
    `Last successful run: ${entry?.lastSuccess ?? 'never'}`,
    '',
    '**Venue**',
    `- Data file: [\`${file}\`](${repo ? `https://github.com/${repo}/blob/main/${file}` : file})`,
    `- Address: ${venue.address}`,
    `- Website: ${venue.website ?? '_unknown_'}`,
    '',
    'Do not replace this source while that probe error is the only failure. An HTTP 401, 403, or 404, a low remaining-calls skip, or a failure of `/v3/events` is a different repair.',
    '',
    'This issue stays open until a later run records a successful scrape.',
  ];
  return lines.join('\n');
}

export function issueTitle({ venue, kind }) {
  switch (kind) {
    case 'broken':
      return `Scraper broken: ${venue.name}`;
    case 'empty':
      return `Scraper finds no events: ${venue.name}`;
    default:
      return `Find a schedule source: ${venue.name}`;
  }
}

export function issueBody({ slug, kind, venue, entry }, { repo } = {}) {
  const file = `data/venues/${slug}.json`;
  const lines = [marker(slug, kind), ''];
  if (kind === 'broken') {
    lines.push(
      `The scraper for **${venue.name}** has failed ${entry.consecutiveFailures} runs in a row.`,
      '',
      '**Error**',
      '```',
      entry.error ?? 'unknown',
      '```',
      '',
      `Last successful run: ${entry.lastSuccess ?? 'never'}`,
    );
  } else if (kind === 'empty') {
    lines.push(
      `The scraper for **${venue.name}** runs without errors but hasn't found any upcoming events ` +
        `since ${entry.lastNonEmpty ?? entry.firstSeen}. The site may have moved its calendar, changed its markup, ` +
        `or the venue may have closed.`,
    );
  } else {
    lines.push(
      `**${venue.name}** is an active venue on the site but has no schedule source configured, ` +
        `so its page never shows upcoming shows.`,
    );
  }
  lines.push(
    '',
    '**Venue**',
    `- Data file: [\`${file}\`](${repo ? `https://github.com/${repo}/blob/main/${file}` : file})`,
    `- Address: ${venue.address}`,
    `- Website: ${venue.website ?? '_unknown_'}`,
  );
  if (venue.sources?.length) {
    lines.push('', '**Current sources**', '```json', JSON.stringify(venue.sources, null, 2), '```');
  }
  lines.push(
    '',
    `**How to fix** (see [\`CONTRIBUTING.md\`](${repo ? `https://github.com/${repo}/blob/main/` : ''}CONTRIBUTING.md#fixing-a-scraper))`,
    '1. Find where the venue publishes its schedule (website calendar, Squarespace/Wix/WordPress events, TicketWeb, Eventbrite, DICE, Tixr, a Google Calendar .ics, …).',
    '2. Prefer an existing adapter in `scrapers/` (`ics`, `tribe`, `squarespace`, `jsonld`, `eventbrite`, `spothopper`, `wix`, `gigulator`, `html`). Only write `scrapers/custom/<name>.js` if none fits.',
    `3. Test it: \`node scripts/scrape.js --venue ${slug} --dry\` (or \`--try '<source json>'\`).`,
    '4. Add a fixture-based test in `test/` for any new adapter or custom scraper.',
    '5. If the venue has permanently closed, set `"status": "closed"` and add a short `"note"` instead.',
    '',
    'This issue was opened automatically by the scrape workflow and will close itself once the scraper produces events again.',
  );
  return lines.join('\n');
}
