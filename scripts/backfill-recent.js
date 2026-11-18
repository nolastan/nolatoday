#!/usr/bin/env node
/**
 * One-off: rebuild data/recent-shows.json from the git history of data/events/, replaying each
 * stored schedule the way the scraper does on every run. Needs full history (git fetch --unshallow).
 *   node scripts/backfill-recent.js [--dry]
 */
import { execFileSync } from 'node:child_process';
import { DateTime } from 'luxon';
import { ROOT, RECENT_FILE, loadRecent, writeJSON } from './lib/data.js';
import { ZONE } from './lib/time.js';
import { recordPast } from './lib/recent.js';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const localDate = (isoTime) => DateTime.fromISO(isoTime).setZone(ZONE).toISODate();

// Every version of every events file, oldest first.
const versions = new Map();
let commit = null;
for (const line of git('log', '--reverse', '--format=@%H %cI', '--name-only', '--', 'data/events/').split('\n')) {
  if (line.startsWith('@')) {
    const [sha, time] = line.slice(1).split(' ');
    commit = { sha, time };
  } else if (/^data\/events\/[^/]+\.json$/.test(line)) {
    const slug = line.slice('data/events/'.length, -5);
    if (!versions.has(slug)) versions.set(slug, []);
    versions.get(slug).push({ ...commit, file: line });
  }
}

const today = DateTime.now().setZone(ZONE).toISODate();
const recent = loadRecent();
for (const [slug, list] of versions) {
  let past = recent.venues[slug] ?? [];
  list.forEach((v, i) => {
    let events;
    try {
      events = JSON.parse(git('show', `${v.sha}:${v.file}`)).events ?? [];
    } catch {
      return; // deleted in this commit
    }
    // The scraper sees this version on the next run; shows dated before that run's day have passed.
    const nextRun = list[i + 1] ? localDate(list[i + 1].time) : today;
    past = recordPast(past, events, nextRun);
  });
  if (past.length) recent.venues[slug] = past;
}
recent.venues = Object.fromEntries(Object.entries(recent.venues).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv.includes('--dry')) console.log(JSON.stringify(recent, null, 2));
else writeJSON(RECENT_FILE, recent);
console.error(`${Object.keys(recent.venues).length} venues with recent shows`);
