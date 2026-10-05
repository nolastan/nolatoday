import { fetchJSON } from '../scripts/lib/http.js';
import { now } from '../scripts/lib/time.js';

/**
 * Squarespace events, two flavours:
 *
 * 1. An Events collection page — appending ?format=json returns `upcoming`
 *    (or paginated `items`) with epoch-millisecond dates.
 *      { type: "squarespace", url: "https://example.com/events" }
 *
 * 2. A Calendar block on a regular page, backed by a collection id (find
 *    "collectionId" in the page source). Fetched month by month.
 *      { type: "squarespace", url: "https://example.com", collectionId: "6429e4a8…" }
 */
export default async function scrapeSquarespace(source, { window } = {}) {
  if (source.collectionId) return scrapeCalendarBlock(source, window);

  const items = [];
  let url = withJSON(source.url);
  for (let page = 0; url && page < 5; page++) {
    const data = await fetchJSON(url);
    const batch = data.upcoming ?? (data.items?.some((i) => i.startDate) ? data.items : null);
    if (!batch) {
      if (page === 0) throw new Error(`No events in Squarespace JSON (is ${source.url} an Events collection?)`);
      break;
    }
    items.push(...batch);
    // `upcoming` is complete; `items` paginates.
    url = !data.upcoming && data.pagination?.nextPage ? withJSON(new URL(data.pagination.nextPageUrl, source.url).toString()) : null;
  }
  const origin = new URL(source.url).origin;
  return items.map((item) => fromSquarespace(item, origin));
}

async function scrapeCalendarBlock(source, window) {
  const origin = new URL(source.url).origin;
  const start = (window?.from ?? now()).startOf('month');
  const items = [];
  for (let i = 0; i < 3; i++) {
    const month = start.plus({ months: i }).toFormat('MM-yyyy');
    const data = await fetchJSON(`${origin}/api/open/GetItemsByMonth?month=${month}&collectionId=${source.collectionId}`);
    if (!Array.isArray(data)) throw new Error('Unexpected GetItemsByMonth response');
    items.push(...data);
  }
  return items.map((item) => fromSquarespace({ ...item, ...item.structuredContent }, origin));
}

function withJSON(u) {
  const url = new URL(u);
  url.searchParams.set('format', 'json');
  return url.toString();
}

export function fromSquarespace(item, origin) {
  return {
    uid: item.id ?? item.systemDataId,
    title: item.title,
    start: item.startDate,
    end: item.endDate ?? null,
    url: item.fullUrl ? new URL(item.fullUrl, origin).toString() : undefined,
    description: item.excerpt,
    image: item.assetUrl,
  };
}
