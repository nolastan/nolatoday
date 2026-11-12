/**
 * Parades from the City of New Orleans' special event permit applications
 * (data.nola.gov aib5-en5t, type "Special Event - Master").
 *
 * The feed is every special event application: weddings, private parties,
 * festivals, races. Only rows that city staff have written up in their parade
 * format and that are public parades get through. Private events are never
 * published, whatever else they contain.
 */
import { DateTime } from 'luxon';
import { ZONE } from './time.js';
import { parseClock, slugify } from './parades.js';
import { resolveStreet, streetWords, trace } from './route-trace.js';

// Applications in these states are not happening, or not as described.
const DEAD_STATUS = /denied|void|withdr|different permit type|ineligible|expired|inactive|duplicate/i;

const PARADE = /second\s?-?\s?line|parade|procession|\bmarch\b|steppers/i;
const CLUB = /social\s+aid|pleasure\s+club|\bs\.?\s?a\.?\s?&\s?p\.?\s?c\b|\bsapc\b|steppers|buckjumpers/i;
const ORGANIZATION = new RegExp(`${CLUB.source}|krewe|school|university|college|academy|church|parish|club\\b|association|council|foundation`, 'i');
// Private occasions. Checked against the title always, and against the whole description unless the title names an organization.
const PRIVATE = /wedding|bride|groom|reception|rehearsal|bachelor|birthday|corporate|private|funeral|memorial|repast|celebration of life|retirement|graduation|reunion|shower|engagement|proposal|guests?\b|attendees|convention|conference|incentive/i;
const NOT_A_PARADE = /\b(\d+k|run|race|pub\s?crawl|bar\s?crawl|crawl|bike ride|parking|concession|viewing|block party|festival|fundraiser|dance|picnic|open house)\b/i;

/** Is this row a public parade written up in the city's parade format? Returns a reason when it is not. */
export function permitVerdict(row) {
  const descr = row.descr ?? '';
  const head = parseHeadline(descr);
  if (!head) return 'not in the city’s "title - address - date" format';
  if (head.title.length > 90) return 'not in the city’s "title - address - date" format';
  const filed = DateTime.fromISO(String(row.d_create ?? '').slice(0, 10), { zone: ZONE });
  const days = filed.isValid ? DateTime.fromISO(head.date, { zone: ZONE }).diff(filed, 'days').days : 0;
  if (days < -60 || days > 550) return 'date does not fit when the application was filed';
  if (!/^\s*(Route\b\s*:?|Formation\s*:)/im.test(descr)) return 'no Route or Formation line';
  if (DEAD_STATUS.test(row.currentstatus ?? '')) return `status "${row.currentstatus}"`;
  if (!PARADE.test(head.title) && !CLUB.test(head.title)) return 'title is not a parade';
  if (NOT_A_PARADE.test(head.title) && !/parade/i.test(head.title.replace(/pub\s?crawl|block party/gi, ''))) return 'title is a race, crawl or party';
  if (/pub\s?crawl|bar\s?crawl/i.test(head.title)) return 'title is a race, crawl or party';
  if (PRIVATE.test(head.title)) return 'private event';
  if (!ORGANIZATION.test(head.title) && PRIVATE.test(descr)) return 'private event';
  return null;
}

/** "Nine Times SA & PC Second Line Parade 2026- 3301 Higgins Blvd (Thrive 9th Ward) 11-22-2026" → title, address, date. */
export function parseHeadline(descr) {
  const lines = String(descr ?? '').split('\n').map((l) => l.trim());
  const DATE = /(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?!\d)/;
  // The headline is the first line; now and then it wraps onto the second.
  let first = lines[0];
  if (!DATE.test(first) && lines[1] && DATE.test(lines[1]) && !/^(Route|Formation|Start|End)\b/i.test(lines[1])) first = `${first} ${lines[1]}`;
  const m = DATE.exec(first);
  if (!m) return null;
  const date = DateTime.fromObject({ year: Number(m[3]), month: Number(m[1]), day: Number(m[2]) }, { zone: ZONE });
  if (!date.isValid) return null;
  const head = first.slice(0, m.index).replace(/[\s-]+$/, '');
  // The title ends at the first dash that is followed by a street address, or failing that at the last dash.
  const toAddress = head.search(/\s?-\s?(?=\d{2,5} [A-Za-z])/);
  const cut = toAddress >= 3 ? toAddress : Math.max(head.lastIndexOf(' - '), head.lastIndexOf('- '), head.lastIndexOf(' -'));
  if (cut < 3) return null;
  const title = head.slice(0, cut).replace(/[\s-]+$/, '').replace(/\s+/g, ' ').trim();
  const address = head.slice(cut).replace(/^[\s-]+/, '').replace(/\s+/g, ' ').trim();
  if (!title || !address) return null;
  return { title, address, date: date.toISODate() };
}

const CLUB_WORDS = /\b(social\s+aid\s*(and|&)?\s*pleasure\s+club|social\s*(and|&)\s*pleasure\s+club|s\.?\s?a\.?\s?&\s?p\.?\s?c\.?|sapc)(?=\W|$)/gi;
const FILLER = /\(\d+\)\s*hour|\(\d\)|\b\d+(st|nd|rd|th)\s+annual\b|\bannual\b|\b20\d\d\b|\bMG\b|\bmardi gras\b|second\s?-?\s?line+e?|\bparade\b|\bwalking\b|\bmarching\b/gi;

/** The organization behind a permit title: "Nine Times SA & PC Second Line Parade 2026" → "Nine Times SA & PC". */
export function organizerName(title) {
  return title
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–,.:]+|[\s\-–,.:]+$/g, '')
    .trim();
}

export function organizerSlug(title) {
  const name = organizerName(title).replace(CLUB_WORDS, ' ').replace(/^\s*the\s+/i, '').replace(/^\s*krewe\s+(of\s+)?(?=\w+\s*$)/i, '');
  return slugify(name);
}

/** "Start: 1:00 PM", on its own line or run together with the others. */
function labeledTime(descr, label, date) {
  const m = new RegExp(`\\b${label}\\s*:\\s*(\\d{1,2}(?:[:;.]\\d{2})?\\s*[ap]\\.?m\\b\\.?)`, 'i').exec(descr);
  const clock = m && parseClock(m[1].replace(/\s+/g, ' '));
  return clock ? DateTime.fromISO(date, { zone: ZONE }).set(clock).toISO({ suppressMilliseconds: true }) : null;
}

// Lines that end a route: the next label, staffing notes, head counts, contact details.
const NOT_ROUTE = /^\s*((Formation|Start|End|Disband|Street Closure|Block Closure|Sidewalk Closure|Awaiting|Contact|Elements)\b\s*:?|[•*\-]|\d[\d,+]*\s*(guests|participants|members|marchers|attendees|people)\b)|\*\*\*|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\S+@\S+\.\S+/i;

/**
 * The route as the city wrote it: the "Route:" line and any lines it runs on
 * to. It stops at the first blank line or anything that is not route (what
 * follows in these records is staffing notes and contact details, which are
 * not ours to publish), and anything after a phone number or email is dropped.
 */
export function routeText(descr) {
  const lines = String(descr ?? '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*Route\b\s*:?\s*\S/i.test(l));
  if (at === -1) return null;
  const kept = [lines[at].replace(/^\s*Route\b\s*:?\s*/i, '')];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || NOT_ROUTE.test(line) || kept.length >= 12) break;
    kept.push(line);
  }
  const text = kept
    .join(' ')
    .split(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\S+@\S+\.\S+/)[0]
    // "… Disband: 3512 Louisa St Formation: 11:30 AM": the times, run on to the same line.
    .split(/\s(?:Formation|Start|End)\s*:\s*\d{1,2}[:;.]?\d{0,2}\s*[ap]\.?m/i)[0]
    .replace(/\s+/g, ' ')
    .trim();
  // "Route Sheet Attached" and the like: the route exists but is not in the public record.
  return text && !/^(route\s+sheet|see|map)?\s*(is\s+)?(attached)?\.?$/i.test(text) && text.length > 15 ? text : null;
}

/** One permit application row → a normalized parade record, or { skipped }. */
export function fromPermit(row) {
  const reason = permitVerdict(row);
  if (reason) return { skipped: reason };
  const descr = row.descr;
  const head = parseHeadline(descr);
  const formation = labeledTime(descr, 'Formation', head.date);
  const end = labeledTime(descr, 'End', head.date);
  let start = labeledTime(descr, 'Start', head.date);
  // A start before the line-up, long after it, or after the end is a slip of the keyboard ("11:00 PM"); better no time than a wrong one.
  if (start && ((formation && (start < formation || DateTime.fromISO(start).diff(DateTime.fromISO(formation), 'hours').hours > 4)) || (end && start >= end))) start = null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  const category = CLUB.test(head.title) || /second\s?-?\s?line/i.test(head.title) ? 'second_line' : /mardi gras|\bMG\b|carnival/i.test(head.title) ? 'mardi_gras' : 'other';
  return {
    record: {
      source: 'permits',
      name: head.title,
      organizer: organizerName(head.title),
      slug: organizerSlug(head.title),
      category,
      date: head.date,
      start_time: start,
      end_time: end && end > (start ?? formation ?? end) ? end : null,
      formation_time: formation,
      start_address: head.address,
      start_point: Number.isFinite(lat) && Number.isFinite(lng) && lat > 29.8 && lat < 30.2 && lng > -90.35 && lng < -89.85 ? [Number(lng.toFixed(6)), Number(lat.toFixed(6))] : null,
      route_text: routeText(descr),
      permit_number: row.permitnumber ?? null,
      permit_status: row.currentstatus ?? null,
      filed: /^\d{4}-\d{2}-\d{2}/.exec(row.d_create ?? '')?.[0] ?? null,
    },
  };
}

// ---- Route text → steps ------------------------------------------------------

const STOP_WORDS = new Set(['right', 'left', 'to', 'on', 'onto', 'stop', 'disband', 'continue', 'up', 'down', 'and', 'then', 'turn', 'uturn', 'out', 'back', 'at', 'the', 'start', 'end', 'proceed', 'along', 'into', 'from', 'toward', 'towards']);
const CONNECT = /\b(?:(?:ends?|ending|disbands?|disbanding)\s+at|(right|rigth|left|lft|letf|ledt)(?:\s+turn)?(?:\s+(on|onto|at|to|down|up|in))?|(u\s?-?\s?turn)(?:\s+(at|on|onto))?|(?:to|down|up|out|along|onto|on|back|into))\s+/gi;
const side = (word) => (/^r/i.test(word) ? 'right' : 'left');

/** Punctuation that gets in the way of reading names: "(Right) On", "St,. Bernard", curly quotes. */
const tidy = (text) => String(text).replace(/[()“”"]/g, ' , ').replace(/[,.]{2,}/g, '.').replace(/\s+/g, ' ').trim();

/** Words following a position, up to the next punctuation that ends a name or the next direction word. */
function wordsAfter(text, from) {
  const out = [];
  const re = /\s*([A-Za-z0-9.'’\-]+)/y;
  re.lastIndex = from;
  let m;
  let end = from;
  while (out.length < 6 && (m = re.exec(text))) {
    const raw = m[1];
    const word = raw.replace(/[.'’]/g, '').toLowerCase();
    if (!word || word === '-') break;
    if (out.length && STOP_WORDS.has(word)) break;
    if (!out.length && STOP_WORDS.has(word) && word !== 'the') break;
    out.push({ raw, end: re.lastIndex });
    end = re.lastIndex;
  }
  return { words: out, end };
}

/** The longest run of words that names a street the city knows; fuzzy only if nothing matches exactly. */
function streetAt(net, text, from) {
  const { words } = wordsAfter(text, from);
  if (!words.length) return null;
  let number = null;
  let list = words;
  if (/^\d{2,5}$/.test(list[0].raw)) {
    number = Number(list[0].raw);
    list = list.slice(1);
  }
  const strip = (name) => name.replace(/[.,;:]+$/, '');
  // Exact names first, then misspellings, then the first word or two of a longer name ("Simon" for Simon Bolivar).
  for (const how of [{ fuzzy: false, prefix: false }, { fuzzy: true, prefix: false }, { fuzzy: false, prefix: true }]) {
    for (let n = Math.min(list.length, 4); n >= 1; n--) {
      const name = strip(list.slice(0, n).map((w) => w.raw).join(' '));
      // One loose word is not enough to call something a street by resemblance.
      if (how.fuzzy && n === 1 && streetWords(name).join('').length < 7) continue;
      if (resolveStreet(net, name, how).length) return { street: name, number, end: list[n - 1].end };
    }
  }
  return null;
}

/**
 * Read a route description into a start and steps for trace().
 * `address` is the permit's own start address, used when the text does not open with one.
 */
export function parseRoute(net, rawText, address) {
  const text = tidy(rawText);
  let start = null;

  CONNECT.lastIndex = 0;
  const first = CONNECT.exec(text);
  const lead = text.slice(0, first ? first.index : text.length);
  let startFromLead = false;
  for (const opener of [lead, tidy(address ?? '')]) {
    if (start) break;
    const numbered = /(?<![\d-])(\d{2,5})\s+(?=[A-Za-z])/g;
    let m;
    while (!start && (m = numbered.exec(opener))) {
      const hit = streetAt(net, opener, m.index);
      if (hit?.number != null) start = { number: hit.number, street: hit.street };
    }
    if (!start) {
      const cross = /^(.+?)\s+(?:&|and|at|@)\s+(.+?)(?:,|$)/i.exec(opener.trim());
      if (cross && resolveStreet(net, cross[1]).length && resolveStreet(net, cross[2]).length) start = { cross: [cross[1].trim(), cross[2].trim()] };
    }
    startFromLead = Boolean(start) && opener === lead;
  }

  // Everything the text names, in the order it names it: streets after a direction word, and addresses.
  const items = [];
  CONNECT.lastIndex = 0;
  let m;
  while ((m = CONNECT.exec(text))) {
    // "to Fourth. U-turn up Claiborne": the street just named is only as far as the route goes.
    if (m[3] && !m[4]) {
      const before = items.filter((it) => it.street).pop();
      if (before && !before.turn) before.via = true;
      continue;
    }
    const hit = streetAt(net, text, CONNECT.lastIndex);
    if (!hit) continue;
    const uturn = Boolean(m[3]);
    // "Right to Louisiana" says which way to set off, not which way to turn onto Louisiana.
    const turn = m[1] && m[2]?.toLowerCase() !== 'to' && !uturn ? side(m[1]) : null;
    items.push({ index: m.index, street: hit.street, ...(turn ? { turn } : {}), ...(uturn ? { via: true } : {}) });
    CONNECT.lastIndex = hit.end;
  }
  // Addresses, wherever they appear: "to 2836 LaSalle St", "STOP: 1931 Orleans Ave (Bad Boyz)".
  const numbered = /(?<![\d-])(\d{3,5})\s*(?=[A-Za-z])/g;
  let a;
  while ((a = numbered.exec(text))) {
    if (startFromLead && a.index < lead.length) continue;
    const hit = streetAt(net, text, a.index);
    if (hit?.number != null) items.push({ index: a.index + 0.5, address: { number: hit.number, street: hit.street } });
  }
  items.sort((x, y) => x.index - y.index);

  const steps = [];
  for (const { index, ...item } of items) {
    const last = steps[steps.length - 1];
    if (item.street && last?.street && !last.via && !item.via) {
      // "Right on Jackson. Up Jackson to …" is one street, named twice.
      const same = resolveStreet(net, last.street).some((n) => resolveStreet(net, item.street).includes(n));
      if (same) {
        if (item.turn && !last.turn) last.turn = item.turn;
        continue;
      }
    }
    steps.push(item);
  }
  return { start, steps };
}

/** Route text → { line, problems, notes }. Never throws on bad text; it reports. */
export function traceRouteText(net, text, address) {
  const parsed = parseRoute(net, text, address);
  if (!parsed.start) return { line: null, problems: ['could not find where the route starts'], notes: [], parsed };
  if (!parsed.steps.some((step) => step.street)) return { line: null, problems: ['could not read any streets from the route'], notes: [], parsed };
  return { ...trace(net, parsed), parsed };
}
