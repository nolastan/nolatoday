import { fetchText } from '../scripts/lib/http.js';
import { extractJSONValue } from '../scripts/lib/extract.js';

/**
 * Wix sites using the Wix Events app embed their event list in the page's
 * warmup data as `"events":{"events":[…]}`.
 *
 * source: {
 *   type: "wix",
 *   url: "https://example.com/",                     // page that shows the events widget
 *   eventUrl?: "https://example.com/event-details/{slug}"
 * }
 */
export default async function scrapeWix(source) {
  const html = await fetchText(source.url);
  const events = parseWix(html, source);
  if (!events.length && !html.includes('wix-events')) throw new Error('No Wix Events widget found on page');
  return events;
}

export function parseWix(html, source = {}) {
  const seen = new Map();
  let from = 0;
  for (;;) {
    const idx = html.indexOf('"events":{"events":[', from);
    if (idx === -1) break;
    const wrapper = extractJSONValue(html, 'events', { from: idx });
    for (const e of wrapper?.events ?? []) if (e?.id && !seen.has(e.id)) seen.set(e.id, e);
    from = idx + 10;
  }
  const origin = source.url ? new URL(source.url).origin : '';
  const pattern = source.eventUrl ?? `${origin}/event-details/{slug}`;
  return [...seen.values()]
    .filter((e) => e.scheduling?.config?.startDate && !e.scheduling.config.scheduleTbd)
    .map((e) => ({
      uid: `wix-${e.id}`,
      title: e.title,
      start: e.scheduling.config.startDate,
      end: e.scheduling.config.endDateHidden ? null : e.scheduling.config.endDate ?? null,
      url: e.slug ? pattern.replace('{slug}', e.slug) : source.url,
      description: e.description || undefined,
    }));
}
