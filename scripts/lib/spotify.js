/**
 * Artist photos and genres from Spotify, kept in data/artist-meta.json (generated; don't hand-edit).
 *
 * With SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET set, the Web API gives a large photo, a small one and
 * genres. Without them, Spotify's public oEmbed endpoint still gives the small photo, so the site never
 * depends on the keys. Photos are linked from Spotify's CDN, not copied into the repo.
 */
import path from 'node:path';
import { DATA_DIR, readJSON } from './data.js';
import { fetchJSON } from './http.js';

export const ARTIST_META_FILE = path.join(DATA_DIR, 'artist-meta.json');

/** { [slug]: { image, imageSmall?, genres? } } */
export const loadArtistMeta = () => readJSON(ARTIST_META_FILE, {});

const isImage = (url) => typeof url === 'string' && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//.test(url);

/** Photo and genres from a Web API artist object, or null when it has no photo. */
export function metaFromApi(artist) {
  const images = (artist?.images ?? []).filter((i) => isImage(i.url)).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  if (!images.length) return null;
  const meta = { image: images[0].url };
  // The smallest one that still fills a 2x thumbnail.
  const small = [...images].reverse().find((i) => (i.width ?? 0) >= 160);
  if (small && small.url !== meta.image) meta.imageSmall = small.url;
  const genres = (artist.genres ?? []).filter((g) => typeof g === 'string' && g).slice(0, 4);
  if (genres.length) meta.genres = genres;
  return meta;
}

/** Photo from an oEmbed answer, or null when it has none. */
export function metaFromOEmbed(embed) {
  // An artist with no photo gets an album cover here (image ids starting ab67616d); only take real artist photos.
  const url = embed?.thumbnail_url;
  return isImage(url) && /\/image\/ab676161/.test(url) ? { image: url } : null;
}

/** An app token for the Web API, or null when the keys aren't set. */
export async function spotifyToken(env = process.env) {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = env;
  if (!id || !secret) return null;
  const data = await fetchJSON('https://accounts.spotify.com/api/token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
  });
  return data.access_token ?? null;
}

/** Photo (and, with a token, genres) for one Spotify artist id. Null when Spotify has no photo. */
export async function fetchArtistMeta(spotifyId, token) {
  if (token) return metaFromApi(await fetchJSON(`https://api.spotify.com/v1/artists/${spotifyId}`, { headers: { authorization: `Bearer ${token}` } }));
  return metaFromOEmbed(await fetchJSON(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`)}`));
}
