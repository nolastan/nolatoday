/**
 * Artists: hand-kept (or script-created) files in data/artists/, linked to scraped event titles when the
 * site builds. Events on disk never name an artist; the match is redone on every build, so a new artist
 * file or alias applies to every event at once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readJSON } from './data.js';

export const ARTISTS_DIR = path.join(DATA_DIR, 'artists');

/** Platform links an artist file may carry, in the order the page shows them. */
export const LINKS = {
  appleMusic: 'Apple Music',
  bandcamp: 'Bandcamp',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  website: 'Website',
};

/** Tip jar services an artist file may list under `tips`, with the link hosts each may use. */
export const TIPS = {
  venmo: { label: 'Venmo', hosts: ['venmo.com', 'account.venmo.com'] },
  cashApp: { label: 'Cash App', hosts: ['cash.app'] },
  paypal: { label: 'PayPal', hosts: ['paypal.me', 'paypal.com'] },
};

/**
 * A tip jar from a payment link, or null: { service, handle, url }.
 * Knows venmo.com/u/<name>, cash.app/$<name>, paypal.me/<name> and paypal.com/paypalme/<name>.
 */
export function tipFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  let m;
  if ((host === 'venmo.com' || host === 'account.venmo.com') && (m = /^\/u\/([A-Za-z0-9_-]+)$/.exec(path))) {
    return { service: 'venmo', handle: `@${m[1]}`, url: `https://venmo.com/u/${m[1]}` };
  }
  if (host === 'cash.app' && (m = /^\/\$([A-Za-z0-9_-]+)$/.exec(path))) return { service: 'cashApp', handle: `$${m[1]}`, url: `https://cash.app/$${m[1]}` };
  if ((host === 'paypal.me' && (m = /^\/([A-Za-z0-9_-]+)$/.exec(path))) || (host === 'paypal.com' && (m = /^\/paypalme\/([A-Za-z0-9_-]+)$/.exec(path)))) {
    return { service: 'paypal', handle: m[1], url: `https://paypal.me/${m[1]}` };
  }
  return null;
}

/** All artists from data/artists/*.json, sorted by name. */
export function loadArtists(dir = ARTISTS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const artist = readJSON(path.join(dir, f));
      const slug = f.replace(/\.json$/, '');
      if (artist.slug !== slug) throw new Error(`data/artists/${f}: slug "${artist.slug}" doesn't match filename`);
      return artist;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const fold = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Words of a title with where each sits in the original text. "&" and "+" read as "and", apostrophes
 * vanish ("Lou’s" → "lous"), accents and case are dropped, and all other punctuation separates words.
 */
export function tokenize(text) {
  const tokens = [];
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[&+]/gu;
  for (const m of text.matchAll(re)) {
    const word = m[0] === '&' || m[0] === '+' ? 'and' : fold(m[0].replace(/['’]/g, ''));
    tokens.push({ word, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** The words a name is compared by: tokenized, without a leading "the". */
export function nameWords(name) {
  const words = tokenize(name).map((t) => t.word);
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words;
}

/** One string per name; two names with the same key count as the same name. */
export const nameKey = (name) => nameWords(name).join(' ');

/** A URL slug for a name, without a leading "the": "The Soul Rebels" → "soul-rebels". */
export const slugify = (name) => nameWords(name).join('-');

// A name after one of these is the subject of the show, not who is playing: "A Tribute to Dr. John".
const NOT_PERFORMING = [
  ['tribute', 'to'],
  ['tribute', 'to', 'the'],
  ['tributes', 'to'],
  ['salute', 'to'],
  ['music', 'of'],
  ['songs', 'of'],
  ['celebrating'],
  ['celebration', 'of'],
  ['remembering'],
  ['honoring'],
  ['plays'],
  ['play'],
  ['playing'],
  ['sings'],
  ['performs'],
  ['vs'],
  ['night', 'of'],
  ['legacy', 'of'],
  ['benefit', 'for'],
  ['birthday', 'bash', 'for'],
  ['memorial', 'for'],
  ['second', 'line', 'for'],
];

function follows(tokens, i, phrase) {
  if (i < phrase.length) return false;
  return phrase.every((w, k) => tokens[i - phrase.length + k].word === w);
}

/**
 * A matcher over a set of artists. `match(title)` returns the artists named in the title as
 * [{ slug, start, end }], character ranges in the title, in reading order and never overlapping.
 *
 * A name matches only as a whole run of words, the longest name first, so "Kermit Ruffins & the BBQ
 * Swingers" wins over "Kermit Ruffins" and "Redline" never matches inside "Redliner".
 */
export function buildMatcher(artists) {
  // First word → [{ words, slug }], longest names first.
  const byFirst = new Map();
  for (const a of artists) {
    for (const name of [a.name, ...(a.aliases ?? [])]) {
      const words = nameWords(name);
      if (!words.length) continue;
      if (!byFirst.has(words[0])) byFirst.set(words[0], []);
      byFirst.get(words[0]).push({ words, slug: a.slug });
    }
  }
  for (const list of byFirst.values()) list.sort((x, y) => y.words.length - x.words.length);

  return {
    match(title) {
      const tokens = tokenize(title ?? '');
      const found = [];
      for (let i = 0; i < tokens.length; ) {
        const hit = (byFirst.get(tokens[i].word) ?? []).find(
          (c) => i + c.words.length <= tokens.length && c.words.every((w, k) => tokens[i + k].word === w),
        );
        // Step back over a "the" the name was stored without, so the link covers "The Soul Rebels".
        const first = hit && i > 0 && tokens[i - 1].word === 'the' && !found.some((f) => f.end > tokens[i - 1].start) ? i - 1 : i;
        if (!hit || NOT_PERFORMING.some((p) => follows(tokens, first, p))) {
          i++;
          continue;
        }
        found.push({ slug: hit.slug, start: tokens[first].start, end: tokens[i + hit.words.length - 1].end });
        i += hit.words.length;
      }
      return found;
    },
  };
}

// Titles that are a kind of night, not an act. Kept broad: a skipped artist costs less than a wrong page.
const NOT_AN_ACT =
  /\b(karaoke|open mic|trivia|bingo|burlesque|comedy|comedian|stand-?up|improv|drag|brunch|happy hour|dj|d\.j\.|dance (party|lessons?|night|class)|lessons?|class|workshop|camp|tour|festival|fest|market|private|closed|tba|tbd|screening|movie|film|watch party|game|saints|pelicans|lsu|poetry|spoken word|open jam|jam session|showcase|night|party|presents?|presented|tribute|celebration|anniversary|birthday|new year|nye|halloween|thanksgiving|christmas|holiday|mardi gras|recording|release|residency|the musical|nutcracker|ballet|opera|symphony|vs\.?|feat\.?|featuring|with|w\/)\b/i;

/**
 * The act a whole title names, or null. Deliberately strict: only a title that is nothing but one name
 * counts ("Charmaine Neville Band"), so billed pairs, decorated titles and theme nights are skipped.
 */
export function candidateName(title) {
  const t = (title ?? '').trim();
  if (!t || t.length > 60) return null;
  if (/[,:;|/()[\]!?@#*]|\s[-–—]\s|\d{4}/.test(t)) return null;
  if (/\s(&|\+|and)\s/i.test(t) && !/\s(&|and)\s+(the|his|her|their|friends)\b/i.test(t)) return null;
  if (NOT_AN_ACT.test(t)) return null;
  const words = nameWords(t);
  if (!words.length || words.length > 7) return null;
  if (words.join('').length < 4) return null;
  return t;
}

/** The bandleader in a billed name: "Kermit Ruffins & the BBQ Swingers" and "Kermit Ruffins Band" → "Kermit Ruffins". */
export function leadName(name) {
  return name
    .replace(/\s+(&|and)\s+(the|his|her|their|friends)\b.*$/i, '')
    .replace(/\s+(band|trio|quartet|quintet|sextet|duo|group|combo|experience)$/i, '')
    .trim();
}

/**
 * Whole-title names no artist file covers yet, most shows first: [{ name, count, venues }].
 * `titles` is [{ title, venue }], one per upcoming event.
 */
export function candidates(titles, artists) {
  const matcher = buildMatcher(artists);
  const byKey = new Map();
  for (const { title, venue } of titles) {
    const name = candidateName(title);
    if (!name || matcher.match(name).length) continue;
    const key = nameKey(name);
    if (!byKey.has(key)) byKey.set(key, { name, count: 0, venues: new Set() });
    const c = byKey.get(key);
    c.count++;
    c.venues.add(venue);
  }
  return [...byKey.values()]
    .map((c) => ({ ...c, venues: [...c.venues].sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED_KEYS = new Set(['slug', 'name', 'aliases', 'spotify', 'musicbrainz', 'links', 'tips', 'note']);

/** Problems with the artist files, as [{ slug, message }]. */
export function checkArtists(artists) {
  const problems = [];
  const err = (slug, message) => problems.push({ slug, message });
  const claimed = new Map();
  const spotify = new Map();
  for (const a of artists) {
    for (const key of Object.keys(a)) if (!ALLOWED_KEYS.has(key)) err(a.slug, `unknown field "${key}"`);
    if (!SLUG.test(a.slug ?? '')) err(a.slug, 'slug must be lowercase-kebab-case');
    if (typeof a.name !== 'string' || !a.name.trim()) err(a.slug, 'missing name');
    if (a.aliases != null && (!Array.isArray(a.aliases) || a.aliases.some((x) => typeof x !== 'string' || !x.trim()))) {
      err(a.slug, 'aliases must be an array of names');
    }
    for (const name of [a.name, ...(Array.isArray(a.aliases) ? a.aliases : [])]) {
      if (typeof name !== 'string') continue;
      const key = nameKey(name);
      if (key.replace(/ /g, '').length < 3) err(a.slug, `"${name}" is too short to match safely`);
      const other = claimed.get(key);
      if (other && other !== a.slug) err(a.slug, `"${name}" is also a name of ${other}`);
      claimed.set(key, a.slug);
    }
    if (a.spotify != null) {
      if (!/^[A-Za-z0-9]{22}$/.test(a.spotify)) err(a.slug, 'spotify must be the 22-character artist id');
      else if (spotify.has(a.spotify)) err(a.slug, `spotify id is also on ${spotify.get(a.spotify)}`);
      else spotify.set(a.spotify, a.slug);
    }
    if (a.musicbrainz != null && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(a.musicbrainz)) err(a.slug, 'musicbrainz must be the artist MBID');
    if (a.links != null && (typeof a.links !== 'object' || Array.isArray(a.links))) err(a.slug, 'links must be an object');
    for (const [key, value] of Object.entries(a.links ?? {})) {
      if (!(key in LINKS)) err(a.slug, `unknown link "${key}" (use ${Object.keys(LINKS).join(', ')})`);
      if (!/^https:\/\//.test(value ?? '')) err(a.slug, `links.${key} must be an https URL`);
    }
    if (a.tips != null && !Array.isArray(a.tips)) err(a.slug, 'tips must be an array');
    for (const [i, tip] of (Array.isArray(a.tips) ? a.tips : []).entries()) {
      const where = `tips[${i}]`;
      if (!tip || typeof tip !== 'object') {
        err(a.slug, `${where} must be an object`);
        continue;
      }
      for (const key of Object.keys(tip)) if (!['service', 'handle', 'name', 'url', 'source'].includes(key)) err(a.slug, `${where}: unknown field "${key}"`);
      const service = TIPS[tip.service];
      if (!service) err(a.slug, `${where}: service must be one of ${Object.keys(TIPS).join(', ')}`);
      if (typeof tip.handle !== 'string' || !tip.handle.trim()) err(a.slug, `${where}: missing handle`);
      if (tip.name != null && (typeof tip.name !== 'string' || !tip.name.trim())) err(a.slug, `${where}: name must be text`);
      if (typeof tip.source !== 'string' || !tip.source.trim()) err(a.slug, `${where}: missing source (where the tip jar was found)`);
      if (tip.url != null) {
        let host = '';
        try {
          const u = new URL(tip.url);
          if (u.protocol === 'https:') host = u.hostname.replace(/^www\./, '');
        } catch {}
        if (!host) err(a.slug, `${where}: url must be an https URL`);
        else if (service && !service.hosts.includes(host)) err(a.slug, `${where}: url isn't a ${service.label} link`);
      }
    }
  }
  return problems;
}
