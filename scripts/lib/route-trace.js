/**
 * Turn a route written as words ("right on Basin St, out Orleans, right on
 * Broad…") into a line along the City of New Orleans street centerlines.
 *
 * The rule throughout: never guess. Every street in the text has to be found in
 * the centerline data, each one has to meet the one before it, and a stated
 * "left" or "right" has to agree with the geometry. If any step fails, trace()
 * returns no line and says which step, so the parade is published without a
 * route instead of with a wrong one.
 */

// ---- Street names -----------------------------------------------------------

const ABBREV = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', dr: 'drive', rd: 'road',
  hwy: 'highway', pkwy: 'parkway', ct: 'court', pl: 'place', ln: 'lane',
};
const SUFFIXES = new Set(['street', 'avenue', 'boulevard', 'drive', 'road', 'highway', 'parkway', 'court', 'place', 'lane', 'way']);
const DIRECTIONS = new Set(['north', 'south', 'east', 'west']);

/** Lowercase words with accents, punctuation and abbreviations ironed out: "N. Villeré St." → ["north","villere","street"]. */
export function streetWords(text) {
  const raw = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return raw.map((w, i) => {
    // "St. Claude" is a saint, "Basin St." is a street.
    if (w === 'st' || w === 'str') return i < raw.length - 1 && !SUFFIXES.has(ABBREV[raw[i + 1]] ?? raw[i + 1]) ? 'saint' : 'street';
    // "So. Galvez" is South Galvez; a lone "so" is just a word.
    if (w === 'so') return i < raw.length - 1 ? 'south' : w;
    return ABBREV[w] ?? w;
  });
}

/** The part of a street name people actually say: no direction, no suffix. "North Claiborne Avenue" → "claiborne". */
export function streetBase(words) {
  const core = words.filter((w, i) => !(SUFFIXES.has(w) && i === words.length - 1));
  const noDir = core.length > 1 && DIRECTIONS.has(core[0]) ? core.slice(1) : core;
  return noDir.join(' ');
}

/** Lookup key for a base name. Spacing is not reliable in either the text or the data ("LaSalle" / "La Salle", "A. P. Tureaud" / "AP Tureaud"). */
const squash = (base) => base.replace(/ /g, '');

// Abbreviations people write for streets whose full names are long.
const ALIASES = {
  mlk: 'martinlutherkingjr', mlking: 'martinlutherkingjr', mlkjr: 'martinlutherkingjr', martinlutherking: 'martinlutherkingjr',
  och: 'orethacastlehaley', ochaley: 'orethacastlehaley',
};

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// ---- The street network -----------------------------------------------------

const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 0.866, a[1] - b[1]); // degrees, longitude scaled for 30°N
const METERS = 111000;
const MEDIAN = '*median*';

/**
 * Build a routable network from centerline features
 * ({ properties: { FULLNAME, FROMLEFT, TOLEFT, FROMRIGHT, TORIGHT }, geometry }).
 */
export function buildNetwork(features) {
  const adj = new Map(); // node key → [{ to, name, len, a, b }]
  const coord = new Map(); // node key → [lng, lat]
  const nodesOf = new Map(); // full street name → Set of node keys
  const byBase = new Map(); // base name (no spaces) → Set of full street names
  const spaced = new Map(); // base name (no spaces) → the same with its spaces
  const blocks = []; // address ranges
  const link = (a, b, name) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return;
    coord.set(ka, a);
    coord.set(kb, b);
    const len = dist(a, b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ to: kb, name, len });
    adj.get(kb).push({ to: ka, name, len });
    if (name !== MEDIAN) {
      nodesOf.get(name).add(ka);
      nodesOf.get(name).add(kb);
    }
  };
  for (const f of features) {
    const words = streetWords(f.properties?.FULLNAME);
    if (!words.length || !f.geometry) continue;
    const name = words.join(' ');
    if (!nodesOf.has(name)) nodesOf.set(name, new Set());
    const base = squash(streetBase(words));
    if (!byBase.has(base)) byBase.set(base, new Set());
    spaced.set(base, streetBase(words));
    byBase.get(base).add(name);
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) link(line[i - 1], line[i], name);
      const p = f.properties;
      const range = [p.FROMLEFT, p.TOLEFT, p.FROMRIGHT, p.TORIGHT].filter((n) => Number.isFinite(n) && n > 0);
      if (range.length) blocks.push({ name, lo: Math.min(...range), hi: Math.max(...range), from: key(line[0]), to: key(line[line.length - 1]) });
    }
  }
  return { adj, coord, nodesOf, byBase, spaced, blocks, link };
}

/**
 * Which centerline streets a written name could mean. "Claiborne Ave" gives both
 * North and South Claiborne; the trace keeps whichever one the route can reach.
 */
export function resolveStreet(net, text, { fuzzy = true, prefix = true } = {}) {
  const words = streetWords(text);
  if (!words.length) return [];
  const full = words.join(' ');
  // "S." or "A." alone is half a name, not South Avenue or A Street.
  if (words.length === 1 && String(text).replace(/[^A-Za-z0-9]/g, '').length <= 2) return [];
  const said = streetBase(words);
  const squashed = squash(said);
  const base = ALIASES[squashed] ?? squashed;
  const hasDir = words.length > 1 && DIRECTIONS.has(words[0]);
  const pick = (names) => {
    const all = [...names];
    // Honor a direction the text gave ("N. Broad") when the data has that street.
    const sameDir = hasDir ? all.filter((n) => n.startsWith(words[0] + ' ')) : all;
    return sameDir.length ? sameDir : all;
  };
  if (net.byBase.has(base)) return pick(net.byBase.get(base));
  if (net.nodesOf.has(full)) return [full];
  // The first word or two of a longer name ("Simon" for Simon Bolivar), when only one street starts that way.
  if (prefix && base.length >= 5) {
    const longer = [...net.byBase.keys()].filter((k) => net.spaced.get(k).startsWith(said + ' '));
    if (longer.length === 1) return pick(net.byBase.get(longer[0]));
  }
  // A typo ("Bernadrd", "Esplenade"): accept one close match, and only for names long enough to be distinctive.
  if (fuzzy && base.length >= 6) {
    let best = null;
    let tie = false;
    for (const candidate of net.byBase.keys()) {
      if (candidate[0] !== base[0]) continue;
      const d = editDistance(base, candidate);
      if (d > 2) continue;
      if (!best || d < best.d) {
        best = { d, candidate };
        tie = false;
      } else if (d === best.d) tie = true;
    }
    if (best && !tie) return pick(net.byBase.get(best.candidate));
  }
  return [];
}

function nodesOfStreets(net, names) {
  const out = new Set();
  for (const n of names) for (const k of net.nodesOf.get(n) ?? []) out.add(k);
  return out;
}

/** Shortest paths from `start` staying on the named streets (or on any street, within `limit`). */
function walk(net, start, names, { limit = Infinity } = {}) {
  const allowed = names ? new Set([...names, MEDIAN]) : null;
  const best = new Map([[start, 0]]);
  const prev = new Map();
  const queue = [[0, start]];
  while (queue.length) {
    let m = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[m][0]) m = i;
    const [d, u] = queue.splice(m, 1)[0];
    if (d > best.get(u)) continue;
    for (const e of net.adj.get(u) ?? []) {
      if (allowed && !allowed.has(e.name)) continue;
      const nd = d + e.len;
      if (nd > limit || nd >= (best.get(e.to) ?? Infinity)) continue;
      best.set(e.to, nd);
      prev.set(e.to, { from: u, name: e.name });
      queue.push([nd, e.to]);
    }
  }
  const pathTo = (target) => {
    const keys = [target];
    const via = new Set();
    for (let k = target; k !== start; ) {
      const p = prev.get(k);
      via.add(p.name);
      keys.unshift(p.from);
      k = p.from;
    }
    return { keys, via };
  };
  return { best, pathTo };
}

/**
 * Streets that carry straight on from where the current ones end under another
 * name (Simon Bolivar Avenue becomes La Salle Street at Jackson Avenue).
 */
function continuations(net, nodes, streets) {
  const out = new Set();
  for (const k of nodes) {
    const edges = net.adj.get(k) ?? [];
    const own = edges.filter((e) => streets.includes(e.name));
    if (own.length !== 1) continue;
    for (const e of edges) {
      if (e.name === MEDIAN || streets.includes(e.name)) continue;
      // The other street has to begin here too; one that passes through is a cross street.
      if (edges.filter((x) => x.name === e.name).length !== 1) continue;
      if (Math.abs(turnAngle(net.coord.get(own[0].to), net.coord.get(k), net.coord.get(e.to))) < 30) out.add(e.name);
    }
  }
  return [...out];
}

const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * 0.866, b[1] - a[1]) * 180) / Math.PI;
/** Signed turn in degrees from heading a→b to heading b→c: positive is a right turn. */
const turnAngle = (a, b, c) => ((bearing(b, c) - bearing(a, b) + 540) % 360) - 180;

/** The network node for a street address, from the centerlines' own address ranges. */
function addressNode(net, number, names, nearest = null) {
  // One candidate per street name: "1500 Claiborne" could be North or South.
  const perName = new Map();
  for (const b of net.blocks) {
    if (!names.includes(b.name)) continue;
    const off = number < b.lo ? b.lo - number : number > b.hi ? number - b.hi : 0;
    if (!perName.has(b.name) || off < perName.get(b.name).off) perName.set(b.name, { off, block: b });
  }
  // More than a couple of blocks out of range means the address isn't on this street.
  const nodes = [...perName.values()]
    .filter((c) => c.off <= 250)
    .sort((a, b) => a.off - b.off)
    .map(({ block }) => ((block.hi > block.lo ? (number - block.lo) / (block.hi - block.lo) : 0) > 0.5 ? block.to : block.from));
  if (!nodes.length) return null;
  if (!nearest) return nodes[0];
  const reachable = nodes.filter((k) => nearest.has(k)).sort((a, b) => nearest.get(a) - nearest.get(b));
  return reachable[0] ?? null;
}

/** Distance in meters from a point to the nearest vertex or segment of a line. */
function offLine(line, p) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const dx = (b[0] - a[0]) * 0.866;
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * 0.866) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  }
  return best * METERS;
}

/**
 * Trace a route.
 *
 *   start: { number, street } | { cross: [streetA, streetB] }
 *   steps: [{ street, turn?: 'left' | 'right', via?: true } | { address: { number, street } }]
 *          `via` marks a cross street the route only goes as far as (a U-turn point), without turning onto it.
 *          An address on the street the route is on is walked to; one elsewhere is a stop beside the
 *          route, and the finished line has to pass close to it.
 *   end:   { number, street } (optional; must be on the last street)
 *
 * Returns { line, problems, notes }. `line` is null whenever `problems` is non-empty.
 */
export function trace(net, { start, steps: given, end }) {
  const steps = [...given];
  const beside = [];
  const problems = [];
  const notes = [];
  const fail = (msg) => ({ line: null, problems: [...problems, msg], notes });

  let current;
  let streets;
  if (start?.cross) {
    const [a, b] = start.cross.map((s) => resolveStreet(net, s));
    if (!a.length || !b.length) return fail(`start: could not find "${start.cross[a.length ? 1 : 0]}"`);
    const shared = [...nodesOfStreets(net, a)].filter((k) => nodesOfStreets(net, b).has(k));
    if (!shared.length) return fail(`start: ${start.cross.join(' and ')} do not meet`);
    current = shared[0];
    streets = [...a, ...b];
  } else if (start?.street) {
    streets = resolveStreet(net, start.street);
    if (!streets.length) return fail(`start: could not find "${start.street}"`);
    current = start.number != null ? addressNode(net, start.number, streets) : null;
    if (!current) return fail(`start: no ${start.number ?? ''} block on ${start.street}`.replace('  ', ' '));
  } else return fail('no start');

  let waypoint = null;
  let waypointName = null;
  let turned = null;
  let respliced = false;
  let atAddress = start?.number != null;
  const keys = [current];
  const append = (path) => {
    for (const k of path.slice(1)) keys.push(k);
  };
  const heading = () => (keys.length >= 2 ? [net.coord.get(keys[keys.length - 2]), net.coord.get(keys[keys.length - 1])] : null);

  for (let i = 0; i < steps.length; i++) {
    if (steps.length > 200) return fail('route has too many steps to be a parade');
    const step = steps[i];
    if (step.address) {
      const { number, street } = step.address;
      const on = resolveStreet(net, street).filter((n) => streets.includes(n));
      const along = on.length ? walk(net, current, streets) : null;
      const target = along && addressNode(net, number, on, along.best);
      if (!target) {
        beside.push(step.address);
        continue;
      }
      append(along.pathTo(target).keys);
      current = target;
      waypoint = null;
      atAddress = true;
      continue;
    }
    atAddress = false;
    const label = step.label ?? `"${step.street}"`;
    const next = step.names ?? resolveStreet(net, step.street);
    if (!next.length) return fail(`${label}: no such street in the city's centerlines`);
    if (next.some((n) => streets.includes(n))) continue; // still on the same street

    const theirs = nodesOfStreets(net, next);
    let meet;
    let along;
    for (let pass = 0; ; pass++) {
      meet = [...nodesOfStreets(net, streets)].filter((k) => theirs.has(k));
      // A divided boulevard has a centerline per carriageway; join the places where the two streets meet a few yards apart.
      for (const x of meet) for (const y of meet) if (x < y && dist(net.coord.get(x), net.coord.get(y)) < 0.0007) net.link(net.coord.get(x), net.coord.get(y), MEDIAN);
      along = walk(net, current, streets);
      meet = meet.filter((k) => along.best.has(k));
      if (meet.length || pass) break;
      // "Valence to Loyola, to Magnolia": Loyola was a point along Valence, not a turn.
      if (waypoint) {
        const back = walk(net, current, waypoint);
        const ahead = [...theirs].filter((k) => back.best.has(k)).sort((a, b) => back.best.get(a) - back.best.get(b))[0];
        const onward = ahead && back.pathTo(ahead).keys[1];
        const came = heading();
        // Only if it lies further along the way we were going; doubling back would be a guess.
        if (onward && came && Math.abs(turnAngle(came[0], came[1], net.coord.get(onward))) < 90) {
          notes.push(`${label}: read "${waypointName}" as a point passed on ${waypoint[0]}, not a turn`);
          streets = waypoint;
          continue;
        }
      }
      // Not on this street under this name. See whether either street carries on under another one.
      const onward = continuations(net, along.best.keys(), streets).filter((n) => [...net.nodesOf.get(n)].some((k) => theirs.has(k)));
      if (onward.length) {
        notes.push(`${label}: followed ${streets[0]} on to where it continues as ${onward.join(', ')}, which the text does not name`);
        streets = [...streets, ...onward];
        continue;
      }
      const mine = nodesOfStreets(net, streets);
      const before = step.names ? [] : continuations(net, theirs, next).filter((n) => [...net.nodesOf.get(n)].some((k) => mine.has(k)));
      if (before.length) {
        // Take the unnamed stretch as a step of its own, then the named street.
        notes.push(`${label}: joined ${next[0]} by way of ${before.join(', ')}, the same road under another name, which the text does not name`);
        steps.splice(i, 1, { street: before[0], names: before, turn: step.turn, label }, { ...step, turn: undefined, names: next, label });
        respliced = true;
      }
      break;
    }
    if (respliced) {
      respliced = false;
      i--;
      continue;
    }
    let arrive = null;
    if (meet.length) {
      const scored = meet.map((k) => {
        const path = along.pathTo(k).keys;
        const from = path.length >= 2 ? [net.coord.get(path[path.length - 2]), net.coord.get(k)] : heading();
        let agrees = null;
        if (step.turn && !step.via && from) {
          const exits = (net.adj.get(k) ?? []).filter((e) => next.includes(e.name) || e.name === MEDIAN);
          agrees = exits.some((e) => {
            const angle = turnAngle(from[0], from[1], net.coord.get(e.to));
            return step.turn === 'right' ? angle > 20 && angle < 160 : angle < -20 && angle > -160;
          });
        }
        // "Left onto Decatur. Continue onto N Peters": having turned left at the corner, set off along Decatur to the left.
        let setsOff = null;
        if (turned && turned.k === current && path.length >= 2) {
          const angle = turnAngle(turned.from[0], turned.from[1], net.coord.get(path[1]));
          setsOff = turned.turn === 'right' ? angle > 20 && angle < 160 : angle < -20 && angle > -160;
        }
        return { k, path, d: along.best.get(k), agrees, setsOff };
      });
      // Standing at the corner already (the first step from a corner start): prefer actually going somewhere.
      scored.sort((a, b) => (a.agrees === false) - (b.agrees === false) || (a.setsOff === false) - (b.setsOff === false) || a.d - b.d);
      arrive = scored[0];
      if (arrive.agrees === false) return fail(`${label}: the text says ${step.turn}, but the streets meet the other way`);
      append(arrive.path);
    } else {
      // The streets never touch, usually a block that changes name. Bridge a short gap and say so.
      let bridge = null;
      for (const [k, d] of along.best) {
        let near = false;
        for (const t of theirs) if (dist(net.coord.get(k), net.coord.get(t)) < 0.0025) { near = true; break; }
        if (!near) continue;
        const free = walk(net, k, null, { limit: 0.0025 });
        for (const t of theirs) {
          const gap = free.best.get(t);
          if (gap != null && (!bridge || gap + d * 0.01 < bridge.cost)) bridge = { cost: gap + d * 0.01, gap, from: k, to: t, free };
        }
      }
      if (!bridge) return fail(`${label}: does not meet ${streets[0]} anywhere along the route`);
      const hop = bridge.free.pathTo(bridge.to);
      append(along.pathTo(bridge.from).keys);
      append(hop.keys);
      notes.push(`${label}: reached over ${Math.round(bridge.gap * METERS)} m of ${[...hop.via].filter((n) => n !== MEDIAN).join(', ') || 'median'}, which the text does not name`);
      arrive = { k: bridge.to };
    }
    // The way the route came into a corner where the text says it turned, so the next step leaves that corner the same way.
    const into = arrive.path?.length >= 2 ? [net.coord.get(arrive.path[arrive.path.length - 2]), net.coord.get(arrive.k)] : null;
    turned = step.turn && !step.via && into ? { k: arrive.k, from: into, turn: step.turn } : null;
    current = arrive.k;
    // A street reached with no turn stated may be only a point on the way; remember the street we were on.
    waypoint = !step.via && !step.turn ? streets : null;
    waypointName = step.street;
    if (!step.via) streets = next;
  }

  if (end?.street) {
    const names = resolveStreet(net, end.street);
    if (!names.some((n) => streets.includes(n))) return fail(`end: ${end.street} is not the last street of the route`);
    const target = end.number != null ? addressNode(net, end.number, streets) : null;
    if (!target) return fail(`end: no ${end.number} block on ${end.street}`);
    const along = walk(net, current, streets);
    if (!along.best.has(target)) return fail(`end: could not reach ${end.number} ${end.street}`);
    append(along.pathTo(target).keys);
  } else if (!atAddress) {
    notes.push('the text gives no end address, so the line stops where it reaches the last street');
  }

  const line = keys.map((k) => net.coord.get(k)).filter((p, i, all) => i === 0 || p !== all[i - 1]);
  if (line.length < 2) return fail('route has no length');
  const meters = line.reduce((sum, p, i) => (i ? sum + dist(line[i - 1], p) * METERS : 0), 0);
  // A walking parade of 30 km is a parsing mistake, not a parade.
  if (meters > 25000) return fail(`traced line is ${Math.round(meters / 1000)} km long`);
  // Stops the text lists by address are a check on the whole reading: the line has to pass them.
  for (const { number, street } of beside) {
    const names = resolveStreet(net, street);
    const perName = names.map((n) => addressNode(net, number, [n])).filter(Boolean);
    if (!perName.length) continue;
    const off = Math.min(...perName.map((k) => offLine(line, net.coord.get(k))));
    if (off > 300) return fail(`the line passes ${Math.round(off)} m from ${number} ${street}, which the text lists as a stop`);
  }
  return { line, problems: [], notes, meters: Math.round(meters) };
}
