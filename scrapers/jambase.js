import { fetchJSON } from '../scripts/lib/http.js';

/**
 * Venues listed on JamBase, via the JamBase Data API (v3). Needs the
 * JAMBASE_API_KEY environment variable (an Actions secret in CI).
 *
 * The free Developer plan allows 1,000 calls a month and bills overage, so
 * every jambase venue in a run shares one request (venueId=a|b, plus a page
 * per extra 100 events), nothing is retried, and the run is skipped when the
 * monthly quota runs low. Find a venue's id with
 *   node scripts/jambase-venues.js <name>
 *
 * source: { type: "jambase", venueId: "jambase:12345", url: "https://www.jambase.com/venue/…" }
 * `url` is only shown on the venue page, as the schedule source (attribution
 * is a condition of the API plan).
 */
const API = 'https://api.data.jambase.com/v3';

// Stop calling once fewer than this many calls are left in the month. A normal
// month uses about 250 (two pages per 6-hourly run, plus PR CI).
export const QUOTA_RESERVE = 100;
const PER_PAGE = 100;
const MAX_PAGES = 4;

export async function jambaseAPI(path, params = {}) {
  const key = process.env.JAMBASE_API_KEY;
  if (!key) throw new Error('JAMBASE_API_KEY is not set; the jambase adapter needs a JamBase Data API key');
  const query = new URLSearchParams(params).toString();
  const url = `${API}/${path}${query ? `?${query}` : ''}`;
  try {
    // No retries: every successful call counts against the quota, and a retry
    // after a timeout can be one the server already counted.
    return await fetchJSON(url, { retries: 0, headers: { authorization: `Bearer ${key}` } });
  } catch (err) {
    // Errors end up in status.json and public repair issues; never leak the key.
    throw new Error(String(err?.message ?? err).replaceAll(key, '***'));
  }
}

/** Why the run should be skipped, given a GET /v3/quota response, or null if there's room. */
export function quotaProblem(quota) {
  if (quota.noMonthlyCap || quota.limitType === 'unlimited') return null;
  const until = quota.periodEnd ? ` until ${String(quota.periodEnd).slice(0, 10)}` : '';
  if (quota.overageCalls > 0) return `${quota.overageCalls} calls over the monthly quota${until}`;
  if (typeof quota.remainingCalls !== 'number') return 'the API did not report how many calls are left';
  if (quota.remainingCalls < QUOTA_RESERVE) return `${quota.remainingCalls} of ${quota.quota} calls left${until}`;
  return null;
}

const venueKey = (id) => (/^\d+$/.test(String(id)) ? `jambase:${id}` : String(id));

// One batch per scrape run (keyed on the run's venue list) and set of venue ids.
const batches = new WeakMap();

async function loadBatch(ids, window) {
  const quota = await jambaseAPI('quota'); // not metered
  const problem = quotaProblem(quota);
  if (problem) throw new Error(`JamBase API quota is low (${problem}); skipped this run to avoid overage charges`);

  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    // eventDateFrom defaults to today; a past date would need historical access.
    const data = await jambaseAPI('events', {
      venueId: ids.join('|'),
      ...(window && { eventDateTo: window.to.toISODate() }),
      perPage: PER_PAGE,
      page,
      excludeEventPerformers: true,
    });
    events.push(...(data.events ?? []));
    if (page >= (data.pagination?.totalPages ?? 1)) break;
  }
  return events;
}

function batchFor(venueId, { window, venues } = {}) {
  const run = venues ?? [];
  const ids = new Set([venueId]);
  for (const v of run) for (const s of v.sources ?? []) if (s.type === 'jambase' && s.venueId) ids.add(venueKey(s.venueId));
  const key = [...ids].sort().join('|');
  if (!batches.has(run)) batches.set(run, new Map());
  const cache = batches.get(run);
  if (!cache.has(key)) cache.set(key, loadBatch([...ids].sort(), window));
  return cache.get(key);
}

export default async function scrapeJamBase(source, ctx = {}) {
  if (!source.venueId) throw new Error('jambase source needs a "venueId" ("jambase:<id>")');
  const venueId = venueKey(source.venueId);
  return parseJamBase(await batchFor(venueId, ctx), venueId);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Events at venueId from a /v3/events response's `events`. */
export function parseJamBase(events, venueId) {
  return events
    .filter((e) => e.location?.identifier === venueId)
    // Postponed shows have no confirmed date; tombstones only come with dateModifiedFrom, but be safe.
    .filter((e) => !e.deletionStatus && e.eventStatus !== 'cancelled' && e.eventStatus !== 'postponed')
    .map((e) => {
      if (!e.startDate) return null;
      // Names read "<Artist> at <Venue>".
      const venueName = e.location?.name;
      let title = e['x-customTitle'] || e.name || '';
      if (venueName) title = title.replace(new RegExp(`\\s+at\\s+${escapeRegExp(venueName)}$`, 'i'), '');
      // startDate is New Orleans time, with or without an offset.
      return { uid: `jambase-${e.identifier}`, title, start: e.startDate, url: e.url };
    })
    .filter(Boolean);
}
