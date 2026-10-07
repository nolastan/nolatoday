import ics from './ics.js';
import tribe from './tribe.js';
import squarespace from './squarespace.js';
import jsonld from './jsonld.js';
import eventbrite from './eventbrite.js';
import spothopper from './spothopper.js';
import wix from './wix.js';
import html from './html.js';
import gigulator from './gigulator.js';
import ticketmaster from './ticketmaster.js';

/**
 * Generic adapters, selected by a source's "type". Venue-specific scrapers
 * live in ./custom/<name>.js and are selected with { type: "custom", name }.
 */
export const adapters = { ics, tribe, squarespace, jsonld, eventbrite, spothopper, wix, html, gigulator, ticketmaster };

export async function runSource(source, ctx) {
  if (source.type === 'custom') {
    const mod = await import(`./custom/${source.name}.js`);
    return mod.default(source, ctx);
  }
  const adapter = adapters[source.type];
  if (!adapter) throw new Error(`Unknown source type "${source.type}"`);
  return adapter(source, ctx);
}
