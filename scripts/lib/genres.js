/**
 * The handful of broad genres the artists directory filters by, read from an artist's specific genres
 * (Spotify's and MusicBrainz's, e.g. "new orleans jazz", "jazz piano") and from words in the name
 * that leave no doubt ("Rebirth Brass Band"). An artist can be in more than one.
 */

// Order is the order the filter shows them in.
export const GENRES = [
  { slug: 'jazz', label: 'Jazz', match: /jazz|dixieland|swing|bebop|ragtime|\bbop\b/ },
  { slug: 'traditional-jazz', label: 'Traditional jazz', match: /dixieland|new orleans jazz|trad(itional)? jazz|early jazz|hot jazz|\bswing\b|ragtime|stride|big band/ },
  {
    slug: 'modern-jazz',
    label: 'Modern jazz',
    match: /contemporary jazz|modern jazz|jazz fusion|jazz[- ]funk|jazz rock|bebop|\bbop\b|post-bop|hard bop|jazz piano|jazz trio|free jazz|avant-garde jazz|soul jazz|latin jazz|smooth jazz|nu jazz|spiritual jazz|cool jazz/,
  },
  { slug: 'brass-band', label: 'Brass band', match: /brass band|second line/ },
  { slug: 'funk-soul', label: 'Funk & soul', match: /funk|\bsoul\b|motown/ },
  { slug: 'blues', label: 'Blues & R&B', match: /blues|r&b|rhythm and blues/ },
  { slug: 'rock', label: 'Rock', match: /(?<!jazz[- ])rock|punk|indie|metal|grunge|garage/ },
  { slug: 'cajun-zydeco', label: 'Cajun & zydeco', match: /cajun|zydeco|swamp pop/ },
  { slug: 'folk-country', label: 'Folk & country', match: /folk|country|americana|bluegrass|singer-songwriter/ },
  { slug: 'gospel', label: 'Gospel', match: /gospel|christian|spiritual(?! jazz)/ },
  { slug: 'hip-hop', label: 'Hip hop', match: /hip hop|\brap\b|bounce/ },
  { slug: 'latin', label: 'Latin', match: /latin|salsa|cumbia|brazil|bossa|afro-cuban|samba/ },
  { slug: 'pop', label: 'Pop', match: /\bpop\b(?! punk)/ },
];

// Words in a band's own name that say what it plays.
const NAME_WORDS = [
  [/\bbrass band\b/, ['jazz', 'brass-band']],
  [/\bjazz\b/, ['jazz']],
  [/\bzydeco\b/, ['cajun-zydeco']],
  [/\bfunky?\b/, ['funk-soul']],
  [/\bblues\b/, ['blues']],
];

/** Broad genre slugs for an artist, in GENRES order. `specific` is their genre list from data/artist-meta.json. */
export function broadGenres(artist, specific = []) {
  const found = new Set();
  for (const g of specific.map((s) => s.toLowerCase())) for (const b of GENRES) if (b.match.test(g)) found.add(b.slug);
  const name = artist.name.toLowerCase();
  for (const [re, slugs] of NAME_WORDS) if (re.test(name)) slugs.forEach((s) => found.add(s));
  return GENRES.filter((b) => found.has(b.slug)).map((b) => b.slug);
}

/** The genre names a MusicBrainz artist (looked up with inc=genres) is most often given, best first. */
export function genresFromMusicBrainz(artist, max = 4) {
  return (artist?.genres ?? [])
    .filter((g) => typeof g.name === 'string' && g.name && (g.count ?? 0) > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((g) => g.name);
}

/** An artist's specific genres from data/artist-meta.json, Spotify's first, without repeats. */
export function specificGenres(meta, max = 5) {
  const seen = new Set();
  return [...(meta?.spotifyGenres ?? []), ...(meta?.musicbrainzGenres ?? [])]
    .filter((g) => {
      const key = g.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, max);
}

/** Broad genre slugs worth showing: "Jazz" goes when "Traditional jazz" or "Modern jazz" already says it. */
export const shownGenres = (slugs) => (slugs.some((g) => g.endsWith('-jazz')) ? slugs.filter((g) => g !== 'jazz') : slugs);

/** A broad genre's name, by slug. */
export const genreLabel = (slug) => GENRES.find((g) => g.slug === slug)?.label ?? slug;
