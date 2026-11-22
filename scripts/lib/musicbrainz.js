/**
 * Reading MusicBrainz answers: which artist (if any) a name surely is, and that artist's own links.
 * Pure functions; scripts/artists.js does the fetching.
 */
import { nameKey, tipFromUrl } from './artists.js';

// Where an act has to be from for a bare name match to count. Touring acts come through ticketing data instead.
const LOUISIANA = new Set(
  ['New Orleans', 'Louisiana', 'Baton Rouge', 'Lafayette', 'Metairie', 'Kenner', 'Gretna', 'Marrero', 'Slidell', 'Houma', 'Thibodaux', 'Algiers', 'Tremé', 'Treme', 'Orleans Parish', 'Jefferson Parish'].map((s) =>
    s.toLowerCase(),
  ),
);
const TYPES = new Set(['Person', 'Group', 'Orchestra', 'Choir']);

const fromLouisiana = (a) => [a.area?.name, a['begin-area']?.name].some((n) => n && LOUISIANA.has(n.toLowerCase()));

/**
 * The one artist in a MusicBrainz search answer that `name` surely is, or null.
 * Sure means: the name is the same, the artist is from Louisiana, and no other Louisiana artist shares it.
 * `person` also asks that the artist is a person, for a bandleader's name taken out of a band's.
 */
export function pickArtist(name, search, { person = false } = {}) {
  const key = nameKey(name);
  const same = (search?.artists ?? []).filter((a) => nameKey(a.name ?? '') === key && (person ? a.type === 'Person' : TYPES.has(a.type)) && fromLouisiana(a));
  return same.length === 1 ? same[0] : null;
}

const https = (url) => url.replace(/^http:\/\//, 'https://');

/**
 * { spotify, links, tips? } from a MusicBrainz artist looked up with inc=url-rels. Ended links are skipped.
 * Tip jars are Venmo, Cash App and PayPal links on the artist, credited to its MusicBrainz page.
 */
export function linksFrom(artist) {
  const out = { links: {} };
  const tips = [];
  for (const rel of artist?.relations ?? []) {
    const url = rel.url?.resource;
    if (!url || rel.ended) continue;
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    const set = (key) => {
      if (!out.links[key]) out.links[key] = https(url);
    };
    const tip = tipFromUrl(url);
    if (tip) {
      if (!tips.some((t) => t.service === tip.service)) tips.push({ ...tip, source: `https://musicbrainz.org/artist/${artist.id}` });
      continue;
    }
    const spotify = host === 'open.spotify.com' && /^\/artist\/([A-Za-z0-9]{22})\/?$/.exec(new URL(url).pathname);
    if (spotify) out.spotify ??= spotify[1];
    else if (host === 'music.apple.com' && /\/artist\//.test(url)) set('appleMusic');
    else if (host.endsWith('.bandcamp.com') && rel.type === 'bandcamp') set('bandcamp');
    else if (rel.type === 'youtube') set('youtube');
    else if (rel.type === 'soundcloud') set('soundcloud');
    else if (host === 'instagram.com') set('instagram');
    else if (rel.type === 'official homepage') set('website');
  }
  if (tips.length) out.tips = tips;
  return out;
}
