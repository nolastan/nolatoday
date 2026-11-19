/**
 * Public JSON for apps (the iOS app first): the data behind the venue, food and parade pages, so an
 * app never has to read HTML. Field names are spelled out, unlike the compact map data in events.json.
 * Keep these stable: add fields, don't rename or remove them.
 */
import { broadGenres, specificGenres } from './genres.js';
import { displayName, startStreet } from './parades.js';

const drop = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

/** A show on a venue's schedule or recent shows. `artists` are [slug, start, end] UTF-16 ranges in the title. */
export function showItem(e) {
  return drop({
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay ? true : undefined,
    url: e.url,
    artists: e.artists?.length ? e.artists.map((m) => [m.slug, m.start, m.end]) : undefined,
  });
}

/** A food stop. `unconfirmed` is true when the vendor hasn't confirmed it in the last 30 days. */
function stopItem(e) {
  return drop({
    start: e.start,
    end: e.end,
    allDay: e.allDay ? true : undefined,
    price: e.price,
    note: e.note,
    url: e.url,
    confirmedOn: e.confirmedOn,
    unconfirmed: e.stale ? true : undefined,
  });
}

/** /venues/<slug>.json: everything on a venue page. */
export function venueFeed(venue, { siteUrl, image, imageLarge, events = [], recent = [], food = [], status, generatedAt }) {
  return drop({
    generatedAt,
    slug: venue.slug,
    name: venue.name,
    status: venue.status,
    note: venue.note,
    address: venue.address,
    lat: venue.lat,
    lng: venue.lng,
    website: venue.website,
    url: `${siteUrl}/venues/${venue.slug}`,
    image,
    imageLarge,
    imageCredit: venue.imageCredit,
    sources: [...new Set((venue.sources ?? []).map((s) => s.url).filter(Boolean))],
    updated: status?.lastSuccess,
    events: events.map(showItem),
    recent: recent.map((e) => drop({ title: e.title, start: e.start, artists: e.artists?.length ? e.artists.map((m) => [m.slug, m.start, m.end]) : undefined })),
    food: food.map((e) => ({ vendor: e.vendor, vendorName: e.vendorName, icon: e.icon, ...stopItem(e) })),
  });
}

/** /food.json: every vendor with its upcoming stops, the places they're at, and their icons. */
export function foodFeed(vendors, { siteUrl, today, icons, generatedAt }) {
  const places = {};
  const used = new Set();
  const out = vendors.map((vendor) => {
    const icon = icons[vendor.icon] ? vendor.icon : 'default';
    used.add(icon);
    const stops = vendor.events
      .filter((e) => (e.end ?? e.start) >= today)
      .map((e) => {
        const p = e.place;
        places[p.key] ??= drop({ name: p.name, address: p.address, lat: p.lat, lng: p.lng, venue: p.venue, far: p.approximate ? true : undefined });
        return { place: p.key, ...stopItem(e) };
      });
    return {
      ...drop({
        slug: vendor.slug,
        name: vendor.name,
        type: vendor.type ?? 'Pop-up',
        icon,
        description: vendor.description,
        website: vendor.website,
        instagram: vendor.from && /instagram\.com/.test(vendor.from) ? vendor.from : undefined,
        url: `${siteUrl}/food/${vendor.slug}`,
      }),
      stops,
    };
  });
  return { generatedAt, places, icons: Object.fromEntries([...used].sort().map((k) => [k, icons[k]])), vendors: out };
}

/** A parade in parades.json: when and where it starts. The route is in parades.geojson and events.json. */
function paradeItem(f) {
  const p = f.properties;
  return drop({
    id: p.id,
    name: displayName(p),
    category: p.category,
    date: p.date,
    start: p.start_time,
    end: p.end_time,
    street: startStreet(p.start_address) ?? undefined,
    point: p.start_point ?? undefined,
    route: f.geometry ? true : undefined,
  });
}

/** /parades.json: every krewe and club with its photos, website, upcoming and recent parades. */
export function paradesFeed(orgs, { siteUrl, photoUrl, maxRecent = 10, generatedAt }) {
  return {
    generatedAt,
    organizations: orgs.map((org) => ({
      ...drop({
        slug: org.slug,
        name: org.name,
        category: org.category,
        url: `${siteUrl}/parades/${org.slug}`,
        website: org.website,
      }),
      photos: (org.photos ?? []).map((photo) =>
        drop({
          image: photoUrl(photo.file.replace(/\.jpg$/, '-600.jpg')),
          imageLarge: photoUrl(photo.file),
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          credit: drop({ ...photo.credit }),
        }),
      ),
      upcoming: org.upcoming.map(paradeItem),
      recent: org.past.slice(0, maxRecent).map(paradeItem),
    })),
  };
}

/** An artist's broad genre slugs (see GENRES), as the artists directory filters them. */
export const artistBroadGenres = (artist, meta) => broadGenres(artist, specificGenres(meta));
